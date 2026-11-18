import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";

/**
 * Scrolls its text only when it actually overflows; otherwise it behaves like a
 * plain truncating label. Distance and duration are measured, so short titles
 * don't animate and long ones travel at a constant speed.
 */
export function Marquee(props: { text: string; class?: string }) {
  let outer: HTMLDivElement | undefined;
  let inner: HTMLSpanElement | undefined;
  const [distance, setDistance] = createSignal(0);

  const measure = () => {
    if (!outer || !inner) return;
    const overflow = inner.scrollWidth - outer.clientWidth;
    setDistance(overflow > 4 ? overflow : 0);
  };

  onMount(() => {
    measure();
    if (typeof ResizeObserver === "undefined" || !outer) return;
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    onCleanup(() => ro.disconnect());
  });

  // Re-measure when the track changes.
  createEffect(on(() => props.text, () => queueMicrotask(measure)));

  return (
    <div class={`mp-marquee ${props.class ?? ""}`} ref={outer}>
      <span
        ref={inner}
        class="mp-marquee-inner"
        data-run={distance() > 0}
        style={{
          "--mq-shift": `-${distance()}px`,
          "--mq-duration": `${Math.max(7, distance() / 22)}s`,
        }}
      >
        {props.text}
      </span>
    </div>
  );
}
