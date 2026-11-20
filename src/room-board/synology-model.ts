import { createMemo, mapArray } from "solid-js";
import { state, useEntities, type EntityView } from "@glasshome/widget-sdk";
import { useTrickle } from "../async";

/**
 * Synology DiskStation, as Home Assistant's own integration (synology_dsm)
 * publishes it: a device for the NAS, with a device of its own for each
 * volume and each drive, attached to it. What each entity is comes from its
 * translation key — cpu_total_load, volume_percentage_used, disk_temp — or,
 * where the frontend gives none, from the end of its entity id
 * ("…_cpu_utilization_total"), with the "_2" Home Assistant adds to a second
 * of the same name taken off. Nothing to configure: every NAS the
 * integration knows shows up.
 */

export type DriveState = "normal" | "warning" | "crashed" | "unknown";

export type Drive = {
  id: string;
  name: string;
  m2: boolean;
  status: DriveState;
  /** The status as the NAS words it, for the overlay. */
  statusText: string;
  smart?: string;
  temp?: number;
  badSectors: boolean;
  lowLife: boolean;
};

export type Volume = {
  id: string;
  name: string;
  status: DriveState;
  statusText: string;
  /** Share used, in percent. */
  used?: number;
  usedBytes?: number;
  totalBytes?: number;
  temp?: number;
};

export type Nas = {
  id: string;
  name: string;
  model?: string;
  cpu?: number;
  memory?: number;
  memoryBytes?: number;
  /** Bytes a second. */
  up?: number;
  down?: number;
  temp?: number;
  upSince?: Date;
  /** The security advisor: true when it has found something. */
  securityIssue?: boolean;
  update: boolean;
  updateVersion?: string;
  volumes: Volume[];
  drives: Drive[];
  reboot?: string;
  shutdown?: string;
  /** The fan's mode, a select entity, where the NAS has one. */
  fan?: { id: string; value: string; options: string[] };
  url?: string;
};

type Registry = {
  entity_id: string;
  platform?: string;
  disabled_by?: string | null;
  translation_key?: string | null;
  device_id?: string | null;
};
type Device = { name?: string | null; name_by_user?: string | null; model?: string | null; via_device_id?: string | null; configuration_url?: string | null };

/** What an entity is: by its translation key, or else by how its id ends. */
const BY_KEY: Record<string, string> = {
  cpu_total_load: "cpu",
  memory_real_usage: "memory",
  memory_total_real: "memoryTotal",
  network_up: "up",
  network_down: "down",
  temperature: "temp",
  uptime: "uptime",
  volume_status: "volStatus",
  volume_percentage_used: "volUsed",
  volume_size_used: "volUsedSize",
  volume_size_total: "volTotal",
  volume_disk_temp_avg: "volTemp",
  disk_status: "diskStatus",
  disk_smart_status: "diskSmart",
  disk_temp: "diskTemp",
  disk_exceed_bad_sector_thr: "badSectors",
  disk_below_remain_life_thr: "lowLife",
};
const BY_END: [string, string][] = [
  ["cpu_utilization_total", "cpu"],
  ["memory_usage_real", "memory"],
  ["memory_total_real", "memoryTotal"],
  ["upload_throughput", "up"],
  ["download_throughput", "down"],
  ["last_boot", "uptime"],
  ["uptime", "uptime"],
  ["volume_used", "volUsed"],
  ["used_space", "volUsedSize"],
  ["total_size", "volTotal"],
  ["average_disk_temp", "volTemp"],
  ["status_smart", "diskSmart"],
  ["exceeded_max_bad_sectors", "badSectors"],
  ["below_min_remaining_life", "lowLife"],
  ["security_status", "security"],
  ["fan_speed_mode", "fan"],
  ["reboot", "reboot"],
  ["shutdown", "shutdown"],
  ["temperature", "temp"],
  ["status", "status"],
];

const kindOf = (entry: Registry): string => {
  const domain = entry.entity_id.slice(0, entry.entity_id.indexOf("."));
  if (domain === "update") return "update";
  const key = entry.translation_key ?? "";
  if (domain === "binary_sensor" && (key === "status" || /security/.test(entry.entity_id))) return "security";
  if (BY_KEY[key]) return BY_KEY[key]!;
  const name = (entry.entity_id.split(".")[1] ?? "").replace(/_\d+$/, "");
  for (const [end, kind] of BY_END) if (name.endsWith(end)) return kind;
  return "";
};

const num = (entity: EntityView | undefined) => {
  const n = Number(entity?.state);
  return entity && entity.state !== "" && Number.isFinite(n) ? n : undefined;
};

/** A size or a rate in bytes (per second), whatever unit it is shown in. */
const bytes = (entity: EntityView | undefined) => {
  const n = num(entity);
  if (n === undefined) return undefined;
  const unit = (entity?.unitOfMeasurement ?? "B").replace("/s", "").toLowerCase();
  const scale: Record<string, number> = {
    b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
    "bit": 1 / 8, kbit: 125, mbit: 125e3, gbit: 125e6,
  };
  return n * (scale[unit] ?? 1);
};

const stateOf = (text: string | undefined): DriveState => {
  const t = (text ?? "").toLowerCase();
  if (!t || t === "unknown" || t === "unavailable") return "unknown";
  if (/normal|healthy|^ok$/.test(t)) return "normal";
  if (/crash|fail|degrad|abnormal/.test(t)) return "crashed";
  return "warning";
};

const label = (text: string | undefined) => {
  const t = (text ?? "").replaceAll("_", " ");
  return t ? t[0]!.toUpperCase() + t.slice(1) : "Unknown";
};

/** "synology_vm (Drive 1)" → "Drive 1". */
const subName = (name: string) => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? name;

type Row = { deviceId: string; device: Device; name: string; kinds: Map<string, string> };
type Part =
  | { kind: "nas"; root: string; nas: Omit<Nas, "volumes" | "drives"> }
  | { kind: "volume"; root: string; volume: Volume }
  | { kind: "drive"; root: string; drive: Drive };

function partOf(row: Row, entities: EntityView[]): Part {
  const by = new Map<string, EntityView>();
  for (const entity of entities) {
    const kind = row.kinds.get(entity.id);
    if (kind && !by.has(kind)) by.set(kind, entity);
  }
  const root = row.device.via_device_id ?? row.deviceId;
  const kinds = new Set(row.kinds.values());
  const isVolume = ["volUsed", "volUsedSize", "volTemp", "volTotal"].some((k) => kinds.has(k)) || /\(volume/i.test(row.name);
  const isDrive = ["diskTemp", "diskSmart", "badSectors", "lowLife", "diskStatus"].some((k) => kinds.has(k)) || /\((m\.2 )?drive/i.test(row.name);

  if (isVolume) {
    const status = (by.get("volStatus") ?? by.get("status"))?.state;
    const used = num(by.get("volUsed"));
    const usedBytes = bytes(by.get("volUsedSize"));
    const total = bytes(by.get("volTotal")) ?? (usedBytes !== undefined && used ? usedBytes / (used / 100) : undefined);
    return {
      kind: "volume",
      root,
      volume: { id: row.deviceId, name: subName(row.name), status: stateOf(status), statusText: label(status), used, usedBytes, totalBytes: total, temp: num(by.get("volTemp")) },
    };
  }
  if (isDrive) {
    const status = (by.get("diskStatus") ?? by.get("status"))?.state;
    const name = subName(row.name);
    return {
      kind: "drive",
      root,
      drive: {
        id: row.deviceId,
        name,
        m2: /m\.2|nvme/i.test(name),
        status: stateOf(status),
        statusText: label(status),
        smart: by.get("diskSmart")?.state,
        temp: num(by.get("diskTemp") ?? by.get("temp")),
        badSectors: by.get("badSectors")?.state === "on",
        lowLife: by.get("lowLife")?.state === "on",
      },
    };
  }
  const update = by.get("update");
  const uptime = by.get("uptime");
  const since = uptime ? Date.parse(uptime.state) : Number.NaN;
  const fan = by.get("fan");
  const options = fan?.attributes?.options;
  return {
    kind: "nas",
    root: row.deviceId,
    nas: {
      id: row.deviceId,
      name: row.name,
      model: row.device.model ?? undefined,
      cpu: num(by.get("cpu")),
      memory: num(by.get("memory")),
      memoryBytes: bytes(by.get("memoryTotal")),
      up: bytes(by.get("up")),
      down: bytes(by.get("down")),
      temp: num(by.get("temp")),
      upSince: Number.isFinite(since) ? new Date(since) : undefined,
      securityIssue: by.get("security") ? by.get("security")!.state === "on" : undefined,
      update: update?.state === "on",
      updateVersion: update?.attributes?.latest_version,
      reboot: by.get("reboot")?.id,
      shutdown: by.get("shutdown")?.id,
      fan: fan ? { id: fan.id, value: fan.state, options: Array.isArray(options) ? options : [] } : undefined,
      url: row.device.configuration_url ?? undefined,
    },
  };
}

/** Every NAS the integration knows, with its volumes and drives. */
export function useSynology(options: () => { off?: boolean } = () => ({})): () => Nas[] {
  /* Looked for after the board's first paint and taken in a few devices at
     a time, as Proxmox is (src/proxmox/model.ts): two NAS with eight drives
     each are some twenty devices. */
  const trickle = useTrickle(1500, 6, 600);
  const plan = createMemo((): Row[] => {
    if (options().off || !trickle.started()) return [];
    const byDevice = new Map<string, Row>();
    for (const value of Object.values(state.entityRegistry ?? {})) {
      const entry = value as Registry;
      if (entry.platform !== "synology_dsm" || entry.disabled_by || !entry.device_id) continue;
      const kind = kindOf(entry);
      if (!kind) continue;
      let row = byDevice.get(entry.device_id);
      if (!row) {
        const device = (state.devices?.[entry.device_id] ?? {}) as Device;
        row = { deviceId: entry.device_id, device, name: device.name_by_user || device.name || "Synology", kinds: new Map() };
        byDevice.set(entry.device_id, row);
      }
      row.kinds.set(entry.entity_id, kind);
    }
    return [...byDevice.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  });
  const parts = mapArray(
    () => trickle.take(plan()),
    (row) => {
      const ids = [...row.kinds.keys()];
      const entities = useEntities(() => ids);
      return createMemo(() => partOf(row, entities()));
    },
  );
  return createMemo(() => {
    const all = parts().map((part) => part());
    const list: Nas[] = [];
    for (const part of all) if (part.kind === "nas") list.push({ ...part.nas, volumes: [], drives: [] });
    const find = (root: string) => list.find((nas) => nas.id === root);
    for (const part of all) {
      if (part.kind === "volume") find(part.root)?.volumes.push(part.volume);
      if (part.kind === "drive") find(part.root)?.drives.push(part.drive);
    }
    const order = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });
    for (const nas of list) {
      nas.volumes.sort(order);
      /* The bays first, then the M.2 slots, each in number order. */
      nas.drives.sort((a, b) => Number(a.m2) - Number(b.m2) || order(a, b));
    }
    return list;
  });
}

/* ---------- reading it ---------- */

/** "12.4 TB", "512 GB". */
export function size(n: number | undefined): string {
  if (n === undefined) return "";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/** "82 kB/s", "1.2 MB/s". */
export function rate(n: number | undefined): string {
  if (n === undefined) return "–";
  if (n < 1000) return `${Math.round(n)} B/s`;
  return `${size(n).replace(" ", " ").replace("KB", "kB")}/s`;
}

/** The whole NAS in one word, worst first. */
export function healthOf(nas: Nas): { tone: "ok" | "warn" | "alarm"; text: string } {
  const crashed = [...nas.drives, ...nas.volumes].some((x) => x.status === "crashed");
  if (crashed) return { tone: "alarm", text: "Failure" };
  const drivesBad = nas.drives.some((d) => d.status === "warning" || d.badSectors || d.lowLife);
  const volBad = nas.volumes.some((v) => v.status === "warning");
  if (drivesBad || volBad) return { tone: "warn", text: "Attention" };
  if (nas.volumes.some((v) => (v.used ?? 0) >= 90)) return { tone: "warn", text: "Almost full" };
  if (nas.securityIssue) return { tone: "warn", text: "Security" };
  return { tone: "ok", text: "Healthy" };
}

export function upFor(since: Date | undefined): string {
  if (!since) return "";
  const minutes = Math.max(0, Math.round((Date.now() - since.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
