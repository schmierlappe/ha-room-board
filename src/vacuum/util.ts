import type { EntityView } from "@glasshome/widget-sdk";
import type { JSX } from "solid-js";

/**
 * Reads the dashboard's accent color via getComputedStyle rather than
 * relying on `var(--primary)` inheriting through the widget's shadow root.
 *
 * <html> doesn't work as the read target: GlassHome declares this token on
 * a `.dark`/`.light` wrapper div partway down the tree, and <html> is that
 * div's ANCESTOR — inheritance only flows down, so reading from an ancestor
 * of the declaration always comes back empty regardless of whether the
 * cascade itself works. Querying `.dark`/`.light` directly reads the token
 * at its actual source instead of hoping it propagates somewhere else.
 */
export interface ThemeOverrides {
  accentColor?: string;
}

/**
 * Auto-detected value, then `overrides.accentColor` wins if set — an escape
 * hatch for whenever the auto-detection above doesn't pan out (the token
 * scoped somewhere this still doesn't reach, a GlassHome version that names
 * it differently, etc.) without losing the automatic behavior for setups
 * where it does work.
 */
export function themeVars(overrides?: ThemeOverrides): JSX.CSSProperties {
  const vars: Record<string, string> = {};

  if (typeof document !== "undefined") {
    const themeRoot = document.querySelector(".dark, .light") ?? document.body;
    const primary = getComputedStyle(themeRoot).getPropertyValue("--primary").trim();
    if (primary) vars["--vc-primary"] = primary;
  }

  if (overrides?.accentColor) vars["--vc-primary"] = overrides.accentColor;

  return vars as JSX.CSSProperties;
}

export function attr<T>(entity: EntityView | undefined, key: string, fallback: T): T {
  const value = entity?.attributes?.[key];
  return (value ?? fallback) as T;
}

export const isAlive = (entity?: EntityView) =>
  !!entity && entity.state !== "unavailable" && entity.state !== "unknown";

/** vacuum states: cleaning, docked, idle, paused, returning, error */
export const isCleaning = (entity?: EntityView) => entity?.state === "cleaning";
export const isDocked = (entity?: EntityView) => entity?.state === "docked";

export const STATE_LABELS: Record<string, string> = {
  cleaning: "Cleaning",
  docked: "Docked",
  idle: "Idle",
  paused: "Paused",
  returning: "Returning to dock",
  error: "Error",
  unavailable: "Unavailable",
};

export const stateLabel = (entity?: EntityView) =>
  STATE_LABELS[entity?.state ?? ""] ?? entity?.state ?? "Unknown";

export const STATE_ICONS: Record<string, string> = {
  cleaning: "mdi:robot-vacuum",
  docked: "mdi:home-import-outline",
  idle: "mdi:robot-vacuum-variant",
  paused: "mdi:pause-circle-outline",
  returning: "mdi:home-import-outline",
  error: "mdi:alert-circle-outline",
};

export const stateIcon = (entity?: EntityView) =>
  STATE_ICONS[entity?.state ?? ""] ?? "mdi:robot-vacuum";

/** Battery icon that follows the level, so the tile reads at a glance. */
export function batteryIcon(level: number, charging: boolean): string {
  if (charging) return "mdi:battery-charging";
  if (level >= 95) return "mdi:battery";
  if (level <= 5) return "mdi:battery-outline";
  return `mdi:battery-${Math.round(level / 10) * 10}`;
}

export function formatMinutes(total?: number): string {
  if (total === undefined || Number.isNaN(total)) return "—";
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/**
 * The four consumables Roborock (and most robot vacuum integrations) expose
 * as separate sensors, matched by keyword since entity ids vary by device
 * name and integration version — the same reasoning as the explicit sensor
 * picker in the README.
 */
export type ConsumableKind = "main_brush" | "side_brush" | "filter" | "sensors";

const CONSUMABLE_PATTERNS: [ConsumableKind, RegExp][] = [
  ["main_brush", /main.?brush/i],
  ["side_brush", /side.?brush/i],
  ["filter", /filter/i],
  ["sensors", /sensor/i],
];

export function consumableKind(entity: EntityView): ConsumableKind | undefined {
  const haystack = `${entity.name} ${entity.friendlyName}`;
  for (const [kind, pattern] of CONSUMABLE_PATTERNS) {
    if (pattern.test(haystack)) return kind;
  }
  return undefined;
}

export const CONSUMABLE_ORDER: ConsumableKind[] = ["main_brush", "side_brush", "filter", "sensors"];

export const CONSUMABLE_LABEL: Record<ConsumableKind, string> = {
  main_brush: "Main Brush",
  side_brush: "Side Brush",
  filter: "Filter",
  sensors: "Sensors",
};

export const CONSUMABLE_ICON: Record<ConsumableKind, string> = {
  main_brush: "mdi:broom",
  side_brush: "mdi:pinwheel",
  filter: "mdi:air-filter",
  sensors: "mdi:radar",
};

export type Severity = "good" | "warn" | "critical" | "neutral";

/** Life-remaining color coding: >50% fine, 20-50% getting low, <=20% needs attention. */
export function severity(percent: number | undefined): Severity {
  if (percent === undefined) return "neutral";
  if (percent <= 20) return "critical";
  if (percent <= 50) return "warn";
  return "good";
}

/**
 * `EntityView.attributes` deliberately excludes `unit_of_measurement` and
 * `device_class` — they're surfaced as `entity.unitOfMeasurement` /
 * `entity.deviceClass` instead. Reading them via `attr()` silently returns
 * the fallback every time, which is why percent detection and duration
 * formatting need to read the top-level fields, not `.attributes`.
 */
export function sensorPercent(entity: EntityView): number | undefined {
  const raw = Number(entity.state);
  if (entity.unitOfMeasurement !== "%" || Number.isNaN(raw)) return undefined;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

const DURATION_UNIT_TO_MINUTES: Record<string, number> = {
  s: 1 / 60,
  sec: 1 / 60,
  seconds: 1 / 60,
  min: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hours: 60,
  d: 1440,
  day: 1440,
  days: 1440,
};

/** Minutes remaining, if this sensor reports a recognizable duration unit. */
export function sensorMinutes(entity: EntityView): number | undefined {
  const unit = (entity.unitOfMeasurement ?? "").toLowerCase();
  const raw = Number(entity.state);
  if (Number.isNaN(raw)) return undefined;
  const minutesPerUnit = DURATION_UNIT_TO_MINUTES[unit];
  if (entity.deviceClass !== "duration" && minutesPerUnit === undefined) return undefined;
  return raw * (minutesPerUnit ?? 1);
}

/** Known durations render as "h min"; everything else is rounded to one decimal with its unit. */
export function formatSensorValue(entity: EntityView): string {
  const minutes = sensorMinutes(entity);
  if (minutes !== undefined) return formatMinutes(minutes);

  const raw = entity.state;
  const num = Number(raw);
  if (Number.isNaN(num)) return entity.unitOfMeasurement ? `${raw} ${entity.unitOfMeasurement}` : raw;

  const rounded = Math.round(num * 10) / 10;
  return entity.unitOfMeasurement ? `${rounded} ${entity.unitOfMeasurement}` : `${rounded}`;
}

/**
 * Roborock's stock replacement intervals, used to turn a "time left" sensor
 * into a percentage when the sensor doesn't already report one. These are
 * the commonly cited defaults across Roborock models (S-series included) —
 * approximate, but the only reference point available without a per-model
 * config option.
 */
export const CONSUMABLE_LIFETIME_HOURS: Record<ConsumableKind, number> = {
  main_brush: 300,
  side_brush: 200,
  filter: 150,
  sensors: 30,
};

/** Native percent sensors win; otherwise a duration sensor is scaled against the stock lifetime. */
export function consumablePercent(kind: ConsumableKind, entity: EntityView): number | undefined {
  const native = sensorPercent(entity);
  if (native !== undefined) return native;

  const minutes = sensorMinutes(entity);
  if (minutes === undefined) return undefined;
  const lifetimeMinutes = CONSUMABLE_LIFETIME_HOURS[kind] * 60;
  return Math.max(0, Math.min(100, Math.round((minutes / lifetimeMinutes) * 100)));
}

export function isBatterySensor(entity: EntityView): boolean {
  return entity.deviceClass === "battery" || /battery/i.test(`${entity.name} ${entity.friendlyName}`);
}

export interface RoomMapping {
  label: string;
  areaId: string;
  /** Named in the mapping, or guessed from the label. */
  icon: string;
}

/**
 * Roborock's Home Assistant integration exposes `vacuum.clean_area`, taking
 * a `cleaning_area_id` — but the id-to-room mapping is set up per device and
 * isn't discoverable from a widget, so rooms are declared manually.
 *
 * "Kitchen=kitchen" as before, or "Kitchen=kitchen=mdi:silverware-fork-knife"
 * to name the icon outright. The third field is optional so every existing
 * mapping keeps working; without it the icon is guessed from the label.
 */
export function parseRoomMap(lines: string[]): RoomMapping[] {
  const rooms: RoomMapping[] = [];
  for (const line of lines) {
    const [labelPart, areaPart, iconPart] = line.split("=");
    const label = labelPart?.trim();
    const areaId = areaPart?.trim();
    if (label && areaId) {
      rooms.push({ label, areaId, icon: iconPart?.trim() || roomIcon(label) });
    }
  }
  return rooms;
}

/**
 * A face for a room, matched from its name.
 *
 * German first, because that is what a German house calls its rooms and the
 * English word rarely appears; each pattern carries both so a mixed setup
 * still lands. Anything unrecognised keeps a plain door — a wrong icon is
 * worse than a neutral one.
 */
const ROOM_ICONS: [RegExp, string][] = [
  [/küche|kueche|kitchen/i, "mdi:silverware-fork-knife"],
  [/wohnzimmer|living/i, "mdi:sofa-outline"],
  [/schlaf|bedroom/i, "mdi:bed-outline"],
  [/kinder|child|nursery|kids/i, "mdi:teddy-bear"],
  [/\bbad\b|badezimmer|bathroom|\bwc\b|toilet/i, "mdi:shower"],
  [/büro|buero|arbeitszimmer|office|study/i, "mdi:desk"],
  [/flur|diele|hall|corridor|entry|eingang/i, "mdi:door-open"],
  [/esszimmer|dining/i, "mdi:table-chair"],
  [/keller|basement|cellar/i, "mdi:stairs-down"],
  [/dachboden|attic|speicher/i, "mdi:stairs-up"],
  [/garage|carport/i, "mdi:garage"],
  [/waschraum|hauswirtschaft|laundry|utility/i, "mdi:washing-machine"],
  [/gäste|gaeste|guest/i, "mdi:bed-single-outline"],
  [/balkon|terrasse|balcony|terrace|patio/i, "mdi:flower-outline"],
  [/garten|garden/i, "mdi:tree-outline"],
  [/treppe|stair/i, "mdi:stairs"],
];

export const roomIcon = (label: string): string =>
  ROOM_ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? "mdi:door-closed";

/**
 * How fast the vacuum spins while it works, in seconds per turn.
 *
 * Tied to the suction setting, so the card shows how hard the machine is
 * being driven rather than only that it is on. Names differ per integration
 * and per language, so it matches on substrings and falls back to the middle
 * rather than to a guess at either end.
 */
export function spinDuration(fanSpeed: string): string {
  const speed = fanSpeed.toLowerCase();
  if (/max|turbo|stark|intens/.test(speed)) return "0.9s";
  if (/medium|balanc|standard|normal|mittel/.test(speed)) return "1.8s";
  if (/quiet|silent|soft|gentle|leise|eco/.test(speed)) return "3.2s";
  if (/custom|auto/.test(speed)) return "1.8s";
  return "1.8s";
}
