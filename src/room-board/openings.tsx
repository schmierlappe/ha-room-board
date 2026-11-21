import { Show, createMemo } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { openable, sinceLabel } from "./util";
import { Keyed } from "./keyed";
import { Half } from "./half";

/**
 * What is open in this room.
 *
 * Doors, windows and the garage, out of the binary sensors the room already
 * has — the device class is what says which, so nothing needs naming in
 * settings. Anything that reports "opening" without saying what it is counts
 * as a window, which is what it usually turns out to be.
 */
export type Opening = {
  id: string;
  name: string;
  kind: "door" | "window" | "garage";
  open: boolean;
  since: Date;
};

const KIND: Record<string, Opening["kind"]> = {
  door: "door",
  garage_door: "garage",
  window: "window",
  opening: "window",
};

/**
 * What a sensor is watching, when it does not say.
 *
 * Plenty of contact sensors arrive with no device class at all — Zigbee ones
 * especially — and a card that only trusts the class shows nothing in a room
 * full of window sensors. The name is the fallback, in both the language the
 * integration speaks and the one the house does.
 */
function kindByName(entity: EntityView): Opening["kind"] | undefined {
  const name = `${entity.friendlyName ?? ""} ${entity.id}`.toLowerCase();
  if (/garage|tor\b/.test(name)) return "garage";
  if (/fenster|window|dachfenster|velux/.test(name)) return "window";
  if (/\btuer|\btür|door|balkon|terrasse|eingang|entrance/.test(name)) return "door";
  // A bare "contact" or "kontakt" is a door or window and nothing else.
  if (/kontakt|contact|opening|geöffnet|offen/.test(name)) return "window";
  return undefined;
}

export const kindOf = (entity: EntityView): Opening["kind"] | undefined =>
  KIND[entity.deviceClass ?? ""] ?? kindByName(entity);

const ICONS: Record<Opening["kind"], [string, string]> = {
  door: ["mdi:door-open", "mdi:door-closed"],
  window: ["mdi:window-open-variant", "mdi:window-closed-variant"],
  garage: ["mdi:garage-open-variant", "mdi:garage-variant"],
};

export const iconFor = (opening: Opening) =>
  ICONS[opening.kind][opening.open ? 0 : 1];

export function openingsOf(entities: EntityView[]): Opening[] {
  return entities
    .filter(
      (entity) =>
        entity.domain === "binary_sensor" &&
        !entity.entityCategory &&
        !entity.isHidden &&
        !!kindOf(entity),
    )
    .map((entity) => ({
      id: entity.id,
      name: entity.friendlyName ?? entity.id,
      kind: kindOf(entity)!,
      /* "on" is open for a binary sensor; a contact sensor that publishes
         words instead says so in its own. */
      open: ["on", "open", "offen", "geöffnet", "true"].includes(entity.state.toLowerCase()),
      since: entity.lastChanged,
    }))
    /* Open first, then longest-open first: the one that has been letting the
       heat out all afternoon is the one worth seeing. */
    .sort(
      (a, b) =>
        Number(b.open) - Number(a.open) ||
        (b.open ? a.since.getTime() - b.since.getTime() : b.since.getTime() - a.since.getTime()),
    );
}

/**
 * The opening, drawn as line-work.
 *
 * Flat outlines rather than filled panes: a solid sash swinging out of a solid
 * frame came out as two grey slabs, which is not a window from any angle. The
 * frame stays quiet, the leaf takes the state's colour, and it swings on the
 * hinge the thing itself uses — sideways for a window, the other way for a
 * door, upwards for a garage.
 */
function Sash(props: { open: boolean; kind: Opening["kind"] }) {
  return (
    <div class="rb-open-art" data-open={props.open} data-kind={props.kind} aria-hidden="true">
      {/* What is behind the leaf: the reveal of the frame, and the light that
          falls through the gap once the leaf is off its seat. */}
      <span class="rb-open-reveal" />
      <span class="rb-open-spill" />

      {/* The air coming through it: streaks that drift out of the gap while
          something is open, and sit still when nothing is. */}
      <span class="rb-open-air">
        <i style={{ "--delay": "0s" }} />
        <i style={{ "--delay": "0.9s" }} />
        <i style={{ "--delay": "1.8s" }} />
      </span>

      <span class="rb-open-frame">
        <i class="rb-open-mull" />
      </span>

      <span class="rb-open-leaf">
        <i class="rb-open-glass" />
        <i class="rb-open-bar" />
        <b class="rb-open-handle" />
      </span>
    </div>
  );
}

/** The board card: what is open, and for how long. */
export function OpeningsCard(props: { openings: Opening[]; onOpen: () => void }) {
  const open = createMemo(() => props.openings.filter((opening) => opening.open));
  const lead = () => open()[0];

  /* The name is the card's subject and stays put; the line under it is the
     answer, which is what changes. */
  const verdict = () => {
    if (!open().length) return "All closed";
    const first = lead()!;
    return open().length === 1
      ? `Open · ${first.name} ${sinceLabel(first.since)}`
      : `${open().length} open · ${first.name} ${sinceLabel(first.since)}`;
  };

  return (
    <article
      class="rb-card rb-card--openings"
      data-open={open().length > 0}
      {...openable(props.onOpen, "Windows and doors")}
    >
      <Sash open={open().length > 0} kind={lead()?.kind ?? "window"} />

      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">Windows/Doors</h3>
          <span class="rb-card-verdict rb-truncate">{verdict()}</span>
        </div>
      </header>

      {/* Standing card only (the stylesheet hides both otherwise): the count
          in figures under the drawing, and the doors and windows themselves —
          the open ones and for how long, or the last ones shut. */}
      <div class="rb-open-big">
        <Show when={open().length} fallback={<b data-all="true">All closed</b>}>
          <b>
            {open().length}
            <i> open</i>
          </b>
        </Show>
      </div>

      <div class="rb-open-list">
        <Keyed each={(open().length ? open() : props.openings).slice(0, 3)}>
          {(opening) => (
            <span class="rb-open-item" data-open={opening.open}>
              <Icon icon={iconFor(opening)} width="14" />
              <span class="rb-truncate">{opening.name}</span>
              <em>{sinceLabel(opening.since)}</em>
            </span>
          )}
        </Keyed>
      </div>

      {/* What else is open, in words rather than a row of squares. */}
      <Show when={open().length > 1}>
        <span class="rb-open-more">
          {open()
            .slice(1, 3)
            .map((opening) => opening.name)
            .join(" · ")}
          {open().length > 3 ? ` · +${open().length - 3}` : ""}
        </span>
      </Show>
      <Half art={<Sash open={open().length > 0} kind={lead()?.kind ?? "window"} />} icon={open().length ? "mdi:door-open" : "mdi:door-closed"} name="Doors & windows" status={open().length ? verdict() : "All closed"} tone="#38bdf8" lit={open().length > 0} value={open().length ? String(open().length) : undefined} />
    </article>
  );
}

/** The overlay: every door and window, open ones first. */
export function OpeningsPanel(props: { openings: Opening[] }) {
  const open = () => props.openings.filter((opening) => opening.open);
  const shut = () => props.openings.filter((opening) => !opening.open);

  const Row = (rowProps: { opening: Opening }) => (
    <div class="rb-open-row" data-open={rowProps.opening.open}>
      <span class="rb-open-row-icon">
        <Icon icon={iconFor(rowProps.opening)} width="18" />
      </span>

      <span class="rb-open-row-meta">
        <span class="rb-open-row-name rb-truncate">{rowProps.opening.name}</span>
        <span class="rb-open-row-kind">{rowProps.opening.kind}</span>
      </span>

      <span class="rb-open-row-when">
        <b>{rowProps.opening.open ? "Open" : "Closed"}</b>
        <span>{sinceLabel(rowProps.opening.since)}</span>
      </span>
    </div>
  );

  return (
    <div class="rb-open-panel">
      <Show
        when={props.openings.length}
        fallback={<p class="rb-act-none">This room has no door or window sensors.</p>}
      >
        <Show when={open().length}>
          <section class="rb-open-group">
            <h3 class="rb-vac-label">Open</h3>
            <div class="rb-open-rows">
              <Keyed each={open()}>{(opening) => <Row opening={opening} />}</Keyed>
            </div>
          </section>
        </Show>

        <Show when={shut().length}>
          <section class="rb-open-group">
            <h3 class="rb-vac-label">Closed</h3>
            <div class="rb-open-rows">
              <Keyed each={shut()}>{(opening) => <Row opening={opening} />}</Keyed>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}
