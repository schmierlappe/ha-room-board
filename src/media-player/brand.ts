import type { EntityView } from "@glasshome/widget-sdk";
import { attr } from "./util";

/** An app's face, drawn as the artwork when the app sends none of its own. */
export type Brand = { name: string; icon: string; fg: string; bg: string };

/*
 * Matched against what the device says it is running — its app name, its
 * app id, its source. A Fire TV or an Android TV reports the package
 * (com.netflix.ninja, com.amazon.avod), a Cast device the app's name, so both
 * are here. The logo in its own colour on its own ground, the way the app's
 * own launcher tile looks: Netflix red on black, YouTube red on white.
 */
/* `brand:<name>` is a logo carried in the card (brand-logos.ts);
   `wordmark:<text>` draws the name, for an app with no logo there. */
const BRANDS: [RegExp, Brand][] = [
  [/netflix/i, { name: "Netflix", icon: "brand:netflix", fg: "#e50914", bg: "#0b0b0b" }],
  [/dazn/i, { name: "DAZN", icon: "brand:dazn", fg: "#f5f5f5", bg: "#0c161c" }],
  [
    /prime\s*video|amazon\s*video|\bavod\b|primevideo/i,
    { name: "Prime Video", icon: "wordmark:prime video", fg: "#ffffff", bg: "#00a8e1" },
  ],
  [
    /disney/i,
    {
      name: "Disney+",
      icon: "wordmark:Disney+",
      fg: "#ffffff",
      bg: "linear-gradient(160deg, #1a3a8f, #0b1440 70%)",
    },
  ],
  [/youtube/i, { name: "YouTube", icon: "brand:youtube", fg: "#ff0033", bg: "#ffffff" }],
  [/spotify/i, { name: "Spotify", icon: "brand:spotify", fg: "#1db954", bg: "#121212" }],
  [/apple\s*tv|com\.apple\.atve/i, { name: "Apple TV", icon: "brand:appletv", fg: "#ffffff", bg: "#0b0b0b" }],
  [/twitch/i, { name: "Twitch", icon: "brand:twitch", fg: "#ffffff", bg: "#9146ff" }],
  [/plex/i, { name: "Plex", icon: "brand:plex", fg: "#e5a00d", bg: "#1f1f1f" }],
  /* Telekom's TV app, on a Fire TV or an Android TV box ("MagentaTV",
     de.telekom.magentatv…): its T on magenta. */
  [/magenta|telekom/i, { name: "MagentaTV", icon: "brand:telekom", fg: "#ffffff", bg: "linear-gradient(150deg, #e20074, #9b0050)" }],
  [/\bzdf/i, { name: "ZDF", icon: "brand:zdf", fg: "#ffffff", bg: "#fa7d19" }],
  [/\brtl/i, { name: "RTL+", icon: "brand:rtl", fg: "#ffffff", bg: "#141414" }],
  [/\bsky\b|sky\s*(go|q|ticket)|\bwow\b/i, { name: "Sky", icon: "brand:sky", fg: "#ffffff", bg: "linear-gradient(150deg, #0072c9, #00287a)" }],
  [/paramount/i, { name: "Paramount+", icon: "brand:paramountplus", fg: "#ffffff", bg: "#0064ff" }],
  [/\bmax\b|hbo/i, { name: "Max", icon: "brand:max", fg: "#ffffff", bg: "#002be7" }],
  [/crunchyroll/i, { name: "Crunchyroll", icon: "brand:crunchyroll", fg: "#ffffff", bg: "#ff5e00" }],
];

/** The app a player is showing, if it is one with a face here. */
export function brandOf(player: EntityView | undefined): Brand | undefined {
  if (!player) return undefined;
  const said = `${attr(player, "app_name", "")} ${attr(player, "app_id", "")} ${attr(player, "source", "")}`;
  if (!said.trim()) return undefined;
  return BRANDS.find(([pattern]) => pattern.test(said))?.[1];
}

/** The style that paints a placeholder as the brand's tile. */
export const brandStyle = (brand: Brand) => ({
  "--brand-bg": brand.bg,
  "--brand-fg": brand.fg,
});

/* Whether a player is a screen rather than a speaker: what Home Assistant
   calls it, an app running on it, or a name that says so. */
const isScreen = (player: EntityView) =>
  player.deviceClass === "tv" ||
  !!attr(player, "app_id", "") ||
  /\b(tv|fire|shield|apple\s*tv|chromecast|android|vu\+|sky|receiver)\b/i.test(player.friendlyName ?? player.id);

/**
 * What to draw for a player with no artwork: the app's own tile where it is
 * one with a face here, else a tile in the theme's accent with a television
 * or a note — rather than a grey square with a small note in it.
 */
export function placeholderBrand(player: EntityView | undefined): Brand {
  const known = brandOf(player);
  if (known) return known;
  return {
    name: "",
    icon: player && isScreen(player) ? "mdi:television-play" : "mdi:music-note",
    fg: "rgba(255, 255, 255, 0.92)",
    bg: "linear-gradient(150deg, var(--rb-primary, var(--mp-primary, #7c5cff)), color-mix(in srgb, var(--rb-primary, var(--mp-primary, #7c5cff)) 30%, #0b0e1a))",
  };
}
