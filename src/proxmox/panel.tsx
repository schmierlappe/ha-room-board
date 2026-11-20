import { Index, Show, createMemo, createSignal } from "solid-js";
import { Icon, useService } from "@glasshome/widget-sdk";
import { Gauge } from "../unifi/gauge";
import {
  KIND_ICON,
  STATUS_LABEL,
  formatBytes,
  upFor,
  clusterTitle,
  toneOf,
  type Cluster,
  type Guest,
  type GuestAction,
  type ProxNode,
} from "./model";

/**
 * The popup, in three parts:
 * - a header card for the whole: Proxmox's mark in its glow, what is online
 *   and running, and the VMs, containers and nodes as large counts;
 * - the nodes, a tile each: its state and uptime, a waiting update and the
 *   last backup as badges, CPU, memory and disk as small gauges, its storage
 *   as bars;
 * - every guest, with tabs for the VMs, the containers and what is stopped,
 *   a search, and each one's controls: start what is stopped, shut down or
 *   restart what runs.
 */
export function ProxmoxPanel(props: { cluster: Cluster }) {
  type Tab = "all" | "vm" | "lxc" | "stopped";
  const [tab, setTab] = createSignal<Tab>("all");
  const [query, setQuery] = createSignal("");

  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    return props.cluster.guests.filter((g) => {
      if (tab() === "vm" && g.kind !== "vm") return false;
      if (tab() === "lxc" && g.kind !== "lxc") return false;
      if (tab() === "stopped" && g.status === "running") return false;
      return !q || g.name.toLowerCase().includes(q);
    });
  });
  /* Which guests each tab holds. */
  const IN_TAB: Record<Tab, (g: Guest) => boolean> = {
    all: () => true,
    vm: (g) => g.kind === "vm",
    lxc: (g) => g.kind === "lxc",
    stopped: (g) => g.status !== "running",
  };
  const count = (t: Tab) => props.cluster.guests.filter(IN_TAB[t]).length;
  const TABS: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "vm", label: "VMs" },
    { id: "lxc", label: "Containers" },
    { id: "stopped", label: "Stopped" },
  ];
  const nodeName = (id: string | undefined) =>
    props.cluster.nodes.length > 1 ? props.cluster.nodes.find((n) => n.id === id)?.name : undefined;

  return (
    <div class="px-panel">
      <Show
        when={props.cluster.nodes.length || props.cluster.guests.length}
        fallback={
          <p class="px-empty">
            No Proxmox found. Add Home Assistant's Proxmox VE integration (Settings → Devices &
            services); its nodes, VMs and containers then show up here by themselves.
          </p>
        }
      >
        <Hero cluster={props.cluster} />

        <Show when={props.cluster.nodes.length}>
          <section class="px-section">
            <span class="px-section-title">{props.cluster.nodes.length > 1 ? "Nodes" : "Node"}</span>
            <div class="px-node-grid">
              <Index each={props.cluster.nodes}>
                {(node) => (
                  <NodeCard
                    node={node()}
                    storages={props.cluster.storages.filter((s) => !s.node || s.node === node().id)}
                  />
                )}
              </Index>
            </div>
          </section>
        </Show>

        <Show when={props.cluster.guests.length}>
          <span class="px-section-title">Guests</span>
          <div class="px-tabs" role="tablist">
            <Index each={TABS.filter((t) => t.id === "all" || count(t.id) > 0)}>
              {(t) => (
                <button type="button" class="px-tab" role="tab" aria-selected={tab() === t().id} onClick={() => setTab(t().id)}>
                  {t().label}
                  <em>{count(t().id)}</em>
                </button>
              )}
            </Index>
          </div>

          <Show when={props.cluster.guests.length > 6}>
            <label class="px-search">
              <Icon icon="mdi:magnify" width="18" />
              <input
                type="search"
                placeholder={`Search ${props.cluster.guests.length} guests`}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </Show>

          <Show when={shown().length} fallback={<p class="px-empty">Nothing matches.</p>}>
            <div class="px-list">
              <Index each={shown()}>{(guest) => <GuestRow guest={guest()} nodeName={nodeName(guest().node)} />}</Index>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** The whole at a glance: what is online and running, and three counts. */
function Hero(props: { cluster: Cluster }) {
  const online = () => props.cluster.nodes.filter((n) => n.online !== false).length;
  const of = (kind: "vm" | "lxc") => {
    const list = props.cluster.guests.filter((g) => g.kind === kind);
    return { running: list.filter((g) => g.status === "running").length, total: list.length };
  };
  const running = () => props.cluster.guests.filter((g) => g.status === "running").length;
  const down = () => props.cluster.nodes.length > 0 && online() < props.cluster.nodes.length;
  const title = () => clusterTitle(props.cluster.nodes);
  /* The nodes' line: how many are offline, else that all are online. */
  const nodesLine = () => {
    const total = props.cluster.nodes.length;
    if (down()) return `${total - online()} of ${total} nodes offline`;
    return total > 1 ? `All ${total} nodes online` : "Online";
  };
  return (
    <header class="px-hero" data-down={down()}>
      <div class="px-hero-top">
        <span class="px-mark">
          <Icon icon="mdi:server" width="24" />
        </span>
        <div class="px-hero-titles">
          <span class="px-hero-kicker">Proxmox VE</span>
          <h3 class="px-truncate">{title()}</h3>
          <span>
            {nodesLine()}
            {" · "}
            {running()} of {props.cluster.guests.length} running
          </span>
        </div>
      </div>
      <div class="px-hero-stats">
        <span class="px-hero-stat" data-kind="vm">
          <Icon icon={KIND_ICON.vm} width="16" />
          <b>
            {of("vm").running}
            <i>/{of("vm").total}</i>
          </b>
          <span>VMs</span>
        </span>
        <span class="px-hero-stat" data-kind="lxc">
          <Icon icon={KIND_ICON.lxc} width="16" />
          <b>
            {of("lxc").running}
            <i>/{of("lxc").total}</i>
          </b>
          <span>Containers</span>
        </span>
        <span class="px-hero-stat" data-kind="node">
          <Icon icon="mdi:server" width="16" />
          <b>
            {online()}
            <i>/{props.cluster.nodes.length}</i>
          </b>
          <span>Nodes</span>
        </span>
      </div>
    </header>
  );
}

function NodeCard(props: { node: ProxNode; storages: Cluster["storages"] }) {
  const off = () => props.node.online === false;
  return (
    <section class="px-node" data-off={off()}>
      <div class="px-node-head">
        <i class="px-dot" data-status={off() ? "stopped" : "running"} />
        <div class="px-node-titles">
          <b class="px-truncate">{props.node.name}</b>
          <span>
            {off() ? "Offline" : "Online"}
            <Show when={!off() && props.node.upSince}> · up {upFor(props.node.upSince)}</Show>
            <Show when={props.node.memoryMax}> · {formatBytes(props.node.memoryMax)}</Show>
          </span>
        </div>
      </div>

      <div class="px-chips">
        <Show when={props.node.update}>
          <span class="px-chip" data-tone="accent">
            <Icon icon="mdi:arrow-up-circle" width="14" />Update
          </span>
        </Show>
        <Show when={props.node.backupOk !== undefined}>
          <span class="px-chip" data-tone={props.node.backupOk ? "ok" : "bad"}>
            <Icon icon={props.node.backupOk ? "mdi:backup-restore" : "mdi:alert-circle-outline"} width="14" />
            {props.node.backupOk ? "Backup" : "Backup failed"}
            <Show when={props.node.lastBackup}> · {upFor(props.node.lastBackup)}</Show>
          </span>
        </Show>
      </div>

      <div class="px-gauges">
        <Show when={props.node.cpu !== undefined}>
          <Gauge label="CPU" value={props.node.cpu!} unit="%" warn={70} alarm={88} hue="blue" />
        </Show>
        <Show when={props.node.memory !== undefined}>
          <Gauge label="RAM" value={props.node.memory!} unit="%" warn={80} alarm={92} hue="violet" />
        </Show>
        <Show when={props.node.disk !== undefined}>
          <Gauge label="Disk" value={props.node.disk!} unit="%" warn={80} alarm={92} hue="teal" />
        </Show>
      </div>

      <Show when={props.storages.length}>
        <div class="px-storage">
          <Index each={props.storages}>
            {(store) => (
              <div class="px-store">
                <span>
                  <b class="px-truncate">{store().name}</b>
                  <Show when={store().used !== undefined}>{Math.round(store().used!)} %</Show>
                </span>
                <span class="px-bar">
                  <i style={{ width: `${Math.min(100, store().used ?? 0)}%` }} />
                </span>
              </div>
            )}
          </Index>
        </div>
      </Show>
    </section>
  );
}

const tone = toneOf;

export function GuestRow(props: { guest: Guest; nodeName?: string }) {
  const { callService } = useService();
  const [busy, setBusy] = createSignal(false);
  const press = async (action: GuestAction) => {
    const id = props.guest.buttons[action];
    if (!id || busy()) return;
    setBusy(true);
    try {
      await callService("button", "press", {}, { entity_id: id });
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  };
  const running = () => props.guest.status === "running";
  /* The first of these the guest has a button for. */
  const firstButton = (actions: GuestAction[]) => actions.find((action) => props.guest.buttons[action]);
  const off = () => firstButton(["shutdown", "stop"]);
  const restart = () => firstButton(["restart", "reboot"]);

  return (
    <div class="px-row" data-status={props.guest.status}>
      <span class="px-kind" data-kind={props.guest.kind}>
        <Icon icon={KIND_ICON[props.guest.kind]} width="16" />
      </span>
      <span class="px-row-text">
        <b class="px-truncate">{props.guest.name}</b>
        <span>
          <i class="px-dot" data-status={props.guest.status} />
          {STATUS_LABEL[props.guest.status]}
          <Show when={running() && props.guest.upSince}> · {upFor(props.guest.upSince)}</Show>
          <Show when={props.nodeName}> · {props.nodeName}</Show>
          <Show when={props.guest.memoryMax}> · {formatBytes(props.guest.memoryMax)}</Show>
        </span>
      </span>

      <Show when={running()}>
        <span class="px-row-meters">
          <span>
            <em>CPU</em>
            <span class="px-bar" data-tone={tone(props.guest.cpu, 70, 88)}>
              <i style={{ width: `${Math.min(100, props.guest.cpu ?? 0)}%` }} />
            </span>
            <b>{Math.round(props.guest.cpu ?? 0)}%</b>
          </span>
          <span>
            <em>RAM</em>
            <span class="px-bar" data-what="mem" data-tone={tone(props.guest.memory, 85, 95)}>
              <i style={{ width: `${Math.min(100, props.guest.memory ?? 0)}%` }} />
            </span>
            <b>{Math.round(props.guest.memory ?? 0)}%</b>
          </span>
        </span>
      </Show>

      <span class="px-actions">
        <Show
          when={running()}
          fallback={
            <Show when={props.guest.buttons.start}>
              <button type="button" class="px-act" data-act="start" title="Start" disabled={busy()} onClick={() => press("start")}>
                <Icon icon="mdi:play" width="17" />
              </button>
            </Show>
          }
        >
          <Show when={restart()}>
            <button type="button" class="px-act" data-act="restart" title="Restart" disabled={busy()} onClick={() => press(restart()!)}>
              <Icon icon="mdi:restart" width="16" />
            </button>
          </Show>
          <Show when={off()}>
            <button type="button" class="px-act" data-act={off()} title="Shut down" disabled={busy()} onClick={() => press(off()!)}>
              <Icon icon="mdi:power" width="16" />
            </button>
          </Show>
        </Show>
      </span>
    </div>
  );
}
