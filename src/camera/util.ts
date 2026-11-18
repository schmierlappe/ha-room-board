import { type EntityView } from "@glasshome/widget-sdk";
import { sealedImage } from "../url";

export function attr<T>(entity: EntityView | undefined, key: string, fallback: T): T {
  const value = entity?.attributes?.[key];
  return (value ?? fallback) as T;
}

/**
 * The dashboard's own colours, read off the `.dark`/`.light` wrapper.
 *
 * The tile renders in a closed shadow root, which custom properties do not
 * cross, so none of the theme's tokens reach it — they have to be read here
 * and re-declared.
 */
export function themeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};

  const root = document.querySelector(".dark, .light") ?? document.body;
  const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const vars: Record<string, string> = {};
  const primary = read("--primary");
  const card = read("--card");
  const foreground = read("--foreground");
  const page = read("--background");

  if (primary) vars["--cm-primary"] = primary;
  if (card) vars["--cm-card"] = card;
  if (foreground) vars["--cm-fg"] = foreground;
  if (page) vars["--cm-page"] = page;
  return vars;
}

/**
 * Where a camera's still actually lives.
 *
 * Home Assistant publishes it as an origin-relative `entity_picture` carrying
 * its own signed token. The dashboard's media proxy answers 403 for the
 * camera_proxy route, so a configured Home Assistant origin is used directly
 * where one is set — the same arrangement the vacuum map needs.
 */
export function stillUrl(
  camera: EntityView | undefined,
  tick: number,
): string | undefined {
  const picture = attr<string | undefined>(camera, "entity_picture", undefined);
  if (!picture) return undefined;

  /* Through the dashboard's media proxy: the sealed engine of Dash 1.5
     refuses Home Assistant's own address. */
  const url = sealedImage(picture);
  if (!url) return undefined;

  // Blink only changes the token when a new thumbnail exists, so the tick is
  // what makes a manual refresh actually fetch anything.
  return `${url}${url.includes("?") ? "&" : "?"}v=${tick}`;
}

/** The slug a camera's companion entities are named after. */
export const slugOf = (camera: EntityView | undefined) =>
  (camera?.id ?? "").split(".")[1] ?? "";

/**
 * The entities Blink creates beside a camera: motion, temperature, wifi and
 * battery. Matched on the camera's own slug out of everything in the house —
 * exact enough that a second camera's sensors cannot be mistaken for these.
 */
export function companionIds(camera: EntityView | undefined, pool: string[]): string[] {
  const slug = slugOf(camera);
  if (!slug) return [];
  /* Blink names a camera's temperature and Wi-Fi sensors after the
     integration as well: sensor.blink_<camera>_temperature. */
  return pool.filter((id) => {
    const object = id.split(".")[1] ?? "";
    return object.startsWith(slug) || object.startsWith(`blink_${slug}`);
  });
}

export const isMotion = (entity: EntityView | undefined) => entity?.state === "on";

/** "just now", "3 min ago" — how fresh the still is. */
export function sinceLabel(when: Date | string | undefined): string {
  if (!when) return "";
  const then = when instanceof Date ? when.getTime() : new Date(when).getTime();
  if (!Number.isFinite(then)) return "";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** A Blink camera reports its own recording switch as an attribute. */
export const motionOn = (camera: EntityView | undefined) =>
  attr<boolean>(camera, "motion_detection", false);
