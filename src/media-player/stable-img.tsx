import { Show, createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { artSrc } from "../artwork";

/**
 * An image that never shows a blank or half-loaded frame.
 *
 * When its source changes, the new picture is fetched behind the old one and
 * swapped in only once it has loaded — a player that rewrites its artwork URL
 * three times during one track change (the title first, then the picture,
 * then a fresh cache token) used to reload the cover three times, each with a
 * moment of nothing in between. A source that fails is still handed to the
 * element, so its own error handling runs.
 */
export function StableImg(props: {
  src: string | undefined;
  class?: string;
  onLoad?: (img: HTMLImageElement) => void;
  onError?: () => void;
}) {
  /* A cover from outside Home Assistant arrives through artSrc, larger than a
     tile's since this is the big one. */
  const wanted = () => artSrc(props.src, 320);
  const [shown, setShown] = createSignal(wanted());
  /* The next picture, loading out of sight. Not new Image(): the sealed
     engine of Dash 1.5 has no Image, and reaching for it threw "'Image' is
     not defined" into the panel. A hidden <img> of the widget's own loads
     the same way and says when it is done. */
  const [pending, setPending] = createSignal<string>();

  createEffect(
    on(
      wanted,
      (src) => {
        if (!src || src === shown()) return setPending(undefined);
        if (!shown()) {
          setPending(undefined);
          return void setShown(src);
        }
        setPending(src);
      },
      { defer: true },
    ),
  );

  /* Loaded or failed, the same: a failing source still goes to the element,
     so its own error handling runs. Only if it is still the one wanted. */
  const settle = (src: string) => {
    if (wanted() === src) setShown(src);
    if (pending() === src) setPending(undefined);
  };

  return (
    <>
      <img
        class={props.class}
        src={shown()}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={(event) => props.onLoad?.(event.currentTarget)}
        onError={() => props.onError?.()}
      />
      <Show when={pending()} keyed>
        {(src) => (
          <img
            src={src}
            alt=""
            aria-hidden="true"
            style={{ display: "none" }}
            onLoad={() => settle(src)}
            onError={() => settle(src)}
          />
        )}
      </Show>
    </>
  );
}

/**
 * A value that, when it goes missing, stays at its last value for a moment:
 * between two tracks a player often reports no artwork for a beat, and the
 * cover used to fall back to its placeholder and straight back.
 */
export function holdLast<T>(value: Accessor<T | undefined>, ms = 1500): Accessor<T | undefined> {
  const [held, setHeld] = createSignal<T | undefined>(value());
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(value, (next) => {
      clearTimeout(timer);
      if (next !== undefined && next !== null && next !== "") setHeld(() => next);
      else timer = setTimeout(() => setHeld(undefined), ms);
    }),
  );
  onCleanup(() => clearTimeout(timer));
  return held;
}
