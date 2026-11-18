import type { Monitor } from "./model";

/**
 * Representative monitors for the widget gallery only.
 *
 * The preview harness and the Hub's render worker run against a fixed demo
 * home with no Uptime Kuma in it, so the gallery would show "No monitors".
 * This is opted into by `sampleData` in `manifest.examples[].config`, which
 * is deliberately absent from `configSchema`: the settings form can't offer
 * it, so it can never stand in for a real user's missing monitors.
 *
 * The ids start with SAMPLE_PREFIX, which the heartbeat draws as a made-up
 * day (see sampleBeats) rather than looking up a history that isn't there.
 */
export const SAMPLE_PREFIX = "sample.";

const PLAN: [string, string, number, Monitor["status"]?][] = [
  ["Apps", "Nextcloud", 48],
  ["Apps", "Vaultwarden", 21],
  ["Apps", "Paperless", 36],
  ["Apps", "Immich", 52],
  ["Docker", "Portainer", 12],
  ["Docker", "Traefik", 6],
  ["Docker", "Watchtower", 0, "down"],
  ["Media", "Plex", 31],
  ["Media", "Jellyfin", 27],
  ["Media", "Sonarr", 18, "pending"],
  ["Media", "Radarr", 17],
  ["Proxmox", "pve-01", 3],
  ["Proxmox", "pve-02", 4],
  ["Proxmox", "pve-03", 3, "maintenance"],
  ["Database", "PostgreSQL", 2],
  ["Database", "Redis", 1],
  ["Web", "Homepage", 88],
  ["Web", "Blog", 140],
  ["Network", "Pi-hole", 9],
  ["Network", "WireGuard", 14],
];

/** Down first, then the waiting, then maintenance, then what is up — as
    the real list is sorted. */
const RANK: Record<Monitor["status"], number> = { down: 0, pending: 1, unknown: 2, maintenance: 3, up: 4 };

export function sampleMonitors(): Monitor[] {
  const since = new Date(Date.now() - 5 * 3600e3);
  const monitors = PLAN.map(([tag, name, ms, status]): Monitor => ({
    id: `${SAMPLE_PREFIX}${name.toLowerCase().replaceAll(/\W+/g, "_")}`,
    name,
    status: status ?? "up",
    responseMs: ms || undefined,
    certDays: tag === "Web" ? 61 : undefined,
    tags: [tag],
    since,
  }));
  monitors.sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
  return monitors;
}

/** A made-up day of states for a sample monitor: mostly up, the trouble
    at the end for those in trouble now, a blip earlier for a few. */
export function sampleTimeline(id: string, now: number): { timestamp: number; state: string }[] {
  const name = id.slice(SAMPLE_PREFIX.length);
  const status = PLAN.find(([, n]) => n.toLowerCase().replaceAll(/\W+/g, "_") === name)?.[3];
  const points = [{ timestamp: now - 86400, state: "up" }];
  if (name === "plex" || name === "blog") {
    points.push({ timestamp: now - 52000, state: "down" }, { timestamp: now - 49000, state: "up" });
  }
  if (status) points.push({ timestamp: now - (status === "maintenance" ? 7200 : 2400), state: status });
  return points;
}
