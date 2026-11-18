import { createSignal, type Accessor, type Setter } from "solid-js";
import { useService } from "@glasshome/widget-sdk";
import { errorMessage } from "./errors";
import { sealedImage } from "./url";

/**
 * Covers from outside Home Assistant, in the sealed engine of Dash 1.5.
 *
 * The engine loads pictures only from the dashboard: Home Assistant's media
 * proxy, `data:` and `blob:` URLs. Album, playlist and podcast covers sit on
 * the providers' image servers or behind Music Assistant's image proxy, and
 * were refused — every tile in Discover, the queue and the next and previous
 * tracks showed its placeholder.
 *
 * The GlassHome Artwork integration (homeassistant/custom_components in this
 * repository) fetches them in Home Assistant and hands them back as small
 * JPEG data URLs. It is asked by Music Assistant item, never by address: the
 * dashboard refuses any widget call that names a network address ("widgets
 * cannot send Home Assistant to a URL"), so a cover known only by its URL —
 * an Echo's now-playing art, a club crest — keeps its placeholder. An item
 * whose own id carries an address (a podcast's is its feed URL) is asked for
 * by its place in Music Assistant's recommendations instead, and the answer
 * is checked against the id. artSrc asks it for the covers being drawn, a few to a call
 * and one call at a time, so a shelf of covers never lands in one step of
 * the engine's budget; the answer is a signal, and the tile redraws when its
 * picture arrives. Without the integration the first call fails, nothing more
 * is asked for, and the placeholders stay.
 */

/** A Music Assistant item whose cover is wanted: `mass:<uri>`. */
export const MASS_ITEM = "mass:";
/** A picture in an entity's state: `entart:<entity_id>#<index>#<field>`. */
export const ENTITY_ART = "entart:";

/**
 * The artSrc source for a picture an entity publishes in its data list — a
 * Plex "recently added" sensor's poster — by place, so Home Assistant reads
 * the address from its own state and the widget never sends it.
 */
export function entityPicture(entityId: string | undefined, index: number, field: string): string | undefined {
  return entityId ? `${ENTITY_ART}${entityId}#${index}#${field}` : undefined;
}

/** The same, by its place in a player's recommendations: `massrec:<player>|<s>.<i>|<uri>`. */
export const MASS_REC = "massrec:";

/* The dashboard's own test for a call that names an address or a template
   (Dash 1.5.0-rc.2, ha-bridge worker): a scheme from this list followed by a
   colon, a leading //, or a template opener, after undoing %-escapes. A call
   that trips it is refused, so nothing that would is sent. */
const SCHEMES = new Set(
  "http https httpproxy ftp ftps sftp scp gopher gophers ws wss rtsp rtsps rtmp rtmps rtmpt rtmpts rtmpe rtmpte rtp srt udp tcp tls mms mmsh mmst icy icyx shout smb nfs dav davs upnp file ipfs ipns aac plugin special x-file-cifs x-rincon-mp3radio x-sonosapi-hls x-sonosapi-hls-static x-sonosapi-stream x-sonosapi-radio x-sonos-http".split(" "),
);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

function unescaped(value: string): string {
  let text = value.replace(CONTROL, "");
  for (let round = 0; round < 4; round++) {
    const next = text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(CONTROL, "");
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Whether a value may go into a widget's service call without being refused. */
export function sendable(value: string): boolean {
  const text = unescaped(value);
  if (/\{[{%#]/.test(text) || /^\s*[/\\]{2}/.test(text)) return false;
  for (const match of text.matchAll(/(?<![a-z0-9+._-])([a-z][a-z0-9+._-]*):(?=\S)/gi))
    if ((match[1] ?? "").toLowerCase().split("+").some((scheme) => SCHEMES.has(scheme))) return false;
  return true;
}

/**
 * The artSrc source for a Music Assistant item's cover: by id when the id may
 * be sent, by its place in the recommendations when one is given, otherwise
 * none.
 */
export function massCover(
  uri: string | undefined,
  place?: { player: string; at: string },
): string | undefined {
  if (!uri) return undefined;
  if (sendable(uri)) return `${MASS_ITEM}${uri}`;
  return place?.player ? `${MASS_REC}${place.player}|${place.at}|${uri}` : undefined;
}

/** A massrec source's parts. */
function recParts(src: string): { player: string; at: string; uri: string } {
  const rest = src.slice(MASS_REC.length);
  const one = rest.indexOf("|");
  const two = rest.indexOf("|", one + 1);
  return { player: rest.slice(0, one), at: rest.slice(one + 1, two), uri: rest.slice(two + 1) };
}

type CallService = ReturnType<typeof useService>["callService"];

/* Six small covers a call, one call at a time, most of a second apart: a
   shelf of covers lands as several small steps the engine's budget refills
   between, not one large one. */
const BATCH = 6;
const GAP_MS = 800;
const MAX_ENTRIES = 500;
const TILE = 128;

type Reply = { images?: Record<string, string>; items?: Record<string, string> };

type Entry = { get: Accessor<string | undefined>; set: Setter<string | undefined> };

const entries = new Map<string, Entry>();
const pending = new Set<string>();
let call: CallService | undefined;
let unavailable = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Lets artSrc call the integration. Call it once, in the widget's setup. */
export function useArtworkService(): void {
  call = useService().callService;
}

const isRemote = (src: string) =>
  src.startsWith(MASS_ITEM) || src.startsWith(MASS_REC) || src.startsWith(ENTITY_ART);

/**
 * The address to put on an <img> for a cover: as it is when the engine loads
 * it, its picture from the integration once that has arrived, and undefined
 * until then or when there is none — for the tile's own placeholder.
 * Reactive: read it inside a memo, a JSX attribute or a Show.
 */
export function artSrc(src: string | null | undefined, size = TILE): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("data:image/") || src.startsWith("blob:")) return src;
  const direct = sealedImage(src);
  if (direct) return direct;
  if (!isRemote(src) || unavailable || !call) return undefined;

  const key = `${size}|${src}`;
  let entry = entries.get(key);
  if (!entry) {
    const [get, set] = createSignal<string | undefined>();
    entry = { get, set };
    entries.set(key, entry);
    if (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    pending.add(key);
    schedule(60);
  }
  return entry.get();
}

function schedule(ms: number) {
  if (timer !== undefined || running || !pending.size) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, ms);
}

/** The next call's sources: one size, and one player's positions, at most BATCH. */
function nextBatch(): { keys: string[]; size: number; player?: string } | undefined {
  const first = pending.values().next().value as string | undefined;
  if (!first) return undefined;
  const size = Number(first.slice(0, first.indexOf("|")));
  let player: string | undefined;
  const keys: string[] = [];
  for (const key of pending) {
    if (keys.length >= BATCH) break;
    if (!key.startsWith(`${size}|`)) continue;
    const src = sourceOf(key);
    if (src.startsWith(MASS_REC)) {
      const owner = recParts(src).player;
      player ??= owner;
      if (owner !== player) continue;
    }
    keys.push(key);
  }
  return { keys, size, player };
}

const sourceOf = (key: string) => key.slice(key.indexOf("|") + 1);

/** The integration's fetch data for these sources. */
function request(sources: string[], size: number, player: string | undefined) {
  const uris: string[] = [];
  const positions: string[] = [];
  const attributes: string[] = [];
  for (const src of sources) {
    if (src.startsWith(ENTITY_ART)) attributes.push(src.slice(ENTITY_ART.length));
    else if (src.startsWith(MASS_ITEM)) uris.push(src.slice(MASS_ITEM.length));
    else positions.push(recParts(src).at);
  }
  return {
    ...(uris.length ? { uris } : {}),
    ...(attributes.length ? { attributes } : {}),
    ...(positions.length ? { positions, player } : {}),
    size,
  };
}

/** A source's picture in the integration's answer, if it came back. */
function pictureFor(src: string, answer: Reply): string | undefined {
  const images = answer.images ?? {};
  if (src.startsWith(ENTITY_ART)) return images[src.slice(ENTITY_ART.length)];
  if (src.startsWith(MASS_ITEM)) return images[src.slice(MASS_ITEM.length)];
  const { at, uri } = recParts(src);
  /* Only the item it was meant for: the recommendations may have moved. */
  return answer.items?.[at] === uri ? images[at] : undefined;
}

async function flush() {
  if (!call || unavailable) return;
  const next = nextBatch();
  if (!next) return;
  for (const key of next.keys) pending.delete(key);

  running = true;
  try {
    const reply = (await call(
      "glasshome_artwork",
      "fetch",
      request(next.keys.map(sourceOf), next.size, next.player),
      undefined,
      { returnResponse: true },
    )) as Reply | { response?: Reply } | undefined;
    const answer: Reply = (reply && "images" in reply ? reply : (reply as { response?: Reply })?.response) ?? {};
    for (const key of next.keys) {
      const picture = pictureFor(sourceOf(key), answer);
      if (picture?.startsWith("data:image/")) entries.get(key)?.set(picture);
    }
  } catch (error) {
    /* Not installed, or not allowed: ask no more this session, and the tiles
       keep their placeholders. Anything else costs this batch only. */
    if (/not found|unknown|no such|not allowed|permission|capabilit|unauthori/i.test(errorMessage(error, ""))) {
      unavailable = true;
      pending.clear();
    }
  } finally {
    running = false;
  }
  schedule(GAP_MS);
}
