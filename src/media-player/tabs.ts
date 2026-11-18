/**
 * Which panels the popup offers, shared by the popup's own nav and by the
 * shortcut row on a portrait tile. One list, so the row can never offer a tab
 * the popup would not have shown — every entry is gated on the selected
 * player actually supporting it.
 */
import type { EntityView } from "@glasshome/widget-sdk";
import { FEATURE, isMusicAssistant, supports } from "./features";
import { isPlex } from "./library";

/* A Plex client is only a player while its app is open: the rest of the time
   Home Assistant keeps the entity as "unavailable", and asking it for its
   library then fails. No library tab until there is someone to ask. */
const available = (player: EntityView | undefined) =>
  !!player && !["unavailable", "unknown"].includes(player.state ?? "");
import type { RemoteProfile } from "./remote";

/** A player whose media browser can be walked and played from. */
export const canBrowse = (player: EntityView | undefined) =>
  available(player) &&
  supports(player, FEATURE.BROWSE_MEDIA) &&
  supports(player, FEATURE.PLAY_MEDIA);

export type Tab =
  | "now"
  | "discover"
  | "browse"
  | "library"
  | "search"
  | "favourites"
  | "rooms"
  | "remote"
  | "queue";

export type TabItem = { id: Tab; label: string; icon: string };

/**
 * Which players a profile claims. An explicit list wins; failing that, an ADB
 * profile implicitly claims its own device, since a Fire TV remote belongs to
 * the Fire TV and nothing else. Only a Harmony or remote-entity profile with
 * no list is offered everywhere — those name no player, so there is nothing
 * to infer.
 */
export function claimedBy(profile: RemoteProfile): string[] | null {
  if (profile.forPlayers?.length) return profile.forPlayers;
  if (profile.kind === "adb" && profile.player?.length) return profile.player;
  return null;
}

export function profilesFor(profiles: RemoteProfile[], activeId: string): RemoteProfile[] {
  return profiles.filter((p) => {
    const claims = claimedBy(p);
    return !claims || claims.includes(activeId);
  });
}

export function tabsFor(
  player: EntityView | undefined,
  opts: {
    musicAssistant: boolean;
    remoteProfiles: RemoteProfile[];
    activeId: string;
    /** The players this one could be grouped with — the room's, or the
     *  widget's. Grouping is only offered when one of them can join. */
    players?: EntityView[];
  },
): TabItem[] {
  const tabs: TabItem[] = [{ id: "now", label: "Now", icon: "mdi:play-circle" }];

  /* All three are Music Assistant's: Discover is mass_queue's recommendations,
     Browse is its library and Search plays what it finds back through it. A
     Sonos driven straight from Home Assistant answers `search_media` too, which
     is how the three tabs used to appear on a speaker that could do nothing
     with any of them — so the gate is the integration, not the feature bit. */
  const mass = opts.musicAssistant && isMusicAssistant(player);

  /* Discover and Search, and no library browser: anything Browse listed,
     Search finds by name, and on a phone's dock every tab is one more. */
  if (mass && supports(player, FEATURE.SEARCH_MEDIA))
    tabs.push({ id: "discover", label: "Discover", icon: "mdi:compass-outline" });
  if (mass && supports(player, FEATURE.SEARCH_MEDIA))
    tabs.push({ id: "search", label: "Search", icon: "mdi:magnify" });

  /* The player's media library, through Home Assistant's media browser.
   *
   * Not only for Plex's own client entities: those exist only while something
   * is already playing on them — a Plex app opened on a phone or a TV stays
   * "unavailable" until it starts a video — so a library offered there could
   * never be used to start one. A Google Cast player (a Shield, a Chromecast,
   * a Google TV) or a Sonos is always there, and Home Assistant's media browser
   * on those carries the Plex libraries too; playing from it casts the title,
   * and the TV opens Plex's receiver by itself, no app needed. So any player
   * that can be browsed and played to gets the tab, and a Plex client gets it
   * as well while it is up. */
  const browsable = !mass && canBrowse(player);

  /* In their place, the speaker's own favourites. Not for a player a remote
     profile claims: a Fire TV's sources are its apps, and the Remote tab
     already lists them. */
  const claimed = profilesFor(opts.remoteProfiles, opts.activeId).length > 0;
  const favourites = !mass && !claimed && supports(player, FEATURE.SELECT_SOURCE);

  /* A player with both gets one tab: Favourites, which is the same media
     browser opened in the speaker's Favorites folder, with the rest of the
     library one step back. Two tabs showing the same favourites twice — one
     as the source list, one as a folder — was the duplicate. */
  if (browsable && !favourites)
    tabs.push({
      id: "library",
      label: "Library",
      icon: isPlex(player) ? "mdi:plex" : "mdi:folder-play-outline",
    });

  if (favourites)
    tabs.push({ id: "favourites", label: "Favourites", icon: "mdi:heart-outline" });
  /* Only when there is someone to group with: another player here that can
     join, and of the same kind — a Sonos groups with Sonos, a Music Assistant
     player with Music Assistant players. A Grouping tab listing nobody is a
     tab to nowhere. */
  const partners = (opts.players ?? []).filter(
    (other) =>
      other.id !== player?.id &&
      supports(other, FEATURE.GROUPING) &&
      isMusicAssistant(other) === isMusicAssistant(player),
  );
  if (supports(player, FEATURE.GROUPING) && partners.length)
    tabs.push({ id: "rooms", label: "Grouping", icon: "mdi:speaker-multiple" });

  /* Only the profiles that claim the selected player. A music speaker claimed
     by none gets no Remote tab at all, which is the point: a kitchen Sonos has
     nothing to navigate. */
  if (claimed) tabs.push({ id: "remote", label: "Remote", icon: "mdi:remote-tv" });

  return tabs;
}
