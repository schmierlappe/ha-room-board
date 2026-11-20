/**
 * Builds dist/room-board-picons.js from picons/logos: every channel logo as a
 * data URI, keyed by its picon name ("daserste", "zdfinfo"), the variant for
 * dark backgrounds first and the one for light ones second where there is one.
 *
 * A file of its own, beside the card and not inside it: the logos come from
 * the picons project (https://github.com/picons/picons) under GPL-3.0, and
 * the card is MIT. The card loads this file when a channel tile first needs
 * it (src/media-player/picons.ts).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "picons", "logos");
const table: Record<string, [string, string?]> = {};
const files = readdirSync(dir).sort();
const uri = (file: string) => {
  const data = readFileSync(join(dir, file));
  if (file.endsWith(".svg")) {
    /* Comments and runs of whitespace out; the drawing is the same. */
    const svg = data
      .toString("utf8")
      .replace(/<\?xml[^>]*>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/>\s+</g, "><")
      .replace(/\s{2,}/g, " ")
      .trim();
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
  return `data:image/png;base64,${data.toString("base64")}`;
};
/* The picons' "light" logo is the light-coloured one, made for a dark
   background — which is what the card puts them on; "default" is for a light
   one. The light one where there is one, else the default. Only one goes in:
   the card draws every logo on the same screen-dark tile. */
const chosen = new Map<string, string>();
for (const file of files) {
  const match = /^(.+)\.(default|light)\.(svg|png)$/.exec(file);
  if (!match) continue;
  const key = match[1]!;
  if (match[2] === "light" || !chosen.has(key)) chosen.set(key, file);
}
for (const [key, file] of chosen) table[key] = [uri(file)];

const banner =
  "/*! TV channel logos from the picons project, https://github.com/picons/picons — GPL-3.0 " +
  "(see picons/LICENSE in https://github.com/schmierlappe/ha-room-board). The logos are the " +
  "trademarks of their channels. Loaded by the Room Board card; not part of its MIT code. */\n";
mkdirSync(join(import.meta.dir, "..", "dist"), { recursive: true });
const out = join(import.meta.dir, "..", "dist", "room-board-picons.js");
writeFileSync(out, `${banner}export default ${JSON.stringify(table)};\n`);
console.log(`picons: ${Object.keys(table).length} channels, ${Math.round(readFileSync(out).length / 1024)} KB`);
