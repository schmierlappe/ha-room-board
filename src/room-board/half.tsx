import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
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
  /** The card's own drawing — its lamp, shutter, lock, robot — at the right. */
  art?: JSX.Element;
}) {
  /* Drawn only while the card is set to half: a hidden half face that still
     drew its picture would be a second lamp, a second robot, a second chart
     loading its history — for every card on the board. The card's own
     data-shape says (arrange.ts writes it). */
  let el: HTMLDivElement | undefined;
  const [shown, setShown] = createSignal(false);
  onMount(() => {
    const card = el?.closest<HTMLElement>(".rb-card");
    if (!card) return;
    const read = () => setShown(card.dataset.shape === "half");
    read();
    if (typeof MutationObserver === "undefined") return;
    const watch = new MutationObserver(read);
    watch.observe(card, { attributes: true, attributeFilter: ["data-shape"] });
    onCleanup(() => watch.disconnect());
  });
  return (
    <div
      ref={el}
      class="rb-half"
      data-lit={props.lit === true}
      data-art={"art" in props}
      style={props.tone ? { "--rb-half-tone": props.tone } : undefined}
    >
      <Show when={shown() && props.art}>
        <span class="rb-half-art" aria-hidden="true">
          {props.art}
        </span>
      </Show>
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
