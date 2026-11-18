import { For, Show, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { replaceEnclosed } from "../text";

/**
 * Warnings and pollen, read off whatever the room's area happens to hold.
 *
 * Both are found by the shape of what they publish rather than by their
 * entity id, the way the board finds its waste and Plex sensors: the DWD
 * warning sensors are the only ones carrying a `warning_count` beside a
 * `region_name`, and a pollen sensor says so in its own name. That way an
 * English installation, a renamed entity and a second region all still land.
 */

/* ---------- warnings ---------- */

export type Warning = {
  key: string;
  name: string;
  headline: string;
  description: string;
  instruction: string;
  level: number;
  colour: string;
  start?: number;
  end?: number;
  advance: boolean;
};

/** A DWD warning sensor: a level as its state, the warnings as attributes. */
export const isWarningSensor = (entity: EntityView) =>
  entity.domain === "sensor" &&
  entity.attributes?.["warning_count"] !== undefined &&
  entity.attributes?.["region_name"] !== undefined;

/* DWD's own four steps. The feed carries a colour per warning and we use it
   when it looks like one, but a missing or malformed colour must not cost the
   row its severity. */
const LEVEL_COLOUR = ["#94a3b8", "#facc15", "#fb923c", "#ef4444", "#c026d3"];

const LEVEL_NAME = ["None", "Advisory", "Warning", "Severe", "Extreme"];

/** The level as a step between 0 and 4, whatever the feed calls it. */
const levelOf = (raw: unknown) => {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(4, Math.max(0, Math.round(value))) : 0;
};

const colourOf = (raw: unknown, level: number) =>
  typeof raw === "string" && /^#[0-9a-f]{3,8}$/i.test(raw.trim())
    ? raw.trim()
    : LEVEL_COLOUR[level] ?? LEVEL_COLOUR[1]!;

/** Both shapes the feed uses: an ISO stamp, or epoch milliseconds. */
const timeOf = (raw: unknown) => {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 1e11 ? raw : raw * 1000;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");

/** Every warning the area's sensors are carrying, worst first. */
export function warningsOf(entities: EntityView[]): Warning[] {
  const out: Warning[] = [];

  for (const entity of entities.filter(isWarningSensor)) {
    const attrs = entity.attributes ?? {};
    const count = Number(attrs["warning_count"]);
    /* "Advance" is the same sensor a day early: the integration splits the
       two into their own entities and only the id says which is which. */
    const advance = /advance|vorab/i.test(`${entity.id} ${entity.friendlyName ?? ""}`);

    for (let index = 1; index <= (Number.isFinite(count) ? count : 0); index += 1) {
      const at = (key: string) => attrs[`warning_${index}_${key}`];
      const level = levelOf(at("level"));
      const name = text(at("name")) || text(at("event")) || LEVEL_NAME[level] || "Warning";

      out.push({
        key: `${entity.id}-${index}`,
        name,
        headline: text(at("headline")),
        description: text(at("description")),
        instruction: text(at("instruction")),
        level,
        colour: colourOf(at("color"), level),
        start: timeOf(at("start")),
        end: timeOf(at("end")),
        advance,
      });
    }
  }

  /* Worst first, and a warning in force ahead of one still to come: the row
     that needs acting on should never be the third one down. */
  out.sort(
    (a, b) => Number(a.advance) - Number(b.advance) || b.level - a.level || (a.start ?? 0) - (b.start ?? 0),
  );
  return out;
}

/** The kind of weather, from what the warning calls itself. */
function warningIcon(name: string) {
  const what = name.toLowerCase();
  if (/gewitter|thunder|lightning/.test(what)) return "mdi:weather-lightning";
  if (/sturm|orkan|wind|böen|boen|gust|storm/.test(what)) return "mdi:weather-windy";
  if (/schnee|snow|schneefall/.test(what)) return "mdi:weather-snowy-heavy";
  if (/glätte|glaette|frost|ice|eis/.test(what)) return "mdi:snowflake-alert";
  if (/regen|rain|starkregen|flood|hochwasser/.test(what)) return "mdi:weather-pouring";
  if (/hitze|heat|uv/.test(what)) return "mdi:thermometer-alert";
  if (/nebel|fog/.test(what)) return "mdi:weather-fog";
  if (/hagel|hail/.test(what)) return "mdi:weather-hail";
  return "mdi:alert";
}

const clock = (stamp: number) =>
  new Date(stamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const day = (stamp: number) =>
  new Date(stamp).toLocaleDateString(undefined, { weekday: "short" });

/** "until 20:00", or "Tue 06:00 – 14:00" once it runs past today. */
function windowOf(warning: Warning) {
  const now = Date.now();
  const today = new Date().getDate();
  const sameDay = (stamp: number) => new Date(stamp).getDate() === today;

  if (warning.start && warning.start > now) {
    const from = sameDay(warning.start) ? clock(warning.start) : `${day(warning.start)} ${clock(warning.start)}`;
    return warning.end ? `${from} – ${clock(warning.end)}` : `from ${from}`;
  }
  if (warning.end) {
    return sameDay(warning.end)
      ? `until ${clock(warning.end)}`
      : `until ${day(warning.end)} ${clock(warning.end)}`;
  }
  return "";
}

/**
 * The warnings, as banners in the warning's own colour.
 *
 * Tapping one opens what the DWD actually wrote — the headline alone says
 * "Sturmböen", which is not enough to decide whether to move the bins.
 */
export function WeatherWarnings(props: { warnings: Warning[] }) {
  const [open, setOpen] = createSignal("");

  const toggle = (key: string) => setOpen(open() === key ? "" : key);

  return (
    <div class="rb-wxw">
      <For each={props.warnings}>
        {(warning) => (
          <button
            type="button"
            class="rb-wxw-row"
            classList={{ "rb-wxw-row--open": open() === warning.key }}
            style={{ "--rb-wxw-tone": warning.colour }}
            onClick={() => toggle(warning.key)}
          >
            <span class="rb-wxw-mark">
              <Icon icon={warningIcon(warning.name)} width="18" />
            </span>

            <span class="rb-wxw-meta">
              <span class="rb-wxw-name">
                <b class="rb-truncate">{warning.name}</b>
                <Show when={warning.advance}>
                  <i class="rb-wxw-tag">ahead</i>
                </Show>
              </span>

              <span class="rb-wxw-when rb-truncate">
                {[LEVEL_NAME[warning.level], windowOf(warning)].filter(Boolean).join(" · ")}
              </span>

              <Show when={open() === warning.key}>
                <span class="rb-wxw-body">
                  <Show when={warning.headline && warning.headline !== warning.name}>
                    <b>{warning.headline}</b>
                  </Show>
                  <Show when={warning.description}>
                    <span>{warning.description}</span>
                  </Show>
                  <Show when={warning.instruction}>
                    <span class="rb-wxw-do">{warning.instruction}</span>
                  </Show>
                </span>
              </Show>
            </span>

            <Icon
              class="rb-wxw-chev"
              icon={open() === warning.key ? "mdi:chevron-up" : "mdi:chevron-down"}
              width="16"
            />
          </button>
        )}
      </For>
    </div>
  );
}

/* ---------- pollen ---------- */

export type Pollen = {
  key: string;
  name: string;
  /** Where this reading sits on its own source's scale. */
  level: number;
  max: number;
  /** The overall index rather than one plant: it leads the list. */
  summary: boolean;
  tomorrow?: number;
};

/* The allergens these services grade, in both languages, so a sensor called
   plain "Birch" or "Birke" is recognised as pollen. */
const ALLERGENS = [
  ["ambrosia", "ragweed"],
  ["beifuss", "beifuß", "mugwort"],
  ["birke", "birch"],
  ["erle", "alder"],
  ["esche", "ash"],
  ["graeser", "gräser", "grass", "grasses"],
  ["hasel", "hazel"],
  ["roggen", "rye"],
  ["olive"],
  ["ulme", "elm"],
  ["pappel", "poplar"],
  ["platane", "plane"],
  ["weide", "willow"],
  ["zypresse", "cypress"],
  ["brennnessel", "nettle"],
  ["wegerich", "plantain"],
].flat();

/* A word character as a regex's \b reads it — Latin letters, digits and
   the underscore: what a name must not run on into. */
const inWord = (char: string | undefined) => !!char && /\w/.test(char);

/** Whether the label names one of the allergens as a word of its own. */
function namesAllergen(label: string): boolean {
  const text = label.toLowerCase();
  return ALLERGENS.some((name) => {
    for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
      if (!inWord(text[at - 1]) && !inWord(text[at + name.length])) return true;
    }
    return false;
  });
}

/** The combined index some services publish beside the individual plants. */
const SUMMARY = /allergy\s*risk|allergierisiko|pollenbelastung|pollen\s*(index|count|level)/i;

/** An hourly twin of a daily sensor says the same thing twice. */
const HOURLY = /hourly|st(ü|ue)ndlich/i;

/**
 * A pollen sensor, whichever integration publishes it.
 *
 * Four ways in, because the integrations disagree: the word itself, the
 * allergen's name, the combined risk index, or the shape the DWD feed has —
 * a grade today with one for tomorrow beside it.
 */
export const isPollenSensor = (entity: EntityView) => {
  if (entity.domain !== "sensor" || isWarningSensor(entity)) return false;

  const label = `${entity.id} ${entity.friendlyName ?? ""}`;
  if (HOURLY.test(label)) return false;
  if (/pollen/i.test(label)) return true;
  if (entity.attributes?.["state_tomorrow"] !== undefined) return true;
  return SUMMARY.test(label) || namesAllergen(label);
};

/* The words these services grade in, and the German the same services use
   when Home Assistant is set to German. */
const WORDS: Record<string, number> = {
  none: 0,
  keine: 0,
  no: 0,
  low: 1,
  gering: 1,
  niedrig: 1,
  moderate: 2,
  medium: 2,
  "mäßig": 2,
  "maessig": 2,
  mittel: 2,
  high: 3,
  hoch: 3,
  "very high": 4,
  "very_high": 4,
  "sehr hoch": 4,
  extreme: 4,
  extrem: 4,
};

type Grade = { level: number; max: number };

/**
 * A reading on its own source's scale.
 *
 * Three services, three ways of saying the same thing. An enum sensor states
 * its own steps in `options`, which is exact and needs no guessing.
 * Polleninformation grades in words on five steps; the DWD grades in numbers
 * on four and writes its halves as "0-1". All three land here, each keeping
 * the scale it was measured on so the bars stay honest.
 */
function gradeOf(raw: unknown, entity?: EntityView): Grade | undefined {
  const options = entity?.attributes?.["options"];
  if (Array.isArray(options) && options.length > 1 && typeof raw === "string") {
    const index = options.findIndex(
      (option) => String(option).toLowerCase() === raw.trim().toLowerCase(),
    );
    if (index >= 0) return { level: index, max: options.length - 1 };
  }

  if (typeof raw === "string") {
    const word = WORDS[raw.trim().toLowerCase().replaceAll(/[_-]+/g, " ")];
    if (word !== undefined) return { level: word, max: 4 };
  }

  /* What is left is the DWD's own four steps, written either as a number or
     as the span between two of them. Half a step counts as the step above:
     "1-2" is not "low". */
  const span = typeof raw === "string" ? /^(\d)\s*-\s*(\d)$/.exec(raw.trim()) : null;
  const plain = typeof raw === "string" ? raw.replace(",", ".") : raw;
  const value = span ? (Number(span[1]) + Number(span[2])) / 2 : Number(plain);

  if (!Number.isFinite(value)) return undefined;
  /* A sensor reporting past 3 is on the doubled 0–6 scale. */
  const scaled = value > 3 ? value / 2 : value;
  return { level: Math.min(3, Math.ceil(scaled)), max: 3 };
}

/**
 * The plant, without the service's name in front of it.
 *
 * Polleninformation names every sensor "Polleninformation (Kraichtal) Birch",
 * which turns a list of plants into a column of the same four words. Whatever
 * every sensor has in common is the service talking, not the plant, so it
 * goes — along with the place in brackets.
 */
function plantNames(raw: string[]): string[] {
  const stripped = raw.map((name) =>
    replaceEnclosed(name, "(", ")", " ")
      .replaceAll(/pollenflug|polleninformation/gi, " ")
      .replaceAll(/[_-]+/g, " ")
      .replaceAll(/\s{2,}/g, " ")
      .trim(),
  );

  const words = stripped.map((name) => name.split(" ").filter(Boolean));
  let shared = 0;

  if (words.length > 1) {
    const first = words[0]!;
    while (
      shared < first.length - 1 &&
      words.every(
        (parts) =>
          parts.length > shared + 1 &&
          parts[shared]!.toLowerCase() === first[shared]!.toLowerCase(),
      )
    ) {
      shared += 1;
    }
  }

  return words.map((parts, index) => {
    const name = parts.slice(shared).join(" ").trim() || stripped[index]! || raw[index]!;
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

/** What the area's pollen sensors are saying, worst first. */
export function pollenOf(entities: EntityView[]): Pollen[] {
  const found = entities.filter(isPollenSensor);
  const names = plantNames(found.map((entity) => entity.friendlyName ?? entity.id));

  const items = found.flatMap((entity, index) => {
    const today = gradeOf(entity.state, entity);
    if (today === undefined) return [];

    const tomorrow = gradeOf(entity.attributes?.["state_tomorrow"], entity);

    return [
      {
        key: entity.id,
        name: names[index] ?? entity.id,
        level: today.level,
        max: today.max,
        summary: SUMMARY.test(`${entity.id} ${entity.friendlyName ?? ""}`),
        tomorrow: tomorrow?.level,
      },
    ];
  });

  items.sort(
    (a, b) =>
      Number(b.summary) - Number(a.summary) ||
      b.level / b.max - a.level / a.max ||
      a.name.localeCompare(b.name),
  );

  return items;
}

const STEPS = ["None", "Low", "Moderate", "High", "Very high"];

const POLLEN_TONE = ["#64748b", "#22c55e", "#f59e0b", "#ef4444", "#c026d3"];

/** The word for a step, on a scale of that many steps. */
export const pollenLabel = (level: number, max: number) =>
  STEPS[max >= 4 ? Math.min(4, level) : Math.min(3, level)] ?? STEPS[0]!;

const pollenTone = (level: number, max: number) =>
  POLLEN_TONE[max >= 4 ? Math.min(4, level) : Math.min(3, level)] ?? POLLEN_TONE[0]!;

/**
 * The count, as a row per allergen with its load drawn as a bar.
 *
 * Only what is actually flying: a list of ten "none"s is noise, so the quiet
 * allergens collapse into a line of their own at the end. The combined index,
 * where a service publishes one, stays whatever it says.
 */
export function PollenList(props: { items: Pollen[] }) {
  const summary = () => props.items.find((item) => item.summary);
  const plants = () => props.items.filter((item) => !item.summary);
  const flying = () => plants().filter((item) => item.level > 0);
  const quiet = () => plants().filter((item) => item.level <= 0);

  /** The scale drawn as its own steps: four words deserve four blocks. */
  const Meter = (meter: { level: number; max: number }) => (
    <span class="rb-pollen-steps">
      <For each={Array.from({ length: meter.max }, (_, step) => step + 1)}>
        {(step) => <i data-on={step <= meter.level} />}
      </For>
    </span>
  );

  return (
    <div class="rb-pollen">
      <Show when={summary()}>
        {(item) => (
          <div
            class="rb-pollen-sum"
            style={{ "--rb-pollen-tone": pollenTone(item().level, item().max) }}
          >
            <span class="rb-pollen-sum-meta">
              <span class="rb-pollen-sum-label">{item().name}</span>
              <b class="rb-pollen-sum-now">{pollenLabel(item().level, item().max)}</b>
            </span>
            <Meter level={item().level} max={item().max} />
          </div>
        )}
      </Show>

      <For each={flying()}>
        {(item) => (
          <div class="rb-pollen-row" style={{ "--rb-pollen-tone": pollenTone(item.level, item.max) }}>
            <span class="rb-pollen-name rb-truncate">{item.name}</span>

            <Show when={item.tomorrow !== undefined && item.tomorrow !== item.level}>
              <span class="rb-pollen-next">
                <Icon
                  icon={(item.tomorrow ?? 0) > item.level ? "mdi:trending-up" : "mdi:trending-down"}
                  width="13"
                />
                {pollenLabel(item.tomorrow ?? 0, item.max)}
              </span>
            </Show>

            <Meter level={item.level} max={item.max} />

            <span class="rb-pollen-now">{pollenLabel(item.level, item.max)}</span>
          </div>
        )}
      </For>

      <Show when={quiet().length}>
        <p class="rb-pollen-quiet">
          <Icon icon="mdi:check-circle-outline" width="13" />Nothing flying: {quiet().map((item) => item.name).join(", ")}
        </p>
      </Show>
    </div>
  );
}
