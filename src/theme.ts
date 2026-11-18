import { state as haState } from "./ha/store";
import { createRenderEffect, type JSX } from "solid-js";

/**
 * Where the dashboard's theme lives, and which way round it is.
 *
 * GlassHome writes its tokens as `:root { light } .dark { dark }` and toggles
 * `dark` on <html> (theme-mode: `documentElement.classList.toggle("dark")`).
 * A light dashboard therefore carries no `.light` class anywhere, and any
 * other element that happens to be called `.dark` is not the theme. Looking
 * for `.dark, .light` read the dashboard as dark in light mode — dark menus
 * and white-on-white rows — and could read the dark tokens off a stray
 * element. <html> decides wherever it carries the tokens; the wrapper lookup
 * stays for hosts (the preview harness) that declare them on a div.
 */
function htmlHasTokens(): boolean {
  const html = document.documentElement;
  const styles = getComputedStyle(html);
  return !!(styles.getPropertyValue("--background").trim() || styles.getPropertyValue("--primary").trim());
}

/* On a Home Assistant card the theme is the card's own host: the card maps
   Home Assistant's theme variables onto the tokens the widgets read
   (--primary, --background...), see src/card.tsx. */
let cardHost: Element | undefined;
export function setThemeHost(el: Element): void {
  cardHost = el;
}

export function themeRoot(): Element {
  if (typeof document === "undefined") return undefined as unknown as Element;
  if (cardHost) return cardHost;
  if (htmlHasTokens()) return document.documentElement;
  return document.querySelector(".dark, .light") ?? document.body;
}

export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return true;
  /* Home Assistant's own setting, reactive: the board recolours on a switch. */
  if (cardHost) return haState.dark;
  const html = document.documentElement;
  if (html.classList.contains("dark")) return true;
  if (html.classList.contains("light") || htmlHasTokens()) return false;
  const wrapper = document.querySelector(".dark, .light");
  if (wrapper) return wrapper.classList.contains("dark");
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

const INK = "#1c1917";

/** WCAG relative luminance of a #rgb or #rrggbb colour, or undefined for anything else. */
function luminance(color: string): number | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The text colour that reads best on a fill — white or a near-black ink,
 * whichever has the higher contrast. For fills a widget does not choose itself,
 * such as a weather service's warning colour: white is lost on its yellow,
 * ink on its purple. Anything that is not a hex colour gets the ink.
 */
export function inkOn(fill: string | undefined): string {
  const l = fill ? luminance(fill) : undefined;
  if (l === undefined) return INK;
  const ink = luminance(INK)!;
  return (1.05 / (l + 0.05) > (l + 0.05) / (ink + 0.05)) ? "#fff" : INK;
}

/**
 * CSS variables set on an element by an effect of their own, each written
 * only when its value changes. Use it as `ref={(el) => setVars(el, () => ...)}`
 * in place of `style={vars()}` on an element with other changing attributes.
 *
 * Solid puts all of an element's changing attributes in one effect, and its
 * style() forgets the values it set before setting them again: whenever any
 * of them changed (a size, a state), every variable was written anew. Dash
 * 1.5's sealed engine charges each such write the size of the element's whole
 * tree, and the readings of a busy card came to thousands of units a minute,
 * enough to stop it. The variables' own getters, which read the theme with
 * getComputedStyle, ran as often.
 */
export function setVars(el: HTMLElement, vars: () => JSX.CSSProperties | Record<string, string | undefined>): void {
  let last: Record<string, string> = {};
  createRenderEffect(() => {
    const next: Record<string, string> = {};
    /* A CSS value is a string or a number; anything else is left out. */
    for (const [key, value] of Object.entries(vars()) as [string, unknown][]) {
      if (typeof value === "number") next[key] = String(value);
      else if (typeof value === "string" && value !== "") next[key] = value;
    }
    for (const key of Object.keys(last)) if (!(key in next)) el.style.removeProperty(key);
    for (const [key, value] of Object.entries(next)) if (value !== last[key]) el.style.setProperty(key, value);
    last = next;
  });
}
