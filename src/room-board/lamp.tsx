import { createUniqueId } from "solid-js";

/**
 * A ceiling pendant, drawn in CSS rather than shipped as a picture — so it
 * takes the room's own bulb colour and dims with them, instead of being an
 * illustration of one particular state.
 *
 * The same construction as the light widget's lamp, scaled to a board card:
 * cord from the card's top edge, a shade, a lit mouth, and the cone it throws
 * down across the tile.
 */
export function CeilingLamp(props: {
  on: boolean;
  /** 0–1, how lit the room is overall. */
  strength: number;
  /** "r, g, b" from the bulbs themselves. */
  color: string;
}) {
  // Never fully dark while on: a bulb at 1% still reads as lit.
  const level = () => (props.on ? 0.3 + props.strength * 0.7 : 0);

  return (
    <div
      class="rb-lamp"
      data-on={props.on}
      style={{ "--rb-bulb": props.color, "--rb-level": String(level()) }}
      aria-hidden="true"
    >
      <span class="rb-lamp-cord" />
      <span class="rb-lamp-cap" />
      <span class="rb-lamp-shade" />
      {/* The lip of the shade, lit or not — it gives the silhouette an edge
          instead of a flat cut-out. */}
      <span class="rb-lamp-rim" />
      {/* Behind the mouth, so the source reads as inside the shade. */}
      <span class="rb-lamp-bulb" />
      <span class="rb-lamp-cone" />
    </div>
  );
}

/**
 * A glass globe pendant, for the standing and big light cards: a braided
 * cord from the card's top edge, a black socket, and a tinted glass bowl with
 * the bulb glowing through it.
 *
 * Drawn in SVG so the glass can be translucent over the bulb, and coloured
 * from the stylesheet (--rb-bulb, --rb-level) so it follows the room's own
 * lights and dims with them.
 */
export function GlobeLamp(props: { on: boolean; strength: number; color: string }) {
  const id = createUniqueId();
  // Never fully dark while on: a bulb at 1% still reads as lit.
  const level = () => (props.on ? 0.35 + props.strength * 0.65 : 0);

  return (
    <svg
      class="rb-globe"
      viewBox="0 34 120 150"
      data-on={props.on}
      style={{ "--rb-bulb": props.color, "--rb-level": String(level()) }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop class="rb-globe-h0" offset="0" />
          <stop class="rb-globe-h1" offset="0.4" />
          <stop class="rb-globe-h2" offset="1" />
        </radialGradient>
        <radialGradient id={`${id}-glass`} cx="0.42" cy="0.38" r="0.66">
          <stop class="rb-globe-g0" offset="0" />
          <stop class="rb-globe-g1" offset="0.7" />
          <stop class="rb-globe-g2" offset="1" />
        </radialGradient>
        <radialGradient id={`${id}-bulb`} cx="0.5" cy="0.45" r="0.6">
          <stop class="rb-globe-b0" offset="0" />
          <stop class="rb-globe-b1" offset="0.55" />
          <stop class="rb-globe-b2" offset="1" />
        </radialGradient>
        <linearGradient id={`${id}-metal`} x1="0" x2="1">
          <stop offset="0" stop-color="#0d0d0d" />
          <stop offset="0.4" stop-color="#3b3b3b" />
          <stop offset="1" stop-color="#0a0a0a" />
        </linearGradient>
      </defs>

      <circle class="rb-globe-halo" cx="60" cy="124" r="62" fill={`url(#${id}-halo)`} />

      {/* The cord, braided: a dark line with a lighter dash laid over it. */}
      <line x1="60" y1="-2" x2="60" y2="82" stroke="#151515" stroke-width="2.8" />
      <line
        x1="60"
        y1="-2"
        x2="60"
        y2="82"
        stroke="#6a6a6a"
        stroke-width="2.8"
        stroke-dasharray="1.4 1.6"
        opacity="0.6"
      />

      <rect x="55" y="78" width="10" height="7" rx="1.6" fill={`url(#${id}-metal)`} />
      <rect x="52" y="84" width="16" height="26" rx="2.6" fill={`url(#${id}-metal)`} />
      <rect x="51" y="95" width="18" height="2.4" rx="1.2" fill="#262626" />

      <circle class="rb-globe-bulb" cx="60" cy="124" r="15.5" fill={`url(#${id}-bulb)`} />

      {/* The bowl, over the bulb, open at the top around the socket. */}
      <path
        class="rb-globe-glass"
        d="M49 90 C22 95 9 116 11 138 C14 162 36 176 60 176 C84 176 106 162 109 138 C111 116 98 95 71 90 Z"
        fill={`url(#${id}-glass)`}
      />
      <ellipse cx="60" cy="90" rx="11" ry="2.4" fill="rgb(0 0 0 / 0.35)" />
      {/* A highlight down the upper left and a softer one along the lip. */}
      <path class="rb-globe-shine" d="M22 124 C23 110 32 99 45 95" />
      <path class="rb-globe-lip" d="M28 160 C42 172 78 172 92 160" />
    </svg>
  );
}
