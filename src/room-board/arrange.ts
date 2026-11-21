/**
 * The board's arrangement, chosen by the person looking at it.
 *
 * The board decides for itself where each card goes, and it usually decides
 * well — but only the room's owner knows that the weather matters more here
 * than the lights, or that this room's big tile should be the player and not
 * the thermometer. Arranging lets them say so: move a card earlier or later,
 * and make any card the big one.
 *
 * Kept in the widget's config as plain strings, per room, in order:
 *
 *   "<room>@<card>"         a card, in the position it was put in
 *   "<room>@=<size>:<card>" its size: compact, wide, portrait, big or cinema
 *   "<room>@!<card>"        (older) the same as size big
 *
 * A room with no entries is laid out the board's own way.
 *
 * A phone keeps an arrangement of its own, under "<room>#phone": its grid is
 * two columns, so the same sizes mean other things there — wide is the
 * whole row — and a desktop's choices would not carry over well. Until a
 * room is arranged on a phone, the phone's mosaic lays it out.
 */

/** The key a room's arrangement is kept under, on a phone or not. */
export const layoutRoom = (room: string, narrow: boolean) => (narrow ? `${room}#phone` : room);

import { clearData, clearStyle, setData, setDisabled, setStyle } from "./dom";
import { applyMosaic } from "./mosaic";

/* The three icons the arranging controls draw. They are built by hand, outside
   Solid, so the SDK's Icon component is out of reach here; the paths are the
   Material Design Icons of the same names, marked data-icon like the SDK's. */
const GLYPHS = {
  "mdi:chevron-left": "M15.41 16.58L10.83 12l4.58-4.59L14 6l-6 6l6 6z",
  "mdi:chevron-right": "M8.59 16.58L13.17 12L8.59 7.41L10 6l6 6l-6 6z",
  "mdi:drag":
    "M7 19v-2h2v2H7m4 0v-2h2v2h-2m4 0v-2h2v2h-2m-8-4v-2h2v2H7m4 0v-2h2v2h-2m4 0v-2h2v2h-2m-8-4V9h2v2H7m4 0V9h2v2h-2m4 0V9h2v2h-2M7 7V5h2v2H7m4 0V5h2v2h-2m4 0V5h2v2h-2Z",
  "mdi:close":
    "M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z",
} as const;

function glyph(icon: keyof typeof GLYPHS, size: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.dataset.icon = icon;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", GLYPHS[icon]);
  svg.append(path);
  return svg;
}

/** Which card an element is: its own data-card, or the kind in its class. */
export function cardKey(el: HTMLElement): string {
  if (el.dataset.card) return el.dataset.card;
  const kind = [...el.classList].find(
    (name) => name.startsWith("rb-card--") && name !== "rb-card--hero" && name !== "rb-card--error",
  );
  if (!kind) return "";
  /* The player and Plex's newest arrivals take turns in one place — the
     player while something plays, the shelf the rest of the time — so they
     are one slot: whichever is showing has the position and the size the
     room gave it. */
  const name = kind.slice("rb-card--".length);
  return name === "plex" ? "media" : name;
}

/** The five sizes: one tile, two across, two down, two by two, and a
    16:9 picture three across and two down — bigger than the big square. */
export type Size = "compact" | "wide" | "portrait" | "big" | "cinema" | "half";

export const SIZES: Size[] = ["compact", "wide", "portrait", "big", "cinema", "half"];

const SIZE_LABEL: Record<Size, string> = {
  compact: "Small (1×1)",
  wide: "Wide (2×1)",
  portrait: "Tall (1×2)",
  big: "Big (2×2)",
  cinema: "Cinema (16:9, 3×2)",
  half: "Half (½ tile: one column, half a tile high)",
};

const SPANS: Record<Size, [number, number]> = {
  compact: [1, 1],
  wide: [2, 1],
  portrait: [1, 2],
  big: [2, 2],
  cinema: [3, 2],
  half: [1, 1],
};

/* What each size tells the card about its shape, in the mosaic's words, so
   the cards that have a standing design use it here as well. */
const SHAPES: Record<Size, string> = {
  compact: "small",
  wide: "wide",
  portrait: "portrait",
  big: "big",
  /* Drawn as its big design, given more room: every card has one. */
  cinema: "big",
  half: "half",
};

export type RoomLayout = {
  /** The cards in the order they were put in; empty for the board's own. */
  order: string[];
  /** Each card's size, or undefined for the board's own choice. */
  sizes?: Map<string, Size>;
};

export function readLayout(entries: string[], room: string): RoomLayout {
  const prefix = `${room}@`;
  const order: string[] = [];
  const sizes = new Map<string, Size>();
  let touched = false;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    touched = true;
    const rest = entry.slice(prefix.length);
    if (rest.startsWith("!")) {
      sizes.set(rest.slice(1), "big");
    } else if (rest.startsWith("=")) {
      const colon = rest.indexOf(":");
      const size = rest.slice(1, colon) as Size;
      if (colon > 1 && SIZES.includes(size)) sizes.set(rest.slice(colon + 1), size);
    } else {
      order.push(rest);
    }
  }
  return { order, sizes: touched ? sizes : undefined };
}

export function writeLayout(entries: string[], room: string, layout: RoomLayout): string[] {
  const prefix = `${room}@`;
  const others = entries.filter((entry) => !entry.startsWith(prefix));
  return [
    ...others,
    ...layout.order.map((key) => `${prefix}${key}`),
    ...[...(layout.sizes ?? new Map<string, Size>())]
      .filter(([, size]) => size !== "compact")
      .map(([key, size]) => `${prefix}=${size}:${key}`),
  ];
}

/** The board's cards, in the order they are shown. */
export function orderedCards(grid: HTMLElement, order: string[]): HTMLElement[] {
  /* A card taken off the board (the X while arranging) is left out. */
  const cards = [...grid.children].filter(
    (el) => el.classList.contains("rb-card") && (el as HTMLElement).dataset.removed === undefined,
  ) as HTMLElement[];
  const rank = new Map(order.map((key, index) => [key, index]));
  /* A card never placed — one that turned up after the room was arranged —
     keeps its place relative to the others and goes after the placed ones. */
  return cards
    .map((el, index) => ({ el, rank: rank.get(cardKey(el)) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map((row) => row.el);
}

/** The size the board gives a card of its own accord. */
const sizeByDefault = (el: HTMLElement): Size =>
  el.classList.contains("rb-card--hero") ||
  el.classList.contains("rb-card--media") ||
  el.classList.contains("rb-card--plex")
    ? "big"
    : "compact";

/** The mosaic's shapes, in the arrangement's words. */
const FROM_SHAPE: Record<string, Size> = { small: "compact", wide: "wide", portrait: "portrait", big: "big", half: "half" };

export function sizeOf(el: HTMLElement, layout: RoomLayout, narrow = false): Size {
  if (layout.sizes) return layout.sizes.get(cardKey(el)) ?? "compact";
  /* A phone not yet arranged: the shape the mosaic gave the card. */
  if (narrow) return FROM_SHAPE[el.dataset.shape ?? ""] ?? "compact";
  return sizeByDefault(el);
}

/**
 * How wide a 16:9 card is: three columns where the grid has them, the whole
 * row where it has fewer — a span of three in a grid of two made a third
 * column out of nothing and pushed everything sideways.
 */
function cinemaColumns(grid: HTMLElement): string {
  const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  return columns >= 3 ? "span 3" : "1 / -1";
}

/** The 16:9 cards fitted again to the grid's columns, after it was resized. */
export function refitCinema(grid: HTMLElement): void {
  const cards = grid.querySelectorAll<HTMLElement>(':scope > .rb-card[data-size="cinema"]');
  if (!cards.length) return;
  const span = cinemaColumns(grid);
  for (const card of cards) setStyle(card, "grid-column", span);
}

/**
 * Put the cards where the arrangement says.
 *
 * Each card is placed by its order, and once the room has been arranged
 * each is sized by it too. On a phone not yet arranged the mosaic plans the
 * shapes, from the cards in this order. An arranged phone grid packs densely,
 * so a small card fills the hole a big one leaves beside it.
 */
export function applyLayout(grid: HTMLElement, narrow: boolean, layout: RoomLayout) {
  const cards = orderedCards(grid, layout.order);

  if (narrow && !layout.sizes) {
    clearStyle(grid, "grid-auto-flow");
    applyMosaic(grid, true, cards);
    return;
  }

  applyMosaic(grid, false);
  if (narrow) setStyle(grid, "grid-auto-flow", "row dense");
  else clearStyle(grid, "grid-auto-flow");
  cards.forEach((card, position) => {
    setStyle(card, "order", String(position));
    if (layout.sizes) {
      const size = sizeOf(card, layout);
      const [across, down] = SPANS[size];
      /* On a phone the rows are half a tile high (styles.css), so every size
         takes twice its rows there — and a half tile one: two of them stack
         in the space of one small tile. */
      const rows = narrow && size !== "half" ? down * 2 : down;
      setStyle(card, "grid-column", size === "cinema" ? cinemaColumns(grid) : `span ${across}`);
      setStyle(card, "grid-row", `span ${rows}`);
      setData(card, "size", size);
      setData(card, "shape", SHAPES[size]);
    } else {
      clearStyle(card, "grid-column");
      clearStyle(card, "grid-row");
      clearData(card, "size");
      clearData(card, "shape");
    }
  });
}

/**
 * The arranging controls, laid over every card while arranging: a cover that
 * keeps a tap from opening the card, and on it the three keys — earlier, big,
 * later. Plain DOM rather than components: they go onto cards that belong to
 * a dozen different components, and come off again when arranging ends.
 */
export function attachControls(
  grid: HTMLElement,
  layout: RoomLayout,
  narrow: boolean,
  actions: {
    move: (key: string, by: -1 | 1) => void;
    resize: (key: string, size: Size) => void;
    /** Put the card where another one is (dragged and dropped on it). */
    place: (key: string, onto: string) => void;
    /** Take the card off the board. */
    remove: (key: string) => void;
  },
) {
  /* As they stand: on a phone the mosaic may have moved a card. */
  const cards = orderedCards(grid, layout.order).sort(
    (a, b) => Number(a.style.order || 0) - Number(b.style.order || 0),
  );
  cards.forEach((card, position) => {
    const key = cardKey(card);
    if (!key) return;

    let cover = card.querySelector(":scope > .rb-arrange") as HTMLElement | null;
    if (!cover) {
      cover = document.createElement("div");
      cover.className = "rb-arrange";

      /* Where it goes: earlier and later. */
      const moves = document.createElement("div");
      moves.className = "rb-arrange-moves";
      for (const [action, icon, label] of [
        ["earlier", "mdi:chevron-left", "Move earlier"],
        ["later", "mdi:chevron-right", "Move later"],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `rb-arrange-${action}`;
        button.dataset.action = action;
        button.setAttribute("aria-label", label);
        button.append(glyph(icon, 18));
        moves.append(button);
      }

      /* How big: each size drawn as its own shape. */
      const sizes = document.createElement("div");
      sizes.className = "rb-arrange-sizes";
      for (const size of SIZES) {
        /* Half a tile is a phone's; 16:9 is not — on two columns it is only
           the big square again, a sixth button that changes nothing. */
        if (size === "half" && !narrow) continue;
        if (size === "cinema" && narrow) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "size";
        button.dataset.size = size;
        const label = SIZE_LABEL[size];
        button.setAttribute("aria-label", label);
        button.title = label;
        const shape = document.createElement("i");
        shape.dataset.size = size;
        button.append(shape);
        sizes.append(button);
      }

      /* Off the board: an X in the corner. */
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "rb-arrange-remove";
      remove.dataset.action = "remove";
      remove.setAttribute("aria-label", "Remove from the board");
      remove.title = "Remove from the board";
      remove.append(glyph("mdi:close", 16));

      /* A grip in the corner, saying the card can be picked up. */
      const grip = document.createElement("span");
      grip.className = "rb-arrange-grip";
      grip.setAttribute("aria-hidden", "true");
      grip.append(glyph("mdi:drag", 16));

      cover.append(grip, remove, moves, sizes);
      dragToPlace(grid, card, cover, (onto) => actions.place(cardKey(card), onto));

      /* Nothing on the card underneath may answer while arranging. */
      cover.addEventListener("pointerdown", (event) => event.stopPropagation());
      cover.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        const button = (event.target as Element).closest("button") as HTMLButtonElement | null;
        if (!button || button.disabled) return;
        const current = cardKey(card);
        const which = button.dataset.action;
        if (which === "earlier") actions.move(current, -1);
        else if (which === "later") actions.move(current, 1);
        else if (which === "size") actions.resize(current, button.dataset.size as Size);
        else if (which === "remove") actions.remove(current);
      });
      card.append(cover);
    }

    const size = sizeOf(card, layout, narrow);
    for (const button of cover.querySelectorAll<HTMLButtonElement>('[data-action="size"]'))
      setData(button, "on", String(button.dataset.size === size));
    setDisabled(cover.querySelector<HTMLButtonElement>('[data-action="earlier"]'), position === 0);
    setDisabled(cover.querySelector<HTMLButtonElement>('[data-action="later"]'), position === cards.length - 1);
  });
}

export function detachControls(grid: HTMLElement) {
  for (const cover of grid.querySelectorAll(".rb-card > .rb-arrange")) cover.remove();
}

/**
 * Drag and drop, on the arranging cover of a card.
 *
 * A mouse picks the card up as soon as it moves; a finger has to hold it for
 * a moment first, so that a swipe still scrolls the board. Picked up, the
 * card follows the pointer, lifted over the others; the card under it is
 * outlined as where it will go, and near the top or the foot of the board
 * the board scrolls. Let go over a card and the dragged one takes its place —
 * one config write, the same as the arrows make.
 *
 * Plain DOM, like the rest of the controls: the cover belongs to no Solid
 * component, and the card it lies on can be any of a dozen.
 */
function dragToPlace(grid: HTMLElement, card: HTMLElement, cover: HTMLElement, drop: (onto: string) => void) {
  const HOLD_MS = 320;
  const SLOP = 7;
  let start: { x: number; y: number; id: number; touch: boolean } | undefined;
  let dragging = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let target: HTMLElement | undefined;
  let scrollTimer: ReturnType<typeof setInterval> | undefined;
  let last = { x: 0, y: 0 };

  const root = () => grid.getRootNode() as Document | ShadowRoot;

  const cardAt = (x: number, y: number): HTMLElement | undefined => {
    for (const el of root().elementsFromPoint(x, y)) {
      const other = (el as HTMLElement).closest?.(".rb-card") as HTMLElement | null;
      if (other && other !== card && other.parentElement === grid && other.dataset.removed === undefined) return other;
    }
    return undefined;
  };

  const mark = (next: HTMLElement | undefined) => {
    if (next === target) return;
    if (target) delete target.dataset.dropTarget;
    target = next;
    if (target) target.dataset.dropTarget = "";
  };

  const follow = (x: number, y: number) => {
    last = { x, y };
    card.style.translate = `${x - start!.x}px ${y - start!.y + grid.scrollTop - scrollStart}px`;
    mark(cardAt(x, y));
  };
  let scrollStart = 0;

  const pickUp = () => {
    if (!start) return;
    dragging = true;
    scrollStart = grid.scrollTop;
    card.dataset.dragging = "";
    grid.dataset.dragging = "";
    try {
      cover.setPointerCapture(start.id);
    } catch {
      /* The pointer has gone; the drag simply ends on the next move. */
    }
    if (start.touch && "vibrate" in navigator) navigator.vibrate?.(12);
    /* Near the edges the board scrolls, so a card can go further than the
       screen shows. */
    scrollTimer = setInterval(() => {
      const box = grid.getBoundingClientRect();
      const edge = 56;
      let by = 0;
      if (last.y < box.top + edge) by = -Math.ceil((box.top + edge - last.y) / 4);
      else if (last.y > box.bottom - edge) by = Math.ceil((last.y - (box.bottom - edge)) / 4);
      if (by) {
        grid.scrollTop += by;
        follow(last.x, last.y);
      }
    }, 16);
  };

  const finish = (commit: boolean) => {
    clearTimeout(holdTimer);
    clearInterval(scrollTimer);
    const onto = target ? cardKey(target) : "";
    mark(undefined);
    if (dragging) {
      card.style.translate = "";
      delete card.dataset.dragging;
      delete grid.dataset.dragging;
    }
    const was = dragging;
    dragging = false;
    start = undefined;
    if (was && commit && onto) drop(onto);
  };

  cover.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("button")) return;
    if (event.button !== undefined && event.button > 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId, touch: event.pointerType !== "mouse" };
    last = { x: event.clientX, y: event.clientY };
    if (start.touch) holdTimer = setTimeout(pickUp, HOLD_MS);
  });

  cover.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.id) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (!dragging) {
      if (start.touch) {
        /* Moved before the hold: a swipe, the board's to scroll. */
        if (moved > SLOP) {
          clearTimeout(holdTimer);
          start = undefined;
        }
        return;
      }
      if (moved < SLOP) return;
      pickUp();
    }
    follow(event.clientX, event.clientY);
  });

  /* Once a finger has picked the card up, its moves are the drag's and not
     the page's: the first move after the hold is still cancellable. */
  cover.addEventListener(
    "touchmove",
    (event) => {
      if (dragging) event.preventDefault();
    },
    { passive: false },
  );

  cover.addEventListener("pointerup", () => finish(true));
  cover.addEventListener("pointercancel", () => finish(false));
  cover.addEventListener("lostpointercapture", () => {
    if (dragging) finish(true);
  });
  /* A long press on a phone opens the system's menu over a picture; not here. */
  cover.addEventListener("contextmenu", (event) => {
    if (start || dragging) event.preventDefault();
  });
}
