import { FEATURE, supports } from "./features";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { Cover, resolveArtwork } from "./cover";
import { attr } from "./util";
import { inOrder } from "../async";
import { brandStyle } from "./brand";
import { channelBrand } from "./channels";
import { picon } from "./picons";
import { errorMessage } from "../errors";

/**
 * A speaker's own favourites, for the players Music Assistant is not driving.
 *
 * Sonos publishes its favourites as the entity's `source_list` and plays one
 * with `select_source` — so a Sonos on its own needs no library, no search and
 * no recommendations, it needs the list its own app shows. Discover, Browse
 * and Search all talk to Music Assistant, so they are offered only where it is
 * running and this tab takes their place everywhere else.
 *
 * The grid is the library's, minus the action menu: there is exactly one thing
 * to do with a favourite, and a menu offering "add to queue" for a source the
 * speaker will simply switch to would be promising something it cannot do.
 */

/** Inputs rather than favourites: last in the list, and their own icon. */
const INPUT = /^(tv|line[- ]?in|hdmi|aux|bluetooth|airplay)\b/i;

const iconFor = (name: string) => {
  if (/^tv\b/i.test(name)) return "mdi:television";
  if (/line[- ]?in|aux|hdmi/i.test(name)) return "mdi:audio-input-rca";
  if (/bluetooth|airplay/i.test(name)) return "mdi:bluetooth";
  if (/radio|fm\b|\d{2,3}[.,]\d/i.test(name)) return "mdi:radio-tower";
  return "mdi:heart";
};

/**
 * Covers found for favourites, kept for the session.
 *
 * A favourite arrives as a bare string — a name, and nothing else. There is no
 * thumbnail on it, which is why the tiles start as generated covers. The one
 * route to a real one that this widget already holds a grant for is
 * media_player.search_media, and Sonos answers that from its own favourites
 * and library, so a favourite usually finds itself by name.
 *
 * Cached across openings and keyed by player: the answer does not change
 * while the tab is closed, and the lookups are the expensive part.
 */
const covers = new Map<string, string>();

const coverKey = (playerId: string, name: string) => `${playerId}::${name}`;

/* Players whose Favorites folder has been read this session. */
const browsed = new Set<string>();

/** True until the effect it is called in is cleaned up: whether its work is still wanted. */
function untilCleanup(): () => boolean {
  let live = true;
  onCleanup(() => {
    live = false;
  });
  return () => live;
}

/** The browser's Favourites folder, by its type or its name. */
const isFavouritesFolder = (child: any) =>
  child?.media_content_type === "favorites" || /^favou?rites$/i.test(String(child?.title ?? ""));

/** What browse_media needs to open an entry. */
const contentOf = (entry: any) => ({
  id: String(entry?.media_content_id ?? ""),
  type: String(entry?.media_content_type ?? ""),
});

/**
 * Everything playable in the Favourites folder. Favourites come back either
 * as items or sorted into folders by kind ("Radio stations", "Playlists") —
 * one level down is as deep as it goes. Nothing when the walk is called off.
 */
async function walkFavourites(
  folder: any,
  open: (entry: any) => Promise<{ children?: any[] }>,
  live: () => boolean,
): Promise<any[] | undefined> {
  /* The folder, then the folders inside it at once; deeper ones are left. */
  if (!live()) return undefined;
  const top = (await open(folder)).children ?? [];
  const inner = top.filter(isFolder);
  const items = top.filter((child) => !isFolder(child));
  if (!inner.length) return items;
  if (!live()) return undefined;
  const opened = await Promise.all(inner.map(open));
  /* Their contents in the folders' order. */
  return [...items, ...opened.flatMap((answer) => (answer.children ?? []).filter((child) => !isFolder(child)))];
}

/** The list in a search_media answer, wherever the player put it. */
function searchResults(response: unknown, id: string): any[] {
  const root = (response ?? {}) as Record<string, any>;
  const payload = root[id] ?? Object.values(root).find((v: any) => v && Array.isArray(v.result)) ?? root;
  const list = payload?.result ?? payload?.results ?? payload?.items;
  return Array.isArray(list) ? list : [];
}

/**
 * The picture for a favourite among search results: the favourite itself
 * where the name comes back exactly, and failing that whatever the speaker
 * thought was the best match — a station answering with its own logo is
 * worth more than a grey square.
 */
function bestThumbnail(list: any[], name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  const exact = list.find((item) => typeof item?.title === "string" && item.title.trim().toLowerCase() === wanted);
  const hit = exact ?? list.find((item) => typeof item?.thumbnail === "string");
  return typeof hit?.thumbnail === "string" ? hit.thumbnail : undefined;
}

/** A folder to open rather than something to play. */
const isFolder = (child: any) => !!child?.can_expand && !child?.can_play;

/** Each item's picture, by its name in lower case. */
function picturesByName(items: any[], resolve: (thumbnail: string) => string | undefined): Map<string, string> {
  const byName = new Map<string, string>();
  for (const item of items) {
    if (typeof item?.title !== "string" || typeof item?.thumbnail !== "string") continue;
    const image = resolve(item.thumbnail);
    if (image) byName.set(item.title.trim().toLowerCase(), image);
  }
  return byName;
}

export function FavouritesPanel(props: {
  player: () => EntityView | undefined;
  /** The same setting Discover uses: one call per cover, so it is optional. */
  lookupArtwork: boolean;
  artworkProxy: string;
  haBaseUrl: string;
  /** Called once a favourite has been started, so the popup can go to Now. */
  onPlayed?: () => void;
}) {
  const { callService } = useService();

  const [query, setQuery] = createSignal("");
  const [pending, setPending] = createSignal("");
  const [error, setError] = createSignal("");
  /* Bumped when a lookup lands, so the tiles re-read the cache. */
  const [found, setFound] = createSignal(0);

  const sources = () => attr<string[]>(props.player(), "source_list", []);
  const current = () => attr<string>(props.player(), "source", "");

  const coverFor = (name: string) => {
    found();
    const id = props.player()?.id;
    return id ? covers.get(coverKey(id, name)) : undefined;
  };

  /**
   * One call per favourite, run one at a time.
   *
   * Firing twenty searches at a speaker at once is the burst that made
   * Discover's artwork lookups come back 503. A favourite whose search finds
   * nothing is recorded as empty, so it is asked about once and not again.
   */
  /**
   * The covers the speaker already has: its own Favorites folder.
   *
   * Sonos lists every favourite in its media browser with the artwork its
   * app shows — the station's logo, the playlist's mosaic — under the same
   * name the source list uses. One walk of that folder (and the folders it
   * sorts them into) covers the whole tab in two or three calls, where a
   * search per name took twenty and still missed. Searching stays as the
   * fallback for whatever the folder does not have.
   */
  const browse = async (id: string, content?: { id: string; type: string }) => {
    const response = await callService(
      "media_player",
      "browse_media",
      content ? { media_content_id: content.id, media_content_type: content.type } : {},
      { entity_id: id },
      { returnResponse: true },
    );
    const root = (response ?? {}) as Record<string, any>;
    return (root[id] ?? root) as { children?: any[] };
  };

  /* The player's own favourites, with their pictures: its Favourites
     folder walked (walkFavourites), the pictures matched to the sources by
     name. */
  const fromBrowser = async (id: string, live: () => boolean) => {
    const top = await browse(id);
    const folder = (top.children ?? []).find(isFavouritesFolder);
    if (!folder || !live()) return;

    const items = await walkFavourites(folder, (entry) => browse(id, contentOf(entry)), live);
    if (!items) return;

    const byName = picturesByName(items, (thumb) => resolveArtwork(thumb, props.artworkProxy, props.haBaseUrl));
    let added = false;
    for (const name of sources()) {
      const image = byName.get(name.trim().toLowerCase());
      if (!image) continue;
      covers.set(coverKey(id, name), image);
      added = true;
    }
    if (added && live()) setFound((n) => n + 1);
  };

  /* Which player to walk, and only that: the effect below must not re-run
     on every position tick, or each run would cancel the walk before it. */
  const browseTarget = createMemo(() => {
    if (!props.lookupArtwork || !supports(props.player(), FEATURE.BROWSE_MEDIA)) return "";
    return sources().length ? (props.player()?.id ?? "") : "";
  });

  createEffect(() => {
    const id = browseTarget();
    if (!id || browsed.has(id)) return;
    browsed.add(id);

    const live = untilCleanup();
    void fromBrowser(id, live).catch(() => {
      /* A player whose browser refuses keeps the search fallback. */
    });
  });

  createEffect(() => {
    if (!props.lookupArtwork) return;
    /* Only a player that says it can search is asked to. The failure was
       caught here, but the dashboard reports a refused call by itself, so a
       player without search — a "Currently Playing" aggregate, a TV — put
       an error over the Favourites tab on every opening. Home Assistant
       names the feature on the entity; without it there is no search. */
    if (!supports(props.player(), FEATURE.SEARCH_MEDIA)) return;
    const id = props.player()?.id;
    const names = sources();
    if (!id || !names.length) return;

    const live = untilCleanup();

    /* One search after another, so the speaker is not asked for them all at
       once; once the tab is closed the rest are skipped. */
    void inOrder(names, async (name) => {
      if (!live()) return;
      const key = coverKey(id, name);
      if (covers.has(key)) return;
      covers.set(key, "");

      try {
        const response = await callService(
          "media_player",
          "search_media",
          { search_query: name },
          { entity_id: id },
          { returnResponse: true },
        );

        const image = resolveArtwork(
          bestThumbnail(searchResults(response, id), name),
          props.artworkProxy,
          props.haBaseUrl,
        );

        /* Only into an empty slot: the speaker's own folder may have
           landed the real cover while this search was out. */
        if (image && !covers.get(key)) {
          covers.set(key, image);
          if (live()) setFound((n) => n + 1);
        }
      } catch {
        /* A player that cannot search keeps its generated covers. */
      }
    });
  });

  const items = createMemo(() => {
    const term = query().trim().toLowerCase();
    return sources()
      .filter((name) => !term || name.toLowerCase().includes(term))
      .sort((a, b) => Number(INPUT.test(a)) - Number(INPUT.test(b)));
  });

  const play = (name: string) => {
    const target = props.player()?.id;
    if (!target) return;
    setError("");
    setPending(name);
    void callService("media_player", "select_source", { source: name }, { entity_id: target })
      .then(() => props.onPlayed?.())
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setPending(""));
  };

  return (
    <div class="mp-favs">
      {/* Only once the list is long enough to need it: eight tiles fit on a
          phone without scrolling, and a filter above them is furniture. */}
      <Show when={sources().length > 8}>
        <div class="mp-search-row">
          <div class="mp-input-wrap">
            <Icon icon="mdi:magnify" width="17" />
            <input
              class="mp-input"
              type="search"
              placeholder="Filter favourites"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="mp-empty">{error()}</div>
      </Show>

      <Show
        when={sources().length}
        fallback={
          <div class="mp-setup">
            <Icon icon="mdi:heart-off-outline" width="26" />
            <h3>No favourites on this player</h3>
            <p>
              Sonos publishes the favourites from its own app as this speaker's
              source list. Add one there and it appears here; a player that
              lists no sources has nothing this tab can offer.
            </p>
          </div>
        }
      >
        <Show when={items().length} fallback={<div class="mp-empty">Nothing matches that.</div>}>
          <div class="mp-lib-grid">
            <For each={items()}>
              {(name) => (
                <button
                  class="mp-lib-item mp-fav"
                  data-playing={current() === name}
                  data-pending={pending() === name}
                  onClick={() => play(name)}
                >
                  <Show
                    when={!coverFor(name) && picon(name)}
                    fallback={
                  <Show
                    when={!coverFor(name) && channelBrand(name)}
                    fallback={
                      <span class="mp-fav-art">
                        <Cover
                          name={name}
                          image={coverFor(name) || undefined}
                          mediaType={INPUT.test(name) ? "radio" : "playlist"}
                        />
                        <i class="mp-fav-badge">
                          <Icon icon={iconFor(name)} width="13" />
                        </i>
                      </span>
                    }
                  >
                    {(channel) => (
                      /* A receiver's channel: its logo on its colour. */
                      <span class="mp-fav-art mp-fav-channel" style={brandStyle(channel())}>
                        <Icon icon={channel().icon} />
                      </span>
                    )}
                  </Show>
                    }
                  >
                    {(logo) => (
                      /* The channel's own picon, on a screen-dark tile. */
                      <span class="mp-fav-art mp-fav-channel mp-picon-tile">
                        <img class="mp-picon" src={logo()} alt="" draggable={false} />
                      </span>
                    )}
                  </Show>
                  <span class="mp-lib-name mp-truncate">{name}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
