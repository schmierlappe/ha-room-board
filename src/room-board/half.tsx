import { Show, type JSX } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";

/**
 * A card's face at half a tile (Arrange's ½ size on a phone): its icon on a
 * tinted badge, its name over one line of status, and at the right either its
 * one switch or its one reading. Every card draws one; it shows only when the
 * card is set to half (styles.css), in place of the card's own face.
 */
export function Half(props: {
  icon: string;
  name: string;
  status?: string;
  /** The badge's colour; the card's own accent. */
  tone?: string;
  /** A reading at the right: "22.5°", "56 %", "3/4". */
  value?: JSX.Element;
  /** A switch at the right, where the card has one that does the obvious thing. */
  on?: boolean;
  onToggle?: () => void;
  /** Lit: the badge filled rather than tinted (something is on or wrong). */
  lit?: boolean;
}) {
  return (
    <div class="rb-half" data-lit={props.lit === true} style={props.tone ? { "--rb-half-tone": props.tone } : undefined}>
      <span class="rb-half-icon">
        <Icon icon={props.icon} width="18" />
      </span>
      <span class="rb-half-text">
        <b class="rb-truncate">{props.name}</b>
        <Show when={props.status}>
          <small class="rb-truncate">{props.status}</small>
        </Show>
      </span>
      <Show
        when={props.onToggle}
        fallback={
          <Show when={props.value !== undefined && props.value !== ""}>
            <span class="rb-half-value">{props.value}</span>
          </Show>
        }
      >
        <button
          class="rb-half-toggle"
          data-on={props.on === true}
          role="switch"
          aria-checked={props.on === true}
          aria-label={props.on ? `Turn ${props.name} off` : `Turn ${props.name} on`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggle?.();
          }}
        >
          <i />
        </button>
      </Show>
    </div>
  );
}
