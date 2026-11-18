import { useCoalesced, useTrickle } from "../async";
import { createMemo } from "solid-js";
import { state, useEntities, type EntityView } from "@glasshome/widget-sdk";

/**
 * UniFi, as Home Assistant's built-in UniFi Network integration publishes it.
 *
 * Found rather than configured: every entity the integration made is marked
 * in the entity registry with its platform, "unifi", and belongs to a device
 * — a gateway, a switch, an access point, or a Wi-Fi network (the
 * integration makes a device of each WLAN, with its on/off switch, its QR
 * code and its client count). So the widget reads the registry, keeps the
 * UniFi entities, and sorts them by the device they belong to.
 */

/**
 * A switch port, from the entities the integration makes for it — PoE on or
 * off, the power it draws, its traffic and whether it is enabled — whichever
 * of them are switched on in Home Assistant.
 */
export type Port = {
  n: number;
  /** Something is on the other end: traffic, PoE power, or a port that says so. */
  link?: boolean;
  /** PoE is delivering power. */
  poe?: boolean;
  poeW?: number;
  /** Bytes moving through it, in its sensors' unit. */
  rx?: number;
  tx?: number;
  /** False when the port is switched off. */
  enabled?: boolean;
};

export type DeviceKind = "gateway" | "switch" | "ap" | "other";

export type NetDevice = {
  id: string;
  name: string;
  model: string;
  kind: DeviceKind;
  online: boolean | undefined;
  clients?: number;
  /** When it came up, from the uptime sensor. */
  upSince?: Date;
  temperature?: number;
  cpu?: number;
  memory?: number;
  /** The sensors behind those three, for their history. */
  temperatureId?: string;
  cpuId?: string;
  memoryId?: string;
  /** A firmware update is waiting. */
  update: boolean;
  /** The switch's ports, where the integration publishes them. */
  ports?: Port[];
};

export type Wlan = {
  id: string;
  name: string;
  /** The on/off switch, where the integration gives one. */
  switchId?: string;
  enabled: boolean | undefined;
  clients?: number;
  /** The QR code's image entity. */
  qrId?: string;
  qrPicture?: string;
};

export type Throughput = {
  down?: { value: number; unit: string; id: string };
  up?: { value: number; unit: string; id: string };
};

export type Network = {
  gateway?: NetDevice;
  devices: NetDevice[];
  wlans: Wlan[];
  throughput: Throughput;
  /** Everyone connected, across the access points and switches. */
  clients?: number;
  /** The gateway's own internet monitors: its latency to Cloudflare,
      Google and Microsoft. */
  latency: Ping[];
};

const num = (entity: EntityView | undefined) => {
  const n = Number(entity?.state);
  return entity && Number.isFinite(n) ? n : undefined;
};

const slugOf = (entity: EntityView) => entity.id.split(".")[1] ?? "";

/* Each kind by the start of its model code, or by a word anywhere in its
   name — two tests, so it is plain which part the anchor holds to. */
const GATEWAY_CODE = /^(?:UDM|UDR|UDW|UCG|UXG|USG|UX|UGW|EFG|UCK)/;
const GATEWAY_NAME = /GATEWAY|DREAMMACHINE|DREAMROUTER|CLOUDGATEWAY/;
const SWITCH_CODE = /^(?:USW|US\d|USP|USF|USL|USM|USC|USE|USA|USX|ES|SWITCH)/;
const SWITCH_NAME = /FLEX|SWITCH/;
const AP_CODE = /^(?:U\d|UAP|UAL|UAE|UAC|UAPA|UK|UWB|E7)/;
const AP_NAME = /NANOHD|INWALL|MESH|BEACON|ACCESSPOINT/;

/**
 * The kind of device, from its model and its entities.
 *
 * The model comes as UniFi's own name ("USW Flex 2.5G 8 PoE", "U7 Lite") or
 * as its internal code ("USPM16", "UCGF", "U7LT"), so both are read; and a
 * device with ports is a switch whatever its model says.
 */
function kindOf(model: string, entities: EntityView[]): DeviceKind {
  const m = model.toUpperCase().replaceAll(/[\s_-]+/g, "");
  if (GATEWAY_CODE.test(m) || GATEWAY_NAME.test(m)) return "gateway";
  if (entities.some((e) => /_port_\d+/.test(slugOf(e)))) return "switch";
  if (SWITCH_CODE.test(m) || SWITCH_NAME.test(m)) return "switch";
  if (AP_CODE.test(m) || AP_NAME.test(m)) return "ap";
  return "other";
}

/**
 * The UniFi network, found in the registries. Optional rate sensors chosen
 * in the settings take the place of the ones found on the gateway.
 */
type RegistryEntry = { entity_id: string; platform?: string; disabled_by?: string | null };

/** A sensor of Home Assistant's Speedtest.net integration, or one named for
    a speed test. */
function isSpeedtest(entry: RegistryEntry | undefined, id = entry?.entity_id ?? ""): boolean {
  if (entry?.disabled_by || !id.startsWith("sensor.")) return false;
  return entry?.platform === "speedtestdotcom" || /speedtest/i.test(id);
}

/** How long after the first paint the network is looked for (useNetwork). */
const DISCOVER_AFTER_MS = 2500;
/** The longest the card waits to show a change. */
const REDRAW_MS = 1000;

export function useNetwork(
  /* `off`: the room board's, where a room shows no network — then nothing is
     subscribed to at all. */
  options: () => { down?: string; up?: string; off?: boolean },
): () => Network {
  /* The integration's entities, read from the registry — not every entity's
     state: only these are subscribed to. */
  /* Looked for after the first paint. The sealed engine of Dash 1.5 copies
     every sensor the widget may read into it as it starts — on a large house
     a third of its start-up burst — and walking the entity registry and making
     a view of every UniFi entity in the same burst stopped the widget ("it
     took too long to start"). Waited for, the burst has refilled. */
  const trickle = useTrickle(DISCOVER_AFTER_MS, Number.POSITIVE_INFINITY, 0);
  const ids = createMemo(() => {
    if (options().off || !trickle.started()) return [];
    const out: string[] = [];
    for (const entry of Object.values(state.entityRegistry ?? {})) {
      const e = entry as RegistryEntry;
      /* The integration's own, and the speed test's as a fallback for the rates. */
      const isUnifi = e.platform === "unifi" && !e.disabled_by;
      if (isUnifi || isSpeedtest(e)) out.push(e.entity_id);
    }
    const chosen = [options().down, options().up].filter((id): id is string => !!id);
    return [...new Set([...out, ...chosen])].sort((a, b) => a.localeCompare(b));
  });
  /* Redrawn at most once a second: the integration's counters, uptimes and
     latencies change many times a second between them, and the whole card
     was made again for each. */
  const entities = useCoalesced(useEntities(ids), REDRAW_MS);

  return createMemo(
    (): Network =>
      buildNetwork(entities(), options(), {
        registry: (id) => state.entityRegistry?.[id] as RegistryEntry | undefined,
        device: (id) => (state.devices?.[id] ?? {}) as DeviceEntry,
      }),
  );
}

type DeviceEntry = { name?: string; name_by_user?: string | null; model?: string | null };

/** Where buildNetwork looks things up: the two registries. */
type Lookup = {
  registry: (entityId: string) => RegistryEntry | undefined;
  device: (deviceId: string) => DeviceEntry;
};

/**
 * The network from the integration's entities: the devices and the Wi-Fi
 * networks, the rates, everyone connected and the gateway's latency. Each
 * part is a function of its own below.
 */
export function buildNetwork(
  all: EntityView[],
  options: { down?: string; up?: string },
  lookup: Lookup,
): Network {
  const { byDevice, speedtest } = groupByDevice(all, lookup);

  const devices: NetDevice[] = [];
  const wlans: Wlan[] = [];
  for (const [deviceId, list] of byDevice) {
    const entry = lookup.device(deviceId);
    const name = entry.name_by_user || entry.name || list[0]?.friendlyName || "UniFi device";
    const model = entry.model ?? "";
    const wlan = wlanOf(deviceId, name, model, list);
    if (wlan) {
      wlans.push(wlan);
      continue;
    }
    const device = deviceOf(deviceId, name, model, list);
    if (device) devices.push(device);
  }

  /* The gateway first, then switches, then access points; by name within. */
  const order: Record<DeviceKind, number> = { gateway: 0, switch: 1, ap: 2, other: 3 };
  devices.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  wlans.sort((a, b) => a.name.localeCompare(b.name));
  const gateway = devices.find((d) => d.kind === "gateway");

  return {
    gateway,
    devices,
    wlans,
    throughput: throughputOf(all, options, gateway ? (byDevice.get(gateway.id) ?? []) : [], speedtest),
    clients: clientsOf(all, new Set(byDevice.keys()), wlans, devices, gateway),
    latency: latencyOf(all),
  };
}

/** The entities by the device they belong to — the speed test's sensors
    aside, which are only a fallback for the rates, not a device. */
function groupByDevice(all: EntityView[], lookup: Lookup) {
  const byDevice = new Map<string, EntityView[]>();
  const speedtest: EntityView[] = [];
  for (const entity of all) {
    if (isSpeedtest(lookup.registry(entity.id), entity.id)) {
      speedtest.push(entity);
      continue;
    }
    if (!entity.deviceId || entity.domain === "device_tracker") continue;
    const list = byDevice.get(entity.deviceId) ?? [];
    list.push(entity);
    byDevice.set(entity.deviceId, list);
  }
  return { byDevice, speedtest };
}

/** A Wi-Fi network: the integration's WLAN device, with its QR code. */
function wlanOf(id: string, name: string, model: string, list: EntityView[]): Wlan | undefined {
  const qr = list.find((e) => e.domain === "image");
  if (!qr && !/wlan/i.test(model)) return undefined;
  const toggle = list.find((e) => e.domain === "switch");
  const count = list.find((e) => e.domain === "sensor");
  const picture = qr?.attributes?.entity_picture;
  return {
    id,
    name,
    switchId: toggle?.id,
    enabled: toggle ? toggle.state === "on" : undefined,
    clients: num(count),
    qrId: qr?.id,
    qrPicture: typeof picture === "string" ? picture : undefined,
  };
}

/** Whether a device is up: its state sensor, else whether its uptime reads. */
function onlineOf(stateSensor: EntityView | undefined, uptime: EntityView | undefined): boolean | undefined {
  if (stateSensor) return /^(connected|online|ok)$/i.test(stateSensor.state);
  if (uptime) return uptime.state !== "unavailable";
  return undefined;
}

/**
 * A switch, an access point or the gateway, with its readings — or nothing,
 * for what the integration makes that is not network hardware: a client it
 * tracks with a block switch, a speed test, a DPI group. Those have no state
 * of their own and no kind.
 */
function deviceOf(id: string, name: string, model: string, list: EntityView[]): NetDevice | undefined {
  const find = (test: (e: EntityView) => boolean) => list.find((e) => e.domain === "sensor" && test(e));
  const stateSensor = find((e) => slugOf(e).endsWith("_state"));
  const uptime = find((e) => e.deviceClass === "timestamp" || slugOf(e).endsWith("_uptime"));
  const clients = find((e) => slugOf(e).endsWith("_clients"));
  const temperature = find((e) => e.deviceClass === "temperature");
  const cpu = find((e) => /cpu/.test(slugOf(e)));
  const memory = find((e) => /memory/.test(slugOf(e)));

  const online = onlineOf(stateSensor, uptime);
  const kind = kindOf(model, list);
  if (kind === "other" && online === undefined) return undefined;

  const since = uptime ? new Date(uptime.state) : undefined;
  const ports = portsOf(list);
  return {
    id,
    /* Only ports that say something: a set of PoE or enable switches with no
       link or power reading drew a faceplate of grey squares that read as
       "nothing plugged in" — which was not the case. */
    ports: ports.some((p) => p.link !== undefined || p.poe === true) ? ports : undefined,
    name,
    model,
    kind,
    online,
    clients: num(clients),
    upSince: since && !Number.isNaN(since.getTime()) ? since : undefined,
    temperature: num(temperature),
    cpu: num(cpu),
    memory: num(memory),
    temperatureId: temperature?.id,
    cpuId: cpu?.id,
    memoryId: memory?.id,
    update: list.find((e) => e.domain === "update")?.state === "on",
  };
}

/** One port entity read into its port: PoE, enabled, power, traffic, link. */
function readPortEntity(p: Port, e: EntityView, what: string) {
  if (e.domain === "switch") {
    if (/poe/.test(what)) p.poe = e.state === "on";
    else if (what === "") p.enabled = e.state !== "off";
    return;
  }
  if (e.domain !== "sensor") return;
  if (/poe/.test(what)) p.poeW = num(e);
  else if (/(^|_)rx/.test(what)) p.rx = num(e);
  else if (/(^|_)tx/.test(what)) p.tx = num(e);
  else if (/link|speed/.test(what)) p.link = (num(e) ?? 0) > 0;
}

/** What a port's readings add up to: power drawn means PoE in use, and
    traffic or power means something is plugged in. */
function settlePort(p: Port): Port {
  const moving = (p.rx ?? 0) > 0 || (p.tx ?? 0) > 0;
  const powered = (p.poeW ?? 0) > 0;
  const poeOn = p.poe === true && (p.poeW === undefined || powered);
  const measured = p.rx !== undefined || p.tx !== undefined;
  let link = p.link;
  if (link === undefined && (moving || powered)) link = true;
  else if (link === undefined && measured) link = false;
  return { ...p, poe: poeOn ? true : powered || undefined, link };
}

/** The ports: everything named <device>_port_<n>_… on this device. */
function portsOf(list: EntityView[]): Port[] {
  const portMap = new Map<number, Port>();
  for (const e of list) {
    const m = /_port_(\d+)(?:_(.+))?$/.exec(slugOf(e));
    if (!m) continue;
    const n = Number(m[1]);
    const p = portMap.get(n) ?? { n };
    readPortEntity(p, e, m[2] ?? "");
    portMap.set(n, p);
  }
  return [...portMap.values()].map(settlePort).sort((a, b) => a.n - b.n);
}

const isRate = (e: EntityView) =>
  e.domain === "sensor" && (e.deviceClass === "data_rate" || /bit\/s|B\/s/.test(e.unitOfMeasurement ?? ""));
const wanFirst = (list: EntityView[]) => list.find((e) => /wan/.test(slugOf(e))) ?? list[0];

/**
 * The rates: the sensors chosen in the settings, else the gateway's own
 * data-rate sensors — the WAN's where they say so — else, for a gateway that
 * publishes none, the last speed test from Home Assistant's Speedtest.net
 * integration, found by itself.
 */
function throughputOf(
  all: EntityView[],
  options: { down?: string; up?: string },
  gatewayEntities: EntityView[],
  speedtest: EntityView[],
): Throughput {
  const pick = (id: string | undefined) => {
    const e = id ? all.find((x) => x.id === id) : undefined;
    const value = num(e);
    return e && value !== undefined ? { value, unit: e.unitOfMeasurement ?? "", id: e.id } : undefined;
  };
  const rates = gatewayEntities.filter(isRate);
  const downAuto = wanFirst(rates.filter((e) => /(_rx|download|_in)\b|_rx_/.test(slugOf(e))));
  const upAuto = wanFirst(rates.filter((e) => /(_tx|upload|_out)\b|_tx_/.test(slugOf(e))));
  const tested = (pattern: RegExp) => speedtest.find((e) => pattern.test(e.id))?.id;
  return {
    down: pick(options.down) ?? pick(downAuto?.id) ?? pick(tested(/download/i)),
    up: pick(options.up) ?? pick(upAuto?.id) ?? pick(tested(/upload/i)),
  };
}

/** A sum, or nothing for an empty list. */
const sumOrNone = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) : undefined);

/**
 * Everyone connected, from the most complete count there is:
 * - the integration's client trackers — one per client it has seen, "home"
 *   while connected (the network devices' own trackers aside);
 * - the Wi-Fi networks' own counts;
 * - the access points' and switches' client sensors, which not every setup
 *   has enabled (it read 0 where they were missing).
 * The largest wins: each of the others misses some clients.
 */
function clientsOf(
  all: EntityView[],
  ownDevices: Set<string>,
  wlans: Wlan[],
  devices: NetDevice[],
  gateway: NetDevice | undefined,
): number | undefined {
  const trackers = all.filter((e) => e.domain === "device_tracker" && !(e.deviceId && ownDevices.has(e.deviceId)));
  const fromTrackers = trackers.length ? trackers.filter((e) => e.state === "home").length : undefined;
  const fromWlans = sumOrNone(wlans.map((w) => w.clients).filter((n): n is number => n !== undefined));
  const counted = devices.filter((d) => d.kind !== "gateway" && d.clients !== undefined);
  const fromDevices = sumOrNone(counted.map((d) => d.clients ?? 0));
  const counts = [fromTrackers, fromWlans, fromDevices, gateway?.clients].filter((n): n is number => n !== undefined);
  return counts.length ? Math.max(...counts) : undefined;
}

/* The gateway's WAN monitors: UniFi measures its latency to Cloudflare,
   Google and Microsoft by itself, and the integration publishes each as a
   sensor in ms on the gateway — found, not configured. A second WAN gets its
   own set, named as such. */
const TARGETS: [RegExp, string][] = [
  [/cloudflare/, "Cloudflare"],
  [/google/, "Google"],
  [/microsoft/, "Microsoft"],
];

/** One sensor as a latency monitor, if it is one. */
function latencyEntry(e: EntityView): Ping | undefined {
  if (e.domain !== "sensor") return undefined;
  const slug = slugOf(e);
  const target = TARGETS.find(([re]) => re.test(slug));
  if (!target) return undefined;
  if (!/latency/.test(slug) && e.unitOfMeasurement !== "ms") return undefined;
  const value = num(e);
  let online: boolean | undefined;
  if (e.state === "unavailable") online = false;
  else if (value !== undefined) online = true;
  return {
    id: e.id,
    name: /wan_?2/.test(slug) ? `${target[1]} (WAN 2)` : target[1],
    online,
    ms: value,
  };
}

function latencyOf(all: EntityView[]): Ping[] {
  return all
    .map(latencyEntry)
    .filter((p): p is Ping => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "42.3 Mbit/s", rounded to what reads at a glance. */
export function formatRate(rate: { value: number; unit: string } | undefined): string {
  if (!rate) return "—";
  return `${rateDigits(rate.value)} ${rate.unit}`.trim();
}

/** A rate's number, to as many places as read at a glance: 312, 41.6, 9.25. */
export function rateDigits(v: number): string {
  if (v >= 100) return String(Math.round(v));
  return v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** How full a reading is: amber from `warn`, red from `alarm`. */
export type Level = "alarm" | "warn" | "calm";
export function levelOf(value: number, warn: number, alarm: number): Level {
  if (value >= alarm) return "alarm";
  return value >= warn ? "warn" : "calm";
}

/** "3 d", "5 h", "12 min" since a moment. */
export function upFor(date: Date | undefined): string {
  if (!date) return "";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export const KIND_ICON: Record<DeviceKind, string> = {
  gateway: "mdi:router-network",
  switch: "mdi:switch",
  ap: "mdi:access-point",
  other: "mdi:lan",
};

/* ---------- ping ----------
 *
 * Home Assistant's Ping integration: one device per host, its binary sensor
 * saying whether the host answers, and — where it is enabled — a sensor for
 * the average round trip beside it. Found by the registry's platform, like
 * the UniFi entities; the settings can name the hosts instead. */

export type Ping = {
  id: string;
  name: string;
  online: boolean | undefined;
  /** Average round trip, in ms. */
  ms?: number;
};

export function usePings(chosen: () => string[], off?: () => boolean): () => Ping[] {
  const ids = createMemo(() => {
    if (off?.()) return [];
    const out: string[] = [];
    for (const entry of Object.values(state.entityRegistry ?? {})) {
      const e = entry as { entity_id: string; platform?: string; disabled_by?: string | null };
      if (e.platform === "ping" && !e.disabled_by) out.push(e.entity_id);
    }
    return [...new Set([...out, ...chosen()])].sort((a, b) => a.localeCompare(b));
  });
  const entities = useEntities(ids);

  return createMemo(() => {
    const all = entities();
    const hosts = all.filter(
      (e) => e.domain === "binary_sensor" && (!chosen().length || chosen().includes(e.id)),
    );
    const RANK = { down: 0, slow: 1, ok: 2 } as const;
    return hosts.map((host): Ping => {
      const slug = host.id.split(".")[1] ?? "";
      /* The average round trip: the sensor on the same device, or one named
         after the host; older versions carried it as an attribute. */
      const rtt = all.find(
        (e) =>
          e.domain === "sensor" &&
          /round_trip_time_av/.test(e.id) &&
          ((host.deviceId && e.deviceId === host.deviceId) || (e.id.split(".")[1] ?? "").startsWith(slug)),
      );
      const attr = Number(host.attributes?.round_trip_time_avg);
      const ms = num(rtt) ?? (Number.isFinite(attr) ? attr : undefined);
      const online = ON_OFF[host.state];
      return {
        id: host.id,
        name: (host.friendlyName ?? slug).replace(/^ping\s+/i, ""),
        online,
        ms: online === false ? undefined : ms,
      };
    })
    /* Trouble first: a host that is down, then one that is slow. */
    .sort((a, b) => RANK[pingTone(a)] - RANK[pingTone(b)] || a.name.localeCompare(b.name));
  });
}

/** Fast, slow, or not answering. */
/** A binary sensor's state as up or down; anything else unknown. */
const ON_OFF: Record<string, boolean | undefined> = { on: true, off: false };

export function pingTone(p: Ping): "ok" | "slow" | "down" {
  if (p.online === false) return "down";
  if (p.ms === undefined || p.ms < 50) return "ok";
  return p.ms < 150 ? "slow" : "down";
}

/** What a latency pill says: "down", the round trip, or "up". */
export function pingText(p: Ping): string | number {
  if (p.online === false) return "down";
  return p.ms === undefined ? "up" : Math.round(p.ms);
}

/** The latency monitor's mark, by whom it measures. */
const MARKS: [RegExp, string][] = [
  [/google/i, "mdi:google"],
  [/microsoft/i, "mdi:microsoft"],
  [/cloudflare/i, "mdi:cloud-outline"],
];
export const markOf = (name: string) => MARKS.find(([pattern]) => pattern.test(name))?.[1] ?? "mdi:server-network";

/** The gateway's line: offline, or how many are on it. `online` comes
    before the count where the line says "Online · 47 clients". */
export function clientsLine(offline: boolean, clients: number | undefined, online = false): string {
  if (offline) return "Offline";
  if (clients === undefined) return "Online";
  return online ? `Online · ${clients} clients` : `${clients} clients`;
}
