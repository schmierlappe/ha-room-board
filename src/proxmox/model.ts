import { createMemo, mapArray } from "solid-js";
import { useTrickle } from "../async";
import { state, useEntities, type EntityView } from "@glasshome/widget-sdk";

/**
 * Proxmox VE, as Home Assistant's built-in integration publishes it.
 *
 * Found rather than configured: every entity the integration makes is marked
 * in the entity registry with its platform, "proxmoxve", and belongs to a
 * device — a node, or a VM, a container or a storage on a node (the device's
 * model says which, and its parent is the node). What each entity is comes
 * from its translation key — node_cpu, vm_status, container_memory_percentage
 * — so names in any language, or renamed by hand, are read the same.
 */

export type GuestStatus = "running" | "stopped" | "suspended" | "unknown";

export type Guest = {
  /** The device's id. */
  id: string;
  name: string;
  kind: "vm" | "lxc";
  status: GuestStatus;
  cpu?: number;
  memory?: number;
  /** The configured memory, in bytes. */
  memoryMax?: number;
  /** When it last started, from the uptime sensor. */
  upSince?: Date;
  /** Its buttons, by what they do. */
  buttons: Partial<Record<GuestAction, string>>;
  /** The node it runs on: that device's id. */
  node?: string;
  url?: string;
};

export type GuestAction = "start" | "stop" | "shutdown" | "restart" | "reboot";

export type Storage = {
  id: string;
  name: string;
  /** Share of it in use, in percent. */
  used?: number;
  node?: string;
};

export type ProxNode = {
  id: string;
  name: string;
  online: boolean | undefined;
  cpu?: number;
  memory?: number;
  memoryMax?: number;
  disk?: number;
  upSince?: Date;
  /** Packages or a version waiting. */
  update: boolean;
  /** Whether the last backup succeeded, and when it ran. */
  backupOk?: boolean;
  lastBackup?: Date;
  buttons: Partial<Record<GuestAction, string>>;
  url?: string;
};

export type Cluster = {
  nodes: ProxNode[];
  guests: Guest[];
  storages: Storage[];
};

type Registry = {
  entity_id: string;
  platform?: string;
  disabled_by?: string | null;
  translation_key?: string | null;
  unique_id?: string;
  device_id?: string | null;
};
type Device = {
  name?: string | null;
  name_by_user?: string | null;
  model?: string | null;
  via_device_id?: string | null;
  configuration_url?: string | null;
};

const num = (entity: EntityView | undefined) => {
  const n = Number(entity?.state);
  return entity && entity.state !== "" && Number.isFinite(n) ? n : undefined;
};

/** A timestamp sensor's moment. */
const when = (entity: EntityView | undefined) => {
  if (!entity) return undefined;
  const t = Date.parse(entity.state);
  return Number.isFinite(t) ? new Date(t) : undefined;
};

/** What an entity is: its translation key, or the end of its unique id —
    the uptime sensor has no key of its own. */
const keyOf = (entry: Registry) => {
  if (entry.translation_key) return entry.translation_key;
  const id = entry.unique_id ?? "";
  for (const key of ["node_uptime", "vm_uptime", "container_uptime"]) if (id.endsWith(key)) return key;
  /* Home Assistant's frontend gives no unique ids: the entity id's name
     then, "pve_mac_mini_uptime", found as an uptime by its end. */
  return id || (entry.entity_id.split(".")[1] ?? "");
};

/** The memory sensor's bytes, whatever unit it is shown in. */
const bytes = (entity: EntityView | undefined) => {
  const n = num(entity);
  if (n === undefined) return undefined;
  const unit = (entity?.unitOfMeasurement ?? "B").toLowerCase();
  const scale: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
  return n * (scale[unit] ?? 1);
};

const ACTIONS: GuestAction[] = ["start", "stop", "shutdown", "restart", "reboot"];
const actionOf = (key: string): GuestAction | undefined =>
  ACTIONS.find((action) => key === action || key.endsWith(`_${action}`));

/** The kinds of entity the widget shows (keyOf), by their ends: a guest's
    and a node's readings, the storages, the buttons. Everything else the
    integration publishes (network and disk counters, swap, load...) is left
    out before a view is made of it: on a large cluster that is half of
    its several hundred entities. */
const WANTED = [
  "_status", "_running", "_cpu", "_memory_percentage", "_max_memory", "_uptime",
  "node_disk", "node_max_disk", "node_backup_last_backup", "backup",
  "start", "stop", "shutdown", "restart", "reboot",
];
const wanted = (entry: Registry): boolean => {
  const domain = entry.entity_id.slice(0, entry.entity_id.indexOf("."));
  if (domain === "update" || domain === "binary_sensor" || domain === "button") return true;
  const key = keyOf(entry);
  return key.startsWith("storage") || WANTED.some((end) => key === end || key.endsWith(end));
};

/** How long after the first paint the cluster is looked for. The sealed
    engine of Dash 1.5 gives a widget one burst of work to start in, and on a
    large house the copy of every sensor it may read takes a third of it
    before the widget runs at all; walking the entity registry and making a
    view of every Proxmox entity in the same burst went over and stopped the
    widget ("it took too long to start"). Waited for, the burst has refilled. */
const DISCOVER_AFTER_MS = 2000;
/** Devices taken in at a time once found, and the pause between batches.
    A device's views come to some five units of work; the whole dashboard
    shares 50 a second while every widget starts, and taken in faster
    (eight every quarter second) the cluster alone drained it and the widget
    was stopped. Four a second leave room for the others. */
const BATCH = 4;
const BATCH_PAUSE_MS = 1000;

export function useCluster(options: () => { off?: boolean } = () => ({})): () => Cluster {
  const trickle = useTrickle(DISCOVER_AFTER_MS, BATCH, BATCH_PAUSE_MS);
  const registry = createMemo(() => {
    const out = new Map<string, Registry>();
    if (options().off || !trickle.started()) return out;
    for (const entry of Object.values(state.entityRegistry ?? {})) {
      const e = entry as Registry;
      if (e.platform === "proxmoxve" && !e.disabled_by && wanted(e)) out.set(e.entity_id, e);
    }
    return out;
  });
  /* Which entity is what, by device: from the registries alone, so made
     once (and again only when they change), not on every reading. Each
     device then reads only its own entities and is made again only when one
     of them changes; the whole is put together from the ready-made parts.
     Built in one piece on every update, as it was, a batch of readings from
     Proxmox came to some sixty units of work, and the sealed engine of
     Dash 1.5 stopped the widget after three. */
  const plan = createMemo((): Plan => {
    const byDevice = new Map<string, Row>();
    for (const [id, entry] of registry()) {
      const deviceId = entry.device_id;
      if (!deviceId) continue;
      let row = byDevice.get(deviceId);
      if (!row) {
        const device = (state.devices?.[deviceId] ?? {}) as Device;
        row = { deviceId, device, name: device.name_by_user || device.name || "Proxmox", keys: new Map() };
        byDevice.set(deviceId, row);
      }
      row.keys.set(id, keyOf(entry));
    }
    /* In name order once here, so an update only sorts guests by status. */
    return [...byDevice.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const parts = mapArray(() => trickle.take(plan()), (row) => {
    const ids = [...row.keys.keys()];
    const entities = useEntities(() => ids);
    return createMemo(() => partOf(row, entities()));
  });

  return createMemo((): Cluster => {
    const nodes: ProxNode[] = [];
    const guests: Guest[] = [];
    const storages: Storage[] = [];
    for (const part of parts()) {
      const made = part();
      if (made?.kind === "guest") guests.push(made.guest);
      else if (made?.kind === "storage") storages.push(made.storage);
      else if (made?.kind === "node") nodes.push(made.node);
    }
    guests.sort((a, b) => RANK[a.status] - RANK[b.status]);
    return { nodes, guests, storages };
  });
}

/** One entity of a device, with what it is (see keyOf). */
type Part = { entity: EntityView; key: string };

/** A device in the plan: what it is, and what each of its entities is. */
type Row = { deviceId: string; device: Device; name: string; keys: Map<string, string> };
type Plan = Row[];

type Made =
  | { kind: "guest"; guest: Guest }
  | { kind: "storage"; storage: Storage }
  | { kind: "node"; node: ProxNode }
  | undefined;

const RANK: Record<GuestStatus, number> = { running: 0, suspended: 1, unknown: 2, stopped: 3 };

/** A device read as a guest, a storage or a node — a function of its own each, below. */
function partOf(row: Row, entities: EntityView[]): Made {
  const list: Part[] = [];
  for (const entity of entities) list.push({ entity, key: row.keys.get(entity.id) ?? "" });
  if (!list.length) return undefined;
  const { deviceId, device, name } = row;
  const model = (device.model ?? "").toLowerCase();
  const guest = guestOf(deviceId, name, model, device, list);
  if (guest) return { kind: "guest", guest };
  if (model === "storage" || list.every((x) => x.key.startsWith("storage")))
    return { kind: "storage", storage: storageOf(deviceId, name, device, list) };
  return { kind: "node", node: nodeOf(deviceId, name, device, list) };
}

/** A device's entity by what it is: "node_cpu", or one ending "_cpu". */
const findPart = (list: Part[], ...keys: string[]) =>
  list.find((x) => keys.some((k) => x.key === k || x.key.endsWith(`_${k}`)))?.entity;

/** A device's buttons, by what they do. */
function buttonsOf(list: Part[]): Partial<Record<GuestAction, string>> {
  const buttons: Partial<Record<GuestAction, string>> = {};
  for (const { entity, key } of list) {
    const action = entity.domain === "button" ? actionOf(key) : undefined;
    if (action) buttons[action] = entity.id;
  }
  return buttons;
}

/** A guest's state: its status sensor, else its running binary sensor. */
function guestStatus(status: string, running: EntityView | undefined): GuestStatus {
  if (status === "running" || status === "stopped" || status === "suspended") return status;
  if (!running) return "unknown";
  return running.state === "on" ? "running" : "stopped";
}

/** A VM or a container — or nothing, for a device that is neither. */
function guestOf(id: string, name: string, model: string, device: Device, list: Part[]): Guest | undefined {
  const isVm = model === "vm" || list.some((x) => x.key.startsWith("vm_"));
  const isLxc = model === "container" || list.some((x) => x.key.startsWith("container_"));
  if (!isVm && !isLxc) return undefined;
  const p = isVm ? "vm" : "container";
  const status = (findPart(list, `${p}_status`)?.state ?? "").toLowerCase();
  const running = list.find((x) => x.entity.domain === "binary_sensor")?.entity;
  return {
    id,
    name,
    kind: isVm ? "vm" : "lxc",
    status: guestStatus(status, running),
    cpu: num(findPart(list, `${p}_cpu`)),
    memory: num(findPart(list, `${p}_memory_percentage`)),
    memoryMax: bytes(findPart(list, `${p}_max_memory`)),
    upSince: when(findPart(list, `${p}_uptime`, "uptime")),
    buttons: buttonsOf(list),
    node: device.via_device_id ?? undefined,
    url: device.configuration_url ?? undefined,
  };
}

function storageOf(id: string, name: string, device: Device, list: Part[]): Storage {
  const pct = list.find((x) => x.entity.unitOfMeasurement === "%")?.entity;
  return {
    id,
    name: name.replace(/^Storage \((.*)\)$/, "$1"),
    used: num(pct),
    node: device.via_device_id ?? undefined,
  };
}

/** Disk in use, in percent, from the used and the total sensors. */
function diskShare(list: Part[]): number | undefined {
  const used = num(findPart(list, "node_disk"));
  const max = num(findPart(list, "node_max_disk"));
  return used !== undefined && max ? (used / max) * 100 : undefined;
}

function nodeOf(id: string, name: string, device: Device, list: Part[]): ProxNode {
  const status = (findPart(list, "node_status")?.state ?? "").toLowerCase();
  const backup = list.find((x) => x.entity.domain === "binary_sensor")?.entity;
  return {
    id,
    name,
    online: status ? status === "online" : undefined,
    cpu: num(findPart(list, "node_cpu")),
    memory: num(findPart(list, "node_memory_percentage")),
    memoryMax: bytes(findPart(list, "node_max_memory")),
    disk: diskShare(list),
    upSince: when(findPart(list, "node_uptime", "uptime")),
    update: list.some((x) => x.entity.domain === "update" && x.entity.state === "on"),
    backupOk: backup ? backup.state === "on" : undefined,
    lastBackup: when(findPart(list, "node_backup_last_backup")),
    buttons: buttonsOf(list),
    url: device.configuration_url ?? undefined,
  };
}

/** "4 d", "7 h", "12 min" since a moment. */
export function upFor(since: Date | undefined): string {
  if (!since) return "";
  const minutes = Math.max(0, Math.round((Date.now() - since.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** "8 GB", "512 MB". */
export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "";
  const gb = n / 1024 ** 3;
  if (gb < 1) return `${Math.round(n / 1024 ** 2)} MB`;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1).replace(/\.0$/, "")} GB`;
}

/** How busy a reading is: amber from `warn`, red from `alarm`. */
export function toneOf(value: number | undefined, warn: number, alarm: number): "alarm" | "warn" | undefined {
  if (value === undefined) return undefined;
  if (value >= alarm) return "alarm";
  if (value >= warn) return "warn";
  return undefined;
}

/** What to call the whole: a lone node by its name, several "Cluster". */
export function clusterTitle(nodes: ProxNode[]): string {
  if (nodes.length === 1) return nodes[0]!.name;
  return nodes.length > 1 ? "Cluster" : "Proxmox";
}

export const KIND_ICON = { vm: "mdi:monitor", lxc: "mdi:cube-outline" } as const;
export const STATUS_LABEL: Record<GuestStatus, string> = {
  running: "Running",
  stopped: "Stopped",
  suspended: "Paused",
  unknown: "Unknown",
};
