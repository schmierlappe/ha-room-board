import { createUniqueId } from "solid-js";
import { levelOf } from "./model";

/**
 * One of the console's readings — CPU, memory, temperature — as a gauge:
 * three quarters of a circle filled to the value, the value in the middle,
 * what it is in the opening at the foot. Each reading in its own colour
 * while there is headroom; amber when busy, red when it is running out.
 */
export function Gauge(props: {
  label: string;
  value: number;
  unit: string;
  /** What a full arc is; 100 for a percentage. */
  max?: number;
  warn: number;
  alarm: number;
  /** The reading's own colour while calm. */
  hue: "blue" | "violet" | "teal";
}) {
  const id = createUniqueId();
  const share = () => Math.max(0, Math.min(1, props.value / (props.max ?? 100)));
  const tone = () => levelOf(props.value, props.warn, props.alarm);
  /* From the lower left round to the lower right, clockwise: 270°. With a
     path length of 100 the dash is the share in percent. */
  const arc = "M21.72 78.28 A40 40 0 1 1 78.28 78.28";
  return (
    <div class="uf-gauge" data-tone={tone()} data-hue={props.hue}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" class="uf-gauge-from" />
            <stop offset="1" class="uf-gauge-to" />
          </linearGradient>
        </defs>
        <path class="uf-gauge-track" d={arc} pathLength="100" />
        <path
          class="uf-gauge-arc"
          d={arc}
          pathLength="100"
          stroke={`url(#${id})`}
          stroke-dasharray={`${(share() * 100).toFixed(1)} 100`}
        />
      </svg>
      <b class="uf-gauge-value">
        {Math.round(props.value)}
        <i>{props.unit}</i>
      </b>
      <span class="uf-gauge-label">{props.label}</span>
    </div>
  );
}
