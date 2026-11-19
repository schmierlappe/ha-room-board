import { artSrc } from "../artwork";
import { pictureOf, usePlexPlayers, withPlexTwin } from "../media-player/plex-twin";
import { brandStyle, placeholderBrand } from "../media-player/brand";
import { Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
/* The media player widget's own resolver: it already knows the three shapes
   artwork arrives in — an origin-relative Home Assistant path, Music
   Assistant's image proxy, and a provider's own CDN. */
import { markArtShape, noteImageFailure, resolveArtwork } from "../media-player/cover";
import { attr, openable } from "./util";

const PLAYING = new Set(["playing", "buffering"]);
/* A receiver or set-top box never reports `playing` — it sits on `on` for as
   long as it is showing something. */
const ACTIVE = new Set([...PLAYING, "on"]);

export const isPlaying = (entity: EntityView | undefined) => ACTIVE.has(entity?.state ?? "");

const FEATURE = { PAUSE: 1, VOLUME_SET: 4, PREVIOUS_TRACK: 16, NEXT_TRACK: 32 } as const;

const supports = (entity: EntityView | undefined, bit: number) =>
  ((entity?.supportedFeatures ?? 0) & bit) === bit;

/**
 * What the player is showing, worded the way the thing itself is named.
 *
 * A television names the show first and the episode second; a music player
 * fills media_title and media_artist and nothing else. Reading media_title
 * first serves the music case and gives a series the episode name in bold with
 * the show underneath.
 */
/** The line under the heading: the episode under its show, else the artist,
    the album (when it is not the title again) or the channel. */
function subOf(series: string, title: string, artist: string, album: string, channel: string): string {
  if (series && title) return title;
  if (artist) return artist;
  if (album && album !== title) return album;
  return channel;
}

export function readNowPlaying(player: EntityView | undefined) {
  const series = attr<string>(player, "media_series_title", "");
  const title = attr<string>(player, "media_title", "");
  const artist = attr<string>(player, "media_artist", "");
  const album = attr<string>(player, "media_album_name", "");
  const channel = attr<string>(player, "media_channel", "");

  const source = attr<string>(player, "app_name", "") || attr<string>(player, "source", "");
  /* Nothing named, as a TV in an app often is: the app is what is on, and
     the player's name is shown beside it already — as the headline too it
     read twice. */
  const heading = series || title || channel || album || source || player?.friendlyName || "Nothing playing";
  const sub = subOf(series, title, artist, album, channel);
  return {
    heading,
    sub: sub === heading ? "" : sub,
    source: source === heading ? "" : source,
  };
}

/**
 * How far through it is, 0–1.
 *
 * media_position is a stamp rather than a live figure — it is correct as of
 * media_position_updated_at and the player says nothing more until something
 * changes — so the elapsed time since that stamp has to be added back on.
 */
export function progressOf(player: EntityView | undefined, now: number): number | undefined {
  const duration = attr<number>(player, "media_duration", 0);
  if (!duration || duration <= 0) return undefined;

  const position = attr<number>(player, "media_position", 0);
  const stamp = attr<string>(player, "media_position_updated_at", "");
  const since = stamp ? (now - new Date(stamp).getTime()) / 1000 : 0;
  const elapsed = position + (isPlaying(player) && since > 0 ? since : 0);

  return Math.max(0, Math.min(1, elapsed / duration));
}

/**
 * Where a player's cover actually lives.
 *
 * Most players publish an origin-relative Home Assistant path, and a base URL
 * fetches it straight from Home Assistant — the dashboard's media proxy
 * answers 403 for media_player_proxy paths. An Echo does not: Alexa puts
 * Amazon's own CDN in entity_picture, an absolute URL the dashboard's
 * img-src refuses outright. That one goes through the artwork proxy, same as
 * a Music Assistant provider URL.
 */
export function artworkOf(
  player: EntityView | undefined,
  haBase: string,
  proxyBase = "",
  plexPlayers: EntityView[] = [],
) {
  /* A device running Plex takes the cover from the Plex integration's own
     player for it, which has one when the device's own entity does not. */
  const picture = pictureOf(player, plexPlayers);
  return picture ? resolveArtwork(picture, proxyBase, haBase) : undefined;
}

/** Whichever player in the room is actually on, else the first with media. */
export function pickPlayer(players: EntityView[], chosen: string) {
  return (
    players.find((entity) => entity.id === chosen) ??
    players.find((entity) => isPlaying(entity)) ??
    players.find((entity) => !!attr<string>(entity, "media_title", "")) ??
    players[0]
  );
}

/** The volume slider's keys: one percent a press, ten with Page Up and Down. */
const VOLUME_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: 10,
  PageDown: -10,
};

/** The board card: what is on, and the one control worth reaching for. */
/** mm:ss, for the two ends of the progress line. */
const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * The board's media card.
 *
 * Laid out the way a record sleeve is: the cover on the left at the height of
 * the card, and everything that is not the cover in a column beside it —
 * title, artist, how far through, and the transport. The previous version put
 * a postage-stamp cover under the title and an oversized play button opposite
 * it, which left the middle of the card empty and made the button the loudest
 * thing on the board.
 */
export function MediaCard(props: {
  players: EntityView[];
  haBaseUrl: string;
  artworkProxy?: string;
  chosen: string;
  onOpen: () => void;
}) {
  const { callService } = useService();
  const plexPlayers = usePlexPlayers();
  /* A Shield running Plex says what is playing through Plex's own player for
     it (media-player/plex-twin.ts). */
  const player = createMemo(() =>
    withPlexTwin(pickPlayer(props.players, props.chosen), plexPlayers()),
  );
  const now = createMemo(() => readNowPlaying(player()));
  const art = createMemo(() =>
    artSrc(artworkOf(player(), props.haBaseUrl, props.artworkProxy ?? "", plexPlayers()), 320),
  );

  const call = (service: string) => {
    const id = player()?.id;
    if (id) void callService("media_player", service, {}, { entity_id: id });
  };

  /* The player menu on a standing card. */

  const press = (event: Event, service: string) => {
    event.stopPropagation();
    call(service);
  };

  /* Ticking once a second, and only while something is playing: a paused card
     has nothing to recompute. */
  const [tick, setTick] = createSignal(Date.now());
  const timer = setInterval(() => {
    if (isPlaying(player())) setTick(Date.now());
  }, 1000);
  onCleanup(() => clearInterval(timer));

  /* The volume: what the finger says while it is down — and for a moment
     after it lifts, until the player has caught up, so the handle does not
     jump back to the old level and forward again — the player's own level
     otherwise. Sent a few times a second while dragging, and once more on
     release with the exact value. */
  const [dragVolume, setDragVolume] = createSignal<number | undefined>();
  const [heldVolume, setHeldVolume] = createSignal(false);
  const volume = () =>
    dragVolume() ?? Math.round(attr<number>(player(), "volume_level", 0) * 100);
  let sentAt = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settle));

  const sendVolume = (value: number) => {
    const id = player()?.id;
    if (id)
      void callService("media_player", "volume_set", { volume_level: value / 100 }, { entity_id: id });
  };

  const setVolume = (value: number, final = false) => {
    clearTimeout(settle);
    setDragVolume(value);
    const now = Date.now();
    if (final || now - sentAt >= 150) {
      sentAt = now;
      sendVolume(value);
    }
    if (final) settle = setTimeout(() => setDragVolume(undefined), 1500);
  };

  /* The volume under the finger: the whole group — speaker, line and figure
     — is the target, a drag on it moves the level from where it was (so it
     never needs a precise touch on a thin line), and the drag is the
     slider's alone: pointer capture and no touch panning. */
  /* Where a drag on the volume started, so it moves the level relatively. */
  let grab: { x: number; from: number; width: number; moved: boolean; onTrack: boolean } | undefined;
  /* The wheel's last notch, for the one exact send when it stops turning. */
  let wheelStop: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(wheelStop));

  const volumeAt = (event: PointerEvent, track: HTMLElement) => {
    const box = track.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / (box.width || 1))) * 100);
  };

  const duration = () => attr<number>(player(), "media_duration", 0);
  const progress = () => progressOf(player(), tick());
  const elapsed = () => (progress() ?? 0) * duration();

  return (
    <article class="rb-card rb-card--media" {...openable(props.onOpen, "Media")}>

      {/* The cover, blown up behind everything. */}
      <Show when={art()}>
        <div class="rb-media-bg" style={{ "background-image": `url("${art()}")` }} />
        <div class="rb-media-scrim" />
      </Show>

      <div class="rb-media-body">
        <div class="rb-media-cover" style={art() ? { "--art": `url("${art()}")` } : undefined}>
          <Show
            when={art()}
            fallback={
              <span
                class="rb-media-art rb-media-art--empty"
                data-brand="true"
                style={brandStyle(placeholderBrand(player()))}
              >
                {/* No cover, but a known app: its logo on its own ground. */}
                <Icon
                  icon={placeholderBrand(player()).icon}
                  width={undefined}
                />
              </span>
            }
          >
            <img
              class="rb-media-art"
              src={art()}
              alt=""
              decoding="async"
              onLoad={(event) => markArtShape(event.currentTarget)}
              onError={() => noteImageFailure(art())}
            />
          </Show>

          <Show when={isPlaying(player())}>
            <span class="rb-media-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </Show>
        </div>

        <div class="rb-media-meta">
          {/* Big tile only (the stylesheet hides it otherwise): which speaker
              this is, above what it is playing. */}
          <div class="rb-media-top">
            <Show when={isPlaying(player())} fallback={<Icon icon="mdi:speaker" width="14" />}>
              <span class="rb-media-top-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </Show>
            <span class="rb-truncate">{player()?.friendlyName ?? "Speaker"}</span>
          </div>

          <div class="rb-media-titles">
            <h3 class="rb-card-name rb-truncate">{now().heading}</h3>
            <Show when={now().sub || now().source}>
              <span class="rb-card-verdict rb-truncate">{now().sub || now().source}</span>
            </Show>
          </div>

          <Show when={progress() !== undefined}>
            <div class="rb-media-time">
              <span class="rb-media-bar" aria-hidden="true">
                <i style={{ width: `${progress()! * 100}%` }} />
              </span>
              <span class="rb-media-clock">
                <span>{clock(elapsed())}</span>
                <span>{clock(duration())}</span>
              </span>
            </div>
          </Show>

          {/* The keys and, on the big tile, the volume beside them: one row.
              Everywhere else this wrapper takes no part in the layout. */}
          <div class="rb-media-controls">
          <div class="rb-media-keys">
            <Show when={supports(player(), FEATURE.PREVIOUS_TRACK)}>
              <button
                class="rb-media-key"
                aria-label="Previous"
                onClick={(event) => press(event, "media_previous_track")}
              >
                <Icon icon="mdi:skip-previous" width="18" />
              </button>
            </Show>

            <button
              class="rb-media-play"
              aria-label={isPlaying(player()) ? "Pause" : "Play"}
              onClick={(event) => press(event, "media_play_pause")}
            >
              <Icon icon={isPlaying(player()) ? "mdi:pause" : "mdi:play"} width="20" />
            </button>

            <Show when={supports(player(), FEATURE.NEXT_TRACK)}>
              <button
                class="rb-media-key"
                aria-label="Next"
                onClick={(event) => press(event, "media_next_track")}
              >
                <Icon icon="mdi:skip-next" width="18" />
              </button>
            </Show>
          </div>

          {/* Big tile only: the volume, dragged on the card itself. The level
              follows the finger at once and is sent a few times a second. */}
          <Show when={supports(player(), FEATURE.VOLUME_SET)}>
            <div
              class="rb-media-vol"
              role="slider"
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volume()}
              tabindex="0"
              data-held={heldVolume()}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation();
                const group = event.currentTarget;
                group.setPointerCapture?.(event.pointerId);
                const track = group.querySelector(".rb-media-vol-track") as HTMLElement;
                grab = { x: event.clientX, from: volume(), width: track.getBoundingClientRect().width, moved: false, onTrack: track.contains(event.target as Node) };
                setHeldVolume(true);
              }}
              onPointerMove={(event) => {
                if (!grab || !heldVolume()) return;
                const dx = event.clientX - grab.x;
                if (!grab.moved && Math.abs(dx) < 4) return;
                grab.moved = true;
                /* Geared down: a whole sweep takes two and a half times the
                   line's width (and never less than 240px), so a pixel is a
                   fraction of a percent and a level can be set exactly. On an
                   80px line, one to one made every pixel more than one. */
                const travel = Math.max((grab.width || 1) * 2.5, 240);
                setVolume(Math.round(Math.max(0, Math.min(100, grab.from + (dx / travel) * 100))));
              }}
              onPointerUp={(event) => {
                if (!grab || !heldVolume()) return;
                setHeldVolume(false);
                const track = event.currentTarget.querySelector(".rb-media-vol-track") as HTMLElement;
                /* A tap on the line puts the level where it was tapped; a drag
                   anywhere in the group moves it from where it was. */
                /* A tap on the track jumps there; a drag has already set it. */
                const value = !grab.moved && grab.onTrack ? volumeAt(event, track) : volume();
                grab = undefined;
                setVolume(value, true);
              }}
              onPointerCancel={() => {
                if (!heldVolume()) return;
                grab = undefined;
                setHeldVolume(false);
                setVolume(volume(), true);
              }}
              onKeyDown={(event) => {
                /* One percent a press, ten with Page Up and Down. */
                const step = VOLUME_STEP[event.key] ?? 0;
                if (!step) return;
                event.preventDefault();
                setVolume(Math.max(0, Math.min(100, volume() + step)), true);
              }}
              onWheel={(event) => {
                /* The mouse's wheel, a percent a notch — the finest control a
                   desk has. Held on the volume, it does not scroll the page. */
                event.preventDefault();
                event.stopPropagation();
                const step = event.deltaY < 0 || event.deltaX > 0 ? 1 : -1;
                /* Shown at once, sent a few times a second while the wheel
                   turns, and once more, exactly, when it stops. */
                setVolume(Math.max(0, Math.min(100, volume() + step)));
                clearTimeout(wheelStop);
                wheelStop = setTimeout(() => setVolume(volume(), true), 250);
              }}
            >
              <Icon icon={volume() === 0 ? "mdi:volume-off" : "mdi:volume-medium"} width="16" />
              <span
                class="rb-media-vol-track"
                style={{ "--fill": `${volume()}%`, "--f": `${volume() / 100}` }}
              >
                <i class="rb-media-vol-fill" />
                <span class="rb-media-vol-rail">
                  <b class="rb-media-vol-knob" />
                </span>
              </span>
              <span>{volume()}</span>
            </div>
          </Show>
          </div>
        </div>
      </div>
    </article>
  );
}


/**
 * The player as a slim bar, for the Home room on a phone: the cover, what
 * is on, play or pause and next — docked at the foot of the screen over the
 * activity line, where the thumb is. A tap anywhere else opens the player.
 */
export function MiniPlayer(props: {
  players: EntityView[];
  haBaseUrl: string;
  artworkProxy?: string;
  chosen: string;
  onOpen: () => void;
}) {
  const { callService } = useService();
  const plexPlayers = usePlexPlayers();
  const player = createMemo(() => withPlexTwin(pickPlayer(props.players, props.chosen), plexPlayers()));
  const now = createMemo(() => readNowPlaying(player()));
  const art = createMemo(() => artSrc(artworkOf(player(), props.haBaseUrl, props.artworkProxy ?? "", plexPlayers())));
  const [broken, setBroken] = createSignal("");
  const press = (event: Event, service: string) => {
    event.stopPropagation();
    const id = player()?.id;
    if (id) void callService("media_player", service, {}, { entity_id: id });
  };
  const [tick, setTick] = createSignal(Date.now());
  const timer = setInterval(() => setTick(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  const progress = () => progressOf(player(), tick());

  return (
    <div class="rb-mini" data-playing={isPlaying(player())}>
      {/* The cover and the words open the player; the keys beside them are
          buttons of their own — a button cannot hold other buttons. */}
      <button type="button" class="rb-mini-open" aria-label="Open the player" onClick={props.onOpen}>
        <span class="rb-mini-art">
          <Show when={art() && broken() !== art()} fallback={<Icon icon="mdi:music" width="18" />}>
            <img
              src={art()}
              alt=""
              decoding="async"
              onError={() => {
                noteImageFailure(art());
                setBroken(art() ?? "");
              }}
            />
          </Show>
        </span>
        <span class="rb-mini-text">
          <b class="rb-truncate">{now().heading}</b>
          <span class="rb-truncate">
            {now().sub || (player()?.friendlyName !== now().heading ? player()?.friendlyName : "") || ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        class="rb-mini-key rb-mini-play"
        aria-label={isPlaying(player()) ? "Pause" : "Play"}
        onClick={(event) => press(event, "media_play_pause")}
      >
        <Icon icon={isPlaying(player()) ? "mdi:pause" : "mdi:play"} width="20" />
      </button>
      <Show when={supports(player(), FEATURE.NEXT_TRACK)}>
        <button type="button" class="rb-mini-key" aria-label="Next" onClick={(event) => press(event, "media_next_track")}>
          <Icon icon="mdi:skip-next" width="20" />
        </button>
      </Show>
      <Show when={progress() !== undefined}>
        <i class="rb-mini-bar" style={{ width: `${(progress() ?? 0) * 100}%` }} />
      </Show>
    </div>
  );
}
