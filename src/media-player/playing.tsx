/**
 * The animated "this one is playing" mark: a three-bar equaliser in the
 * primary colour. Used wherever several players are listed at once, so which
 * of them is actually making noise reads without checking each state line.
 *
 * Bars rather than a spinning icon: it says "audio" specifically, and it stays
 * legible at 14px where a rotating glyph turns to mush.
 */
export function PlayingBars(props: { size?: string; title?: string }) {
  return (
    <span
      class="mp-eq"
      style={props.size ? { width: props.size, height: props.size } : undefined}
      title={props.title ?? "Playing"}
      aria-label={props.title ?? "Playing"}
      role="img"
    >
      <span />
      <span />
      <span />
    </span>
  );
}
