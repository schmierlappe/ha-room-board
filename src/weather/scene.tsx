import { For, Index, Show, createUniqueId } from "solid-js";
import type { Scene } from "./util";

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
      <Atmosphere scene={props.scene} animate={props.animate} night={props.night} />
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
/* A raindrop by its depth — near, middle, far: its length in rem, its width,
   and the seconds it takes to fall. */
const DROP_DEPTH = [
  { length: 1.1, width: "0.13rem", fall: 0.62 },
  { length: 0.8, width: "0.1rem", fall: 0.85 },
  { length: 0.5, width: "0.07rem", fall: 1.15 },
];

function Atmosphere(props: { scene: Scene; animate?: boolean; night?: boolean }) {
  /* What the sky is: the moon stands in for the sun after dark, and a clear
     night earns its stars whether the condition called itself sunny or
     clear-night. */
  const lit = () => props.scene === "sun" || props.scene === "partly";
  const moonlit = () => props.scene === "moon" || (lit() && props.night === true);
  const starry = () => moonlit() && props.scene !== "partly";
  const clouded = () =>
    ["cloud", "partly", "rain", "snow", "storm", "wind"].includes(props.scene);
  const wet = () => props.scene === "rain" || props.scene === "storm";
  const drops = Array.from({ length: 22 }, (_, i) => i);
  const splashes = [0, 1, 2, 3, 4];
  const flakes = Array.from({ length: 13 }, (_, i) => i);
  /* A proper field rather than six dots, spread across the sky and varied in
     size — with the moon toned down, the stars are what make it read as
     night. Sizes in rem, delays offset so they never blink together. */
  const stars = [
    { x: 8, y: 14, s: 0.16, d: 0 },
    { x: 19, y: 30, s: 0.11, d: 1.6 },
    { x: 27, y: 9, s: 0.13, d: 2.9 },
    { x: 34, y: 22, s: 0.09, d: 0.7 },
    { x: 42, y: 36, s: 0.15, d: 2.1 },
    { x: 47, y: 12, s: 0.1, d: 3.4 },
    { x: 56, y: 27, s: 0.12, d: 1.1 },
    { x: 63, y: 8, s: 0.09, d: 2.5 },
    { x: 71, y: 34, s: 0.14, d: 0.4 },
    { x: 78, y: 18, s: 0.1, d: 3.1 },
    { x: 88, y: 40, s: 0.12, d: 1.9 },
    { x: 15, y: 46, s: 0.1, d: 2.7 },
    { x: 52, y: 48, s: 0.11, d: 0.9 },
    { x: 83, y: 6, s: 0.13, d: 2.3 },
  ];

  return (
    <div
      class="wx-atmos"
      data-scene={props.scene}
      data-night={props.night === true}
      data-animate={props.animate !== false}
    >
      <Show when={starry()}>
        <For each={stars}>
          {(s) => (
            <span
              class="wx-atmos-star"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                "--s": `${s.s}rem`,
                "animation-delay": `${s.d}s`,
              }}
            />
          )}
        </For>
      </Show>

      {/* The orb is first so the clouds drift across it. */}
      <Show when={lit() && !props.night}>
        <span class="wx-orb wx-orb--sun">
          <span class="wx-orb-glow" />
          <span class="wx-orb-rays" />
        </span>
      </Show>

      <Show when={moonlit()}>
        <span class="wx-orb wx-orb--moon">
          <span class="wx-orb-glow" />
        </span>
      </Show>

      {/* Cumulus silhouettes, not gradient masses: two bands of real cloud
          shapes, each twice or three times the card's width and translated by
          exactly one tile, so the sky scrolls left to right forever with no
          seam. The far band is smaller and slower, which is what reads as
          depth. Fog keeps the soft gradient — there the softness is the
          subject rather than a smudge over it. */}
      <Show when={clouded()}>
        <Clouds band="far" />
        <Clouds band="near" />
      </Show>

      <Show when={props.scene === "fog"}>
        <span class="wx-mist" />
      </Show>

      {/* Rain in three depths.
       *
       * Every drop is drawn along the line it travels — the element is tilted
       * and then moved down its own axis, so a streak and its path are the
       * same line. The old version fell straight and drifted sideways, which
       * is why it read as a curtain of ticks rather than as rain.
       *
       * Near drops are longer, brighter and quicker; far ones are short, dim
       * and slightly blurred, so the shower has depth instead of being one
       * flat sheet. */}
      <Show when={wet()}>
        <For each={drops}>
          {(i) => {
            const depth = i % 3;
            const far = depth === 2;
            const look = DROP_DEPTH[depth]!;
            return (
              <span
                class="wx-atmos-drop"
                data-depth={depth}
                style={{
                  left: `${-4 + i * 4.8 + jitter(i, 6) * 3}%`,
                  height: `${look.length + jitter(i, 2) * 0.45}rem`,
                  "--w": look.width,
                  "--blur": far ? "0.6px" : "0",
                  "animation-duration": `${look.fall + jitter(i, 1) * 0.25}s`,
                  "animation-delay": `${(-jitter(i, 5) * 1.6).toFixed(2)}s`,
                }}
              />
            );
          }}
        </For>

        {/* What the drops land on. A shower with no bottom to it is a screen
            saver; a few ripples along the floor make it weather. */}
        <For each={splashes}>
          {(i) => (
            <span
              class="wx-atmos-splash"
              style={{
                left: `${8 + i * 19 + jitter(i, 7) * 6}%`,
                "animation-duration": `${(1.1 + jitter(i, 8) * 0.5).toFixed(2)}s`,
                "animation-delay": `${(-jitter(i, 9) * 1.2).toFixed(2)}s`,
              }}
            />
          )}
        </For>
      </Show>

      <Show when={props.scene === "snow"}>
        <For each={flakes}>
          {(i) => {
            const size = (0.16 + jitter(i, 2) * 0.2).toFixed(2);
            return (
              <span
                class="wx-atmos-flake"
                style={{
                  left: `${2 + i * 7.4}%`,
                  width: `${size}rem`,
                  height: `${size}rem`,
                  "--o": (0.6 + jitter(i, 3) * 0.4).toFixed(2),
                  "--sway": `${(0.35 + jitter(i, 4) * 0.9).toFixed(2)}rem`,
                  "animation-duration": `${(4.4 + jitter(i, 1) * 3.6).toFixed(2)}s`,
                  "animation-delay": `${(-jitter(i, 5) * 7).toFixed(2)}s`,
                }}
              />
            );
          }}
        </For>
      </Show>

      {/* Lightning lights the sky, not just a glyph. */}
      <Show when={props.scene === "storm"}>
        <span class="wx-atmos-flash" />
      </Show>

      <Show when={props.scene === "wind"}>
        <span class="wx-streak wx-streak--1" />
        <span class="wx-streak wx-streak--2" />
        <span class="wx-streak wx-streak--3" />
      </Show>
    </div>
  );
}

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

/* The two bands: one 420×240 tile each, repeated across the band. Each
   tile holds a few clouds, each a cluster of puffs. */
const CLOUD_BANDS = {
  far: { tiles: 3, seed: 5, clouds: 6, puffs: [7, 11], radius: [8, 20], top: 70, depth: 120, blur: 7 },
  near: { tiles: 2, seed: 2, clouds: 4, puffs: [8, 12], radius: [12, 30], top: 90, depth: 110, blur: 9 },
} as const;

type Puff = { x: number; y: number; r: number };

/** A small seeded generator (mulberry32): the same clouds on every render. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** One tile's puffs, with a copy one tile to the left of any that run over
    its right edge, so the repeated tiles join without a seam. */
function tilePuffs(band: (typeof CLOUD_BANDS)[keyof typeof CLOUD_BANDS]): Puff[] {
  const random = seeded(band.seed);
  const between = (low: number, high: number) => low + random() * (high - low);
  const puffs: Puff[] = [];
  for (let c = 0; c < band.clouds; c++) {
    const cx = ((c + random() * 0.8) / band.clouds) * 420;
    const cy = band.top + random() * (band.depth - 40);
    const count = Math.round(between(band.puffs[0], band.puffs[1]));
    for (let i = 0; i < count; i++) {
      const r = between(band.radius[0], band.radius[1]);
      /* Flat underneath, heaped on top: the puffs spread sideways and rise
         from a common base. */
      puffs.push({ x: cx + between(-2.2, 2.2) * r, y: cy - random() * r * 0.9, r });
    }
  }
  const wrapped = puffs.filter((puff) => puff.x + puff.r > 420).map((puff) => ({ ...puff, x: puff.x - 420 }));
  return [...puffs, ...wrapped];
}

/**
 * A band of cloud: white puffs, blurred and then given a firm edge again by
 * an alpha curve (the "gooey" filter), used as a mask over the band's colour
 * (set in the stylesheet as the fill), so neighbouring puffs flow into one
 * cumulus silhouette.
 *
 * It was fractal noise (feTurbulence), first as a data: SVG in the
 * stylesheet's mask-image, which the sealed engine's stylesheet check
 * refuses, then drawn in the DOM, where the engine's element allowlist has
 * no feTurbulence. Blur and colour matrix are on it. Each tile sits in a
 * translated group, so the band still loops without a seam, and it is
 * stretched to its box like the mask was.
 */
function Clouds(props: { band: keyof typeof CLOUD_BANDS }) {
  const band = CLOUD_BANDS[props.band];
  const puffs = tilePuffs(band);
  const filter = createUniqueId();
  const mask = createUniqueId();
  const width = 420 * band.tiles;
  return (
    <svg
      class={`wx-clouds wx-clouds--${props.band}`}
      viewBox={`0 0 ${width} 240`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id={filter} x="-10%" y="-20%" width="120%" height="140%">
          <feGaussianBlur stdDeviation={band.blur} />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 6 -2.2" />
        </filter>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height="240">
          <Index each={Array.from({ length: band.tiles })}>
            {(_, i) => (
              <g transform={`translate(${i * 420} 0)`} filter={`url(#${filter})`}>
                <For each={puffs}>{(puff) => <circle cx={puff.x} cy={puff.y} r={puff.r} fill="#fff" />}</For>
              </g>
            )}
          </Index>
        </mask>
      </defs>
      <rect class="wx-clouds-fill" width={width} height="240" mask={`url(#${mask})`} />
    </svg>
  );
}
