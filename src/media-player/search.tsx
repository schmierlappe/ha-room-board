import { massCover } from "../artwork";
import { For, Show, createSignal } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { MEDIA_TYPES, asType, resolveArtwork, type MediaType } from "./cover";
import { MediaGrid, MediaList, type ActionId, type GridItem } from "./grid";
import { OPENABLE, openContainer, type Level } from "./navigate";
import { useRecents } from "./recents";
import { errorCode, errorMessage } from "../errors";

const ACTION_LABELS: Record<ActionId, string> = {
  play: "Play now",
  next: "Play next",
  add: "Add to queue",
  radio: "Start radio",
};

type Item = GridItem & { contentType?: string };

/**
 * media_player.search_media returns BrowseMedia items. HA keys response
 * payloads by entity id for entity-targeted services, so unwrap that first.
 * media_content_type is uniformly "music"; media_class carries the real type.
 */
function readResults(
  response: unknown,
  entityId: string,
  proxy?: string,
  haBase?: string,
): Item[] {
  if (!response || typeof response !== "object") return [];
  const root = response as Record<string, any>;
  const keyed = root[entityId] ?? Object.values(root).find((v: any) => v && Array.isArray(v.result));
  const payload = keyed ?? root;
  const list = payload?.result ?? payload?.results ?? payload?.children ?? payload?.items;
  if (!Array.isArray(list)) return [];

  return list.flatMap((raw): Item[] => {
    const r = raw as Record<string, any>;
    const id = r.media_content_id;
    const title = r.title ?? r.name;
    if (typeof id !== "string" || typeof title !== "string") return [];

    return [
      {
        id,
        name: title,
        subtitle: typeof r.media_class === "string" ? r.media_class : undefined,
        image:
          resolveArtwork(typeof r.thumbnail === "string" ? r.thumbnail : undefined, proxy, haBase) ??
          massCover(id),
        mediaType: asType(r.media_class ?? r.media_content_type),
        contentType: typeof r.media_content_type === "string" ? r.media_content_type : undefined,
        canOpen: OPENABLE.has(asType(r.media_class ?? r.media_content_type)),
      },
    ];
  });
}

const SECTIONS: { type: MediaType; label: string }[] = [
  { type: "track", label: "Tracks" },
  { type: "album", label: "Albums" },
  { type: "artist", label: "Artists" },
  { type: "playlist", label: "Playlists" },
  { type: "radio", label: "Radio" },
  { type: "podcast", label: "Podcasts" },
];

export function SearchPanel(props: {
  player: () => EntityView | undefined;
  artworkProxy: string;
  haBaseUrl: string;
  configEntryId: string;
}) {
  const { callService } = useService();
  const { recentsFor, pushRecent } = useRecents();

  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<MediaType | "all">("all");
  const [hits, setHits] = createSignal<Item[] | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [status, setStatus] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [maDenied, setMaDenied] = createSignal(false);
  const [trail, setTrail] = createSignal<Level[]>([]);

  const current = () => trail().at(-1);

  const recents = (): Item[] =>
    recentsFor(props.player()?.id ?? "").map((r) => ({
      id: r.mediaId,
      name: r.name,
      subtitle: r.subtitle,
      image: r.image,
      mediaType: r.mediaType,
    }));

  const isDenied = (err: unknown) =>
    /CAPABILITY_DENIED|not covered by/i.test(`${errorCode(err)} ${errorMessage(err, "")}`);

  const sections = () => {
    const all = hits() ?? [];
    const visible = filter() === "all" ? all : all.filter((i) => i.mediaType === filter());
    return SECTIONS.map((s) => ({
      label: s.label,
      items: visible.filter((i) => i.mediaType === s.type),
    })).filter((s) => s.items.length);
  };

  /** media_player.search_media lives in the domain the widget already holds. */
  const search = async () => {
    const q = query().trim();
    const target = props.player()?.id;
    if (!q || !target) return;

    setSearching(true);
    setStatus(null);
    try {
      const response = await callService(
        "media_player",
        "search_media",
        { search_query: q },
        { entity_id: target },
        { returnResponse: true },
      );

      const items = readResults(response, target, props.artworkProxy, props.haBaseUrl);
      setHits(items);
      setTrail([]);

      if (!items.length) {
        setStatus({
          text: response
            ? `Nothing found for "${q}"`
            : "Search returned no response — the host may be older than Dash 1.1.0-beta.5.",
          error: !response,
        });
      }
    } catch (err) {
      setHits(null);
      setStatus({ text: errorMessage(err, "Search failed"), error: true });
    } finally {
      setSearching(false);
    }
  };

  /** Same drill-down as the Browse tab: artist to albums, album to tracks. */
  const open = async (item: GridItem) => {
    setSearching(true);
    setStatus(null);
    try {
      const items = await openContainer(callService, item, props.configEntryId, props.artworkProxy);
      if (!items.length) {
        setStatus({ text: `Nothing found inside "${item.name}"`, error: true });
        return;
      }
      setTrail((t) => [...t, { title: item.name, items, parent: item }]);
    } catch (err) {
      let text = errorMessage(err, "Could not open this item");
      if (isDenied(err)) text = "Opening an item needs the Music Assistant grant, which this widget isn't allowed.";
      setStatus({ text, error: true });
    } finally {
      setSearching(false);
    }
  };

  const enqueueFor = (action: ActionId) => (action === "radio" ? "replace" : action);

  const run = async (item: GridItem, action: ActionId) => {
    const target = props.player()?.id;
    if (!target) return;
    const full = item as Item;

    setStatus(null);
    try {
      if (action === "radio") {
        // radio_mode only exists on the Music Assistant service.
        await callService(
          "music_assistant",
          "play_media",
          { media_id: item.id, enqueue: "replace", radio_mode: true },
          { entity_id: target },
        );
      } else {
        await callService(
          "media_player",
          "play_media",
          {
            media_content_id: item.id,
            media_content_type: full.contentType ?? item.mediaType,
            enqueue: enqueueFor(action),
          },
          { entity_id: target },
        );
      }

      pushRecent(target, {
        name: item.name,
        subtitle: item.subtitle,
        image: item.image,
        mediaType: item.mediaType,
        mediaId: item.id,
      });
      setStatus({ text: `${ACTION_LABELS[action]}: ${item.name}` });
    } catch (err) {
      if (isDenied(err)) {
        setMaDenied(true);
        setStatus({
          text: "Radio needs the Music Assistant grant, which this widget isn't allowed.",
          error: true,
        });
      } else {
        setStatus({
          text: errorMessage(err, "Playback request failed"),
          error: true,
        });
      }
    }
  };

  return (
    <div class="mp-panel">
      {/* The field, the filters and where you are, pinned to the top while
          the results scroll under them. */}
      <div class="mp-sticky-head">
        <div class="mp-search-row">
          <div class="mp-input-wrap">
            <Icon icon="mdi:magnify" width="17" />
            <input
              class="mp-input"
              type="search"
              placeholder="Search artists, albums, tracks…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              /* The sheet resizes around the keyboard, and the field can end up
                 above the fold of the new, shorter panel. Scrolling after the
                 resize settles keeps what you are typing in view. */
              onFocus={(e) => {
                const field = e.currentTarget;
                setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
              }}
            />
          </div>
          <button class="mp-go" disabled={!query().trim() || searching()} onClick={search}>
            {searching() ? "…" : "Search"}
          </button>
        </div>

        <div class="mp-chips">
          <button class="mp-chip" data-active={filter() === "all"} onClick={() => setFilter("all")}>
            all
          </button>
          <For each={MEDIA_TYPES}>
            {(t) => (
              <button class="mp-chip" data-active={filter() === t} onClick={() => setFilter(t)}>
                {t}
              </button>
            )}
          </For>
        </div>
        <Show when={trail().length}>
          <div class="mp-crumb">
            <button
              class="mp-btn mp-btn--ghost mp-btn--sm"
              onClick={() => setTrail((t) => t.slice(0, -1))}
            >
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
      </div>

      <Show when={trail().length}>

        <Show
          when={current()!.items.every((i) => i.mediaType === "track")}
          fallback={
            <MediaGrid
              items={current()!.items}
              onAction={run}
              onOpen={open}
              radioDisabled={maDenied()}
            />
          }
        >
          <MediaList
            items={current()!.items}
            onAction={run}
            onOpen={open}
            radioDisabled={maDenied()}
          />
        </Show>
      </Show>

      <Show when={hits() && !trail().length}>
        <For each={sections()}>
          {(section) => (
            <div>
              <div class="mp-label">{section.label}</div>
              <MediaGrid
                items={section.items}
                onAction={run}
                onOpen={open}
                radioDisabled={maDenied()}
              />
            </div>
          )}
        </For>
        <button
          class="mp-recent"
          onClick={() => {
            setHits(null);
            setStatus(null);
          }}
        >
          <Icon icon="mdi:arrow-left" width="15" style={{ opacity: 0.45 }} />
          <span>Back</span>
        </button>
      </Show>

      <Show when={!hits() && !trail().length && recents().length}>
        <div>
          <div class="mp-label">Recently played</div>
          <MediaGrid items={recents()} onAction={run} radioDisabled={maDenied()} />
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
