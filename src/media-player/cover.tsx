import { Show, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { MASS_ITEM, MASS_REC, artSrc } from "../artwork";
import { sealedImage } from "../url";

export type MediaType = "track" | "album" | "artist" | "playlist" | "radio" | "podcast";

export const MEDIA_TYPES: MediaType[] = [
  "track",
  "album",
  "artist",
  "playlist",
  "radio",
  "podcast",
];

export const asType = (value?: string): MediaType => {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "radio" || v === "channel" || v === "radios") return "radio";
  if (v === "music" || v === "song") return "track";
  if (v === "podcast" || v === "episode") return "podcast";
  return (MEDIA_TYPES as string[]).includes(v) ? (v as MediaType) : "playlist";
};

export const TYPE_ICON: Record<MediaType, string> = {
  track: "mdi:music-note",
  album: "mdi:album",
  artist: "mdi:account-music",
  playlist: "mdi:playlist-music",
  radio: "mdi:radio",
  podcast: "mdi:podcast",
};

/**
 * Music Assistant encodes the provider in the uri scheme, with an instance id
 * after a double dash when several of the same kind are configured:
 *   library://track/64133
 *   apple_music--3VSNTX7x://album/1053933969
 *   plex--PT6hHdhM://track//library/metadata/209940
 */
export function providerOf(id?: string): { label: string; icon: string } | undefined {
  if (!id) return undefined;
  const scheme = id.split("://")[0]?.split("--")[0]?.toLowerCase();
  if (!scheme || scheme === id.toLowerCase()) return undefined;

  const known: Record<string, { label: string; icon: string }> = {
    library: { label: "Library", icon: "mdi:bookshelf" },
    filesystem_local: { label: "Local", icon: "mdi:folder-music" },
    filesystem_smb: { label: "Network share", icon: "mdi:nas" },
    apple_music: { label: "Apple Music", icon: "mdi:apple" },
    spotify: { label: "Spotify", icon: "mdi:spotify" },
    plex: { label: "Plex", icon: "mdi:plex" },
    tidal: { label: "Tidal", icon: "mdi:waves" },
    qobuz: { label: "Qobuz", icon: "mdi:music-circle" },
    deezer: { label: "Deezer", icon: "mdi:music-circle" },
    ytmusic: { label: "YouTube Music", icon: "mdi:youtube" },
    youtube_music: { label: "YouTube Music", icon: "mdi:youtube" },
    radiobrowser: { label: "Radio", icon: "mdi:radio" },
    tunein: { label: "TuneIn", icon: "mdi:radio" },
    itunes_podcasts: { label: "Podcasts", icon: "mdi:podcast" },
    soundcloud: { label: "SoundCloud", icon: "mdi:soundcloud" },
    jellyfin: { label: "Jellyfin", icon: "mdi:jellyfish" },
    subsonic: { label: "Subsonic", icon: "mdi:server-network" },
  };

  return known[scheme] ?? { label: scheme.replaceAll("_", " "), icon: "mdi:cloud-outline" };
}

/** Stable hue per name, so covers without artwork still look deliberate. */
export function hueOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + (text.codePointAt(i) ?? 0)) % 360;
  return h;
}

/**
 * Turn a raw artwork reference into something the CSP will actually load.
 *
 * - Origin-relative /api/ paths go to Home Assistant directly when a base URL
 *   is configured, else through hassMediaUrl (the host's proxy, which 403s on
 *   media_player_proxy).
 * - Absolute URLs are rewritten onto `proxyBase` when one is configured,
 *   because Dash's img-src permits only same-origin, data:, blob:,
 *   *.glasshome.app and the Home Assistant origin. Point proxyBase at a path
 *   you expose on the HA hostname and the images become loadable.
 *
 * proxyBase accepts three forms:
 *   https://ha.example.com                  → swaps the origin, keeps the path
 *                                             (only for paths the proxy fronts)
 *   https://ha.example.com/i?url={url}      → the whole URL, percent-encoded
 *   https://ha.example.com/extimg/{hostpath} → host + path + query, unencoded,
 *                                             for an nginx regex location that
 *                                             cannot decode a query parameter
 */
/**
 * A session-wide circuit breaker for image origins.
 *
 * One broken cover is a gradient. Fifty broken covers are a burst of failing
 * requests at the same host every time the dashboard is opened — and a
 * reverse proxy watching its own logs reads that as an attack and bans the
 * client. That is not hypothetical: with the artwork proxy unset, every
 * relative path falls back to the dashboard's own media proxy, which answers
 * 403 for them, and a full board fires dozens per reload.
 *
 * So failures are counted per origin, and once an origin has proved itself
 * broken the rest of its images are never requested at all. It resets on
 * reload, so a fixed proxy needs nothing but a refresh.
 */
const FAILURE_LIMIT = 5;
const failures = new Map<string, number>();

const originOf = (url: string) => {
  try {
    return new URL(url, typeof location === "undefined" ? undefined : location.href).origin;
  } catch {
    return "";
  }
};

/** Count a failed image against its origin. */
/**
 * Says an artwork image's shape once it has loaded, on the image itself.
 *
 * Now-playing artwork is a square sleeve for music, but a set-top box sends
 * the channel's logo — a Vu+ picon is 5:3 — and a TV app can send a poster.
 * Cropped to fill a square or a circle, a logo came out as the middle of its
 * lettering blown up; drawn whole, it reads as the channel. The stylesheets
 * fit "wide" and "tall" artwork whole and leave "square" to fill its frame.
 */
export function markArtShape(img: HTMLImageElement): void {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return;
  const ratio = width / height;
  let shape = "square";
  if (ratio > 1.2) shape = "wide";
  else if (ratio < 0.83) shape = "tall";
  img.dataset.shape = shape;
}

export function noteImageFailure(url?: string): void {
  if (!url) return;
  const origin = originOf(url);
  if (!origin) return;
  failures.set(origin, (failures.get(origin) ?? 0) + 1);
}

/** Whether this origin has already failed often enough to stop asking. */
export function imageBlocked(url?: string): boolean {
  if (!url) return false;
  const origin = originOf(url);
  return !!origin && (failures.get(origin) ?? 0) >= FAILURE_LIMIT;
}

/**
 * Whether a presigned (AWS-style) URL is past its expiry: X-Amz-Date is when
 * it was signed, X-Amz-Expires how many seconds it lasts.
 */
function signedLinkExpired(raw: string): boolean {
  if (!/X-Amz-Expires=/i.test(raw)) return false;
  try {
    const params = new URL(raw).searchParams;
    const signed = params.get("X-Amz-Date") ?? "";
    const lasts = Number(params.get("X-Amz-Expires"));
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(signed);
    if (!m || !Number.isFinite(lasts)) return false;
    const at = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
    return at + lasts * 1000 < Date.now();
  } catch {
    return false;
  }
}

/** The picture inside a Sonos image-resizer URL, or the URL as it was. */
function unwrapSonosImage(raw: string): string {
  if (!/^https?:\/\/sali\.sonos\.radio\//i.test(raw)) return raw;
  try {
    const inner = new URL(raw).searchParams.get("image");
    return inner && /^https?:\/\//i.test(inner) ? inner : raw;
  } catch {
    return raw;
  }
}

export function resolveArtwork(
  raw?: string,
  _proxyBase?: string,
  _haBase?: string,
): string | undefined {
  if (!raw) return undefined;

  // Sonos wraps a radio station's logo in its own resizer —
  // sali.sonos.radio/image?w=…&image=<the logo> — and that is one more host
  // for the image proxy to allow. The logo inside is an ordinary provider URL
  // (TuneIn's, usually), so the wrapper is taken off and the logo asked for
  // directly.
  raw = unwrapSonosImage(raw);

  // A signed storage link that has run out — an Apple Music playlist cover
  // Sonos saved with the favourite, good for a day and then refused for ever.
  // Asking for it only earns a 403; the tile's own fallback is the answer.
  if (signedLinkExpired(raw)) return undefined;

  // The sealed engine of Dash 1.5 loads pictures only through the dashboard.
  // A Home Assistant path goes through its media proxy (which serves
  // media_player_proxy artwork there). A cover from any other host — a
  // provider's CDN, Music Assistant's image proxy — cannot be had: the engine
  // refuses it, and a widget may not hand the address to Home Assistant
  // either. A Music Assistant item's cover is asked for by the item instead
  // (massCover, src/artwork.ts). Anything else is undefined, for the tile's
  // fallback. The proxy and base addresses are no longer needed; their
  // parameters stay for the callers.
  if (raw.startsWith(MASS_ITEM) || raw.startsWith(MASS_REC)) return raw;
  return sealedImage(raw);
}

/**
 * Music Assistant returns absolute artwork URLs (its own imageproxy, or the
 * provider's CDN). Dash's img-src allows only same-origin, data:, blob:,
 * *.glasshome.app and the Home Assistant origin, so those never load and the
 * gradient below is what users actually see. Entity artwork is different: it's
 * an origin-relative /api/ path that hassMediaUrl routes through the host.
 */
export function Cover(props: {
  name: string;
  mediaType: MediaType;
  image?: string;
  selected?: boolean;
  /** Item uri or media_content_id, used to badge the provider. */
  sourceId?: string;
}) {
  const [failed, setFailed] = createSignal(false);
  const hue = () => hueOf(props.name);
  const src = () => artSrc(props.image);

  return (
    // Artists read as people, so their covers are round in both panels.
    <div class="mp-lib-cover" data-round={props.mediaType === "artist"}>
      <Show
        when={src() && !failed() && !imageBlocked(src())}
        fallback={
          <div
            class="mp-lib-fallback"
            style={{
              background: `linear-gradient(145deg, hsl(${hue()} 55% 38%), hsl(${
                (hue() + 42) % 360
              } 48% 22%))`,
            }}
          >
            <Icon icon={TYPE_ICON[props.mediaType]} width="30" />
          </div>
        }
      >
        {/* Lazy and async: Discover renders five or six rows at once, and
            firing every cover at the image proxy simultaneously is what makes
            it answer 503. Only what is on screen is fetched. */}
        <img
          src={src()}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            noteImageFailure(src());
            setFailed(true);
          }}
        />
      </Show>

      {/* Tracks skip the badge: their covers are the smallest and the provider
          is already clear from the album or artist they sit under. */}
      <Show when={props.mediaType !== "track" && providerOf(props.sourceId)}>
        <span class="mp-source-badge" title={providerOf(props.sourceId)!.label}>
          <Icon icon={providerOf(props.sourceId)!.icon} width="13" />
        </span>
      </Show>

      <Show when={props.selected}>
        <span class="mp-lib-check">
          <Icon icon="mdi:check" width="13" />
        </span>
      </Show>
    </div>
  );
}
