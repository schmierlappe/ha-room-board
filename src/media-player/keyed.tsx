import { For, createMemo, type Accessor, type JSX } from "solid-js";

/**
 * A list that keeps each row for as long as its id is in the list.
 *
 * Solid's <For> keys rows on the item itself, and every state change hands
 * the board a new object for the entity that changed. So a sensor reporting
 * in rebuilt its whole card: the chart let go of its history, fetched it
 * again and drew "No history yet" in between; a camera restarted its stream;
 * every icon reloaded. Across a board of twenty entities that was something
 * flickering every few seconds.
 *
 * Here the rows are keyed on the id, and the row is handed a stand-in that
 * reads through to the current item on every property access — so what the
 * row renders stays reactive, but the row itself, and everything it holds,
 * lives as long as the thing it shows.
 */
export function Keyed<T extends object>(props: {
  each: readonly T[];
  /** The key, where it is not `id`. */
  by?: (item: T) => string;
  children: (item: T, index: Accessor<number>) => JSX.Element;
}) {
  const keyOf = (item: T) => (props.by ? props.by(item) : String((item as { id?: string | number }).id));

  const keys = createMemo(() => props.each.map(keyOf), [], {
    equals: (a, b) => a.length === b.length && a.every((key, i) => key === b[i]),
  });

  /* One index per update, shared by every row: each row searching the whole
     list on every property it read was a hundred-row settings list doing ten
     thousand comparisons for every state change in the room. */
  const index = createMemo(() => {
    const map = new Map<string, T>();
    for (const item of props.each) map.set(keyOf(item), item);
    return map;
  });

  return (
    <For each={keys()}>
      {(key, position) => {
        /* The last item seen under this key, kept for the moment between the
           list dropping it and <For> disposing of the row. */
        let last: T | undefined;
        const current = (): T | undefined => {
          const found = index().get(key);
          if (found) last = found;
          return found ?? last;
        };

        const stand = new Proxy({} as T, {
          get: (_, name) => {
            const item = current() as Record<PropertyKey, unknown> | undefined;
            const value = item?.[name];
            /* Methods (a Date's, say) run against the real item. */
            return typeof value === "function" ? (value as Function).bind(item) : value;
          },
          has: (_, name) => !!current() && name in (current() as object),
          ownKeys: () => (current() ? Reflect.ownKeys(current() as object) : []),
          getOwnPropertyDescriptor: (_, name) => {
            const item = current();
            if (!item || !(name in item)) return undefined;
            return {
              configurable: true,
              enumerable: true,
              writable: false,
              value: (item as Record<PropertyKey, unknown>)[name],
            };
          },
        });

        return props.children(stand, position);
      }}
    </For>
  );
}
