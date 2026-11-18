import { useDomains } from "../domains";
import { useEntities, type EntityView } from "@glasshome/widget-sdk";
import { isPlex } from "./library";
import { attr, isActiveState } from "./util";

/* Words that say nothing about which device a player is: every Plex client's
   name carries some of them. */
const NOISE = new Set(["plex", "for", "android", "tv", "media", "player", "the", "and", "app"]);

/* One word per device family, whatever each side calls it: Home Assistant
   names a Fire TV "Fire TV …", Plex names the same box by its model code
   ("AFTMM", "AFTKA"); a Shield is "SHIELD" to one and "NVIDIA …" to the
   other; a Xiaomi box is "Mi TV …" here and "MiTV-…" or "MIBOX…" there. */
const family = (word: string) => {
  if (/^aft[a-z0-9]*$/.test(word) || word === "fire" || word === "firetv" || word === "amazon")
    return "firetv";
  if (word === "nvidia" || word === "shield") return "shield";
  if (/^mi(tv|box)/.test(word) || word === "xiaomi") return "mitv";
  return word;
};

const words = (value: string) =>
  new Set(
    value
      .toLowerCase()
      /* "Mi TV", "Mi Box": two short words that would each be dropped, so
         joined first into the one that names the family. */
      .replaceAll(/\bmi[\s_-]*(tv|box)/g, "mi$1")
      .split(/[^a-z0-9äöüß]+/)
      .filter((word) => word.length > 2 && !NOISE.has(word))
      .map(family),
  );

/** Is this player showing Plex — its app, its source — without being Plex's own entity? */
const runningPlex = (player: EntityView) =>
  !isPlex(player) &&
  /plex/i.test(
    `${attr(player, "app_name", "")} ${attr(player, "app_id", "")} ${attr(player, "source", "")}`,
  );

/**
 * The Plex integration's own player for a device that is running Plex.
 *
 * A Shield (or any Android TV or Cast device) playing in the Plex app reports
 * little of what it plays and seldom a cover; the Plex integration creates a
 * second player for the same device, and that one has the poster, the title
 * and the rest. Found among the Plex players that are playing right now: the
 * one playing the same title first, then the one whose name shares a word
 * with the device's ("SHIELD", or a Fire TV's model code), and if only one
 * is playing, that one. The same for any device running Plex: a Shield, a
 * Fire TV, a Chromecast.
 */
export function plexTwin(
  player: EntityView | undefined,
  plexPlayers: EntityView[],
): EntityView | undefined {
  if (!player || !isActiveState(player) || !runningPlex(player)) return undefined;

  const candidates = plexPlayers.filter(
    (entity) => entity.id !== player.id && isPlex(entity) && isActiveState(entity),
  );
  if (candidates.length <= 1) return candidates[0];

  const title = attr(player, "media_title", "");
  if (title) {
    const same = candidates.find((entity) => attr(entity, "media_title", "") === title);
    if (same) return same;
  }

  const mine = words(`${player.friendlyName ?? ""} ${player.id}`);
  let best: EntityView | undefined;
  let bestScore = 0;
  for (const entity of candidates) {
    const theirs = words(`${entity.friendlyName ?? ""} ${entity.id}`);
    let score = 0;
    for (const word of theirs) if (mine.has(word)) score++;
    if (score > bestScore) {
      best = entity;
      bestScore = score;
    }
  }
  return best;
}

/** The picture to show for a player: its Plex twin's while it has one. */
export function pictureOf(
  player: EntityView | undefined,
  plexPlayers: EntityView[] = [],
): string | undefined {
  const twin = plexTwin(player, plexPlayers);
  const fromTwin = twin ? attr<string | undefined>(twin, "entity_picture", undefined) : undefined;
  return fromTwin ?? attr<string | undefined>(player, "entity_picture", undefined);
}

/**
 * The Plex integration's players, to find a twin among. Only the ids that
 * say Plex — the integration names its players media_player.plex_… — so a
 * house full of speakers is not subscribed to for the sake of one Shield.
 * A hook: call it once, at a component's top.
 */
export function usePlexPlayers(): () => EntityView[] {
  const domains = useDomains();
  return useEntities(() => (domains().media_player ?? []).filter((id) => /plex/i.test(id)));
}

/* What a Plex player knows about what is playing, and a device running Plex
   often does not: the title, the show, the episode, the cover, the timing. */
const MEDIA_KEYS = [
  "media_title",
  "media_series_title",
  "media_season",
  "media_episode",
  "media_artist",
  "media_album_name",
  "media_album_artist",
  "media_content_type",
  "media_content_id",
  "media_duration",
  "media_position",
  "media_position_updated_at",
  "entity_picture",
];

/* One stand-in per device and twin state, so a view keyed on the player does
   not see a new object on every read. */
const standIns = new WeakMap<EntityView, { twin: EntityView; view: EntityView }>();

/**
 * A device running Plex, told what is playing by its Plex twin.
 *
 * Everything that says what is playing comes from the Plex player; the
 * device's own id, state, features and volume stay its own, so the controls
 * still go to the device. A player without a twin is handed back unchanged.
 */
export function withPlexTwin(
  player: EntityView | undefined,
  plexPlayers: EntityView[],
): EntityView | undefined {
  const twin = plexTwin(player, plexPlayers);
  if (!player || !twin) return player;

  const kept = standIns.get(player);
  if (kept?.twin === twin) return kept.view;

  const own = player.attributes ?? {};
  const theirs = twin.attributes ?? {};
  const attributes: Record<string, unknown> = { ...own };
  for (const key of MEDIA_KEYS) {
    const value = (theirs as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== "") attributes[key] = value;
  }

  const view = new Proxy(player, {
    get: (target, prop, receiver) =>
      prop === "attributes" ? attributes : Reflect.get(target, prop, receiver),
  });
  standIns.set(player, { twin, view });
  return view;
}
