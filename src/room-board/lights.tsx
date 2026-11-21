import { For, Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { GlobeLamp } from "./lamp";
import { ColorWheel, rgbCss } from "./color-wheel";
import { FillSlider } from "./slider";
import { attr, openable, safeIcon } from "./util";
import { Keyed } from "./keyed";
import { keyStep } from "../keys";
import { Half } from "./half";

export const isLit = (entity: EntityView) => entity.state === "on";

/** 0–100, or undefined for a light that cannot dim. */
const brightnessOf = (entity: EntityView) => {
  const raw = attr<number | undefined>(entity, "brightness", undefined);
  return raw === undefined ? undefined : Math.round((raw / 255) * 100);
};

/**
 * How lit the room is, 0–1.
 *
 * The average brightness of the lights that are on, weighted by how many of
 * them are on — so one lamp at full in a room of six reads as dim, which is
 * what it looks like standing there. A light with no brightness counts as
 * full, since on is as bright as it gets.
 */
function glowOf(lights: EntityView[]): number {
  if (!lights.length) return 0;
  const on = lights.filter(isLit);
  if (!on.length) return 0;

  const sum = on.reduce((total, entity) => total + (brightnessOf(entity) ?? 100), 0);
  return (sum / on.length / 100) * (on.length / lights.length);
}

/**
 * The colour the room is actually throwing, averaged over the lights that are
 * on. A warm white stands in for bulbs that report no colour — which is what
 * an ordinary lamp looks like, and better than tinting the card blue.
 */
function bulbColour(lights: EntityView[]): string {
  const lit = lights.filter(isLit);
  const colours = lit
    .map((entity) => attr<number[] | undefined>(entity, "rgb_color", undefined))
    .filter((value): value is number[] => Array.isArray(value) && value.length === 3);

  if (!colours.length) return "255 186 120";

  const mixed = colours.reduce(
    (sum, rgb) => [sum[0]! + rgb[0]!, sum[1]! + rgb[1]!, sum[2]! + rgb[2]!],
    [0, 0, 0],
  );
  return mixed.map((channel) => Math.round(channel / colours.length)).join(" ");
}

/** The board card: how much of the room is lit, and a switch for all of it. */
export function LightCard(props: { lights: EntityView[]; onOpen: () => void }) {
  const { callService } = useService();
  const on = createMemo(() => props.lights.filter(isLit).length);
  const glow = createMemo(() => glowOf(props.lights));

  const call = (service: string, data: Record<string, unknown>, ids: string[]) =>
    void callService("light", service, data, { entity_id: ids });

  /* In the room's own order, never lit-first: a pill that jumped to the
     front when it was tapped on would be somewhere else by the second tap. */
  const pills = () => props.lights.slice(0, 6);
  /* Past six, the last place says how many more instead. */
  const over = () => (props.lights.length > 6 ? "both" : "none");

  const toggleAll = (e: Event) => {
    e.stopPropagation();
    const ids = props.lights.map((entity) => entity.id);
    if (!ids.length) return;
    void callService("light", on() ? "turn_off" : "turn_on", {}, { entity_id: ids });
  };

  return (
    <article
      class="rb-card rb-card--light"
      data-on={on() > 0}
      style={{ "--rb-glow": `${glow()}`, "--rb-bulb": bulbColour(props.lights) }}
      {...openable(props.onOpen, "Lights")}
    >
      {/* The slim bar of how lit the room is (the stylesheet draws it). */}
      <span class="rb-light-fill" aria-hidden="true" />
      {/* The globe is the state: lit when the room is, in the bulbs' own
          colour, which says it before a number does. */}
      <GlobeLamp on={on() > 0} strength={glow()} color={bulbColour(props.lights)} />

      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">Lights</h3>
          <span class="rb-card-verdict rb-truncate">
            <Show when={on()} fallback="All off">
              {`${on()} of ${props.lights.length} on`}
              {/* A small card has no room for the level written large. */}
              <span class="rb-light-pct">{`${Math.round(glow() * 100)}% lit`}</span>
            </Show>
          </span>
        </div>
      </header>

      {/* The level, written large. */}
      <b class="rb-light-level">
        <Show when={on()} fallback="Off">
          {Math.round(glow() * 100)}
          <i>%</i>
        </Show>
      </b>
      {/* Big only: the lights themselves, each a pill that is its
          own switch and dimmer. Six at most; past that the last place says
          how many more, and the panel has the rest. */}
      <div class="rb-light-grid" data-over={over()}>
        <Keyed each={pills()}>
          {(entity) => (
            <LightPill
              entity={entity}
              onToggle={() => call("toggle", {}, [entity.id])}
              onLevel={(value) =>
                value <= 0
                  ? call("turn_off", {}, [entity.id])
                  : call("turn_on", { brightness_pct: value }, [entity.id])
              }
            />
          )}
        </Keyed>
        <Show when={over() !== "none"}>
          <button
            class="rb-light-more"
            aria-label="All lights"
            onClick={(event) => {
              event.stopPropagation();
              props.onOpen();
            }}
          >
            <Icon icon="mdi:dots-horizontal" width="16" />
            {/* Shown on the big card only. Text rather than content: attr(),
                which the sealed engine's stylesheet check refuses. */}
            <span class="rb-light-more-count">{`+${props.lights.length - 5} more`}</span>
          </button>
        </Show>
      </div>

      <div class="rb-light-row">
        <button
          class="rb-light-switch"
          aria-label={on() ? "Turn the lights off" : "Turn the lights on"}
          onClick={toggleAll}
        >
          {/* Drawn as a toggle by the stylesheet; the icon is for anything
              that shows the button bare. */}
          <Icon icon="mdi:power" width="18" />
        </button>
      </div>
      {/* Half a tile (Arrange's ½ size): the lights and their switch. */}
      <Half icon={on() ? "mdi:lightbulb-group" : "mdi:lightbulb-group-outline"} name="Lights" status={on() ? `${on()} of ${props.lights.length} on` : "All off"} tone="#fbbf24" lit={on() > 0} art={<GlobeLamp on={on() > 0} strength={glow()} color={bulbColour(props.lights)} />} on={on() > 0} onToggle={() => void callService("light", on() ? "turn_off" : "turn_on", {}, { entity_id: props.lights.map((entity) => entity.id) })} />
    </article>
  );
}

/**
 * One light on the big and wide cards: a pill that is its own switch and its
 * own dimmer.
 *
 * A tap switches it. A sideways drag dims it from where it is, geared so the
 * whole range is a long stroke and one percent is a few pixels — the same
 * feel as the volume on the media card — and never lands where the finger
 * first touched, so reaching for the switch cannot throw the level. Up and
 * down is left to the page, so a board scrolls past it on a phone.
 */
function LightPill(props: {
  entity: EntityView;
  onToggle: () => void;
  onLevel: (value: number) => void;
  class?: string;
  /** Anything more at the end of the pill, like the panel's colour button. */
  children?: JSX.Element;
}) {
  const [live, setLive] = createSignal<number | undefined>();
  const [held, setHeld] = createSignal(false);
  const actual = () => (isLit(props.entity) ? (brightnessOf(props.entity) ?? 100) : 0);
  const level = () => live() ?? actual();
  const dims = () => canDim(props.entity);
  const name = () => props.entity.friendlyName ?? props.entity.id;

  /* The level stays where it was left until the bulb has caught up, rather
     than snapping back to the old one for the second it takes to answer. */
  let settle: ReturnType<typeof setTimeout> | undefined;
  const commit = (value: number) => {
    clearTimeout(settle);
    setLive(value);
    props.onLevel(value);
    settle = setTimeout(() => setLive(undefined), 1500);
  };
  onCleanup(() => clearTimeout(settle));

  let grab: { x: number; from: number; travel: number; moved: boolean } | undefined;

  const drop = () => {
    grab = undefined;
    setHeld(false);
  };

  return (
    <div
      class={`rb-light-pill ${props.class ?? ""}`}
      role="slider"
      tabindex="0"
      aria-label={`${name()} — tap to switch, drag to dim`}
      aria-valuenow={Math.round(level())}
      aria-valuemin={0}
      aria-valuemax={100}
      data-on={level() > 0}
      data-held={held()}
      style={{ "--f": `${level() / 100}`, "--rb-bulb": rowColour(props.entity) }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        const width = event.currentTarget.getBoundingClientRect().width;
        grab = {
          x: event.clientX,
          from: level(),
          travel: Math.max(width * 1.6, 220),
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        if (!grab || !dims()) return;
        const dx = event.clientX - grab.x;
        if (!grab.moved) {
          if (Math.abs(dx) < 6) return;
          grab.moved = true;
          setHeld(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        clearTimeout(settle);
        setLive(Math.round(Math.max(0, Math.min(100, grab.from + (dx / grab.travel) * 100))));
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        if (!grab) return;
        const moved = grab.moved;
        drop();
        if (moved) commit(Math.round(level()));
        else props.onToggle();
      }}
      onPointerCancel={() => {
        /* The page took it for a scroll: whatever the drag showed is undone. */
        if (grab?.moved) setLive(undefined);
        drop();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          props.onToggle();
          return;
        }
        if (!dims()) return;
        const delta = keyStep(event.key, 5);
        if (!delta) return;
        event.preventDefault();
        commit(Math.max(0, Math.min(100, Math.round(level()) + delta)));
      }}
    >
      <i class="rb-light-pill-fill" aria-hidden="true" />
      <span class="rb-light-pill-icon" aria-hidden="true">
        <Icon icon={level() > 0 ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"} width="15" />
      </span>
      <span class="rb-light-pill-name rb-truncate">{name()}</span>
      <span class="rb-light-pill-val">
        {levelText(level(), dims())}
      </span>
      {props.children}
    </div>
  );
}

/* ---------- what a bulb can do ---------- */

const COLOUR_MODES = new Set(["hs", "rgb", "rgbw", "rgbww", "xy"]);

const modesOf = (entity: EntityView | undefined) =>
  attr<string[]>(entity, "supported_color_modes", []);

const canColour = (entity: EntityView | undefined) =>
  modesOf(entity).some((mode) => COLOUR_MODES.has(mode));

const canTemp = (entity: EntityView | undefined) => modesOf(entity).includes("color_temp");

/**
 * Whether the bulb dims at all.
 *
 * Asked of the modes rather than of the brightness attribute: a light that is
 * off reports no brightness, so reading that alone hid the slider on exactly
 * the lights somebody opens the panel to turn up.
 */
const canDim = (entity: EntityView | undefined) => {
  const modes = modesOf(entity);
  if (!modes.length) return attr<number | undefined>(entity, "brightness", undefined) !== undefined;
  return modes.some((mode) => mode !== "onoff" && mode !== "unknown");
};

/** A level as words: off, on for a lamp that does not dim, else the percent. */
function levelText(level: number, dims: boolean | undefined): string {
  if (level <= 0) return "Off";
  return dims ? `${Math.round(level)}%` : "On";
}

/** One lamp's state for its chip. */
function lampState(entity: EntityView): string {
  if (!isLit(entity)) return "Off";
  return canDim(entity) ? `${brightnessOf(entity) ?? 100}%` : "On";
}

/** The colour this one bulb is throwing, for its own row. */
const rowColour = (entity: EntityView) => {
  const rgb = attr<number[] | undefined>(entity, "rgb_color", undefined);
  return Array.isArray(rgb) && rgb.length === 3 ? rgb.join(" ") : "255 186 120";
};

/** Moods, for the rooms that have no scenes of their own. */
const MOODS: { name: string; hue: number; sat: number }[] = [
  { name: "Candle", hue: 24, sat: 88 },
  { name: "Warm", hue: 32, sat: 45 },
  { name: "Reading", hue: 42, sat: 16 },
  { name: "Sunset", hue: 12, sat: 76 },
  { name: "Berry", hue: 312, sat: 62 },
  { name: "Ocean", hue: 202, sat: 72 },
  { name: "Forest", hue: 128, sat: 58 },
];

/**
 * The lights in full.
 *
 * Built around one idea: the thing you touch is the light itself, not a
 * control that represents it. The room is a tall surface you push up and down
 * to dim, each bulb below is a bar you drag, and the wheel sets the colour of
 * whichever of them is selected. Nothing here is a 4px track with a thumb on
 * it — on a wall tablet those are missed as often as they are hit.
 */
export function LightPanel(props: {
  lights: EntityView[];
  scenes?: EntityView[];
  /** A phone: the tall slider beside the lamp, chips and tiles under it. */
  narrow?: boolean;
}) {
  const { callService } = useService();
  /* The lamps everything is aimed at: none picked means the whole room.
     Tapping a lamp adds it to the selection or takes it out again, so the
     power, the level and the colour can act on several at once. */
  const [picked, setPicked] = createSignal<string[]>([]);
  const isPicked = (id: string) => picked().includes(id);
  const togglePick = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const on = () => props.lights.filter(isLit).length;
  const colour = createMemo(() => bulbColour(props.lights));

  /* The picked lamps that are still in the room, or undefined for the room. */
  const chosen = () => {
    const ids = picked();
    if (!ids.length) return undefined;
    const found = props.lights.filter((entity) => ids.includes(entity.id));
    return found.length ? found : undefined;
  };

  /* Every light in the room, on or off, in the room's own order — a light
     that jumped up the list when it came on would be somewhere else by the
     second tap. */
  const listed = () => props.lights;

  /* What the wheel, the moods and the big surface act on: the picked lamps
     when there are any, otherwise every light that is on — and every light in
     the room when they all are off, so a mood can turn the room on. */
  const targets = createMemo(() => {
    const some = chosen();
    if (some) return some;
    const lit = props.lights.filter(isLit);
    return lit.length ? lit : props.lights;
  });

  const lead = () => targets().find(canColour) ?? targets().find(canTemp) ?? targets()[0];

  const call = (service: string, data: Record<string, unknown>, ids: string[]) => {
    if (!ids.length) return;
    void callService("light", service, data, { entity_id: ids });
  };

  const apply = (data: Record<string, unknown>) =>
    call("turn_on", data, targets().map((entity) => entity.id));

  /* Zero turns the light off rather than setting it to nothing: a surface
     dragged all the way down means off, which is what it looks like. */
  const setLevel = (percent: number, ids: string[]) => {
    if (percent <= 0) call("turn_off", {}, ids);
    else call("turn_on", { brightness_pct: Math.max(1, percent) }, ids);
  };

  /** What the big surface reads: the picked lamps' average, or the room's. */
  const level = () => {
    const lit = (chosen() ?? props.lights).filter(isLit);
    if (!lit.length) return 0;
    return Math.round(
      lit.reduce((total, entity) => total + (brightnessOf(entity) ?? 100), 0) / lit.length,
    );
  };

  const heroOn = () => (chosen() ?? props.lights).some(isLit);
  const heroName = () => {
    const some = chosen();
    if (!some) return "Every light";
    if (some.length === 1) return some[0]!.friendlyName ?? some[0]!.id;
    return `${some.length} lights`;
  };
  /* What the brightness above is for: the chosen lamps, or how many are on. */
  const brightnessCap = () => {
    if (chosen()) return `Brightness · ${heroName()}`;
    return on() ? `Brightness · ${on()} of ${props.lights.length} on` : "Brightness";
  };
  /* The lamps' header: what is picked, else how many are on. */
  const lampsLine = () => {
    if (picked().length) return `${picked().length} selected`;
    return on() ? `${on()} on` : "All off";
  };
  /* What the controls act on, on a phone. */
  const aimLine = () => {
    if (picked().length > 1) return `${picked().length} lights selected`;
    return picked().length ? heroName() : "All lights · tap lamps to pick several";
  };
  const heroColour = () => {
    const some = chosen();
    if (!some) return colour();
    return some.length === 1 ? rowColour(some[0]!) : bulbColour(some);
  };

  const hs = () => attr<number[] | undefined>(lead(), "hs_color", undefined);
  const hue = () => hs()?.[0] ?? 32;
  const sat = () => hs()?.[1] ?? 45;

  const kelvin = () => attr<number | undefined>(lead(), "color_temp_kelvin", undefined);
  const minK = () => attr<number>(lead(), "min_color_temp_kelvin", 2200);
  const maxK = () => attr<number>(lead(), "max_color_temp_kelvin", 6500);

  const whiteAt = () => {
    const value = kelvin();
    if (value === undefined) return 50;
    const span = maxK() - minK();
    return span > 0 ? ((value - minK()) / span) * 100 : 50;
  };

  /* While the intensity is being dragged the whole overlay follows it — the
     number, the glow, the bulb — before the light has been told. */
  const [dragLevel, setDragLevel] = createSignal<number | undefined>();
  const shownLevel = () => dragLevel() ?? level();
  const shownOn = () => (dragLevel() !== undefined ? dragLevel()! > 0 : heroOn());

  /* Off when any of them is on, on when all are off — so a mixed selection
     goes one way together rather than each lamp flipping its own way. */
  const power = () => {
    const some = chosen() ?? props.lights;
    call(some.some(isLit) ? "turn_off" : "turn_on", {}, some.map((entity) => entity.id));
  };

  /* Colour in full — the wheel and the whites — is a sheet of its own over
     the overlay, on a tablet as on a phone: opened in place it made the
     overlay taller than the screen. */
  const [colourOpen, setColourOpen] = createSignal(false);

  const colourSheet = () => (
    <Show when={colourOpen()}>
      <div class="rb-ltm-colour">
        <header class="rb-sheet-head">
          <button class="rb-sheet-back" aria-label="Back" onClick={() => setColourOpen(false)}>
            <Icon icon="mdi:arrow-left" width="18" />
          </button>
          <h2 class="rb-sheet-title rb-truncate">Colour</h2>
        </header>
        <div class="rb-ltm-colour-body">
          <span class="rb-lt-cap">{heroName()}</span>
          <Show when={canColour(lead())}>
            <div class="rb-lt-wheel">
              <ColorWheel hue={hue()} sat={sat()} onPick={(h, s) => apply({ hs_color: [h, s] })} />
            </div>
          </Show>
          <Show when={canTemp(lead())}>
            <FillSlider
              class="rb-lt-white"
              value={whiteAt()}
              label="Colour temperature"
              onCommit={(value) =>
                apply({
                  color_temp_kelvin: Math.round(minK() + (value / 100) * (maxK() - minK())),
                })
              }
            >
              <span class="rb-lt-white-label">
                <Icon icon="mdi:white-balance-sunny" width="14" />White
              </span>
              <b>{kelvin() ? `${kelvin()} K` : "Drag to set"}</b>
            </FillSlider>
          </Show>
        </div>
      </div>
    </Show>
  );

  const tabletView = () => (
    <div
      class="rb-lt-panel"
      data-on={shownOn()}
      style={{
        "--rb-bulb": heroColour(),
        "--rb-lvl": `${shownOn() ? 0.3 + (shownLevel() / 100) * 0.7 : 0}`,
      }}
    >
      {/* The room behind it all: dark, lit by the lamp in its own colour, as
          strongly as the light is turned up. */}
      <div class="rb-lt-backdrop" aria-hidden="true" />
      <div class="rb-lt-lamp" aria-hidden="true">
        <GlobeLamp on={shownOn()} strength={shownLevel() / 100} color={heroColour()} />
      </div>

      <button
        class="rb-lt-toggle rb-ltm-power"
        data-on={heroOn()}
        role="switch"
        aria-checked={heroOn()}
        aria-label={`${heroName()} power`}
        onClick={power}
      />

      <div class="rb-lt-controls">
        <div class="rb-lt-col">
        <div class="rb-lt-field">
          <span class="rb-lt-cap">
            {brightnessCap()}
          </span>
          <b class="rb-lt-big">
            <Show when={shownOn()} fallback="Off">
              {Math.round(shownLevel())}
              <i>%</i>
            </Show>
          </b>
        </div>

        <section class="rb-lt-glass">
          <header class="rb-lt-glass-head">
            <span>Intensity</span>
            <b>{shownOn() ? `${Math.round(shownLevel())}%` : "Off"}</b>
          </header>
          <Intensity
            value={shownOn() ? level() : 0}
            label={`Brightness of ${heroName()}`}
            onLive={setDragLevel}
            onCommit={(value) => setLevel(value, targets().map((entity) => entity.id))}
          />
        </section>

        {/* Which lamp everything above is aimed at: the room, or one light. */}
        <section class="rb-lt-glass">
          <header class="rb-lt-glass-head">
            <span>Lamps</span>
            <b>
              {lampsLine()}
            </b>
          </header>
          <div class="rb-lt-lamps">
            <button class="rb-lt-lamp-chip" data-active={!picked().length} onClick={() => setPicked([])}>
              <i data-on={on() > 0} style={{ "--rb-bulb": colour() }} />
              <span class="rb-truncate">All lights</span>
            </button>
            <Keyed each={listed()}>
              {(entity) => (
                <button
                  class="rb-lt-lamp-chip"
                  data-active={isPicked(entity.id)}
                  onClick={() => togglePick(entity.id)}
                >
                  <i data-on={isLit(entity)} style={{ "--rb-bulb": rowColour(entity) }} />
                  <span class="rb-truncate">{entity.friendlyName ?? entity.id}</span>
                  <small>
                    {lampState(entity)}
                  </small>
                </button>
              )}
            </Keyed>
          </div>
        </section>

        </div>

        {/* Under the lamp: the colour and the scenes. */}
        <div class="rb-lt-col rb-lt-col--end">
        <Show when={canColour(lead()) || canTemp(lead())}>
          <section class="rb-lt-glass">
            <header class="rb-lt-glass-head">
              <span>Colour</span>
              <Show when={canColour(lead()) || canTemp(lead())}>
                <button class="rb-lt-more" onClick={() => setColourOpen(true)}>
                  Custom
                </button>
              </Show>
            </header>

            <Show when={canColour(lead())}>
              <div class="rb-lt-swatches">
                <For each={MOODS}>
                  {(mood) => (
                    <button
                      class="rb-lt-swatch"
                      style={{ "--mood": rgbCss(mood.hue, mood.sat) }}
                      title={mood.name}
                      aria-label={mood.name}
                      onClick={() => apply({ hs_color: [mood.hue, mood.sat] })}
                    />
                  )}
                </For>
              </div>
            </Show>

          </section>
        </Show>

        <Show when={props.scenes?.length}>
          <section class="rb-lt-glass">
            <header class="rb-lt-glass-head">
              <span>Scenes</span>
            </header>
            <div class="rb-lt-scene-row">
              <For each={props.scenes}>
                {(scene) => (
                  <button
                    class="rb-lt-scene"
                    onClick={() => void callService("scene", "turn_on", {}, { entity_id: scene.id })}
                  >
                    <Icon icon={safeIcon(scene.icon, "mdi:palette-outline")} width="16" />
                    <span class="rb-truncate">{scene.friendlyName ?? scene.id}</span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>
        </div>
      </div>

      {colourSheet()}
    </div>
  );

  /* ---------- the phone ----------
   *
   * The board's own header says Lights, with the power beside it. Under it a
   * tall slider on the left — its knob the bulb, a dashed line out to the
   * level in a ring — and the lamp hanging on the right; then the lamps as
   * chips to aim it all at, and the scenes and colours as tiles. Colour in
   * full, the wheel and the whites, is a sheet of its own. */

  const phoneView = () => (
    <div
      class="rb-lt-panel rb-ltm"
      data-on={shownOn()}
      style={{
        "--rb-bulb": heroColour(),
        "--rb-lvl": `${shownOn() ? 0.3 + (shownLevel() / 100) * 0.7 : 0}`,
      }}
    >
      <div class="rb-lt-backdrop" aria-hidden="true" />
      <div class="rb-lt-lamp" aria-hidden="true">
        <GlobeLamp on={shownOn()} strength={shownLevel() / 100} color={heroColour()} />
      </div>

      <button
        class="rb-lt-toggle rb-ltm-power"
        data-on={heroOn()}
        role="switch"
        aria-checked={heroOn()}
        aria-label={`${heroName()} power`}
        onClick={power}
      />

      <div class="rb-ltm-stage">
        <TallSlider
          value={shownOn() ? level() : 0}
          label={`Brightness of ${heroName()}`}
          onLive={setDragLevel}
          onCommit={(value) => setLevel(value, targets().map((entity) => entity.id))}
        />
      </div>

      {/* Which lamps: the room, or any number of them — each tap adds a lamp
          to the selection or takes it out, and the line above says what the
          slider, the power and the colour are acting on. */}
      <span class="rb-ltm-aim">
        {aimLine()}
      </span>
      <div class="rb-ltm-chips">
        <button class="rb-ltm-chip" data-active={!picked().length} onClick={() => setPicked([])}>
          All lights
        </button>
        <Keyed each={listed()}>
          {(entity) => (
            <button
              class="rb-ltm-chip"
              data-active={isPicked(entity.id)}
              data-on={isLit(entity)}
              style={{ "--rb-bulb": rowColour(entity) }}
              onClick={() => togglePick(entity.id)}
            >
              <i />
              {entity.friendlyName ?? entity.id}
              <Show when={isPicked(entity.id)}>
                <Icon icon="mdi:check" width="14" class="rb-ltm-chip-tick" />
              </Show>
            </button>
          )}
        </Keyed>
      </div>

      {/* The scenes, then the moods and the full colour. */}
      <div class="rb-ltm-tiles">
        <For each={props.scenes ?? []}>
          {(scene) => (
            <button
              class="rb-ltm-tile"
              onClick={() => void callService("scene", "turn_on", {}, { entity_id: scene.id })}
            >
              <span class="rb-ltm-tile-icon">
                <Icon icon={safeIcon(scene.icon, "mdi:palette-outline")} width="16" />
              </span>
              <span class="rb-ltm-tile-name rb-truncate">{scene.friendlyName ?? scene.id}</span>
            </button>
          )}
        </For>
        <Show when={canColour(lead())}>
          <For each={MOODS}>
            {(mood) => (
              <button
                class="rb-ltm-tile"
                onClick={() => apply({ hs_color: [mood.hue, mood.sat] })}
              >
                <span
                  class="rb-ltm-tile-icon rb-ltm-tile-swatch"
                  style={{ "--mood": rgbCss(mood.hue, mood.sat) }}
                />
                <span class="rb-ltm-tile-name rb-truncate">{mood.name}</span>
              </button>
            )}
          </For>
        </Show>
        <Show when={canColour(lead()) || canTemp(lead())}>
          <button class="rb-ltm-tile" data-accent="true" onClick={() => setColourOpen(true)}>
            <span class="rb-ltm-tile-icon">
              <Icon icon="mdi:palette-outline" width="16" />
            </span>
            <span class="rb-ltm-tile-name rb-truncate">Colour</span>
          </button>
        </Show>
      </div>

      {colourSheet()}
    </div>
  );

  return (
    <Show when={props.narrow} fallback={tabletView()}>
      {phoneView()}
    </Show>
  );
}

/**
 * A brightness being set by hand: the level as it moves, told to the light
 * once it stops, and held there a moment for the light to catch up — then
 * the light's own level again. The arrows move it a percent, Page Up and
 * Down ten.
 */
function useLevel(props: {
  value: number;
  onLive: (value: number | undefined) => void;
  onCommit: (value: number) => void;
}) {
  const [live, setLive] = createSignal<number | undefined>();
  const shown = () => live() ?? props.value;
  let settle: ReturnType<typeof setTimeout> | undefined;

  const show = (value: number | undefined) => {
    setLive(value);
    props.onLive(value);
  };

  const commit = (value: number) => {
    clearTimeout(settle);
    show(value);
    props.onCommit(value);
    settle = setTimeout(() => show(undefined), 1500);
  };

  onCleanup(() => clearTimeout(settle));

  const stepByKey = (event: KeyboardEvent) => {
    const delta = keyStep(event.key, 1, 10);
    if (!delta) return;
    event.preventDefault();
    commit(Math.max(0, Math.min(100, Math.round(shown()) + delta)));
  };

  /* A finger back on it: the light's level waits. */
  const hold = () => clearTimeout(settle);

  return { live, shown, show, commit, hold, stepByKey };
}

/**
 * The phone's brightness: a tall pill filling from the floor in the bulbs'
 * colour, its knob the bulb, with a dashed line out to the level in a ring.
 * A drag moves the level from where it is — geared, so a percent is a couple
 * of pixels — and never jumps to where the finger landed; the level shows as
 * it moves and the light is told once, when it stops.
 */
function TallSlider(props: {
  value: number;
  label: string;
  onLive: (value: number | undefined) => void;
  onCommit: (value: number) => void;
}) {
  const [held, setHeld] = createSignal(false);
  const { live, shown, show, commit, hold, stepByKey } = useLevel(props);
  let grab: { y: number; from: number; travel: number; moved: boolean } | undefined;

  return (
    <div
      class="rb-ltm-slider"
      role="slider"
      tabindex="0"
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(shown())}
      aria-valuemin={0}
      aria-valuemax={100}
      data-held={held()}
      style={{ "--f": `${shown() / 100}` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        hold();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const height = event.currentTarget.getBoundingClientRect().height;
        grab = { y: event.clientY, from: shown(), travel: Math.max(height * 1.3, 220), moved: false };
        setHeld(true);
      }}
      onPointerMove={(event) => {
        if (!grab) return;
        const dy = grab.y - event.clientY;
        if (!grab.moved && Math.abs(dy) < 3) return;
        grab.moved = true;
        show(Math.round(Math.max(0, Math.min(100, grab.from + (dy / grab.travel) * 100))));
      }}
      onPointerUp={() => {
        if (!grab) return;
        const moved = grab.moved;
        grab = undefined;
        setHeld(false);
        if (moved && live() !== undefined) commit(live()!);
      }}
      onPointerCancel={() => {
        grab = undefined;
        setHeld(false);
        show(undefined);
      }}
      onKeyDown={stepByKey}
    >
      <span class="rb-ltm-slider-track">
        <i class="rb-ltm-slider-fill" />
      </span>
      <span class="rb-ltm-slider-knob">
        <Icon icon={shown() > 0 ? "mdi:lightbulb-on-outline" : "mdi:lightbulb-outline"} width="17" />
      </span>
      <span class="rb-ltm-slider-line" />
      <span class="rb-ltm-slider-ring">{shown() > 0 ? `${Math.round(shown())}%` : "Off"}</span>
    </div>
  );
}

/**
 * The overlay's intensity: a hairline with a white knob and a row of ticks
 * under it. A tap puts the level where it landed and a drag follows the
 * finger; the level shows as it moves (onLive), the light is told once when
 * it stops, and the shown level holds until the light has caught up. Up and
 * down is left to the page, so the overlay still scrolls on a phone.
 */
function Intensity(props: {
  value: number;
  label: string;
  onLive: (value: number | undefined) => void;
  onCommit: (value: number) => void;
}) {
  const [held, setHeld] = createSignal(false);
  const { shown, show, commit, hold, stepByKey } = useLevel(props);
  let track: HTMLDivElement | undefined;

  const read = (event: PointerEvent) => {
    if (!track) return undefined;
    const box = track.getBoundingClientRect();
    if (!box.width) return undefined;
    return Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * 100);
  };

  return (
    <div
      ref={track}
      class="rb-lt-int"
      role="slider"
      tabindex="0"
      aria-label={props.label}
      aria-valuenow={Math.round(shown())}
      aria-valuemin={0}
      aria-valuemax={100}
      data-held={held()}
      style={{ "--v": `${shown()}%` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        hold();
        event.currentTarget.setPointerCapture(event.pointerId);
        setHeld(true);
        show(read(event));
      }}
      onPointerMove={(event) => {
        if (held()) show(read(event));
      }}
      onPointerUp={(event) => {
        if (!held()) return;
        setHeld(false);
        commit(read(event) ?? Math.round(shown()));
      }}
      onPointerCancel={() => {
        setHeld(false);
        show(undefined);
      }}
      onKeyDown={stepByKey}
    >
      <span class="rb-lt-int-track">
        <i class="rb-lt-int-fill" />
        <b class="rb-lt-int-knob" />
      </span>
      <span class="rb-lt-int-ticks" aria-hidden="true">
        <For each={Array.from({ length: 11 })}>{() => <i />}</For>
      </span>
    </div>
  );
}
