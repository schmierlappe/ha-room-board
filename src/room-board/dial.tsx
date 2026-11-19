import { Index, createMemo, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";

const TICKS = 56;

/* Cold to hot through amber rather than through hue rotation: interpolating
   the hue from blue to red runs the ruler through green and yellow and makes
   a rainbow of a temperature scale. Two straight mixes in RGB give the ramp
   everyone already reads as cold → warm → hot. */
const COLD: [number, number, number] = [79, 157, 255];
const WARM: [number, number, number] = [255, 176, 87];
const HOT: [number, number, number] = [255, 77, 61];

const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  a.map((channel, index) => Math.round(channel + (b[index]! - channel) * t)) as [
    number,
    number,
    number,
  ];

/** 0 (cold) to 1 (hot) → the colour that point on the ruler is drawn in. */
export function rampAt(position: number): string {
  const t = Math.max(0, Math.min(1, position));
  const [r, g, b] = t < 0.5 ? mix(COLD, WARM, t / 0.5) : mix(WARM, HOT, (t - 0.5) / 0.5);
  return `rgb(${r} ${g} ${b})`;
}

/**
 * The ruled dial.
 *
 * A row of ticks rather than a bar, because a temperature is a thing you set
 * by feel: the ruler swells under the handle and tapers away at both ends, so
 * the number being chosen has a shape as well as a position. Everything left
 * of the handle is warm-toned and everything right of it recedes, which is the
 * same cold → hot language the readout and the history chart already speak.
 *
 * The handle is drawn rather than left to the native thumb — a ring with a
 * glow and a grip cannot be expressed through ::-webkit-slider-thumb — so the
 * real input sits transparent on top of it and keeps the keyboard, the drag
 * and the accessibility that comes with a range.
 */
export function TickDial(props: {
  min: number;
  max: number;
  step: number;
  value: number;
  label?: string;
  /** Fired continuously while dragging, for the readout above. */
  onPreview: (value: number) => void;
  /** Fired on release, when the machine is actually told. */
  onCommit: (value: number) => void;
}) {
  /* Where the finger is, unrounded: the handle follows it without steps, and
     only the number (and what is sent) is rounded to the machine's step. */
  const [live, setLive] = createSignal<number | undefined>();
  const shown = () => live() ?? props.value;
  const snap = (value: number) => {
    const step = props.step > 0 ? props.step : 0.5;
    const snapped = Math.round((value - props.min) / step) * step + props.min;
    return Math.min(props.max, Math.max(props.min, Number(snapped.toFixed(2))));
  };
  const commit = (value: number) => {
    setLive(undefined);
    props.onCommit(snap(value));
  };

  const fill = createMemo(() => {
    const span = props.max - props.min;
    return span > 0 ? Math.max(0, Math.min(1, (shown() - props.min) / span)) : 0;
  });

  /* One pass over the ruler per change: each tick's height and weight come
     from how near it is to the handle, so the swell follows the finger. */
  const ticks = createMemo(() => {
    const at = fill();
    return Array.from({ length: TICKS }, (_, index) => {
      const position = index / (TICKS - 1);
      const distance = Math.abs(position - at);
      const swell = Math.exp(-((distance / 0.13) ** 2));
      // The ends of a ruler are its quietest part; without this the row reads
      // as a fence rather than a scale.
      const taper = Math.min(1, Math.sin(Math.PI * position) * 2.4 + 0.42);
      const passed = position <= at;

      return {
        height: (0.3 + 0.7 * swell) * taper,
        // Past the handle the ruler is lit in its own colour; ahead of it the
        // scale is still there but unclaimed.
        opacity: (passed ? 0.6 : 0.18) + 0.4 * swell,
        colour: passed ? rampAt(position) : "currentColor",
        passed,
      };
    });
  });

  return (
    <div
      class="rb-dial"
      data-held={live() !== undefined}
      style={{ "--fill": `${fill() * 100}%`, "--f": `${fill()}`, "--rb-tone": rampAt(fill()) }}
    >
      <div class="rb-dial-ticks" aria-hidden="true">
        <Index each={ticks()}>
          {(tick) => (
            <i
              data-passed={tick().passed}
              style={{
                height: `${tick().height * 100}%`,
                opacity: `${tick().opacity}`,
                background: tick().colour,
              }}
            />
          )}
        </Index>
      </div>

      <span class="rb-dial-glow" aria-hidden="true" />

      <span class="rb-dial-knob" aria-hidden="true">
        <Icon icon="mdi:arrow-left-right" width="13" />
      </span>

      <input
        type="range"
        min={props.min}
        max={props.max}
        step="any"
        value={shown()}
        aria-label={props.label ?? "Value"}
        aria-valuetext={`${snap(shown())}°`}
        onInput={(event) => {
          const value = Number(event.currentTarget.value);
          setLive(value);
          props.onPreview(snap(value));
        }}
        onChange={(event) => commit(Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          /* The keys step as the machine does; "any" would creep. */
          const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
          if (!by) return;
          event.preventDefault();
          commit(snap(shown()) + by * (props.step > 0 ? props.step : 0.5));
        }}
      />

      <div class="rb-dial-scale" aria-hidden="true">
        <span>{props.min}°</span>
        <span>{props.max}°</span>
      </div>
    </div>
  );
}
