import type { Brand } from "./brand";

/**
 * TV channels' faces, for a receiver's favourites (a Vu+ or any Enigma2 box
 * lists its bouquet as the source list: "Das Erste HD", "ZDF HD", …).
 *
 * Home Assistant gives a picture only for the channel that is on, so the
 * list's tiles come from here: the channel's logo where Simple Icons carries
 * it, else its name set on the channel's colour. Matched on the whole name
 * with HD/UHD/SD taken off, so a speaker's "RTL Radio" is not RTL.
 */
const CHANNELS: [RegExp, Omit<Brand, "name">][] = [
  [/^(das erste|ard)$/, { icon: "brand:daserste", fg: "#ffffff", bg: "#001a4b" }],
  [/^zdf$/, { icon: "brand:zdf", fg: "#ffffff", bg: "#fa7d19" }],
  [/^rtl$/, { icon: "brand:rtl", fg: "#ffffff", bg: "#141414" }],
  [/^sat ?\.? ?1$/, { icon: "brand:sat1", fg: "#ffffff", bg: "linear-gradient(150deg, #19a4d6, #047da3)" }],
  [/^vox$/, { icon: "brand:vox", fg: "#ffffff", bg: "#da074a" }],
  [/^(prosieben|pro ?7)$/, { icon: "brand:prosieben", fg: "#ffffff", bg: "#e6000f" }],
  [/^(rtl ?zwei|rtl ?2)$/, { icon: "brand:rtlzwei", fg: "#ffffff", bg: "#00bcf6" }],
  [/^ndr\b/, { icon: "brand:ndr", fg: "#ffffff", bg: "#0c1754" }],
  [/^swr\b/, { icon: "brand:swr", fg: "#ffffff", bg: "#1a1a1a" }],
  [/^tele ?5$/, { icon: "brand:tele5", fg: "#ffffff", bg: "#ff00ff" }],
  [/^sky( .+)?$/, { icon: "brand:sky", fg: "#ffffff", bg: "linear-gradient(150deg, #0072c9, #00287a)" }],
  [/^dazn( .+)?$/, { icon: "brand:dazn", fg: "#f5f5f5", bg: "#0c161c" }],
  [/^kabel ?(eins|1)$/, { icon: "wordmark:kabel eins", fg: "#ffffff", bg: "#0b4fa1" }],
  [/^kabel ?(eins|1) doku$/, { icon: "wordmark:k1 doku", fg: "#ffffff", bg: "#0b4fa1" }],
  [/^super ?rtl$/, { icon: "wordmark:SUPER RTL", fg: "#ffffff", bg: "#e4002b" }],
  [/^toggo( plus)?$/, { icon: "wordmark:TOGGO", fg: "#ffffff", bg: "#e4002b" }],
  [/^rtl ?up$/, { icon: "wordmark:RTLup", fg: "#ffffff", bg: "#141414" }],
  [/^nitro$|^rtl ?nitro$/, { icon: "wordmark:NITRO", fg: "#ffffff", bg: "#141414" }],
  [/^n-? ?tv$/, { icon: "wordmark:ntv", fg: "#ffffff", bg: "#d8001c" }],
  [/^welt$/, { icon: "wordmark:WELT", fg: "#ffffff", bg: "#00253f" }],
  [/^sixx$/, { icon: "wordmark:sixx", fg: "#ffffff", bg: "#e6007e" }],
  [/^prosieben ?maxx$/, { icon: "wordmark:MAXX", fg: "#ffffff", bg: "#2d2d2d" }],
  [/^sat ?\.? ?1 gold$/, { icon: "wordmark:SAT.1 GOLD", fg: "#2b2b2b", bg: "#e6c35c" }],
  [/^dmax$/, { icon: "wordmark:DMAX", fg: "#ffffff", bg: "#111111" }],
  [/^tlc$/, { icon: "wordmark:TLC", fg: "#ffffff", bg: "#d6006f" }],
  [/^arte$/, { icon: "wordmark:arte", fg: "#ffffff", bg: "#fa481c" }],
  [/^3 ?sat$/, { icon: "wordmark:3sat", fg: "#ffffff", bg: "#e3051b" }],
  [/^phoenix$/, { icon: "wordmark:phoenix", fg: "#ffffff", bg: "#0078c8" }],
  [/^kika$/, { icon: "wordmark:KiKA", fg: "#ffffff", bg: "#7bb928" }],
  [/^one$/, { icon: "wordmark:ONE", fg: "#ffffff", bg: "#4d1a6e" }],
  [/^tagesschau ?24$/, { icon: "wordmark:tagesschau24", fg: "#ffffff", bg: "#002b5c" }],
  [/^zdf ?neo$/, { icon: "wordmark:ZDFneo", fg: "#ffffff", bg: "#00a3bd" }],
  [/^zdf ?info$/, { icon: "wordmark:ZDFinfo", fg: "#ffffff", bg: "#2c5d8f" }],
  [/^(br|bayerisches fernsehen)\b/, { icon: "wordmark:BR", fg: "#ffffff", bg: "#0064b4" }],
  [/^wdr\b/, { icon: "wordmark:WDR", fg: "#ffffff", bg: "#00345e" }],
  [/^mdr\b/, { icon: "wordmark:MDR", fg: "#ffffff", bg: "#0060a9" }],
  [/^hr\b/, { icon: "wordmark:hr", fg: "#ffffff", bg: "#0074bc" }],
  [/^rbb\b/, { icon: "wordmark:rbb", fg: "#ffffff", bg: "#e31f26" }],
  [/^sr\b/, { icon: "wordmark:SR", fg: "#ffffff", bg: "#003b7b" }],
  [/^(sport ?1)$/, { icon: "wordmark:SPORT1", fg: "#ffffff", bg: "#002e5a" }],
  [/^eurosport\b/, { icon: "wordmark:eurosport", fg: "#ffffff", bg: "#141b4d" }],
  [/^comedy central$/, { icon: "wordmark:COMEDY", fg: "#111111", bg: "#ffd200" }],
  [/^mtv$/, { icon: "wordmark:MTV", fg: "#111111", bg: "#ffffff" }],
  [/^nickelodeon|^nick$/, { icon: "wordmark:nick", fg: "#ffffff", bg: "#ff7300" }],
  [/^disney channel$/, { icon: "wordmark:Disney", fg: "#ffffff", bg: "#1a3a8f" }],
  [/^servus ?tv$/, { icon: "wordmark:ServusTV", fg: "#ffffff", bg: "#2b2b2b" }],
  [/^orf ?(1|2|eins|iii|iii)$/, { icon: "wordmark:ORF", fg: "#ffffff", bg: "#cc0000" }],
  [/^srf ?(1|zwei|info)$/, { icon: "wordmark:SRF", fg: "#ffffff", bg: "#af001e" }],
];

/** The channel's name as matched: lower case, its picture quality taken off. */
const bare = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(u?hd|sd|4k)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The face for a channel in a receiver's list, where it is one known here. */
export function channelBrand(name: string): Brand | undefined {
  const key = bare(name);
  const found = CHANNELS.find(([pattern]) => pattern.test(key));
  return found ? { name, ...found[1] } : undefined;
}
