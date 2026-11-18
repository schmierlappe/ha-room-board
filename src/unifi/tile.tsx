import { setVars } from "../theme";
import {
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import {
  KIND_ICON,
  clientsLine,
  markOf,
  pingText,
  pingTone,
  rateDigits,
  type Network,
  type Ping,
} from "./model";
import { Faceplate } from "./panel";
import { Gauge } from "./gauge";
import { Pulse } from "./pulse";
import { unifiVars } from "./styles";

/* The tile, apart from the widget, so the room board can draw it without
   taking in the whole UniFi widget: its settings, its dialog and its
   stylesheet text. */

/** "42.3" and "Mbit/s", apart, so the unit can be set smaller. */
const split = (rate: { value: number; unit: string } | undefined) => {
  if (!rate) return { value: "—", unit: "" };
  return { value: rateDigits(rate.value), unit: rate.unit };
};

/** The provider's mark, for a latency pill. */
/**
 * The picture without the empty margin around it. A cut-out of a device is
 * mostly transparent canvas, and drawn whole the gateway was a speck in the
 * middle of it. Where the picture may be read (served with CORS) the
 * transparent border is cropped away; where not, or with nothing to crop,
 * it is used as it is.
 */
function useTrimmed(url: () => string | undefined) {
  const [trimmed, setTrimmed] = createSignal<{ from: string; src: string }>();
  createEffect(() => {
    const from = url();
    /* The sealed engine of Dash 1.5 has no Image (nor a canvas to read):
       there the picture is shown as it is. */
    if (!from || typeof document === "undefined" || typeof Image === "undefined") return;
    let live = true;
    onCleanup(() => (live = false));
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!live) return;
      const src = trimTransparent(img);
      if (src) setTrimmed({ from, src });
    };
    img.src = from;
  });
  return () => {
    const from = url();
    const t = trimmed();
    return t && t.from === from ? t.src : from;
  };
}

/** The box round a picture's visible pixels, or nothing for a blank one. */
function opaqueBounds(data: Uint8ClampedArray, w: number, h: number) {
  let top = h;
  let left = w;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! <= 12) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = y;
    }
  }
  return right < 0 ? undefined : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The picture cropped to what is visible in it, with a little room round
 * it, as a data URL — or nothing where there is nothing to crop, or where
 * the picture may not be read (served without CORS).
 */
function trimTransparent(img: HTMLImageElement): string | undefined {
  try {
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, w, h);
    const box = opaqueBounds(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!box || box.width * box.height > w * h * 0.9) return undefined;
    const pad = Math.round(Math.max(box.width, box.height) * 0.04);
    const out = document.createElement("canvas");
    out.width = box.width + pad * 2;
    out.height = box.height + pad * 2;
    out.getContext("2d")!.drawImage(canvas, box.left, box.top, box.width, box.height, pad, pad, box.width, box.height);
    return out.toDataURL("image/png");
  } catch {
    /* Not ours to read: shown as it is. */
    return undefined;
  }
}


/**
 * The tile: the network's pulse.
 *
 * The last day of download and upload fills the card as two soft waves; over
 * them, as little as says how the network is: the gateway and whether it is
 * up, what is moving through it now in large type, and along the foot frosted
 * pills — the internet's latency, the devices' health, Wi-Fi. A tall tile adds
 * every device as a tile of its own; a wide one the gateway's CPU and memory.
 */
export function TileView(props: {
  network: Network;
  title?: string;
  pings?: Ping[];
  image?: string;
}) {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let tileEl: HTMLDivElement | undefined;
  /* The devices take what room the readings leave. A device that would be
     cut off at the foot is hidden whole instead; looked at again after
     every change of size or of the list. */
  let wideGrid: HTMLDivElement | undefined;
  let cardGrid: HTMLDivElement | undefined;
  const fitRows = (grid: HTMLDivElement | undefined, closeUp: boolean) => {
    if (!grid?.isConnected) return;
    /* Measured at its full room; on the console then closed up under the
       last whole row, so what is left over goes to the chart above. */
    if (closeUp) grid.style.maxHeight = "";
    let bottom = 0;
    for (const el of Array.from(grid.children) as HTMLElement[]) {
      const end = el.offsetTop + el.offsetHeight;
      const fits = end <= grid.clientHeight + 1;
      const visibility = fits ? "" : "hidden";
      if (el.style.visibility !== visibility) el.style.visibility = visibility;
      if (fits) bottom = Math.max(bottom, end);
    }
    if (closeUp) grid.style.maxHeight = `${bottom}px`;
  };
  /* The dashboard's own type size: the layouts below are drawn in rem, so
     where one changes is measured in it too. */
  const [rem, setRem] = createSignal(16);
  onMount(() => {
    if (!tileEl || typeof ResizeObserver === "undefined") return;
    setRem(Number.parseFloat(getComputedStyle(tileEl).fontSize) || 16);
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setSize({ w: box.width, h: box.height });
    });
    observer.observe(tileEl);
    onCleanup(() => observer.disconnect());
  });

  const tiny = () => size().h > 0 && size().h < 125;
  /* A strip, a card, or a tall card with its devices. */
  const cardSize = () => {
    if (tiny()) return "tiny";
    return size().h >= 360 ? "tall" : "full";
  };
  const gateway = () => props.network.gateway;
  const offline = () => gateway()?.online === false;
  const devices = createMemo(() => props.network.devices.filter((d) => d.kind !== "gateway"));
  const deviceCount = createMemo(() => devices().length);
  /* The rows fitted again whenever the card's size or the number of
     devices changes — the number as a memo: read straight from the list,
     every reading set this off, and in Dash 1.5's sealed engine each run's
     layout reads and restyling are charged to the widget. */
  createEffect(
    on([size, deviceCount], () => {
      const frame = requestAnimationFrame(() => {
        fitRows(wideGrid, true);
        fitRows(cardGrid, false);
      });
      onCleanup(() => cancelAnimationFrame(frame));
    }),
  );
  const online = () => props.network.devices.filter((d) => d.online !== false).length;
  const hasStats = () =>
    gateway()?.cpu !== undefined || gateway()?.memory !== undefined || gateway()?.temperature !== undefined;
  /* The console's readings as graphs: beside the rates on a wide tile,
     under them on a tall one, and left out where neither has the room. */
  const statsSide = () => !tiny() && hasStats() && size().w >= 430;
  const statsBelow = () => !tiny() && hasStats() && !statsSide() && size().h >= 300;
  const grid = () => !tiny() && size().h >= 360 && devices().length > 0;
  const down = () => split(props.network.throughput.down);
  const up = () => split(props.network.throughput.up);
  /* Extra wide (6×2 and up): a dashboard of its own — see WideView. */
  const wide = () => !tiny() && size().w >= 650;
  /* A console not much wider than it is tall, and tall enough to stack:
     the readings over a chart across the whole width (see the styles). */
  const square = () => wide() && size().h >= 330 && size().w < 62 * rem();

  const statTiles = () => (
    <>
      <Show when={gateway()?.cpu !== undefined}>
        <Gauge label="CPU" value={gateway()!.cpu!} unit="%" warn={70} alarm={88} hue="blue" />
      </Show>
      <Show when={gateway()?.memory !== undefined}>
        <Gauge label="RAM" value={gateway()!.memory!} unit="%" warn={75} alarm={90} hue="violet" />
      </Show>
      <Show when={gateway()?.temperature !== undefined}>
        <Gauge label="Temp" value={gateway()!.temperature!} unit="°" warn={65} alarm={80} hue="teal" />
      </Show>
    </>
  );

  const head = () => (
    <header class="uf-card-head">
      <Show when={!hero()}>{mark()}</Show>
      <span class="uf-card-id">
        <b class="uf-truncate">{props.title || gateway()?.name || "Network"}</b>
        <span class="uf-card-state">
          <i />
          <span class="uf-truncate">
            {clientsLine(offline(), props.network.clients)}
          </span>
        </span>
      </span>
    </header>
  );

  const pills = () => (
    <>
      <Index each={props.pings ?? []}>
        {(ping) => (
          <span class="uf-glass" data-tone={pingTone(ping())} title={ping().name}>
            <Icon icon={markOf(ping().name)} width="13" />
            <b>{pingText(ping())}</b>
            <Show when={ping().online !== false && ping().ms !== undefined}>
              <i>ms</i>
            </Show>
          </span>
        )}
      </Index>
      <Show when={props.network.devices.length}>
        <span class="uf-glass" data-tone={online() < props.network.devices.length ? "down" : "plain"}>
          <Icon icon="mdi:lan" width="13" />
          <b>
            {online()}/{props.network.devices.length}
          </b>
        </span>
      </Show>
      <Show when={props.network.wlans.length}>
        <span class="uf-glass" data-tone="plain">
          <Icon icon="mdi:wifi" width="13" />
          <b>{props.network.wlans.filter((w) => w.enabled !== false).length}</b>
        </span>
      </Show>
      <Show when={props.network.devices.some((d) => d.update)}>
        <span class="uf-glass" data-tone="accent" title="Firmware update available">
          <Icon icon="mdi:arrow-up-circle" width="14" />
        </span>
      </Show>
    </>
  );

  /* The list is read inside Index, not when this is called: read here, it
     made the <Show> around the tiles depend on every update to the network,
     and the whole row was torn down and rebuilt each time — the flicker. */
  /* The picture, where one is set, never has words over it. With room it
     stands on its own, large and unframed — at the top of a tall card,
     under "Now" on a wide one — as a product shot does: a cut-out of the
     gateway floats on its own shadow, a photo has rounded corners. Without
     room it takes the mark's place beside the name. */
  /* On a wide card only where "Now" has a column of its own (see the
     big-square rules in the styles). */
  const hero = () =>
    !!props.image && (wide() ? size().h >= 330 && !square() : !tiny() && size().h >= 300);
  const src = useTrimmed(() => props.image);
  const photo = () => (
    <div class="uf-photo" aria-hidden="true">
      <img src={src()} alt="" decoding="async" />
    </div>
  );
  const mark = () => (
    <Show
      when={props.image && !hero()}
      fallback={
        <span class="uf-card-mark">
          <Icon icon="mdi:router-wireless" width="16" />
        </span>
      }
    >
      <span class="uf-card-mark" data-photo="true">
        <img src={src()} alt="" decoding="async" />
      </span>
    </Show>
  );

  const deviceTiles = () => (
    <div class="uf-card-devices" ref={cardGrid}>
      <Index each={devices()}>
        {(device) => (
          <span class="uf-card-device" data-online={device().online !== false} title={device().name}>
            <Icon icon={KIND_ICON[device().kind]} width="17" />
            <span class="uf-truncate">{device().name}</span>
            <i />
          </span>
        )}
      </Index>
    </div>
  );

  return (
    /* Measured on a host that stays put: the two layouts are different
       elements, and an observer left on the first would go on watching it
       after the switch. The host has no padding, so the thresholds below are
       the card's outer size. */
    <div ref={tileEl} class="uf-host">
    <Show when={!wide()} fallback={
      <div ref={(el) => setVars(el, () => unifiVars())} class="uf-card uf-wide" data-offline={offline()} data-tall={size().h >= 330} data-square={square()} data-short={size().h < 220} data-photo={hero()}>
        {/* One bar across the top: who and how — the gateway and its state
            at the left, the internet's latency and the network's counts at
            the right. */}
        <header class="uf-wide-bar">
          {mark()}
          <b class="uf-wide-name uf-truncate">{props.title || gateway()?.name || "Network"}</b>
          <span class="uf-wide-state" data-off={offline()}>
            <i />
            {clientsLine(offline(), props.network.clients, true)}
          </span>
          <span class="uf-wide-bar-gap" />
          <Show when={props.pings?.length}>
            <span class="uf-seg">
              <Index each={props.pings ?? []}>
                {(ping) => (
                  <span class="uf-seg-cell" data-tone={pingTone(ping())} title={ping().name}>
                    <Icon icon={markOf(ping().name)} width="13" />
                    <b>{pingText(ping())}</b>
                    <Show when={ping().online !== false && ping().ms !== undefined}>
                      <i>ms</i>
                    </Show>
                  </span>
                )}
              </Index>
            </span>
          </Show>
          <Show when={props.network.devices.length}>
            <span class="uf-count" data-off={online() < props.network.devices.length}>
              <Icon icon="mdi:lan" width="14" />
              <b>
                {online()}/{props.network.devices.length}
              </b>
            </span>
          </Show>
          <Show when={props.network.wlans.length}>
            <span class="uf-count">
              <Icon icon="mdi:wifi" width="14" />
              <b>{props.network.wlans.filter((w) => w.enabled !== false).length}</b>
            </span>
          </Show>
          <Show when={props.network.devices.some((d) => d.update)}>
            <span class="uf-count" data-accent="true" title="Firmware update available">
              <Icon icon="mdi:arrow-up-circle" width="14" />
            </span>
          </Show>
        </header>

        <div class="uf-wide-main">
          <section class="uf-wide-now">
            <span class="uf-wide-label">Now</span>
            <span class="uf-wide-rate" data-tone="down">
              <Icon icon="mdi:arrow-down" />
              <b>{down().value}</b>
              <i>{down().unit}</i>
            </span>
            <Show when={props.network.throughput.up}>
              <span class="uf-wide-rate" data-tone="up">
                <Icon icon="mdi:arrow-up" />
                <b>{up().value}</b>
                <i>{up().unit}</i>
              </span>
            </Show>
            <Show when={hero()}>{photo()}</Show>
          </section>

          <section class="uf-wide-chart">
            <div class="uf-wide-legend">
              <span data-tone="down"><i />Download</span>
              <span data-tone="up"><i />Upload</span>
              <em>Last 24 h</em>
            </div>
            <div class="uf-wide-plot">
              <Pulse downId={props.network.throughput.down?.id} upId={props.network.throughput.up?.id} />
            </div>
          </section>

          <Show when={hasStats()}>
            <section class="uf-wide-stats">{statTiles()}</section>
          </Show>
        </div>

        {/* From a height that leaves room for a row of them under the readings:
            lower, the heading stood over no devices at all. */}
        <Show when={size().h >= 380 && devices().length}>
          <section class="uf-wide-devices">
            <span class="uf-wide-label">
              Devices <em>{devices().length}</em>
            </span>
            <div class="uf-wide-grid" ref={wideGrid}>
              <Index each={devices()}>
                {(device) => (
                  <div class="uf-wdev" data-online={device().online !== false} data-plate={!!device().ports?.length}>
                    <div class="uf-wdev-head">
                      <span class="uf-wdev-icon">
                        <Icon icon={KIND_ICON[device().kind]} width="16" />
                      </span>
                      <span class="uf-wdev-text">
                        <b class="uf-truncate">{device().name}</b>
                        <span class="uf-truncate">
                          {device().online === false ? "Offline" : device().model}
                        </span>
                      </span>
                      <Show when={device().update}>
                        <Icon icon="mdi:arrow-up-circle" width="14" class="uf-wdev-update" />
                      </Show>
                      <i class="uf-wdev-dot" />
                    </div>
                    <Show when={device().ports?.length && device().online !== false}>
                      <Faceplate device={device()} />
                    </Show>
                  </div>
                )}
              </Index>
            </div>
          </section>
        </Show>
      </div>
    }>
    <div ref={(el) => setVars(el, () => unifiVars())}
      class="uf-card"
      data-size={cardSize()}
      data-narrow={size().w > 0 && size().w < 330}
      data-offline={offline()}
      data-photo={hero()}
    >
      <Show when={hero()}>{photo()}</Show>
      <Pulse downId={props.network.throughput.down?.id} upId={props.network.throughput.up?.id} />

      {head()}

      <div class="uf-card-mid" data-side={statsSide()}>
      <div class="uf-card-now">
        <span class="uf-card-down">
          <Icon icon="mdi:arrow-down" class="uf-card-arrow" />
          <b>{down().value}</b>
          <i>{down().unit}</i>
        </span>
        <Show when={props.network.throughput.up}>
          <span class="uf-card-up">
            <Icon icon="mdi:arrow-up" width="13" />
            <b>{up().value}</b>
            <i>{up().unit}</i>
          </span>
        </Show>
      </div>
      <Show when={statsSide() || statsBelow()}>
        <div class="uf-card-stats">{statTiles()}</div>
      </Show>
      </div>

      <Show when={grid()}>{deviceTiles()}</Show>

      <Show when={!tiny()}>
        <footer class="uf-card-foot">{pills()}</footer>
      </Show>
    </div>
    </Show>
    </div>
  );
}

/* Made once and handed the network as it changes. Written inline as the
   dialog's prop, the panel was built afresh each time the dialog read it —
   on every sensor update, every few seconds — and the popup flickered. */
