import { For, Index, Show, createMemo, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { GuestRow } from "../proxmox/panel";
import {
  KIND_ICON,
  clusterTitle,
  formatBytes,
  upFor,
  type Cluster,
  type Guest,
  type ProxNode,
} from "../proxmox/model";
import { unifiVars } from "../unifi/styles";
import { openable } from "./util";
import { Half } from "./half";

/**
 * Proxmox on the board: its own card and overlay, drawn from the Proxmox
 * widget's model (src/proxmox/model.ts) in the board's look.
 *
 * The card answers "is the rack all right?" before anything else: a health
 * pill, the cluster's CPU and memory as two rings, how much of it is running,
 * and a tile per node with two load bars — the nodes that need a look in
 * amber or red. The overlay is the same story told in full: the cluster, a
 * card per node (tap one to see only its guests), and every guest with its
 * controls.
 */

/* When a reading needs a look: amber, then red. */
const CPU = { warn: 70, alarm: 88 };
const MEM = { warn: 80, alarm: 92 };
const DISK = { warn: 80, alarm: 92 };

const level = (value: number | undefined, at: { warn: number; alarm: number }) =>
  value === undefined ? "" : value >= at.alarm ? "alarm" : value >= at.warn ? "warn" : "";

/** The worst of a node's readings, for its tile's edge. */
const nodeLevel = (node: ProxNode) => {
  if (node.online === false) return "off";
  const all = [level(node.cpu, CPU), level(node.memory, MEM), level(node.disk, DISK)];
  return all.includes("alarm") ? "alarm" : all.includes("warn") ? "warn" : "";
};

/** The cluster summed up: CPU averaged, memory weighted by each node's size. */
function totals(cluster: Cluster) {
  const up = cluster.nodes.filter((n) => n.online !== false);
  const cpu = up.filter((n) => n.cpu !== undefined);
  const sized = up.filter((n) => n.memory !== undefined);
  const weight = (n: ProxNode) => n.memoryMax ?? 1;
  const running = cluster.guests.filter((g) => g.status === "running").length;
  const of = (kind: "vm" | "lxc") => {
    const list = cluster.guests.filter((g) => g.kind === kind);
    return { running: list.filter((g) => g.status === "running").length, total: list.length };
  };
  return {
    online: up.length,
    nodes: cluster.nodes.length,
    cpu: cpu.length ? cpu.reduce((a, n) => a + n.cpu!, 0) / cpu.length : undefined,
    memory: sized.length
      ? sized.reduce((a, n) => a + n.memory! * weight(n), 0) / sized.reduce((a, n) => a + weight(n), 0)
      : undefined,
    running,
    guests: cluster.guests.length,
    vm: of("vm"),
    lxc: of("lxc"),
  };
}

/** What the pill at the top says, and in which colour. */
function health(cluster: Cluster) {
  const offline = cluster.nodes.filter((n) => n.online === false).length;
  if (offline) return { tone: "alarm", icon: "mdi:server-off", text: `${offline} offline` };
  const hot = cluster.nodes.filter((n) => nodeLevel(n) === "alarm" || nodeLevel(n) === "warn").length;
  const stopped = cluster.guests.filter((g) => g.status !== "running").length;
  if (hot) return { tone: "warn", icon: "mdi:fire", text: `${hot} busy` };
  if (stopped) return { tone: "calm", icon: "mdi:pause-circle-outline", text: `${stopped} stopped` };
  return { tone: "ok", icon: "mdi:check-circle", text: "All good" };
}

/** A ring for a share: the value in the middle, the label under it. */
function Ring(props: { value?: number; label: string; hue: "cpu" | "mem"; at: { warn: number; alarm: number } }) {
  const r = 15.9155; // a circumference of 100
  return (
    <span class="pxb-ring" data-hue={props.hue} data-level={level(props.value, props.at)}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle class="pxb-ring-track" cx="18" cy="18" r={r} />
        <circle
          class="pxb-ring-arc"
          cx="18"
          cy="18"
          r={r}
          stroke-dasharray={`${Math.max(0, Math.min(100, props.value ?? 0))} 100`}
        />
      </svg>
      <b>
        {props.value === undefined ? "–" : Math.round(props.value)}
        <i>%</i>
      </b>
      <small>{props.label}</small>
    </span>
  );
}

/** A slim bar for a share, in its reading's colour until it needs a look. */
function Bar(props: { value?: number; hue: "cpu" | "mem" | "disk"; at: { warn: number; alarm: number } }) {
  return (
    <span class="pxb-bar" data-hue={props.hue} data-level={level(props.value, props.at)}>
      <i style={{ width: `${Math.max(0, Math.min(100, props.value ?? 0))}%` }} />
    </span>
  );
}

/* ---------- the card ---------- */

export function ProxmoxCard(props: { cluster: Cluster; onOpen: () => void }) {
  const sum = createMemo(() => totals(props.cluster));
  const state = createMemo(() => health(props.cluster));
  /* The ones that need a look first, then by name: on a card that cannot
     hold every node, the ones it drops are the quiet ones. */
  const nodes = createMemo(() => {
    const rank = (n: ProxNode) => ({ off: 0, alarm: 1, warn: 2, "": 3 })[nodeLevel(n)] ?? 3;
    return [...props.cluster.nodes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  });

  return (
    <article class="rb-card rb-card--proxmox pxb-card" {...openable(props.onOpen, "Proxmox")}>
      <div class="pxb" data-state={state().tone} data-nodes={Math.min(nodes().length, 12)}>
        <header class="pxb-head">
          <span class="pxb-mark">
            <Icon icon="mdi:server" width="16" />
          </span>
          <span class="pxb-titles">
            <small>Proxmox</small>
            <b class="rb-truncate">{clusterTitle(props.cluster.nodes)}</b>
          </span>
          <span class="pxb-pill" data-tone={state().tone}>
            <Icon icon={state().icon} width="13" />
            <span>{state().text}</span>
          </span>
        </header>

        <div class="pxb-summary">
          <Ring value={sum().cpu} label="CPU" hue="cpu" at={CPU} />
          <Ring value={sum().memory} label="RAM" hue="mem" at={MEM} />
          <span class="pxb-counts">
            <span>
              <b>
                {sum().running}
                <i>/{sum().guests}</i>
              </b>
              <small>running</small>
            </span>
            <span class="pxb-kinds">
              <span title="Virtual machines">
                <Icon icon={KIND_ICON.vm} width="12" />
                {sum().vm.running}
              </span>
              <span title="Containers">
                <Icon icon={KIND_ICON.lxc} width="12" />
                {sum().lxc.running}
              </span>
              <span title="Nodes online">
                <Icon icon="mdi:server" width="12" />
                {sum().online}/{sum().nodes}
              </span>
            </span>
          </span>
        </div>

        {/* A card too small for the tiles: a dot a node, coloured by how it is. */}
        <Show when={nodes().length > 1}>
          <div class="pxb-dots" aria-hidden="true">
            <For each={nodes()}>{(node) => <i class="pxb-dot" data-level={nodeLevel(node)} title={node.name} />}</For>
            <span>
              {sum().running}/{sum().guests} running
            </span>
          </div>
        </Show>

        <Show when={nodes().length > 1}>
          <div class="pxb-nodes">
            <For each={nodes()}>
              {(node) => (
                <span class="pxb-node" data-level={nodeLevel(node)} title={node.name}>
                  <span class="pxb-node-top">
                    <i class="pxb-dot" />
                    <b class="rb-truncate">{node.name}</b>
                    <em data-level={level(node.memory, MEM)} title="Memory in use">
                      {node.online === false ? "off" : node.memory === undefined ? "" : `${Math.round(node.memory)}%`}
                    </em>
                  </span>
                  <Bar value={node.cpu} hue="cpu" at={CPU} />
                  <Bar value={node.memory} hue="mem" at={MEM} />
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Half icon="mdi:server" name={clusterTitle(props.cluster.nodes)} status={state().text} tone="#e57000" lit={state().tone !== "ok"} value={`${sum().running}/${sum().guests}`} />
    </article>
  );
}

/* ---------- the overlay ---------- */

export function ProxmoxBoardPanel(props: { cluster: Cluster }) {
  const sum = createMemo(() => totals(props.cluster));
  const state = createMemo(() => health(props.cluster));

  type Tab = "all" | "vm" | "lxc" | "stopped";
  const [tab, setTab] = createSignal<Tab>("all");
  const [query, setQuery] = createSignal("");
  /* A node tapped above: its guests only, until tapped again. */
  const [onNode, setOnNode] = createSignal("");

  const IN_TAB: Record<Tab, (g: Guest) => boolean> = {
    all: () => true,
    vm: (g) => g.kind === "vm",
    lxc: (g) => g.kind === "lxc",
    stopped: (g) => g.status !== "running",
  };
  const base = () => props.cluster.guests.filter((g) => !onNode() || g.node === onNode());
  const count = (t: Tab) => base().filter(IN_TAB[t]).length;
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    return base()
      .filter(IN_TAB[tab()])
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || a.name.localeCompare(b.name, undefined, { numeric: true }));
  });
  const nodeName = (id: string | undefined) =>
    props.cluster.nodes.length > 1 ? props.cluster.nodes.find((n) => n.id === id)?.name : undefined;
  const nodes = createMemo(() =>
    [...props.cluster.nodes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  );

  return (
    <div class="pxb-panel" style={unifiVars()}>
      <Show
        when={props.cluster.nodes.length || props.cluster.guests.length}
        fallback={
          <p class="pxb-empty">
            No Proxmox found. Add Home Assistant's Proxmox VE integration (Settings → Devices &
            services); its nodes, VMs and containers then show up here by themselves.
          </p>
        }
      >
        <header class="pxb-hero" data-state={state().tone}>
          <div class="pxb-hero-id">
            <span class="pxb-mark pxb-mark--big">
              <Icon icon="mdi:server" width="24" />
            </span>
            <span class="pxb-titles">
              <small>Proxmox VE</small>
              <b>{clusterTitle(props.cluster.nodes)}</b>
            </span>
            <span class="pxb-pill" data-tone={state().tone}>
              <Icon icon={state().icon} width="14" />
              <span>{state().text}</span>
            </span>
          </div>
          <div class="pxb-hero-stats">
            <Ring value={sum().cpu} label="CPU" hue="cpu" at={CPU} />
            <Ring value={sum().memory} label="RAM" hue="mem" at={MEM} />
            <span class="pxb-stat">
              <Icon icon="mdi:server" width="16" />
              <b>
                {sum().online}
                <i>/{sum().nodes}</i>
              </b>
              <small>Nodes</small>
            </span>
            <span class="pxb-stat">
              <Icon icon={KIND_ICON.vm} width="16" />
              <b>
                {sum().vm.running}
                <i>/{sum().vm.total}</i>
              </b>
              <small>VMs</small>
            </span>
            <span class="pxb-stat">
              <Icon icon={KIND_ICON.lxc} width="16" />
              <b>
                {sum().lxc.running}
                <i>/{sum().lxc.total}</i>
              </b>
              <small>Containers</small>
            </span>
          </div>
        </header>

        <Show when={nodes().length}>
          <section class="pxb-section">
            <h3 class="pxb-section-title">
              {nodes().length > 1 ? "Nodes" : "Node"}
              <Show when={nodes().length > 1}>
                <small>Tap one to see its guests</small>
              </Show>
            </h3>
            <div class="pxb-ncards">
              <Index each={nodes()}>
                {(node) => (
                  <NodeCard
                    node={node()}
                    guests={props.cluster.guests.filter((g) => g.node === node().id)}
                    storages={props.cluster.storages.filter((s) => s.node === node().id)}
                    picked={onNode() === node().id}
                    onPick={() => setOnNode(onNode() === node().id ? "" : node().id)}
                  />
                )}
              </Index>
            </div>
          </section>
        </Show>

        <Show when={props.cluster.guests.length}>
          <section class="pxb-section">
            <h3 class="pxb-section-title">
              Guests
              <Show when={onNode()}>
                <button class="pxb-filter" onClick={() => setOnNode("")}>
                  {nodeName(onNode())}
                  <Icon icon="mdi:close" width="13" />
                </button>
              </Show>
            </h3>
            <div class="pxb-tools">
              <div class="pxb-tabs" role="tablist">
                <For each={(["all", "vm", "lxc", "stopped"] as Tab[]).filter((t) => t === "all" || count(t) > 0)}>
                  {(t) => (
                    <button role="tab" aria-selected={tab() === t} onClick={() => setTab(t)}>
                      {{ all: "All", vm: "VMs", lxc: "Containers", stopped: "Stopped" }[t]}
                      <em>{count(t)}</em>
                    </button>
                  )}
                </For>
              </div>
              <Show when={props.cluster.guests.length > 6}>
                <label class="pxb-search">
                  <Icon icon="mdi:magnify" width="16" />
                  <input
                    type="search"
                    placeholder="Search guests"
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                  />
                </label>
              </Show>
            </div>
            <Show when={shown().length} fallback={<p class="pxb-empty">Nothing matches.</p>}>
              <div class="px-panel pxb-guests">
                <div class="px-list">
                  <Index each={shown()}>{(guest) => <GuestRow guest={guest()} nodeName={onNode() ? undefined : nodeName(guest().node)} />}</Index>
                </div>
              </div>
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  );
}

function NodeCard(props: {
  node: ProxNode;
  guests: Guest[];
  storages: Cluster["storages"];
  picked: boolean;
  onPick: () => void;
}) {
  const off = () => props.node.online === false;
  const running = () => props.guests.filter((g) => g.status === "running").length;
  const meters = () =>
    [
      { name: "CPU", value: props.node.cpu, hue: "cpu" as const, at: CPU },
      { name: "RAM", value: props.node.memory, hue: "mem" as const, at: MEM, note: props.node.memoryMax ? formatBytes(props.node.memoryMax) : "" },
      { name: "Disk", value: props.node.disk, hue: "disk" as const, at: DISK },
    ].filter((m) => m.value !== undefined);
  return (
    <button class="pxb-ncard" data-level={nodeLevel(props.node)} data-picked={props.picked} aria-pressed={props.picked} onClick={props.onPick}>
      <span class="pxb-ncard-head">
        <i class="pxb-dot" />
        <span class="pxb-ncard-titles">
          <b class="rb-truncate">{props.node.name}</b>
          <small>
            {off() ? "Offline" : props.node.upSince ? `Up ${upFor(props.node.upSince)}` : "Online"}
            <Show when={props.guests.length}> · {running()}/{props.guests.length} guests</Show>
          </small>
        </span>
        <Show when={props.node.update}>
          <span class="pxb-tag" data-tone="accent" title="Update waiting">
            <Icon icon="mdi:arrow-up-circle" width="13" />
          </span>
        </Show>
        <Show when={props.node.backupOk === false}>
          <span class="pxb-tag" data-tone="bad" title="Last backup failed">
            <Icon icon="mdi:backup-restore" width="13" />
          </span>
        </Show>
      </span>
      <Show when={!off()}>
        <span class="pxb-meters">
          <For each={meters()}>
            {(m) => (
              <span class="pxb-meter">
                <small>{m.name}</small>
                <Bar value={m.value} hue={m.hue} at={m.at} />
                <b data-level={level(m.value, m.at)}>{Math.round(m.value!)}%</b>
              </span>
            )}
          </For>
        </span>
        <Show when={props.storages.length}>
          <span class="pxb-stores">
            <For each={props.storages}>
              {(store) => (
                <span class="pxb-store" title={store.name}>
                  <Icon icon="mdi:database-outline" width="12" />
                  <span class="rb-truncate">{store.name}</span>
                  <b data-level={level(store.used, DISK)}>{store.used === undefined ? "" : `${Math.round(store.used)}%`}</b>
                </span>
              )}
            </For>
          </span>
        </Show>
      </Show>
    </button>
  );
}
