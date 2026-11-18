import { createMemo } from "solid-js";
import { pingTone, type Network, type Ping } from "../unifi/model";
import { TileView } from "../unifi/tile";
import { UnifiPanel } from "../unifi/panel";
import { unifiVars } from "../unifi/styles";
import { openable } from "./util";

/**
 * The UniFi network, on the board: the UniFi widget's own card, two tiles
 * wide — what is moving now (the gateway's rates, or the last speed test
 * where it has none), the console's gauges, the day's wave, and the
 * internet's latency along the foot. Shown in
 * the room that holds the network (see the board); the overlay is the
 * widget's own panel.
 */
export function UnifiCard(props: { network: Network; pings: Ping[]; onOpen: () => void }) {
  return (
    <article class="rb-card rb-card--unifi" {...openable(props.onOpen, "Network")}>
      <TileView network={props.network} pings={props.pings} />
    </article>
  );
}

export function UnifiBoardPanel(props: { network: Network; pings: Ping[] }) {
  return (
    <div class="rb-unifi-panel" style={unifiVars()}>
      <UnifiPanel network={props.network} pings={props.pings} />
    </div>
  );
}

/** The gateway's own latency first, then the Ping integration's hosts —
    together, the trouble first — as the widget orders them. */
export function usePingList(network: () => Network, hosts: () => Ping[]) {
  return createMemo(() => {
    const RANK = { down: 0, slow: 1, ok: 2 } as const;
    return [...network().latency, ...hosts()].sort((a, b) => RANK[pingTone(a)] - RANK[pingTone(b)]);
  });
}
