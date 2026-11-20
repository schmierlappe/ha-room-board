import { createSignal } from "solid-js";

/**
 * Channel logos from the picons project, for a receiver's channels.
 *
 * They live in a file beside the card, dist/room-board-picons.js (built from
 * picons/ by scripts/picons.ts), not in the card itself: the picons are
 * GPL-3.0 and the card is MIT. The file is loaded the first time a channel
 * asks for its logo, and until it has come — or if it never does, say on an
 * install that lacks it — the channel keeps the face it had before
 * (channels.ts): a logo from Simple Icons, or its name on its colour.
 */

type Table = Record<string, [string, string?]>;
let table: Table | undefined;
let asked = false;
const [loaded, setLoaded] = createSignal(0);

function load() {
  if (asked) return;
  asked = true;
  try {
    const url = new URL(/* @vite-ignore */ "./room-board-picons.js", import.meta.url).href;
    void import(/* @vite-ignore */ url)
      .then((module: { default?: Table }) => {
        table = module.default ?? {};
        setLoaded((n) => n + 1);
      })
      .catch(() => {
        table = {};
      });
  } catch {
    table = {};
  }
}

/** The picons' own names for some channels a receiver calls otherwise. */
const ALIAS: Record<string, string> = {
  ard: "daserste",
  dasersteard: "daserste",
  nitro: "rtlnitro",
  superrtl: "rtlsuper",
  pro7: "prosieben",
  pro7maxx: "prosiebenmaxx",
  kabel1: "kabeleins",
  kabel1doku: "kabeleinsdoku",
  rtl2: "rtlzwei",
  hr: "hrfernsehen",
  ntv: "ntv",
  ardone: "one",
  eurosport: "eurosport1",
  sr: "srfernsehen",
};

/** A channel's name as the picons name it: "Das Erste HD" → "daserste". */
export const piconKey = (name: string) => {
  const key = name
    .toLowerCase()
    .replace(/\((.*?)\)/g, "")
    .replace(/\b(uhd|hd|sd|4k|fhd)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return ALIAS[key] ?? key;
};

/** The channel's logo, for a dark background; undefined until the file has come or if there is none. */
export function picon(name: string | undefined): string | undefined {
  if (!name) return undefined;
  loaded();
  if (!table) {
    load();
    return undefined;
  }
  return table[piconKey(name)]?.[0] || undefined;
}
