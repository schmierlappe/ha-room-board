import { massCover } from "../artwork";
import { asType, resolveArtwork, type MediaType } from "./cover";
import type { GridItem } from "./grid";

/**
 * Artists and albums have children worth opening; the rest play directly.
 *
 * Playlists are deliberately absent: music_assistant.search filters by artist
 * or album name, and a playlist's tracks are not reachable that way. They play
 * as a whole instead.
 */
export const OPENABLE = new Set<MediaType>(["artist", "album"]);

export type Level = {
  title: string;
  items: GridItem[];
  /** The container we drilled into, so it can be played as a whole. */
  parent?: GridItem;
};

/** An album's artist for a search, where it is known. */
const artistOf = (item: GridItem): { artist?: string } => (item.artist ? { artist: item.artist } : {});

/** One item out of a music_assistant.search bucket. */
export function toItem(raw: any, proxy?: string, haBase?: string): GridItem | null {
  if (!raw || typeof raw.uri !== "string" || typeof raw.name !== "string") return null;
  let artist: string | undefined;
  if (Array.isArray(raw.artists)) artist = raw.artists.map((a: any) => a?.name).filter(Boolean).join(", ");
  else if (typeof raw.artist?.name === "string") artist = raw.artist.name;
  const mediaType = asType(raw.media_type);

  return {
    id: raw.uri,
    name: raw.name,
    subtitle: artist || (typeof raw.album?.name === "string" ? raw.album.name : undefined),
    /* The address loads only from Home Assistant; otherwise the item's cover
       from Music Assistant (src/artwork.ts). */
    image:
      resolveArtwork(typeof raw.image === "string" ? raw.image : undefined, proxy, haBase) ??
      massCover(raw.uri),
    mediaType,
    artist,
    canOpen: OPENABLE.has(mediaType),
  };
}

export function readSearch(
  response: unknown,
  keys: string[],
  proxy?: string,
  haBase?: string,
): GridItem[] {
  if (!response || typeof response !== "object") return [];
  const root = response as Record<string, any>;
  return keys.flatMap((k) =>
    (Array.isArray(root[k]) ? root[k] : []).map((r: any) => toItem(r, proxy, haBase)).filter(Boolean),
  ) as GridItem[];
}

/**
 * Drill into a container. music_assistant.search takes artist and album
 * filters, which is the only service-level way to reach a container's
 * children: get_library has no parent filter, and media_player.search_media
 * reports can_search:false.
 *
 * Filtering is by name, so a hit whose spelling differs from the library
 * entry can come back empty — there is no true parent-child traversal to use.
 */
export async function openContainer(
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: { entity_id?: string | string[] },
    options?: { returnResponse?: boolean },
  ) => Promise<unknown>,
  item: GridItem,
  configEntryId?: string,
  proxy?: string,
  haBase?: string,
): Promise<GridItem[]> {
  const isArtist = item.mediaType === "artist";
  const data = isArtist
    ? {
        name: item.name,
        // Playlists included so provider content — Apple Music's editorial and
        // "essentials" playlists, for instance — shows under the artist. Those
        // are never in get_library, so this is the only place they surface
        // outside a manual search.
        media_type: ["album", "playlist", "track"],
        artist: item.name,
        limit: 50,
      }
    : {
        name: item.name,
        media_type: ["track"],
        album: item.name,
        ...artistOf(item),
        limit: 50,
      };

  // Domain-wide call: no entity target, since the host would check that
  // entity's domain against the music_assistant grant.
  const response = await callService(
    "music_assistant",
    "search",
    { ...(configEntryId ? { config_entry_id: configEntryId } : {}), ...data },
    undefined,
    { returnResponse: true },
  );

  // Children often have no artwork of their own; the container's stands in.
  return readSearch(
    response,
    isArtist ? ["albums", "playlists", "tracks"] : ["tracks"],
    proxy,
    haBase,
  ).map((child) =>
    child.image ? child : { ...child, image: item.image },
  );
}
