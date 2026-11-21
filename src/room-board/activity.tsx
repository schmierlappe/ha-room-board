import { Show, createMemo } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { openable, sinceLabel } from "./util";
import { Keyed } from "./keyed";
import { Half } from "./half";

/**
 * What has been happening in this room.
 *
 * Read from what each entity says about itself rather than from the recorder:
 * every state carries the moment it began, so sorting the room's things by
 * that moment is a feed of what changed and when, at no cost and with no
 * history query. It is a snapshot rather than a log — an entity that has
 * changed twice only remembers the second — which is exactly what "what is
 * going on in here" asks for.
 */

/** The domains where a change is an event; a temperature drifting is not. */
const WATCHED = new Set([
  "binary_sensor",
  "light",
  "switch",
  "media_player",
  "lock",
  "cover",
  "vacuum",
  "fan",
  "camera",
  "person",
  "device_tracker",
  "input_boolean",
]);

const DEAD = new Set(["unavailable", "unknown", ""]);

export type Event = {
  id: string;
  /** "Ceiling light" */
  name: string;
  /** "Turned on" — the state, short enough to sit at the end of the line. */
  said: string;
  /** "Light" — what kind of thing it is, under the name. */
  kind: string;
  icon: string;
  when: number;
  /** Whether it is the interesting half of the pair, for the accent. */
  live: boolean;
};

/** What to call each domain on the second line. */
const KINDS: Record<string, string> = {
  binary_sensor: "Sensor",
  light: "Light",
  switch: "Switch",
  fan: "Fan",
  lock: "Lock",
  cover: "Cover",
  media_player: "Media player",
  vacuum: "Vacuum",
  camera: "Camera",
  person: "Person",
  device_tracker: "Device",
  input_boolean: "Toggle",
};

/** A binary sensor's two states: on and off, each a word and an icon. */
type Halves = { on: [string, string]; off: [string, string] };

const MOTION: Halves = { on: ["Motion", "mdi:motion-sensor"], off: ["No motion", "mdi:motion-sensor-off"] };
const DOOR: Halves = { on: ["Opened", "mdi:door-open"], off: ["Closed", "mdi:door-closed"] };
const WINDOW: Halves = { on: ["Opened", "mdi:window-open"], off: ["Closed", "mdi:window-closed"] };
const SMOKE: Halves = { on: ["Alarm", "mdi:smoke-detector-variant-alert"], off: ["Clear", "mdi:smoke-detector-variant-alert"] };

/** The words each device class deserves. */
const BINARY: Record<string, Halves> = {
  motion: MOTION,
  occupancy: MOTION,
  presence: MOTION,
  door: DOOR,
  garage_door: DOOR,
  window: WINDOW,
  opening: WINDOW,
  moisture: { on: ["Water", "mdi:water-alert-outline"], off: ["Dry", "mdi:water-alert-outline"] },
  smoke: SMOKE,
  gas: SMOKE,
  carbon_monoxide: SMOKE,
  sound: { on: ["Sound", "mdi:ear-hearing"], off: ["Quiet", "mdi:ear-hearing"] },
  vibration: { on: ["Movement", "mdi:vibrate"], off: ["Still", "mdi:vibrate"] },
};
const ANY_BINARY: Halves = { on: ["Triggered", "mdi:alert-circle-outline"], off: ["Clear", "mdi:check-circle-outline"] };

/** Both halves of a binary sensor, in the words its device class deserves. */
function binary(deviceClass: string, on: boolean): [string, string, boolean] {
  const halves = BINARY[deviceClass] ?? ANY_BINARY;
  const [word, icon] = on ? halves.on : halves.off;
  return [word, icon, on];
}

type Words = [string, string, boolean];

/** A state as a word at the front: "unknown" → "Unknown", "returning_home" → "Returning home". */
const capitalise = (state: string) => state.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

/** A state from a list of known ones, else the state itself in words. */
const known = (table: Record<string, Words>, otherwise: (state: string) => Words) => (state: string) =>
  table[state] ?? otherwise(state);

/* A receiver or set-top box — a Vu+, a Sky Q — never says "playing": it
   sits on "on" for as long as it is showing something. */
const PLAYING: Words = ["Playing", "mdi:play-circle", true];
const MEDIA = known(
  { playing: PLAYING, on: PLAYING, buffering: PLAYING, paused: ["Paused", "mdi:pause-circle", false] },
  () => ["Stopped", "mdi:stop-circle-outline", false],
);
const COVER = known(
  { open: ["Opened", "mdi:window-shutter-open", true], closed: ["Closed", "mdi:window-shutter", false] },
  (state) => [state.replace(/^./, (c) => c.toUpperCase()), "mdi:window-shutter-alert", true],
);
const VACUUM = known(
  { cleaning: ["Cleaning", "mdi:robot-vacuum", true], docked: ["Docked", "mdi:home-import-outline", false] },
  (state) => [capitalise(state), "mdi:robot-vacuum-alert", true],
);

/** On and off for the plain kinds: a word and an icon each. */
const onOff = (on: boolean, yes: [string, string], no: [string, string]): Words =>
  on ? [yes[0], yes[1], true] : [no[0], no[1], false];

/** Each domain the feed knows, and how its state reads. */
const DESCRIBE: Record<string, (entity: EntityView, state: string, on: boolean) => Words> = {
  binary_sensor: (entity, _state, on) => binary(entity.deviceClass ?? "", on),
  light: (_e, _s, on) => onOff(on, ["Turned on", "mdi:lightbulb"], ["Turned off", "mdi:lightbulb-outline"]),
  switch: (_e, _s, on) => onOff(on, ["Switched on", "mdi:toggle-switch"], ["Switched off", "mdi:toggle-switch-off-outline"]),
  input_boolean: (_e, _s, on) =>
    onOff(on, ["Switched on", "mdi:toggle-switch"], ["Switched off", "mdi:toggle-switch-off-outline"]),
  fan: (_e, _s, on) => onOff(on, ["Running", "mdi:fan"], ["Stopped", "mdi:fan"]),
  lock: (_e, state) => (state === "locked" ? ["Locked", "mdi:lock", false] : ["Unlocked", "mdi:lock-open-variant", true]),
  cover: (_e, state) => COVER(state),
  media_player: (_e, state) => MEDIA(state),
  vacuum: (_e, state) => VACUUM(state),
  camera: () => ["New still", "mdi:cctv", true],
  person: (_e, state) => (state === "home" ? ["Home", "mdi:home-account", true] : ["Away", "mdi:exit-run", false]),
  device_tracker: (_e, state) =>
    state === "home" ? ["Home", "mdi:home-account", true] : ["Away", "mdi:exit-run", false],
};

/** What this entity's current state amounts to, in words. */
function describe(entity: EntityView): Words | undefined {
  const state = entity.state ?? "";
  if (DEAD.has(state)) return undefined;
  return DESCRIBE[entity.domain]?.(entity, state, state === "on");
}

export function eventsOf(entities: EntityView[]): Event[] {
  const events: Event[] = [];

  for (const entity of entities) {
    if (!WATCHED.has(entity.domain) || entity.isHidden) continue;
    const said = describe(entity);
    if (!said) continue;

    const when = new Date(entity.lastChanged ?? 0).getTime();
    if (!Number.isFinite(when) || when <= 0) continue;

    events.push({
      id: entity.id,
      name: entity.friendlyName ?? entity.id,
      said: said[0],
      kind: KINDS[entity.domain] ?? entity.domain.replaceAll("_", " "),
      icon: said[1],
      live: said[2],
      when,
    });
  }

  events.sort((a, b) => b.when - a.when);

  return events;
}

const clock = (when: number) =>
  new Date(when).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * One entry on the rail.
 *
 * Two lines, each with something at both ends: the thing and what it is doing
 * above, what kind of thing it is and when it started below. The dot on the
 * rail is the only colour — filled for the half of the pair worth noticing.
 */
function Row(props: { event: Event }) {
  return (
    <div class="rb-act-row" data-live={props.event.live} title={props.event.name}>
      <span class="rb-act-dot" aria-hidden="true" />

      <span class="rb-act-line">
        <span class="rb-act-name rb-truncate">{props.event.name}</span>
        <span class="rb-act-said">{props.event.said}</span>
      </span>

      <span class="rb-act-line rb-act-line--sub">
        <span class="rb-act-kind rb-truncate">{props.event.kind}</span>
        <span class="rb-act-when">{clock(props.event.when)}</span>
      </span>
    </div>
  );
}

/** The board card: the last few things that happened. */
export function ActivityCard(props: { entities: EntityView[]; onOpen: () => void }) {
  const events = createMemo(() => eventsOf(props.entities));
  const recent = () => events().slice(0, 12);

  /* Anything in the last few minutes is what somebody would call "going on"
     right now, and is worth a dot on the card. */
  const live = () => events().some((event) => event.live && Date.now() - event.when < 300_000);

  return (
    <article class="rb-card rb-card--activity" {...openable(props.onOpen, "Activity")}>
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">Activity</h3>
          <span class="rb-card-verdict rb-truncate">
            <Show when={live()}>
              <i class="rb-live-dot" />
            </Show>
            {events().length
              ? `Last change ${sinceLabel(new Date(events()[0]!.when))}`
              : "Nothing to report"}
          </span>
        </div>
      </header>

      <div class="rb-act-rail">
        <Keyed each={recent()}>{(event) => <Row event={event} />}</Keyed>

        <Show when={!events().length}>
          <p class="rb-act-none">This room has nothing that reports events yet.</p>
        </Show>
      </div>
      <Half icon="mdi:history" name={recent()[0]?.name ?? "Activity"} status={recent()[0]?.said ?? "Nothing yet"} tone="#8b7cf6" lit={live()} />
    </article>
  );
}

/** The overlay: the same feed, as long as the room can make it. */
/**
 * The feed on a phone: a bar along the foot of the board.
 *
 * Stacked into one column, the card is a second scrolling list under the
 * tiles — you reach the end of the board and find another board. A bar is one
 * line of the same information, the most recent thing that happened, and it
 * opens the feed proper when that is what you want.
 */
export function ActivityBar(props: { entities: EntityView[]; onOpen: () => void }) {
  const events = createMemo(() => eventsOf(props.entities));
  const latest = () => events()[0];
  const live = () => events().some((event) => event.live && Date.now() - event.when < 300_000);

  return (
    <button class="rb-act-bar" onClick={props.onOpen}>
      <span class="rb-act-bar-dot" data-live={live()} />

      <span class="rb-act-bar-text rb-truncate">
        <Show when={latest()} fallback="Activity">
          <b>{latest()!.name}</b>
          <span>{latest()!.said}</span>
        </Show>
      </span>

      <span class="rb-act-bar-when">
        <Show when={latest()}>{sinceLabel(new Date(latest()!.when))}</Show>
      </span>

      <Icon icon="mdi:chevron-up" width="17" />
    </button>
  );
}

export function ActivityPanel(props: { entities: EntityView[] }) {
  const events = createMemo(() => eventsOf(props.entities));

  /* Grouped by how long ago, because "3 min" and "2 days" in one flat list
     read as the same kind of thing, and they are not. */
  const groups = createMemo(() => {
    const now = Date.now();
    const buckets: { label: string; list: Event[] }[] = [
      { label: "Right now", list: [] },
      { label: "Earlier today", list: [] },
      { label: "Before that", list: [] },
    ];

    for (const event of events()) {
      const age = now - event.when;
      let bucket = 2;
      if (age < 900_000) bucket = 0;
      else if (age < 86_400_000) bucket = 1;
      buckets[bucket]!.list.push(event);
    }

    return buckets.filter((bucket) => bucket.list.length);
  });

  return (
    <div class="rb-act-panel">
      <p class="rb-act-note">
        What each thing in this room is doing and when it started — read from the devices
        themselves, so it shows the most recent change per device rather than a full log.
      </p>

      <Keyed each={groups()} by={(group) => group.label}>
        {(group) => (
          <section class="rb-act-group">
            <h3 class="rb-vac-label">{group.label}</h3>
            <div class="rb-act-rail">
              <Keyed each={group.list}>{(event) => <Row event={event} />}</Keyed>
            </div>
          </section>
        )}
      </Keyed>

      <Show when={!events().length}>
        <p class="rb-act-none">This room has nothing that reports events yet.</p>
      </Show>
    </div>
  );
}
