import { createSignal, onCleanup } from "solid-js";

/* ---------- colour maths ---------- */

/** Hue 0–360, saturation 0–100 → "r, g, b", at full value. */
export function hsToRgb(hue: number, sat: number): [number, number, number] {
  const s = Math.max(0, Math.min(100, sat)) / 100;
  const h = ((hue % 360) + 360) % 360;
  const c = s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - c;

  /* The six sixty-degree slices of the wheel, in order. */
  const slices = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = slices[Math.floor(h / 60)] ?? slices[5]!;

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const rgbCss = (hue: number, sat: number) => `rgb(${hsToRgb(hue, sat).join(", ")})`;

/**
 * A hue/saturation wheel.
 *
 * Hue runs clockwise from the top and saturation outwards from the middle, so
 * the geometry and the CSS gradient are the same statement twice — the knob
 * sits exactly on the colour underneath it without a lookup table.
 *
 * The light is told only on release. A pointermove fires dozens of times in a
 * drag across the wheel, and a Zigbee bulb answers every one of them.
 */
export function ColorWheel(props: {
  hue: number;
  sat: number;
  onPick: (hue: number, sat: number) => void;
}) {
  const [drag, setDrag] = createSignal<{ hue: number; sat: number } | undefined>();
  let disc: HTMLDivElement | undefined;

  const hue = () => drag()?.hue ?? props.hue;
  const sat = () => drag()?.sat ?? props.sat;

  const read = (event: PointerEvent) => {
    if (!disc) return undefined;
    const box = disc.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const radius = Math.min(box.width, box.height) / 2;
    if (radius <= 0) return undefined;

    // Clockwise from twelve o'clock, which is where the conic gradient starts.
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return {
      hue: (angle + 360) % 360,
      sat: Math.min(100, (Math.hypot(dx, dy) / radius) * 100),
    };
  };

  const move = (event: PointerEvent) => {
    const point = read(event);
    if (point) setDrag(point);
  };

  /* Captured on the disc rather than listened for on window, which the
     sealed engine does not provide; a captured pointer still reports when it
     leaves the disc. */
  const release = () => {
    disc?.removeEventListener("pointermove", move);
    disc?.removeEventListener("pointerup", end);
    disc?.removeEventListener("pointercancel", end);
  };

  const end = (event: PointerEvent) => {
    const point = read(event) ?? drag();
    release();
    setDrag(undefined);
    if (point) props.onPick(Math.round(point.hue), Math.round(point.sat));
  };

  const start = (event: PointerEvent) => {
    event.preventDefault();
    const point = read(event);
    if (point) setDrag(point);
    disc?.setPointerCapture?.(event.pointerId);
    disc?.addEventListener("pointermove", move);
    disc?.addEventListener("pointerup", end);
    disc?.addEventListener("pointercancel", end);
  };

  onCleanup(release);

  const knob = () => {
    const radians = (hue() * Math.PI) / 180;
    const distance = Math.min(100, sat()) / 2;
    return {
      left: `${50 + Math.sin(radians) * distance}%`,
      top: `${50 - Math.cos(radians) * distance}%`,
    };
  };

  return (
    <div class="rb-wheel" ref={disc} onPointerDown={start}>
      <div class="rb-wheel-disc" />
      <span
        class="rb-wheel-knob"
        style={{ ...knob(), "--pick": rgbCss(hue(), sat()) }}
        aria-hidden="true"
      />
    </div>
  );
}
