import { Index, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { formatMs, headline, summarise, type Group, type Monitor } from "../uptime/model";
import { UptimePanel } from "../uptime/panel";
import { MonitorRow } from "../uptime/heartbeat";
import { GroupRow } from "../uptime/group";
import { uptimeVars } from "../uptime/styles";
import { openable } from "./util";
import { Half } from "./half";

/**
 * Uptime Kuma, on the board, drawn as the Uptime widget draws it.
 *
 * The room's monitors as one card: the verdict, how many are up and the
 * service's orb at the top, and under it the groups their Uptime Kuma tags
 * make — a line each, those in trouble first — or, where they carry no
 * tags, the monitors themselves. Tapping a group opens the overlay on it.
 * In the server room the card stands in the activity feed's column, as tall
 * as the board.
 */
const RANK = { down: 0, pending: 1, maintenance: 2, none: 3, up: 3 } as const;

export function UptimeCard(props: {
  monitors: Monitor[];
  groups: Group[];
  /** Told the group tapped, or null for the card as a whole. */
  onOpen: (group: number | null) => void;
  /** In the feed's column rather than among the tiles. */
  side?: boolean;
}) {
  const summary = createMemo(() => summarise(props.monitors));

  /* Whole lines only, as many as the card's height holds: cut off by the
     card's edge, the last one read as a rendering fault. */
  const [height, setHeight] = createSignal(0);
  const [rem, setRem] = createSignal(16);
  let rows: HTMLDivElement | undefined;
  onMount(() => {
    if (!rows || typeof ResizeObserver === "undefined") return;
    setRem(Number.parseFloat(getComputedStyle(rows).fontSize) || 16);
    const observer = new ResizeObserver(([entry]) => setHeight(entry?.contentRect.height ?? 0));
    observer.observe(rows);
    onCleanup(() => observer.disconnect());
  });
  /* A group line is 2.75rem, a monitor 2.5rem, the gap 0.4rem; the "+N
     more" line 1.3rem with its gap. */
  const fit = (count: number, line: number) => {
    const unit = (line + 0.4) * rem();
    if (count * unit - 0.4 * rem() <= height()) return count;
    return Math.max(0, Math.floor((height() - 1.3 * rem()) / unit));
  };

  const grouped = () => props.groups.length > 0;
  const groupRows = createMemo(() => {
    const all = props.groups.map((group, index) => ({ group, index }));
    const room = fit(all.length, 2.75);
    if (room >= all.length) return { rows: all, more: 0 };
    /* Not all fit: the trouble first, so it is never what "+N more" hides. */
    const ranked = [...all].sort(
      (a, b) => RANK[summarise(a.group.monitors).verdict] - RANK[summarise(b.group.monitors).verdict] || a.index - b.index,
    );
    return { rows: ranked.slice(0, room), more: all.length - room };
  });
  const monitorRows = createMemo(() => {
    const room = fit(props.monitors.length, 2.5);
    return { rows: props.monitors.slice(0, room), more: props.monitors.length - Math.min(room, props.monitors.length) };
  });

  return (
    <article
      class="rb-card rb-card--uptime"
      classList={{ "rb-card--uptime-side": props.side === true }}
      data-verdict={summary().verdict}
      style={uptimeVars()}
      {...openable(() => props.onOpen(null), "Uptime Kuma")}
    >
      <header class="rb-up-head">
        <span class="up-orb" data-status={summary().verdict} aria-hidden="true" />
        <div class="rb-up-titles">
          <h3 class="rb-truncate">{headline(summary())}</h3>
          <span class="rb-truncate">
            Uptime Kuma
            <Show when={summary().avgMs}> · {formatMs(summary().avgMs)}</Show>
          </span>
        </div>
        <span class="rb-up-count">
          {summary().up}
          <i>/{summary().total}</i>
        </span>
      </header>

      <div ref={rows} class="rb-up-rows">
        <Show
          when={grouped()}
          fallback={
            <>
              <Index each={monitorRows().rows}>{(monitor) => <MonitorRow monitor={monitor()} />}</Index>
              <Show when={monitorRows().more > 0}>
                <span class="up-more">+{monitorRows().more} more</span>
              </Show>
            </>
          }
        >
          {/* Each group a button of its own, opening the overlay on it; the
              card round them opens it on all. */}
          <Index each={groupRows().rows}>
            {(row) => (
              <button
                type="button"
                class="rb-up-group"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpen(row().index);
                }}
              >
                <GroupRow group={row().group} index={row().index} />
              </button>
            )}
          </Index>
          <Show when={groupRows().more > 0}>
            <span class="up-more">+{groupRows().more} more groups</span>
          </Show>
        </Show>
      </div>
      <Half icon="mdi:heart-pulse" name="Uptime" status={summary().down ? `${summary().down} down` : "All up"} tone={summary().down ? "#ef4444" : "#22c55e"} lit={summary().down > 0} value={`${summary().up}/${summary().total}`} />
    </article>
  );
}

/**
 * The server room's card on a phone: a bar along the foot, as the activity
 * feed has there — the service's state as a dot, the verdict and what is
 * wrong (or how many are up), and the way into the overlay.
 */
export function UptimeBar(props: { monitors: Monitor[]; onOpen: () => void }) {
  const summary = createMemo(() => summarise(props.monitors));
  const trouble = () => props.monitors.filter((m) => m.status === "down" || m.status === "pending");
  /* What is wrong, by name — or, when nothing is, the service and its time. */
  const barNote = () => {
    if (trouble().length) return trouble().map((m) => m.name).join(", ");
    const avg = summary().avgMs;
    return avg ? `Uptime Kuma · ${formatMs(avg)}` : "Uptime Kuma";
  };
  return (
    <button class="rb-act-bar rb-up-bar" style={uptimeVars()} data-status={summary().verdict} onClick={props.onOpen}>
      <span class="rb-up-bar-dot" data-status={summary().verdict} />
      <span class="rb-act-bar-text rb-truncate">
        <b>{headline(summary())}</b>
        <span>
          {barNote()}
        </span>
      </span>
      <span class="rb-up-bar-count">
        {summary().up}
        <i>/{summary().total}</i>
      </span>
      <Icon icon="mdi:chevron-up" width="17" />
    </button>
  );
}

/** The overlay: the Uptime widget's panel, in the board's colours. */
export function UptimeBoardPanel(props: { monitors: Monitor[]; groups?: Group[]; open?: { group: number | null } }) {
  return (
    <div class="rb-up-panel" style={uptimeVars()}>
      <UptimePanel monitors={props.monitors} groups={props.groups} open={props.open} />
    </div>
  );
}
