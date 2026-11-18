import type { EntityView } from "@glasshome/widget-sdk";

export interface WasteItem {
  date: Date;
  dateKey: string;
  type: string;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The waste_collection_schedule integration doesn't guarantee a stable
 * attribute name for its date→pickup-type map (it varies by how the sensor
 * was set up), so this looks for whichever attribute is shaped like one —
 * an object whose every key is an ISO date — rather than assuming a name.
 */
export function findSchedule(entity: EntityView | undefined): Record<string, string> | undefined {
  if (!entity) return undefined;
  for (const value of Object.values(entity.attributes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every((k) => DATE_KEY.test(k))) {
      return value as Record<string, string>;
    }
  }
  return undefined;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * The key must be the *local* calendar day. toISOString converts to UTC, so
 * local midnight in CEST came out as the previous day — the hero parsed from
 * the sensor's state then never matched the same pickup in the attributes,
 * and the list showed it twice.
 */
function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(base: Date, days: number): Date {
  const copy = startOfDay(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * "<type> in <n> day(s)" read from the end, as /^(.*?)\s+in\s+(\d+)\s+days?$/i
 * would — but in one pass. That pattern tried every run of spaces in the
 * type as the one before "in", which on a long name of spaced words is work
 * growing with the square of its length.
 */
function readState(state: string): [type: string, days: string] | undefined {
  const isSpace = (at: number) => at > 0 && /\s/.test(state[at - 1]!);
  const isDigit = (at: number) => at > 0 && state[at - 1]! >= "0" && state[at - 1]! <= "9";
  const ends = (at: number, word: string) => state.slice(at - word.length, at).toLowerCase() === word;
  /* Back over a run of `test`; undefined when there is none. */
  const back = (at: number, test: (at: number) => boolean) => {
    let i = at;
    while (test(i)) i--;
    return i < at ? i : undefined;
  };

  let at = state.length;
  if (ends(at, "days")) at -= 4;
  else if (ends(at, "day")) at -= 3;
  else return undefined;
  const digitsEnd = back(at, isSpace);
  const digitsStart = digitsEnd === undefined ? undefined : back(digitsEnd, isDigit);
  const inEnd = digitsStart === undefined ? undefined : back(digitsStart, isSpace);
  if (inEnd === undefined || !ends(inEnd, "in")) return undefined;
  const typeEnd = back(inEnd - 2, isSpace);
  if (typeEnd === undefined) return undefined;
  return [state.slice(0, typeEnd), state.slice(digitsStart, digitsEnd)];
}

/**
 * The sensor's own state is the reliable source for "what's next" — it's a
 * plain string like "Wertstoff (privat) 2-Rad 02-woechentl. in 7 days" —
 * unlike the upcoming-list attribute, whose name/shape isn't guaranteed
 * across setups. Attributes are only used as a secondary source, for the
 * list of items *after* this one.
 */
export function parseStateSummary(entity: EntityView | undefined): WasteItem | undefined {
  if (!entity) return undefined;
  const state = entity.state?.trim();
  if (!state || state === "unavailable" || state === "unknown") return undefined;

  const match = readState(state);
  if (!match) return undefined;
  const type = match[0].trim();
  const days = Number(match[1]);
  if (!type || Number.isNaN(days)) return undefined;

  const date = addDays(new Date(), days);
  return { type, date, dateKey: toKey(date) };
}

/**
 * Representative pickups for the widget gallery only.
 *
 * The preview harness and the Hub's render worker run against a fixed demo
 * dataset with no network, and that dataset has no waste-collection sensor —
 * so an example pointing at a real entity id renders the empty state. This
 * is opted into by `sampleData` in `manifest.examples[].config`, which is
 * deliberately absent from `configSchema`: the settings form can't offer it,
 * so it can never stand in for a real user's missing data.
 *
 * Offsets are relative to today so gallery shots never date themselves.
 */
export function sampleItems(): WasteItem[] {
  const plan: [number, string][] = [
    [3, "Wertstoff (privat) 2-Rad 02-woechentl."],
    [10, "Restabfall (privat) 2-Rad 02-woechentl."],
    [17, "Wertstoff (privat) 2-Rad 02-woechentl."],
    [24, "Restabfall (privat) 2-Rad 02-woechentl."],
  ];
  return plan.map(([days, type]) => {
    const date = addDays(new Date(), days);
    return { type, date, dateKey: toKey(date) };
  });
}

/**
 * "2026-09-11: Restabfall (privat) 2-Rad 02-woechentl." as the date and the
 * type, with a colon, a dash or a hyphen between them. Read in one pass
 * rather than by /^(\d{4}-\d{2}-\d{2})\s*[:\u2013\u2014-]\s*(.+)$/, whose
 * spaces after the dash could be taken by either side — tried both ways on a
 * long run of them. The type is one line.
 */
function readLine(line: string): [date: string, type: string] | undefined {
  const date = line.slice(0, 10);
  if (!DATE_KEY.test(date)) return undefined;
  const rest = line.slice(10).trimStart();
  if (!":\u2013\u2014-".includes(rest[0] ?? "x")) return undefined;
  const type = rest.slice(1).trimStart();
  return type && !/[\n\r\u2028\u2029]/.test(type) ? [date, type] : undefined;
}

const DATE_FIELDS = ["date", "collection_date", "day", "datetime", "start"];
const TYPE_FIELDS = ["type", "waste_type", "name", "title", "friendly_name", "text"];

/** A field as text: a string as it is, a number written out, anything else none. */
function textOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return typeof raw === "number" ? String(raw) : "";
}

function itemFromParts(dateRaw: unknown, typeRaw: unknown): WasteItem | undefined {
  const dateKey = textOf(dateRaw).slice(0, 10);
  if (!DATE_KEY.test(dateKey)) return undefined;
  const type = textOf(typeRaw).trim();
  if (!type) return undefined;
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return { date, dateKey, type };
}

/**
 * The upcoming list arrives in whichever shape the sensor was configured to
 * produce, and Home Assistant's attribute view renders all of them as
 * "date: type" lines — so the display gives no clue which one you have.
 *
 * Three are accepted: a date-keyed object, a list of "date: type" strings,
 * and a list of objects with a date field and a type field. Only the first
 * was handled before, which is why a list-shaped sensor showed no pills.
 */
export function parseUpcoming(entity: EntityView | undefined): WasteItem[] {
  if (!entity) return [];
  const today = startOfDay(new Date());

  const collect = (): WasteItem[] => {
    // The dates may be the attribute names themselves. Home Assistant's
    // attribute column renders one "key: value" per line, so a sensor with
    // top-level keys like "2026-09-11" looks identical to one holding a
    // date-keyed object — and only the nested form was being read.
    const topLevel = Object.entries(entity.attributes)
      .filter(([k]) => DATE_KEY.test(k))
      .map(([dateKey, type]) => itemFromParts(dateKey, type))
      .filter(Boolean) as WasteItem[];
    if (topLevel.length) return topLevel;

    for (const value of Object.values(entity.attributes)) {
      if (!value) continue;

      if (Array.isArray(value)) {
        const items = value
          .map((raw): WasteItem | undefined => {
            if (typeof raw === "string") {
              const m = readLine(raw.trim());
              return m ? itemFromParts(m[0], m[1]) : undefined;
            }
            if (raw && typeof raw === "object") {
              const rec = raw as Record<string, unknown>;
              const dateKey = DATE_FIELDS.map((k) => rec[k]).find((v) => v !== undefined);
              const type = TYPE_FIELDS.map((k) => rec[k]).find((v) => v !== undefined);
              return itemFromParts(dateKey, type);
            }
            return undefined;
          })
          .filter(Boolean) as WasteItem[];
        // A list of unrelated strings would yield nothing; only take one that
        // actually parsed.
        if (items.length) return items;
        continue;
      }

      if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>);
        if (keys.length && keys.every((k) => DATE_KEY.test(k))) {
          return Object.entries(value as Record<string, string>)
            .map(([dateKey, type]) => itemFromParts(dateKey, type))
            .filter(Boolean) as WasteItem[];
        }
      }
    }
    return [];
  };

  return collect()
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Parses, drops anything already in the past, and sorts chronologically. */
export function parseSchedule(raw: Record<string, string> | undefined): WasteItem[] {
  if (!raw) return [];
  const today = startOfDay(new Date());
  return Object.entries(raw)
    .map(([dateKey, type]) => ({ dateKey, type, date: new Date(`${dateKey}T00:00:00`) }))
    .filter((item) => !Number.isNaN(item.date.getTime()) && item.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function daysUntil(date: Date): number {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function relativeLabel(date: Date): string {
  const days = daysUntil(date);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export const isImminent = (date: Date): boolean => daysUntil(date) <= 1;

/**
 * The countdown split into the part that should be large and the part that
 * should not. "In 6 days" set as one string wastes the only number on the
 * card; as "6" over "days" it reads from across the room.
 */
export function countdownParts(date: Date): { value: string; unit?: string } {
  const days = daysUntil(date);
  if (days <= 0) return { value: "Today" };
  if (days === 1) return { value: "Tomorrow" };
  return { value: String(days), unit: days === 1 ? "day" : "days" };
}

/**
 * The dashboard's theme accent — read the same way as the vacuum widget's
 * (confirmed working there): <html> doesn't carry it, since GlassHome
 * declares theme tokens on a `.dark`/`.light` wrapper further down the
 * tree, and <html> is that div's ancestor — inheritance only flows down.
 * Querying `.dark`/`.light` directly reads it at the actual source.
 */
export function accentColor(): string {
  if (typeof document === "undefined") return "#3b82f6";
  const themeRoot = document.querySelector(".dark, .light") ?? document.body;
  const primary = getComputedStyle(themeRoot).getPropertyValue("--primary").trim();
  return primary || "#3b82f6";
}

export interface WasteTypeStyle {
  color: string;
  icon: string;
}

// Matched by keyword against whatever the municipal provider names the
// pickup — those strings carry extra qualifiers ("(privat) 2-Rad
// 02-woechentl.") that vary per household, so exact matching won't work.
const TYPE_STYLES: [RegExp, WasteTypeStyle][] = [
  [/restabfall|restm[üu]ll/i, { color: "#7b4a2f", icon: "mdi:trash-can" }],
  [/wertstoff|gelbe?\s?(sack|tonne)/i, { color: "#000000", icon: "mdi:recycle" }],
  [/bio|kompost/i, { color: "#4a7c2f", icon: "mdi:leaf" }],
  [/papier|pappe/i, { color: "#2f6fa8", icon: "mdi:file-document-outline" }],
  [/sperrm[üu]ll/i, { color: "#8a5a2f", icon: "mdi:sofa-outline" }],
  [/schadstoff/i, { color: "#b23b3b", icon: "mdi:alert-octagon-outline" }],
];

export function styleForType(type: string): WasteTypeStyle {
  for (const [pattern, style] of TYPE_STYLES) {
    if (pattern.test(type)) return style;
  }
  return { color: "#5a5a5a", icon: "mdi:trash-can-outline" };
}

/** Strips the municipal qualifier suffix down to the recognizable type name. */
export function shortTypeLabel(type: string): string {
  const idx = type.indexOf("(");
  return (idx > 0 ? type.slice(0, idx) : type).trim();
}
