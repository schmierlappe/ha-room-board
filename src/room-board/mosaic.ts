import { clearData, clearStyle, setData, setStyle } from "./dom";

/**
 * The phone board's mosaic, planned rather than counted.
 *
 * Two columns and three shapes: a portrait (one column, two rows), a small
 * tile (one by one) and a wide tile (the whole row). The board is built from
 * figures that each fill their rows exactly, so there is never a hole:
 *
 *   A  portrait on the left, two small stacked beside it
 *   W  one wide tile
 *   C  portrait on the right, two small stacked beside it
 *
 * in the rhythm A, W, C, W, round again — the portraits zig-zag down the
 * screen and the wide tiles are the breaks between them.
 *
 * Some cards have a shape of their own. A cover or a poster wants to stand
 * up, so the media player and Plex's newest arrival only ever take a
 * portrait; a lock is a switch with a picture and only ever takes a small
 * tile. Everything else goes where the rhythm puts it. Counting positions in
 * CSS could not do that: a card that refused its slot knocked every card
 * after it out of step and left a gap. Here a card with a shape of its own is
 * pulled forward to the next slot that fits it, and the figures still close.
 */

/** What a card will accept. */
export type Fit = "portrait" | "small" | "any";

/** What it gets. */
export type Shape = "portrait" | "small" | "wide";

interface Pending {
  fit: Fit;
  index: number;
}

type Placed = { index: number; shape: Shape };

const canStand = (card: Pending) => card.fit !== "small";
const canSit = (card: Pending) => card.fit !== "portrait";
const canSpread = (card: Pending) => card.fit === "any";
const isCover = (card: Pending) => card.fit === "portrait";

/**
 * The cards still to place and the plan so far, with the figures the
 * mosaic is built from — each a step that places its cards and says so, or
 * places nothing and leaves the queue as it was.
 */
class Planner {
  queue: Pending[];
  plan: Placed[] = [];

  constructor(fits: Fit[]) {
    this.queue = fits.map((fit, index) => ({ fit, index }));
  }

  get left() {
    return this.queue.length;
  }

  private take(test: (card: Pending) => boolean) {
    const at = this.queue.findIndex(test);
    return at < 0 ? undefined : this.queue.splice(at, 1)[0];
  }

  /* Cards taken for a figure that then could not be finished go back where
     they were, so the order the board lists them in survives a false start. */
  private giveBack(...cards: (Pending | undefined)[]) {
    for (const card of cards) if (card) this.queue.push(card);
    this.queue.sort((a, b) => a.index - b.index);
  }

  private put(card: Pending, shape: Shape) {
    this.plan.push({ index: card.index, shape });
  }

  /* A card with a shape of its own goes into the first slot that fits it,
     ahead of cards that would take any shape. The flexible ones are what the
     end of the board needs — a lone card there has to go wide — so spending
     them early is what left a lock or a cover stranded last and stretched
     across the row. */
  private small() {
    return this.take((card) => card.fit === "small") ?? this.take(canSit);
  }

  private tall() {
    return this.take(isCover) ?? this.take(canStand);
  }

  /** The last card takes the whole row whatever it is: alone, anything
      narrower leaves a hole beside it. */
  lastWide(): boolean {
    if (this.left !== 1) return false;
    this.put(this.queue.shift()!, "wide");
    return true;
  }

  /** Two small side by side. */
  pairSmall(): boolean {
    const first = this.small();
    const second = this.small();
    if (first && second) {
      this.put(first, "small");
      this.put(second, "small");
      return true;
    }
    this.giveBack(first, second);
    return false;
  }

  /** Two portraits side by side — two covers, say. */
  pairTall(): boolean {
    const one = this.tall();
    const two = this.tall();
    if (one && two) {
      this.put(one, "portrait");
      this.put(two, "portrait");
      return true;
    }
    this.giveBack(one, two);
    return false;
  }

  /** The break between figures: a wide tile. Two left would be a wide tile
      and then a lone one; a pair reads better. Nothing that can spread:
      the break is skipped and the next figure comes straight on. */
  wideBreak() {
    if (this.lastWide()) return;
    if (this.left === 2 && this.pairSmall()) return;
    const card = this.take(canSpread);
    if (card) this.put(card, "wide");
  }

  /** Two covers and not enough small cards to give each its own figure:
      they stand side by side instead. Otherwise the first took a figure and
      the second, left over at the end, was stretched across the row. */
  coversTogether(): boolean {
    const covers = this.queue.filter(isCover).length;
    if (covers < 2 || this.queue.filter(canSit).length >= covers * 2) return false;
    this.put(this.take(isCover)!, "portrait");
    this.put(this.take(isCover)!, "portrait");
    return true;
  }

  /** A portrait with two small tiles beside it — the portrait on the left
      (A) or in the middle of the row's flow (C). */
  portraitFigure(left: boolean): boolean {
    if (this.left < 3) return false;
    const up = this.tall();
    const one = this.small();
    const two = this.small();
    if (!up || !one || !two) {
      this.giveBack(up, one, two);
      return false;
    }
    const order: [Pending, Shape][] = left
      ? [[up, "portrait"], [one, "small"], [two, "small"]]
      : [[one, "small"], [up, "portrait"], [two, "small"]];
    for (const [card, shape] of order) this.put(card, shape);
    return true;
  }

  /** A figure's turn: the best of what fits, down to the last resort. */
  figure(left: boolean) {
    if (this.coversTogether() || this.portraitFigure(left)) return;
    // Not enough for a figure: close the board with what is left.
    if (this.lastWide() || this.pairSmall() || this.pairTall()) return;
    // A portrait-only card and a small-only card and nothing else: one of
    // them has to give. The portrait one does — the media card has a
    // compact layout for exactly this width.
    this.put(this.queue.shift()!, "small");
    this.put(this.queue.shift()!, "small");
  }
}

export function planMosaic(fits: Fit[]): Placed[] {
  const planner = new Planner(fits);
  const rhythm = ["A", "W", "C", "W"] as const;
  /* The rhythm round and round until every card has its place. */
  let step = 0;
  while (planner.left) {
    const want = rhythm[step % rhythm.length];
    step += 1;
    if (want === "W") planner.wideBreak();
    else planner.figure(want === "A");
  }
  return planner.plan;
}

/** What a card on the board will accept, read from its class. */
export function fitOf(card: Element): Fit {
  const classes = card.classList;
  if (classes.contains("rb-card--media") || classes.contains("rb-card--plex")) return "portrait";
  if (classes.contains("rb-card--lock")) return "small";
  return "any";
}

/**
 * Lays the board's cards out as a mosaic, or takes the layout off again.
 *
 * Each card also gets data-shape, which a card can read to change what it
 * shows. Inline order and spans, because they have to beat every card's own span in
 * the stylesheet — the media card's two columns, the hero's two rows — and
 * inline is the one thing that does without a race of selectors.
 */
export function applyMosaic(grid: HTMLElement, on: boolean, ordered?: HTMLElement[]) {
  /* In the order the room was arranged in, where it has been (arrange.ts). */
  const cards =
    ordered ??
    ([...grid.children].filter((el) => el.classList.contains("rb-card")) as HTMLElement[]);

  if (!on) {
    for (const card of cards) {
      clearStyle(card, "order");
      clearStyle(card, "grid-column");
      clearStyle(card, "grid-row");
      clearData(card, "shape");
      clearData(card, "size");
    }
    return;
  }

  const plan = planMosaic(cards.map(fitOf));
  plan.forEach(({ index, shape }, position) => {
    const card = cards[index]!;
    setStyle(card, "order", String(position));
    /* Two columns, not the whole row: on a phone that is the row, and on a
       wider portrait screen two figures sit side by side. */
    setStyle(card, "grid-column", shape === "wide" ? "span 2" : "auto");
    /* The phone's rows are half a tile high (styles.css): a tile is two of
       them, a portrait four. */
    setStyle(card, "grid-row", shape === "portrait" ? "span 4" : "span 2");
    /* Said on the card as well, for the cards that have more to show when
       they are given the room — the vacuum puts its map in a portrait. */
    setData(card, "shape", shape);
  });
}
