import { artSrc, massCover } from "../artwork";
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { noteImageFailure, resolveArtwork } from "./cover";
import { FEATURE, supports } from "./features";
import { firstAnswer, inOrder } from "../async";
import { errorMessage } from "../errors";

export type QueueRow = {
  id: string;
  name: string;
  subtitle?: string;
  image?: string;
  /** The item the player is on, so the list has a place to start reading. */
  current?: boolean;
  /** Before the current item: already played. */
  past?: boolean;
  /** What it plays, to find the current item by. */
  contentId?: string;
  /** A real item in mass_queue's list, which can be played by its id. */
  playable?: boolean;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/* Every reader below is deliberately forgiving. get_queue is a response-
   returning action whose payload has changed shape between Music Assistant
   releases, and a queue that renders half its fields beats one that renders
   an error because a key moved. */

function artistOf(raw: any): string {
  const list = raw?.artists;
  if (Array.isArray(list) && list.length) {
    return list.map((a: any) => str(a?.name) || str(a)).filter(Boolean).join(", ");
  }
  return str(raw?.artist) || str(raw?.album?.name) || str(raw?.album);
}

function imageOf(raw: any): string {
  const candidates = [
    raw?.image?.path,
    raw?.image,
    raw?.metadata?.images?.[0]?.path,
    raw?.metadata?.images?.[0],
  ];
  return candidates.find((c) => typeof c === "string" && c) ?? "";
}

/**
 * The cover mass_queue embeds in its answer, when it does: a picture Music
 * Assistant downloaded itself, handed over as a data: URL. It needs no proxy
 * and no allowance from the dashboard's policy — data: images are allowed —
 * and it is there for the covers that have no outside address at all (Plex,
 * the local library). mass_queue writes it as "data:image;base64,…", without
 * the image's type; the type is read off the picture's first bytes.
 */
/* How each picture format's base64 begins. */
const IMAGE_SIGNATURES: [start: string, type: string][] = [
  ["/9j/", "jpeg"],
  ["iVBOR", "png"],
  ["R0lG", "gif"],
  ["UklGR", "webp"],
];

function embeddedImage(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.startsWith("data:")) return undefined;
  const comma = raw.indexOf(",");
  if (comma < 0) return undefined;
  const head = raw.slice(0, comma);
  if (/^data:image\/[a-z+.-]+/i.test(head)) return raw;
  const body = raw.slice(comma + 1);
  const type = IMAGE_SIGNATURES.find(([start]) => body.startsWith(start))?.[1] ?? "jpeg";
  return `data:image/${type};base64,${body}`;
}

function toRow(raw: any, i: number, proxy?: string, haBase?: string): QueueRow | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  // A queue item wraps the library item it points at; either level can carry
  // the name, the artist or the artwork depending on the provider.
  const item = raw.media_item && typeof raw.media_item === "object" ? raw.media_item : {};
  // mass_queue flattens its items into media_* fields, the way a player's
  // own attributes are named.
  const name =
    str(raw.media_title) || str(raw.name) || str(item.name) || str(raw.title) || str(item.title);
  if (!name) return undefined;

  return {
    id: str(raw.queue_item_id) || str(raw.item_id) || str(item.uri) || `row-${i}`,
    name,
    subtitle: str(raw.media_artist) || artistOf(raw) || artistOf(item) || undefined,
    /* The embedded cover first: it loads without the proxy. */
    /* Then the track's cover from Music Assistant by its id (src/artwork.ts):
       the address it carries is on another host, which the sealed engine
       refuses. */
    image:
      embeddedImage(raw.local_image_encoded) ??
      massCover(str(raw.media_content_id) || str(item.uri) || undefined) ??
      resolveArtwork(str(raw.media_image) || imageOf(raw) || imageOf(item), proxy, haBase),
    contentId: str(raw.media_content_id) || str(item.uri) || undefined,
  };
}

export type QueueRead = {
  rows: QueueRow[];
  /** What the queue says it holds, which can exceed the rows it hands back. */
  total?: number;
  /** True when a queue object was found at all, empty or not. */
  found: boolean;
};

/**
 * get_queue answers either as a map keyed by entity id or as the queue object
 * itself, and the items it carries are sometimes the list and sometimes just
 * a count with current_item/next_item beside it. All three are read here, so
 * an older Music Assistant shows the two tracks it knows rather than nothing.
 */
export function readQueue(
  response: unknown,
  playerId: string,
  proxy?: string,
  haBase?: string,
): QueueRead {
  if (!response || typeof response !== "object") return { rows: [], found: false };

  const root = response as Record<string, any>;
  const isQueue = (v: any) =>
    !!v && typeof v === "object" && ("items" in v || "current_item" in v || "queue_id" in v);

  /* The answer itself, the player's part of it, or the first that is one. */
  const queue = [root, root[playerId]].find(isQueue) ?? Object.values(root).find(isQueue);

  if (!queue) return { rows: [], found: false };

  const raw = Array.isArray(queue.items)
    ? queue.items
    : [queue.current_item, queue.next_item].filter(Boolean);

  const rows = raw
    .map((r: any, i: number) => toRow(r, i, proxy, haBase))
    .filter(Boolean) as QueueRow[];

  const currentId =
    str(queue.current_item?.queue_item_id) || str(queue.current_item?.item_id);
  if (currentId) {
    for (const row of rows) if (row.id === currentId) row.current = true;
  } else if (rows.length && !Array.isArray(queue.items)) {
    rows[0]!.current = true;
  }

  return {
    rows,
    total: typeof queue.items === "number" ? queue.items : undefined,
    found: true,
  };
}

/* ---------- mass_queue: the whole queue, and changing it ----------
 *
 * Music Assistant's own get_queue hands back the current item and the next,
 * and nothing to change the queue with. The mass_queue custom integration
 * reads the queue either side of the current item and moves, plays and
 * removes items. It is tried first; a dashboard without it is remembered, so
 * the host does not toast the same failed call on every opening. */
let massQueueWorks: boolean | undefined;

type Call = (
  domain: string,
  service: string,
  data?: Record<string, unknown>,
  target?: Record<string, unknown>,
  options?: { returnResponse?: boolean },
) => Promise<unknown>;

/** The first array of items anywhere in a response, keyed by player or not. */
function itemsIn(response: unknown, playerId: string): any[] | undefined {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return undefined;
  const root = response as Record<string, any>;
  for (const value of [root[playerId], root.items, root.queue_items, root.response]) {
    const found = itemsIn(value, playerId);
    if (found) return found;
  }
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

/**
 * The queue around the current item, through mass_queue. The current item
 * is found by what the player says it is playing — the list carries no flag
 * of its own — and everything before it is marked as played.
 */
export async function readMassQueue(
  callService: Call,
  player: EntityView,
  opts: { before?: number; after?: number; artworkProxy?: string; haBaseUrl?: string },
): Promise<QueueRow[] | undefined> {
  if (massQueueWorks === false) return undefined;

  const before = opts.before ?? 5;
  const after = opts.after ?? 50;
  /* Smaller windows behind the one asked for: the integration formats every
     item in the window and one it cannot read (a stream, a deleted track)
     fails the whole call, so a narrower look still shows what it can. */
  const windows = [
    { before, after },
    { before: Math.min(before, 3), after: Math.min(after, 25) },
    { before: 1, after: Math.min(after, 5) },
  ].filter((w, i, all) => i === 0 || w.before !== all[i - 1]!.before || w.after !== all[i - 1]!.after);

  return firstAnswer(windows, async (w) => {
    try {
      const response = await callService(
        "mass_queue",
        "get_queue_items",
        { entity: player.id, limit_before: w.before, limit_after: w.after },
        undefined,
        { returnResponse: true },
      );
      const raw = itemsIn(response, player.id);
      if (!raw) return undefined;
      massQueueWorks = true;
      const rows = raw
        .map((r: any, i: number) => toRow(r, i, opts.artworkProxy, opts.haBaseUrl))
        .filter(Boolean) as QueueRow[];
      return { answer: markCurrent(rows, player, w.before) };
    } catch (err) {
      const message = errorMessage(err);
      console.warn("[media-player] mass_queue.get_queue_items failed", w, message);
      /* Only a missing action rules mass_queue out for the session; any other
         failure is this call's, and the next window or the next opening may
         well work. */
      if (/not found|unknown|not a valid|invalid action|unsupported/i.test(message) && !massQueueWorks) {
        massQueueWorks = false;
        return { answer: undefined };
      }
      return undefined;
    }
  });
}

/** The current item, found by what the player says it is playing — the list
 *  carries no flag of its own — and everything before it marked as played. */
function markCurrent(rows: QueueRow[], player: EntityView, before: number): QueueRow[] {
  const a = player.attributes ?? {};
  const content = str(a.media_content_id);
  const title = str(a.media_title);
  let at = content ? rows.findIndex((row) => row.contentId === content) : -1;
  if (at < 0 && title) at = rows.findIndex((row) => row.name === title);
  if (at < 0) at = Math.min(before, rows.length - 1);
  rows.forEach((row, i) => {
    row.current = i === at;
    row.past = i < at;
    row.playable = true;
  });
  return rows;
}

export type QueueAction = "play" | "next" | "up" | "down" | "remove";

const ACTIONS: Record<QueueAction, string> = {
  play: "play_queue_item",
  next: "move_queue_item_next",
  up: "move_queue_item_up",
  down: "move_queue_item_down",
  remove: "remove_queue_item",
};

export function changeQueue(callService: Call, playerId: string, itemId: string, action: QueueAction) {
  return callService("mass_queue", ACTIONS[action], { entity: playerId, queue_item_id: itemId });
}

/**
 * The tracks either side of the one playing, for the covers beside it.
 *
 * Asked of the queue again whenever the track changes. Music Assistant often
 * hands back only the current and the next item, so the previous one is
 * frequently unknown — the caller fills that side from its own memory of what
 * just played. Only the latest answer is kept: a slow reply for the track
 * before must not overwrite the one for the track now.
 */
export function useQueueNeighbours(opts: {
  player: () => EntityView | undefined;
  enabled: () => boolean;
  artworkProxy?: string;
  haBaseUrl?: string;
}) {
  const { callService } = useService();
  const [prev, setPrev] = createSignal<QueueRow | undefined>();
  const [next, setNext] = createSignal<QueueRow | undefined>();
  /* Counts the answers, so a swipe can wait for the one about its track. */
  const [version, setVersion] = createSignal(0);
  let asked = 0;

  /* A memo, so the queue is asked again only when the track changes: an
     effect on the raw reads re-ran on every update to the player — its
     position, its volume — and asked the queue each time. */
  const key = createMemo(() => {
    const player = opts.player();
    if (!player || !opts.enabled()) return "";
    const a = player.attributes ?? {};
    return `${player.id}|${String(a.media_content_id ?? "")}|${String(a.media_title ?? "")}`;
  });

  /* Asked once per track — and asked again if that answer came back empty
     or failed, a few seconds apart, since the queue is not always ready the
     moment the track changes — then refreshed every half minute while it is
     on screen, so a reordered queue shows its new next. */
  createEffect(
    on(key, (current) => {
      const ask = ++asked;
      if (!current) {
        setPrev(undefined);
        setNext(undefined);
        return;
      }

      let retry: ReturnType<typeof setTimeout> | undefined;
      const run = async (attempt: number) => {
        const player = opts.player();
        const id = player?.id;
        if (!player || !id || ask !== asked) return;

        let found = false;
        const rows = await readMassQueue(callService, player, {
          before: 1,
          after: 1,
          artworkProxy: opts.artworkProxy,
          haBaseUrl: opts.haBaseUrl,
        });
        if (ask !== asked) return;
        if (rows) {
          const at = rows.findIndex((row) => row.current);
          batch(() => {
            setPrev(at > 0 ? rows[at - 1] : undefined);
            setNext(at >= 0 ? rows[at + 1] : undefined);
            setVersion((v) => v + 1);
          });
          found = at >= 0 && rows.length > 1;
        } else {
          try {
            const response = await callService(
              "music_assistant",
              "get_queue",
              {},
              { entity_id: id },
              { returnResponse: true },
            );
            if (ask !== asked) return;
            const read = readQueue(response, id, opts.artworkProxy, opts.haBaseUrl);
            const at = read.rows.findIndex((row) => row.current);
            batch(() => {
              setPrev(at > 0 ? read.rows[at - 1] : undefined);
              setNext(at >= 0 ? read.rows[at + 1] : undefined);
              setVersion((v) => v + 1);
            });
            found = at >= 0 && read.rows.length > 1;
          } catch {
            /* Kept as it was: a failed refresh should not blank the covers. */
          }
        }

        if (!found && attempt < 3) retry = setTimeout(() => void run(attempt + 1), 2500 * attempt);
      };

      void run(1);
      const refresh = setInterval(() => void run(3), 30_000);
      onCleanup(() => {
        clearTimeout(retry);
        clearInterval(refresh);
      });
    }),
  );

  return { prev, next, version };
}

/**
 * What is playing after this. Read-only by design: Music Assistant exposes the
 * queue through a response action but has no action to jump to an item, so
 * offering a row to tap would be a button that does nothing.
 */
export function QueueSheet(props: {
  player: () => EntityView | undefined;
  artworkProxy?: string;
  haBaseUrl?: string;
  onClose: () => void;
  /** Inside a sheet that has its own title and back arrow. */
  inSheet?: boolean;
}) {
  const { callService } = useService();
  const [rows, setRows] = createSignal<QueueRow[]>([]);
  const [total, setTotal] = createSignal<number | undefined>();
  const [status, setStatus] = createSignal<string | undefined>();
  const [loading, setLoading] = createSignal(false);

  /* True when the rows came from mass_queue, which is what makes them
     playable and movable. */
  const [editable, setEditable] = createSignal(false);
  const [menu, setMenu] = createSignal<string | undefined>();
  let body: HTMLDivElement | undefined;
  let scrolled = false;

  const load = async () => {
    const player = props.player();
    const id = player?.id;
    if (!player || !id) return;
    setLoading(true);
    setStatus(undefined);

    const full = await readMassQueue(callService, player, {
      before: 10,
      after: 150,
      artworkProxy: props.artworkProxy,
      haBaseUrl: props.haBaseUrl,
    });
    if (full) {
      setEditable(true);
      setRows(full);
      setTotal(undefined);
      setStatus(full.length ? undefined : "Nothing queued.");
      setLoading(false);
      /* Opened at the track playing, with what played above it. */
      const list = body;
      if (!scrolled && list) {
        scrolled = true;
        /* The list scrolled by hand, not with scrollIntoView: that scrolls
           every box around it as well — the overlay itself, sideways, while
           the panel was still sliding in from beyond its edge. */
        requestAnimationFrame(() => {
          const row = list.querySelector<HTMLElement>('[data-current="true"]');
          if (!row) return;
          const offset =
            row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
          list.scrollTop = Math.max(0, offset - list.clientHeight / 2 + row.offsetHeight / 2);
        });
      }
      return;
    }
    setEditable(false);

    try {
      const response = await callService(
        "music_assistant",
        "get_queue",
        {},
        { entity_id: id },
        { returnResponse: true },
      );

      const read = readQueue(response, id, props.artworkProxy, props.haBaseUrl);
      setRows(read.rows);
      setTotal(read.total);
      if (!read.rows.length) {
        setStatus(read.found ? "Nothing queued." : "This player reports no queue.");
      }
    } catch (err) {
      const message = errorMessage(err);
      setStatus(
        /not found|unknown|unsupported/i.test(message)
          ? "This Music Assistant has no get_queue action — it needs a newer version."
          : message,
      );
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());

  /* The list follows the player: a new track moves the current row. */
  const playingTitle = createMemo(() => String(props.player()?.attributes?.media_title ?? ""));
  createEffect(on(playingTitle, () => void load(), { defer: true }));

  const clear = () => {
    const id = props.player()?.id;
    if (!id) return;
    void callService("media_player", "clear_playlist", {}, { entity_id: id })
      .then(() => load())
      .catch((err: unknown) =>
        setStatus(errorMessage(err, "Could not clear the queue")),
      );
  };

  /* ---------- dragging a track to a new place ----------
   *
   * mass_queue moves an item one place at a time, so a drop is sent as that
   * many steps up or down, in order, after the list has already been
   * rearranged on screen. Only what is still to come can move, and only
   * among itself: the played tracks and the one playing stay put. */
  type Drag = { id: string; from: number; to: number; y: number; dy: number; step: number };
  const [drag, setDrag] = createSignal<Drag | undefined>();
  /* A tap on a track plays it, on a queue that can be changed and not on the one playing. */
  const playable = (row: QueueRow) => editable() && !row.current;
  const firstMovable = () => rows().findIndex((row) => !row.past && !row.current);

  const shiftOf = (index: number) => {
    const d = drag();
    if (!d) return 0;
    if (index === d.from) return d.dy;
    if (d.from < d.to && index > d.from && index <= d.to) return -d.step;
    if (d.to < d.from && index >= d.to && index < d.from) return d.step;
    return 0;
  };

  let scrollTimer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => clearInterval(scrollTimer));

  const startDrag = (event: PointerEvent, row: QueueRow, index: number) => {
    const handle = event.currentTarget as HTMLElement;
    const el = handle.closest(".mp-queue-row") as HTMLElement | null;
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    setMenu(undefined);
    const gap = Number.parseFloat(getComputedStyle(el).marginTop) || 3;
    setDrag({ id: row.id, from: index, to: index, y: event.clientY, dy: 0, step: el.offsetHeight + gap });
  };

  const moveDrag = (event: PointerEvent) => {
    const d = drag();
    if (!d) return;
    const dy = event.clientY - d.y;
    const lo = firstMovable();
    const to = Math.max(lo, Math.min(rows().length - 1, d.from + Math.round(dy / d.step)));
    setDrag({ ...d, dy, to });

    /* Near the list's edges it scrolls, so a track can travel further than
       the screen shows. */
    clearInterval(scrollTimer);
    const box = body?.getBoundingClientRect();
    if (!box || !body) return;
    const edge = 48;
    let speed = 0;
    if (event.clientY < box.top + edge) speed = -8;
    else if (event.clientY > box.bottom - edge) speed = 8;
    if (speed) {
      scrollTimer = setInterval(() => {
        body!.scrollTop += speed;
        const cur = drag();
        if (cur) setDrag({ ...cur, y: cur.y - speed });
      }, 16);
    }
  };

  const endDrag = async () => {
    clearInterval(scrollTimer);
    const d = drag();
    setDrag(undefined);
    const id = props.player()?.id;
    if (!d || d.to === d.from || !id) return;

    // On screen first, so the drop lands where it was let go.
    setRows((list) => {
      const next = list.slice();
      const [moved] = next.splice(d.from, 1);
      next.splice(d.to, 0, moved!);
      return next;
    });

    const action: QueueAction = d.to < d.from ? "up" : "down";
    /* One place at a time, each step once the one before has landed. */
    const steps = Array.from({ length: Math.abs(d.to - d.from) }, (_, i) => i);
    try {
      await inOrder(steps, () => changeQueue(callService, id, d.id, action));
    } catch (err) {
      setStatus(errorMessage(err, "Could not move the track"));
    }
    setTimeout(() => void load(), 350);
  };

  const act = (row: QueueRow, action: QueueAction) => {
    const id = props.player()?.id;
    if (!id) return;
    setMenu(undefined);
    void changeQueue(callService, id, row.id, action)
      .then(() => setTimeout(() => void load(), 350))
      .catch((err: unknown) =>
        setStatus(errorMessage(err, "Could not change the queue")),
      );
  };

  return (
    <div class="mp-queue" data-sheet={!!props.inSheet}>
      <div class="mp-queue-head">
        <span class="mp-queue-title">
          Up next
          <Show when={total() !== undefined && total()! > rows().length}>
            <span class="mp-queue-count">{total()}</span>
          </Show>
        </span>

        <button class="mp-btn mp-btn--ghost mp-btn--sm" aria-label="Refresh" onClick={() => void load()}>
          <Icon icon="mdi:refresh" width="18" />
        </button>

        <Show when={supports(props.player(), FEATURE.CLEAR_PLAYLIST)}>
          <button class="mp-btn mp-btn--ghost mp-btn--sm" aria-label="Clear queue" onClick={clear}>
            <Icon icon="mdi:playlist-remove" width="18" />
          </button>
        </Show>

        <Show when={!props.inSheet}>
          <button class="mp-btn mp-btn--ghost mp-btn--sm" aria-label="Close" onClick={props.onClose}>
            <Icon icon="mdi:close" width="18" />
          </button>
        </Show>
      </div>

      <div class="mp-queue-body" ref={body}>
        <Show when={loading()}>
          <p class="mp-queue-note">Reading the queue…</p>
        </Show>

        <Show when={status()}>
          <p class="mp-queue-note">{status()}</p>
        </Show>

        <For each={rows()}>
          {(row, index) => (
            <div
              class="mp-queue-row"
              data-current={!!row.current}
              data-past={!!row.past}
              data-editable={editable()}
              data-dragging={drag()?.id === row.id}
              data-settling={!!drag() && drag()?.id !== row.id}
              style={{ transform: shiftOf(index()) ? `translateY(${shiftOf(index())}px)` : undefined }}
            >
              {/* The track itself — cover and words — is the button that plays
                  it; the grip and the options sit beside it, as their own. */}
              <button
                type="button"
                class="mp-queue-pick"
                data-menu={menu() === row.id}
                disabled={!playable(row)}
                onClick={() => !drag() && act(row, "play")}
              >
                <Show
                  when={artSrc(row.image)}
                  fallback={
                    <span class="mp-queue-art mp-art-placeholder">
                      <Icon icon="mdi:music" width="16" />
                    </span>
                  }
                >
                  <img
                    class="mp-queue-art"
                    src={artSrc(row.image)}
                    alt=""
                    decoding="async"
                    onError={(event) => {
                      noteImageFailure(row.image);
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                </Show>

                <Show when={menu() !== row.id}>
                  <span class="mp-queue-meta">
                    <span class="mp-truncate">{row.name}</span>
                    <Show when={row.subtitle}>
                      <span class="mp-queue-sub mp-truncate">{row.subtitle}</span>
                    </Show>
                  </span>
                </Show>
              </button>

              <Show when={menu() === row.id}>
                <div class="mp-queue-actions">
                  <button onClick={() => act(row, "play")}>
                    <Icon icon="mdi:play" width="15" />Play
                  </button>
                  <Show when={!row.past}>
                    <button onClick={() => act(row, "next")}>
                      <Icon icon="mdi:playlist-play" width="15" />Next
                    </button>
                  </Show>
                  <button data-danger="true" aria-label="Remove" onClick={() => act(row, "remove")}>
                    <Icon icon="mdi:delete-outline" width="16" />
                  </button>
                </div>
              </Show>

              <Show when={row.current}>
                <Icon icon="mdi:volume-high" width="16" style={{ opacity: 0.7, flex: "none" }} />
              </Show>

              {/* A grip to drag it by, on what is still to come. */}
              <Show when={editable() && !row.current && !row.past}>
                <span
                  class="mp-queue-grip"
                  aria-hidden="true"
                  onPointerDown={(event) => startDrag(event, row, index())}
                  onPointerMove={moveDrag}
                  onPointerUp={() => void endDrag()}
                  onPointerCancel={() => void endDrag()}
                >
                  <Icon icon="mdi:drag-vertical" width="18" />
                </span>
              </Show>

              {/* What can be done to a queued track, behind one button so the
                  list stays a list. */}
              <Show when={editable() && !row.current}>
                <button
                  class="mp-btn mp-btn--ghost mp-btn--sm mp-queue-more"
                  aria-label={`Options for ${row.name}`}
                  aria-expanded={menu() === row.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu(menu() === row.id ? undefined : row.id);
                  }}
                >
                  <Icon icon="mdi:dots-vertical" width="18" />
                </button>
              </Show>

            </div>
          )}
        </For>
      </div>
    </div>
  );
}
