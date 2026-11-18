/**
 * Favouriting the playing track.
 *
 * There is no favourite action to call: the mass_queue integration exposes it
 * as a button entity per player — button.sonos_move_favorite_current_song
 * beside media_player.sonos_move — so favouriting is button.press on that
 * entity. That makes the capability exact rather than probed: the heart is
 * offered only where the button exists, and pressing it cannot fail with
 * "unknown action" the way guessing at a service name could.
 *
 * The catch is that the two entity ids only line up when nothing has been
 * renamed. A player added twice carries a "_2" suffix the button does not, a
 * hand-renamed player shares nothing with it at all, and Music Assistant has
 * changed the suffix across releases. So the match is tried from both ends, and
 * a single-player setup falls back to the only favourite button there is.
 */

const FAVOURITE = /favou?rite/i;

/** Trailing disambiguators Home Assistant adds on a second entity. */
const stripSuffix = (slug: string) => {
  const at = slug.lastIndexOf("_");
  const tail = slug.slice(at + 1);
  return at >= 0 && tail !== "" && [...tail].every((c) => c >= "0" && c <= "9") ? slug.slice(0, at) : slug;
};

/** Everything a favourite button's id carries after the player's name. */
const stripTail = (id: string) =>
  stripSuffix(id.replace(/^button\./, "").replace(/_favou?rite.*$/i, ""));

export function favouriteButtonFor(playerId: string, buttons: string[]): string | undefined {
  const slug = stripSuffix(playerId.split(".")[1] ?? "");
  if (!slug || !buttons.length) return undefined;

  const favourites = buttons.filter((id) => FAVOURITE.test(id));
  if (!favourites.length) return undefined;

  return (
    // The documented name, both spellings.
    favourites.find((id) => id === `button.${slug}_favorite_current_song`) ??
    favourites.find((id) => id === `button.${slug}_favourite_current_song`) ??
    // Any favourite button carrying this player's name, whatever follows it.
    favourites.find((id) => stripTail(id) === slug) ??
    // Renamed at one end only: one id still contains the other's name.
    favourites.find((id) => {
      const tail = stripTail(id);
      return !!tail && (tail.includes(slug) || slug.includes(tail));
    }) ??
    // A single-player setup has only one favourite button, and it is this
    // player's — there is nothing else it could belong to.
    (favourites.length === 1 ? favourites[0] : undefined)
  );
}
