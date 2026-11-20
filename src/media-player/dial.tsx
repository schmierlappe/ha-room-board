import { Index, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { keyStep } from "../keys";

const TICKS = 44;

/**
 * Volume as a ruled dial.
 *
 * The same instrument the room board's thermostat uses — a row of ticks that
 * swells under the handle and tapers at both ends, with the handle drawn as a
 * ring rather than left to the native thumb. Deliberately rebuilt here rather
 * than imported: a widget's stylesheet does not reach another widget's, so
 * sharing the component would have shared markup with nothing to paint it.
 *
 * The player is told a few times a second while the level moves, and once
 * exactly when it stops — a drag across the ruler is dozens of pointer events,
 * and a speaker answers every one it is sent.
 *
 * Driven by pointer events rather than by a native range input, which is why
 * the drag used to fail as often as it worked: a range input leaves
 * `touch-action` alone, so the browser was free to decide a horizontal swipe
 * belonged to the page and cancel the pointer stream — leaving only the first
 * tap. On iOS it was worse still: Safari's range wants the touch to begin on
 * the thumb, and this one is drawn as a hairline.
 */
export function VolumeDial(props: {
  /** 0–100. */
  value: number;
  muted?: boolean;
  /** Upright, for the popup on a phone: quiet at the bottom, loud at the top. */
  vertical?: boolean;
  /**
   * A plain track instead of the ruler.
   *
   * Same pointer handling, which is the whole point of it: a native range
   * input leaves `touch-action` alone, so the browser is free to take a
   * horizontal drag for the page and cancel the pointer stream partway — the
   * slider that "hangs". This looks like a range and behaves like this file.
   */
  plain?: boolean;
  onCommit: (value: number) => void;
}) {
  const [live, setLive] = createSignal<number | undefined>();
  const shown = () => live() ?? props.value;
  const fill = () => Math.max(0, Math.min(100, shown())) / 100;

  const ticks = createMemo(() => {
    const at = fill();
    return Array.from({ length: TICKS }, (_, index) => {
      const position = index / (TICKS - 1);
      const distance = Math.abs(position - at);
      const swell = Math.exp(-((distance / 0.14) ** 2));
      // The ends of a ruler are its quietest part; without this the row reads
      // as a fence rather than as a scale.
      const taper = Math.min(1, Math.sin(Math.PI * position) * 2.4 + 0.45);
      const passed = position <= at;

      return {
        height: (0.32 + 0.68 * swell) * taper,
        opacity: (passed ? 0.6 : 0.2) + 0.4 * swell,
        passed,
      };
    });
  });

  const [held, setHeld] = createSignal(false);
  let track: HTMLDivElement | undefined;

  /* Upright runs bottom to top, which is the way a level reads and the way a
     thumb expects to push it. */
  const read = (event: PointerEvent) => {
    if (!track) return undefined;
    const box = track.getBoundingClientRect();
    const span = props.vertical ? box.height : box.width;
    if (!span) return undefined;
    const along = props.vertical ? box.bottom - event.clientY : event.clientX - box.left;
    return Math.round(Math.max(0, Math.min(1, along / span)) * 100);
  };

  /* The player is told as the level moves, a few times a second, and once
     more — exactly — when it stops. The shown level stays where it was left
     for a moment afterwards, until the player has caught up: letting go used
     to snap it back to the old level and forward again. */
  let sentAt = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const send = (value: number, final: boolean) => {
    clearTimeout(settle);
    setLive(value);
    const now = Date.now();
    if (final || now - sentAt >= 180) {
      sentAt = now;
      props.onCommit(value);
    }
    if (final) settle = setTimeout(() => setLive(undefined), 1500);
  };

  /* A drag moves the level from where it was — geared so a sweep of the
     whole range takes at least 300px, which makes a single percent a few
     pixels of travel — and never needs a precise touch on the handle. A
     tap, with no travel, puts the level where it landed. */
  let grab: { x: number; y: number; from: number; span: number; moved: boolean } | undefined;

  const move = (event: PointerEvent) => {
    if (!grab) return;
    const delta = props.vertical ? grab.y - event.clientY : event.clientX - grab.x;
    if (!grab.moved && Math.abs(delta) < 4) return;
    grab.moved = true;
    const travel = Math.max(grab.span, 300);
    send(Math.round(Math.max(0, Math.min(100, grab.from + (delta / travel) * 100))), false);
  };

  /* The element the drag started on, holding the pointer: the sealed engine
     of Dash 1.5 has no window to listen on, so the moves are captured here. */
  let captor: HTMLElement | undefined;
  const release = () => {
    captor?.removeEventListener("pointermove", move);
    captor?.removeEventListener("pointerup", end);
    captor?.removeEventListener("pointercancel", end);
    captor = undefined;
  };

  const end = (event: PointerEvent) => {
    release();
    setHeld(false);
    const value = grab?.moved ? shown() : (read(event) ?? shown());
    grab = undefined;
    send(Math.round(value), true);
  };

  /* Stopped as well as prevented: the tile and the dashboard both listen for
     a swipe, and either one taking this gesture is the bug being fixed. */
  const start = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setHeld(true);
    const box = track?.getBoundingClientRect();
    grab = {
      x: event.clientX,
      y: event.clientY,
      from: Math.round(shown()),
      span: (props.vertical ? box?.height : box?.width) ?? 300,
      moved: false,
    };
    release();
    captor = event.currentTarget as HTMLElement;
    captor.setPointerCapture?.(event.pointerId);
    captor.addEventListener("pointermove", move);
    captor.addEventListener("pointerup", end);
    captor.addEventListener("pointercancel", end);
  };

  onCleanup(() => {
    release();
    clearTimeout(settle);
    clearTimeout(quiet);
  });

  const step = (delta: number) => {
    send(Math.max(0, Math.min(100, Math.round(shown()) + delta)), true);
  };

  /* The mouse's wheel, a percent a notch: shown at once, sent a few times a
     second while it turns and once more when it stops. */
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const up = event.deltaY < 0 || event.deltaX > 0;
    send(Math.max(0, Math.min(100, Math.round(shown()) + (up ? 1 : -1))), false);
    clearTimeout(quiet);
    quiet = setTimeout(() => send(Math.round(shown()), true), 250);
  };

  return (
    <div
      ref={track}
      class="mp-dial"
      data-vertical={props.vertical === true}
      data-plain={props.plain === true}
      data-muted={props.muted === true}
      data-held={held()}
      style={{ "--fill": `${fill() * 100}%` }}
      role="slider"
      tabindex="0"
      aria-label="Volume"
      aria-valuenow={Math.round(shown())}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={start}
      onWheel={wheel}
      onKeyDown={(event) => {
        /* A percent a press; ten with Page Up and Down. */
        const delta = keyStep(event.key, 1, 10);
        if (!delta) return;
        event.preventDefault();
        step(delta);
      }}
    >
      <Show when={props.plain}>
        <span class="mp-dial-track" aria-hidden="true">
          <i />
        </span>
      </Show>

      <div class="mp-dial-ticks" aria-hidden="true">
        <Index each={ticks()}>
          {(tick) => (
            <i
              data-passed={tick().passed}
              style={{ "--t": `${tick().height * 100}%`, opacity: `${tick().opacity}` }}
            />
          )}
        </Index>
      </div>

      <span class="mp-dial-glow" aria-hidden="true" />

      <span class="mp-dial-knob" aria-hidden="true">
        <Icon icon="mdi:arrow-left-right" width="12" />
      </span>
    </div>
  );
}
