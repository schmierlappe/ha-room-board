import { levelOf } from "./model";

/**
 * A reading as a ring: the arc filled to the value, the value in the middle,
 * what it is under it. Calm blue while there is headroom, amber when busy,
 * red when it is running out — CPU and memory, and the gateway's warmth.
 */
export function Ring(props: {
  value: number;
  label: string;
  /** What the arc is a share of; 100 for a percentage. */
  max?: number;
  /** "%" or "°". */
  unit?: string;
  /** Where amber and red start, in the value's own units. */
  warn?: number;
  alarm?: number;
  size?: "xs" | "sm" | "md";
}) {
  const max = () => props.max ?? 100;
  const share = () => Math.max(0, Math.min(1, props.value / max()));
  const tone = () => levelOf(props.value, props.warn ?? 60, props.alarm ?? 85);
  /* r = 15.9: a circumference of 100, so the dash is the share in percent. */
  return (
    <div class="uf-ring" data-tone={tone()} data-size={props.size ?? "md"}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle class="uf-ring-track" cx="18" cy="18" r="15.9" />
        <circle
          class="uf-ring-arc"
          cx="18"
          cy="18"
          r="15.9"
          stroke-dasharray={`${(share() * 100).toFixed(1)} 100`}
        />
      </svg>
      <b class="uf-ring-value">
        {Math.round(props.value)}
        <i>{props.unit ?? "%"}</i>
      </b>
      <span class="uf-ring-label">{props.label}</span>
    </div>
  );
}
