import { TileView } from "../proxmox/tile";
import { ProxmoxPanel } from "../proxmox/panel";
import type { Cluster } from "../proxmox/model";
import { unifiVars } from "../unifi/styles";
import { openable } from "./util";

/**
 * Proxmox, on the board: the Proxmox widget's own card, two tiles wide and
 * two deep — the nodes and their guests, drawn to whatever size it is given.
 * Shown in the room that holds it (see the board); the overlay is the
 * widget's own panel.
 */
export function ProxmoxCard(props: { cluster: Cluster; onOpen: () => void }) {
  return (
    <article class="rb-card rb-card--proxmox" {...openable(props.onOpen, "Proxmox")}>
      <TileView cluster={props.cluster} />
    </article>
  );
}

export function ProxmoxBoardPanel(props: { cluster: Cluster }) {
  return (
    <div class="rb-proxmox-panel" style={unifiVars()}>
      <ProxmoxPanel cluster={props.cluster} />
    </div>
  );
}
