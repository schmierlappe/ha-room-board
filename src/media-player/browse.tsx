import { For, Show, createSignal, onMount } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { type MediaType } from "./cover";
import { MediaGrid, MediaList, type ActionId, type GridItem } from "./grid";
import { openContainer, toItem, type Level } from "./navigate";
import { useRecents } from "./recents";
import { errorMessage } from "../errors";

const CATEGORIES: { type: MediaType; label: string }[] = [
  { type: "artist", label: "Artists" },
  { type: "album", label: "Albums" },
  { type: "track", label: "Tracks" },
  { type: "playlist", label: "Playlists" },
  { type: "radio", label: "Radio" },
  { type: "podcast", label: "Podcasts" },
];

const PAGE = 24;

/** get_library returns { items: [...] }; search returns typed buckets. */
function readLibrary(response: unknown, proxy?: string, haBase?: string): GridItem[] {
  if (!response || typeof response !== "object") return [];
  const root = response as Record<string, any>;
  const list = Array.isArray(root.items)
    ? root.items
    : Object.values(root).flatMap((v: any) => (Array.isArray(v?.items) ? v.items : []));
  return (Array.isArray(list) ? list : []).map((r) => toItem(r, proxy, haBase)).filter(Boolean) as GridItem[];
}

export function BrowsePanel(props: {
  player: () => EntityView | undefined;
  configEntryId: string;
  artworkProxy: string;
  haBaseUrl: string;
}) {
  const { callService } = useService();
  const { pushRecent } = useRecents();

  const [category, setCategory] = createSignal<MediaType>("artist");
  const [root, setRoot] = createSignal<GridItem[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [trail, setTrail] = createSignal<Level[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [status, setStatus] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [maDenied, setMaDenied] = createSignal(false);

  const current = () => trail().at(-1);

  const fail = (err: unknown) => {
    const message = errorMessage(err);
    const denied = /CAPABILITY_DENIED|not covered by/i.test(message);
    if (denied) setMaDenied(true);
    setStatus({
      text: denied
        ? "Browsing needs the Music Assistant grant, which this widget isn't allowed."
        : message,
      error: true,
    });
  };

  const loadLibrary = async (type: MediaType, from = 0) => {
    setLoading(true);
    setStatus(null);
    try {
      const response = await callService(
        "music_assistant",
        "get_library",
        {
          ...(props.configEntryId ? { config_entry_id: props.configEntryId } : {}),
          media_type: type,
          limit: PAGE,
          offset: from,
          order_by: "name",
        },
        // No target: get_library is a domain-wide service, and passing a
        // media_player entity makes the host check that entity's domain
        // against the music_assistant grant, which never matches.
        undefined,
        { returnResponse: true },
      );

      const batch = readLibrary(response, props.artworkProxy, props.haBaseUrl);
      setRoot((prev) => (from === 0 ? batch : [...prev, ...batch]));
      setOffset(from + batch.length);
      if (!batch.length && from === 0) {
        setStatus({
          text: response ? "Nothing in this part of the library." : "No response from the host.",
          error: !response,
        });
      }
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  /** Drill into an artist or album. See navigate.ts for why it works this way. */
  const open = async (item: GridItem) => {
    setLoading(true);
    setStatus(null);
    try {
      const items = await openContainer(callService, item, props.configEntryId, props.artworkProxy, props.haBaseUrl);

      if (!items.length) {
        setStatus({ text: `Nothing found inside "${item.name}"`, error: true });
        return;
      }
      setTrail((t) => [...t, { title: item.name, items, parent: item }]);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void loadLibrary(category(), 0);
  });

  const pickCategory = (type: MediaType) => {
    setCategory(type);
    setRoot([]);
    setTrail([]);
    void loadLibrary(type, 0);
  };

  const run = async (item: GridItem, action: ActionId) => {
    const target = props.player()?.id;
    if (!target) return;
    setStatus(null);
    try {
      await callService(
        "music_assistant",
        "play_media",
        {
          media_id: item.id,
          enqueue: action === "radio" ? "replace" : action,
          radio_mode: action === "radio",
        },
        { entity_id: target },
      );
      pushRecent(target, {
        name: item.name,
        subtitle: item.subtitle,
        image: item.image,
        mediaType: item.mediaType,
        mediaId: item.id,
      });
      setStatus({ text: `${item.name} — ${action === "radio" ? "radio started" : action}` });
    } catch (err) {
      fail(err);
    }
  };

  const visible = () => current()?.items ?? root();

  return (
    <div class="mp-panel">
      <Show
        when={trail().length}
        fallback={
          <div class="mp-chips">
            <For each={CATEGORIES}>
              {(c) => (
                <button
                  class="mp-chip"
                  data-active={category() === c.type}
                  onClick={() => pickCategory(c.type)}
                >
                  {c.label}
                </button>
              )}
            </For>
          </div>
        }
      >
        <div class="mp-crumb">
          <button class="mp-btn mp-btn--ghost mp-btn--sm" onClick={() => setTrail((t) => t.slice(0, -1))}>
            <Icon icon="mdi:arrow-left" width="18" />
          </button>
          <div class="mp-flex1">
            <div class="mp-label">{current()!.parent?.mediaType ?? "Browsing"}</div>
            <div class="mp-crumb-title mp-truncate">{current()!.title}</div>
          </div>
          <Show when={current()!.parent}>
            <button class="mp-pill" onClick={() => run(current()!.parent!, "play")}>
              Play all
            </button>
          </Show>
        </div>
      </Show>

      <Show when={visible().length}>
        <Show
          when={visible().every((i) => i.mediaType === "track")}
          fallback={
            <MediaGrid items={visible()} onAction={run} onOpen={open} radioDisabled={maDenied()} />
          }
        >
          <MediaList items={visible()} onAction={run} onOpen={open} radioDisabled={maDenied()} />
        </Show>

        <Show when={!trail().length && root().length >= PAGE}>
          <button
            class="mp-action"
            disabled={loading()}
            onClick={() => loadLibrary(category(), offset())}
          >
            <Icon icon="mdi:chevron-down" width="17" />
            {loading() ? "Loading…" : "Load more"}
          </button>
        </Show>
      </Show>

      <Show when={!visible().length && !status()}>
        <div class="mp-empty">
          {loading() ? "Loading…" : "Pick a category to browse your Music Assistant library."}
        </div>
      </Show>

      <Show when={status()}>
        <div class="mp-status" data-error={!!status()!.error}>
          <Icon
            icon={status()!.error ? "mdi:alert-circle-outline" : "mdi:check-circle-outline"}
            width="16"
          />
          <span>{status()!.text}</span>
        </div>
      </Show>
    </div>
  );
}
