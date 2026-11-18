import { Index, Show, createMemo } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { groupNote, summarise, type Group, type Status } from "./model";

/** The health bar's order: what is well first, the trouble at the end. */
const ORDER: Status[] = ["up", "maintenance", "unknown", "pending", "down"];

/**
 * A group on the main card: its icon on a tile in its own colour, its name,
 * what is wrong in it (or that all is well), and at the right how many of
 * its monitors are up over a slim bar shared out by state. A group with a
 * monitor down or pending carries a badge on its icon and says which. Its
 * monitors themselves are in the popup, which opens on the group.
 */
export function GroupRow(props: { group: Group; index: number }) {
  const summary = createMemo(() => summarise(props.group.monitors));
  const parts = createMemo(() =>
    ORDER.map((status) => ({
      status,
      count: props.group.monitors.filter((m) => m.status === status).length,
    })).filter((part) => part.count > 0),
  );
  return (
    /* A span, so it can sit inside the popup's button for its group. */
    <span
      class="up-group"
      data-group={props.index}
      data-status={summary().verdict}
      style={{ "--up-hue": props.group.hue }}
    >
      <span class="up-group-icon">
        <Icon icon={props.group.icon} width="19" />
        <Show when={summary().verdict === "down" || summary().verdict === "pending"}>
          <i class="up-group-badge" />
        </Show>
      </span>
      <span class="up-group-text">
        <span class="up-group-name up-truncate">{props.group.name}</span>
        <span class="up-group-note up-truncate">{groupNote(props.group)}</span>
      </span>
      <span class="up-group-side">
        <span class="up-group-count">
          {summary().up}
          <i>/{summary().total}</i>
        </span>
        <span class="up-group-bar" aria-hidden="true">
          <Index each={parts()}>{(part) => <i data-status={part().status} style={{ "flex-grow": part().count }} />}</Index>
        </span>
      </span>
    </span>
  );
}
