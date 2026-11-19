import type { EntityView } from "@glasshome/widget-sdk";
import { onColour } from "../media-player/util";
import { isDarkTheme, themeRoot as readThemeRoot } from "../theme";

export function attr<T>(entity: EntityView | undefined, key: string, fallback: T): T {
  const value = entity?.attributes?.[key];
  return (value ?? fallback) as T;
}

export const numeric = (entity: EntityView | undefined): number | undefined => {
  const value = Number(entity?.state);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * The dashboard's own colours, read off the `.dark`/`.light` wrapper.
 *
 * The tile renders in a closed shadow root, which custom properties do not
 * cross, so none of the theme's tokens reach it — they have to be read here
 * and re-declared. The board takes its surface from --card rather than a
 * hardcoded grey so it matches whatever card colour is set in the dashboard's
 * settings, the same as every other card on the screen.
 */
export function themeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};

  const root = readThemeRoot();
  const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const vars: Record<string, string> = {};

  /* Not a colour: a declaration that this subtree already has a theme.
   *
   * Android System WebView — which is what Fully Kiosk renders with — applies
   * "algorithmic darkening" to pages that do not say which scheme they are
   * drawn for. It inverts light colours, which on an already-dark dashboard
   * turns white chips and switch knobs black and flattens the faint tints the
   * cards are separated by, so every card looks like the panel behind it.
   * Declaring the scheme opts the widget out of that treatment. */
  const scheme = isDarkTheme() ? "dark" : "light";
  vars["color-scheme"] = scheme;

  const primary = read("--primary");
  const card = read("--card");
  const foreground = read("--foreground");
  const border = read("--border");
  /* The dashboard's page colour. A card colour set in settings can carry
     transparency, and anything painted with it alone lets whatever is behind
     show through — which is how the overlay ended up showing the board's own
     card down its right-hand side. */
  const page = read("--background");

  if (primary) {
    vars["--rb-primary"] = primary;
    /* What sits on it: a light primary gets dark icons and words. */
    vars["--rb-on-primary"] = onColour(primary, read("--primary-foreground") || undefined);
  }
  if (card) vars["--rb-card"] = card;
  if (foreground) vars["--rb-fg"] = foreground;
  if (border) vars["--rb-border"] = border;
  if (page) vars["--rb-page"] = page;
  return vars;
}

/**
 * An icon the icon service can actually serve.
 *
 * Home Assistant entities carry whatever icon set their integration installs —
 * `phu:` from the Philips Hue pack, `hue:`, and other HACS collections that
 * exist only inside that Home Assistant. Rendering one here sends the browser
 * looking for a collection nobody publishes, which answers 404 and leaves a
 * blank where the icon should be. Only the sets that are actually served are
 * passed through; anything else falls back to the widget's own choice.
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

/* ---------- what a reading means ---------- */

/**
 * The line under a card's title.
 *
 * A number on its own asks the reader to remember what good looks like for
 * CO₂ in ppm or PM2.5 in µg/m³. The bands are the conventional public-health
 * ones where there are any, and common comfort ranges where there are not.
 */
export function verdict(deviceClass: string, value: number): string {
  const bands = VERDICTS[deviceClass];
  return bands ? inBand(value, bands) : "";
}

/**
 * A scale as bands, lowest first: each its upper edge, whether a reading on
 * the edge is still in it, and what the band says — the last, with no edge,
 * everything above.
 */
type Band<T> = [edge: number, onEdge: "in" | "out", says: T];
type Scale<T> = { bands: Band<T>[]; above: T };

function inBand<T>(value: number, scale: Scale<T>): T {
  for (const [edge, onEdge, says] of scale.bands) {
    if (value < edge || (onEdge === "in" && value === edge)) return says;
  }
  return scale.above;
}

const PARTICLES: Scale<string> = { bands: [[12, "out", "Good"], [35, "out", "Moderate"]], above: "Poor" };
const VOC: Scale<string> = { bands: [[300, "out", "Within normal"]], above: "Elevated" };
const PRESSURE: Scale<string> = { bands: [[1000, "out", "Low"], [1020, "in", "Steady"]], above: "High" };

const VERDICTS: Record<string, Scale<string>> = {
  temperature: { bands: [[17, "out", "A little cool"], [23, "in", "Comfortable"], [26, "in", "A little hot"]], above: "Hot" },
  humidity: { bands: [[35, "out", "Dry"], [60, "in", "Moderate"], [70, "in", "Humid"]], above: "Very humid" },
  carbon_dioxide: { bands: [[800, "out", "Within normal"], [1200, "out", "Above average"]], above: "High" },
  pm25: PARTICLES,
  pm10: PARTICLES,
  volatile_organic_compounds: VOC,
  volatile_organic_compounds_parts: VOC,
  illuminance: { bands: [[50, "out", "Dim"], [500, "out", "Comfortable"]], above: "Bright" },
  pressure: PRESSURE,
  atmospheric_pressure: PRESSURE,
  battery: { bands: [[20, "out", "Low"]], above: "Normal" },
};

/** A comfort range: 1 inside the good range, 0.6 inside the fair one, 0.25 outside. */
const comfort = (value: number, good: [number, number], fair: [number, number]) => {
  if (value >= good[0] && value <= good[1]) return 1;
  return value >= fair[0] && value <= fair[1] ? 0.6 : 0.25;
};

const PARTICLE_HEALTH: Scale<number> = { bands: [[12, "out", 1], [35, "out", 0.55]], above: 0.2 };

/** Roughly how good a reading is, 0–1, for the colour the chart is drawn in. */
const HEALTH: Record<string, (value: number) => number> = {
  temperature: (v) => comfort(v, [18, 24], [15, 27]),
  humidity: (v) => comfort(v, [35, 60], [25, 70]),
  carbon_dioxide: (v) => inBand(v, { bands: [[800, "out", 1], [1200, "out", 0.55]], above: 0.2 }),
  pm25: (v) => inBand(v, PARTICLE_HEALTH),
  pm10: (v) => inBand(v, PARTICLE_HEALTH),
  battery: (v) => inBand(v, { bands: [[20, "out", 0.2], [40, "out", 0.6]], above: 1 }),
};

export function health(deviceClass: string, value: number): number {
  return HEALTH[deviceClass]?.(value) ?? 1;
}

/** "3 min ago", for the hero's freshness line. */
export function sinceLabel(when: Date | string | undefined): string {
  if (!when) return "";
  const then = when instanceof Date ? when.getTime() : new Date(when).getTime();
  if (!Number.isFinite(then)) return "";

  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * The device class, read off the field rather than out of the attributes.
 *
 * EntityView deliberately strips device_class, unit_of_measurement,
 * friendly_name and icon out of `attributes` and surfaces them as resolved
 * fields instead — so asking `attributes.device_class` returns nothing for
 * every entity, which is why a room with eighty-five of them charted none.
 */
export const classOf = (entity: EntityView): string => entity.deviceClass ?? "";

/**
 * Which readings lead, and in what order — how much somebody standing in the
 * room would care about each.
 */
export const METRIC_ORDER = [
  "temperature",
  "humidity",
  "carbon_dioxide",
  "pm25",
  "pm10",
  "volatile_organic_compounds",
  "volatile_organic_compounds_parts",
  "illuminance",
  "pressure",
  "atmospheric_pressure",
  "power",
  "energy",
];

/**
 * The readings worth a card.
 *
 * Ranked rather than whitelisted: the classes above come first in that order,
 * and any other numeric sensor with a unit follows. A whitelist alone left a
 * board empty in a room full of perfectly chartable sensors that happened to
 * carry an unusual class or none at all.
 *
 * Diagnostic and config entities are dropped outright — that is where the
 * battery levels, signal strengths and uptime counters live, and Home
 * Assistant has already labelled them as not being what the room is about.
 */
export function metricsOf(entities: EntityView[]): EntityView[] {
  const scored = entities
    .filter(
      (entity) =>
        entity.domain === "sensor" &&
        !entity.entityCategory &&
        !entity.isHidden &&
        numeric(entity) !== undefined,
    )
    .map((entity) => {
      const known = METRIC_ORDER.indexOf(classOf(entity));
      // Unclassified sensors sort after every known class, and ones without
      // even a unit after those — a bare counter is the least useful card.
      const unknown = entity.unitOfMeasurement ? 100 : 200;
      return { entity, rank: known >= 0 ? known : unknown };
    });

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.entity.friendlyName ?? a.entity.id).localeCompare(b.entity.friendlyName ?? b.entity.id),
  );
  return scored.map((row) => row.entity);
}

/**
 * The colour a reading is drawn in — chart, icon and all.
 *
 * One function so the two can never disagree: a blue droplet over an amber
 * chart is two different opinions about the same number. Temperature slides
 * its own cold-to-hot ramp; everything else — humidity included — runs from
 * the dashboard's own accent towards amber as the reading gets worse, so the
 * board keeps whatever colour the dashboard is set to.
 */
/* Each kind of reading in a colour of its own, so a row of tiles reads at a
   glance — water cyan, air green, light yellow — and a bad reading still
   turns amber over it (toneOf mixes towards it by health). */
const KIND_COLOURS: Record<string, string> = {
  humidity: "#22b8e6",
  moisture: "#22b8e6",
  carbon_dioxide: "#2ec27e",
  volatile_organic_compounds: "#84cc16",
  volatile_organic_compounds_parts: "#84cc16",
  pm25: "#a78bfa",
  pm10: "#a78bfa",
  pm1: "#a78bfa",
  illuminance: "#eab308",
  pressure: "#818cf8",
  atmospheric_pressure: "#818cf8",
  power: "#f472b6",
  energy: "#fb7185",
  battery: "#22c55e",
  sound_pressure: "#f472b6",
};

export function toneOf(deviceClass: string, value: number | undefined): string {
  if (deviceClass === "temperature" && value !== undefined) {
    return `color-mix(in srgb, #ff8a3d ${Math.round(warmth(value) * 100)}%, #4f9dff)`;
  }

  const good = value === undefined ? 1 : health(deviceClass, value);
  const own = KIND_COLOURS[deviceClass] ?? "var(--rb-primary, #3b82f6)";
  return `color-mix(in srgb, ${own} ${Math.round(good * 100)}%, #f59e0b)`;
}

/**
 * How warm a temperature is, 0 (cold) to 1 (hot).
 *
 * Anchored to what a room feels like rather than to a sensor's range: 14° is
 * as cold as a living room gets before it is simply cold, 30° as hot. Clamped
 * at both ends so an outdoor probe reading -5 does not drag every chart in the
 * house to the blue end of the scale.
 */
export function warmth(value: number, low = 14, high = 30): number {
  if (high <= low) return 0.5;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

/**
 * Where the maps get their tiles.
 *
 * Not OpenStreetMap's own server any more. Its tile usage policy forbids
 * proxying, and it enforces that: every request through the dashboard's image
 * proxy comes back as a 6987-byte "blocked" placeholder carrying
 * `x-blocked: Access denied`, served with a 200 so nothing errors — a map that
 * loads perfectly and shows nothing. Under the burst of twenty or thirty tiles
 * a map asks for at once, most of them 401 outright.
 *
 * Nor Carto's any more. Their free basemaps went behind an API key: every
 * tile now comes back as a dark square stamped "API KEY REQUIRED", again with
 * a 200, so the map drew perfectly and said nothing but that.
 *
 * Esri's World Dark Gray basemap is served without a key, and it is the same
 * kind of map — a quiet dark canvas for a dashboard to draw its own marks on,
 * not a road atlas. Note the order in Esri's path: row, then column. The
 * attribution below is the one Esri asks for with this basemap.
 */
export const tilePath = (z: number, x: number, y: number) =>
  `server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;

/* The names — towns, districts, roads — on a layer of their own over the
   basemap. Esri serves the dark basemap without any labels at all, which is
   why the map showed streets and not one place name; this is the matching
   reference layer, transparent everywhere but the words. */
export const labelPath = (z: number, x: number, y: number) =>
  `server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`;

/** The address with one more query parameter on the end. */
export function withParam(url: string, key: string, value: string | number): string {
  const joint = url.includes("?") ? "&" : "?";
  return `${url}${joint}${key}=${value}`;
}

export const TILE_CREDIT = "© Esri, HERE, Garmin, © OpenStreetMap";

/**
 * What makes a whole card a button without being one: the role, a place in
 * the tab order, and Enter or Space to open it as a click does. A card
 * cannot be a <button> itself — arranging lays buttons of its own over every
 * card, and a button cannot hold buttons. A key pressed on a button inside
 * the card is that button's, not the card's.
 */
export function openable(open: () => void, label?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: open,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
  };
}
