
/**
 * A base URL without its trailing slashes, so a path can be put after it.
 *
 * A loop rather than /\/+$/: on a string of many slashes that do not end it,
 * that pattern is tried again from every one of them — work that grows with
 * the square of the string's length.
 */
export function trimSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

/**
 * A picture's address as the card loads it.
 *
 * In GlassHome's sealed engine only the dashboard's own pictures loaded, and
 * this answered undefined for every other host (a club's crest, a cover from
 * a music service), for the card to fall back to initials. On a Home
 * Assistant card the browser loads any picture: Home Assistant's own paths
 * as they are (the card is on its origin), and http(s) addresses from
 * anywhere. Anything else — Music Assistant's item references — is answered
 * with undefined, for the artwork integration to fetch (src/artwork.ts).
 */
export function sealedImage(picture: string | null | undefined): string | undefined {
  if (!picture) return undefined;
  if (picture.startsWith("data:image/") || picture.startsWith("blob:")) return picture;
  if (picture.startsWith("/")) return picture;
  try {
    const url = new URL(picture);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    /* Home Assistant's own address, as some integrations give it: the path,
       so it loads however the card was reached (at home or from outside). */
    if (typeof location !== "undefined" && url.origin === location.origin) return `${url.pathname}${url.search}`;
    return picture;
  } catch {
    return undefined;
  }
}
