/**
 * Vacuum consumables, read as wear rather than as a number of hours.
 *
 * Home Assistant publishes these as "time left" sensors in hours — 130.548333
 * for the filter, 2.70027777 for the side brush. Two problems with showing
 * that: the raw float is noise, and hours only mean something to somebody who
 * already knows the part's rated life. 130 h is nearly a full filter and 2.7 h
 * is a side brush about to be thrown away, and nothing on screen said so.
 *
 * So the rated life is looked up from the part's name and the reading turned
 * into a percentage of it. The lifetimes are the Roborock/Xiaomi factory ones,
 * which are what these sensors count down from.
 */
import type { EntityView } from "@glasshome/widget-sdk";

type Kind = {
  id: string;
  /** Matched against the sensor's name, first hit wins — order matters. */
  test: RegExp;
  label: string;
  icon: string;
  /** Rated life in hours. */
  life: number;
  /** What a reset button for this part calls itself. */
  reset: RegExp;
};

const KINDS: Kind[] = [
  {
    id: "side-brush",
    test: /side\s*brush/,
    label: "Side brush",
    icon: "mdi:broom",
    life: 200,
    reset: /side.?brush/,
  },
  {
    id: "main-brush",
    test: /main\s*brush|roller|brush/,
    label: "Main brush",
    icon: "mdi:rotate-right",
    life: 300,
    reset: /main.?brush/,
  },
  {
    id: "filter",
    test: /filter/,
    label: "Filter",
    icon: "mdi:air-filter",
    life: 150,
    reset: /filter/,
  },
  {
    id: "sensor",
    test: /sensor|dirty/,
    label: "Sensors",
    icon: "mdi:radar",
    life: 30,
    reset: /sensor/,
  },
  {
    id: "mop",
    test: /mop/,
    label: "Mop",
    icon: "mdi:water-outline",
    life: 150,
    reset: /mop/,
  },
  {
    id: "dust",
    test: /dust|bag|bin/,
    label: "Dust bag",
    icon: "mdi:delete-outline",
    life: 150,
    reset: /dust|bag|bin/,
  },
];

/** The lives other makers rate parts at, for a part this file has no entry for. */
const STANDARD = [30, 50, 100, 150, 200, 250, 300, 400, 500];

function ratedLife(kind: Kind | undefined, value: number): number {
  if (kind) return Math.max(kind.life, value);
  // Unknown part: assume it is counting down from whichever standard life it
  // still fits inside, so a reading of 2.7 does not report as full.
  return STANDARD.find((hours) => hours >= value) ?? Math.ceil(value / 50) * 50;
}

/**
 * The device name every sensor carries — "Roborock S7 Filter time left" says
 * the model three times over in a list of four. Dropped when they all share it.
 */
export function commonPrefix(names: string[]): string {
  if (names.length < 2) return "";
  const words = names.map((name) => name.split(/\s+/));
  const first = words[0]!;
  let shared = 0;
  while (shared < first.length - 1 && words.every((w) => w[shared] === first[shared])) shared++;
  return first.slice(0, shared).join(" ");
}

export type Consumable = {
  id: string;
  label: string;
  icon: string;
  /** 0–100, how much life is left. */
  percent: number;
  /** "131 of 150 h" — the reading, for anyone who wants the number back. */
  detail: string;
  /** The button that zeroes this part's counter, when one exists. */
  resetId?: string;
};

/**
 * A hue ramp rather than two states: green at full, amber around a third,
 * red as it runs out, and every shade in between. Wear is continuous, so the
 * colour is too — and it makes the row readable from across the room.
 */
export function wearColor(percent: number): string {
  const hue = Math.max(0, Math.min(140, percent * 1.4));
  return `hsl(${Math.round(hue)} 74% 52%)`;
}

/** The reset button for a part, out of every button entity in the house. */
function resetFor(kind: Kind | undefined, slug: string, buttons: string[]): string | undefined {
  if (!kind) return undefined;
  const resets = buttons.filter((id) => /reset/i.test(id) && kind.reset.test(id.toLowerCase()));
  if (!resets.length) return undefined;
  // Two robots means two sets of reset buttons; prefer the one named after
  // this one, and fall back only when the naming shares nothing.
  return resets.find((id) => (slug ? id.includes(slug) : false)) ?? resets[0];
}

export function readConsumables(
  sensors: EntityView[],
  opts: { vacuumId?: string; buttons?: string[] } = {},
): Consumable[] {
  const names = sensors.map((sensor) => sensor.friendlyName ?? sensor.id);
  const prefix = commonPrefix(names).toLowerCase();
  const slug = (opts.vacuumId ?? "").split(".")[1] ?? "";
  const buttons = opts.buttons ?? [];

  return sensors.map((sensor, index) => {
    const full = names[index] ?? sensor.id;
    const bare = (prefix && full.toLowerCase().startsWith(prefix) ? full.slice(prefix.length) : full)
      .replaceAll(/\b(time\s*)?(left|remaining|remain)\b/gi, "")
      .replaceAll(/\bconsumable\b/gi, "")
      .replaceAll(/\s{2,}/g, " ")
      .trim();

    const kind = KINDS.find((candidate) => candidate.test.test(bare.toLowerCase() || full.toLowerCase()));
    const value = Number(sensor.state);
    const unit = sensor.unitOfMeasurement ?? "";

    // A sensor already reporting a percentage is taken at its word.
    if (unit === "%" && Number.isFinite(value)) {
      return {
        id: sensor.id,
        label: kind?.label ?? bare ?? full,
        icon: kind?.icon ?? sensor.icon ?? "mdi:progress-wrench",
        percent: Math.max(0, Math.min(100, value)),
        detail: `${Math.round(value)}% left`,
        resetId: resetFor(kind, slug, buttons),
      };
    }

    const life = Number.isFinite(value) ? ratedLife(kind, value) : 0;
    const percent = life > 0 ? Math.max(0, Math.min(100, (value / life) * 100)) : 0;

    return {
      id: sensor.id,
      label: kind?.label ?? (bare || full),
      icon: kind?.icon ?? sensor.icon ?? "mdi:progress-wrench",
      percent,
      detail: Number.isFinite(value)
        ? `${Math.round(value)} of ${life} ${unit || "h"}`
        : [sensor.state, unit].filter(Boolean).join(" "),
      resetId: resetFor(kind, slug, buttons),
    };
  });
}
