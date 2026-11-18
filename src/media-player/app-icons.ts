/**
 * A face for each app and activity. Home Assistant's source_list is bare
 * strings — "Prime Video (FireTV)", "DreamPlayer TVHeadend" — so the icon and
 * colour are matched from the name rather than published by the integration.
 *
 * Brand colours, because that is what makes a list of a dozen sources
 * scannable: you find Netflix by its red, not by reading six labels.
 */
export type AppLook = { icon: string; color: string };

const APPS: [RegExp, AppLook][] = [
  [/netflix/i, { icon: "mdi:netflix", color: "#e50914" }],
  [/prime\s*video|amazon\s*video/i, { icon: "mdi:amazon", color: "#00a8e1" }],
  [/disney/i, { icon: "mdi:movie-open-star", color: "#1f6fd0" }],
  [/youtube/i, { icon: "mdi:youtube", color: "#ff0033" }],
  [/spotify/i, { icon: "mdi:spotify", color: "#1db954" }],
  [/apple\s*(tv|music)/i, { icon: "mdi:apple", color: "#b8b8bd" }],
  [/plex/i, { icon: "mdi:plex", color: "#e5a00d" }],
  [/dazn/i, { icon: "mdi:soccer", color: "#f5f5f5" }],
  [/sky|wow/i, { icon: "mdi:satellite-variant", color: "#0072c9" }],
  [/twitch/i, { icon: "mdi:twitch", color: "#9146ff" }],
  [/kodi/i, { icon: "mdi:kodi", color: "#22b1e6" }],
  [/tvheadend|dreamplayer|iptv|live\s*tv/i, { icon: "mdi:television-classic", color: "#5eb0ef" }],
  [/store|appstore/i, { icon: "mdi:storefront", color: "#ff9f0a" }],
  [/ard|zdf|mediathek|tagesschau/i, { icon: "mdi:television-guide", color: "#3f7ed8" }],
  [/rtl|joyn|pro\s*7|sat\.?1/i, { icon: "mdi:television-play", color: "#e0533d" }],
  [/magenta|telekom/i, { icon: "mdi:television-box", color: "#e20074" }],
  [/music|audio|radio/i, { icon: "mdi:music", color: "#ff6b9a" }],
  [/setting|einstell/i, { icon: "mdi:cog", color: "#9aa4b2" }],
];

const ACTIVITIES: [RegExp, AppLook][] = [
  /* A Harmony activity is named by whoever set the hub up — "Sky schauen",
     "PS5", "Musik" — so the device it turns on is usually right there in the
     name. Match the brand first and only fall back to the genre glyph, since
     a logo says which box wakes up better than a word does. */
  [/playstation|\bps\s?[45]\b/i, { icon: "cbi:playstation", color: "#0070d1" }],
  [/xbox/i, { icon: "cbi:xbox", color: "#107c10" }],
  [/switch|nintendo/i, { icon: "arcticons:nintendo", color: "#e60012" }],
  [/steam/i, { icon: "cbi:steam", color: "#66c0f4" }],
  [/shield|nvidia/i, { icon: "cbi:nvidia-shield", color: "#76b900" }],
  [/fire\s*tv/i, { icon: "cbi:firetv", color: "#ff9900" }],
  [/apple\s*tv/i, { icon: "cbi:apple-tv", color: "#b8b8bd" }],
  [/chromecast/i, { icon: "cbi:chromecast", color: "#4285f4" }],
  [/android\s*tv/i, { icon: "cbi:androidtv", color: "#3ddc84" }],
  [/kodi/i, { icon: "cbi:kodi", color: "#22b1e6" }],
  [/plex/i, { icon: "cbi:plex", color: "#e5a00d" }],
  [/netflix/i, { icon: "cbi:netflix", color: "#e50914" }],
  [/youtube/i, { icon: "cbi:youtube", color: "#ff0033" }],
  [/spotify/i, { icon: "cbi:spotify", color: "#1db954" }],
  [/sonos/i, { icon: "cbi:sonos", color: "#b8b8bd" }],
  [/denon/i, { icon: "cbi:denon", color: "#00a0dc" }],
  [/onkyo/i, { icon: "cbi:onkyo", color: "#8b1a1a" }],
  [/blu-?ray|\bbd\b/i, { icon: "cbi:bluray", color: "#0a5ea8" }],
  [/\bdvd\b/i, { icon: "cbi:dvd", color: "#94a3b8" }],
  [/sky|wow\b/i, { icon: "cbi:sky-alt", color: "#0072c9" }],
  [/vu\+|vuplus|enigma|receiver|sat\b/i,
    { icon: "mdi:satellite-variant", color: "#60a5fa" }],

  /* Genre, for an activity named after what it is for rather than what it
     switches on. */
  [/tv|fernseh/i, { icon: "mdi:television", color: "#5eb0ef" }],
  [/music|musik|audio|radio/i, { icon: "mdi:music", color: "#1db954" }],
  [/movie|film|kino/i, { icon: "mdi:movie-open", color: "#c084fc" }],
  [/game|spiel|konsole/i, { icon: "mdi:controller", color: "#22c55e" }],
  [/sport|dazn/i, { icon: "mdi:soccer", color: "#f59e0b" }],
];

/**
 * Broadcast channels, as a VU+ or any other Enigma2 box lists them. Different
 * table from APPS because the same word means different things in each: "Sky"
 * is one app but a dozen channels, and "1" in "Kabel Eins" is a brand, not a
 * bouquet position. Names arrive with an "HD"/"UHD" suffix and sometimes a
 * region ("WDR Köln"), so nothing anchors to the end of the string.
 *
 * Real station logos where a brand set has one — cbi (Custom Brand Icons)
 * carries most of the German line-up, with simple-icons and arcticons filling
 * gaps. They are monochrome, so each still takes its house colour from
 * --mp-look and the row reads as the channel rather than as a generic screen.
 * Anything without a logo keeps a glyph in the right colour.
 */
const CHANNELS: [RegExp, AppLook][] = [
  /* ARD and its family. ard-alpha and the regionals go first: a bare \bard\b
     would swallow "ARD alpha", and "One" is a word before it is a channel. */
  [/ard\s*alpha|\balpha\b/i, { icon: "cbi:ard-alpha", color: "#0a2896" }],
  [/das\s*erste/i, { icon: "cbi:daserste", color: "#0a2896" }],
  [/tagesschau/i, { icon: "cbi:tagesschau24", color: "#0a2896" }],
  [/\bard\b|mediathek/i, { icon: "cbi:ard", color: "#0a2896" }],
  [/\bwdr\b|köln|koeln/i, { icon: "cbi:wdr1", color: "#0a5ea8" }],
  [/\bndr\b/i, { icon: "cbi:ndr1", color: "#0a5ea8" }],
  [/\bmdr\b/i, { icon: "cbi:mdr1", color: "#0a5ea8" }],
  [/\brbb\b/i, { icon: "cbi:rbb1", color: "#0a5ea8" }],
  [/\bswr\b/i, { icon: "cbi:swr", color: "#0a5ea8" }],
  [/\bbr\b|bayerisches/i, { icon: "cbi:br1", color: "#0a5ea8" }],
  [/\bhr\b|hessen/i, { icon: "cbi:hr1", color: "#0a5ea8" }],
  [/\bsr\b|saarland/i, { icon: "cbi:ard", color: "#0a5ea8" }],
  [/\bone\b/i, { icon: "cbi:one", color: "#7c3aed" }],

  /* ZDF's family, most specific first for the same reason. */
  [/zdf\s*neo/i, { icon: "cbi:zdfneo", color: "#e2761b" }],
  [/zdf\s*info/i, { icon: "cbi:zdfinfo", color: "#c86014" }],
  [/zdf\s*tivi/i, { icon: "cbi:zdftivi", color: "#f9a825" }],
  [/\bzdf\b/i, { icon: "cbi:zdf", color: "#fa7d19" }],

  [/\barte\b/i, { icon: "cbi:arte", color: "#ec6608" }],
  [/3\s*sat/i, { icon: "cbi:3sat", color: "#e2001a" }],
  [/phoenix/i, { icon: "cbi:phoenix", color: "#b71c1c" }],
  [/kika|kinderkanal/i, { icon: "cbi:kika", color: "#f9a825" }],

  /* RTL and ProSiebenSat.1. Only some of these have a logo in the brand sets;
     the rest keep a generic glyph in the house colour, which still separates
     them at a glance. */
  [/rtl\s*(2|zwei)/i, { icon: "cbi:rtlzwei", color: "#009ee0" }],
  [/rtl\s*up/i, { icon: "mdi:television-play", color: "#e2001a" }],
  [/nitro/i, { icon: "mdi:television-play", color: "#c8102e" }],
  [/super\s*rtl|toggo/i, { icon: "mdi:teddy-bear", color: "#f7a800" }],
  [/\brtl\b/i, { icon: "cbi:rtl", color: "#d40028" }],
  [/\bvox\b/i, { icon: "cbi:vox", color: "#d81e05" }],
  [/n-?tv\b/i, { icon: "arcticons:ntv", color: "#cf0a2c" }],
  [/sat\.?\s*1\s*gold/i, { icon: "mdi:television-play", color: "#c9a227" }],
  [/sat\.?\s*1/i, { icon: "cbi:sat1", color: "#e94e1b" }],
  [/pro\s*7\s*maxx|prosieben\s*maxx/i, { icon: "mdi:television-play", color: "#7a2fa0" }],
  [/pro\s*7|prosieben/i, { icon: "cbi:prosieben", color: "#e3000f" }],
  [/kabel\s*(eins|1)/i, { icon: "mdi:television-play", color: "#d51317" }],
  [/\bsixx\b/i, { icon: "mdi:television-play", color: "#ec008c" }],
  [/tele\s*5/i, { icon: "simple-icons:tele5", color: "#e30613" }],

  /* Pay TV and sport. */
  [/sky\s*sport/i, { icon: "cbi:skysports-football", color: "#0072c9" }],
  [/\bwow\b/i, { icon: "cbi:wow", color: "#8b5cf6" }],
  [/\bsky\b/i, { icon: "cbi:sky-alt", color: "#0072c9" }],
  [/dazn/i, { icon: "cbi:dazn", color: "#f5f5f5" }],
  [/euro\s*sport/i, { icon: "mdi:soccer", color: "#00b4e5" }],
  [/sport\s*1|sport1/i, { icon: "mdi:soccer", color: "#d40f14" }],

  /* Austria, Switzerland, and the rest of the line-up. */
  [/servus\s*tv/i, { icon: "mdi:television-classic", color: "#d40f14" }],
  [/\borf\b/i, { icon: "mdi:television-classic", color: "#e2001a" }],
  [/\bsrf\b|schweizer\s*fernsehen/i, { icon: "mdi:television-classic", color: "#cc0000" }],
  [/welt\b|\bn24\b/i, { icon: "mdi:newspaper-variant", color: "#002e5f" }],
  [/\bdmax\b/i, { icon: "mdi:earth", color: "#ff6600" }],
  [/comedy\s*central/i, { icon: "mdi:emoticon-happy-outline", color: "#f5a623" }],
  [/\bmtv\b|\bviva\b/i, { icon: "mdi:music", color: "#ee1c25" }],
  [/nick|nickelodeon/i, { icon: "mdi:teddy-bear", color: "#f57d0d" }],
  [/disney/i, { icon: "cbi:disney-plus", color: "#1f6fd0" }],
  [/netflix/i, { icon: "cbi:netflix", color: "#e50914" }],
  [/magenta/i, { icon: "cbi:magentatv", color: "#e20074" }],
  [/waipu/i, { icon: "cbi:waiputv", color: "#00c2a8" }],
  [/pluto/i, { icon: "cbi:plutotv", color: "#feca30" }],
  [/paramount/i, { icon: "cbi:paramount", color: "#0064ff" }],
  [/joyn/i, { icon: "arcticons:joyn", color: "#ff0064" }],
  [/animal\s*planet/i, { icon: "simple-icons:animalplanet", color: "#0073d1" }],
  [/discovery/i, { icon: "arcticons:discovery", color: "#1e88e5" }],
  [/nat\s*geo|national\s*geographic|history/i, { icon: "mdi:earth", color: "#f5c518" }],

  /* Genre, for the hundreds of channels no table will ever name. */
  [/sport|fu(ss|ß)ball|football|bundesliga/i, { icon: "mdi:soccer", color: "#22c55e" }],
  [/news|nachricht|\binfo\b|doku/i, { icon: "mdi:newspaper-variant", color: "#94a3b8" }],
  [/kino|movie|film|cinema/i, { icon: "mdi:movie-open", color: "#c084fc" }],
  [/kind|kids|junior|cartoon/i, { icon: "mdi:teddy-bear", color: "#fbbf24" }],
  [/musik|music|radio|hits/i, { icon: "mdi:music", color: "#ff6b9a" }],
  [/wetter|weather/i, { icon: "mdi:weather-partly-cloudy", color: "#38bdf8" }],
  [/shop|qvc|\bhse\b/i, { icon: "mdi:cart-outline", color: "#f472b6" }],
];

/** A stable colour for anything unrecognised, so no row is left blank. */
function fallback(name: string, icon: string): AppLook {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.codePointAt(i) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return { icon, color: `hsl(${Math.abs(h) % 360} 62% 62%)` };
}

export const appLook = (name: string): AppLook =>
  APPS.find(([p]) => p.test(name))?.[1] ?? fallback(name, "mdi:application");

export const activityLook = (name: string): AppLook =>
  ACTIVITIES.find(([p]) => p.test(name))?.[1] ?? fallback(name, "mdi:play-circle-outline");

export const channelLook = (name: string): AppLook =>
  CHANNELS.find(([p]) => p.test(name))?.[1] ?? fallback(name, "mdi:television-classic");
