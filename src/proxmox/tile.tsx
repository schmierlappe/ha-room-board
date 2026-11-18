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
import { unifiVars } from "../unifi/styles";
import {
  KIND_ICON,
  clusterTitle,
  toneOf,
  upFor,
  type Cluster,
  type Guest,
  type ProxNode,
} from "./model";

/* The tile, apart from the widget, so the room board can draw it without
   taking in the whole Proxmox widget: its settings, its dialog and its
   stylesheet text. */

export const tone = toneOf;

/** The readings as figures: what each is, its number large, a hairline of
    how full it is under it. */
function Metrics(props: { node: ProxNode }) {
  const items = () =>
    [
      { label: "CPU", value: props.node.cpu, warn: 70, alarm: 88, hue: "blue" },
      { label: "RAM", value: props.node.memory, warn: 80, alarm: 92, hue: "violet" },
      { label: "Disk", value: props.node.disk, warn: 80, alarm: 92, hue: "teal" },
    ].filter((m) => m.value !== undefined);
  return (
    <div class="px-metrics">
      <Index each={items()}>
        {(m) => (
          <div class="px-metric" data-hue={m().hue} data-tone={tone(m().value, m().warn, m().alarm)}>
            <span class="px-metric-label">{m().label}</span>
            <b class="px-metric-value">
              {Math.round(m().value!)}
              <i>%</i>
            </b>
            <span class="px-metric-line">
              <i style={{ width: `${Math.max(2, Math.min(100, m().value!))}%` }} />
            </span>
          </div>
        )}
      </Index>
    </div>
  );
}

/** A guest as a small tile: its kind, its name, its CPU — or that it is
    stopped, the tile then only outlined. */
function GuestTile(props: { guest: Guest }) {
  const running = () => props.guest.status === "running";
  return (
    <div class="px-gtile" data-status={props.guest.status} data-kind={props.guest.kind}>
      <Icon icon={KIND_ICON[props.guest.kind]} width="15" class="px-gtile-icon" />
      <span class="px-gtile-name px-truncate">{props.guest.name}</span>
      <Show when={running()} fallback={<span class="px-gtile-off">{props.guest.status === "suspended" ? "Paused" : "Off"}</span>}>
        <span class="px-gtile-cpu" data-tone={tone(props.guest.cpu, 70, 88)}>
          {Math.round(props.guest.cpu ?? 0)}
          <i>%</i>
        </span>
      </Show>
    </div>
  );
}

/**
 * A node at a glance: its state and name, how long it has been up, how many
 * of its VMs and containers run, and its CPU, memory and disk as figures
 * with a hairline each.
 */
function NodeTile(props: { node: ProxNode; guests: Guest[] }) {
  const off = () => props.node.online === false;
  const count = (kind: Guest["kind"]) => {
    const mine = props.guests.filter((g) => g.kind === kind && (!g.node || g.node === props.node.id));
    return { run: mine.filter((g) => g.status === "running").length, total: mine.length };
  };
  return (
    <div class="px-ncard" data-off={off()}>
      <div class="px-ncard-head">
        <span class="px-ncard-name">
          <i class="px-dot" data-status={off() ? "stopped" : "running"} />
          <b class="px-truncate">{props.node.name}</b>
          <Show when={props.node.update}>
            <span class="px-kicker-update" title="Update available">
              <Icon icon="mdi:arrow-up" width="10" />
            </span>
          </Show>
        </span>
        <span class="px-ncard-up">{off() ? "Offline" : upFor(props.node.upSince)}</span>
        <span class="px-ncard-counts">
          <Show when={count("vm").total}>
            <span data-kind="vm">
              <Icon icon={KIND_ICON.vm} width="13" />
              {count("vm").run}
              <em>/{count("vm").total}</em>
            </span>
          </Show>
          <Show when={count("lxc").total}>
            <span data-kind="lxc">
              <Icon icon={KIND_ICON.lxc} width="13" />
              {count("lxc").run}
              <em>/{count("lxc").total}</em>
            </span>
          </Show>
        </span>
      </div>
      <Show when={!off()}>
        <Metrics node={props.node} />
      </Show>
    </div>
  );
}

/**
 * Extra wide: a node as a column of the rack — its state, name and uptime,
 * CPU, memory and disk as slim bars, and under them its own guests, a line
 * each, as many as the column's height holds.
 */
function NodeColumn(props: { node?: ProxNode; name: string; guests: Guest[] }) {
  const off = () => props.node?.online === false;
  /* The guests' own room, measured: a line is 1.75rem, "+N more" the same. */
  const [room, setRoom] = createSignal(0);
  const watch = (el: HTMLDivElement) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const rem = Number.parseFloat(getComputedStyle(el).fontSize) || 16;
      setRoom(Math.max(0, Math.floor((entry?.contentRect.height ?? 0) / (1.75 * rem))));
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };
  const shown = () => (props.guests.length <= room() ? props.guests : props.guests.slice(0, Math.max(0, room() - 1)));
  const more = () => props.guests.length - shown().length;
  const bars = () =>
    props.node
      ? [
          { label: "CPU", value: props.node.cpu, warn: 70, alarm: 88, hue: "blue" },
          { label: "RAM", value: props.node.memory, warn: 80, alarm: 92, hue: "violet" },
          { label: "Disk", value: props.node.disk, warn: 80, alarm: 92, hue: "teal" },
        ].filter((m) => m.value !== undefined)
      : [];
  return (
    <section class="px-col" data-off={off()}>
      <header class="px-col-head">
        <i class="px-dot" data-status={off() ? "stopped" : "running"} />
        <b class="px-truncate">{props.name}</b>
        <Show when={props.node?.update}>
          <span class="px-kicker-update" title="Update available">
            <Icon icon="mdi:arrow-up" width="10" />
          </span>
        </Show>
        <span class="px-col-up">{off() ? "Offline" : upFor(props.node?.upSince)}</span>
      </header>
      <Show when={bars().length && !off()}>
        <div class="px-col-bars">
          <Index each={bars()}>
            {(m) => (
              <span class="px-metric" data-hue={m().hue} data-tone={tone(m().value, m().warn, m().alarm)}>
                <span class="px-col-bar-top">
                  <em>{m().label}</em>
                  <b>{Math.round(m().value!)}%</b>
                </span>
                <span class="px-metric-line">
                  <i style={{ width: `${Math.max(2, Math.min(100, m().value!))}%` }} />
                </span>
              </span>
            )}
          </Index>
        </div>
      </Show>
      <div class="px-col-guests" ref={watch}>
        <Index each={shown()}>
          {(g) => (
            <span class="px-col-guest" data-status={g().status} data-kind={g().kind}>
              <Icon icon={KIND_ICON[g().kind]} width="13" />
              <span class="px-truncate">{g().name}</span>
              <b data-tone={g().status === "running" ? tone(g().cpu, 70, 88) : undefined}>
                {g().status === "running" ? `${Math.round(g().cpu ?? 0)}%` : "Off"}
              </b>
            </span>
          )}
        </Index>
        <Show when={more() > 0}>
          <span class="px-col-more">+{more()} more</span>
        </Show>
      </div>
    </section>
  );
}

type Layout = "tiny" | "portrait" | "standard" | "wide" | "xwide";

/**
 * The tile's face: a small "Proxmox" over the name, and a pill of how many
 * guests are running; then the nodes, a card each — state, uptime, its VMs
 * and containers, CPU, memory and disk — and in what room is left the guests
 * as a grid of small tiles, running first. Five shapes:
 * - tiny, one row: the name and the pill;
 * - portrait and standard: the nodes under the head, the guests under them;
 * - wide: the head and the nodes at the left, the guests at the right;
 * - extra wide: the head across the top, the nodes side by side at the left
 *   and the guests across the rest.
 */
export function TileView(props: { cluster: Cluster; title?: string; showStopped?: boolean }) {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  const [rem, setRem] = createSignal(16);
  let host: HTMLDivElement | undefined;
  onMount(() => {
    if (!host || typeof ResizeObserver === "undefined") return;
    setRem(Number.parseFloat(getComputedStyle(host).fontSize) || 16);
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setSize({ w: box.width, h: box.height });
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  /* The tiles' own room, measured, so only whole rows are shown. */
  const [grid, setGrid] = createSignal({ w: 0, h: 0 });
  const watchGrid = (el: HTMLDivElement) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setGrid({ w: box.width, h: box.height });
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const nodes = () => props.cluster.nodes;
  const guests = createMemo(() =>
    props.showStopped === false ? props.cluster.guests.filter((g) => g.status === "running") : props.cluster.guests,
  );
  const running = () => props.cluster.guests.filter((g) => g.status === "running").length;
  const offline = () => nodes().length > 0 && nodes().every((n) => n.online === false);
  const someOff = () => nodes().some((n) => n.online === false);

  const layout = (): Layout => {
    const { w, h } = size();
    if (h > 0 && h < 110) return "tiny";
    if (w >= 900 && h >= 200) return "xwide";
    if (w >= 480 && w >= h * 1.5) return "wide";
    if (h >= 280 && h >= w * 1.15) return "portrait";
    return "standard";
  };
  /* The nodes as cards; a card that would be cut off at the foot is hidden
     whole, as are the guests' tiles, rather than shown in part. */
  let nodeGrid: HTMLDivElement | undefined;
  /* Again whenever the card's size or the number of nodes changes — the
     number as a memo: read straight from the cluster, every reading Proxmox
     reports set this off, and in Dash 1.5's sealed engine the layout reads
     and the cards' restyling were charged each time, enough to stop the
     widget. A card's visibility is set only when it changes, for the same
     reason. */
  const nodeCount = createMemo(() => nodes().length);
  createEffect(
    on([size, nodeCount], () => {
      const frame = requestAnimationFrame(() => {
        if (!nodeGrid) return;
        const room = nodeGrid.clientHeight + 1;
        for (const el of Array.from(nodeGrid.children) as HTMLElement[]) {
          const visibility = el.offsetTop + el.offsetHeight > room ? "hidden" : "";
          if (el.style.visibility !== visibility) el.style.visibility = visibility;
        }
      });
      onCleanup(() => cancelAnimationFrame(frame));
    }),
  );

  /* Tiles at least 9rem wide, 2.5rem tall with a 0.45rem gap; "+N more"
     takes the last tile's place. */
  const shown = createMemo(() => {
    const all = guests();
    const gap = 0.45 * rem();
    const cols = Math.max(1, Math.floor((grid().w + gap) / (9 * rem() + gap)));
    const rows = Math.max(0, Math.floor((grid().h + gap) / (2.5 * rem() + gap)));
    const room = cols * rows;
    /* No room for a row: nothing, rather than a "+N more" cut in half. */
    if (room === 0) return { rows: [], more: 0, cols };
    if (all.length <= room) return { rows: all, more: 0, cols };
    const keep = Math.max(0, room - 1);
    /* Room for a single tile: a guest would be one of many, "+25 more" on
       its own says nothing — the popup has them. */
    if (keep === 0) return { rows: [], more: 0, cols };
    return { rows: all.slice(0, keep), more: all.length - keep, cols };
  });

  const title = () => props.title || clusterTitle(nodes());
  const update = () => nodes().some((n) => n.update);

  const head = () => (
    <header class="px-head">
      <span class="px-head-text">
        <span class="px-kicker">
          <Icon icon="mdi:server" width="12" />Proxmox
          <Show when={update()}>
            <span class="px-kicker-update" title="Update available">
              <Icon icon="mdi:arrow-up" width="10" />
            </span>
          </Show>
        </span>
        <b class="px-truncate">{title()}</b>
      </span>
      <Show when={layout() === "xwide" && nodes().length > 1 && totals().cpu !== undefined}>
        <span class="px-totals">
          <span>
            <em>CPU</em>
            <b>{Math.round(totals().cpu!)}%</b>
          </span>
          <Show when={totals().memory !== undefined}>
            <span>
              <em>RAM</em>
              <b>{Math.round(totals().memory!)}%</b>
            </span>
          </Show>
          <span>
            <em>Nodes</em>
            <b>
              {nodes().filter((n) => n.online !== false).length}/{nodes().length}
            </b>
          </span>
        </span>
      </Show>
      <span class="px-pill" data-off={offline() || someOff()}>
        <i />
        {offline() ? (
          "Offline"
        ) : (
          <span>
            {running()}
            <em>/{props.cluster.guests.length}</em>
          </span>
        )}
      </span>
    </header>
  );

  /* Several nodes as cards where there is the height for them (portrait)
     or the width to set them side by side (extra wide); elsewhere a line
     each, so all of them show. */
  const compact = () =>
    nodes().length > 1 &&
    (layout() === "standard" || layout() === "wide" || (layout() === "portrait" && nodes().length > 3));
  /* Wide with many nodes: the rows take the card's whole width, two side by
     side, and the guests the room under them — beside a narrow column of
     their own the nodes had no room for their names. */
  const manyWide = () => layout() === "wide" && nodes().length > 3;

  /* The rack (extra wide): a column per node with its own guests, and one
     for guests on no node the cluster knows. As many columns across as fit
     at 14rem, the rows sharing the height; each column shows the guests
     its height holds. */
  const [rack, setRack] = createSignal({ w: 0, h: 0 });
  const watchRack = (el: HTMLDivElement) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setRack({ w: box.width, h: box.height });
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };
  const columns = createMemo(() => {
    const ids = new Set(nodes().map((n) => n.id));
    const list: { node?: ProxNode; name: string; guests: Guest[] }[] = nodes().map((node) => ({
      node,
      name: node.name,
      guests: guests().filter((g) => g.node === node.id),
    }));
    const loose = guests().filter((g) => !g.node || !ids.has(g.node));
    if (loose.length) list.push({ name: nodes().length ? "Other" : "Guests", guests: loose });
    return list;
  });
  const rackGrid = createMemo(() => {
    const gap = 0.6 * rem();
    const count = Math.max(1, columns().length);
    const fit = Math.max(1, Math.floor((rack().w + gap) / (14 * rem() + gap)));
    const cols = Math.min(count, fit);
    const rows = Math.ceil(count / cols);
    return { cols, rows };
  });
  /* The cluster as a whole, for the head: CPU averaged, memory weighted by
     each node's size. */
  const totals = createMemo(() => {
    const up = nodes().filter((n) => n.online !== false);
    const cpu = up.filter((n) => n.cpu !== undefined);
    const sized = up.filter((n) => n.memory !== undefined && n.memoryMax);
    return {
      cpu: cpu.length ? cpu.reduce((a, n) => a + n.cpu!, 0) / cpu.length : undefined,
      memory: sized.length
        ? sized.reduce((a, n) => a + n.memory! * n.memoryMax!, 0) / sized.reduce((a, n) => a + n.memoryMax!, 0)
        : undefined,
    };
  });

  /* A small card: the cluster summed up — its CPU and memory as figures (a
     single node's own, with its disk), and a dot per node. */
  const small = () => layout() === "standard" && (size().h < 240 || size().w < 300);
  const summaryNode = createMemo((): ProxNode | undefined => {
    if (nodes().length === 1) return nodes()[0];
    if (totals().cpu === undefined) return undefined;
    return { id: "cluster", name: "Cluster", online: true, cpu: totals().cpu, memory: totals().memory, update: false, buttons: {} };
  });
  const summaryView = () => (
    <div class="px-summary">
      <Show when={summaryNode()}>
        <Metrics node={summaryNode()!} />
      </Show>
      <Show when={nodes().length > 1}>
        <div class="px-node-dots">
          <Index each={nodes()}>
            {(node) => (
              <i
                class="px-node-dot"
                title={node().name}
                data-off={node().online === false}
                data-hot={(node().cpu ?? 0) >= 88 || (node().memory ?? 0) >= 92}
              />
            )}
          </Index>
          <span>
            {nodes().filter((n) => n.online !== false).length}/{nodes().length}
            <Show when={size().w >= 300}> nodes online</Show>
          </span>
        </div>
      </Show>
    </div>
  );

  const rackView = () => (
    <div
      class="px-rack"
      ref={watchRack}
      style={{ "--px-rack-cols": String(rackGrid().cols), "--px-rack-rows": String(rackGrid().rows) }}
    >
      <Index each={columns()}>
        {(c) => <NodeColumn node={c().node} name={c().name} guests={c().guests} />}
      </Index>
    </div>
  );

  const nodeCards = () => (
    <Show when={nodes().length}>
      <div class="px-ngrid" ref={nodeGrid} data-compact={compact()} data-pair={manyWide()}>
        <Index each={nodes()}>{(node) => <NodeTile node={node()} guests={props.cluster.guests} />}</Index>
      </div>
    </Show>
  );

  const tiles = () => (
    <div class="px-gtiles" ref={watchGrid} style={{ "--px-cols": String(shown().cols) }}>
      <Index each={shown().rows}>{(guest) => <GuestTile guest={guest()} />}</Index>
      <Show when={shown().more > 0}>
        <div class="px-gtile px-gtile-more">+{shown().more} more</div>
      </Show>
    </div>
  );

  return (
    <div ref={host} class="px-host">
      <div ref={(el) => setVars(el, () => unifiVars())}
        class="px-tile"
        data-layout={layout()}
        data-narrow={size().w > 0 && size().w < 300}
        data-off={offline()}
        
      >
        <Show when={layout() !== "tiny"} fallback={head()}>
          <Show
            when={layout() === "wide" && !manyWide()}
            fallback={
              <>
                {head()}
                <Show
                  when={layout() === "xwide"}
                  fallback={
                    <Show when={!small()} fallback={summaryView()}>
                      {nodeCards()}
                      {tiles()}
                    </Show>
                  }
                >
                  {rackView()}
                </Show>
              </>
            }
          >
            <div class="px-wide-body">
              <div class="px-wide-side">
                {head()}
                {nodeCards()}
              </div>
              {tiles()}
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/* Made once and handed the cluster as it changes: built inline as the
   dialog's prop, it was rebuilt on every update and the popup flickered. */
