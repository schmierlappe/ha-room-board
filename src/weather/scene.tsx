import { For, Index, Show, createUniqueId } from "solid-js";
import type { Scene } from "./util";
import { NaturalSky } from "./sky";

/**
 * Two renderings of the same weather.
 *
 * `inline` draws a crisp little pictogram — what a forecast row or a strip
 * entry needs to be legible at 24px.
 *
 * `background` draws an atmosphere instead: large, heavily blurred gradient
 * masses that drift. Geometry that reads well as an icon turns into flat pills
 * when blown up to fill a card, which is what the tile looked like before.
 *
 * Both are plain divs and CSS keyframes — no canvas, no sprite sheet, no
 * library.
 */
export function WeatherScene(props: {
  scene: Scene;
  size?: string;
  animate?: boolean;
  variant?: "inline" | "background";
  /**
   * Draw it after dark.
   *
   * Home Assistant reports "partlycloudy" and "sunny" the same way at
   * midnight as at noon — only `clear-night` says which half of the day it
   * is, and that one condition cannot carry the whole sky. So the sun
   * becomes the moon, the stars come out and the blue goes deep, decided by
   * whether the sun is below the horizon rather than by the condition.
   */
  night?: boolean;
}) {
  return (
    <Show
      when={props.variant === "background"}
      fallback={
        <InlineScene
          scene={props.scene}
          size={props.size}
          animate={props.animate}
          night={props.night}
        />
      }
    >
      <NaturalSky scene={props.scene} animate={props.animate} night={props.night} />
    </Show>
  );
}

/* ---------- the atmosphere ---------- */

/**
 * Deterministic 0..1 from an index. Real randomness would reshuffle every
 * particle on each re-render; this gives the same variation every time while
 * still looking unpatterned.
 */
const jitter = (i: number, salt = 1) => (((i + 1) * 9301 * salt + 49297) % 233280) / 233280;

/**
 * The backdrop draws the same defined shapes as the pictogram, scaled up and
 * spread across the card, rather than heavily blurred masses filling it.
 * The blurred version turned cloudy and fog into a smear across the whole
 * card; crisp edges over an ordinary card background read as weather.
 */
/* ---------- the small pictogram ---------- */

function InlineScene(props: { scene: Scene; size?: string; animate?: boolean; night?: boolean }) {
  const drops = [0, 1, 2, 3, 4, 5];
  const flakes = [0, 1, 2, 3, 4, 5];
  const stars = [
    { x: 18, y: 22, d: 0 },
    { x: 74, y: 16, d: 0.8 },
    { x: 86, y: 46, d: 1.6 },
    { x: 30, y: 62, d: 2.2 },
  ];

  return (
    <div
      class="wx-scene"
      data-scene={props.scene}
      data-night={props.night === true}
      data-animate={props.animate !== false}
      data-variant="inline"
      style={{ "--wx-size": props.size ?? "5rem" }}
    >
      <Show when={(props.scene === "sun" || props.scene === "partly") && !props.night}>
        <span class="wx-sun">
          <span class="wx-rays" />
          <span class="wx-disc" />
        </span>
      </Show>

      <Show
        when={
          props.scene === "moon" ||
          ((props.scene === "sun" || props.scene === "partly") && props.night === true)
        }
      >
        <span class="wx-moon" />
        <For each={props.scene === "partly" ? [] : stars}>
          {(s) => (
            <span
              class="wx-star"
              style={{ left: `${s.x}%`, top: `${s.y}%`, "animation-delay": `${s.d}s` }}
            />
          )}
        </For>
      </Show>

      <Show
        when={
          props.scene === "cloud" ||
          props.scene === "partly" ||
          props.scene === "rain" ||
          props.scene === "snow" ||
          props.scene === "storm" ||
          props.scene === "wind"
        }
      >
        <span class="wx-cloud wx-cloud--back" />
        <span class="wx-cloud wx-cloud--front" />
      </Show>

      {/* Rain: short slanted streaks from under the cloud, in two staggered
          rows, measured against the icon itself — sized in rem they were a
          third of a forecast icon's height and spread across all of it, so
          at that size the rain read as faint stripes rather than rain. */}
      <Show when={props.scene === "rain" || props.scene === "storm"}>
        <For each={drops}>
          {(i) => (
            <span
              class="wx-drop"
              style={{
                left: `${31 + (i % 3) * 15 + (i >= 3 ? 7 : 0)}%`,
                top: `${i >= 3 ? 66 : 61}%`,
                "animation-duration": `${(0.82 + jitter(i, 1) * 0.22).toFixed(2)}s`,
                "animation-delay": `${(-(i * 0.17 + jitter(i, 3) * 0.2)).toFixed(2)}s`,
              }}
            />
          )}
        </For>
      </Show>

      <Show when={props.scene === "snow"}>
        <For each={flakes}>
          {(i) => (
            <span
              class="wx-flake"
              style={{ left: `${16 + i * 13}%`, "animation-delay": `${(i % 3) * 0.9}s` }}
            />
          )}
        </For>
      </Show>

      <Show when={props.scene === "storm"}>
        <span class="wx-bolt" />
      </Show>

      <Show when={props.scene === "fog"}>
        <span class="wx-fog wx-fog--1" />
        <span class="wx-fog wx-fog--2" />
        <span class="wx-fog wx-fog--3" />
      </Show>

      <Show when={props.scene === "wind"}>
        <span class="wx-gust wx-gust--1" />
        <span class="wx-gust wx-gust--2" />
      </Show>
    </div>
  );
}
