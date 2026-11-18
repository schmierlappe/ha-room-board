import { hassMediaUrl } from "@glasshome/widget-sdk";

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
 * A picture's address as the sealed engine of Dash 1.5 will load it.
 *
 * The engine loads images only from the dashboard itself: `data:` and `blob:`
 * URLs, and Home Assistant's pictures through the dashboard's media proxy
 * (/ha-proxy/media, which hassMediaUrl builds). Home Assistant's own address
 * and every other host are refused, and the <img> is left without a picture.
 * So a Home Assistant path goes through the proxy — also when it arrives as a
 * full URL to Home Assistant — and anything else is answered with undefined,
 * for the card to show its own fallback rather than an empty frame.
 */
export function sealedImage(picture: string | null | undefined): string | undefined {
  if (!picture) return undefined;
  if (picture.startsWith("data:image/") || picture.startsWith("blob:")) return picture;
  if (picture.startsWith("/ha-proxy/")) return picture;
  let path = picture;
  if (!picture.startsWith("/")) {
    try {
      const url = new URL(picture);
      path = `${url.pathname}${url.search}`;
    } catch {
      return undefined;
    }
  }
  return PROXIED.some((prefix) => path.startsWith(prefix)) ? hassMediaUrl(path) : undefined;
}

/* The Home Assistant paths the dashboard's media proxy serves (Dash
   1.5.0-rc.2). Not /local/: a picture kept in Home Assistant's www folder is
   refused, so a person's photo belongs in their profile, uploaded, where it
   is served from /api/image/serve/. */
const PROXIED = [
  "/api/media_player_proxy/",
  "/api/camera_proxy/",
  "/api/camera_proxy_stream/",
  "/api/image_proxy/",
  "/api/image_proxy_stream/",
  "/api/image/",
];
