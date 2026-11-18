import type { useService } from "@glasshome/widget-sdk";
import { isDarkTheme, themeRoot as readThemeRoot } from "../theme";
import { trimSlashes } from "../url";
import { errorMessage } from "../errors";

/**
 * ESPN's public site API. The endpoints themselves are CORS-open
 * (`access-control-allow-origin: *`), but that is not the binding
 * constraint: the dashboard ships a Content-Security-Policy whose
 * `connect-src` and `img-src` list only 'self', glasshome.app and the Home
 * Assistant origin. A direct request to espn.com is therefore refused by the
 * browser before it is ever sent.
 *
 * The way through is a passthrough on an origin the policy already trusts —
 * the same trick the media-player widget uses for cover art. Every outbound
 * URL here goes through `viaProxy`, so one setting covers both the JSON and
 * the crests.
 */
const SITE_API = "https://site.api.espn.com/apis";

/**
 * In the sealed engine of Dash 1.5 there is no fetch, and a widget may not
 * send a network address to Home Assistant either. There the data comes
 * from the GlassHome Artwork integration's `glasshome_artwork.sport`
 * service (homeassistant/custom_components/glasshome_artwork/sport.py),
 * asked by league code, months and team ids only; it answers ESPN's own
 * shape cut down to what is read here, and the crests as small PNG data URLs.
 */
export type SportCall = (data: Record<string, unknown>) => Promise<any>;
type CallService = ReturnType<typeof useService>["callService"];

/** The sport service through a widget's callService. */
export function sportService(call: CallService): SportCall {
  return async (data) => {
    const reply = (await call("glasshome_artwork", "sport", data, undefined, { returnResponse: true })) as any;
    return reply && typeof reply === "object" && "response" in reply ? reply.response : reply;
  };
}

/** Whether this engine can reach ESPN itself (Dash 1.4 and older). */
export const canFetch = (): boolean => typeof fetch === "function";

/* The crests, by ESPN team id, for the session: asked for once each. */
const crests = new Map<string, string>();
const askedCrests = new Set<string>();

/** Fills in the crests the integration has, asking for the ones not yet asked for. */
async function withCrests(ids: string[], sport: SportCall): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id) => /^\d+$/.test(id) && !askedCrests.has(id)))];
  for (const id of wanted) askedCrests.add(id);
  /* At most 24 teams a call; a league has fewer, so it is one call, two for
     a cup's matchday at most. */
  const batches: string[][] = [];
  for (let i = 0; i < wanted.length; i += 24) batches.push(wanted.slice(i, i + 24));
  await Promise.all(
    batches.map(async (teams) => {
      try {
        const reply = await sport({ kind: "crests", teams, size: 64 });
        for (const [id, crest] of Object.entries(reply?.crests ?? {})) {
          if (typeof crest === "string") crests.set(id, crest);
        }
      } catch {
        /* Without crests the initials stand in, as before. */
      }
    }),
  );
  return crests;
}

export type MatchState = "pre" | "in" | "post";

export interface TeamSide {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  logo?: string;
  score?: number;
  homeAway: "home" | "away";
  rank?: string;
}

export interface Match {
  id: string;
  date: Date;
  state: MatchState;
  /** e.g. "90'+1'", "FT", "Sat, 3:30 PM" — ESPN's own short status text. */
  statusDetail: string;
  clock?: string;
  venue?: string;
  home: TeamSide;
  away: TeamSide;
}

export interface StandingRow {
  rank: number;
  teamId: string;
  name: string;
  shortName: string;
  logo?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: string;
  points: number;
}

export interface NewsItem {
  title: string;
  link: string;
  published?: Date;
  source: string;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function side(competitor: any): TeamSide {
  const team = competitor?.team ?? {};
  return {
    id: String(team.id ?? ""),
    name: team.displayName ?? team.name ?? "",
    shortName: team.shortDisplayName ?? team.abbreviation ?? team.displayName ?? "",
    abbreviation: team.abbreviation ?? "",
    logo: team.logo,
    score: num(competitor?.score),
    homeAway: competitor?.homeAway === "away" ? "away" : "home",
    // ESPN puts the table position here only for some competitions; the
    // standings call fills the gap when it's missing.
    rank: competitor?.curatedRank?.current ? String(competitor.curatedRank.current) : undefined,
  };
}

function parseEvent(event: any): Match | undefined {
  const competition = event?.competitions?.[0];
  if (!competition) return undefined;
  const competitors: any[] = competition.competitors ?? [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  if (!home || !away) return undefined;

  const type = event?.status?.type ?? {};
  const rawState = type.state;
  const state: MatchState = rawState === "in" || rawState === "post" ? rawState : "pre";

  return {
    id: String(event.id ?? ""),
    date: new Date(event.date),
    state,
    statusDetail: type.shortDetail ?? type.detail ?? "",
    clock: event?.status?.displayClock,
    venue: competition?.venue?.fullName,
    home: side(home),
    away: side(away),
  };
}


/** ESPN's compact month, YYYYMM — the widest window it still answers. */
function yyyymm(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftDays(base: Date, days: number): Date {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export interface Scoreboard {
  leagueName: string;
  matches: Match[];
}

/**
 * A window rather than "today": the tile has to show a result for two days
 * after the whistle and otherwise the next fixture, so both directions need
 * to be in range.
 *
 * Asked for by month rather than by range. ESPN used to answer
 * `dates=YYYYMMDD-YYYYMMDD` and now replies 400 to every range it is given,
 * while a single day and a whole month still work — so the window is covered
 * by the one or two months it falls in and filtered here. Two calls at the
 * turn of a month, one the rest of the time, and the tile is no longer at the
 * mercy of a query format ESPN quietly dropped.
 */
export async function fetchScoreboard(
  league: string,
  proxyBase = "",
  sport?: SportCall,
  backDays = 5,
  forwardDays = 21,
): Promise<Scoreboard> {
  const now = new Date();
  const from = shiftDays(now, -backDays);
  const to = shiftDays(now, forwardDays);

  const months = [...new Set([yyyymm(from), yyyymm(to)])];
  const path = `${SITE_API}/site/v2/sports/soccer/${encodeURIComponent(league)}/scoreboard`;

  const pages: any[] = canFetch()
    ? await Promise.all(
        months.map(async (month) => {
          const response = await fetch(viaProxy(`${path}?dates=${month}`, proxyBase));
          if (!response.ok) throw new Error(`Scoreboard request failed (HTTP ${response.status})`);
          return response.json();
        }),
      )
    : ((await needSport(sport)({ kind: "scoreboard", league, months }))?.pages ?? []);

  /* A fixture can appear in both months' answers when ESPN pads the edges, so
     the id decides rather than the order. */
  const seen = new Map<string, Match>();
  for (const data of pages) {
    for (const event of data?.events ?? []) {
      const match = parseEvent(event);
      if (!match || Number.isNaN(match.date.getTime())) continue;
      const at = match.date.getTime();
      if (at < from.getTime() || at > to.getTime()) continue;
      seen.set(match.id, match);
    }
  }

  const matches = [...seen.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (!canFetch() && sport) {
    const found = await withCrests(matches.flatMap((m) => [m.home.id, m.away.id]), sport);
    for (const match of matches) {
      match.home.logo = found.get(match.home.id) ?? match.home.logo;
      match.away.logo = found.get(match.away.id) ?? match.away.logo;
    }
  }

  return {
    leagueName: pages.find((data) => data?.leagues?.[0]?.name)?.leagues?.[0]?.name ?? "",
    matches,
  };
}

export async function fetchStandings(
  league: string,
  proxyBase = "",
  sport?: SportCall,
): Promise<StandingRow[]> {
  let data: any;
  if (canFetch()) {
    const url = `${SITE_API}/v2/sports/soccer/${encodeURIComponent(league)}/standings`;
    const response = await fetch(viaProxy(url, proxyBase));
    if (!response.ok) throw new Error(`Standings request failed (HTTP ${response.status})`);
    data = await response.json();
  } else {
    data = await needSport(sport)({ kind: "standings", league });
  }

  // Leagues with groups nest their table under `children`; a flat league puts
  // it at the top level.
  const groups: any[] = data?.children?.length ? data.children : [data];
  const rows: StandingRow[] = [];

  for (const group of groups) {
    for (const entry of group?.standings?.entries ?? []) {
      const stats = new Map<string, any>();
      for (const s of entry?.stats ?? []) stats.set(s.name, s);
      const value = (name: string) => num(stats.get(name)?.value) ?? 0;

      rows.push({
        rank: value("rank"),
        teamId: String(entry?.team?.id ?? ""),
        name: entry?.team?.displayName ?? "",
        shortName: entry?.team?.shortDisplayName ?? entry?.team?.abbreviation ?? "",
        logo: entry?.team?.logos?.[0]?.href ?? entry?.team?.logo,
        played: value("gamesPlayed"),
        wins: value("wins"),
        draws: value("ties"),
        losses: value("losses"),
        goalsFor: value("pointsFor"),
        goalsAgainst: value("pointsAgainst"),
        goalDiff: stats.get("pointDifferential")?.displayValue ?? String(value("pointDifferential")),
        points: value("points"),
      });
    }
  }

  // `rank` isn't always populated; points then goal difference is the
  // league's own ordering anyway.
  rows.sort((a, b) => b.points - a.points || Number(b.goalDiff) - Number(a.goalDiff));
  rows.forEach((row, i) => {
    if (!row.rank) row.rank = i + 1;
  });
  if (!canFetch() && sport) {
    const found = await withCrests(rows.map((row) => row.teamId), sport);
    for (const row of rows) row.logo = found.get(row.teamId) ?? row.logo;
  }
  return rows;
}

/** The sport service, or why there is none. */
function needSport(sport: SportCall | undefined): SportCall {
  if (!sport) throw new Error(NEEDS_INTEGRATION);
  return sport;
}

export const NEEDS_INTEGRATION =
  "Needs the GlassHome Artwork integration (1.4 or newer) in Home Assistant: Dash 1.5 lets widgets reach ESPN only through it.";

/** News from the feeds set in the integration's options, where there is no fetch. */
export async function fetchNews(
  sport: SportCall,
): Promise<{ items: NewsItem[]; failed: string[]; configured: boolean }> {
  const reply = await sport({ kind: "news" });
  const items: NewsItem[] = (reply?.items ?? []).map((item: any) => {
    const published = item?.published ? new Date(item.published) : undefined;
    return {
      title: String(item?.title ?? ""),
      link: String(item?.link ?? ""),
      published: published && !Number.isNaN(published.getTime()) ? published : undefined,
      source: String(item?.source ?? ""),
    };
  });
  return { items, failed: reply?.failed ?? [], configured: !!reply?.configured };
}

/** Loose match so "KSC", "Karlsruher" or the full name all resolve. */
export function isFavourite(team: TeamSide | StandingRow, favourite: string): boolean {
  const needle = favourite.trim().toLowerCase();
  if (!needle) return false;
  const hay = [
    team.name,
    team.shortName,
    (team as TeamSide).abbreviation ?? "",
  ]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return hay.some((h) => h === needle || h.includes(needle) || needle.includes(h));
}

export function matchInvolves(match: Match, favourite: string): boolean {
  return isFavourite(match.home, favourite) || isFavourite(match.away, favourite);
}

/**
 * What the tile should lead with: a live match wins, then a finished one
 * still inside the "keep showing the result" window, then the next fixture.
 */
export function pickFeatured(
  matches: Match[],
  favourite: string,
  resultDays = 2,
): Match | undefined {
  const mine = favourite ? matches.filter((m) => matchInvolves(m, favourite)) : matches;
  if (!mine.length) return undefined;

  const live = mine.find((m) => m.state === "in");
  if (live) return live;

  const now = Date.now();
  const cutoff = resultDays * 86_400_000;
  const recent = [...mine]
    .filter((m) => m.state === "post" && now - m.date.getTime() <= cutoff)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  if (recent) return recent;

  const next = mine.find((m) => m.state === "pre" && m.date.getTime() >= now - 3 * 3_600_000);
  return next ?? [...mine].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
}

/** Matches sharing the featured match's calendar weekend — the "Spieltag". */
export function matchdayFor(matches: Match[], featured: Match | undefined): Match[] {
  if (!matches.length) return [];
  const anchor = featured ?? matches[0]!;
  const anchorTime = anchor.date.getTime();
  // A Bundesliga matchday spans Fri–Mon; +/- 3 days catches it without
  // pulling in the neighbouring one.
  return matches
    .filter((m) => Math.abs(m.date.getTime() - anchorTime) <= 3 * 86_400_000)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * ESPN serves logos from `a.espncdn.com`. The dashboard's CSP may refuse a
 * cross-origin image (the media-player widget hit exactly this with cover
 * art), so an optional proxy template is honoured here using the same
 * convention that widget documents: `{url}` or `{hostpath}`.
 */
/**
 * The dashboard's accent lives on a `.dark`/`.light` wrapper div, and custom
 * properties don't inherit into a shadow root — so it has to be read out and
 * re-declared. Same approach the other widgets use.
 */
export function themeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const themeRoot = readThemeRoot();
  const primary = getComputedStyle(themeRoot).getPropertyValue("--primary").trim();
  const vars: Record<string, string> = primary ? { "--sc-primary": primary } : {};
  /* The live green, by theme: the bright one reads on a dark card and all
     but vanishes on a light one, where a deeper green keeps it legible. */
  const light = !isDarkTheme();
  vars["--sc-live"] = light ? "#15803d" : "#4ade80";
  return vars;
}

export function viaProxy(raw: string, proxyBase: string): string {
  const base = proxyBase.trim();
  /* A crest from the integration is a picture already, not an address. */
  if (!base || raw.startsWith("data:")) return raw;
  if (base.includes("{url}")) return base.replace("{url}", encodeURIComponent(raw));
  try {
    const u = new URL(raw);
    if (base.includes("{hostpath}")) {
      return base.replace("{hostpath}", `${u.host}${u.pathname}${u.search}`);
    }
    return `${trimSlashes(base)}${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

export function resolveLogo(raw: string | undefined, proxyBase: string): string | undefined {
  return raw ? viaProxy(raw, proxyBase) : undefined;
}

export function initials(name: string): string {
  const words = name.replaceAll(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  const skip = new Set(["fc", "sc", "sv", "vfl", "vfb", "tsv", "spvgg", "1", "the"]);
  const meaningful = words.filter((w) => !skip.has(w.toLowerCase()));
  const source = meaningful.length ? meaningful : words;
  return source.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

/**
 * RSS/Atom via the browser's own XML parser — no dependency, and the feeds
 * are small. Feeds must send CORS headers: kicker's does, but plenty don't
 * (sportschau, for one), so failures are reported per feed rather than
 * failing the whole tab.
 */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
  const items: NewsItem[] = [];

  for (const node of nodes) {
    const title = node.querySelector("title")?.textContent?.trim();
    if (!title) continue;

    const linkEl = node.querySelector("link");
    const link = linkEl?.textContent?.trim() || linkEl?.getAttribute("href") || "";
    const dateText =
      node.querySelector("pubDate")?.textContent ??
      node.querySelector("updated")?.textContent ??
      node.querySelector("published")?.textContent ??
      "";
    const published = dateText ? new Date(dateText) : undefined;

    items.push({
      title,
      link,
      published: published && !Number.isNaN(published.getTime()) ? published : undefined,
      source,
    });
  }
  return items;
}

export function feedLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\.|^newsfeed\./, "");
  } catch {
    return url;
  }
}

export function formatKickoff(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Live matches need frequent polling; everything else really doesn't. */
export function pollInterval(matches: Match[]): number {
  return matches.some((m) => m.state === "in") ? 60_000 : 15 * 60_000;
}

/**
 * Representative data for the widget gallery only.
 *
 * The preview harness and the Hub's render worker run with the network
 * blacklisted, so a live-data widget renders its error state there. Opted
 * into by `sampleData` in `manifest.examples[].config`, which is deliberately
 * absent from `configSchema` — the settings form can't offer it, so it can
 * never stand in for real data a user is missing.
 */
export function sampleMatches(): Match[] {
  const team = (
    id: string,
    name: string,
    shortName: string,
    abbreviation: string,
    score: number,
    homeAway: "home" | "away",
    rank: string,
  ): TeamSide => ({ id, name, shortName, abbreviation, score, homeAway, rank });

  const kickoff = new Date();
  kickoff.setHours(15, 30, 0, 0);

  return [
    {
      id: "sample-1",
      date: kickoff,
      state: "in",
      statusDetail: "90'+1'",
      venue: "BBBank Wildpark",
      home: team("1", "Karlsruher SC", "Karlsruher SC", "KSC", 2, "home", "3"),
      away: team("2", "VfL Wolfsburg", "VfL Wolfsburg", "WOB", 4, "away", "4"),
    },
    {
      id: "sample-2",
      date: shiftDays(kickoff, 0),
      state: "post",
      statusDetail: "FT",
      venue: "Voith-Arena",
      home: team("3", "1. FC Heidenheim", "Heidenheim", "HDH", 5, "home", "1"),
      away: team("4", "Dynamo Dresden", "Dresden", "SGD", 2, "away", "12"),
    },
    {
      id: "sample-3",
      date: shiftDays(kickoff, 1),
      state: "pre",
      statusDetail: "",
      venue: "Max-Morlock-Stadion",
      home: team("5", "1. FC Nürnberg", "Nürnberg", "FCN", 0, "home", "7"),
      away: team("6", "Arminia Bielefeld", "Bielefeld", "DSC", 0, "away", "9"),
    },
  ];
}

export function sampleStandings(): StandingRow[] {
  const rows: [string, string, number, number, number, number, number, number][] = [
    ["1. FC Heidenheim", "Heidenheim", 3, 3, 0, 0, 10, 4],
    ["Hertha Berlin", "Hertha", 3, 3, 0, 0, 8, 3],
    ["Karlsruher SC", "Karlsruher SC", 3, 2, 0, 1, 7, 6],
    ["VfL Wolfsburg", "Wolfsburg", 3, 2, 0, 1, 9, 5],
    ["1. FC Nürnberg", "Nürnberg", 3, 1, 1, 1, 5, 5],
    ["Arminia Bielefeld", "Bielefeld", 3, 1, 1, 1, 4, 4],
    ["Dynamo Dresden", "Dresden", 3, 0, 1, 2, 4, 9],
    ["VfL Osnabrück", "Osnabrück", 3, 0, 0, 3, 2, 8],
  ];
  return rows.map(([name, shortName, played, wins, draws, losses, gf, ga], i) => ({
    rank: i + 1,
    teamId: `sample-${i}`,
    name,
    shortName,
    played,
    wins,
    draws,
    losses,
    goalsFor: gf,
    goalsAgainst: ga,
    goalDiff: `${gf - ga > 0 ? "+" : ""}${gf - ga}`,
    points: wins * 3 + draws,
  }));
}

/**
 * `fetch` rejects with a bare "Failed to fetch" for anything network-level —
 * offline, DNS, CORS, a blocking CSP — which tells the user nothing about
 * what to do next.
 */
export function describeFetchError(err: unknown): string {
  if (!canFetch()) {
    return err instanceof Error && err.message === NEEDS_INTEGRATION
      ? NEEDS_INTEGRATION
      : `${errorMessage(err, "Could not load match data.")} — ${NEEDS_INTEGRATION}`;
  }
  if (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return "Blocked before the request left the browser — the dashboard's security policy only permits its own origin and Home Assistant. Set a proxy base in settings to route ESPN through a host it already trusts.";
  }
  return errorMessage(err, "Could not load match data.");
}
