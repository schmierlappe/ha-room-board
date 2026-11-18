import { useTrickle } from "../async";
import { useDomains } from "../domains";
import { createEffect, createMemo, createSignal, mapArray, on, onCleanup, untrack } from "solid-js";
import { state, useEntities, type EntityView } from "@glasshome/widget-sdk";

/**
 * Uptime Kuma, as Home Assistant's built-in integration publishes it.
 *
 * One device per monitor. Its status is an enum sensor —
 * `sensor.<monitor>_status`, one of up, down, pending or maintenance — and
 * beside it, on the same device, sensors for the response time, the days
 * left on the certificate and the monitored URL. The status sensor is the
 * monitor; the rest are found from it.
 */

export type Status = "up" | "down" | "pending" | "maintenance" | "unknown";

export type Monitor = {
  /** The status sensor's entity id. */
  id: string;
  name: string;
  status: Status;
  /** Milliseconds, where the monitor reports one. */
  responseMs?: number;
  /** The response-time sensor, for its history. */
  responseId?: string;
  /** Days until the certificate runs out (HTTPS monitors). */
  certDays?: number;
  url?: string;
  /** Its tags in Uptime Kuma, as "name" or "name:value" — from the tags
      sensor, which Home Assistant leaves switched off until it is enabled. */
  tags?: string[];
  /** When the status last changed. */
  since: Date;
};

const STATUSES: Status[] = ["up", "down", "pending", "maintenance"];

const statusOf = (entity: EntityView | undefined): Status => {
  const state = (entity?.state ?? "").toLowerCase();
  return (STATUSES as string[]).includes(state) ? (state as Status) : "unknown";
};

/** Down first, then the waiting, then maintenance, then what is up. */
const RANK: Record<Status, number> = { down: 0, pending: 1, unknown: 2, maintenance: 3, up: 4 };

const slugOf = (id: string) => {
  const slug = id.split(".")[1] ?? "";
  return slug.endsWith("_status") ? slug.slice(0, -"_status".length) : slug;
};

/** The endings of a monitor's other sensors, as Uptime Kuma names them. */
const COMPANION_ENDS = ["_response_time", "_certificate_expiry", "_monitored_url", "_tags", "_url"];

/** The monitor a companion sensor belongs to — its name without the ending —
    or nothing for a sensor that is not one. */
const monitorOf = (id: string): string | undefined => {
  const slug = id.split(".")[1] ?? "";
  const end = COMPANION_ENDS.find((e) => slug.endsWith(e));
  return end ? slug.slice(0, -end.length) : undefined;
};

/** "Home Assistant Status" → "Home Assistant". A check of the ending
    rather than /\s*status$/i, which on a long run of spaces not followed by
    "status" was tried again from every one of them. */
const nameOf = (entity: EntityView) => {
  const full = entity.friendlyName ?? entity.id;
  const name = full.toLowerCase().endsWith("status") ? full.slice(0, -"status".length) : full;
  return name.trim() || entity.id;
};

const numeric = (entity: EntityView | undefined) => {
  const n = Number(entity?.state);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Whether a status sensor is Uptime Kuma's: an enum whose options are the
 * four monitor states. Used to find the monitors when none are chosen.
 */
export const isMonitor = (entity: EntityView) => {
  const options = entity.attributes?.options;
  return (
    Array.isArray(options) &&
    options.includes("up") &&
    options.includes("down") &&
    (options.includes("pending") || options.includes("maintenance"))
  );
};

/** How long after the first paint every monitor is looked for (useMonitors). */
const DISCOVER_AFTER_MS = 3000;
/** Monitors taken in at a time, and the pause between two such batches:
    some twenty-five units of work a second, below the 50 a second the whole
    dashboard shares while its widgets start. Later than the Proxmox
    widget's (2 s), so the two do not start on the same beat. */
const BATCH = 15;
const BATCH_PAUSE_MS = 1000;
/** The longest the list waits to show a change. */
const REDRAW_MS = 1000;

type Registry = { entity_id: string; platform?: string; disabled_by?: string | null; device_id?: string | null };

/** A monitor to show: its status sensor and its companions' ids. */
type Row = { id: string; ids: string[] };

/**
 * The monitors: the chosen status sensors, or — with none chosen — every
 * Uptime Kuma monitor in the house. Sorted with the trouble first.
 */
export function useMonitors(
  chosen: () => string[],
  /* The room board passes false: it shows a room's own monitors, and a room
     with none should show none rather than every one in the house — except
     its server room, which passes a function saying when it wants them all. */
  options: { auto?: boolean | (() => boolean) } = {},
): () => Monitor[] {
  const domains = useDomains();
  const auto = () =>
    typeof options.auto === "function" ? options.auto() : options.auto !== false;

  /* With none chosen, every monitor is shown, and a house can have a
     hundred and fifty and more, each with its status and three or four
     companions. Made all at once, while mounting or in one step after it,
     that went over what the sealed engine of Dash 1.5 lets a widget do in one
     step, and the widget was stopped. So they are looked for after the first
     paint, found in the entity registry (Uptime Kuma's entities, by device)
     rather than by reading every *_status sensor, and taken in BATCH at a
     time. Each monitor reads only its own sensors and is made again only
     when one of them changes. Chosen monitors are few and come at once. */
  const trickle = useTrickle(DISCOVER_AFTER_MS, BATCH, BATCH_PAUSE_MS);

  const plan = createMemo((): Row[] => {
    const picked = chosen();
    if (picked.length) return chosenRows(picked, domains().sensor ?? []);
    if (!auto() || !trickle.started()) return [];
    return discoveredRows(Object.values(state.entityRegistry ?? {}) as Registry[]);
  });
  const visible = createMemo(() => (chosen().length ? plan() : trickle.take(plan())));

  /* Uptime Kuma reports every monitor's response time at each poll, a
     hundred and more readings at a time. Each changes one monitor below;
     the list, its groups and summaries are put together again at most once
     a second, so a poll is one piece of work for the view, not one per
     monitor. Each monitor asks for that itself, so a reading costs the same
     however many monitors there are. */
  const [tick, setTick] = createSignal(0);
  let waiting: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(waiting));
  const redraw = () => {
    waiting ??= setTimeout(() => {
      waiting = undefined;
      setTick((n) => n + 1);
    }, REDRAW_MS);
  };

  const made = mapArray(visible, (row) => {
    const entities = useEntities(() => row.ids);
    const monitor = createMemo(() => monitorFrom(row, entities()));
    createEffect(on(monitor, redraw, { defer: true }));
    return monitor;
  });
  /* Monitors taken in or let go. */
  createEffect(on(made, redraw, { defer: true }));

  return createMemo(() => {
    tick();
    return untrack(made)
      .map((one) => untrack(one))
      .filter((one): one is Ordered => one !== undefined)
      .sort((a, b) => RANK[a.monitor.status] - RANK[b.monitor.status] || byOrder(a.order, b.order))
      .map((one) => one.monitor);
  });
}

/** Every monitor Uptime Kuma's integration made: its entities by device,
    the status sensor being the monitor. */
function discoveredRows(entries: Registry[]): Row[] {
  const byDevice = new Map<string, Row>();
  for (const entry of entries) {
    if (entry.platform !== "uptime_kuma" || entry.disabled_by || !entry.device_id) continue;
    const id = entry.entity_id;
    if (!id.startsWith("sensor.")) continue;
    const isStatus = id.endsWith("_status");
    if (!isStatus && monitorOf(id) === undefined) continue;
    let row = byDevice.get(entry.device_id);
    if (!row) {
      row = { id: "", ids: [] };
      byDevice.set(entry.device_id, row);
    }
    if (isStatus && !row.id) row.id = id;
    row.ids.push(id);
  }
  return [...byDevice.values()].filter((row) => row.id).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The chosen status sensors, each with the companions named after it. */
function chosenRows(picked: string[], sensors: string[]): Row[] {
  const rows = new Map(picked.map((id) => [slugOf(id), { id, ids: [id] } as Row]));
  for (const id of sensors) {
    const base = monitorOf(id);
    if (base !== undefined) rows.get(base)?.ids.push(id);
  }
  return [...rows.values()];
}

type Ordered = { monitor: Monitor; order: string };

/** Two sort keys in code-point order: cheaper than localeCompare, which a
    list of a hundred and more monitors called on every redraw. */
function byOrder(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** A monitor from its status sensor and its companions. */
function monitorFrom(row: Row, entities: EntityView[]): Ordered | undefined {
  const entity = entities.find((one) => one.id === row.id);
  if (!entity) return undefined;
  /* Matched on the device as well as the name, where there is a device:
     "nas_status" must not take "nas_backup_response_time". */
  const mine = entities.filter(
    (other) => other !== entity && (!entity.deviceId || !other.deviceId || other.deviceId === entity.deviceId),
  );
  const response = mine.find((other) => /response_?time/.test(other.id) || other.unitOfMeasurement === "ms");
  const cert = mine.find((other) => /cert/.test(other.id));
  const url = mine.find((other) => /_url$|monitored_url/.test(other.id));
  const tagged = mine.find((other) => other.id.endsWith("_tags"));
  const tags = tagged?.attributes?.tags;
  const name = nameOf(entity);
  return {
    order: name.toLowerCase(),
    monitor: {
      id: entity.id,
      name,
      status: statusOf(entity),
      responseMs: numeric(response),
      responseId: response?.id,
      certDays: numeric(cert),
      url: url && /^https?:\/\//.test(url.state) ? url.state : undefined,
      tags: Array.isArray(tags) ? tags.map(String) : undefined,
      since: entity.lastChanged,
    },
  };
}

export type Summary = {
  total: number;
  up: number;
  down: number;
  pending: number;
  maintenance: number;
  /** The one word for all of them. */
  verdict: "up" | "down" | "pending" | "maintenance" | "none";
  /** Mean response time of the monitors that report one. */
  avgMs?: number;
};

export function summarise(monitors: Monitor[]): Summary {
  const count = (status: Status) => monitors.filter((m) => m.status === status).length;
  const down = count("down");
  const pending = count("pending");
  const maintenance = count("maintenance");
  const times = monitors.map((m) => m.responseMs).filter((v): v is number => v !== undefined);
  return {
    total: monitors.length,
    up: count("up"),
    down,
    pending,
    maintenance,
    verdict: verdictOf(monitors.length, down, pending, maintenance),
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : undefined,
  };
}

/** The one word for all of them: the worst state any is in. */
function verdictOf(total: number, down: number, pending: number, maintenance: number): Summary["verdict"] {
  if (!total) return "none";
  if (down) return "down";
  if (pending) return "pending";
  if (maintenance) return "maintenance";
  return "up";
}

/** The headline: "All up", "2 down", "1 pending". */
export function headline(summary: Summary): string {
  if (summary.verdict === "none") return "No monitors";
  if (summary.verdict === "down") return `${summary.down} down`;
  if (summary.verdict === "pending") return `${summary.pending} pending`;
  if (summary.verdict === "maintenance") return `${summary.maintenance} in maintenance`;
  return "All systems up";
}

export const STATUS_LABEL: Record<Status, string> = {
  up: "Up",
  down: "Down",
  pending: "Pending",
  maintenance: "Maintenance",
  unknown: "Unknown",
};

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** "3 min", "2 h", "4 d" since a moment. */
export function sinceLabel(date: Date | undefined): string {
  if (!date) return "";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/**
 * A group of monitors, as set up in the widget's settings: Home Assistant's
 * Uptime Kuma integration makes each monitor a device of its own and says
 * nothing of the groups in Uptime Kuma, so the widget keeps its own.
 */
export type Group = {
  name: string;
  icon: string;
  /** Its colour on the card: its icon's tile. */
  hue: string;
  monitors: Monitor[];
};

/**
 * An icon and a colour for a group, from what its name says it holds —
 * "Docker", "Proxmox", "Media", "Database" — so the groups the tags make
 * look like what they are without being set up. A name that says nothing
 * known gets a colour of its own, the same each time.
 */
const LOOKS: [RegExp, string, string][] = [
  [/docker|container|compose|portainer/i, "mdi:docker", "#2496ed"],
  [/proxmox|pve|hypervisor/i, "mdi:server", "#e57000"],
  [/lxc/i, "mdi:cube-outline", "#14b8a6"],
  [/\bvms?\b|virtual/i, "mdi:monitor-multiple", "#6366f1"],
  [/server|host|node|nas|storage/i, "mdi:server-network", "#64748b"],
  [/data ?base|\bdb\b|sql|postgres|maria|mongo|redis/i, "mdi:database", "#8b5cf6"],
  [/media|plex|jellyfin|emby|arr\b|stream|music|video/i, "mdi:play-circle", "#ec4899"],
  [/web|site|http|public|proxy|nginx|traefik/i, "mdi:web", "#0ea5e9"],
  [/network|net\b|dns|router|vpn|wifi|lan/i, "mdi:lan", "#06b6d4"],
  [/home|smart|iot|zigbee|automation|assistant/i, "mdi:home-automation", "#22c55e"],
  [/backup|sync/i, "mdi:backup-restore", "#f59e0b"],
  [/mail|smtp|imap/i, "mdi:email-outline", "#f97316"],
  [/auth|security|sso|vault|password/i, "mdi:shield-check-outline", "#10b981"],
  [/monitor|metric|grafana|log/i, "mdi:chart-line", "#a855f7"],
  [/cloud/i, "mdi:cloud-outline", "#38bdf8"],
  [/game/i, "mdi:gamepad-variant-outline", "#ef4444"],
  [/system|core|infra/i, "mdi:cog-outline", "#475569"],
  [/apps?\b|service/i, "mdi:apps", "#3b82f6"],
];
const PALETTE = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#0ea5e9", "#6366f1", "#eab308"];

export function groupLook(name: string): { icon: string; hue: string } {
  const known = LOOKS.find(([pattern]) => pattern.test(name));
  if (known) return { icon: known[1], hue: known[2] };
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return { icon: "mdi:folder-outline", hue: PALETTE[hash % PALETTE.length]! };
}

export type GroupConfig = { name?: string; icon?: string; monitors?: string[] };

/**
 * The groups, in the order they were set up, each with its monitors (the
 * trouble first, as the list is sorted). A monitor may sit in more than one;
 * those in none are gathered at the end as "Other".
 */
export function groupMonitors(monitors: Monitor[], defs: GroupConfig[]): Group[] {
  if (!defs.length) return [];
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const placed = new Set<string>();
  const groups = defs.map((def, index): Group => {
    const ids = new Set(def.monitors ?? []);
    const members = monitors.filter((m) => ids.has(m.id));
    for (const id of ids) if (byId.has(id)) placed.add(id);
    const name = def.name?.trim() || `Group ${index + 1}`;
    const look = groupLook(name);
    /* The settings' own default icon stands for "none chosen". */
    const chosen = def.icon && def.icon !== "mdi:folder-outline" ? def.icon : undefined;
    return { name, icon: chosen ?? look.icon, hue: look.hue, monitors: members };
  });
  const rest = monitors.filter((m) => !placed.has(m.id));
  if (rest.length) groups.push({ name: "Other", icon: "mdi:dots-horizontal", hue: "#71717a", monitors: rest });
  return groups;
}

/**
 * Groups found by themselves, from the monitors' Uptime Kuma tags: one
 * group per tag, in alphabetical order, a monitor in each of its tags.
 *
 * Home Assistant's integration reads Uptime Kuma's metrics, which carry a
 * monitor's tags but not the group monitor it sits under — so tags are what
 * there is to go by. A tag "Media" is the group Media; a tag with a value is
 * grouped by its name ("env:prod" under env), except a tag called "group",
 * whose value is the group ("group:Media" under Media). The metrics allow
 * only letters, digits and underscores in a tag's name, so underscores are
 * read as spaces.
 */
export function tagGroups(monitors: Monitor[]): GroupConfig[] {
  const groups = new Map<string, Set<string>>();
  for (const monitor of monitors) {
    for (const name of (monitor.tags ?? []).map(groupOfTag).filter(Boolean)) {
      const ids = groups.get(name) ?? new Set<string>();
      ids.add(monitor.id);
      groups.set(name, ids);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ids]) => ({ name, monitors: [...ids] }));
}

/** The group a tag puts its monitor in: "Media" → Media, "env:prod" → env,
    "group:Media" → Media; underscores read as spaces. Empty for none. */
function groupOfTag(tag: string): string {
  const at = tag.indexOf(":");
  const key = at < 0 ? tag : tag.slice(0, at);
  const value = at < 0 ? "" : tag.slice(at + 1);
  const name = key.toLowerCase() === "group" && value ? value : key;
  return name.replaceAll("_", " ").trim();
}

/** A group's line under its name: what is wrong, or that all is well. */
export function groupNote(group: Group): string {
  const s = summarise(group.monitors);
  if (s.verdict === "none") return "No monitors";
  const trouble = group.monitors.filter((m) => m.status === s.verdict).map((m) => m.name);
  /* Ping and LXC monitors report 0 ms: no time worth showing. */
  if (s.verdict === "up") return s.avgMs ? `All up · ${formatMs(s.avgMs)}` : "All up";
  const COUNT = { down: s.down, pending: s.pending, maintenance: s.maintenance };
  const count = COUNT[s.verdict];
  const word = s.verdict === "maintenance" ? "in maintenance" : s.verdict;
  return `${count} ${word} · ${trouble.join(", ")}`;
}
