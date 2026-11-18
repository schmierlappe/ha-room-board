import { Show, createMemo, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { kindOf } from "./openings";
import { looksLikeTeamTracker } from "./sport";
import { numeric, safeIcon } from "./util";

/** Why the board draws no card for a sensor, or nothing when it does. */
function skipReason(entity: EntityView): string {
  if (entity.domain !== "sensor") return "";
  if (entity.entityCategory) return `Not on the board: marked ${entity.entityCategory} in Home Assistant`;
  if (entity.isHidden) return "Not on the board: hidden in Home Assistant";
  if (numeric(entity) === undefined)
    return `Not on the board: no number right now (${entity.state || "empty"})`;
  return "";
}
import { Keyed } from "./keyed";

/** What each domain is called and what it looks like in the list. */
const DOMAINS: Record<string, { label: string; icon: string }> = {
  sensor: { label: "Sensors", icon: "mdi:gauge" },
  binary_sensor: { label: "Detectors", icon: "mdi:motion-sensor" },
  light: { label: "Lights", icon: "mdi:lightbulb-outline" },
  switch: { label: "Switches", icon: "mdi:toggle-switch-outline" },
  media_player: { label: "Media players", icon: "mdi:speaker" },
  climate: { label: "Climate", icon: "mdi:thermostat" },
  vacuum: { label: "Vacuums", icon: "mdi:robot-vacuum" },
  cover: { label: "Covers", icon: "mdi:window-shutter" },
  scene: { label: "Scenes", icon: "mdi:palette-outline" },
  button: { label: "Buttons", icon: "mdi:gesture-tap-button" },
  fan: { label: "Fans", icon: "mdi:fan" },
  lock: { label: "Locks", icon: "mdi:lock-outline" },
  todo: { label: "Lists", icon: "mdi:format-list-checks" },
};

const domainOf = (domain: string) =>
  DOMAINS[domain] ?? { label: domain.replaceAll("_", " "), icon: "mdi:shape-outline" };

/**
 * Binary sensors, split by what they actually watch.
 *
 * "Detectors" as one heading put the front door, the leak sensor and the
 * hallway motion in the same bucket — and now that doors and windows have a
 * card of their own, the menu is where you choose which of them it counts.
 * The device class already says which is which.
 */
const BINARY_GROUPS: { id: string; label: string; icon: string; classes: string[] }[] = [
  {
    id: "binary_sensor:opening",
    label: "Doors & windows",
    icon: "mdi:door-open",
    classes: ["door", "window", "garage_door", "opening"],
  },
  {
    id: "binary_sensor:motion",
    label: "Motion",
    icon: "mdi:motion-sensor",
    classes: ["motion", "occupancy", "presence"],
  },
  {
    id: "binary_sensor:safety",
    label: "Safety",
    icon: "mdi:smoke-detector-variant",
    classes: ["smoke", "gas", "carbon_monoxide", "moisture", "problem", "safety"],
  },
];

/** Which bucket an entity belongs to — its domain, or a finer one for
 *  binary sensors. */
function groupOf(entity: EntityView): { id: string; label: string; icon: string } {
  /* A team followed with TeamTracker is a sensor, but a match card, not a
     reading. */
  if (looksLikeTeamTracker(entity)) return { id: "sport", label: "Sports", icon: "mdi:soccer" };
  if (entity.domain === "binary_sensor") {
    /* Asked of the card's own reader, so a sensor the card counts as a window
       is filed under windows here — including the ones that carry no device
       class and are recognised by name. */
    if (kindOf(entity)) {
      const opening = BINARY_GROUPS[0]!;
      return { id: opening.id, label: opening.label, icon: opening.icon };
    }
    const match = BINARY_GROUPS.find((group) =>
      group.classes.includes(entity.deviceClass ?? ""),
    );
    if (match) return { id: match.id, label: match.label, icon: match.icon };
  }
  return { id: entity.domain, ...domainOf(entity.domain) };
}

/**
 * What this room shows.
 *
 * An area can hold eighty entities and a board has space for a dozen, so the
 * choice has to be somewhere — and settings is the wrong somewhere: it is a
 * form about the widget, while this is a question about the room. The list is
 * everything the area holds, grouped the way Home Assistant groups it, with
 * one switch each.
 *
 * Hidden ids are kept in the widget's own config, so the choice follows the
 * dashboard rather than the browser it was made in.
 */
export function SetupPanel(props: {
  entities: EntityView[];
  hidden: string[];
  onSet: (hidden: string[]) => void;
}) {
  const [filter, setFilter] = createSignal("");

  const isShown = (id: string) => !props.hidden.includes(id);

  const toggle = (id: string) =>
    props.onSet(
      isShown(id) ? [...props.hidden, id] : props.hidden.filter((value) => value !== id),
    );

  const matching = createMemo(() => {
    const needle = filter().trim().toLowerCase();
    if (!needle) return props.entities;
    return props.entities.filter((entity) =>
      `${entity.friendlyName ?? ""} ${entity.id}`.toLowerCase().includes(needle),
    );
  });

  /* Grouped by what a thing is, in the order the groups are worth reading —
     the ones the board can actually draw a card for first. */
  const groups = createMemo(() => {
    const order = [
      "sensor",
      "binary_sensor:opening",
      "binary_sensor:motion",
      "binary_sensor:safety",
      ...Object.keys(DOMAINS).filter((id) => id !== "sensor"),
    ];
    const buckets = new Map<string, { label: string; icon: string; list: EntityView[] }>();

    for (const entity of matching()) {
      const group = groupOf(entity);
      const bucket = buckets.get(group.id) ?? { label: group.label, icon: group.icon, list: [] };
      bucket.list.push(entity);
      buckets.set(group.id, bucket);
    }
    for (const bucket of buckets.values()) {
      bucket.list.sort((a, b) => (a.friendlyName ?? a.id).localeCompare(b.friendlyName ?? b.id));
    }

    return [...buckets.entries()]
      .map(([id, bucket]) => ({
        domain: id,
        label: bucket.label,
        icon: bucket.icon,
        list: bucket.list,
      }))
      .sort((a, b) => {
        const left = order.indexOf(a.domain);
        const right = order.indexOf(b.domain);
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.domain.localeCompare(b.domain);
      });
  });

  const shownCount = () => props.entities.filter((entity) => isShown(entity.id)).length;

  return (
    <div class="rb-setup">
      <header class="rb-setup-head">
        <span class="rb-setup-count">
          {shownCount()} of {props.entities.length} shown
        </span>

        {/* Both ways, because a room with eighty entities is quicker to build
            up from nothing than to whittle down one switch at a time — and the
            filter narrows what either button acts on, so "hide all" on a
            search for "battery" hides exactly those. */}
        <div class="rb-setup-actions">
          <Show when={shownCount() > 0}>
            <button
              class="rb-setup-reset"
              onClick={() =>
                props.onSet([
                  ...props.hidden,
                  ...matching()
                    .map((entity) => entity.id)
                    .filter((id) => !props.hidden.includes(id)),
                ])
              }
            >
              <Icon icon="mdi:eye-off-outline" width="14" />
              <span>{filter().trim() ? "Hide these" : "Hide all"}</span>
            </button>
          </Show>

          <Show when={props.hidden.length}>
            <button
              class="rb-setup-reset"
              onClick={() =>
                props.onSet(
                  filter().trim()
                    ? props.hidden.filter(
                        (id) => !matching().some((entity) => entity.id === id),
                      )
                    : [],
                )
              }
            >
              <Icon icon="mdi:eye-outline" width="14" />
              <span>{filter().trim() ? "Show these" : "Show all"}</span>
            </button>
          </Show>
        </div>
      </header>

      <label class="rb-setup-search">
        <Icon icon="mdi:magnify" width="16" />
        <input
          type="search"
          placeholder="Find a device or sensor"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
      </label>

      <div class="rb-setup-groups">
        {/* Keyed on the group and the entity: both are worked out afresh on
            every update from anything in the room, and lists keyed on those
            new objects rebuilt every row, icons and all — the flicker. */}
        <Keyed each={groups()} by={(group) => group.label}>
          {(group) => (
            <section class="rb-setup-group">
              <h3 class="rb-setup-group-name">
                <Icon icon={group.icon} width="15" />
                <span>{group.label}</span>
                <b>{group.list.length}</b>
              </h3>

              <div class="rb-setup-rows">
                <Keyed each={group.list}>
                  {(entity) => (
                    <button
                      class="rb-setup-row"
                      role="switch"
                      aria-checked={isShown(entity.id)}
                      data-on={isShown(entity.id)}
                      onClick={() => toggle(entity.id)}
                    >
                      {/* Drawn straight away: the icon otherwise waits until
                          it scrolls into view, and a long list filled in its
                          icons a beat behind the finger. */}
                      <Icon icon={safeIcon(entity.icon, group.icon)} width="17" />

                      <span class="rb-setup-meta">
                        <span class="rb-setup-name rb-truncate">
                          {entity.friendlyName ?? entity.id}
                        </span>
                        <span class="rb-setup-id rb-truncate">{entity.id}</span>
                        {/* Why a sensor switched on here still has no card:
                            the board draws a reading only from a sensor with
                            a number, and leaves out what Home Assistant
                            itself marks diagnostic or hidden. Said here, so
                            "on" never quietly means "not shown". */}
                        <Show when={isShown(entity.id) && skipReason(entity)}>
                          <span class="rb-setup-why rb-truncate">{skipReason(entity)}</span>
                        </Show>
                      </span>

                      <span class="rb-switch-track" aria-hidden="true">
                        <i />
                      </span>
                    </button>
                  )}
                </Keyed>
              </div>
            </section>
          )}
        </Keyed>

        <Show when={!groups().length}>
          <p class="rb-setup-none">Nothing in this area matches that.</p>
        </Show>
      </div>
    </div>
  );
}
