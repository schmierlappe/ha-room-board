import { artSrc } from "../artwork";
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { Icon, useService } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { resolveArtwork } from "../media-player/cover";
import { attr, openable } from "./util";
/* The football widget's own matchday, table and news views, reused as they
   are — the same data from the same ESPN endpoints, so one place to fix. */
import { Panels as FootballPanels } from "../soccer/panels";
import {
  NEEDS_INTEGRATION,
  canFetch,
  fetchScoreboard,
  fetchStandings,
  sportService,
  matchdayFor,
  pickFeatured,
  pollInterval,
  type Match,
  type StandingRow,
} from "../soccer/util";

/**
 * A team's next, live or last match, from the TeamTracker integration
 * (HACS: vasqued2/ha-teamtracker). One sensor per team; the sensor keeps the
 * fixture up to date through Home Assistant — ESPN's data, polled faster
 * while the match is on — so the card needs no feed of its own.
 */

/** A TeamTracker sensor: a sport, a team and ESPN's event, all as attributes. */
export const looksLikeTeamTracker = (entity: EntityView) =>
  entity.domain === "sensor" &&
  typeof entity.attributes?.sport === "string" &&
  "team_abbr" in (entity.attributes ?? {}) &&
  "opponent_abbr" in (entity.attributes ?? {});

type Side = {
  name: string;
  abbr: string;
  logo?: string;
  colour?: string;
  score?: string;
  winner: boolean;
};

const side = (entity: EntityView, who: "team" | "opponent"): Side => {
  const colours = attr<string[] | null>(entity, `${who}_colors`, null);
  const score = attr<string | number | null>(entity, `${who}_score`, null);
  return {
    name: attr<string>(entity, `${who}_name`, "") || attr<string>(entity, `${who}_abbr`, ""),
    abbr: attr<string>(entity, `${who}_abbr`, ""),
    logo: attr<string | undefined>(entity, `${who}_logo`, undefined) ?? undefined,
    colour: Array.isArray(colours) ? colours[0] : undefined,
    score: score === null || score === undefined || score === "" ? undefined : String(score),
    winner: attr<boolean>(entity, `${who}_winner`, false),
  };
};

/** Kick-off as a person says it: today's time, a weekday this week, or the date. */
function kickoff(raw: string): { day: string; time: string } {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { day: "", time: "" };
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(date) - start(new Date())) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  let day = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (days === 0) day = "Today";
  else if (days === 1) day = "Tomorrow";
  else if (days > 1 && days < 7) day = date.toLocaleDateString(undefined, { weekday: "long" });
  return { day, time };
}

function Crest(props: { side: Side; proxy: string; haBase: string }) {
  const [failed, setFailed] = createSignal(false);
  const url = () => artSrc(resolveArtwork(props.side.logo, props.proxy, props.haBase));
  return (
    <span class="rb-sport-crest" style={{ "--rb-team": props.side.colour ?? "#64748b" }}>
      <Show
        when={url() && !failed()}
        fallback={<b class="rb-sport-initials">{props.side.abbr.slice(0, 3)}</b>}
      >
        <img src={url()} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />
      </Show>
    </span>
  );
}

/** Football only: the overlay's matchday, table and news are ESPN's soccer feeds. */
export const isFootball = (entity: EntityView) =>
  attr<string>(entity, "sport_path", attr<string>(entity, "sport", "")) === "soccer";

export function SportCard(props: {
  entity: EntityView;
  proxy: string;
  haBase: string;
  onOpen?: () => void;
}) {
  const state = () => String(props.entity.state ?? "").toUpperCase();
  const live = () => state() === "IN";
  const done = () => state() === "POST";
  const pre = () => state() === "PRE";

  const us = () => side(props.entity, "team");
  const them = () => side(props.entity, "opponent");
  /* Home on the left, the way a fixture is written. */
  const weAreHome = () => attr<string>(props.entity, "team_homeaway", "home") !== "away";
  const left = () => (weAreHome() ? us() : them());
  const right = () => (weAreHome() ? them() : us());

  const league = () => attr<string>(props.entity, "league_name", "");
  const venue = () => attr<string>(props.entity, "venue", "");
  const when = () => kickoff(attr<string>(props.entity, "date", ""));
  const clock = () => attr<string>(props.entity, "clock", "");

  /* The chip: the minute while it is on, the result once it is over, the
     kick-off before. */
  const chip = () => {
    if (live()) return clock() || "Live";
    if (done()) {
      if (us().winner) return "Won";
      if (them().winner) return "Lost";
      return "Full time";
    }
    /* How far off, in TeamTracker's own words ("in a week", "tomorrow") —
       the day and time are written large already. */
    if (pre()) return attr<string>(props.entity, "kickoff_in", "") || "Next match";
    if (state() === "BYE") return "No match";
    return "No fixture";
  };

  const hasMatch = () => live() || done() || pre();
  /* A finished match, from our side. */
  const result = () => {
    if (!done()) return undefined;
    if (us().winner) return "won";
    return them().winner ? "lost" : "draw";
  };

  return (
    <article
      class="rb-card rb-card--sport"
      data-card={`sport:${props.entity.id}`}
      data-state={state().toLowerCase()}
      data-result={result()}
      data-open={!!props.onOpen}
      {...(props.onOpen ? openable(props.onOpen, "Match") : {})}
    >
      {/* Big only: both clubs' crests, large and faded, behind the fixture —
          each on its own side, reaching past the card's edge. */}
      <Show when={hasMatch()}>
        <div class="rb-sport-bg" aria-hidden="true">
          <Show when={artSrc(resolveArtwork(left().logo, props.proxy, props.haBase))}>
            {(url) => <img class="rb-sport-bg-left" src={url()} alt="" draggable={false} />}
          </Show>
          <Show when={artSrc(resolveArtwork(right().logo, props.proxy, props.haBase))}>
            {(url) => <img class="rb-sport-bg-right" src={url()} alt="" draggable={false} />}
          </Show>
        </div>
      </Show>

      <header class="rb-card-head rb-sport-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">{props.entity.friendlyName ?? us().name}</h3>
          <span class="rb-card-verdict rb-truncate">{league()}</span>
        </div>
        <span class="rb-sport-chip">
          <Show when={live()}>
            <i class="rb-sport-live" />
          </Show>
          {chip()}
        </span>
      </header>

      <Show
        when={hasMatch()}
        fallback={
          <p class="rb-sport-none">
            <Icon icon="mdi:soccer" width="18" />
            {state() === "BYE" ? "Nothing scheduled this round." : "No upcoming match found."}
          </p>
        }
      >
        <div class="rb-sport-fixture">
          <div class="rb-sport-side">
            <Crest side={left()} proxy={props.proxy} haBase={props.haBase} />
            <span class="rb-sport-name rb-truncate" data-us={left() === us()}>
              {left().name}
            </span>
          </div>

          <div class="rb-sport-mid">
            <Show
              when={!pre()}
              fallback={
                <>
                  <b class="rb-sport-time">{when().time}</b>
                  <small>{when().day}</small>
                </>
              }
            >
              <b class="rb-sport-score">
                {left().score ?? "0"}
                <i>:</i>
                {right().score ?? "0"}
              </b>
            </Show>
          </div>

          <div class="rb-sport-side">
            <Crest side={right()} proxy={props.proxy} haBase={props.haBase} />
            <span class="rb-sport-name rb-truncate" data-us={right() === us()}>
              {right().name}
            </span>
          </div>
        </div>

        <Show when={venue()}>
          <span class="rb-sport-venue rb-truncate">
            <Icon icon="mdi:stadium-variant" width="13" />
            {venue()}
          </span>
        </Show>
      </Show>
    </article>
  );
}

/* News for a league, from kicker — the feed the football widget suggests —
   by ESPN's league code; anything else gets kicker's general football news. */
const KICKER: Record<string, string> = {
  "ger.1": "bundesliga",
  "ger.2": "2bundesliga",
  "ger.3": "3liga",
  "ger.dfb_pokal": "dfb-pokal",
  "eng.1": "premier-league",
  "esp.1": "la-liga",
  "ita.1": "serie-a",
  "fra.1": "ligue-1",
  "uefa.champions": "champions-league",
  "uefa.europa": "europa-league",
};

const feedFor = (league: string) =>
  `https://newsfeed.kicker.de/news/${KICKER[league] ?? "fussball"}`;

/**
 * The match card's overlay: the whole matchday of the team's league, the
 * table, and the league's news — the football widget's three views, for the
 * league the sensor's team plays in, with that team picked out.
 */
export function MatchPanel(props: { entity: EntityView; proxy: string }) {
  const league = () => attr<string>(props.entity, "league_path", "");
  const favourite = () =>
    attr<string>(props.entity, "team_long_name", "") || attr<string>(props.entity, "team_abbr", "");

  const [matches, setMatches] = createSignal<Match[]>([]);
  const [standings, setStandings] = createSignal<StandingRow[]>([]);
  const [error, setError] = createSignal<string | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /* ESPN through the GlassHome Artwork integration, where there is no fetch. */
  const sport = sportService(useService().callService);

  const load = async (code: string) => {
    clearTimeout(timer);
    if (!code) return;
    try {
      const board = await fetchScoreboard(code, props.proxy, sport);
      setMatches(board.matches);
      setError(undefined);
    } catch {
      if (!canFetch()) setError(NEEDS_INTEGRATION);
      else
        setError(
          props.proxy
            ? "The matchday could not be loaded through the artwork proxy."
            : "The matchday needs the artwork proxy (Settings) to reach ESPN.",
        );
    }
    try {
      setStandings(await fetchStandings(code, props.proxy, sport));
    } catch {
      setStandings([]);
    }
    /* Faster while a match is on, as the football widget does. */
    timer = setTimeout(() => void load(code), pollInterval(matches()));
  };

  createEffect(on(league, (code) => void load(code)));
  onCleanup(() => clearTimeout(timer));

  const matchday = () => matchdayFor(matches(), pickFeatured(matches(), favourite(), 3));

  return (
    <div class="rb-match-panel">
      <FootballPanels
        matchday={matchday()}
        standings={standings()}
        favourite={favourite()}
        proxyBase={props.proxy}
        feeds={[feedFor(league())]}
        sport={sport}
        error={error()}
      />
    </div>
  );
}

/* ---------- the match bar ----------
 *
 * On game day, on a phone, the match rides in the bar at the foot of the
 * screen with the activity line: the score live while it is on, the kick-off
 * before, the result after — in whichever room you are, since a match is the
 * house's news rather than a room's. */

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Playing now, or kicking off or finished today. */
export const gameDay = (entity: EntityView, now = new Date()) => {
  const state = String(entity.state ?? "").toUpperCase();
  if (state === "IN") return true;
  if (state !== "PRE" && state !== "POST") return false;
  const date = new Date(attr<string>(entity, "date", ""));
  return !Number.isNaN(date.getTime()) && sameDay(date, now);
};

/** The one match the bar shows: a live one first, then the next to kick off, then the last to end. */
export const barMatch = (teams: EntityView[], now = new Date()) => {
  const today = teams.filter((team) => gameDay(team, now));
  const order = (team: EntityView) => ({ IN: 0, PRE: 1, POST: 2 })[String(team.state).toUpperCase()] ?? 3;
  return today.sort((a, b) => order(a) - order(b))[0];
};

export function MatchBar(props: { entity: EntityView; proxy: string; haBase: string; onOpen?: () => void }) {
  const state = () => String(props.entity.state ?? "").toUpperCase();
  const live = () => state() === "IN";
  const done = () => state() === "POST";
  const us = () => side(props.entity, "team");
  const them = () => side(props.entity, "opponent");
  const weAreHome = () => attr<string>(props.entity, "team_homeaway", "home") !== "away";
  const left = () => (weAreHome() ? us() : them());
  const right = () => (weAreHome() ? them() : us());
  const clock = () => attr<string>(props.entity, "clock", "");
  const when = () => kickoff(attr<string>(props.entity, "date", ""));
  const result = () => {
    if (!done()) return undefined;
    if (us().winner) return "won";
    return them().winner ? "lost" : "draw";
  };

  /* A goal: the score lights up for a few seconds when it changes while the
     match is on — the one moment worth catching from across the room. */
  const [goal, setGoal] = createSignal(false);
  let goalTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(goalTimer));
  createEffect(
    on(
      () => `${left().score ?? ""}:${right().score ?? ""}`,
      () => {
        if (!live()) return;
        setGoal(true);
        clearTimeout(goalTimer);
        goalTimer = setTimeout(() => setGoal(false), 6000);
      },
      { defer: true },
    ),
  );

  const status = () => {
    if (live()) return clock() || "Live";
    if (done()) return result() === "won" ? "Won" : result() === "lost" ? "Lost" : "Full time";
    return when().time;
  };

  return (
    <button
      class="rb-matchbar"
      data-state={state().toLowerCase()}
      data-result={result()}
      data-goal={goal()}
      aria-label={`${left().name} ${left().score ?? ""} ${right().name} ${right().score ?? ""}, ${status()}`}
      onClick={() => props.onOpen?.()}
    >
      <span class="rb-matchbar-status">
        <Show when={live()} fallback={<Icon icon={done() ? "mdi:flag-checkered" : "mdi:soccer"} width="13" />}>
          <i class="rb-sport-live" />
        </Show>
        <span>{status()}</span>
      </span>

      <span class="rb-matchbar-fixture">
        <span class="rb-matchbar-side" data-us={left() === us()}>
          <span class="rb-truncate">{left().abbr || left().name}</span>
          <Crest side={left()} proxy={props.proxy} haBase={props.haBase} />
        </span>
        <Show when={state() !== "PRE"} fallback={<span class="rb-matchbar-vs">vs</span>}>
          <b class="rb-matchbar-score">
            {left().score ?? "0"}
            <i>:</i>
            {right().score ?? "0"}
          </b>
        </Show>
        <span class="rb-matchbar-side" data-us={right() === us()}>
          <Crest side={right()} proxy={props.proxy} haBase={props.haBase} />
          <span class="rb-truncate">{right().abbr || right().name}</span>
        </span>
      </span>

      <Icon class="rb-matchbar-caret" icon="mdi:chevron-up" width="16" />
    </button>
  );
}
