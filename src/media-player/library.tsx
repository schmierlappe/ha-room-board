import { artSrc, massCover } from "../artwork";
import { For, Show, createEffect, createMemo, createSignal, on, untrack } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { markArtShape, noteImageFailure, resolveArtwork } from "./cover";
import { FEATURE, supports } from "./features";
import { errorMessage } from "../errors";

/**
 * A player's own media library, through Home Assistant's media browser.
 *
 * Built for Plex, whose integration publishes its libraries — Movies, TV
 * Shows, Music, playlists — as the same tree Home Assistant's own media panel
 * shows. media_player.browse_media hands that tree over one level at a time,
 * and every item in it carries the id and type media_player.play_media takes,
 * so browsing and playing need nothing but the media_player grant both
 * widgets already hold: no Plex token, no server address, no proxy.
 *
 * Search is the player's own where it has one (search_media), and a filter of
 * the level on screen everywhere — Plex answers the first on some versions and
 * not others, and a filter of a library already loaded is instant either way.
 */

type LibraryItem = {
  title: string;
  id: string;
  type: string;
  mediaClass: string;
  canPlay: boolean;
  canExpand: boolean;
  thumb?: string;
  /** The address the player gave, before the proxy — named when it fails. */
  rawThumb?: string;
  children: LibraryItem[];
};

const CLASS_ICON: Record<string, string> = {
  movie: "mdi:movie-open-outline",
  tv_show: "mdi:television-classic",
  season: "mdi:folder-play-outline",
  episode: "mdi:television-play",
  video: "mdi:filmstrip",
  directory: "mdi:folder-outline",
  artist: "mdi:account-music",
  album: "mdi:album",
  track: "mdi:music-note",
  music: "mdi:music",
  playlist: "mdi:playlist-play",
  channel: "mdi:television",
  genre: "mdi:tag-outline",
  image: "mdi:image-outline",
};

/**
 * Sources Home Assistant lists at the top of a player's browser, by what they
 * are. Their pictures are Home Assistant's brand images, served from a host
 * the dashboard's image proxy does not carry — so they fail, and a tile with
 * its picture failed was an empty grey square that read as switched off.
 * These are drawn as their own mark instead, in their own colour.
 */
const SOURCES: [RegExp, string, string][] = [
  [/plex/i, "mdi:plex", "#e5a00d"],
  [/radio.?browser|radio/i, "mdi:radio", "#22c55e"],
  [/text.?to.?speech|tts/i, "mdi:account-voice", "#a855f7"],
  [/media.?source|my media|local media|media/i, "mdi:folder-play-outline", "#3b82f6"],
];

const sourceMark = (item: { title: string; id: string }) =>
  SOURCES.find(([pattern]) => pattern.test(`${item.title} ${item.id}`));

/** Is this a Plex client? The integration's own attributes say so while it plays; the id says so always. */
export function isPlex(player: EntityView | undefined): boolean {
  if (!player) return false;
  const attrs = player.attributes ?? {};
  return (
    /plex/i.test(player.id) ||
    "player_source" in attrs ||
    "session_username" in attrs ||
    "media_library_title" in attrs
  );
}

function readItem(raw: any, proxy: string, haBase: string): LibraryItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const title = typeof raw.title === "string" ? raw.title : "";
  const id = typeof raw.media_content_id === "string" ? raw.media_content_id : "";
  if (!title && !id) return undefined;
  const thumb =
    (typeof raw.thumbnail === "string" && raw.thumbnail
      ? resolveArtwork(raw.thumbnail, proxy, haBase)
      : undefined) ?? (/^[a-z0-9_-]+:\/\//i.test(id) ? massCover(id) : undefined);
  return {
    title: title || "Untitled",
    id,
    type: typeof raw.media_content_type === "string" ? raw.media_content_type : "",
    mediaClass: typeof raw.media_class === "string" ? raw.media_class : "directory",
    canPlay: raw.can_play === true,
    canExpand: raw.can_expand === true,
    thumb: thumb || undefined,
    rawThumb: typeof raw.thumbnail === "string" && raw.thumbnail ? raw.thumbnail : undefined,
    children: Array.isArray(raw.children)
      ? (raw.children.map((child: unknown) => readItem(child, proxy, haBase)).filter(Boolean) as LibraryItem[])
      : [],
  };
}

/** A response is keyed by entity id; the tree is under it, or is it. */
function unwrap(response: unknown, entityId: string): any {
  const root = (response ?? {}) as Record<string, any>;
  return root[entityId] ?? root;
}

export function LibraryPanel(props: {
  player: () => EntityView | undefined;
  artworkProxy: string;
  haBaseUrl: string;
  /** Open in the player's Favorites folder rather than at the top — the
   *  Favourites tab. Back still climbs to the rest of the library. */
  startInFavourites?: boolean;
  /** Called when the player's browser has no Favorites folder to open. */
  onNoFavourites?: () => void;
  /** Called once something has been started, so the popup can go to Now. */
  onPlayed?: () => void;
}) {
  const { callService } = useService();

  /* The levels opened so far; the last is on screen. */
  const [trail, setTrail] = createSignal<LibraryItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [query, setQuery] = createSignal("");
  /* Results of a search of the whole library, when one has been run. */
  const [found, setFound] = createSignal<LibraryItem[] | undefined>();
  const [pending, setPending] = createSignal("");

  const current = () => trail().at(-1);

  /* Why there is nothing to show, in the order it is worth saying. */
  const emptyNote = () => {
    if (!ready()) return "Open Plex on this device to browse its library.";
    if (loading()) return "Loading…";
    if (found()) return "Nothing in the library by that name.";
    if (!query().trim()) return "This folder is empty.";
    return canSearch()
      ? "Nothing here by that name — press Enter to search the whole library."
      : "Nothing here by that name.";
  };
  const canSearch = () => supports(props.player(), FEATURE.SEARCH_MEDIA);

  const fail = (err: unknown) =>
    setError(errorMessage(err));

  const browse = async (item?: LibraryItem) => {
    const entityId = props.player()?.id;
    if (!entityId || !ready()) return;
    console.info("[media-player] library: browse", entityId, item?.title ?? "(top)");
    setLoading(true);
    setError("");
    try {
      const response = await callService(
        "media_player",
        "browse_media",
        item ? { media_content_id: item.id, media_content_type: item.type } : {},
        { entity_id: entityId },
        { returnResponse: true },
      );
      const level = readItem(unwrap(response, entityId), props.artworkProxy, props.haBaseUrl);
      if (!level) throw new Error("The player returned nothing to browse.");
      setQuery("");
      setFound(undefined);
      setTrail((was) => (item ? [...was, level] : [level]));
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  const searchAll = async () => {
    const entityId = props.player()?.id;
    const term = query().trim();
    if (!entityId || !term || !canSearch() || !ready()) return;
    setLoading(true);
    setError("");
    try {
      const response = await callService(
        "media_player",
        "search_media",
        { search_query: term },
        { entity_id: entityId },
        { returnResponse: true },
      );
      const payload = unwrap(response, entityId);
      const list = payload?.result ?? payload?.results ?? payload?.items ?? [];
      setFound(
        (Array.isArray(list) ? list : [])
          .map((raw: unknown) => readItem(raw, props.artworkProxy, props.haBaseUrl))
          .filter(Boolean) as LibraryItem[],
      );
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  const play = async (item: LibraryItem) => {
    const entityId = props.player()?.id;
    if (!entityId || !item.canPlay || !ready()) return;
    setPending(item.id);
    setError("");
    try {
      await callService(
        "media_player",
        "play_media",
        { media_content_id: item.id, media_content_type: item.type },
        { entity_id: entityId },
      );
      props.onPlayed?.();
    } catch (err) {
      fail(err);
    } finally {
      setPending("");
    }
  };

  /* A folder opens; anything else plays. A season or an album can do both,
     and gets a play button of its own on the tile. */
  const tap = (item: LibraryItem) => (item.canExpand ? browse(item) : play(item));

  /* Only once the player is there to ask: an unavailable Plex client — the
     app closed on the TV — refuses browse_media, and the dashboard shows the
     refusal as an error. The library loads the moment it comes back. */
  const ready = () => {
    const state = props.player()?.state ?? "";
    return !!state && !["unavailable", "unknown"].includes(state);
  };

  /**
   * The Favorites folder, opened with the top level under it.
   *
   * Both levels are fetched before either is shown: setting the top first
   * flashed the whole library for a moment before the favourites replaced it.
   */
  const openFavourites = async () => {
    const entityId = props.player()?.id;
    if (!entityId || !ready()) return;
    console.info("[media-player] library: open favourites", entityId);
    setLoading(true);
    setError("");
    try {
      const ask = async (item?: LibraryItem) =>
        readItem(
          unwrap(
            await callService(
              "media_player",
              "browse_media",
              item ? { media_content_id: item.id, media_content_type: item.type } : {},
              { entity_id: entityId },
              { returnResponse: true },
            ),
            entityId,
          ),
          props.artworkProxy,
          props.haBaseUrl,
        );

      const top = await ask();
      if (!top) throw new Error("The player returned nothing to browse.");
      const folder = top.children.find(
        (child) => child.type === "favorites" || /^favou?rites$/i.test(child.title),
      );
      if (!folder) {
        props.onNoFavourites?.();
        setTrail([top]);
        return;
      }
      const favourites = await ask(folder);
      setTrail(favourites ? [top, favourites] : [top]);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  /* Another player picked while the tab is open: its library, not the last
     one's.
   *
   * Kept per player rather than thrown away. The id can flicker for an
   * update — a speaker dropping out of the room's list for a moment while it
   * regroups, or none at all — and clearing on every change sent the tab back
   * to its folder and fetched it again each time, which was the flicker. A
   * missing id is ignored, and a player come back finds its place as it left
   * it, without asking again. */
  const places = new Map<string, LibraryItem[]>();
  let shownFor = untrack(() => props.player()?.id);
  console.info("[media-player] library: panel created for", shownFor);

  createEffect(
    on(
      () => props.player()?.id,
      (id) => {
        if (!id || id === shownFor) return;
        if (shownFor) places.set(shownFor, trail());
        console.info("[media-player] library: player changed", shownFor, "→", id);
        shownFor = id;
        setFound(undefined);
        setQuery("");
        setError("");
        setTrail(places.get(id) ?? []);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    if (!ready() || trail().length || loading() || error()) return;
    void (props.startInFavourites ? openFavourites() : browse());
  });

  const items = createMemo(() => {
    const results = found();
    if (results) return results;
    const list = current()?.children ?? [];
    const term = query().trim().toLowerCase();
    return term ? list.filter((item) => item.title.toLowerCase().includes(term)) : list;
  });

  return (
    <div class="mp-panel mp-library">
      <div class="mp-search-row">
        <div class="mp-input-wrap">
          <Icon icon="mdi:magnify" width="17" />
          <input
            class="mp-input"
            type="search"
            placeholder={canSearch() ? "Filter, or search the whole library" : "Filter this list"}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setFound(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void searchAll();
            }}
          />
        </div>
        <Show when={canSearch() && query().trim()}>
          <button class="mp-pill" disabled={loading()} onClick={() => void searchAll()}>
            Search all
          </button>
        </Show>
      </div>

      <Show when={trail().length > 1 || found()}>
        <div class="mp-crumb">
          <button
            class="mp-btn mp-btn--ghost mp-btn--sm"
            aria-label="Back"
            onClick={() => {
              if (found()) {
                setFound(undefined);
                return;
              }
              setQuery("");
              setTrail((was) => was.slice(0, -1));
            }}
          >
            <Icon icon="mdi:arrow-left" width="18" />
          </button>
          <div class="mp-flex1">
            <div class="mp-label">{found() ? "Search" : current()?.mediaClass.replaceAll("_", " ")}</div>
            <div class="mp-crumb-title mp-truncate">
              {found() ? `“${query().trim()}”` : current()?.title}
            </div>
          </div>
          <Show when={!found() && current()?.canPlay}>
            <button class="mp-pill" onClick={() => void play(current()!)}>
              Play
            </button>
          </Show>
        </div>
      </Show>

      <Show when={items().length}>
        <div class="mp-lib-grid">
          <For each={items()}>
            {(item) => (
              <div class="mp-lib-tile">
                <button
                  class="mp-lib-item mp-lib-entry"
                  data-pending={pending() === item.id}
                  onClick={() => void tap(item)}
                  title={item.title}
                >
                  <span class="mp-lib-cover">
                    <LibraryCover item={item} top={trail().length === 1 && !found()} />
                  </span>
                  <span class="mp-lib-name mp-truncate">{item.title}</span>
                </button>

                {/* Open and play are two things for a season or an album: a
                    button of its own over the cover's corner — a button
                    cannot hold another. */}
                <Show when={item.canExpand && item.canPlay}>
                  <span class="mp-lib-play-box">
                    <button type="button" class="mp-lib-play" aria-label={`Play ${item.title}`} onClick={() => void play(item)}>
                      <Icon icon="mdi:play" width="16" />
                    </button>
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={!items().length && !error()}>
        <div class="mp-empty">
          {emptyNote()}
        </div>
      </Show>

      <Show when={error()}>
        <div class="mp-status" data-error="true">
          <Icon icon="mdi:alert-circle-outline" width="16" />
          <span>{error()}</span>
        </div>
      </Show>
    </div>
  );
}

/**
 * A tile's picture: the item's own where it loads, and a mark in its place
 * where it does not — the source's own (Plex in Plex orange) for the entries
 * at the top of the browser, the kind of thing it is for the rest. A failed
 * picture used to leave the tile empty and grey.
 */
function LibraryCover(props: { item: LibraryItem; top: boolean }) {
  const [failed, setFailed] = createSignal(false);
  /* Only at the top: everything inside Plex has "plex" in its id too, and
     wants its own poster. */
  const mark = () => (props.top ? sourceMark(props.item) : undefined);

  /* A Sonos favourite filed as a "genre" is a radio station — the speaker
     calls a broadcast that — so it gets a radio, not a price tag. */
  const icon = () =>
    mark()?.[1] ??
    (props.item.mediaClass === "genre" && /favorite/i.test(props.item.type)
      ? "mdi:radio"
      : CLASS_ICON[props.item.mediaClass] ?? "mdi:folder-outline");

  /* Why there is no picture, on hover: the host that refused it — which is
     the one to add to the image proxy's list — or that none was sent. */
  const why = () => {
    if (mark()) return undefined;
    if (!props.item.rawThumb) return "No picture from the player";
    if (/X-Amz-Expires=/i.test(props.item.rawThumb) && !props.item.thumb)
      return "The player's picture link has expired — re-save the favourite to refresh it";
    try {
      return `Picture blocked: ${new URL(props.item.rawThumb).host}`;
    } catch {
      return `Picture failed: ${props.item.rawThumb}`;
    }
  };

  return (
    <Show
      when={artSrc(props.item.thumb) && !failed() && !mark()}
      fallback={
        <span
          class="mp-lib-fallback mp-lib-mark"
          style={mark() ? { "--mp-mark": mark()![2] } : undefined}
          data-source={!!mark()}
          title={why()}
        >
          <Icon icon={icon()} width="30" />
        </span>
      }
    >
      <img
        src={artSrc(props.item.thumb)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={(event) => markArtShape(event.currentTarget)}
        onError={() => {
          noteImageFailure(props.item.thumb);
          setFailed(true);
        }}
      />
    </Show>
  );
}
