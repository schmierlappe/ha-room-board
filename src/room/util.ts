import type { EntityView } from "@glasshome/widget-sdk";

/** EntityView.attributes excludes icon, deviceClass, unitOfMeasurement and
 *  friendlyName — read those off the entity itself. */
export function attr<T>(entity: EntityView | undefined, key: string, fallback: T): T {
  const value = entity?.attributes?.[key];
  return (value ?? fallback) as T;
}

/**
 * An icon the icon service can actually serve.
 *
 * Home Assistant entities carry whatever icon set their integration installs —
 * `phu:` from the Philips Hue pack, `hue:`, and other HACS collections that
 * exist only inside that Home Assistant. Rendering one sends the browser
 * looking for a collection nobody publishes, which answers 404 and leaves a
 * blank where the icon should be.
 */
const ICON_SETS = new Set([
  "mdi",
  "mdil",
  "cbi",
  "simple-icons",
  "arcticons",
  "material-symbols",
  "ph",
  "tabler",
  "lucide",
  "fluent",
  "carbon",
  "ic",
]);

export function safeIcon(icon: string | null | undefined, fallback: string): string {
  if (!icon) return fallback;
  const prefix = icon.split(":")[0] ?? "";
  return prefix && ICON_SETS.has(prefix) ? icon : fallback;
}

export const isOn = (entity: EntityView | undefined) =>
  !!entity && !["off", "unavailable", "unknown", "closed", "idle"].includes(entity.state);

export const isAlive = (entity: EntityView | undefined) =>
  !!entity && entity.state !== "unavailable" && entity.state !== "unknown";

/**
 * The dashboard's accent and surface colours, read off the `.dark`/`.light`
 * wrapper where GlassHome declares them.
 *
 * The tile renders in a closed shadow root, which custom properties do not
 * cross, and the popup portals to document.body outside the wrapper entirely.
 * Both read the values here and re-declare them as --rm-*.
 */
export function themeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};

  const root = document.querySelector(".dark, .light") ?? document.body;
  const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const vars: Record<string, string> = {};
  const primary = read("--primary");
  const foreground = read("--foreground");
  if (primary) vars["--rm-primary"] = primary;
  if (foreground) vars["--rm-ink"] = foreground;
  return vars;
}

/** A light: how bright, 0 when off, full where it has no brightness. */
function lightFill(entity: EntityView): number {
  if (!isOn(entity)) return 0;
  const brightness = attr<number | undefined>(entity, "brightness", undefined);
  return brightness === undefined ? 100 : Math.round((brightness / 255) * 100);
}

/** A cover: its position, else open or closed. */
function coverFill(entity: EntityView): number {
  const position = attr<number | undefined>(entity, "current_position", undefined);
  if (position !== undefined) return position;
  return entity.state === "open" ? 100 : 0;
}

/** A thermostat: where its target sits between its lowest and highest. */
function climateFill(entity: EntityView): number | undefined {
  const target = attr<number | undefined>(entity, "temperature", undefined);
  if (target === undefined) return undefined;
  const min = attr<number>(entity, "min_temp", 7);
  const max = attr<number>(entity, "max_temp", 35);
  if (max <= min) return undefined;
  return Math.max(0, Math.min(100, ((target - min) / (max - min)) * 100));
}

const FILL: Record<string, (entity: EntityView) => number | undefined> = {
  light: lightFill,
  cover: coverFill,
  climate: climateFill,
};

/** 0–100 for the tile's fill bar, or undefined where the value has no ceiling. */
export function fillPercent(entity: EntityView | undefined, kind: string): number | undefined {
  return entity ? FILL[kind]?.(entity) : undefined;
}

/* ---------- calendar ---------- */

export type AgendaEntry = {
  summary: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  /** Which calendar it came from, so a merged agenda can still say. */
  calendarId?: string;
};

/**
 * Home Assistant sends all-day events as bare dates ("2026-09-12") and timed
 * ones as full timestamps. The difference is the whole of how an entry should
 * be worded, so it is decided once here rather than at each place that prints
 * one.
 */
export function toAgenda(
  events: { start: string; end: string; summary: string; location?: string }[],
): AgendaEntry[] {
  return events
    .map((event) => ({
      summary: event.summary,
      start: new Date(event.start),
      end: new Date(event.end),
      allDay: !event.start.includes("T"),
      location: event.location,
    }))
    .filter((entry) => !Number.isNaN(entry.start.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Entries that have not finished yet, soonest first. */
export const upcoming = (entries: AgendaEntry[], now = Date.now()) =>
  entries.filter((entry) => entry.end.getTime() >= now);

const DAY = 86_400_000;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * "Today 14:00", "Tomorrow", "Fri 09:30" — the day only where it is not
 * obvious, and the time only where the event has one.
 */
export function whenLabel(entry: AgendaEntry, locale: string, now = new Date()): string {
  const days = Math.round((startOfDay(entry.start) - startOfDay(now)) / DAY);

  let day = entry.start.toLocaleDateString(locale, { day: "numeric", month: "short" });
  if (days === 0) day = "Today";
  else if (days === 1) day = "Tomorrow";
  else if (days > 1 && days < 7) day = entry.start.toLocaleDateString(locale, { weekday: "short" });

  if (entry.allDay) return day;
  const time = entry.start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
}

/** The date, split for the calendar strip's tall day / short month stack. */
export function dayParts(date: Date, locale: string): { day: string; month: string } {
  return {
    day: date.toLocaleDateString(locale, { day: "numeric" }),
    month: date.toLocaleDateString(locale, { month: "short" }),
  };
}

/** "All day", or the start time. The strip's own middle column. */
export function timeLabel(entry: AgendaEntry, locale: string): string {
  return entry.allDay
    ? "All day"
    : entry.start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Two entries belong to the same day in the viewer's own timezone. */
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
