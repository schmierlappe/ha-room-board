import { Index, Show } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";

/**
 * The thermostat itself, drawn after a modern round wall unit.
 *
 * A thin machined bezel round a black glass face, and on the face a ring of
 * fine ticks — the scale. The ticks between the room's temperature and the
 * one asked for light up in the colour of the work being done, which is the
 * one thing such a thermostat shows that a number cannot: how far there is
 * still to go, and which way. The setpoint is the long bright tick, the room
 * a white bead on the ring, and in the middle of the glass the state as a
 * mark of its own, moving while the machine works.
 *
 * The numbers stay on the card: at this size the dial is the picture, not the
 * readout.
 */

const SPAN = 270;
const START = 135;
const COUNT = 54;
const INNER = 34.5;
const OUTER = 40.5;

/** Where a value sits on the scale, 0 at the bottom left, 1 at the bottom right. */
const fraction = (value: number, min: number, max: number) =>
  max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

/* Every tick's angle, clockwise from the bottom left, and its share of the
   scale. Angles are SVG's: 0 at three o'clock. */
const TICKS = Array.from({ length: COUNT + 1 }, (_, index) => ({
  share: index / COUNT,
  angle: START + (index * SPAN) / COUNT,
}));

const point = (angle: number, radius: number) => {
  const radians = (angle * Math.PI) / 180;
  return { x: 50 + Math.cos(radians) * radius, y: 50 + Math.sin(radians) * radius };
};

/** The state, as the mark in the middle of the glass and on the card. */
export const ACTION_ICONS: Record<string, string> = {
  heating: "mdi:fire",
  cooling: "mdi:snowflake",
  drying: "mdi:water",
  fan: "mdi:fan",
  idle: "mdi:thermostat",
  off: "mdi:power",
};

export function StateGlyph(props: { action: string; width?: string; still?: boolean }) {
  return (
    <span
      class="rb-clim-glyph"
      data-action={props.action}
      data-still={props.still === true}
      aria-hidden="true"
    >
      <Icon icon={ACTION_ICONS[props.action] ?? ACTION_ICONS.idle!} width={props.width ?? "16"} />
    </span>
  );
}

export function Thermostat(props: {
  /** What it is set to, and what the room actually is. */
  target?: number;
  current?: number;
  min: number;
  max: number;
  /** "hot" | "cold" | "dry" | "idle" — the colour the card is already using. */
  tone: string;
  /** Whether the machine is working, not merely switched on. */
  running: boolean;
  /** Off shows the scale and the room, and nothing lit. */
  on: boolean;
  /** heating, cooling, drying, fan, idle or off — the mark in the middle. */
  action: string;
}) {
  const set = () =>
    props.target === undefined ? undefined : fraction(props.target, props.min, props.max);
  const now = () =>
    props.current === undefined ? undefined : fraction(props.current, props.min, props.max);

  /* The stretch still to go: from the room to the setpoint, whichever way
     round. Lit only while there is work being done; switched on and waiting,
     only the setpoint shows. */
  const lit = (share: number) => {
    const a = now();
    const b = set();
    if (!props.on || !props.running || a === undefined || b === undefined) return false;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    return share >= low - 0.5 / COUNT && share <= high + 0.5 / COUNT;
  };

  const setAngle = () => START + (set() ?? 0) * SPAN;
  const nowAngle = () => START + (now() ?? 0) * SPAN;

  return (
    <div
      class="rb-therm"
      data-tone={props.tone}
      data-running={props.running}
      data-on={props.on}
    >
      {/* The glow behind it while it works. */}
      <span class="rb-therm-halo" aria-hidden="true" />
      <span class="rb-therm-face" aria-hidden="true" />

      <svg class="rb-therm-ring" viewBox="0 0 100 100" aria-hidden="true">
        <Index each={TICKS}>
          {(tick) => {
            const inner = () => point(tick().angle, INNER);
            const outer = () => point(tick().angle, OUTER);
            return (
              <line
                x1={inner().x}
                y1={inner().y}
                x2={outer().x}
                y2={outer().y}
                data-lit={lit(tick().share)}
              />
            );
          }}
        </Index>

        {/* The setpoint: the long bright tick, reaching in past the scale. */}
        <Show when={props.on && set() !== undefined}>
          <line
            class="rb-therm-set"
            x1={point(setAngle(), INNER - 5).x}
            y1={point(setAngle(), INNER - 5).y}
            x2={point(setAngle(), OUTER + 1).x}
            y2={point(setAngle(), OUTER + 1).y}
          />
        </Show>

        {/* Where the room is: a bead on the ring. */}
        <Show when={now() !== undefined}>
          <circle
            class="rb-therm-now"
            cx={point(nowAngle(), (INNER + OUTER) / 2).x}
            cy={point(nowAngle(), (INNER + OUTER) / 2).y}
            r="2.4"
          />
        </Show>
      </svg>

      {/* The glass's own light: a soft reflection across the top. */}
      <span class="rb-therm-gloss" aria-hidden="true" />

      <span class="rb-therm-centre">
        <StateGlyph action={props.action} still={!props.running} width="1em" />
        {/* The setpoint on the glass — shown only where the unit is drawn
            large enough to carry it (the standing card). */}
        <span class="rb-therm-num">
          {props.target === undefined ? "—" : props.target.toFixed(1)}
          <i>°</i>
        </span>
      </span>
    </div>
  );
}
