import { For, Show, createMemo, createSignal } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { FillSlider } from "./slider";
import { openable, sinceLabel } from "./util";
import { Keyed } from "./keyed";
import { Half } from "./half";

/**
 * Covers: shutters, blinds, curtains, awnings, the garage.
 *
 * Home Assistant calls them all `cover` and then says which kind in the
 * device class — so the card can draw the thing itself rather than a generic
 * arrow. Where the class is missing (plenty of Zigbee and Shelly covers ship
 * without one) the name decides, in both languages.
 */

export type CoverKind =
  | "shutter"
  | "blind"
  | "curtain"
  | "awning"
  | "garage"
  | "door"
  | "window";

const CLASSES: Record<string, CoverKind> = {
  awning: "awning",
  blind: "blind",
  curtain: "curtain",
  damper: "shutter",
  door: "door",
  garage: "garage",
  gate: "door",
  shade: "shutter",
  shutter: "shutter",
  window: "window",
};

function kindByName(entity: EntityView): CoverKind {
  const name = `${entity.friendlyName ?? ""} ${entity.id}`.toLowerCase();
  if (/garage|tor\b/.test(name)) return "garage";
  if (/markise|awning|sonnensegel/.test(name)) return "awning";
  if (/vorhang|gardine|curtain|drape/.test(name)) return "curtain";
  if (/jalousie|blind|lamelle|venetian/.test(name)) return "blind";
  if (/rollo|rolladen|rolllad|shutter|shade|raffstore/.test(name)) return "shutter";
  if (/\btuer|\btür|door|gate|pforte/.test(name)) return "door";
  return "shutter";
}

export const coverKind = (entity: EntityView): CoverKind =>
  CLASSES[entity.deviceClass ?? ""] ?? kindByName(entity);

export const coversOf = (entities: EntityView[]) =>
  entities.filter((entity) => entity.domain === "cover");

/** 0 closed, 100 fully open. Covers without a position report only a state. */
export function positionOf(entity: EntityView | undefined): number | undefined {
  const raw = entity?.attributes?.["current_position"];
  const value = Number(raw);
  if (Number.isFinite(value)) return Math.min(100, Math.max(0, value));
  if (entity?.state === "open") return 100;
  if (entity?.state === "closed") return 0;
  return undefined;
}

export const tiltOf = (entity: EntityView | undefined): number | undefined => {
  const value = Number(entity?.attributes?.["current_tilt_position"]);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
};

const moving = (entity: EntityView | undefined) =>
  entity?.state === "opening" || entity?.state === "closing";

/** "Open 60%", "Closed", "Opening" — what it is doing, then where it is. */
export function coverLabel(entity: EntityView | undefined): string {
  const state = entity?.state ?? "";
  if (state === "opening") return "Opening";
  if (state === "closing") return "Closing";

  const at = positionOf(entity);
  if (state === "closed" || at === 0) return "Closed";
  if (at === undefined) return state === "open" ? "Open" : "Unknown";
  if (at >= 99) return "Open";
  return `Open ${Math.round(at)}%`;
}

/* The words the panel uses for each kind, so a curtain is drawn and named as
   a curtain rather than as "cover 3". */
const KIND_NAME: Record<CoverKind, string> = {
  shutter: "Shutter",
  blind: "Blind",
  curtain: "Curtain",
  awning: "Awning",
  garage: "Garage",
  door: "Door",
  window: "Window",
};

/**
 * The cover itself, drawn.
 *
 * One frame, and inside it whatever the kind calls for: a shutter's slats
 * rolling down from the head, a blind's slats tilting, two curtain panels
 * drawing apart, an awning reaching out over the sill, the garage lifting on
 * its track, a door swinging. The position drives the drawing directly —
 * `--at` is how open it is — so the picture is the readout and moves with the
 * cover rather than animating for its own sake.
 */
export function CoverArt(props: {
  kind: CoverKind;
  /** 0–100, how open it is. */
  at: number;
  /** 0–100 where the cover has tilting slats. */
  tilt?: number;
  moving: boolean;
}) {
  const slats = [0, 1, 2, 3, 4, 5];

  return (
    <div
      class="rb-cov-art"
      data-kind={props.kind}
      data-moving={props.moving}
      data-shut={props.at <= 1}
      /* Twice over on purpose: clip-path wants a percentage, and every
         calc() that multiplies the position wants a plain number — a
         percentage in arithmetic makes the whole declaration invalid, which
         is how the curtains, the awning and both leaves came to sit still. */
      style={{
        "--at": `${Math.min(100, Math.max(0, props.at))}%`,
        "--atn": `${Math.min(100, Math.max(0, props.at))}`,
        "--tilt": `${props.tilt ?? 100}`,
      }}
      aria-hidden="true"
    >
      {/* What is behind it: the view out, or the dark of a garage. */}
      <span class="rb-cov-view" />

      <span class="rb-cov-frame">
        <i class="rb-cov-mull" />
      </span>

      {/* Shutters and garages: a stack of slats hanging from the head. */}
      <Show when={props.kind === "shutter" || props.kind === "garage" || props.kind === "blind"}>
        <>
          <span class="rb-cov-slats">
            <For each={slats}>{(index) => <i style={{ "--i": index }} />}</For>
          </span>
          {/* The headbox the slats roll into. Without it a shutter at a
              hundred per cent was a bare window with nothing shutter-like
              left on the card. It fattens as the roll takes up the slats. */}
          <span class="rb-cov-roll" />
        </>
      </Show>

      {/* Curtains: two panels, drawn back towards their own sides. */}
      <Show when={props.kind === "curtain"}>
        <>
          <span class="rb-cov-drape rb-cov-drape--left" />
          <span class="rb-cov-drape rb-cov-drape--right" />
          <span class="rb-cov-rail" />
        </>
      </Show>

      {/* An awning reaches out over the sill and casts a shadow under it. */}
      <Show when={props.kind === "awning"}>
        <>
          <span class="rb-cov-awning" />
          <span class="rb-cov-awning-shade" />
        </>
      </Show>

      {/* A door or gate swings on its hinge. */}
      <Show when={props.kind === "door" || props.kind === "window"}>
        <span class="rb-cov-leaf">
          <i class="rb-cov-leaf-glass" />
          <b class="rb-cov-handle" />
        </span>
      </Show>
    </div>
  );
}

/* ---------- the card ---------- */

const ICONS: Record<CoverKind, string> = {
  shutter: "mdi:window-shutter",
  blind: "mdi:blinds-horizontal",
  curtain: "mdi:curtains",
  awning: "mdi:awning-outline",
  garage: "mdi:garage",
  door: "mdi:door",
  window: "mdi:window-open",
};

/**
 * The board card: the room's covers, one at a time.
 *
 * Swipeable the way the lock card is, because a room with four shutters wants
 * four sets of controls and a card has room for one — and the one it shows
 * first is whichever is doing something, then whichever is open.
 */
export function CoverCard(props: { covers: EntityView[]; onOpen: () => void }) {
  const { callService } = useService();

  const sorted = createMemo(() =>
    [...props.covers].sort((a, b) => {
      const busy = Number(moving(b)) - Number(moving(a));
      if (busy) return busy;
      return (positionOf(b) ?? 0) - (positionOf(a) ?? 0);
    }),
  );

  const [index, setIndex] = createSignal(0);
  const at = () => Math.min(index(), Math.max(0, sorted().length - 1));
  const cover = () => sorted()[at()];

  const call = (event: Event, service: string) => {
    event.stopPropagation();
    const id = cover()?.id;
    if (id) void callService("cover", service, {}, { entity_id: id });
  };

  /* A swipe pages, a tap opens: the same 40px threshold the lock card uses, so
     the two behave identically under the thumb. */
  let startX = 0;
  let swiped = false;

  const onPointerDown = (event: PointerEvent) => {
    startX = event.clientX;
    swiped = false;
  };

  const onPointerUp = (event: PointerEvent) => {
    const delta = event.clientX - startX;
    if (Math.abs(delta) < 40 || sorted().length < 2) return;
    swiped = true;
    const next = at() + (delta < 0 ? 1 : -1);
    setIndex((next + sorted().length) % sorted().length);
  };

  const position = () => positionOf(cover());
  const bigLabel = () => {
    if (moving(cover())) return coverLabel(cover());
    return (position() ?? 0) <= 1 ? "Closed" : "Open";
  };

  return (
    <article
      class="rb-card rb-card--cover"
      data-moving={moving(cover())}
      data-shut={(position() ?? 0) <= 1}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      {...openable(() => {
        if (!swiped) props.onOpen();
      }, "Covers")}
    >
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">
            {cover()?.friendlyName ?? KIND_NAME[coverKind(cover()!)] ?? "Covers"}
          </h3>
          <span class="rb-card-verdict rb-truncate">
            <Show when={moving(cover())}>
              <i class="rb-cov-live" />
            </Show>
            {coverLabel(cover())}
            <Show when={cover()?.lastChanged && !moving(cover())}>
              {` · ${sinceLabel(cover()!.lastChanged)}`}
            </Show>
          </span>
        </div>

        <Show when={sorted().length > 1}>
          <span class="rb-cov-count">
            {at() + 1}/{sorted().length}
          </span>
        </Show>
      </header>

      {/* Standing card only (the stylesheet hides it otherwise): how open,
          in figures the size of the drawing above them, and moving, closed
          or open under it. */}
      <div class="rb-cov-big">
        <b>
          {position() === undefined ? "—" : Math.round(position()!)}
          <i>%</i>
        </b>
        <span>{bigLabel()}</span>
      </div>

      {/* One segmented control rather than three loose buttons. The end a
          cover has already reached is dimmed — still pressable, because a
          stalled motor sometimes needs telling twice, but no longer offering
          itself as the obvious next move. */}
      <div class="rb-cov-row">
        <div class="rb-cov-keys">
          <button
            aria-label="Open"
            data-done={(position() ?? 0) >= 99}
            onClick={(e) => call(e, "open_cover")}
          >
            <Icon icon="mdi:chevron-up" width="17" />
          </button>
          <button
            aria-label="Stop"
            data-live={moving(cover())}
            onClick={(e) => call(e, "stop_cover")}
          >
            <Icon icon="mdi:stop" width="13" />
          </button>
          <button
            aria-label="Close"
            data-done={(position() ?? 0) <= 1}
            onClick={(e) => call(e, "close_cover")}
          >
            <Icon icon="mdi:chevron-down" width="17" />
          </button>
        </div>
      </div>

      {/* Last, and in the corner: the same place the lock card puts its own
          drawing, at the same size. The board reads as one thing when every
          card that has an illustration hangs it in the same spot. */}
      <CoverArt
        kind={coverKind(cover()!)}
        at={position() ?? 0}
        tilt={tiltOf(cover())}
        moving={moving(cover())}
      />

      <Half icon={(position() ?? 0) <= 1 ? "mdi:window-shutter" : "mdi:window-shutter-open"} name={cover()?.friendlyName ?? "Shutters"} status={bigLabel()} tone="#38bdf8" value={position() === undefined ? undefined : `${Math.round(position()!)}%`} />
    </article>
  );
}

/* ---------- the overlay ---------- */

/**
 * The overlay, laid out the way the thermostat's is: the room's covers down
 * the left, the chosen one drawn at the size it deserves in the middle, and
 * the thing you came to do — move it — on the right as a surface to push
 * rather than a hairline to aim at.
 */
const PRESET_LABEL: Record<number, string> = { 0: "Shut", 50: "Half", 100: "Open" };

export function CoverPanel(props: { covers: EntityView[] }) {
  const { callService } = useService();

  const [chosen, setChosen] = createSignal("");
  const cover = () =>
    props.covers.find((entity) => entity.id === chosen()) ?? props.covers[0];

  const call = (service: string, data: Record<string, unknown> = {}) => {
    const id = cover()?.id;
    if (id) void callService("cover", service, data, { entity_id: id });
  };

  const kind = () => coverKind(cover()!);
  const at = () => positionOf(cover()) ?? 0;
  const tilt = () => tiltOf(cover());
  const allShut = () => props.covers.every((entity) => (positionOf(entity) ?? 0) <= 1);

  return (
    <div class="rb-cov-sheet">
      <header class="rb-cov-sheet-head">
        <div class="rb-cov-sheet-titles">
          <h2 class="rb-cov-sheet-name rb-truncate">
            {cover()?.friendlyName ?? "Covers"}
          </h2>
          <span class="rb-cov-sheet-sub">
            <Icon icon={ICONS[kind()]} width="13" />
            {KIND_NAME[kind()]} · {coverLabel(cover())}
          </span>
        </div>

        <Show when={props.covers.length > 1}>
          <button
            class="rb-cov-allbtn"
            onClick={() =>
              props.covers.forEach((entity) =>
                void callService(
                  "cover",
                  allShut() ? "open_cover" : "close_cover",
                  {},
                  { entity_id: entity.id },
                ),
              )
            }
          >
            <Icon icon={allShut() ? "mdi:chevron-up" : "mdi:chevron-down"} width="15" />
            <span>{allShut() ? "Open all" : "Close all"}</span>
          </button>
        </Show>
      </header>

      <div class="rb-cov-body">
        {/* The room's covers, as tiles: which one you are holding, and where
            each of the others stands, without opening anything. */}
        <Show when={props.covers.length > 1}>
          <div class="rb-cov-list">
            <Keyed each={props.covers}>
              {(entity) => (
                <button
                  class="rb-cov-tile"
                  data-active={entity.id === cover()?.id}
                  onClick={() => setChosen(entity.id)}
                >
                  <CoverArt
                    kind={coverKind(entity)}
                    at={positionOf(entity) ?? 0}
                    tilt={tiltOf(entity)}
                    moving={moving(entity)}
                  />
                  <span class="rb-cov-tile-meta">
                    <span class="rb-truncate">{entity.friendlyName ?? entity.id}</span>
                    <b>{coverLabel(entity)}</b>
                  </span>
                </button>
              )}
            </Keyed>
          </div>
        </Show>

        {/* The cover itself, big. */}
        <div class="rb-cov-stage">
          <CoverArt kind={kind()} at={at()} tilt={tilt()} moving={moving(cover())} />

          <span class="rb-cov-value">
            {Math.round(at())}
            <i>%</i>
          </span>

          <div class="rb-cov-keys rb-cov-keys--lg">
            <button aria-label="Open" onClick={() => call("open_cover")}>
              <Icon icon="mdi:chevron-up" width="20" />
            </button>
            <button aria-label="Stop" onClick={() => call("stop_cover")}>
              <Icon icon="mdi:stop" width="16" />
            </button>
            <button aria-label="Close" onClick={() => call("close_cover")}>
              <Icon icon="mdi:chevron-down" width="20" />
            </button>
          </div>
        </div>

        {/* Dragged rather than aimed at: the column is the cover, and pushing
            it up opens it. */}
        <div class="rb-cov-side">
          <Show when={positionOf(cover()) !== undefined}>
            <FillSlider
              class="rb-cov-fill"
              vertical
              value={at()}
              color="120 170 255"
              label={`Position of ${cover()?.friendlyName ?? "cover"}`}
              onCommit={(value) => call("set_cover_position", { position: value })}
            >
              <span class="rb-cov-fill-top">
                <Icon icon="mdi:chevron-up" width="15" />
              </span>
              {/* The position, on the surface that sets it. Only the phone
                  layout shows it — the wide one has the same number under the
                  drawing, and two of them is one too many. */}
              <b class="rb-cov-fill-val">
                {Math.round(at())}
                <i>%</i>
              </b>
              <span class="rb-cov-fill-foot">
                <Icon icon="mdi:chevron-down" width="15" />
              </span>
            </FillSlider>
          </Show>

          <Show when={tilt() !== undefined}>
            <div class="rb-cov-tilt">
              <span class="rb-cov-label">Tilt</span>
              <FillSlider
                class="rb-cov-tiltfill"
                value={tilt()!}
                color="120 170 255"
                label="Tilt"
                onCommit={(value) => call("set_cover_tilt_position", { tilt_position: value })}
              >
                <b>{Math.round(tilt()!)}%</b>
              </FillSlider>
            </div>
          </Show>

          {/* The three positions anyone actually asks for. */}
          <div class="rb-cov-presets">
            <For each={[0, 50, 100]}>
              {(value) => (
                <button
                  data-active={Math.round(at()) === value}
                  onClick={() => call("set_cover_position", { position: value })}
                >
                  {PRESET_LABEL[value]}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
