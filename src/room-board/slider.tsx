import { createSignal, onCleanup, type JSX } from "solid-js";
import { keyStep } from "../keys";

/**
 * A surface that is its own slider.
 *
 * Dragging the tile rather than a 4px track is how every phone's own light
 * control works, and it is the difference between aiming at a thumb and just
 * pushing the light up. The fill is the readout, so there is no separate bar
 * to keep in step with it.
 *
 * The light is told on release. A drag is dozens of pointer events and a
 * Zigbee bulb answers every one of them, so the fill follows the finger
 * locally and the command goes once.
 */
export function FillSlider(props: {
  /** 0–100. */
  value: number;
  vertical?: boolean;
  label: string;
  /** "r g b" — what the fill is painted in. */
  color?: string;
  class?: string;
  children?: JSX.Element;
  onCommit: (value: number) => void;
}) {
  const [live, setLive] = createSignal<number | undefined>();
  const [held, setHeld] = createSignal(false);
  let surface: HTMLDivElement | undefined;

  const shown = () => live() ?? props.value;

  const read = (event: PointerEvent) => {
    if (!surface) return undefined;
    const box = surface.getBoundingClientRect();
    const fraction = props.vertical
      ? 1 - (event.clientY - box.top) / box.height
      : (event.clientX - box.left) / box.width;
    return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  };

  const move = (event: PointerEvent) => {
    const value = read(event);
    if (value !== undefined) setLive(value);
  };

  /* The drag follows the pointer by capturing it on the surface, not by
     listening on window: in the sealed engine window is a stand-in with no
     events, and a captured pointer keeps reporting outside the surface the
     same way. */
  const release = () => {
    surface?.removeEventListener("pointermove", move);
    surface?.removeEventListener("pointerup", end);
    surface?.removeEventListener("pointercancel", end);
  };

  const end = (event: PointerEvent) => {
    const value = read(event) ?? live();
    release();
    setHeld(false);
    setLive(undefined);
    if (value !== undefined) props.onCommit(value);
  };

  const start = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setHeld(true);
    const value = read(event);
    if (value !== undefined) setLive(value);
    surface?.setPointerCapture?.(event.pointerId);
    surface?.addEventListener("pointermove", move);
    surface?.addEventListener("pointerup", end);
    surface?.addEventListener("pointercancel", end);
  };

  onCleanup(release);

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(100, shown() + delta));
    setLive(next);
    props.onCommit(next);
    setLive(undefined);
  };

  return (
    <div
      ref={surface}
      class={`rb-fill ${props.class ?? ""}`}
      data-vertical={props.vertical === true}
      data-held={held()}
      style={{ "--fill": `${shown()}%`, "--rb-bulb": props.color ?? "255 186 120" }}
      role="slider"
      tabindex="0"
      aria-label={props.label}
      aria-valuenow={Math.round(shown())}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={start}
      onKeyDown={(event) => {
        const delta = keyStep(event.key, 5);
        if (!delta) return;
        event.preventDefault();
        step(delta);
      }}
    >
      <span class="rb-fill-level" aria-hidden="true" />
      <span class="rb-fill-body">{props.children}</span>
    </div>
  );
}
