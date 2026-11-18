import { createUniqueId } from "solid-js";

/**
 * The vacuum, seen from above — drawn after a Roborock.
 *
 * What makes one of those recognisable from across a room is three things:
 * a round body with the bumper band across its front, the raised lidar
 * turret sitting forward of centre, and the pill of buttons on the lid behind
 * it. So those are what is drawn, lit from the top left like the board's other
 * pictures, with a side brush at the front edge that turns while it works.
 *
 * Its states are carried by the lights, as on the real thing: the turret's
 * ring and the button's status dot go to the accent while it cleans, and the
 * dot is green once it is docked and full.
 */
export function Robot(props: { cleaning: boolean; docked: boolean }) {
  /* Every card renders its own gradients; a shared id would have them all
     painting from whichever mounted last. */
  const body = createUniqueId();
  const rim = createUniqueId();
  const cap = createUniqueId();

  return (
    <svg
      class="rb-robot"
      data-cleaning={props.cleaning}
      data-docked={props.docked}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <defs>
        {/* The lid, lit from the top left and falling away to the far edge. */}
        <radialGradient id={body} cx="34%" cy="28%" r="80%">
          <stop class="rb-robot-lit" offset="0%" />
          <stop class="rb-robot-shade" offset="100%" />
        </radialGradient>
        {/* A thin bright edge along the lit side only. */}
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff" stop-opacity="0.55" />
          <stop offset="55%" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
        {/* The turret's cap: darker and glossier than the lid. */}
        <radialGradient id={cap} cx="38%" cy="32%" r="75%">
          <stop class="rb-robot-cap-lit" offset="0%" />
          <stop class="rb-robot-cap-shade" offset="100%" />
        </radialGradient>
      </defs>

      {/* Side brush, at the front left under the body's edge, drawn first so
          the body sits over its hub the way the real one does. */}
      <g class="rb-robot-brush">
        <path
          class="rb-robot-arms"
          d="M13 14 L7 7 M13 14 L4.5 16.5 M13 14 L14.5 5"
          stroke-linecap="round"
        />
      </g>

      {/* Body. */}
      <circle class="rb-robot-body" cx="32" cy="33" r="26" fill={`url(#${body})`} />
      <circle cx="32" cy="33" r="25.4" fill="none" stroke={`url(#${rim})`} stroke-width="1.2" />

      {/* The bumper: a band across the front third of the rim. */}
      <path
        class="rb-robot-bumper"
        d="M10.5 22.5 A 24.2 24.2 0 0 1 53.5 22.5"
        fill="none"
        stroke-linecap="round"
      />

      {/* The lid's seam, a step in from the edge. */}
      <circle class="rb-robot-seam" cx="32" cy="33" r="19.5" fill="none" />

      {/* Lidar turret, forward of centre: the cap, its lit ring, and the
          window the laser looks out of. */}
      <circle class="rb-robot-turret-shadow" cx="32.6" cy="25.4" r="8.4" />
      <circle cx="32" cy="24.5" r="8" fill={`url(#${cap})`} class="rb-robot-turret" />
      <circle class="rb-robot-ring" cx="32" cy="24.5" r="5.4" fill="none" />
      <path class="rb-robot-window" d="M27.4 20.6 A 6.2 6.2 0 0 1 36.6 20.6" fill="none" stroke-linecap="round" />

      {/* Buttons behind the turret: one pill, a dot for the status light. */}
      <rect class="rb-robot-buttons" x="26" y="41.5" width="12" height="4.6" rx="2.3" />
      <circle class="rb-robot-status" cx="32" cy="43.8" r="1.05" />
    </svg>
  );
}
