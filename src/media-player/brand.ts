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
const BRANDS: [RegExp, Brand][] = [
  [/netflix/i, { name: "Netflix", icon: "cbi:netflix", fg: "#e50914", bg: "#0b0b0b" }],
  [/dazn/i, { name: "DAZN", icon: "cbi:dazn", fg: "#f5f5f5", bg: "#0c161c" }],
  [
    /prime\s*video|amazon\s*video|\bavod\b|primevideo/i,
    { name: "Prime Video", icon: "simple-icons:primevideo", fg: "#ffffff", bg: "#00a8e1" },
  ],
  [
    /disney/i,
    {
      name: "Disney+",
      icon: "cbi:disney-plus",
      fg: "#ffffff",
      bg: "linear-gradient(160deg, #1a3a8f, #0b1440 70%)",
    },
  ],
  [/youtube/i, { name: "YouTube", icon: "cbi:youtube", fg: "#ff0033", bg: "#ffffff" }],
  [/spotify/i, { name: "Spotify", icon: "cbi:spotify", fg: "#1db954", bg: "#121212" }],
  [/apple\s*tv|com\.apple\.atve/i, { name: "Apple TV", icon: "cbi:apple-tv", fg: "#ffffff", bg: "#0b0b0b" }],
  [/twitch/i, { name: "Twitch", icon: "mdi:twitch", fg: "#ffffff", bg: "#9146ff" }],
  [/plex/i, { name: "Plex", icon: "cbi:plex", fg: "#e5a00d", bg: "#1f1f1f" }],
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
