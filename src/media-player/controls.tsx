import { artSrc } from "../artwork";
import { useDomains } from "../domains";
import { Show, batch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { markArtShape, noteImageFailure } from "./cover";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { FEATURE, isMusicAssistant, supports } from "./features";
import { Marquee } from "./marquee";
import { SourceSelect } from "./source";
import { attr, createLivePosition, formatTime, isActiveState, volumeIconOf } from "./util";
import { QueueSheet, changeQueue, useQueueNeighbours, type QueueRow } from "./queue";
import { favouriteButtonFor } from "./favourite";
import { SubSheet } from "./subsheet";
import { StableImg, holdLast } from "./stable-img";
import { LyricsView, fetchLyrics, type Lyrics } from "./lyrics";
import { brandStyle, placeholderBrand } from "./brand";
import { keyStep } from "../keys";
import { errorMessage } from "../errors";

/** Resolves once an image has loaded — or failed, which is as good. */
function loadImage(url: string): Promise<void> {
  return new Promise((done) => {
    /* The sealed engine of Dash 1.5 has no Image to load with: no waiting. */
    if (typeof Image === "undefined") return done();
    const img = new Image();
    img.onload = img.onerror = () => done();
    img.src = url;
    if (img.complete) done();
  });
}

/** Resolves when every picture is in, or after 1.2 s, whichever is first. */
function preloadImages(urls: (string | undefined)[]): Promise<unknown> {
  const pictures = urls.filter((url): url is string => !!url).map(loadImage);
  return Promise.race([Promise.all(pictures), new Promise<void>((done) => setTimeout(done, 1200))]);
}

/** Calls `fn` once the browser has painted the frame being prepared now. */
function afterNextPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function NowPlaying(props: {
  player: () => EntityView | undefined;
  artwork: () => string | undefined;
  /** False when the Remote tab already lists this player's sources as apps. */
  showSource?: boolean;
  artworkProxy?: string;
  haBaseUrl?: string;
  /** A panel too short for the full layout: see panels.tsx. */
  compact?: boolean;
  /** A phone: the round cover in its progress ring, the queue in the dock. */
  phone?: boolean;
  /** In the room board's overlay: its queue panel and its lyrics. */
  board?: boolean;
  /** The popup has the queue as a tab of its own: no button for it here. */
  queueTab?: boolean;
  /** Bumped when a tab is tapped: any sheet open over Now closes. */
  closeSheets?: number;
}) {
  const domains = useDomains();
  const { callService } = useService();
  const position = createLivePosition(props.player);

  const call = (service: string, data: Record<string, unknown> = {}) => {
    const target = props.player()?.id;
    if (target) void callService("media_player", service, data, { entity_id: target });
  };

  const can = (bit: number) => supports(props.player(), bit);

  /* Queue and favourites are Music Assistant's, not Home Assistant's: a Sonos
     driven directly has neither action, so both controls are held back rather
     than offered and then failing. */
  const mass = () => isMusicAssistant(props.player());
  const [queueOpen, setQueueOpen] = createSignal(false);
  createEffect(on(() => props.closeSheets, () => setQueueOpen(false), { defer: true }));
  const [volOpen, setVolOpen] = createSignal(false);
  /* A press anywhere but the volume closes it. */
  const closeVolumeOutside = (event: PointerEvent) => {
    if (volOpen() && !(event.target as Element).closest?.(".mp-pnow-volwrap")) setVolOpen(false);
  };
  const [favDone, setFavDone] = createSignal(false);
  const [favNote, setFavNote] = createSignal<string | undefined>();

  /* The favourite button mass_queue creates alongside this player, if any.
     Resolved from the entity list rather than assumed, so the heart appears
     exactly where pressing it will work. */
  const favButton = () => favouriteButtonFor(props.player()?.id ?? "", domains().button ?? []);

  const favourite = () => {
    const id = favButton();
    if (!id) return;

    // Filled for a beat, then back to an outline: the button reports nothing
    // about whether the track is already a favourite, so a heart that stayed
    // filled would be claiming something the widget cannot check.
    setFavDone(true);
    setTimeout(() => setFavDone(false), 1600);

    void callService("button", "press", {}, { entity_id: id }).catch((err: unknown) => {
      setFavDone(false);
      setFavNote(errorMessage(err, "Could not favourite this"));
      setTimeout(() => setFavNote(undefined), 4000);
    });
  };

  const duration = () => attr<number | undefined>(props.player(), "media_duration", undefined);
  const volume = () => Math.round(attr<number>(props.player(), "volume_level", 0) * 100);
  const muted = () => attr<boolean>(props.player(), "is_volume_muted", false);
  const shuffle = () => attr<boolean>(props.player(), "shuffle", false);
  const repeat = () => attr<string>(props.player(), "repeat", "off");
  /* Off, all, one, and round again. */
  const NEXT_REPEAT: Record<string, string> = { off: "all", all: "one" };
  const nextRepeat = () => NEXT_REPEAT[repeat()] ?? "off";

  const seekPct = () => {
    const d = duration();
    const p = position();
    return d && p !== undefined && d > 0 ? Math.min(100, (p / d) * 100) : 0;
  };

  const source = () => attr<string>(props.player(), "source", "");

  /* What the hero says, in the order the thing itself is named.
   *
   * A television names the show first and the episode second; a music player
   * fills media_title and media_artist and nothing else. Reading media_title
   * first served the music case and gave a series the episode name in bold
   * with the show underneath — and on a player that fills only the series, the
   * bold line fell through to the entity's own state. Each line is also hidden
   * when it is empty rather than reserving a blank row, which is most of what
   * made the old block look untidy. */
  const series = () => attr<string>(props.player(), "media_series_title", "");
  const mediaTitle = () => attr<string>(props.player(), "media_title", "");
  const artist = () => attr<string>(props.player(), "media_artist", "");
  const album = () => attr<string>(props.player(), "media_album_name", "");
  const appName = () => attr<string>(props.player(), "app_name", "");

  const heroTitle = () =>
    series() || mediaTitle() || props.player()?.friendlyName || props.player()?.state || "Idle";

  const heroSub = () => {
    // The title line took the show, so this one takes the episode.
    if (series() && mediaTitle()) {
      const season = attr<string | number>(props.player(), "media_season", "");
      const episode = attr<string | number>(props.player(), "media_episode", "");
      let numbering = "";
      if (episode) numbering = season ? `S${season} E${episode}` : `E${episode}`;
      return numbering ? `${numbering} · ${mediaTitle()}` : mediaTitle();
    }
    return artist();
  };

  /* Only when it adds something: an album that repeats the title, or repeats
     the artist's own name, is a line of noise. */
  const heroThird = () => {
    const value = album();
    if (!value || value === heroTitle() || value === heroSub()) return "";
    return value;
  };

  /* Remembered per URL rather than as a flag: the next track's artwork must
     get its own chance, and Music Assistant's proxy 404s often enough that a
     sticky failure would leave the hero empty for the rest of the session. */
  /* The cover as shown: the player's artwork, held through the moment of
     nothing a player often reports between two tracks (stable-img.tsx). */
  const art = holdLast(() => artSrc(props.artwork(), 320));
  const [artFailed, setArtFailed] = createSignal<string | undefined>();
  const artOk = () => !!art() && artFailed() !== art();
  const artFailedToLoad = () => {
    noteImageFailure(art());
    setArtFailed(art());
  };

  /* What played before this, remembered as the track changes: the queue
     often knows only the next item, and the cover on the left wants the one
     that just finished. */
  type Track = { key: string; name: string; subtitle?: string; image?: string };
  const [lastTrack, setLastTrack] = createSignal<QueueRow | undefined>();
  createEffect<Track | undefined>((before) => {
    const now: Track = {
      key: `${props.player()?.id}|${attr(props.player(), "media_content_id", "")}|${mediaTitle()}`,
      name: heroTitle(),
      subtitle: heroSub() || undefined,
      image: art(),
    };
    if (before && before.key !== now.key && before.name) {
      setLastTrack({ id: before.key, name: before.name, subtitle: before.subtitle, image: before.image });
    }
    return now;
  });

  const neighbours = useQueueNeighbours({
    player: props.player,
    enabled: () => mass() && !props.phone,
    artworkProxy: props.artworkProxy,
    haBaseUrl: props.haBaseUrl,
  });

  /* ---------- the phone ----------
   *
   * The title large at the top with the heart beside it, the cover as a disc
   * inside a ring that is the track's progress — drag round it to seek, the
   * time written in the gap at its foot — and the transport along the
   * bottom around a white play button. The queue lives in the dock. */
  const RING_GAP = 12;
  const [seekLive, setSeekLive] = createSignal<number | undefined>();
  const ringPct = () => seekLive() ?? seekPct();
  let disc: HTMLDivElement | undefined;

  /* The angle round the ring, as a fraction of the drawn arc: it starts just
     past the gap at the foot and runs clockwise. */
  const ringAt = (event: PointerEvent) => {
    if (!disc) return undefined;
    const box = disc.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI - 90 - (RING_GAP / 2) * 3.6;
    deg = ((deg % 360) + 360) % 360;
    return Math.max(0, Math.min(100, (deg / (360 * (1 - RING_GAP / 100))) * 100));
  };

  const seekTo = (pct: number) => {
    const d = duration();
    if (d) call("media_seek", { seek_position: Math.round((pct / 100) * d) });
  };

  /* The volume, told a few times a second while it moves and once exactly
     when it stops. */
  let volSentAt = 0;
  const setVolume = (value: number, final: boolean) => {
    const now = Date.now();
    if (!final && now - volSentAt < 180) return;
    volSentAt = now;
    call("volume_set", { volume_level: value / 100 });
  };

  const volumeIcon = () => volumeIconOf(muted() ? 0 : volume());

  /* Back to the track before, not the start of this one. A player treats
     "previous" the way a CD player does — past the first seconds it restarts
     the track, and only a second press goes back — so a queue item that is
     known is played by its id, and anything else is pressed twice once the
     track is under way. */
  const goPrevious = () => {
    const id = props.player()?.id;
    const before = neighbours.prev();
    if (id && mass() && before?.playable) {
      void changeQueue(callService, id, before.id, "play").catch(() =>
        call("media_previous_track"),
      );
      return;
    }
    const played = position() ?? 0;
    call("media_previous_track");
    if (played > 3) setTimeout(() => call("media_previous_track"), 450);
  };

  const goNext = () => call("media_next_track");

  /* ---------- swiping the cover to change track ----------
   *
   * The cover follows the finger sideways; let go past a fifth of its width
   * and it slides off, the next (or previous) track is asked for, and the
   * new cover slides in from the other side. Short of that it springs back.
   * The direction is decided on the first few pixels, so an upward drag is
   * still the page's to scroll. */
  const [swipeX, setSwipeX] = createSignal(0);
  const [swipeHeld, setSwipeHeld] = createSignal(false);
  let swipe:
    | { x: number; y: number; width: number; carousel: boolean; axis?: "x" | "y" }
    | undefined;
  /* The carousel's step: how far the cover travels to a neighbour's place. */
  const [step, setStep] = createSignal(0);

  const swipeStart = (event: PointerEvent, width: number, carousel = false) => {
    if (event.button !== 0) return;
    swipe = { x: event.clientX, y: event.clientY, width, carousel };
    if (carousel) setStep(width);
  };

  const swipeMove = (event: PointerEvent) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (!swipe.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipe.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (swipe.axis === "x") {
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        setSwipeHeld(true);
      }
    }
    if (swipe.axis === "x") setSwipeX(dx);
  };

  /* ---------- settling after a swipe ----------
   *
   * Between a swipe and the new track being fully known, a player reports
   * in pieces — the title, then the picture (often twice), then the queue
   * its neighbours. Drawn as they came, every piece moved a cover. So the
   * three covers are frozen as they were when the swipe was let go, the
   * carousel finishes its move on them, and only once the new track, its
   * neighbours and their pictures are all in (or a few seconds have passed)
   * does the row switch to the new state — in one frame, without motion. */
  type Frame = { prev?: QueueRow; art?: string; next?: QueueRow };
  const [frozen, setFrozen] = createSignal<Frame>();
  let settling: { key: string; version: number } | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const trackKey = () => `${mediaTitle()}|${attr(props.player(), "media_content_id", "")}`;

  /* The row to the new track in one frame, without motion; the swipe's
     hold let go once that frame is on screen. */
  const unhold = () => setSwipeHeld(false);
  const release = () =>
    batch(() => {
      setSwipeHeld(true);
      setSwipeX(0);
      setFrozen(undefined);
      afterNextPaint(unhold);
    });

  const settle = () => {
    if (!settling) return;
    settling = undefined;
    clearTimeout(settleTimer);
    void preloadImages([art(), prevCard()?.image, nextCard()?.image]).then(release);
  };

  createEffect(
    on([trackKey, () => neighbours.version(), art], () => {
      if (!settling) return;
      if (trackKey() === settling.key) return;
      /* A queue to wait for: its answer for the new track. */
      if (mass() && neighbours.version() === settling.version) return;
      settle();
    }),
  );
  onCleanup(() => clearTimeout(settleTimer));

  /* What the row draws: the frozen frame while a swipe settles. */
  const shownPrev = () => (frozen() ? frozen()!.prev : prevCard());
  const shownNext = () => (frozen() ? frozen()!.next : nextCard());
  const shownArt = () => (frozen() ? frozen()!.art : art());

  const swipeEnd = () => {
    const was = swipe;
    swipe = undefined;
    if (was?.axis !== "x") return;
    setSwipeHeld(false);
    const dx = swipeX();

    if (was.carousel) {
      if (Math.abs(dx) < Math.min(110, was.width * 0.3)) {
        setSwipeX(0);
        return;
      }
      const next = dx < 0;
      setFrozen({ prev: prevCard(), art: art(), next: nextCard() });
      setSwipeX(next ? -was.width : was.width);
      settling = { key: trackKey(), version: neighbours.version() };
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (settling) settle();
      }, 3500);
      if (next) goNext();
      else goPrevious();
      return;
    }

    if (Math.abs(dx) < Math.min(110, was.width * 0.2)) {
      setSwipeX(0);
      return;
    }
    const next = dx < 0;
    setSwipeX(next ? -was.width : was.width);
    if (next) goNext();
    else goPrevious();
    /* Off one side, then in from the other: jump there unanimated, and
       let it ease back to the middle on the next frame. */
    setTimeout(() => {
      setSwipeHeld(true);
      setSwipeX(next ? was.width * 0.6 : -was.width * 0.6);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setSwipeHeld(false);
          setSwipeX(0);
        }),
      );
    }, 230);
  };

  const swipeStyle = () => ({
    transform: swipeX() ? `translateX(${swipeX()}px)` : undefined,
    opacity: swipeX() ? `${Math.max(0.25, 1 - Math.abs(swipeX()) / 600)}` : undefined,
  });

  /* The carousel, from how far along the drag is (-1 to 1): the cover in the
     middle shrinks, fades and moves the way it is pushed; the neighbour on
     the other side comes to the middle, growing and brightening; the one it
     is pushed toward drifts out and fades. */
  const travel = () => {
    const s = step();
    return s ? Math.max(-1, Math.min(1, swipeX() / s)) : 0;
  };

  const mainStyle = () => {
    const p = travel();
    if (!p) return undefined;
    const a = Math.abs(p);
    return {
      transform: `translateX(${p * step()}px) scale(${1 - 0.2 * a})`,
      opacity: `${1 - 0.62 * a}`,
    };
  };

  const sideStyle = (which: "prev" | "next") => {
    const p = travel();
    if (!p) return undefined;
    // Above zero: this neighbour is the one coming to the middle.
    const coming = which === "next" ? -p : p;
    if (coming > 0) {
      return {
        transform: `translateX(${p * step()}px) scale(${1 + 0.25 * coming})`,
        opacity: `${0.38 + 0.62 * coming}`,
        filter: `saturate(${0.7 + 0.3 * coming})`,
        "z-index": coming > 0.5 ? "3" : "1",
      };
    }
    return {
      transform: `translateX(${p * step() * 0.6}px) scale(${1 + 0.15 * coming})`,
      opacity: `${0.38 * (1 + coming)}`,
    };
  };

  const phoneView = () => (
    <>
    <div
      class="mp-pnow"
      onPointerDown={closeVolumeOutside}
    >
      <Show when={art()}>
        <div class="mp-pnow-bg" style={{ "background-image": `url("${art()}")` }} />
      </Show>

      <header class="mp-pnow-head">
        <div class="mp-pnow-titles">
          <Marquee class="mp-pnow-title" text={heroTitle()} />
          <Show when={heroSub()}>
            <span class="mp-pnow-artist mp-truncate">{heroSub()}</span>
          </Show>
        </div>
        <Show when={mass() && favButton()}>
          <button
            class="mp-pnow-heart"
            data-on={favDone()}
            aria-label="Add to favourites"
            onClick={favourite}
          >
            <Icon icon={favDone() ? "mdi:heart" : "mdi:heart-outline"} width="21" />
          </button>
        </Show>
      </header>

      <Show when={favNote()}>
        <p class="mp-queue-note">{favNote()}</p>
      </Show>

      <div class="mp-pnow-stage">
        <div
          ref={disc}
          class="mp-pnow-disc"
          data-seek={!!duration() && can(FEATURE.SEEK)}
          onPointerDown={(event) => {
            if (!disc) return;
            /* Only the ring seeks: a tap on the cover is not a seek. */
            const box = disc.getBoundingClientRect();
            const r = Math.hypot(
              event.clientX - (box.left + box.width / 2),
              event.clientY - (box.top + box.height / 2),
            );
            /* The cover itself is swiped to change track. */
            if (r < box.width * 0.4) {
              swipeStart(event, box.width);
              return;
            }
            if (!duration() || !can(FEATURE.SEEK)) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setSeekLive(ringAt(event));
          }}
          onPointerMove={(event) => {
            if (swipe) swipeMove(event);
            else if (seekLive() !== undefined && event.buttons) setSeekLive(ringAt(event));
          }}
          onPointerUp={() => {
            if (swipe) return swipeEnd();
            const pct = seekLive();
            if (pct === undefined) return;
            seekTo(pct);
            setTimeout(() => setSeekLive(undefined), 800);
          }}
          onPointerCancel={() => {
            if (swipe) return swipeEnd();
            setSeekLive(undefined);
          }}
        >
          <svg class="mp-pnow-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle
              class="mp-pnow-ring-track"
              cx="50"
              cy="50"
              r="43"
              pathLength="100"
              stroke-dasharray={`${100 - RING_GAP} ${RING_GAP}`}
              transform={`rotate(${90 + (RING_GAP / 2) * 3.6} 50 50)`}
            />
            <Show when={duration()}>
              <circle
                class="mp-pnow-ring-played"
                cx="50"
                cy="50"
                r="43"
                pathLength="100"
                stroke-dasharray={`${(ringPct() / 100) * (100 - RING_GAP)} 100`}
                transform={`rotate(${90 + (RING_GAP / 2) * 3.6} 50 50)`}
              />
            </Show>
          </svg>

          <div
            class="mp-art-frame mp-pnow-frame"
            data-held={swipeHeld()}
            style={{ "--art": `url("${art()}")`, ...swipeStyle() }}
          >
            <Show
              when={artOk()}
              fallback={
                <div
                  class="mp-pnow-art mp-art-placeholder"
                  data-brand="true"
                  style={brandStyle(placeholderBrand(props.player()))}
                >
                  {/* No cover, but a known app: its logo on its own ground. */}
                  <Icon
                    icon={placeholderBrand(props.player()).icon}
                    width={undefined}
                  />
                </div>
              }
            >
              <StableImg
                class="mp-pnow-art"
                src={art()}
                onLoad={markArtShape}
                onError={artFailedToLoad}
              />
            </Show>
          </div>

          <Show when={duration()}>
            <span class="mp-pnow-time">
              {formatTime(
                seekLive() !== undefined ? ((seekLive()! / 100) * (duration() ?? 0)) : position(),
              )}
            </span>
          </Show>
        </div>
      </div>

      <div class="mp-pnow-transport">
        {/* The queue where shuffle was, for a player that has one; a player
            without a queue keeps its shuffle here. */}
        <Show
          when={mass()}
          fallback={
          <button
            class="mp-pnow-btn"
            data-on={shuffle()}
            disabled={!can(FEATURE.SHUFFLE_SET)}
            aria-label="Shuffle"
            onClick={() => call("shuffle_set", { shuffle: !shuffle() })}
          >
            <Icon icon="mdi:shuffle-variant" width="17" />
          </button>
          }
        >
          <button
            class="mp-pnow-btn"
            data-on={queueOpen()}
            aria-label="Queue"
            onClick={() => setQueueOpen(true)}
          >
            <Icon icon="mdi:playlist-music" width="19" />
          </button>
        </Show>

        <button class="mp-pnow-btn" aria-label="Previous" onClick={goPrevious}>
          <Icon icon="mdi:skip-previous" width="22" />
        </button>

        <button class="mp-pnow-play" aria-label="Play or pause" onClick={() => call("media_play_pause")}>
          <Icon icon={isActiveState(props.player()) ? "mdi:pause" : "mdi:play"} width="22" />
        </button>

        <button class="mp-pnow-btn" aria-label="Next" onClick={() => call("media_next_track")}>
          <Icon icon="mdi:skip-next" width="22" />
        </button>

        {/* The volume, where repeat was: a pill that rises out of the
            button, so the level is a thumb's reach from the transport and
            not a row of its own. */}
        <div class="mp-pnow-volwrap">
          <Show when={volOpen()}>
            <div class="mp-pnow-volpop">
              <VolumePill
                value={muted() ? 0 : volume()}
                muted={muted()}
                onSet={setVolume}
                onMute={() => call("volume_mute", { is_volume_muted: !muted() })}
              />
            </div>
          </Show>
          <button
            class="mp-pnow-btn"
            data-on={volOpen()}
            aria-label="Volume"
            aria-expanded={volOpen()}
            onClick={() => setVolOpen((open) => !open)}
          >
            <Icon icon={volumeIcon()} width="19" />
          </button>
        </div>
      </div>

    </div>

    {/* Outside the screen's own block, so the sheet covers the whole popup
        the way the speakers' sheet does. */}
    <Show when={queueOpen() && mass()}>
      <SubSheet title="Queue" onBack={() => setQueueOpen(false)}>
        <QueueSheet
          player={props.player}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
          onClose={() => setQueueOpen(false)}
          inSheet
        />
      </SubSheet>
    </Show>
    </>
  );

  /* ---------- the tablet and the desktop ----------
   *
   * The cover large in the middle with the artist over it, and — where the
   * player has a queue — the tracks either side of it, faded, the way a
   * record shelf reads; the title under it, the transport in three groups
   * across the width, and the progress as a line with its times beneath.
   * The artwork's own colours glow softly behind it all. */
  /* Given the neighbour as an accessor, not a value: called with the value,
     every refresh of the queue — a new object for the same track — rebuilt
     the whole side, reloaded its picture and replayed its fade. Now the side
     is built once and only its contents follow. */
  const side = (row: () => QueueRow | undefined, which: "prev" | "next") => (
    <Show when={row()} fallback={<div class="mp-snow-side" data-empty="true" aria-hidden="true" />}>
      {(r) => (
        <button
          class="mp-snow-side"
          data-side={which}
          style={sideStyle(which)}
          aria-label={which === "prev" ? "Previous track" : "Next track"}
          onClick={() => (which === "prev" ? goPrevious() : goNext())}
        >
          <span class="mp-snow-side-by mp-truncate">{r().subtitle ?? ""}</span>
          <span class="mp-snow-side-art">
            <Show when={artSrc(r().image, 320)} fallback={<Icon icon="mdi:music" width="28" />}>
              <StableImg src={r().image} />
            </Show>
          </span>
          <span class="mp-snow-side-name mp-truncate">{r().name}</span>
        </button>
      )}
    </Show>
  );

  const prevCard = () => (mass() ? (neighbours.prev() ?? lastTrack()) : undefined);
  const nextCard = () => (mass() ? neighbours.next() : undefined);

  /* Room for the queue beside everything else: the overlay measured, not
     guessed, and the list only mounted when it will be seen — it reads a
     long stretch of the queue. */
  const [roomy, setRoomy] = createSignal(false);
  /* Measured on the panel around the view: with the queue beside it the
     view itself has no box of its own (display: contents) and reads as zero
     wide, which would switch the queue off again, and on, and off. */
  const watchWidth = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;
    queueMicrotask(() => {
      const panel = el.parentElement;
      if (!panel) return;
      const observer = new ResizeObserver(([entry]) =>
        setRoomy((entry?.contentRect.width ?? 0) >= 800),
      );
      observer.observe(panel);
      onCleanup(() => observer.disconnect());
    });
  };
  /* Wide: the queue opens as a panel sliding in from the right. */
  const queueDrawer = () => queueOpen() && roomy() && mass() && !!props.board;

  /* Lyrics beside the player on a wide popup, for music: asked when the
     track changes and only when there is room to show them. */
  /* "loading" while the new track's are asked — the column keeps its place,
     so a track change does not collapse it and swing the whole layout over
     and back — null when there are none, undefined when there is no column
     at all (not music, or no room). */
  const [lyrics, setLyrics] = createSignal<Lyrics | null | "loading" | undefined>();
  const lyricsFound = () => {
    const value = lyrics();
    return value && value !== "loading" ? value : undefined;
  };
  /* Lyrics come from lrclib.net, and the sealed engine of Dash 1.5 has no
     fetch: there the column is left out rather than always saying none. */
  const canFetch = typeof fetch === "function";
  const lyricKey = createMemo(() =>
    canFetch && props.board && roomy() && mediaTitle() && artist() && !series()
      ? `${artist()}|${mediaTitle()}|${album()}`
      : "",
  );
  createEffect(
    on(lyricKey, (key) => {
      if (!key) {
        setLyrics(undefined);
        return;
      }
      setLyrics("loading");
      void fetchLyrics(
        { title: mediaTitle(), artist: artist(), album: album() || undefined, duration: duration() },
        props.artworkProxy ?? "",
      ).then((found) => {
        if (lyricKey() === key) setLyrics(found ?? null);
      });
    }),
  );

  const stageView = () => (
    <>
    <div
      ref={watchWidth}
      class="mp-snow"
      data-lyrics={lyrics() !== undefined}
      onPointerDown={closeVolumeOutside}
    >
      <div class="mp-snow-col">
      {/* The glow sits behind the cover where it is, in the player's own
          column, not centred on the whole popup. */}
      <Show when={art()}>
        <div class="mp-snow-bg" style={{ "background-image": `url("${art()}")` }} />
      </Show>
      <div class="mp-snow-stage">
        <div
          class="mp-snow-row"
          data-sides={mass()}
          data-held={swipeHeld()}
          onPointerDown={(event) => {
            /* A step is the distance from the middle to a neighbour's place. */
            const main = event.currentTarget.querySelector(".mp-snow-main") as HTMLElement | null;
            swipeStart(event, (main?.offsetWidth ?? 300) * 0.78, true);
          }}
          onPointerMove={swipeMove}
          onPointerUp={swipeEnd}
          onPointerCancel={swipeEnd}
          ref={(el) =>
            /* A swipe that ended on a side cover is not a tap on it. */
            el.addEventListener(
              "click",
              (event) => {
                if (Math.abs(swipeX()) > 8) event.stopPropagation();
              },
              true,
            )
          }
        >
          <Show when={mass()}>{side(shownPrev, "prev")}</Show>

          <div class="mp-snow-main" style={mainStyle()}>
            <span class="mp-snow-by mp-truncate">{heroSub() || appName() || source()}</span>
            <div class="mp-art-frame mp-snow-frame" style={{ "--art": `url("${shownArt()}")` }}>
              <Show
                when={artOk()}
                fallback={
                  <div
                    class="mp-snow-art mp-art-placeholder"
                    data-brand="true"
                    style={brandStyle(placeholderBrand(props.player()))}
                  >
                    {/* No cover, but a known app: its logo on its own ground. */}
                    <Icon
                      icon={placeholderBrand(props.player()).icon}
                      width={undefined}
                    />
                  </div>
                }
              >
                <StableImg
                  class="mp-snow-art"
                  src={shownArt()}
                  onLoad={markArtShape}
                  onError={artFailedToLoad}
                />
              </Show>
            </div>
          </div>

          <Show when={mass()}>{side(shownNext, "next")}</Show>
        </div>
      </div>

      <div class="mp-snow-meta">
        <Marquee class="mp-snow-title" text={heroTitle()} />
        <Show when={heroThird()}>
          <span class="mp-snow-sub mp-truncate">{heroThird()}</span>
        </Show>
      </div>

      <Show when={favNote()}>
        <p class="mp-queue-note">{favNote()}</p>
      </Show>

      <div class="mp-snow-transport">
        <div class="mp-snow-group">
          <Show when={can(FEATURE.SHUFFLE_SET)}>
            <button
              class="mp-pnow-btn"
              data-on={shuffle()}
              aria-label="Shuffle"
              onClick={() => call("shuffle_set", { shuffle: !shuffle() })}
            >
              <Icon icon="mdi:shuffle-variant" width="18" />
            </button>
          </Show>
          <Show when={can(FEATURE.REPEAT_SET)}>
            <button
              class="mp-pnow-btn"
              data-on={repeat() !== "off"}
              aria-label="Repeat"
              onClick={() => call("repeat_set", { repeat: nextRepeat() })}
            >
              <Icon icon={repeat() === "one" ? "mdi:repeat-once" : "mdi:repeat"} width="18" />
            </button>
          </Show>
        </div>

        <div class="mp-snow-group mp-snow-group--mid">
          <button class="mp-pnow-btn" aria-label="Previous" onClick={goPrevious}>
            <Icon icon="mdi:rewind" width="24" />
          </button>
          <button class="mp-pnow-play mp-snow-play" aria-label="Play or pause" onClick={() => call("media_play_pause")}>
            <Icon icon={isActiveState(props.player()) ? "mdi:pause" : "mdi:play"} width="24" />
          </button>
          <button class="mp-pnow-btn" aria-label="Next" onClick={() => call("media_next_track")}>
            <Icon icon="mdi:fast-forward" width="24" />
          </button>
        </div>

        <div class="mp-snow-group mp-snow-group--end">
          <div class="mp-pnow-volwrap">
            <Show when={volOpen()}>
              <div class="mp-pnow-volpop">
                <VolumePill
                  value={muted() ? 0 : volume()}
                  muted={muted()}
                  onSet={setVolume}
                  onMute={() => call("volume_mute", { is_volume_muted: !muted() })}
                />
              </div>
            </Show>
            <button
              class="mp-pnow-btn"
              data-on={volOpen()}
              aria-label="Volume"
              aria-expanded={volOpen()}
              onClick={() => setVolOpen((open) => !open)}
            >
              <Icon icon={volumeIcon()} width="18" />
            </button>
          </div>
          <Show when={mass() && favButton()}>
            <button
              class="mp-pnow-btn"
              data-on={favDone()}
              aria-label="Add to favourites"
              onClick={favourite}
            >
              <Icon icon={favDone() ? "mdi:heart" : "mdi:heart-outline"} width="18" />
            </button>
          </Show>
          <Show when={mass() && !props.queueTab}>
            <button
              class="mp-pnow-btn"
              data-on={queueOpen()}
              aria-label="Queue"
              onClick={() => setQueueOpen((open) => !open)}
            >
              <Icon icon="mdi:playlist-music" width="18" />
            </button>
          </Show>
        </div>
      </div>

      <Show when={duration()}>
        <div class="mp-snow-seek" style={{ "--p": `${ringPct()}%` }}>
          <input
            class="mp-snow-range"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={ringPct()}
            aria-label="Seek"
            disabled={!can(FEATURE.SEEK)}
            onInput={(event) => setSeekLive(Number(event.currentTarget.value))}
            onChange={(event) => {
              seekTo(Number(event.currentTarget.value));
              setTimeout(() => setSeekLive(undefined), 800);
            }}
          />
          <div class="mp-snow-times">
            <span>
              {formatTime(
                seekLive() !== undefined ? (seekLive()! / 100) * (duration() ?? 0) : position(),
              )}
            </span>
            <span>{formatTime(duration())}</span>
          </div>
        </div>
      </Show>

      {/* A Music Assistant player's source is always Music Assistant. */}
      <Show when={props.showSource !== false && !isMusicAssistant(props.player())}>
        <SourceSelect player={props.player} />
      </Show>
      </div>

      {/* Wide, for music: the lyrics, faded, following the song — or a
          quiet word that there are none, rather than the column vanishing. */}
      <Show when={lyrics() !== undefined}>
        <aside class="mp-snow-lyrics" aria-label="Lyrics">
          <Show when={lyrics() === null}>
            <p class="mp-lyrics-none">No lyrics found</p>
          </Show>
          {/* Keyed, so each song's lyrics arrive as a fresh column that fades in. */}
          <Show when={lyricsFound()} keyed>
            {(found) => (
              <LyricsView
                lyrics={found}
                position={() => position()}
                duration={duration}
                onSeek={(seconds) => can(FEATURE.SEEK) && call("media_seek", { seek_position: seconds })}
              />
            )}
          </Show>
        </aside>
      </Show>

    </div>

    {/* Wide: the queue as a panel from the right — outside the Now view,
        so it is placed against the overlay itself and runs from its top,
        over the "Now playing" header, to its foot. */}
    <Show when={queueDrawer()}>
      <aside class="mp-snow-queue" aria-label="Queue">
        <header class="mp-snow-queue-head">
          <h3>Queue</h3>
          <button class="mp-pnow-btn" aria-label="Close the queue" onClick={() => setQueueOpen(false)}>
            <Icon icon="mdi:close" width="18" />
          </button>
        </header>
        <QueueSheet
          player={props.player}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
          onClose={() => setQueueOpen(false)}
          inSheet
        />
      </aside>
    </Show>

    <Show when={queueOpen() && mass() && !queueDrawer()}>
      <SubSheet title="Queue" onBack={() => setQueueOpen(false)}>
        <QueueSheet
          player={props.player}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
          onClose={() => setQueueOpen(false)}
          inSheet
        />
      </SubSheet>
    </Show>
    </>
  );

  return (
    <Show when={props.phone} fallback={stageView()}>
      {phoneView()}
    </Show>
  );
}

/**
 * The phone's volume: a pill that fills from the bottom. A drag moves the
 * level from where it is — never to where the finger landed, so opening it
 * cannot throw the volume — and the wheel steps a percent a notch. The level
 * shown holds for a moment after it stops, until the speaker has caught up.
 */
export function VolumePill(props: {
  value: number;
  muted: boolean;
  onSet: (value: number, final: boolean) => void;
  onMute: () => void;
}) {
  const [live, setLive] = createSignal<number | undefined>();
  const [held, setHeld] = createSignal(false);
  const shown = () => live() ?? props.value;
  let grab: { y: number; from: number; travel: number } | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;

  const set = (value: number, final: boolean) => {
    clearTimeout(settle);
    const v = Math.round(Math.max(0, Math.min(100, value)));
    setLive(v);
    props.onSet(v, final);
    if (final) settle = setTimeout(() => setLive(undefined), 1500);
  };

  onCleanup(() => {
    clearTimeout(settle);
    clearTimeout(quiet);
  });

  return (
    <div class="mp-pnow-pill" data-held={held()} style={{ "--v": `${shown()}%` }}>
      <span class="mp-pnow-pill-pct">{props.muted ? "\u2014" : Math.round(shown())}</span>
      <div
        class="mp-pnow-pill-track"
        role="slider"
        tabindex="0"
        aria-label="Volume"
        aria-orientation="vertical"
        aria-valuenow={Math.round(shown())}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const height = event.currentTarget.getBoundingClientRect().height;
          grab = { y: event.clientY, from: shown(), travel: Math.max(height * 1.4, 180) };
          setHeld(true);
        }}
        onPointerMove={(event) => {
          if (!grab) return;
          set(grab.from + ((grab.y - event.clientY) / grab.travel) * 100, false);
        }}
        onPointerUp={() => {
          if (!grab) return;
          grab = undefined;
          setHeld(false);
          if (live() !== undefined) set(live()!, true);
        }}
        onPointerCancel={() => {
          grab = undefined;
          setHeld(false);
        }}
        onWheel={(event) => {
          event.preventDefault();
          set(shown() + (event.deltaY < 0 ? 1 : -1), false);
          clearTimeout(quiet);
          quiet = setTimeout(() => set(shown(), true), 250);
        }}
        onKeyDown={(event) => {
          const delta = keyStep(event.key, 1, 10);
          if (!delta) return;
          event.preventDefault();
          set(shown() + delta, true);
        }}
      >
        <i class="mp-pnow-pill-fill" />
      </div>
      <button
        class="mp-pnow-pill-mute"
        data-on={props.muted}
        aria-label={props.muted ? "Unmute" : "Mute"}
        onClick={props.onMute}
      >
        <Icon icon={props.muted ? "mdi:volume-off" : "mdi:volume-high"} width="16" />
      </button>
    </div>
  );
}
