import { For, Index, Show, createEffect, createSignal, on } from "solid-js";
import { Icon, useEntities, useService, type EntityView } from "@glasshome/widget-sdk";
import { Keyed } from "./keyed";
import { errorMessage } from "../errors";

/**
 * Shopping and to-do lists — Bring!, Home Assistant's own list, anything that
 * is a `todo` entity. The entity's state is how many items are still open,
 * which is all the card needs; the overlay asks for the items themselves
 * (todo.get_items) and ticks them off and adds to them through the same
 * integration, so Bring's app and the board are the one list.
 */

export type TodoItem = { uid: string; summary: string; description?: string };

/** How many items are still open, from the entity's own state. */
export const openCount = (entity: EntityView | undefined) => {
  const value = Number(entity?.state);
  return Number.isFinite(value) ? value : 0;
};

/** The chip on the agenda card: a basket and how much is still open, all
    lists added up — one chip, however many lists there are. */
export function TodoChips(props: { ids: string[] }) {
  const all = useEntities(() => props.ids);
  const lists = () => all().filter(usable);
  const open = () => lists().reduce((sum, list) => sum + openCount(list), 0);
  const names = () => lists().map((list) => `${list.friendlyName ?? list.id}: ${openCount(list)}`).join("\n");
  return (
    <Show when={lists().length}>
      <span class="rb-todo-chip" data-empty={open() === 0} title={names()}>
        <Icon icon="mdi:cart-outline" width="14" />
        <b>{open()}</b>
      </span>
    </Show>
  );
}

/** One list in the overlay: its open items, a tick to take one off, a field to add. */
function TodoList(props: { entity: EntityView }) {
  const { callService } = useService();
  const [items, setItems] = createSignal<TodoItem[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  /* Ticked here, waiting for the list to say so: drawn struck through at once. */
  const [ticked, setTicked] = createSignal<string[]>([]);
  const [note, setNote] = createSignal<string | undefined>();

  const load = async () => {
    if (!usable(props.entity)) return;
    try {
      const response = (await callService(
        "todo",
        "get_items",
        { status: ["needs_action"] },
        { entity_id: props.entity.id },
        { returnResponse: true },
      )) as Record<string, any> | undefined;
      const own = response?.[props.entity.id] ?? response?.response?.[props.entity.id];
      const list: any[] = Array.isArray(own?.items) ? own.items : [];
      setItems(
        list.map((item) => ({
          uid: String(item.uid ?? item.summary),
          summary: String(item.summary ?? ""),
          description: item.description ? String(item.description) : undefined,
        })),
      );
      setTicked([]);
    } catch (error) {
      setItems([]);
      setNote(`Could not read the list: ${errorMessage(error, "no answer")}`);
    }
    setLoaded(true);
  };

  /* Read again whenever the list changes — from here, from Bring's app, from
     anyone: its state (the open count) and its last change say so. */
  createEffect(
    on(
      () =>
        `${props.entity.state}|${props.entity.lastUpdated?.getTime?.() ?? ""}`,
      () => void load(),
    ),
  );

  const tick = (item: TodoItem) => {
    setTicked((was) => [...was, item.uid]);
    void callService(
      "todo",
      "update_item",
      { item: item.uid, status: "completed" },
      { entity_id: props.entity.id },
    ).catch((error: unknown) => {
      /* Said, not just undone: an item that quietly unticks itself looks
         like a tap that missed. */
      setTicked((was) => was.filter((id) => id !== item.uid));
      setNote(`"${item.summary}" could not be ticked off: ${errorMessage(error, "no answer")}`);
    });
  };

  const add = (event: Event) => {
    event.preventDefault();
    const text = draft().trim();
    if (!text) return;
    setDraft("");
    setNote(undefined);
    /* Read back either way: Bring's integration can report a failure after
       it has saved the item (an error in reading Bring's reply), and the list
       then has it all the same. Only an item that truly did not arrive is
       said so — and put back in the field to try again. */
    let failure = "";
    void callService("todo", "add_item", { item: text }, { entity_id: props.entity.id })
      .catch((error: unknown) => {
        failure = errorMessage(error, "");
      })
      .then(() => new Promise((done) => setTimeout(done, 800)))
      .then(() => load())
      .then(() => {
        const arrived = items().some((item) => item.summary.toLowerCase() === text.toLowerCase());
        if (!arrived) {
          setNote(`"${text}" could not be added${failure ? `: ${failure}` : "."}`);
          if (!draft()) setDraft(text);
        }
      });
  };

  return (
    <section class="rb-todo">
      <h3 class="rb-cal-blockname">
        <span class="rb-todo-title">
          <Icon icon="mdi:cart-outline" width="16" />
          {props.entity.friendlyName ?? "Shopping list"}
        </span>
        <span>{openCount(props.entity) ? `${openCount(props.entity)} open` : "All done"}</span>
      </h3>

      {/* Not a <form>: the sealed engine of Dash 1.5 draws only an allowlist
          of elements, without <form>, so the row never showed. Enter in the
          field and the button both add. */}
      <div class="rb-todo-add">
        <input
          type="text"
          placeholder="Add to the list"
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add(event);
          }}
        />
        <button type="button" aria-label="Add" disabled={!draft().trim()} onClick={add}>
          <Icon icon="mdi:plus" width="18" />
        </button>
      </div>

      <Show when={note()}>
        <p class="rb-todo-note">{note()}</p>
      </Show>

      <div class="rb-todo-items">
        <Keyed each={items()} by={(item) => item.uid}>
          {(item) => (
            <button
              class="rb-todo-item"
              data-done={ticked().includes(item.uid)}
              onClick={() => tick(item)}
            >
              <span class="rb-todo-box">
                <Icon icon="mdi:check" width="13" />
              </span>
              <span class="rb-todo-text">
                <span class="rb-truncate">{item.summary}</span>
                <Show when={item.description}>
                  <small class="rb-truncate">{item.description}</small>
                </Show>
              </span>
            </button>
          )}
        </Keyed>
        <Show when={loaded() && !items().length}>
          <p class="rb-act-none">Nothing on the list.</p>
        </Show>
      </div>
    </section>
  );
}

/** Every configured list, for the agenda overlay. */
/* A list whose integration has lost it (a Bring! list deleted in the app)
   stays behind as unavailable, and asking it for items fails — Home
   Assistant answers that the call matched no entity. Left off instead. */
const usable = (entity: EntityView | undefined) =>
  !!entity && entity.state !== "unavailable" && entity.state !== "unknown";

export function TodoLists(props: { ids: string[] }) {
  const lists = useEntities(() => props.ids);
  return <For each={props.ids}>{(id) => (
    <Show when={lists().find((entity) => entity.id === id && usable(entity))}>
      {(entity) => <TodoList entity={entity()} />}
    </Show>
  )}</For>;
}
