import { For, Show, createUniqueId, onCleanup, onMount } from "solid-js";
import type { Scene } from "./util";

/**
 * The weather as a sky, filling a card.
 *
 * Two kinds of drawing, each for what it is good at:
 *
 * - Clouds are SVG fractal noise (feTurbulence) turned into cover — dense
 *   where the noise is high, open sky where it is low — and lit from above
 *   with feDiffuseLighting, so a cloud has a bright crown and a shaded
 *   underside instead of being a flat shape. Each layer is two identical
 *   tiles (stitched noise repeats at its edges) slid by one tile, so it
 *   drifts forever without a seam, on the compositor.
 * - Rain, snow, stars, lightning and gusts are particles on one canvas: a
 *   few hundred drops at different depths, each with its own speed, length
 *   and brightness, slanted by the wind and splashing where they land.
 *
 * The canvas runs only while the card is on screen and the page is visible,
 * and draws one still frame for `animate={false}` or a reduced-motion
 * setting.
 */
export function NaturalSky(props: { scene: Scene; night?: boolean; animate?: boolean }) {
  const clouded = () => props.scene !== "sun" && props.scene !== "moon";
  const lit = () => props.scene === "sun" || props.scene === "partly";
  const moonlit = () => props.scene === "moon" || (lit() && props.night === true);
  const layers = (): CloudKind[] => (props.scene === "fog" ? ["fog-far", "fog-near"] : ["far", "near"]);

  return (
    <div
      class="wx-atmos wx-sky"
      data-scene={props.scene}
      data-night={props.night === true}
      data-animate={props.animate !== false}
    >
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

      <Show when={clouded()}>
        <For each={layers()}>{(kind) => <CloudLayer kind={kind} scene={props.scene} />}</For>
      </Show>

      <span class="wx-sky-flash" />
      <SkyCanvas scene={props.scene} night={props.night === true} animate={props.animate !== false} />
    </div>
  );
}

/* ---------- clouds ---------- */

type CloudKind = "far" | "near" | "fog-far" | "fog-near";

/** How a layer of cloud looks: the noise's frequency (x, y — lower is
    bigger clouds, unequal is streakier), how much of the sky it covers
    (alpha = gain × noise − cut), the relief of the lighting, and a seed. */
type Look = { freq: string; gain: number; cut: number; relief: number; seed: number };

const LOOKS: Record<string, Partial<Record<CloudKind, Look>>> = {
  partly: {
    far: { freq: "0.0029 0.0078", gain: 4.6, cut: 2.5, relief: 6, seed: 7 },
    near: { freq: "0.0021 0.0059", gain: 5, cut: 2.72, relief: 8, seed: 3 },
  },
  cloud: {
    far: { freq: "0.0026 0.0072", gain: 3, cut: 1.05, relief: 5, seed: 11 },
    near: { freq: "0.0020 0.0052", gain: 3.2, cut: 1.25, relief: 8, seed: 4 },
  },
  rain: {
    far: { freq: "0.0026 0.0065", gain: 2.8, cut: 0.7, relief: 5, seed: 21 },
    near: { freq: "0.0020 0.0049", gain: 3, cut: 0.95, relief: 9, seed: 8 },
  },
  storm: {
    far: { freq: "0.0027 0.0065", gain: 2.8, cut: 0.55, relief: 6, seed: 31 },
    near: { freq: "0.0018 0.0046", gain: 3.1, cut: 0.8, relief: 11, seed: 13 },
  },
  snow: {
    far: { freq: "0.0026 0.0072", gain: 2.8, cut: 0.8, relief: 4, seed: 17 },
    near: { freq: "0.0020 0.0052", gain: 3, cut: 1.05, relief: 6, seed: 6 },
  },
  wind: {
    far: { freq: "0.0016 0.0143", gain: 3.2, cut: 1.6, relief: 4, seed: 9 },
    near: { freq: "0.0012 0.0104", gain: 3.4, cut: 1.75, relief: 6, seed: 2 },
  },
  fog: {
    "fog-far": { freq: "0.0014 0.0117", gain: 2.2, cut: 0.55, relief: 1, seed: 5 },
    "fog-near": { freq: "0.0010 0.0091", gain: 2.4, cut: 0.75, relief: 1, seed: 12 },
  },
};

/* One tile, in the SVG's own units; the layer is two of them side by side. */
const TILE_W = 800;
const TILE_H = 400;

function CloudLayer(props: { kind: CloudKind; scene: Scene }) {
  const id = createUniqueId();
  const look = () => LOOKS[props.scene]?.[props.kind] ?? LOOKS.cloud!.near!;
  const matrix = () => `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${look().gain} 0 0 0 ${-look().cut}`;
  return (
    <svg
      class={`wx-sky-clouds wx-sky-clouds--${props.kind}`}
      viewBox={`0 0 ${TILE_W * 2} ${TILE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter
          id={id}
          x="0"
          y="0"
          width="1"
          height="1"
          primitiveUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={look().freq}
            numOctaves="4"
            seed={look().seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="matrix" values={matrix()} result="cover" />
          <feGaussianBlur in="cover" stdDeviation="4.5" result="soft" />
          {/* Lit from above: the cover's density is the relief, so the thick
              middle of a cloud stands up and its underside falls into shade. */}
          <feDiffuseLighting in="soft" surfaceScale={look().relief * 0.35} diffuseConstant="1.05" lighting-color="#ffffff" result="light">
            <feDistantLight azimuth="270" elevation="62" />
          </feDiffuseLighting>
          <feFlood class="wx-sky-tint" result="tint" />
          <feBlend in="light" in2="tint" mode="multiply" result="shaded" />
          <feComposite in="shaded" in2="soft" operator="in" />
        </filter>
      </defs>
      <rect x="0" y="0" width={TILE_W} height={TILE_H} filter={`url(#${id})`} />
      <rect x={TILE_W} y="0" width={TILE_W} height={TILE_H} filter={`url(#${id})`} />
    </svg>
  );
}

/* ---------- rain, snow, stars, lightning, wind ---------- */

type Drop = { x: number; y: number; z: number; len: number; speed: number };
type Splash = { x: number; y: number; z: number; age: number };
type Flake = { x: number; y: number; z: number; r: number; speed: number; sway: number; phase: number };
type Star = { x: number; y: number; r: number; phase: number; rate: number };
type Gust = { x: number; y: number; len: number; speed: number; life: number; age: number };
type Bolt = { points: [number, number][]; age: number };

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function SkyCanvas(props: { scene: Scene; night: boolean; animate: boolean }) {
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let drops: Drop[] = [];
    let splashes: Splash[] = [];
    let flakes: Flake[] = [];
    let stars: Star[] = [];
    let gusts: Gust[] = [];
    let bolt: Bolt | undefined;
    let nextBolt = 2 + Math.random() * 4;
    let made = "";
    let frame = 0;
    let last = 0;
    let visible = true;
    const flash = canvas.parentElement?.querySelector<HTMLElement>(".wx-sky-flash") ?? undefined;

    const scene = () => props.scene;
    const wet = () => scene() === "rain" || scene() === "storm";
    const storm = () => scene() === "storm";
    /* The slant the wind gives the rain, as dx per unit of fall. */
    const slant = () => (storm() ? -0.32 : -0.16);

    /** The particles for this scene and size, made again when either changes. */
    const make = () => {
      const key = `${scene()}|${props.night}|${w}x${h}`;
      if (key === made) return;
      made = key;
      const area = w * h;
      drops = [];
      splashes = [];
      flakes = [];
      stars = [];
      gusts = [];
      if (wet()) {
        const count = Math.round((area / 480) * (storm() ? 1.5 : 1));
        for (let i = 0; i < Math.min(count, 420); i++) drops.push(newDrop(true));
      }
      if (scene() === "snow") {
        const count = Math.round(area / 1500);
        for (let i = 0; i < Math.min(count, 260); i++) flakes.push(newFlake(true));
      }
      /* A clear night has its stars whatever the sun says; a "sunny"
         condition after dark too. */
      if (scene() === "moon" || (props.night && scene() === "sun")) {
        const count = Math.round(area / 2600);
        for (let i = 0; i < Math.min(count, 160); i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h * 0.75,
            r: 0.35 + Math.random() ** 3 * 1.2,
            phase: Math.random() * Math.PI * 2,
            rate: 0.6 + Math.random() * 1.6,
          });
        }
      }
    };

    const newDrop = (anywhere: boolean): Drop => {
      const z = 0.25 + Math.random() * 0.75;
      const speed = (520 + 980 * z) * (storm() ? 1.15 : 1);
      return {
        /* Started up-wind of the card, so the slant still covers it all. */
        x: Math.random() * (w + h * Math.abs(slant())),
        y: anywhere ? Math.random() * h : -Math.random() * h * 0.3,
        z,
        len: 9 + 24 * z,
        speed,
      };
    };

    const newFlake = (anywhere: boolean): Flake => {
      const z = 0.2 + Math.random() * 0.8;
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : -6,
        z,
        r: 0.7 + 2.3 * z,
        speed: 14 + 46 * z,
        sway: 6 + Math.random() * 22,
        phase: Math.random() * Math.PI * 2,
      };
    };

    /** A jagged bolt from the top towards the middle, with a branch or two. */
    const newBolt = (): Bolt => {
      const points: [number, number][] = [];
      let x = w * (0.2 + Math.random() * 0.6);
      let y = 0;
      const end = h * (0.45 + Math.random() * 0.3);
      while (y < end) {
        points.push([x, y]);
        y += 8 + Math.random() * 16;
        x += (Math.random() - 0.5) * 22;
      }
      points.push([x, end]);
      return { points, age: 0 };
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(box.width));
      h = Math.max(1, Math.round(box.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      make();
      if (!running()) draw(0, 0);
    };

    const step = (dt: number) => {
      if (wet()) {
        const s = slant();
        for (const drop of drops) {
          drop.y += drop.speed * dt;
          drop.x += drop.speed * dt * s;
          if (drop.y > h * (0.82 + drop.z * 0.18)) {
            if (drop.z > 0.45 && splashes.length < 60) splashes.push({ x: drop.x, y: drop.y, z: drop.z, age: 0 });
            Object.assign(drop, newDrop(false));
          }
        }
        for (const splash of splashes) splash.age += dt;
        splashes = splashes.filter((splash) => splash.age < 0.32);
      }
      if (scene() === "snow") {
        for (const flake of flakes) {
          flake.y += flake.speed * dt;
          flake.phase += dt * (0.6 + flake.z * 0.8);
          if (flake.y > h + 6) Object.assign(flake, newFlake(false));
        }
      }
      if (scene() === "wind") {
        if (gusts.length < 7 && Math.random() < dt * 2.2) {
          gusts.push({
            x: -w * 0.3,
            y: h * (0.15 + Math.random() * 0.7),
            len: w * (0.18 + Math.random() * 0.3),
            speed: w * (0.9 + Math.random() * 0.8),
            life: 1.2 + Math.random(),
            age: 0,
          });
        }
        for (const gust of gusts) {
          gust.age += dt;
          gust.x += gust.speed * dt;
        }
        gusts = gusts.filter((gust) => gust.age < gust.life);
      }
      if (storm()) {
        nextBolt -= dt;
        if (nextBolt <= 0) {
          bolt = newBolt();
          nextBolt = 4 + Math.random() * 8;
          flash?.animate(
            [{ opacity: 0 }, { opacity: 0.85, offset: 0.06 }, { opacity: 0.1, offset: 0.2 }, { opacity: 0.6, offset: 0.3 }, { opacity: 0 }],
            { duration: 900, easing: "ease-out" },
          );
        }
        if (bolt) {
          bolt.age += dt;
          if (bolt.age > 0.45) bolt = undefined;
        }
      }
    };

    const draw = (t: number, _dt: number) => {
      ctx.clearRect(0, 0, w, h);

      for (const star of stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(t * star.rate + star.phase);
        ctx.globalAlpha = 0.25 + 0.65 * twinkle;
        ctx.fillStyle = "#f4f7ff";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (wet()) {
        const s = slant();
        ctx.lineCap = "round";
        for (const drop of drops) {
          const tail = drop.len;
          const gradient = ctx.createLinearGradient(drop.x, drop.y, drop.x - s * tail, drop.y - tail);
          const alpha = 0.12 + 0.5 * drop.z;
          gradient.addColorStop(0, `rgba(214, 228, 250, ${alpha})`);
          gradient.addColorStop(1, "rgba(214, 228, 250, 0)");
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 0.6 + 1.1 * drop.z;
          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y);
          ctx.lineTo(drop.x - s * tail, drop.y - tail);
          ctx.stroke();
        }
        for (const splash of splashes) {
          const p = splash.age / 0.32;
          ctx.globalAlpha = (1 - p) * 0.5 * splash.z;
          ctx.strokeStyle = "#dfeaff";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.ellipse(splash.x, splash.y, 1 + p * 7 * splash.z, 0.5 + p * 2 * splash.z, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      if (scene() === "snow") {
        for (const flake of flakes) {
          const x = flake.x + Math.sin(flake.phase) * flake.sway;
          const glow = ctx.createRadialGradient(x, flake.y, 0, x, flake.y, flake.r * 1.8);
          const alpha = 0.35 + 0.6 * flake.z;
          glow.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
          glow.addColorStop(0.55, `rgba(255, 255, 255, ${alpha * 0.55})`);
          glow.addColorStop(1, "rgba(255, 255, 255, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, flake.y, flake.r * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const gust of gusts) {
        const fade = Math.sin((gust.age / gust.life) * Math.PI);
        const gradient = ctx.createLinearGradient(gust.x, 0, gust.x + gust.len, 0);
        gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        gradient.addColorStop(0.6, `rgba(255, 255, 255, ${0.28 * fade})`);
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(gust.x, gust.y);
        ctx.quadraticCurveTo(gust.x + gust.len * 0.5, gust.y - 5, gust.x + gust.len, gust.y + 2);
        ctx.stroke();
      }

      if (bolt) {
        const fade = 1 - bolt.age / 0.45;
        ctx.save();
        ctx.strokeStyle = `rgba(235, 240, 255, ${fade})`;
        ctx.shadowColor = "rgba(190, 210, 255, 0.9)";
        ctx.shadowBlur = 14;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.beginPath();
        bolt.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.restore();
      }
    };

    const running = () => props.animate && !reducedMotion() && visible && !document.hidden;

    const loop = (now: number) => {
      frame = 0;
      if (!running()) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      make();
      step(dt);
      draw(now / 1000, dt);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame || !running()) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const sight = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    sight.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    start();
    /* The scene changing redraws even when still (no animation). */
    const watch = setInterval(() => {
      if (!running()) {
        make();
        draw(performance.now() / 1000, 0);
      }
    }, 1000);

    onCleanup(() => {
      stop();
      clearInterval(watch);
      sizes.disconnect();
      sight.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    });
  });

  return <canvas ref={canvas} class="wx-sky-canvas" aria-hidden="true" />;
}
