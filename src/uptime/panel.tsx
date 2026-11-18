import { Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { MonitorRow } from "./heartbeat";
import { GroupRow } from "./group";
import { formatMs, headline, summarise, type Group, type Monitor, type Status } from "./model";

/**
 * Every monitor, in full: the popup of the Uptime widget, and the room
 * board's Uptime overlay.
 *
 * At the top a card for the state of what is shown — tinted by it, the
 * headline, and how many are up, down, pending and in maintenance as large
 * numbers. With groups, tabs above it: "All", or one group alone, the one
 * tapped on the card. "All" lists only what needs attention, in full, and
 * the groups a line each; a group lists its monitors. A search across them
 * all, for when there are more than a screen holds.
 */
export function UptimePanel(props: {
  monitors: Monitor[];
  groups?: Group[];
  /** The group to open on; a fresh object each time the card is tapped, so
      tapping the same group again still brings it back. */
  open?: { group: number | null };
}) {
  const groups = () => props.groups ?? [];
  const [selected, setSelected] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal("");
  createEffect(() => {
    const open = props.open;
    if (!open) return;
    setSelected(open.group !== null && open.group < groups().length ? open.group : null);
    setQuery("");
  });

  /* The chosen tab kept in sight: opened on a group far along the row, its
     tab was scrolled out of view. Only the row scrolls, not the popup. */
  let tabs: HTMLDivElement | undefined;
  createEffect(() => {
    selected();
    requestAnimationFrame(() => {
      const tab = tabs?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tabs || !tab) return;
      /* Measured against the row itself: offsetLeft counts from the nearest
         positioned ancestor, which is not the row, and over-scrolled it. */
      const start = tab.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
      const left = start - (tabs.clientWidth - tab.offsetWidth) / 2;
      /* scrollLeft, not scrollTo(): the sealed engine of Dash 1.5 lets a
         widget set the scroll but has no scrollTo. The row's own
         scroll-behavior makes it glide. */
      tabs.scrollLeft = Math.max(0, left);
    });
  });

  const current = () => {
    const index = selected();
    return index === null ? undefined : groups()[index];
  };
  const scope = () => current()?.monitors ?? props.monitors;
  const summary = createMemo(() => summarise(scope()));
  const trouble = createMemo(() => props.monitors.filter((m) => m.status !== "up" && m.status !== "maintenance"));

  /* The search looks through what the tab shows: a group's monitors, or all. */
  const found = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return undefined;
    return scope().filter((m) => m.name.toLowerCase().includes(q) || (m.url ?? "").toLowerCase().includes(q));
  });

  const STATS: { status: Exclude<Status, "unknown">; label: string }[] = [
    { status: "up", label: "Up" },
    { status: "down", label: "Down" },
    { status: "pending", label: "Pending" },
    { status: "maintenance", label: "Maint." },
  ];

  return (
    <div class="up-panel">
      <Show when={groups().length}>
        <div class="up-tabs" role="tablist" ref={tabs}>
          <button
            type="button"
            class="up-tab"
            role="tab"
            aria-selected={selected() === null}
            data-status={summarise(props.monitors).verdict}
            onClick={() => setSelected(null)}
          >
            <i />All<em>{props.monitors.length}</em>
          </button>
          <Index each={groups()}>
            {(group, index) => (
              <button
                type="button"
                class="up-tab"
                role="tab"
                aria-selected={selected() === index}
                data-status={summarise(group().monitors).verdict}
                style={{ "--up-hue": group().hue }}
                onClick={() => setSelected(index)}
              >
                <span class="up-tab-icon">
                  <Icon icon={group().icon} width="12" />
                </span>
                {group().name}
                <em>{group().monitors.length}</em>
              </button>
            )}
          </Index>
        </div>
      </Show>

      {/* The state of what is shown, as a card of its own. */}
      <header class="up-hero" data-status={summary().verdict}>
        <div class="up-hero-top">
          <Show
            when={current()}
            fallback={<span class="up-orb" data-status={summary().verdict} aria-hidden="true" />}
          >
            <span class="up-hero-icon" style={{ "--up-hue": current()!.hue }}>
              <Icon icon={current()!.icon} width="24" />
            </span>
          </Show>
          <div class="up-hero-titles">
            <span class="up-hero-kicker up-truncate">{current()?.name ?? "All monitors"}</span>
            <h3 class="up-truncate">{headline(summary())}</h3>
            <span class="up-hero-sub">
              {summary().up} of {summary().total} up
              <Show when={summary().avgMs}> · {formatMs(summary().avgMs)} average</Show>
            </span>
          </div>
        </div>
        <div class="up-stats">
          <Index each={STATS}>
            {(stat) => (
              <span class="up-stat" data-status={stat().status} data-zero={summary()[stat().status] === 0}>
                <b>{summary()[stat().status]}</b>
                <span>{stat().label}</span>
              </span>
            )}
          </Index>
        </div>
      </header>

      <Show when={props.monitors.length > 6}>
        <label class="up-search">
          <Icon icon="mdi:magnify" width="18" />
          <input
            type="search"
            placeholder={current() ? `Search ${current()!.name}` : `Search ${props.monitors.length} monitors`}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <Show when={query()}>
            <button type="button" aria-label="Clear" onClick={() => setQuery("")}>
              <Icon icon="mdi:close-circle" width="16" />
            </button>
          </Show>
        </label>
      </Show>

      <Show
        when={props.monitors.length}
        fallback={
          <p class="up-empty">
            No Uptime Kuma monitors found. Add the Uptime Kuma integration in Home Assistant, or
            pick the monitors' status sensors in the settings.
          </p>
        }
      >
        <Show
          when={!found() && groups().length && selected() === null}
          fallback={
            <Show
              when={(found() ?? scope()).length}
              fallback={<p class="up-empty">{found() ? "Nothing matches." : "No monitors in this group."}</p>}
            >
              <div class="up-lines">
                {/* By position: rows keyed on the monitor objects, rebuilt on
                    every update, redrew their heartbeat each time. */}
                <Index each={found() ?? scope()}>{(monitor) => <MonitorRow monitor={monitor()} detail />}</Index>
              </div>
            </Show>
          }
        >
          {/* "All", with groups: what needs attention, in full, and then each
              group as one line — its monitors one tap away. With a hundred and
              more monitors the full list was a long scroll. */}
          <Show
            when={trouble().length}
            fallback={
              <div class="up-calm">
                <Icon icon="mdi:check-decagram" width="20" />Nothing needs attention
              </div>
            }
          >
            <section class="up-section">
              <span class="up-section-title">Needs attention</span>
              <div class="up-lines">
                <Index each={trouble()}>{(monitor) => <MonitorRow monitor={monitor()} detail />}</Index>
              </div>
            </section>
          </Show>
          <section class="up-section">
            <span class="up-section-title">Groups</span>
            <div class="up-group-grid">
              <Index each={groups()}>
                {(group, index) => (
                  <button type="button" class="up-group-pick" onClick={() => setSelected(index)}>
                    <GroupRow group={group()} index={index} />
                  </button>
                )}
              </Index>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}
