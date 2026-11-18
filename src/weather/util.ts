import type { JSX } from "solid-js";
import type { EntityView } from "@glasshome/widget-sdk";
import { isDarkTheme, themeRoot as readThemeRoot } from "../theme";

/**
 * The dashboard's accent sits on a `.dark`/`.light` wrapper div, and custom
 * properties don't inherit into a shadow root — so it has to be read out and
 * re-declared on the widget. Same approach the vacuum and header widgets use.
 */
export function themeVars(backdrop = false): JSX.CSSProperties {
  const vars: Record<string, string> = {};

  if (typeof document !== "undefined") {
    const themeRoot = readThemeRoot();
    const primary = getComputedStyle(themeRoot).getPropertyValue("--primary").trim();
    if (primary) vars["--wx-primary"] = primary;

    /* The scrim behind the readings has to darken on a dark card and lighten
       on a light one, so it can't be derived from currentColor — that runs the
       wrong way. The theme wrapper's own class is the only honest signal. */
    /* A tile that is a sky is dark in every theme — every condition is
       painted as a sky now (styles.ts) — so its shade, its text shadow and
       its clouds are the dark set whatever the dashboard's theme. */
    const dark =
      backdrop ||
isDarkTheme();
    vars["--wx-scrim"] = dark ? "rgb(9 12 18 / 0.62)" : "rgb(248 250 252 / 0.7)";
    vars["--wx-ink-shadow"] = dark
      ? "0 1px 10px rgb(2 6 12 / 0.55)"
      : "0 1px 10px rgb(255 255 255 / 0.7)";

    /* Cloud masses have to contrast with the card they sit on: pale on a dark
       card, slate on a light one. Light-on-light was invisible. */
    vars["--wx-cloud-1"] = dark ? "rgb(226 232 240 / 0.95)" : "rgb(148 163 184 / 0.8)";
    vars["--wx-cloud-2"] = dark ? "rgb(203 213 225 / 0.5)" : "rgb(100 116 139 / 0.36)";
  }

  return vars as JSX.CSSProperties;
}

export function attr<T>(entity: EntityView | undefined, key: string, fallback: T): T {
  const value = entity?.attributes?.[key];
  return (value ?? fallback) as T;
}

/** The animated scenes. Several Home Assistant conditions share one scene. */
export type Scene = "sun" | "moon" | "cloud" | "partly" | "rain" | "snow" | "storm" | "fog" | "wind";

const SCENES: Record<string, Scene> = {
  "clear-night": "moon",
  cloudy: "cloud",
  exceptional: "sun",
  fog: "fog",
  hail: "snow",
  lightning: "storm",
  "lightning-rainy": "storm",
  partlycloudy: "partly",
  pouring: "rain",
  rainy: "rain",
  snowy: "snow",
  "snowy-rainy": "snow",
  sunny: "sun",
  windy: "wind",
  "windy-variant": "wind",
};

export const sceneFor = (state: string | undefined): Scene => SCENES[state ?? ""] ?? "cloud";

/**
 * Whether the sun is down.
 *
 * `sun.sun` is the honest answer and every Home Assistant has one. Where it
 * is missing or unavailable the condition is the only clue left — and only
 * "clear-night" carries it, which is why a sunny-at-midnight card was
 * possible at all. No guessing from the clock: a widget that decides it is
 * night at 19:00 would be wrong for half the year.
 */
export function isNight(sun: EntityView | undefined, condition?: string): boolean {
  const state = sun?.state;
  if (state === "below_horizon") return true;
  if (state === "above_horizon") return false;
  return condition === "clear-night";
}

const LABELS: Record<string, string> = {
  "clear-night": "Clear",
  cloudy: "Cloudy",
  exceptional: "Exceptional",
  fog: "Fog",
  hail: "Hail",
  lightning: "Thunderstorm",
  "lightning-rainy": "Thunderstorms",
  partlycloudy: "Partly cloudy",
  pouring: "Heavy rain",
  rainy: "Rain",
  snowy: "Snow",
  "snowy-rainy": "Sleet",
  sunny: "Sunny",
  windy: "Windy",
  "windy-variant": "Windy",
};

export const conditionLabel = (state: string | undefined): string =>
  LABELS[state ?? ""] ?? (state ? state.replaceAll(/[-_]/g, " ") : "Unknown");

/** Rounded: a weather tile showing 14.4° reads as false precision. */
export const temp = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°` : "—";

export const num = (value: unknown, digits = 0): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";

export function dayName(date: Date, index: number): string {
  if (index === 0) return "Today";
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export const hourLabel = (date: Date): string =>
  date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Four or five of these share a tile's width, so the minutes have to go. */
export const hourShort = (date: Date): string =>
  date.toLocaleTimeString(undefined, { hour: "numeric" });

export const compass = (bearing: unknown): string => {
  if (typeof bearing !== "number" || !Number.isFinite(bearing)) return "";
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(bearing / 45) % 8]!;
};

export type ForecastEntry = {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
};

/**
 * `weather.get_forecasts` answers keyed by entity id, each holding a
 * `forecast` array. Anything else — an older core, a broken integration — is
 * treated as no forecast rather than throwing into the render.
 */
export function readForecast(response: unknown, entityId: string): ForecastEntry[] {
  const bag = response as Record<string, { forecast?: ForecastEntry[] }> | undefined;
  const list = bag?.[entityId]?.forecast;
  return Array.isArray(list) ? list : [];
}

/* ---------- forecast support ---------- */

/** Home Assistant's WeatherEntityFeature bits. */
const FORECAST_DAILY = 1;
const FORECAST_HOURLY = 2;

/**
 * A weather entity advertises which forecast types it has. Asking for one it
 * does not support raises an error the dashboard shows as a toast — and a
 * daily-only entity (Tomorrow.io's "Home Daily", for instance) will reject
 * every hourly request, once per page load, forever. Checking first means the
 * call is never made.
 *
 * When the attribute is missing the answer is "try it": an older integration
 * that does support forecasts should not be locked out by a silent default.
 */
export function supportsForecast(entity: EntityView | undefined, kind: "daily" | "hourly"): boolean {
  const features = attr<unknown>(entity, "supported_features", undefined);
  if (typeof features !== "number" || !Number.isFinite(features)) return true;
  return (features & (kind === "daily" ? FORECAST_DAILY : FORECAST_HOURLY)) !== 0;
}

/* ---------- pollen ---------- */

export type Pollen = {
  id: string;
  name: string;
  value: number;
  max: number;
  /** 0–4, indexing BANDS — drives both the wording and the filled segments. */
  band: number;
  label: string;
  color: string;
  icon: string;
};

/** Home Assistant's own icon wins; otherwise the name is the only clue. */
const PLANT_ICONS: [RegExp, string][] = [
  [/gr[aä]s|grass|poaceae/i, "mdi:grass"],
  [/birk|birch|betula/i, "mdi:tree"],
  [/erle|alder|alnus/i, "mdi:tree-outline"],
  [/hasel|hazel|corylus/i, "mdi:nut"],
  [/beifu(ss|ß)|mugwort|artemisia/i, "mdi:flower"],
  [/ambrosia|ragweed/i, "mdi:flower-outline"],
  [/roggen|rye|secale/i, "mdi:barley"],
  [/esche|ash|fraxinus/i, "mdi:leaf"],
  [/pappel|poplar|weide|willow/i, "mdi:tree"],
];

export function pollenIcon(name: string, entityIcon?: string): string {
  if (entityIcon) return entityIcon;
  for (const [pattern, icon] of PLANT_ICONS) if (pattern.test(name)) return icon;
  return "mdi:flower-pollen";
}

const TEXT_LEVELS: Record<string, number> = {
  none: 0,
  keine: 0,
  low: 1,
  gering: 1,
  moderate: 2,
  medium: 2,
  mittel: 2,
  high: 3,
  hoch: 3,
  "very high": 4,
  "very_high": 4,
  extreme: 4,
};

const BANDS = [
  { label: "None", color: "#64748b" },
  { label: "Low", color: "#22c55e" },
  { label: "Moderate", color: "#eab308" },
  { label: "High", color: "#f97316" },
  { label: "Very high", color: "#ef4444" },
];

/**
 * Pollen sensors disagree about scale. DWD reports 0–3 in half steps, other
 * integrations report 1–5, and some report words. All three are normalised to
 * the five bands above so one bar renders them all.
 */
export function readPollen(entity: EntityView | undefined, id: string): Pollen {
  const name = entity?.friendlyName ?? id;
  const raw = (entity?.state ?? "").trim();
  const asNumber = Number(raw);

  let value: number;
  let max: number;

  if (raw && Number.isFinite(asNumber)) {
    // A 0–3 scale (DWD) and a 1–5 scale both exist; the value itself is the
    // only clue, so anything above 3 is read as the wider scale.
    max = asNumber > 3 ? 5 : 3;
    value = asNumber;
  } else {
    max = 4;
    value = TEXT_LEVELS[raw.toLowerCase()] ?? 0;
  }

  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const index = Math.min(BANDS.length - 1, Math.round(ratio * (BANDS.length - 1)));
  const band = BANDS[index]!;

  return {
    id,
    name,
    value,
    max,
    band: index,
    label: band.label,
    color: band.color,
    icon: pollenIcon(name, attr<string | undefined>(entity, "icon", undefined)),
  };
}

export const POLLEN_BANDS = BANDS.length;

/* ---------- gallery stand-ins ---------- */

/** Previews have no Home Assistant, so the gallery would otherwise shoot em dashes. */
export function sampleForecast(): ForecastEntry[] {
  const day = 86_400_000;
  const start = Date.now();
  const rows: [string, number, number, number][] = [
    ["partlycloudy", 21, 12, 10],
    ["sunny", 24, 13, 0],
    ["rainy", 18, 11, 80],
    ["pouring", 16, 10, 95],
    ["cloudy", 19, 12, 20],
    ["sunny", 23, 14, 5],
    ["partlycloudy", 22, 13, 15],
  ];

  return rows.map(([condition, temperature, templow, probability], i) => ({
    datetime: new Date(start + i * day).toISOString(),
    condition,
    temperature,
    templow,
    precipitation_probability: probability,
  }));
}

export function sampleHourly(): ForecastEntry[] {
  const hour = 3_600_000;
  const start = new Date().setMinutes(0, 0, 0);
  const rows: [string, number][] = [
    ["partlycloudy", 21],
    ["cloudy", 20],
    ["rainy", 18],
    ["rainy", 17],
    ["cloudy", 16],
    ["clear-night", 15],
  ];

  return rows.map(([condition, temperature], i) => ({
    datetime: new Date(start + (i + 1) * hour).toISOString(),
    condition,
    temperature,
  }));
}

export function samplePollen(): Pollen[] {
  const rows: [string, string, number][] = [
    ["grasses", "Grasses", 2.5],
    ["birch", "Birch", 1],
    ["alder", "Alder", 0],
    ["mugwort", "Mugwort", 3],
  ];

  return rows.map(([id, name, value]) => {
    const index = Math.min(BANDS.length - 1, Math.round((value / 3) * (BANDS.length - 1)));
    return {
      id,
      name,
      value,
      max: 3,
      band: index,
      label: BANDS[index]!.label,
      color: BANDS[index]!.color,
      icon: pollenIcon(name),
    };
  });
}

/* ---------- DWD severe weather warnings ---------- */

export type Warning = {
  key: string;
  level: number;
  event: string;
  headline: string;
  description: string;
  instruction: string;
  start?: number;
  end?: number;
  label: string;
  color: string;
};

/** DWD's own scale: 0 none, 1 minor, 2 moderate, 3 severe, 4 extreme. */
const WARN_BANDS = [
  { label: "No warning", color: "#64748b" },
  { label: "Minor", color: "#eab308" },
  { label: "Moderate", color: "#f97316" },
  { label: "Severe", color: "#ef4444" },
  { label: "Extreme", color: "#a855f7" },
];

const band = (level: number) => WARN_BANDS[Math.min(WARN_BANDS.length - 1, Math.max(0, level))]!;

const asTime = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    // The integration has reported both seconds and milliseconds over time.
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

/**
 * `dwd_weather_warnings` publishes each warning as a numbered set of
 * attributes — warning_1_level, warning_1_headline and so on — with
 * `warning_count` saying how many there are. Attribute names have drifted
 * between releases (start vs start_time), so both spellings are accepted and
 * a missing field is simply left out rather than failing the whole read.
 */
export function readWarnings(entity: EntityView | undefined, id: string): Warning[] {
  if (!entity) return [];

  const count = Number(attr<unknown>(entity, "warning_count", 0));
  const out: Warning[] = [];

  // No count but a numeric state still means "there is a warning at this
  // level" — enough to raise the badge even without the detail attributes.
  if (!Number.isFinite(count) || count <= 0) {
    const level = Number(entity.state);
    if (Number.isFinite(level) && level > 0) {
      out.push({
        key: `${id}-state`,
        level,
        event: entity.friendlyName ?? id,
        headline: `${band(level).label} weather warning`,
        description: "",
        instruction: "",
        label: band(level).label,
        color: band(level).color,
      });
    }
    return out;
  }

  for (let i = 1; i <= count; i++) {
    const level = Number(attr<unknown>(entity, `warning_${i}_level`, 0)) || 0;
    const headline = attr<string>(entity, `warning_${i}_headline`, "");
    const event = attr<string>(entity, `warning_${i}_name`, "") ||
      attr<string>(entity, `warning_${i}_event`, "");

    out.push({
      key: `${id}-${i}`,
      level,
      event: event || band(level).label,
      headline: headline || event || band(level).label,
      description: attr<string>(entity, `warning_${i}_description`, ""),
      instruction: attr<string>(entity, `warning_${i}_instruction`, ""),
      start:
        asTime(attr<unknown>(entity, `warning_${i}_start`, undefined)) ??
        asTime(attr<unknown>(entity, `warning_${i}_start_time`, undefined)),
      end:
        asTime(attr<unknown>(entity, `warning_${i}_end`, undefined)) ??
        asTime(attr<unknown>(entity, `warning_${i}_end_time`, undefined)),
      label: band(level).label,
      color: attr<string>(entity, `warning_${i}_color`, "") || band(level).color,
    });
  }

  return out;
}

/** Most severe first: that is the one the card badge has to speak for. */
export const sortWarnings = (list: Warning[]) => [...list].sort((a, b) => b.level - a.level);

export function warningWindow(w: Warning): string {
  if (!w.start && !w.end) return "";
  const fmt = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (w.start && w.end) return `${fmt(w.start)} — ${fmt(w.end)}`;
  return fmt((w.start ?? w.end)!);
}
