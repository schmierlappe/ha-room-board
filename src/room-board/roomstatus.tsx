import { Index, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Icon, useArea, type EntityView } from "@glasshome/widget-sdk";
import { appliancesOf, isRunning as machineRunning, kindOf as machineKind, timeLeft } from "./appliance";
import { actionOf, currentOf, isRunning as climateRunning } from "./climate";
import { StateGlyph } from "./thermostat";
import { isLit } from "./lights";
import { stateOf as lockState } from "./locks";
import { isPlaying } from "./media";
import { openingsOf } from "./openings";
import { numeric } from "./util";
import { isCleaning } from "./vacuum";

/**
 * What a room is doing, for the room picker.
 *
 * The picker used to carry two unlabelled marks — a meter and a dot with a
 * number — which said *something* was on without saying what. This reads the
 * room the way you would ask about it before walking in: is anything wrong,
 * is anything open, is anything running, and how warm is it. Each answer is a
 * labelled chip in its own colour, the urgent ones first, so a leak in the
 * laundry sits ahead of the lights left on in the hall.
 */

export type Mark = {
  kind: "alert" | "open" | "unlocked" | "climate" | "playing" | "washing" | "cleaning" | "lights";
  icon: string;
  /** For the climate chip: heating, cooling, drying or fan — which mark moves. */
  action?: string;
  /** The chip's words in the menu. */
  text: string;
  /** A count or nothing, for the pill on the photo where only icons fit. */
  count?: number;
};

export type RoomStatus = {
  marks: Mark[];
  /** The room's temperature, where it has a thermostat or a sensor. */
  temp?: number;
  /** Someone is there: a motion, occupancy or presence sensor is on. */
  occupied: boolean;
};

const ALERTS: Record<string, [string, string]> = {
  moisture: ["Leak", "mdi:water-alert"],
  smoke: ["Smoke", "mdi:smoke-detector-alert"],
  gas: ["Gas", "mdi:gas-cylinder"],
  carbon_monoxide: ["CO", "mdi:molecule-co"],
  safety: ["Alarm", "mdi:alert"],
};

const PRESENCE = new Set(["motion", "occupancy", "presence"]);

const visible = (entity: EntityView) => !entity.entityCategory && !entity.isHidden;

/** Anything alarming, by name. */
function alertMarks(shown: EntityView[]): Mark[] {
  const marks: Mark[] = [];
  for (const entity of shown) {
    const alert = entity.domain === "binary_sensor" && entity.state === "on" ? ALERTS[entity.deviceClass ?? ""] : undefined;
    if (alert) marks.push({ kind: "alert", icon: alert[1], text: alert[0] });
  }
  return marks;
}

const OPENING_ICON: Record<string, string> = { door: "mdi:door-open", garage: "mdi:garage-open-variant" };
const OPENING_WORD: Record<string, string> = { door: "Door", garage: "Garage" };

/** What is open: the one by its kind, or how many. */
function openMark(shown: EntityView[]): Mark | undefined {
  const open = openingsOf(shown).filter((opening) => opening.open);
  if (!open.length) return undefined;
  const only = open.length === 1 ? open[0]! : undefined;
  return {
    kind: "open",
    icon: OPENING_ICON[only?.kind ?? ""] ?? "mdi:window-open-variant",
    text: only ? `${OPENING_WORD[only.kind] ?? "Window"} open` : `${open.length} open`,
    count: open.length,
  };
}

/** A jammed lock as an alert; else an unlocked one. */
function lockMark(shown: EntityView[]): Mark | undefined {
  const locks = new Set(shown.filter((entity) => entity.domain === "lock").map(lockState));
  if (locks.has("jammed")) return { kind: "alert", icon: "mdi:lock-alert", text: "Jammed" };
  if (locks.has("unlocked")) return { kind: "unlocked", icon: "mdi:lock-open-variant", text: "Unlocked" };
  return undefined;
}

/** The heating or the air conditioning at work — only while it is, since a
    thermostat merely switched on is the room's normal state, not news. */
function climateMark(shown: EntityView[]): Mark | undefined {
  const working = shown.find((entity) => entity.domain === "climate" && climateRunning(entity));
  if (!working) return undefined;
  const action = actionOf(working);
  return { kind: "climate", icon: "mdi:thermostat", text: action.charAt(0).toUpperCase() + action.slice(1), action };
}

/** A washer or dryer running, with its time left where it says. */
function washingMark(shown: EntityView[]): Mark | undefined {
  const machine = appliancesOf(shown).find(machineRunning);
  if (!machine) return undefined;
  const left = timeLeft(machine.remaining);
  const verb = machineKind(machine) === "dryer" ? "Drying" : "Washing";
  return { kind: "washing", icon: "mdi:washing-machine", text: left ? `${verb} · ${left}` : verb };
}

/** Bulbs, not the groups over them: a group and its three members, all on,
    are three lights. A room with nothing but a group counts the group. */
function lightsMark(shown: EntityView[]): Mark | undefined {
  const lamps = shown.filter((entity) => entity.domain === "light");
  const bulbs = lamps.filter((entity) => !Array.isArray(entity.attributes?.entity_id));
  const lit = (bulbs.length ? bulbs : lamps).filter(isLit).length;
  if (!lit) return undefined;
  return { kind: "lights", icon: "mdi:lightbulb-on", text: lit === 1 ? "1 light" : `${lit} lights`, count: lit };
}

/** The thermostat's own reading first — it is the one the room is run by —
    then any temperature sensor. */
function roomTemp(shown: EntityView[]): number | undefined {
  const fromClimate = currentOf(shown.find((entity) => entity.domain === "climate"));
  if (typeof fromClimate === "number") return fromClimate;
  const sensor = shown.find(
    (entity) => entity.domain === "sensor" && entity.deviceClass === "temperature" && numeric(entity) !== undefined,
  );
  return numeric(sensor);
}

const isOccupied = (shown: EntityView[]) =>
  shown.some((entity) => entity.domain === "binary_sensor" && PRESENCE.has(entity.deviceClass ?? "") && entity.state === "on");

const anyOf = (shown: EntityView[], domain: string, test: (entity: EntityView) => boolean) =>
  shown.some((entity) => entity.domain === domain && test(entity));

export function roomStatus(entities: EntityView[]): RoomStatus {
  const shown = entities.filter(visible);
  const marks = [
    ...alertMarks(shown),
    openMark(shown),
    lockMark(shown),
    climateMark(shown),
    anyOf(shown, "media_player", isPlaying) ? ({ kind: "playing", icon: "mdi:music-note", text: "Playing" } as Mark) : undefined,
    washingMark(shown),
    anyOf(shown, "vacuum", isCleaning) ? ({ kind: "cleaning", icon: "mdi:robot-vacuum", text: "Cleaning" } as Mark) : undefined,
    lightsMark(shown),
  ].filter((mark): mark is Mark => !!mark);
  return { marks, temp: roomTemp(shown), occupied: isOccupied(shown) };
}

/** The meter, for the chip that is playing: it moves, as the room does. */
function Meter() {
  return (
    <i class="rb-roomlive-eq" aria-hidden="true">
      <b />
      <b />
      <b />
    </i>
  );
}

/**
 * The chips.
 *
 * In the menu each is its icon and its words; on the pill on the photo there
 * is room only for the icons (and a count where there is more than one), and
 * only the first three — the urgent ones are first, so it is the lights that
 * fall off, not the leak.
 */
export function StatusChips(props: { marks: Mark[]; compact?: boolean; limit?: number }) {
  const limit = () => props.limit ?? 3;
  const shown = () => props.marks.slice(0, limit());
  const more = () => props.marks.length - shown().length;

  return (
    <Show when={props.marks.length}>
      <span class="rb-rs-chips" data-compact={!!props.compact}>
        {/* By position, not by mark: the marks are worked out afresh on
            every update from any entity in the room, and a list keyed on
            those new objects rebuilt every chip — icons reloading, meters
            restarting — which blinked the menu while it was open. */}
        <Index each={shown()}>
          {(mark) => (
            <span class="rb-rs-chip" data-kind={mark().kind} title={mark().text}>
              <Show
                when={mark().kind === "playing"}
                fallback={
                  <Show
                    when={mark().kind === "climate"}
                    fallback={<Icon icon={mark().icon} width="12" />}
                  >
                    {/* The thermostat card's own moving mark: the flame
                        flickering, the snowflake turning. */}
                    <StateGlyph action={mark().action ?? "idle"} width="12" />
                  </Show>
                }
              >
                <Meter />
              </Show>
              <Show
                when={!props.compact}
                fallback={
                  <Show when={(mark().count ?? 0) > 1}>
                    <b>{mark().count}</b>
                  </Show>
                }
              >
                <span>{mark().text}</span>
              </Show>
            </span>
          )}
        </Index>
        <Show when={more() > 0}>
          <span class="rb-rs-more">+{more()}</span>
        </Show>
      </span>
    </Show>
  );
}

/**
 * A row of the room menu: the room's icon — with a green bead when somebody
 * is in it — its name over what it is doing, and its temperature at the end.
 *
 * The room on screen is read off the entities the board already holds; every
 * other row subscribes to its own area for as long as the menu is open, and
 * drops it again when the menu closes.
 */
/* What each room said the last time the menu was open. */
const lastStatus = new Map<string, RoomStatus>();
const EMPTY: RoomStatus = { marks: [], occupied: false };

export function RoomMenuRow(props: {
  area: string;
  name: string;
  icon: string;
  active: boolean;
  /** The board's own entities, for the room on screen. */
  entities?: EntityView[];
  hidden: string[];
  onPick: () => void;
}) {
  /* The menu opens first and the rooms are asked about just after: each
     row's area subscription registers every entity in that room, and doing
     all of them in the same frame as the menu made it open late. Until a
     room's own answer arrives, it shows what it said last time. */
  const [live, setLive] = createSignal(false);
  onMount(() => {
    const timer = setTimeout(() => setLive(true), 120);
    onCleanup(() => clearTimeout(timer));
  });

  const area = useArea(() => (props.entities || !live() ? "" : props.area));
  const status = createMemo(() => {
    if (!props.entities && !area()) return lastStatus.get(props.area) ?? EMPTY;
    const now = roomStatus(
      props.entities ??
        (area()?.entities ?? []).filter((entity) => !props.hidden.includes(entity.id)),
    );
    lastStatus.set(props.area, now);
    return now;
  });
  const alert = () => status().marks.some((mark) => mark.kind === "alert");

  return (
    <button class="rb-roommenu-item rb-rs-row" data-active={props.active} data-alert={alert()} onClick={props.onPick}>
      <span class="rb-rs-icon" data-occupied={status().occupied}>
        <Icon icon={props.icon} width="17" />
      </span>

      {/* The temperature on the name's line, so the chips under it have
          the row's whole width. */}
      <span class="rb-rs-text">
        <span class="rb-rs-top">
          <span class="rb-rs-name rb-truncate">{props.name}</span>
          <Show when={status().temp !== undefined}>
            <span class="rb-rs-temp">{status().temp!.toFixed(1).replace(/\.0$/, "")}°</span>
          </Show>
        </span>
        <StatusChips marks={status().marks} />
      </span>
      <Show when={props.active}>
        <Icon class="rb-rs-check" icon="mdi:check" width="15" />
      </Show>
    </button>
  );
}
