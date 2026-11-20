import { Show, onMount, type JSX } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";

/**
 * A sheet over the popup, one level deeper: the speakers, a remote's
 * activities, its sources. The room board's own overlays are the model — the
 * same slide-in from the right, the outlined back arrow, the large thin title
 * — so a choice made inside the media overlay reads as the same kind of place
 * as the overlay itself.
 *
 * Positioned against the nearest positioned ancestor outside the panel, which
 * in the room board is its sheet: it covers the popup's title as well.
 */
export function SubSheet(props: {
  title: string;
  onBack: () => void;
  /** Above the list: a filter, say. */
  head?: JSX.Element;
  children: JSX.Element;
}) {
  let el: HTMLElement | undefined;

  /* The media player's own popup: the sheet takes the popup's own paint, read
     off the dialog as it is actually drawn, so the two are one surface. Inside
     the room board it keeps the board's sheet colour, which the stylesheet
     already gives it. */
  onMount(() => {
    if (!el || el.closest(".rb-sheet")) return;
    /* The first box above the sheet that actually paints a colour — the
       dialog itself on some hosts, a layer inside it on others — so the
       sheet is the popup's own colour rather than a darker one of its own. */
    const transparent = /^(transparent|rgba?\([^)]*,\s*0(\.0+)?\s*\))$/;
    let node = el.parentElement;
    while (node) {
      const painted = getComputedStyle(node);
      if (painted.backgroundColor && !transparent.test(painted.backgroundColor)) {
        el.style.setProperty("background-color", painted.backgroundColor, "important");
        el.style.setProperty(
          "background-image",
          painted.backgroundImage === "none" ? "none" : painted.backgroundImage,
          "important",
        );
        return;
      }
      if (node.matches('[role="dialog"][aria-modal="true"]:not(.mp-subsheet)')) return;
      node = node.parentElement;
    }
  });

  return (
    /* A labelled section, not a <dialog>: the sealed engine of Dash 1.5 draws
       only an allowlist of elements, <dialog> is not on it, and the queue's
       sheet opened as nothing at all. */
    <section ref={el} class="mp-subsheet" aria-label={props.title}>
      <header class="mp-subsheet-head">
        <button class="mp-subsheet-back" aria-label="Back" onClick={props.onBack}>
          <Icon icon="mdi:arrow-left" width="18" />
        </button>
        <h2 class="mp-subsheet-title">{props.title}</h2>
      </header>
      <Show when={props.head}>
        <div class="mp-subsheet-tools">{props.head}</div>
      </Show>
      <div class="mp-subsheet-body">{props.children}</div>
    </section>
  );
}

/**
 * One choice in a sheet: a tinted tile with its icon, the name, a line under
 * it, and a tick on the one in use.
 */
export function Choice(props: {
  icon: JSX.Element;
  name: string;
  sub?: string;
  /** The tile's colour, where the choice has one of its own. */
  look?: string;
  active?: boolean;
  lit?: boolean;
  danger?: boolean;
  /** The icon is a picture of its own (a channel's logo): no tile behind it. */
  bare?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="mp-speaker"
      data-active={!!props.active}
      data-playing={!!props.lit}
      data-danger={!!props.danger}
      style={props.look ? { "--mp-look": props.look } : undefined}
      onClick={props.onClick}
    >
      <span class="mp-speaker-icon" data-look={!!props.look} data-bare={!!props.bare}>
        {props.icon}
      </span>
      <span class="mp-speaker-text">
        <span class="mp-speaker-name mp-truncate">{props.name}</span>
        <Show when={props.sub}>
          <span class="mp-speaker-sub mp-truncate">{props.sub}</span>
        </Show>
      </span>
      <Show when={props.active}>
        <Icon class="mp-speaker-check" icon="mdi:check-circle" width="20" />
      </Show>
    </button>
  );
}
