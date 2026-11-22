import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { Crest } from "./crest";
import { canFetch, feedLabel, fetchNews, formatRelative, isFavourite, matchInvolves, parseFeed, viaProxy, type Match, type NewsItem, type SportCall, type StandingRow, themeVars } from "./util";
import { skinDialog } from "./dialog-skin";

type Tab = "matchday" | "table" | "news";

function MatchdayTab(props: { matches: Match[]; favourite: string; proxyBase: string }) {
  return (
    <Show
      when={props.matches.length}
      fallback={<div class="sc-note">No fixtures found for this matchday.</div>}
    >
      <div class="sc-list">
        <For each={props.matches}>
          {(match) => (
            <div class="sc-fixture" data-fav={matchInvolves(match, props.favourite)}>
              <div class="sc-fixture-side">
                <Crest
                  name={match.home.name}
                  logo={match.home.logo}
                  proxyBase={props.proxyBase}
                  class="sc-crest--sm"
                />
                <span class="sc-fixture-name sc-truncate">{match.home.name}</span>
              </div>

              <div class="sc-fixture-score" data-state={match.state}>
                {match.state === "pre"
                  ? match.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                  : `${match.home.score ?? 0} : ${match.away.score ?? 0}`}
              </div>

              <div class="sc-fixture-side" data-align="right">
                <span class="sc-fixture-name sc-truncate">{match.away.name}</span>
                <Crest
                  name={match.away.name}
                  logo={match.away.logo}
                  proxyBase={props.proxyBase}
                  class="sc-crest--sm"
                />
              </div>

              <div class="sc-fixture-time">
                {match.state === "in"
                  ? match.statusDetail
                  : match.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
              </div>

              {/* Who scored, under each side's name, in the order they did. */}
              <Show when={match.state !== "pre" && match.goals?.length}>
                <div class="sc-goals">
                  <For each={(["home", "away"] as const)}>
                    {(which) => (
                      <ul class="sc-goals-side" data-align={which === "away" ? "right" : undefined}>
                        <For each={match.goals!.filter((goal) => goal.side === which)}>
                          {(goal) => (
                            <li>
                              <Icon icon="mdi:soccer" width="10" />
                              <span class="sc-truncate">{goal.player || "Goal"}</span>
                              <b>{goal.minute}</b>
                              <Show when={goal.penalty}>
                                <i>(P)</i>
                              </Show>
                              <Show when={goal.own}>
                                <i>(OG)</i>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Top two promote, third plays off; bottom two drop, 16th plays off. */
function band(rank: number, total: number): string | undefined {
  if (rank <= 2) return "up";
  if (rank === 3) return "playoff";
  if (rank > total - 2) return "down";
  if (rank === total - 2) return "playoff";
  return undefined;
}

function TableTab(props: { rows: StandingRow[]; favourite: string; proxyBase: string }) {
  return (
    <Show
      when={props.rows.length}
      fallback={<div class="sc-note">Standings aren't available for this league.</div>}
    >
      <div class="sc-table">
        <div class="sc-row sc-row--head">
          <span class="sc-num">#</span>
          <span>Team</span>
          <span class="sc-num">P</span>
          <span class="sc-num sc-col-opt">W</span>
          <span class="sc-num sc-col-opt">D</span>
          <span class="sc-num sc-col-opt">L</span>
          <span class="sc-num">GD</span>
          <span class="sc-num">Pts</span>
        </div>
        <For each={props.rows}>
          {(row) => (
            <div class="sc-row" data-fav={isFavourite(row, props.favourite)}>
              <span class="sc-rank" data-band={band(row.rank, props.rows.length)}>
                {row.rank}
              </span>
              <span class="sc-row-team">
                <Crest
                  name={row.name}
                  logo={row.logo}
                  proxyBase={props.proxyBase}
                  class="sc-crest--sm"
                />
                <span class="sc-truncate">{row.name || row.shortName}</span>
              </span>
              <span class="sc-num sc-dim">{row.played}</span>
              <span class="sc-num sc-dim sc-col-opt">{row.wins}</span>
              <span class="sc-num sc-dim sc-col-opt">{row.draws}</span>
              <span class="sc-num sc-dim sc-col-opt">{row.losses}</span>
              <span class="sc-num sc-dim">{row.goalDiff}</span>
              <span class="sc-num sc-num--pts">{row.points}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function NewsTab(props: { feeds: string[]; proxyBase: string; sport?: SportCall }) {
  const [items, setItems] = createSignal<NewsItem[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  /* Where there is no fetch (Dash 1.5), the news comes from the feeds set in
     the GlassHome Artwork integration's options; none set, it says so. */
  const [unset, setUnset] = createSignal(false);

  /**
   * Feeds go through the same proxy as the score data: the dashboard's CSP
   * blocks any origin but its own and Home Assistant, so even a CORS-open
   * feed like kicker's can't be read directly. A URL already pointing at the
   * proxy host is left alone so it isn't wrapped twice.
   */
  const feedUrl = (raw: string) => {
    const base = props.proxyBase.trim();
    if (!base) return raw;
    try {
      if (new URL(raw).host === new URL(base.replaceAll(/\{[a-z]+\}/g, "")).host) return raw;
    } catch {
      /* fall through and proxy it */
    }
    return viaProxy(raw, base);
  };

  /* Dash 1.5: the integration's feeds, read and parsed in Home Assistant. */
  createEffect(() => {
    if (canFetch()) return;
    const sport = props.sport;
    if (!sport) return;
    let cancelled = false;
    setLoading(true);
    onCleanup(() => {
      cancelled = true;
    });
    void fetchNews(sport)
      .then((news) => {
        if (cancelled) return;
        setItems(news.items);
        setErrors(news.failed);
        setUnset(!news.configured);
      })
      .catch(() => {
        if (!cancelled) setErrors(["the GlassHome Artwork integration"]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  });

  createEffect(() => {
    if (!canFetch()) return;
    const feeds = props.feeds.filter(Boolean);
    if (!feeds.length) {
      setItems([]);
      setErrors([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    onCleanup(() => {
      cancelled = true;
    });

    void (async () => {
      const collected: NewsItem[] = [];
      const failed: string[] = [];

      // Settled individually: a feed that refuses cross-origin reads (many
      // do — sportschau sends no CORS header at all) shouldn't take the
      // working ones down with it.
      await Promise.all(
        feeds.map(async (url) => {
          try {
            const response = await fetch(feedUrl(url));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            collected.push(...parseFeed(await response.text(), feedLabel(url)));
          } catch {
            failed.push(feedLabel(url));
          }
        }),
      );

      if (cancelled) return;
      collected.sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0));
      setItems(collected.slice(0, 40));
      setErrors(failed);
      setLoading(false);
    })();
  });

  return (
    <div class="sc-news">
      <Show when={loading() && !items().length}>
        <div class="sc-loading">Loading news…</div>
      </Show>

      <Show when={errors().length}>
        <div class="sc-note" data-error="true">
          <Icon icon="mdi:alert-circle-outline" width="15" />
          <span>
            <Show
              when={canFetch()}
              fallback={<>Couldn't read {errors().join(", ")}.</>}
            >
              Couldn't read {errors().join(", ")}. Most feeds need the proxy base set in settings —
              the dashboard's security policy blocks requests to any other origin.
            </Show>
          </span>
        </div>
      </Show>

      <Show when={canFetch() && !props.feeds.some(Boolean)}>
        <div class="sc-note">Add one or more RSS feed URLs in settings.</div>
      </Show>
      <Show when={!canFetch() && unset()}>
        <div class="sc-note">
          Add news feeds in Home Assistant: Settings → Devices &amp; services → GlassHome Artwork →
          Configure. Dash 1.5 lets widgets read feeds only through it.
        </div>
      </Show>

      <For each={items()}>
        {(item) => (
          <a class="sc-news-item" href={item.link} target="_blank" rel="noopener noreferrer">
            <span class="sc-news-title">{item.title}</span>
            <span class="sc-news-meta">
              <span>{item.source}</span>
              <Show when={item.published}>
                <span>·</span>
                <span>{formatRelative(item.published!)}</span>
              </Show>
            </span>
          </a>
        )}
      </For>
    </div>
  );
}

/**
 * Rendered inside WidgetDialog's `controlsContent` rather than the `tabs`
 * prop: custom `tabs` replaces the host's own tab bar and takes the
 * schema-driven settings tab with it.
 *
 * Styles are injected here as well as in the tile, because the dialog renders
 * in a portal outside the widget's shadow root.
 */
export function Panels(props: {
  matchday: Match[];
  standings: StandingRow[];
  favourite: string;
  proxyBase: string;
  feeds: string[];
  /** ESPN and the news through the GlassHome Artwork integration (Dash 1.5). */
  sport?: SportCall;
  error?: string;
}) {
  const [tab, setTab] = createSignal<Tab>("matchday");

  const items: { id: Tab; label: string; icon: string }[] = [
    { id: "matchday", label: "Matchday", icon: "mdi:calendar-month-outline" },
    { id: "table", label: "Table", icon: "mdi:format-list-numbered" },
    { id: "news", label: "News", icon: "mdi:newspaper-variant-outline" },
  ];

  /* The popup wears the dashboard's own background, without the glass
     rim — see dialog-skin.ts for why it cannot be done in CSS. */
  let dialogRoot: HTMLDivElement | undefined;
  onMount(() => skinDialog(dialogRoot));

  return (
    <div ref={dialogRoot} class="sc-panel" style={themeVars()}>

      <nav class="sc-nav">
        <For each={items}>
          {(item) => (
            <button data-active={tab() === item.id} onClick={() => setTab(item.id)}>
              <Icon icon={item.icon} width="14" />
              <span>{item.label}</span>
            </button>
          )}
        </For>
      </nav>

      <Show when={props.error}>
        <div class="sc-note" data-error="true">
          <Icon icon="mdi:alert-circle-outline" width="15" />
          <span>{props.error}</span>
        </div>
      </Show>

      <Show when={tab() === "matchday"}>
        <MatchdayTab
          matches={props.matchday}
          favourite={props.favourite}
          proxyBase={props.proxyBase}
        />
      </Show>
      <Show when={tab() === "table"}>
        <TableTab rows={props.standings} favourite={props.favourite} proxyBase={props.proxyBase} />
      </Show>
      <Show when={tab() === "news"}>
        <NewsTab feeds={props.feeds} proxyBase={props.proxyBase} sport={props.sport} />
      </Show>
    </div>
  );
}
