import { createEffect, createSignal, onCleanup } from "solid-js";
import type { EntityView } from "@glasshome/widget-sdk";
import { isDarkTheme, themeRoot as readThemeRoot } from "../theme";

export const PLAYING_STATES = new Set(["playing", "buffering"]);

/** Strictly playing: the only states that carry a moving media_position. */
export const isPlayingState = (e: EntityView | undefined) =>
  PLAYING_STATES.has(e?.state ?? "");

/**
 * Playing as far as the UI is concerned. Receivers and set-top boxes — VU+,
 * Sky — never report `playing`; they sit on `on` for as long as they are
 * showing something, so the equaliser, the play/pause glyph and the tile's
 * auto-pick have to treat that as active too.
 */
export const ACTIVE_STATES = new Set([...PLAYING_STATES, "on"]);

export const isActiveState = (e: EntityView | undefined) =>
  ACTIVE_STATES.has(e?.state ?? "");

export const isAlive = (e: EntityView | undefined) =>
  !!e && e.state !== "unavailable" && e.state !== "unknown";

/** Read an attribute with a fallback. EntityView.attributes excludes icon,
 *  deviceClass, unitOfMeasurement and friendlyName — read those off the entity. */
export function attr<T>(e: EntityView | undefined, key: string, fallback: T): T {
  const v = e?.attributes?.[key];
  return (v ?? fallback) as T;
}

/** The speaker for a volume in percent: off, low, medium or high. */
export function volumeIconOf(level: number): string {
  if (!level) return "mdi:volume-off";
  if (level < 34) return "mdi:volume-low";
  return level < 67 ? "mdi:volume-medium" : "mdi:volume-high";
}

export function formatTime(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * media_position is only a snapshot taken at media_position_updated_at, so it has
 * to be extrapolated locally. Ticks once a second, and only while playing.
 */
export function createLivePosition(entity: () => EntityView | undefined) {
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    if (!isPlayingState(entity())) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });

  return () => {
    const e = entity();
    const base = attr<number | undefined>(e, "media_position", undefined);
    if (base === undefined) return undefined;
    if (!isPlayingState(e)) return base;
    const stamp = attr<string | undefined>(e, "media_position_updated_at", undefined);
    const drift = stamp ? (now() - new Date(stamp).getTime()) / 1000 : 0;
    const duration = attr<number>(e, "media_duration", Number.POSITIVE_INFINITY);
    return Math.min(duration, base + Math.max(0, drift));
  };
}

/**
 * The dashboard's theme accent, read off the `.dark`/`.light` wrapper where
 * GlassHome declares its theme tokens. <html> is that element's ancestor and
 * inheritance only flows down, so reading from the document root — or relying
 * on `var(--primary)` reaching the widget's shadow root — comes back empty.
 * Exposed as `--mp-primary` for the stylesheet to consume.
 */
/**
 * The colour to draw on top of a given colour: near-black on a light one,
 * white on a dark one.
 *
 * The primary colour is a setting, and a white or pastel primary made every
 * selected tab, lit key and active chip white on white — their icons and
 * words were drawn in #fff whatever sat under them. The theme's own
 * --primary-foreground is used where it has one; otherwise the colour is
 * measured. Any CSS colour is accepted (oklch included): a canvas turns it
 * into pixels, and the pixels say how light it is.
 */
const onCache = new Map<string, string>();

export function onColour(colour: string, themed?: string): string {
  if (themed) return themed;
  const known = onCache.get(colour);
  if (known) return known;
  let answer = "#fff";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000";
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
      /* Where dark text starts reading better than white. */
      if (luminance > 0.45) answer = "#0b0f16";
    }
  } catch {
    /* No canvas: white, as before. */
  }
  onCache.set(colour, answer);
  return answer;
}

export function themeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};

  const themeRoot = readThemeRoot();
  const primary = getComputedStyle(themeRoot).getPropertyValue("--primary").trim();
  const primaryFg = getComputedStyle(themeRoot).getPropertyValue("--primary-foreground").trim();
  const vars: Record<string, string> = {};
  if (primary) {
    vars["--mp-primary"] = primary;
    /* What sits on it: a light primary gets dark icons and words. */
    vars["--mp-on-primary"] = onColour(primary, primaryFg || undefined);
  }

  /* The remote's menus float over the touchpad and must be opaque, so they
     need a real surface colour. It cannot come from CSS: the theme class is
     on a wrapper div, not on :root, and the dialog portals to document.body
     outside it — so a `.light` selector would never match. */
  const dark = isDarkTheme();

  /* The theme's own popover colour where it exists — that is the surface the
     dashboard uses for every other floating menu, so ours matches instead of
     approximating. It is a complete colour (oklch(...)), not a triplet, so it
     can be used as-is. The hardcoded pair stays as the fallback. */
  const popover = getComputedStyle(themeRoot).getPropertyValue("--popover").trim();
  const popoverFg = getComputedStyle(themeRoot).getPropertyValue("--popover-foreground").trim();
  vars["--mp-menu-bg"] = popover || (dark ? "#1b1f25" : "#f6f7f9");
  if (popoverFg) vars["--mp-menu-fg"] = popoverFg;

  /* The dashboard's own page colour. The popup covers the whole screen on a
     phone, so its panel has to be this rather than the popover surface —
     otherwise the strip behind the status bar reads as a different app.
     Always set: a missing var makes the whole background declaration invalid
     at computed-value time, which paints the panel transparent. */
  vars["--mp-bg"] = pageBackground(themeRoot, dark);

  /* The shade laid over the blurred cover on the tile: dark in a dark theme,
     the light card's own colour in a light one — a light dashboard keeps a
     light tile with the art showing through, not a dark slab in it. The
     words on it follow: white on the dark shade, the theme's own on the light. */
  vars["--mp-scrim-rgb"] = dark ? "10 10 12" : "246 247 249";
  const ink = getComputedStyle(themeRoot).getPropertyValue("--foreground").trim();
  vars["--mp-art-ink"] = dark ? "#fff" : ink || "#111827";

  return vars;
}

/**
 * The colour the dashboard paints its page with. The token is the honest
 * answer — it is what the theme's own Background setting writes — but it is
 * only readable where it is declared, so fall back to the colour actually
 * painted on the theme root, then on body and html.
 */
function pageBackground(themeRoot: Element | HTMLElement, dark: boolean): string {
  const token = getComputedStyle(themeRoot).getPropertyValue("--background").trim();
  if (token) return token;

  const transparent = /^(transparent|rgba?\([^)]*,\s*0(\.0+)?\s*\))$/;
  for (const el of [themeRoot, document.body, document.documentElement]) {
    if (!el) continue;
    const painted = getComputedStyle(el).backgroundColor?.trim();
    if (painted && !transparent.test(painted)) return painted;
  }

  return dark ? "#0d100e" : "#f6f7f9";
}

/**
 * iOS has no Vibration API and shows no sign of getting one, but Safari 17.4
 * added the `switch` attribute on a checkbox — and toggling one plays the
 * system haptic. A hidden switch, clicked from inside a real user gesture, is
 * the only way to reach the Taptic Engine from a web page.
 *
 * One element, created lazily and reused: appending a node per press would
 * leave a trail of them in the document.
 */
let iosTapper: HTMLLabelElement | undefined;

function iosHaptic(): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  try {
    if (!iosTapper?.isConnected) {
      const label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      // Out of flow, unfocusable and untouchable: it exists only to be
      // clicked in code.
      label.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";

      const input = document.createElement("input");
      input.type = "checkbox";
      // Not a property — the attribute is what Safari keys the haptic on.
      input.setAttribute("switch", "");
      input.tabIndex = -1;

      label.appendChild(input);
      document.body.appendChild(label);
      iosTapper = label;
    }

    // Clicking the label toggles the switch, and the toggle is what fires.
    iosTapper.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * A short buzz on a press. Android's WebView and Chrome have the Vibration
 * API; iOS gets the switch trick above. Both are best-effort — a control that
 * throws on a device without a motor would be worse than one that stays
 * silent.
 */
export function haptic(ms = 10) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
      return;
    }
  } catch {
    /* Blocked by permissions policy, or no motor. Fall through to iOS. */
  }

  // iOS cannot vary the strength, so the duration argument is ignored there —
  // every press feels the same rather than not at all.
  iosHaptic();
}
