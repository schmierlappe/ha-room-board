import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { artSrc } from "../artwork";
import { usePlexPlayers, withPlexTwin } from "../media-player/plex-twin";
import { brandOf, brandStyle, type Brand } from "../media-player/brand";
import { Marquee } from "../media-player/marquee";
import { markArtShape, noteImageFailure } from "../media-player/cover";
import { VolumeDial } from "../media-player/dial";
import { picon } from "../media-player/picons";
import {
  attr,
  createLivePosition,
  formatTime,
  isActiveState,
  isAlive,
  themeVars,
  volumeIconOf,
} from "../media-player/util";
import { artworkOf, pickPlayer, readNowPlaying } from "./media";
import { openable } from "./util";
import { Half } from "./half";

/**
 * The board's media card, drawn the way the GlassHome media widget draws its
 * tile — the same layouts, chosen the same way, by the card's measured size:
 *
 *   a big square            → poster: the cover over the whole card
 *   well wider than tall    → banner: the cover fading in from the left
 *   taller than wide        → upright banner: the cover from the top
 *   one row high            → strip: cover, titles, keys in a line
 *   anything else           → classic glass: the cover blurred behind,
 *                             the cover beside the titles, the transport,
 *                             the volume
 *
 * Ported from glasshome-widgets/src/media-player/index.tsx, whose stylesheet
 * the board already carries (src/media-player/styles.css); the board keeps
 * its own player choice, Plex covers and channel logos.
 */
export function MediaTile(props: {
  players: EntityView[];
  chosen: string;
  onSelect: (id: string) => void;
  onOpen: () => void;
  haBaseUrl: string;
  artworkProxy?: string;
  showProgress?: boolean;
}) {
  const { callService } = useService();
  const plexPlayers = usePlexPlayers();
  const player = createMemo(() => withPlexTwin(pickPlayer(props.players, props.chosen), plexPlayers()));
  const position = createLivePosition(player);
  const now = createMemo(() => readNowPlaying(player()));

  const artwork = createMemo(() => {
    const url = artworkOf(player(), props.haBaseUrl, props.artworkProxy ?? "", plexPlayers());
    if (!url) return undefined;
    const id = attr<string>(player(), "media_content_id", "");
    return artSrc(id ? `${url}${url.includes("?") ? "&" : "?"}mp=${encodeURIComponent(id)}` : url, 480);
  });
  const [failed, setFailed] = createSignal<string | undefined>();
  const artworkOk = () => !!artwork() && failed() !== artwork();
  const artFailed = () => {
    noteImageFailure(artwork());
    setFailed(artwork());
  };

  const playing = () => isActiveState(player());
  const volume = () => Math.round(attr<number>(player(), "volume_level", 0) * 100);
  const muted = () => attr<boolean>(player(), "is_volume_muted", false);
  const volumeIcon = () => volumeIconOf(muted() ? 0 : volume());
  const duration = () => attr<number>(player(), "media_duration", 0);
  const progressPct = () => {
    const d = duration();
    const p = position();
    return d && p !== undefined && d > 0 ? Math.min(100, (p / d) * 100) : 0;
  };
  const heading = () => now().heading;
  const sub = () => {
    if (now().sub) return now().sub;
    if (!isAlive(player())) return "Unavailable";
    return now().source || player()?.friendlyName || "";
  };
  const eyebrow = () => attr(player(), "source", "") || attr(player(), "app_name", "") || attr(player(), "app_id", "");
  const trackKey = () => attr<string>(player(), "media_content_id", "") || attr<string>(player(), "media_title", "");

  const command = (service: string, data: Record<string, unknown> = {}) => {
    const id = player()?.id;
    if (id) void callService("media_player", service, data, { entity_id: id });
  };
  const swallow = (event: Event) => event.stopPropagation();
  const ownTap = (action: () => void) => (event: Event) => {
    swallow(event);
    action();
  };

  /* What to show with no cover: the channel's picon on a receiver, the app's
     logo on its own ground where it has one, else a note. */
  const brand = (): Brand | undefined => brandOf(player());
  const channelLogo = () => picon(attr(player(), "source", ""));
  const Placeholder = (p: { class: string }) => (
    <Show
      when={channelLogo()}
      fallback={
        <div class={p.class} data-brand={!!brand()} style={brand() ? brandStyle(brand()!) : undefined}>
          <Icon icon={brand()?.icon ?? "mdi:music"} />
        </div>
      }
    >
      {(logo) => (
        <div class={`${p.class} mp-picon-tile`} data-brand="true">
          <img class="mp-picon" src={logo()} alt="" draggable={false} />
        </div>
      )}
    </Show>
  );
  const Cover = (p: { class?: string; style?: Record<string, string> }) => (
    <img
      class={p.class}
      src={artwork()}
      alt=""
      decoding="async"
      style={p.style}
      onLoad={(event) => markArtShape(event.currentTarget)}
      onError={artFailed}
    />
  );

  /* ---------- the size, measured ---------- */
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let tileEl: HTMLDivElement | undefined;
  onMount(() => {
    if (!tileEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const rect = entry.target.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    observer.observe(tileEl);
    onCleanup(() => observer.disconnect());
  });
  const [mobile, setMobile] = createSignal(false);
  onMount(() => {
    const update = () => setMobile(document.documentElement.clientWidth <= 640);
    update();
    window.addEventListener("resize", update);
    onCleanup(() => window.removeEventListener("resize", update));
  });

  const tiny = () => size().h > 0 && size().h < 115;
  const portrait = () => size().w > 0 && size().h / size().w >= 1.05 && size().h >= 200;
  const phoneWide = () => mobile() && size().h > 0 && size().w / size().h >= 1.2;
  const poster = () => {
    const { w, h } = size();
    return w >= 260 && h >= 260 && h / w >= 0.6 && h / w <= 1.25 && !phoneWide();
  };
  const banner = () => {
    const { w, h } = size();
    return w >= 360 && h >= 110 && (w / h >= 1.6 || phoneWide()) && !poster();
  };
  const bannerLarge = () => banner() && size().h >= 260 && !mobile();
  const vbanner = () => portrait() && !poster() && size().w >= 150;
  const strip = () => tiny() && size().w >= 150 && !banner();
  const stripKeys = () => size().w >= 380;
  const classic = () => !banner() && !vbanner() && !strip() && !poster();
  const wide = () => size().w >= 460 && size().h >= 170 && !portrait();
  const tall = () => size().w >= 250 && size().h >= 228 && !portrait() && !tiny() && !wide();
  const tileVolume = () => !tiny() && !portrait() && size().h >= 205;

  /* ---------- the speaker picker ---------- */
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const others = () => props.players.length > 1;
  const pickerView = () => (
    <Show when={pickerOpen()}>
      <div class="mp-picker" onPointerDown={swallow}>
        <For each={props.players}>
          {(p) => (
            <button
              class="mp-picker-item"
              data-active={p.id === player()?.id}
              onClick={(event) => {
                swallow(event);
                props.onSelect(p.id);
                setPickerOpen(false);
              }}
            >
              <Show when={isActiveState(p)} fallback={<Icon icon="mdi:speaker" width="15" style={{ opacity: 0.5 }} />}>
                <span class="mp-eq mp-eq--tiny"><i /><i /><i /></span>
              </Show>
              <span class="mp-truncate">{p.friendlyName}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );

  /* ---------- the volume, as a bar that opens over the tile ---------- */
  const [volOpen, setVolOpen] = createSignal(false);
  let volWrap: HTMLDivElement | undefined;
  createEffect(() => {
    if (!volOpen()) return;
    let inside = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const root = volWrap?.getRootNode() as Document | ShadowRoot | undefined;
    const mark = (event: Event) => {
      if (volWrap && event.composedPath().includes(volWrap)) inside = true;
    };
    const press = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        if (!inside) setVolOpen(false);
        inside = false;
      }, 0);
    };
    root?.addEventListener("pointerdown", mark, true);
    document.addEventListener("pointerdown", press, true);
    onCleanup(() => {
      clearTimeout(pending);
      root?.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("pointerdown", press, true);
    });
  });
  const dial = () => (
    <VolumeDial
      plain
      value={muted() ? 0 : volume()}
      muted={muted()}
      onCommit={(value) => command("volume_set", { volume_level: value / 100 })}
    />
  );

  /* The bar at the top of a banner: the speaker by name, and the volume. */
  const tileNav = (withPlayer: boolean) => (
    <nav class="mp-nav mp-tile-nav" data-icons="true" onPointerDown={swallow}>
      <Show when={withPlayer}>
        <button
          class="mp-tile-nav-player"
          data-active={pickerOpen()}
          disabled={!others()}
          aria-label={`Speaker: ${player()?.friendlyName ?? ""}`}
          onClick={ownTap(() => setPickerOpen((v) => !v))}
        >
          <Show when={playing()} fallback={<Icon icon="mdi:speaker" width="15" />}>
            <span class="mp-eq mp-eq--tiny"><i /><i /><i /></span>
          </Show>
          <span class="mp-truncate">{player()?.friendlyName ?? eyebrow()}</span>
          <Show when={others()}>
            <Icon icon="mdi:chevron-down" width="13" />
          </Show>
        </button>
        <span class="mp-nav-sep" aria-hidden="true" />
      </Show>
      <button class="mp-tile-nav-vol" aria-label="Volume" aria-expanded={volOpen()} onClick={ownTap(() => setVolOpen(true))}>
        <Icon icon={volumeIcon()} width="16" />
        <span class="mp-tile-nav-pct">{muted() ? "—" : volume()}</span>
      </button>
      <Show when={volOpen()}>
        <div ref={volWrap} class="mp-tile-volbar" role="toolbar" aria-label="Volume" onClick={swallow}>
          <button
            class="mp-tile-volbar-mute"
            data-on={muted()}
            aria-label={muted() ? "Unmute" : "Mute"}
            onClick={() => command("volume_mute", { is_volume_muted: !muted() })}
          >
            <Icon icon={volumeIcon()} width="16" />
          </button>
          {dial()}
          <button class="mp-tile-volbar-pct" aria-label="Close volume" onClick={() => setVolOpen(false)}>
            {muted() ? "—" : volume()}
          </button>
        </div>
      </Show>
    </nav>
  );

  const keys = (size: { key: string; play: string }, extra = "") => (
    <div class={`mp-banner-keys ${extra}`} onPointerDown={swallow}>
      <button class="mp-banner-key" aria-label="Previous track" onClick={ownTap(() => command("media_previous_track"))}>
        <Icon icon="mdi:skip-previous" width={size.key} />
      </button>
      <button class="mp-banner-play" aria-label={playing() ? "Pause" : "Play"} onClick={ownTap(() => command("media_play_pause"))}>
        <Icon icon={playing() ? "mdi:pause" : "mdi:play"} width={size.play} />
      </button>
      <button class="mp-banner-key" aria-label="Next track" onClick={ownTap(() => command("media_next_track"))}>
        <Icon icon="mdi:skip-next" width={size.key} />
      </button>
    </div>
  );

  /* ---------- the layouts ---------- */

  const posterView = () => (
    <div class="mp-poster">
      <Show when={artworkOk()} fallback={<Placeholder class="mp-poster-art mp-poster-art--empty" />}>
        <Cover class="mp-poster-art" />
      </Show>
      <div class="mp-poster-shade" aria-hidden="true" />
      <div class="mp-poster-meta">
        <button class="mp-poster-chip" disabled={!others()} onPointerDown={swallow} onClick={ownTap(() => setPickerOpen((v) => !v))}>
          <Show when={playing()} fallback={<Icon icon="mdi:speaker" width="14" />}>
            <span class="mp-eq mp-eq--tiny"><i /><i /><i /></span>
          </Show>
          <span class="mp-truncate">{player()?.friendlyName ?? "Speaker"}</span>
          <Show when={others()}>
            <Icon icon="mdi:chevron-down" width="13" />
          </Show>
        </button>
        <div class="mp-poster-titles">
          <h3 class="mp-poster-title">{heading()}</h3>
          <span class="mp-poster-sub mp-truncate">{sub()}</span>
        </div>
        <Show when={props.showProgress !== false && duration() > 0}>
          <div class="mp-poster-time">
            <span class="mp-poster-bar" aria-hidden="true">
              <i style={{ width: `${progressPct()}%` }} />
            </span>
            <span class="mp-poster-clock">
              <span>{formatTime(position())}</span>
              <span>{formatTime(duration())}</span>
            </span>
          </div>
        </Show>
        <div class="mp-poster-controls" onPointerDown={swallow}>
          <div class="mp-poster-keys">
            <button class="mp-poster-key" aria-label="Previous track" onClick={ownTap(() => command("media_previous_track"))}>
              <Icon icon="mdi:skip-previous" width="18" />
            </button>
            <button class="mp-poster-play" aria-label={playing() ? "Pause" : "Play"} onClick={ownTap(() => command("media_play_pause"))}>
              <Icon icon={playing() ? "mdi:pause" : "mdi:play"} width="22" />
            </button>
            <button class="mp-poster-key" aria-label="Next track" onClick={ownTap(() => command("media_next_track"))}>
              <Icon icon="mdi:skip-next" width="18" />
            </button>
          </div>
          <div class="mp-poster-vol">
            <button
              class="mp-poster-mute"
              aria-label={muted() ? "Unmute" : "Mute"}
              onClick={ownTap(() => command("volume_mute", { is_volume_muted: !muted() }))}
            >
              <Icon icon={muted() || !volume() ? "mdi:volume-off" : "mdi:volume-medium"} width="16" />
            </button>
            {dial()}
            <span class="mp-poster-pct">{muted() ? "—" : volume()}</span>
          </div>
        </div>
      </div>
      {pickerView()}
    </div>
  );

  const bannerView = () => (
    <div class="mp-banner">
      <div class="mp-banner-art" aria-hidden="true">
        <Show when={artworkOk()} fallback={<Placeholder class="mp-banner-empty" />}>
          <Cover />
        </Show>
      </div>
      <div class="mp-banner-body">
        <div class="mp-banner-top">{tileNav(true)}</div>
        <div class="mp-banner-titles">
          <Marquee class="mp-title" text={heading()} />
          <Marquee class="mp-sub" text={sub()} />
        </div>
        {keys(bannerLarge() ? { key: "26", play: "30" } : { key: "18", play: "20" })}
      </div>
      {pickerView()}
    </div>
  );

  const vbannerView = () => (
    <div class="mp-vbanner">
      <div class="mp-vbanner-art" aria-hidden="true">
        <Show when={artworkOk()} fallback={<Placeholder class="mp-banner-empty" />}>
          <Cover />
        </Show>
      </div>
      <div class="mp-vbanner-body">
        <div class="mp-vbanner-titles">
          <Marquee class="mp-title" text={heading()} />
          <Marquee class="mp-sub" text={sub()} />
        </div>
        {keys({ key: "20", play: "22" }, "mp-vbanner-keys")}
        {tileNav(true)}
      </div>
      {pickerView()}
    </div>
  );

  const stripView = () => (
    <div class="mp-strip">
      <div class="mp-strip-art" aria-hidden="true">
        <Show when={artworkOk()} fallback={<Placeholder class="mp-banner-empty" />}>
          <Cover />
        </Show>
      </div>
      <div class="mp-strip-body">
        <div class="mp-strip-titles">
          <Marquee class="mp-title" text={heading()} />
          <Marquee class="mp-sub" text={sub()} />
        </div>
        <div class="mp-strip-keys" onPointerDown={swallow}>
          <Show when={stripKeys()}>
            <button class="mp-banner-key" aria-label="Previous track" onClick={ownTap(() => command("media_previous_track"))}>
              <Icon icon="mdi:skip-previous" width="20" />
            </button>
          </Show>
          <button class="mp-banner-play" aria-label={playing() ? "Pause" : "Play"} onClick={ownTap(() => command("media_play_pause"))}>
            <Icon icon={playing() ? "mdi:pause" : "mdi:play"} width="20" />
          </button>
          <Show when={stripKeys()}>
            <button class="mp-banner-key" aria-label="Next track" onClick={ownTap(() => command("media_next_track"))}>
              <Icon icon="mdi:skip-next" width="20" />
            </button>
          </Show>
          <button class="mp-banner-key mp-strip-volkey" aria-label="Volume" aria-expanded={volOpen()} onClick={ownTap(() => setVolOpen(true))}>
            <Icon icon={volumeIcon()} width="18" />
          </button>
        </div>
      </div>
      <Show when={volOpen()}>
        <div ref={volWrap} class="mp-strip-vol" role="toolbar" aria-label="Volume" onPointerDown={swallow} onClick={swallow}>
          <button
            class="mp-banner-key"
            data-on={muted()}
            aria-label={muted() ? "Unmute" : "Mute"}
            onClick={() => command("volume_mute", { is_volume_muted: !muted() })}
          >
            <Icon icon={volumeIcon()} width="18" />
          </button>
          {dial()}
          <button class="mp-strip-vol-pct" aria-label="Close volume" onClick={() => setVolOpen(false)}>
            {muted() ? "—" : volume()}
          </button>
        </div>
      </Show>
    </div>
  );

  /* The classic tile: cover beside the words, transport, volume. */
  const artPx = () => {
    const { w, h } = size();
    return Math.max(52, Math.min(w - 32, h - 180 - (tileVolume() ? 42 : 0), 180));
  };
  const artBox = () => (portrait() ? { width: `${artPx()}px`, height: `${artPx()}px` } : undefined);
  const classicView = () => (
    <div class="mp-tile-col">
      <div class="mp-tile-head">
        <Show when={artworkOk()} fallback={<Placeholder class="mp-art mp-art-placeholder" />}>
          <Cover class="mp-art" style={artBox()} />
        </Show>
        <div class="mp-meta">
          <Show when={!tiny() && (eyebrow() || others())}>
            <div class="mp-eyebrow-row" onPointerDown={swallow}>
              <Show when={playing()}>
                <span class="mp-eq mp-eq--tiny"><i /><i /><i /></span>
              </Show>
              <Show when={others()} fallback={<span class="mp-eyebrow mp-truncate">{eyebrow()}</span>}>
                <button class="mp-player-btn" onClick={ownTap(() => setPickerOpen((v) => !v))}>
                  <span class="mp-eyebrow mp-truncate">{player()?.friendlyName ?? eyebrow()}</span>
                  <Icon icon="mdi:chevron-down" width="13" />
                </button>
              </Show>
            </div>
          </Show>
          <Marquee class="mp-title" text={heading()} />
          <Show when={!tiny()}>
            <Marquee class="mp-sub" text={sub()} />
          </Show>
        </div>
      </div>
      {pickerView()}
      <div class="mp-controls" onPointerDown={swallow}>
        <div class="mp-transport-group">
          <Show when={!tiny()}>
            <button class="mp-btn mp-btn--ghost mp-prev" aria-label="Previous track" onClick={ownTap(() => command("media_previous_track"))}>
              <Icon icon="mdi:skip-previous" width="21" />
            </button>
          </Show>
          <button class="mp-btn mp-btn--hero" aria-label="Play or pause" onClick={ownTap(() => command("media_play_pause"))}>
            <Icon icon={playing() ? "mdi:pause" : "mdi:play"} width="26" />
          </button>
          <Show when={!tiny()}>
            <button class="mp-btn mp-btn--ghost mp-next" aria-label="Next track" onClick={ownTap(() => command("media_next_track"))}>
              <Icon icon="mdi:skip-next" width="21" />
            </button>
          </Show>
        </div>
      </div>
      <Show when={tileVolume()}>
        <div class="mp-tile-vol" onPointerDown={swallow}>
          <button
            class="mp-btn mp-btn--ghost mp-btn--sm"
            aria-label={muted() ? "Unmute" : "Mute"}
            onClick={ownTap(() => command("volume_mute", { is_volume_muted: !muted() }))}
          >
            <Icon icon={muted() ? "mdi:volume-off" : "mdi:volume-high"} width="16" />
          </button>
          {dial()}
          <span class="mp-pct">{muted() ? "—" : volume()}</span>
        </div>
      </Show>
    </div>
  );

  const tileClass = () => {
    const shapes: [boolean, string][] = [
      [portrait(), "portrait"],
      [wide(), "wide"],
      [tiny(), "tiny"],
      [tall(), "tall"],
      [poster(), "poster"],
      [banner(), "banner"],
      [vbanner(), "vbanner"],
      [strip(), "strip"],
    ];
    return ["mp-tile", "mp-tile--stack", ...shapes.filter(([on]) => on).map(([, name]) => `mp-tile--${name}`)].join(" ");
  };
  const progressShown = () => props.showProgress !== false && (!tiny() || strip()) && !poster() && duration() > 0;

  return (
    <article class="rb-card rb-card--media rb-mtile" data-card="media" style={themeVars()} {...openable(props.onOpen, "Now playing")}>
      {/* Half a tile (Arrange's ½ size on a phone): like every other card's
          half — the cover at the right, and on the left what is playing with
          a play key. */}
      <Half
        icon={playing() ? "mdi:music-note" : "mdi:speaker"}
        name={heading()}
        status={sub()}
        tone="var(--rb-primary, #7c6cf0)"
        lit={playing()}
        value={
          <button
            class="rb-half-play"
            data-on={playing()}
            aria-label={playing() ? "Pause" : "Play"}
            onPointerDown={swallow}
            onClick={ownTap(() => command("media_play_pause"))}
          >
            <Icon icon={playing() ? "mdi:pause" : "mdi:play"} width="18" />
          </button>
        }
        art={
          <Show
            when={artworkOk()}
            fallback={
              <Show
                when={channelLogo()}
                fallback={<span class="rb-half-mediabrand" style={brand() ? brandStyle(brand()!) : undefined}><Icon icon={brand()?.icon ?? "mdi:music"} /></span>}
              >
                {(logo) => <img class="rb-half-logo" src={logo()} alt="" />}
              </Show>
            }
          >
            <img class="rb-half-poster" src={artwork()} alt="" />
          </Show>
        }
      />
      <Show when={artworkOk() && classic()}>
        <div class="mp-backdrop" style={{ "background-image": `url("${artwork()}")` }} />
        <div class="mp-scrim" />
      </Show>
      <div
        ref={tileEl}
        class={tileClass()}
        style={{ "--mp-tile-h": `${size().h}px` }}
        data-banner={banner() ? (size().h < 150 ? "short" : bannerLarge() ? "large" : "mid") : undefined}
        data-phone={mobile()}
        data-art={artworkOk() && classic()}
        data-vol={volOpen()}
        data-strip={strip() ? (size().w < 240 ? "narrow" : "full") : undefined}
      >
        <Show when={poster()}>{posterView()}</Show>
        <Show when={banner()}>{bannerView()}</Show>
        <Show when={strip()}>{stripView()}</Show>
        <Show when={vbanner()}>{vbannerView()}</Show>
        <Show when={classic()}>{classicView()}</Show>
        <Show when={progressShown()}>
          <div class="mp-edge-progress" data-ready={progressPct() > 0}>
            <For each={[trackKey()]}>{() => <i style={{ width: `${progressPct()}%` }} />}</For>
          </div>
        </Show>
      </div>
    </article>
  );
}
