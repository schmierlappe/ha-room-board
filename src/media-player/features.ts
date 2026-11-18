import { attr } from "./util";
import type { EntityView } from "@glasshome/widget-sdk";

/** MediaPlayerEntityFeature bits, as Home Assistant defines them. */
export const FEATURE = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  PLAY_MEDIA: 512,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  CLEAR_PLAYLIST: 8192,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  SELECT_SOUND_MODE: 65536,
  BROWSE_MEDIA: 131072,
  REPEAT_SET: 262144,
  GROUPING: 524288,
  MEDIA_ANNOUNCE: 1048576,
  MEDIA_ENQUEUE: 2097152,
  SEARCH_MEDIA: 4194304,
} as const;

/**
 * What a player can do, as opposed to what it can do this second.
 *
 * A Sonos rewrites supported_features as it changes track or source, and for
 * an update or two in between it can drop the browse, source or grouping bits
 * altogether. Read live, that took the Favourites tab away and gave it back —
 * the popup flicked to Now and back, and the favourites panel swapped to its
 * fallback list and rebuilt. These bits are what the device is, not what it
 * is doing, so once a player has shown one it keeps it for the session. The
 * transport bits (pause, next, seek) still follow the live value: those
 * genuinely come and go with what is playing.
 */
const LASTING =
  FEATURE.PLAY_MEDIA |
  FEATURE.SELECT_SOURCE |
  FEATURE.SELECT_SOUND_MODE |
  FEATURE.BROWSE_MEDIA |
  FEATURE.GROUPING |
  FEATURE.SEARCH_MEDIA;

const seen = new Map<string, number>();

export function supports(entity: EntityView | undefined, bit: number): boolean {
  const live = attr<number>(entity, "supported_features", 0);
  let bits = live;
  if (entity?.id) {
    const kept = (seen.get(entity.id) ?? 0) | (live & LASTING);
    seen.set(entity.id, kept);
    bits |= kept;
  }
  return (bits & bit) === bit;
}

/**
 * Music Assistant players expose extra services (radio mode, library browsing).
 * A Sonos speaker driven by MA, a Vu+ box and an Android TV all differ here, so
 * every capability is read from the entity rather than assumed.
 */
export function isMusicAssistant(entity: EntityView | undefined): boolean {
  return (
    attr<string>(entity, "app_id", "") === "music_assistant" ||
    attr<string>(entity, "mass_player_type", "") !== ""
  );
}
