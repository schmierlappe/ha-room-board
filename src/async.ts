import { createEffect, createSignal, on, onCleanup, onMount, untrack } from "solid-js";

/**
 * The steps one after another, each started once the one before is through —
 * for calls whose order matters, or that would trip over each other if they
 * ran at once. A step that fails stops the rest, and the failure is the
 * returned promise's.
 */
export function inOrder<T>(items: readonly T[], step: (item: T) => Promise<unknown>): Promise<void> {
  return items.reduce<Promise<void>>(
    (done, item) => done.then(() => step(item)).then(() => undefined),
    Promise.resolve(),
  );
}

/**
 * Each way of asking in turn until one answers — a proxy before the direct
 * address, a narrower request behind a wide one — so the later ones are only
 * tried when the earlier have not worked.
 *
 * `attempt` returns `{ answer }` to stop there, the answer itself possibly
 * empty ("asked, and there is nothing"), or undefined to go on to the next.
 * Undefined when none of them answered.
 */
export async function firstAnswer<T, R>(
  items: readonly T[],
  attempt: (item: T) => Promise<{ answer: R } | undefined>,
): Promise<R | undefined> {
  if (!items.length) return undefined;
  const result = await attempt(items[0]!);
  return result ? result.answer : firstAnswer(items.slice(1), attempt);
}

/**
 * A list let in a batch at a time, starting a while after the first paint.
 *
 * The sealed engine of Dash 1.5 gives a widget one burst of work to start
 * in, and the whole dashboard one more that every widget draws from. A
 * widget that makes views of a hundred devices or monitors in one step went
 * over it while the others were starting, and was stopped. `started` is
 * false until `delayMs` has passed (look for the list only then); `take`
 * gives as much of a list as is let in so far, `size` more every `pauseMs`
 * until all of it is, after which whatever is added comes at once. Call it
 * while a component is being made.
 */
export function useTrickle(delayMs: number, size: number, pauseMs: number) {
  const [started, setStarted] = createSignal(false);
  const [shown, setShown] = createSignal(0);
  let total = 0;
  onMount(() => {
    let timer = setTimeout(function more() {
      setStarted(true);
      setShown((n) => n + size);
      if (shown() < total) timer = setTimeout(more, pauseMs);
      else setShown(Number.POSITIVE_INFINITY);
    }, delayMs);
    onCleanup(() => clearTimeout(timer));
  });
  return {
    started,
    take<T>(list: T[]): T[] {
      total = list.length;
      return shown() >= list.length ? list : list.slice(0, shown());
    },
  };
}

/**
 * A value passed on at most once every `ms`: the first change at once, the
 * ones after it together when the time is up. For a widget whose sources
 * report many times a second (a network's counters, a monitor's response
 * times) and that has no need to be redrawn as often: Dash 1.5's sealed
 * engine charges each redraw, and a card rebuilt on every reading spent most
 * of its budget on it. Call it while a component is being made.
 */
export function useCoalesced<T>(source: () => T, ms: number): () => T {
  const [value, setValue] = createSignal<T>(untrack(source), { equals: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const flush = () => {
    timer = undefined;
    if (!pending) return;
    pending = false;
    setValue(() => untrack(source));
    timer = setTimeout(flush, ms);
  };
  createEffect(
    on(
      source,
      (next) => {
        if (timer) {
          pending = true;
          return;
        }
        setValue(() => next);
        timer = setTimeout(flush, ms);
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(timer));
  return value;
}
