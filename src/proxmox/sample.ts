import type { Cluster, Guest } from "./model";

/**
 * A representative cluster for the widget gallery only.
 *
 * The preview harness and the Hub's render worker run against a fixed demo
 * home with no Proxmox in it. This is opted into by `sampleData` in
 * `manifest.examples[].config`, which is deliberately absent from
 * `configSchema`: the settings form can't offer it, so it can never stand in
 * for a real user's missing cluster.
 */
export function sampleCluster(): Cluster {
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3600e3);
  const guest = (
    id: string,
    name: string,
    kind: Guest["kind"],
    cpu: number,
    memory: number,
    node: string,
    status: Guest["status"] = "running",
  ): Guest => ({
    id,
    name,
    kind,
    status,
    cpu: status === "running" ? cpu : undefined,
    memory: status === "running" ? memory : undefined,
    memoryMax: (kind === "vm" ? 8 : 2) * 1024 ** 3,
    upSince: status === "running" ? ago(70 + cpu * 3) : undefined,
    buttons: {},
    node,
  });
  return {
    nodes: [
      { id: "pve-01", name: "pve-01", online: true, cpu: 18, memory: 62, memoryMax: 64 * 1024 ** 3, disk: 41, upSince: ago(24 * 23), update: true, backupOk: true, lastBackup: ago(6), buttons: {} },
      { id: "pve-02", name: "pve-02", online: true, cpu: 34, memory: 48, memoryMax: 32 * 1024 ** 3, disk: 57, upSince: ago(24 * 9), update: false, backupOk: true, lastBackup: ago(6), buttons: {} },
    ],
    guests: [
      guest("g1", "Home Assistant", "vm", 6, 41, "pve-01"),
      guest("g2", "Docker", "vm", 23, 72, "pve-01"),
      guest("g3", "TrueNAS", "vm", 11, 86, "pve-02"),
      guest("g4", "Plex", "lxc", 31, 38, "pve-02"),
      guest("g5", "Pi-hole", "lxc", 1, 22, "pve-01"),
      guest("g6", "Nginx Proxy", "lxc", 2, 17, "pve-01"),
      guest("g7", "Vaultwarden", "lxc", 1, 12, "pve-02"),
      guest("g8", "Windows 11", "vm", 0, 0, "pve-02", "stopped"),
      guest("g9", "Test", "lxc", 0, 0, "pve-01", "stopped"),
    ],
    storages: [
      { id: "s1", name: "local-lvm", used: 46, node: "pve-01" },
      { id: "s2", name: "tank", used: 71, node: "pve-02" },
    ],
  };
}
