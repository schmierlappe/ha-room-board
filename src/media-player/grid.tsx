import { For, Show, createSignal, onMount, type JSX } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { Cover, type MediaType } from "./cover";
import { Keyed } from "./keyed";

export type GridItem = {
  id: string;
  name: string;
  subtitle?: string;
  image?: string;
  mediaType: MediaType;
  /** Artist name, kept so album drill-down can filter by it. */
  artist?: string;
  /** True when tapping the tile should navigate instead of opening the menu. */
  canOpen?: boolean;
};

export type ActionId = "play" | "next" | "add" | "radio";

const ACTIONS: { id: ActionId; label: string; icon: string }[] = [
  { id: "play", label: "Play now", icon: "mdi:play" },
  { id: "next", label: "Play next", icon: "mdi:playlist-play" },
  { id: "add", label: "Add to queue", icon: "mdi:playlist-plus" },
  { id: "radio", label: "Start radio", icon: "mdi:radio-tower" },
];

const MENU_W = 176;
const MENU_H = 168;

type MenuState = {
  item: GridItem;
  x: number;
  y: number;
  below: boolean;
  /** The cover it was opened from, to stand beside rather than over. */
  anchor: { left: number; top: number; right: number; bottom: number };
};

/**
 * The menu is fixed-positioned and clamped to the viewport rather than
 * absolutely positioned inside its tile: anchored to the tile it escaped the
 * dialog on the first and last columns.
 */
function useActionMenu(onAction: (item: GridItem, action: ActionId) => void) {
  const [menu, setMenu] = createSignal<MenuState | null>(null);

  const openAt = (event: MouseEvent, item: GridItem) => {
    const anchor = event.currentTarget as HTMLElement;
    const r = anchor.getBoundingClientRect();
    const below = r.top < MENU_H + 16;

    setMenu({
      item,
      // window is a stand-in in the sealed engine, without innerWidth: there
      // the menu is only kept off the left edge.
      x: Math.min(
        Math.max(8, r.left + r.width / 2 - MENU_W / 2),
        (globalThis.innerWidth ?? Infinity) - MENU_W - 8,
      ),
      y: below ? r.bottom + 6 : r.top - 6,
      below,
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    });
  };

  const toggle = (event: MouseEvent, item: GridItem) => {
    if (menu()?.item.id === item.id) setMenu(null);
    else openAt(event, item);
  };

  /* The item's own actions button: its menu, and not a tap on the tile too. */
  const toggleFrom = (item: GridItem) => (event: MouseEvent) => {
    event.stopPropagation();
    toggle(event, item);
  };

  const pick = (item: GridItem, action: ActionId) => {
    setMenu(null);
    onAction(item, action);
  };

  return { menu, setMenu, toggle, toggleFrom, pick };
}

/**
 * The tile's own tap: it opens the item when it can be opened and offers
 * what to do with it otherwise. The tile holds a button of its own, so it
 * cannot be one; this fills it instead, and what lies over it lets a tap
 * through to it.
 */
function ItemHit(props: {
  item: GridItem;
  onOpen?: (item: GridItem) => void;
  toggle: (event: MouseEvent, item: GridItem) => void;
}) {
  const opens = () => props.item.canOpen && props.onOpen;
  return (
    <button
      type="button"
      class="mp-item-hit"
      aria-label={opens() ? `Open ${props.item.name}` : `Actions for ${props.item.name}`}
      onClick={(e) => (opens() ? props.onOpen!(props.item) : props.toggle(e, props.item))}
    />
  );
}

function ActionMenu(props: {
  state: MenuState;
  radioDisabled?: boolean;
  onPick: (item: GridItem, action: ActionId) => void;
  /** Escape closes it, as it does any menu. */
  onClose: () => void;
}) {
  let el: HTMLDivElement | undefined;
  const [adjust, setAdjust] = createSignal({ dx: 0, dy: 0 });
  /* Inside the media tile's small panel: placed beside the cover, within the
     panel — there is no room above or below it there, and a menu over the
     cover hid the very thing it was opened for. */
  const [beside, setBeside] = createSignal<{ left: number; top: number } | undefined>();

  /**
   * The dialog uses backdrop-filter and a transform, which makes it the
   * containing block for position:fixed — so the coordinates above land
   * relative to the dialog, not the viewport. Measure once and correct by the
   * difference instead of trying to identify that ancestor.
   */
  /* The menu's items that can be picked, for the keys to move between. */
  const items = () => [...(el?.querySelectorAll<HTMLButtonElement>(".mp-menu-item:not(:disabled)") ?? [])];
  /* Up and Down move through the items, round at either end. */
  const step = (by: number) => {
    const list = items();
    if (!list.length) return;
    /* The focus as the menu's own root sees it: inside a shadow root, the
       document's is only the host. */
    const root = el!.getRootNode() as Document | ShadowRoot;
    const at = list.indexOf(root.activeElement as HTMLButtonElement);
    list[(at + by + list.length) % list.length]!.focus();
  };

  /* Open, the first item has the focus, so the keys work in the menu at once. */
  onMount(() => items()[0]?.focus({ preventScroll: true }));

  onMount(() => {
    if (!el) return;
    const panel = el.closest(".mp-mini") as HTMLElement | null;
    if (panel) {
      const box = panel.getBoundingClientRect();
      const a = props.state.anchor;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 6;
      /* To the right of the cover where it fits, else to its left, else
         against whichever edge leaves more of it showing. */
      let left = a.right - box.left + gap;
      if (left + w > box.width - gap) left = a.left - box.left - w - gap;
      if (left < gap) left = a.left - box.left > box.right - a.right ? gap : box.width - w - gap;
      const top = Math.max(gap, Math.min(a.top - box.top, box.height - h - gap));
      setBeside({ left, top });
      return;
    }
    const r = el.getBoundingClientRect();
    setAdjust({
      dx: props.state.x - r.left,
      dy: props.state.y - (props.state.below ? r.top : r.bottom),
    });
  });

  /* Beside the cover where it fits; otherwise above or below where it was opened. */
  const place = (): JSX.CSSProperties => {
    const spot = beside();
    if (spot) return { left: `${spot.left}px`, top: `${spot.top}px` };
    return {
      left: `${props.state.x + adjust().dx}px`,
      top: `${props.state.y + adjust().dy}px`,
      width: `${MENU_W}px`,
      transform: props.state.below ? "none" : "translateY(-100%)",
    };
  };

  return (
    <div
      ref={el}
      class="mp-menu"
      data-beside={!!beside()}
      style={place()}
      role="menu"
      tabIndex={-1}
      aria-label={props.state.item.name}
      /* A press inside the menu stays in it: it must not reach the tile or
         the shelf behind, which would take it as a tap of their own. */
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          step(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <For each={ACTIONS}>
        {(action) => (
          <button
            role="menuitem"
            class="mp-menu-item"
            disabled={action.id === "radio" && props.radioDisabled}
            onClick={() => props.onPick(props.state.item, action.id)}
          >
            <Icon icon={action.icon} width="16" />
            <span>{action.label}</span>
          </button>
        )}
      </For>
    </div>
  );
}

const GRID_CLASS = {
  grid: "mp-lib-grid",
  shelf: "mp-shelf",
  large: "mp-lib-grid mp-lib-grid--large",
};

export function MediaGrid(props: {
  items: GridItem[];
  onAction: (item: GridItem, action: ActionId) => void;
  onOpen?: (item: GridItem) => void;
  radioDisabled?: boolean;
  /** "shelf" is one swipeable row of larger covers, as Discover uses; "large"
   *  wraps at that same cover size, for drilling into one of them. The plain
   *  grid stays for Browse and Search, where the point is to see the whole
   *  result set rather than the pick of a shelf. */
  layout?: "grid" | "shelf" | "large";
}) {
  const { menu, setMenu, toggle, toggleFrom, pick } = useActionMenu((item, action) => props.onAction(item, action));

  return (
    <>
      <Show when={menu()}>
        <button type="button" class="mp-menu-backdrop" tabIndex={-1} aria-label="Close menu" onClick={() => setMenu(null)} />
        <ActionMenu state={menu()!} radioDisabled={props.radioDisabled} onPick={pick} onClose={() => setMenu(null)} />
      </Show>

      <div class={GRID_CLASS[props.layout ?? "grid"]}>
        <Keyed each={props.items}>
          {(item) => (
            <div
              class="mp-lib-item"
              data-open={menu()?.item.id === item.id}
            >
              <ItemHit item={item} onOpen={props.onOpen} toggle={toggle} />
              <div class="mp-cover-wrap">
                <Cover
                  name={item.name}
                  mediaType={item.mediaType}
                  image={item.image}
                  sourceId={item.id}
                />

                <button
                  class="mp-play-fab"
                  aria-label={`Actions for ${item.name}`}
                  onClick={toggleFrom(item)}
                >
                  <Icon icon="mdi:play" width="16" />
                </button>
              </div>

              <div>
                <div class="mp-lib-name mp-truncate">{item.name}</div>
                <div class="mp-lib-type mp-truncate">{item.subtitle ?? item.mediaType}</div>
              </div>
            </div>
          )}
        </Keyed>
      </div>
    </>
  );
}

/** Row layout for track lists, where a cover grid wastes space. */
export function MediaList(props: {
  items: GridItem[];
  onAction: (item: GridItem, action: ActionId) => void;
  onOpen?: (item: GridItem) => void;
  radioDisabled?: boolean;
}) {
  const { menu, setMenu, toggle, toggleFrom, pick } = useActionMenu((item, action) => props.onAction(item, action));

  return (
    <>
      <Show when={menu()}>
        <button type="button" class="mp-menu-backdrop" tabIndex={-1} aria-label="Close menu" onClick={() => setMenu(null)} />
        <ActionMenu state={menu()!} radioDisabled={props.radioDisabled} onPick={pick} onClose={() => setMenu(null)} />
      </Show>

      <div class="mp-list">
        <Keyed each={props.items}>
          {(item) => (
            <div
              class="mp-list-row"
              data-open={menu()?.item.id === item.id}
            >
              <ItemHit item={item} onOpen={props.onOpen} toggle={toggle} />
              <div class="mp-list-cover">
                <Cover
                  name={item.name}
                  mediaType={item.mediaType}
                  image={item.image}
                  sourceId={item.id}
                />
              </div>

              <div class="mp-flex1">
                <div class="mp-list-name mp-truncate">{item.name}</div>
                <div class="mp-lib-type mp-truncate">{item.subtitle ?? item.mediaType}</div>
              </div>

              <button
                class="mp-btn mp-btn--ghost mp-btn--sm"
                aria-label={`Actions for ${item.name}`}
                onClick={toggleFrom(item)}
              >
                <Icon icon="mdi:play" width="18" />
              </button>
            </div>
          )}
        </Keyed>
      </div>
    </>
  );
}
