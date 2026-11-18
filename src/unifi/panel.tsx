import { Index, Show, createMemo, createSignal } from "solid-js";
import { useTrackedHistory } from "../history";
import { Icon, useService } from "@glasshome/widget-sdk";
import { KIND_ICON, formatRate, levelOf, markOf, pingTone, upFor, type NetDevice, type Network, type Ping, type Port, type Wlan } from "./model";
import { Ring } from "./ring";
import { sealedImage } from "../url";

/**
 * The popup: the network at a glance — what is moving through the gateway,
 * who is on it, and the gateway's own health — then every device, then the
 * Wi-Fi networks with their switches and QR codes.
 */
export function UnifiPanel(props: { network: Network; pings?: Ping[] }) {

  return (
    <div class="uf-panel">
      {/* The gateway: what it is, how long it has been up, and its health
          as three rings — CPU, memory and its temperature. */}
      <Show when={props.network.gateway}>
        {(g) => (
          <section class="uf-gw">
            <div class="uf-gw-head">
              <span class="uf-glyph">
                <Icon icon="mdi:router-wireless" width="20" />
              </span>
              <span class="uf-gw-text">
                <b class="uf-truncate">{g().name}</b>
                <span class="uf-truncate">
                  {[
                    g().model,
                    g().upSince ? `up ${upFor(g().upSince)}` : "",
                    props.network.clients !== undefined ? `${props.network.clients} clients` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span class="uf-status uf-status--pill" data-off={g().online === false}>
                <i />
                {g().online === false ? "Offline" : "Online"}
              </span>
            </div>
            <Show when={g().cpu !== undefined || g().memory !== undefined || g().temperature !== undefined}>
              <div class="uf-gw-rings">
                <Show when={g().cpu !== undefined}>
                  <Ring value={g().cpu!} label="CPU" />
                </Show>
                <Show when={g().memory !== undefined}>
                  <Ring value={g().memory!} label="Memory" />
                </Show>
                <Show when={g().temperature !== undefined}>
                  <Ring value={g().temperature!} label="Temperature" unit="°" max={100} warn={55} alarm={70} />
                </Show>
              </div>
            </Show>
          </section>
        )}
      </Show>

      <section class="uf-hero">
        <div class="uf-rates">
          <Rate label="Download" icon="mdi:arrow-down" rate={props.network.throughput.down} tone="down" />
          <Rate label="Upload" icon="mdi:arrow-up" rate={props.network.throughput.up} tone="up" />
        </div>
      </section>

      <Show when={props.pings?.length}>
        <section class="uf-section">
          <h3 class="uf-section-title">Internet</h3>
          <LatencyPanel pings={props.pings!} />
        </section>
      </Show>

      {/* The rest of the network by kind — the gateway has its own card
          above — each device a card of its own. */}
      <Index each={GROUPS}>
        {(group) => (
          <Show when={props.network.devices.some((d) => d.kind === group().kind)}>
            <section class="uf-section">
              <h3 class="uf-section-title">
                {group().title}
                <span>{props.network.devices.filter((d) => d.kind === group().kind).length}</span>
              </h3>
              <div class="uf-cards">
                {/* By position, so an update changes a card rather than
                    rebuilding it. */}
                <Index each={props.network.devices.filter((d) => d.kind === group().kind)}>
                  {(device) => <DeviceCard device={device()} />}
                </Index>
              </div>
            </section>
          </Show>
        )}
      </Index>

      <Show when={props.network.wlans.length}>
        <section class="uf-section">
          <h3 class="uf-section-title">Wi-Fi</h3>
          <div class="uf-wlans">
            <Index each={props.network.wlans}>{(wlan) => <WlanCard wlan={wlan()} />}</Index>
          </div>
        </section>
      </Show>

      <Show when={!props.network.devices.length && !props.network.wlans.length}>
        <p class="uf-empty">
          No UniFi devices found. Add the UniFi Network integration in Home Assistant — the widget
          finds its gateway, switches, access points and Wi-Fi networks by itself.
        </p>
      </Show>
    </div>
  );
}

function Rate(props: {
  label: string;
  icon: string;
  rate: { value: number; unit: string; id: string } | undefined;
  tone: "down" | "up";
}) {
  return (
    <div class="uf-rate" data-tone={props.tone}>
      <span class="uf-rate-label">
        <Icon icon={props.icon} width="14" />
        {props.label}
      </span>
      <b class="uf-rate-value">{formatRate(props.rate)}</b>
      <Show when={props.rate}>{(rate) => <RateSpark entityId={rate().id} />}</Show>
    </div>
  );
}

/** The last day of a rate, as a soft line with its area. */
export function RateSpark(props: { entityId: string }) {
  const history = useTrackedHistory(() => props.entityId);
  const path = createMemo(() => {
    const cutoff = Date.now() / 1000 - 24 * 3600;
    const raw = (history()?.timeline ?? [])
      .filter((p) => p.timestamp >= cutoff)
      .map((p) => ({ t: p.timestamp, v: Number(p.state) }))
      .filter((p) => Number.isFinite(p.v));
    if (raw.length < 2) return undefined;
    const t0 = raw[0]!.t;
    const span = Math.max(1, raw.at(-1)!.t - t0);
    const buckets: number[][] = Array.from({ length: 60 }, () => []);
    for (const p of raw) buckets[Math.min(59, Math.floor(((p.t - t0) / span) * 60))]!.push(p.v);
    const pts = buckets
      .map((b, i) => (b.length ? { x: i / 59, v: b.reduce((a, c) => a + c, 0) / b.length } : undefined))
      .filter((p): p is { x: number; v: number } => !!p);
    if (pts.length < 2) return undefined;
    const max = Math.max(...pts.map((p) => p.v), 0.001);
    const line = pts
      .map((p, i) => `${i ? "L" : "M"}${(p.x * 100).toFixed(1)} ${(28 - (p.v / max) * 25).toFixed(1)}`)
      .join(" ");
    return { line, area: `${line} L100 30 L0 30 Z` };
  });
  return (
    <Show when={path()}>
      {(p) => (
        <svg class="uf-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <path class="uf-spark-area" d={p().area} />
          <path class="uf-spark-line" d={p().line} vector-effect="non-scaling-stroke" />
        </svg>
      )}
    </Show>
  );
}

/** The provider's mark, where it is one of the gateway's three. */
const pingIcon = markOf;

/** How full a latency bar is: all of it when down, none without a time,
    else the round trip against 150 ms, never less than a sliver. */
function latencyWidth(ping: Ping): number {
  if (ping.online === false) return 100;
  if (ping.ms === undefined) return 0;
  return Math.max(6, Math.min(100, (ping.ms / 150) * 100));
}

/**
 * Latency as one surface in equal cells: the provider, how fast it answers,
 * and a thin bar for it — shorter is faster.
 */
export function LatencyPanel(props: { pings: Ping[] }) {
  return (
    <div class="uf-lat">
      <Index each={props.pings}>
        {(ping) => (
          <div class="uf-lat-cell" data-tone={pingTone(ping())}>
            <span class="uf-lat-name">
              <Icon icon={pingIcon(ping().name)} width="13" />
              <span class="uf-truncate">{ping().name}</span>
            </span>
            <b class="uf-lat-value">
              <Show when={ping().online !== false} fallback="Down">
                <Show when={ping().ms !== undefined} fallback="Up">
                  {Math.round(ping().ms!)}
                  <i>ms</i>
                </Show>
              </Show>
            </b>
            <span class="uf-lat-bar">
              <i
                style={{
                  width: `${latencyWidth(ping())}%`,
                }}
              />
            </span>
          </div>
        )}
      </Index>
    </div>
  );
}

const GROUPS: { kind: NetDevice["kind"]; title: string }[] = [
  { kind: "switch", title: "Switches" },
  { kind: "ap", title: "Access points" },
  { kind: "other", title: "Other devices" },
];

/** A meter: what it is, its value, and a slim bar filled to it. */
function Meter(props: { label: string; value: number; unit?: string; max?: number; warn?: number; alarm?: number }) {
  const share = () => Math.max(0, Math.min(1, props.value / (props.max ?? 100)));
  const tone = () => levelOf(props.value, props.warn ?? 60, props.alarm ?? 85);
  return (
    <div class="uf-meter" data-tone={tone()}>
      <span class="uf-meter-label">{props.label}</span>
      <span class="uf-meter-bar">
        <i style={{ width: `${(share() * 100).toFixed(1)}%` }} />
      </span>
      <b class="uf-meter-value">
        {Math.round(props.value)}
        {props.unit ?? "%"}
      </b>
    </div>
  );
}

/**
 * A switch or access point, in the popup: what it is and whether it is up,
 * its load as three slim meters, and who is on it and for how long.
 */
function DeviceCard(props: { device: NetDevice }) {
  const d = () => props.device;
  const off = () => d().online === false;
  const hasStats = () => d().cpu !== undefined || d().memory !== undefined || d().temperature !== undefined;
  return (
    <article class="uf-dcard" data-online={!off()}>
      <header class="uf-dcard-head">
        <span class="uf-device-icon" data-kind={d().kind}>
          <Icon icon={KIND_ICON[d().kind]} width="18" />
        </span>
        <span class="uf-dcard-titles">
          <b class="uf-truncate">{d().name}</b>
          <span class="uf-truncate">{d().model}</span>
        </span>
        <span class="uf-status uf-status--pill" data-off={off()}>
          <i />
          {off() ? "Offline" : "Online"}
        </span>
      </header>

      <Show when={!off() && hasStats()}>
        <div class="uf-meters">
          <Show when={d().cpu !== undefined}>
            <Meter label="CPU" value={d().cpu!} />
          </Show>
          <Show when={d().memory !== undefined}>
            <Meter label="RAM" value={d().memory!} />
          </Show>
          <Show when={d().temperature !== undefined}>
            <Meter label="Temp" value={d().temperature!} unit="°" warn={55} alarm={70} />
          </Show>
        </div>
      </Show>

      <Show when={!off() && d().ports?.length}>
        <Faceplate device={d()} />
      </Show>

      <footer class="uf-dcard-foot">
        <Show when={d().clients !== undefined}>
          <span>
            <Icon icon="mdi:account-multiple-outline" width="14" />
            <b>{d().clients}</b> clients
          </span>
        </Show>
        <Show when={!off() && d().upSince}>
          <span>
            <Icon icon="mdi:clock-outline" width="14" />up <b>{upFor(d().upSince)}</b>
          </span>
        </Show>
        <Show when={d().update}>
          <span class="uf-badge">Update</span>
        </Show>
      </footer>
    </article>
  );
}



function WlanCard(props: { wlan: Wlan }) {
  const { callService } = useService();
  const [qr, setQr] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const toggle = async () => {
    if (!props.wlan.switchId || busy()) return;
    setBusy(true);
    try {
      await callService("switch", props.wlan.enabled ? "turn_off" : "turn_on", {}, { entity_id: props.wlan.switchId });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article class="uf-wlan" data-on={props.wlan.enabled !== false}>
      <div class="uf-wlan-head">
        <span class="uf-wlan-icon">
          <Icon icon={props.wlan.enabled === false ? "mdi:wifi-off" : "mdi:wifi"} width="18" />
        </span>
        <span class="uf-wlan-text">
          <b class="uf-truncate">{props.wlan.name}</b>
          <span>
            {wlanLine(props.wlan)}
          </span>
        </span>
        <Show when={props.wlan.qrPicture}>
          <button class="uf-icon-btn" data-on={qr()} aria-label="Show QR code" onClick={() => setQr((v) => !v)}>
            <Icon icon="mdi:qrcode" width="18" />
          </button>
        </Show>
        <Show when={props.wlan.switchId}>
          <button
            class="uf-switch"
            role="switch"
            aria-checked={props.wlan.enabled === true}
            aria-label={`${props.wlan.name} Wi-Fi`}
            data-on={props.wlan.enabled === true}
            disabled={busy()}
            onClick={toggle}
          >
            <i />
          </button>
        </Show>
      </div>
      <Show when={qr() && props.wlan.qrPicture}>
        <div class="uf-qr">
          <img src={sealedImage(props.wlan.qrPicture)} alt={`QR code for ${props.wlan.name}`} />
          <span>Scan to join {props.wlan.name}</span>
        </div>
      </Show>
    </article>
  );
}

/** How many ports the switch has: from its model where it says ("USW-Pro-24-PoE"), else the highest seen. */
const portCount = (device: NetDevice) => {
  const fromModel = Number(/-(\d{1,2})(?:-|$)/.exec(device.model)?.[1]);
  const seen = Math.max(0, ...(device.ports ?? []).map((p) => p.n));
  return Math.max(Number.isFinite(fromModel) ? fromModel : 0, seen);
};

/**
 * A switch as its faceplate: every port a small square, numbered — green with
 * a link, a bolt where PoE is delivering power, grey when idle, struck
 * through when switched off. Two rows, odd over even, as on the hardware,
 * where there are more than eight.
 */
/** A port as the faceplate draws it. */
function portState(p: Port): "off" | "poe" | "up" | "idle" | "unknown" {
  if (p.enabled === false) return "off";
  if (p.poe) return "poe";
  if (p.link) return "up";
  return p.link === false ? "idle" : "unknown";
}

/** The port's link, in its tooltip. */
function portLink(p: Port): string {
  if (p.enabled === false) return "disabled";
  if (p.link) return "connected";
  return p.link === false ? "no link" : "";
}

/** The port's power, in its tooltip. */
function portPower(p: Port): string {
  if (p.poeW !== undefined) return `PoE ${p.poeW.toFixed(1)} W`;
  return p.poe ? "PoE" : "";
}

/** Two rows of ports, odd above and even below, as on the switch. */
const portCell = (n: number) => ({ "grid-row": n % 2 === 1 ? 1 : 2, "grid-column": Math.ceil(n / 2) });

/** A Wi-Fi network's line: off, how many are on it, or on. */
function wlanLine(wlan: Wlan): string {
  if (wlan.enabled === false) return "Off";
  return wlan.clients === undefined ? "On" : `${wlan.clients} connected`;
}

export function Faceplate(props: { device: NetDevice }) {
  const ports = createMemo(() => {
    const byN = new Map((props.device.ports ?? []).map((p) => [p.n, p]));
    return Array.from({ length: portCount(props.device) }, (_, i) => byN.get(i + 1) ?? { n: i + 1 });
  });
  const rows = () => ports().length > 8;
  const used = () => ports().filter((p) => p.link).length;
  const poe = () => (props.device.ports ?? []).reduce((sum, p) => sum + (p.poeW ?? 0), 0);
  const state = portState;
  const title = (p: Port) =>
    [`Port ${p.n}`, portLink(p), portPower(p)]
      .filter(Boolean)
      .join(" · ");

  return (
    <div class="uf-plate">
      <div class="uf-plate-ports" data-rows={rows()} style={{ "--uf-cols": String(rows() ? Math.ceil(ports().length / 2) : ports().length) }}>
        <Index each={ports()}>
          {(p) => (
            <span class="uf-port" data-state={state(p())} title={title(p())} style={rows() ? portCell(p().n) : undefined}>
              <Show when={state(p()) === "poe"} fallback={<b>{p().n}</b>}>
                <Icon icon="mdi:lightning-bolt" width="11" />
              </Show>
            </span>
          )}
        </Index>
      </div>
      <div class="uf-plate-sum">
        <span>
          <b>
            {used()}/{ports().length}
          </b>{" "}
          in use
        </span>
        <Show when={poe() > 0}>
          <span>
            <Icon icon="mdi:lightning-bolt" width="12" />
            <b>{poe().toFixed(1)}</b> W PoE
          </span>
        </Show>
      </div>
    </div>
  );
}
