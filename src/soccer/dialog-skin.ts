import { themeRoot as readThemeRoot } from "../theme";

/**
 * Paint the popup with the dashboard's own page colour, and take its chrome
 * off.
 *
 * The ui package draws a dialog as a frosted glass panel: a translucent
 * popover tint, a backdrop blur, a 1px rim and a lift shadow. That reads well
 * for a small floating box, but these popups are full-bleed — on a phone the
 * panel runs the whole height, so its top edge sits behind the status bar and
 * the tint there looks like a second app pasted over the dashboard, while the
 * rim draws a hairline down each side of the screen with nothing to enclose.
 *
 * It has to be set from script rather than in the stylesheet: the dialog
 * portals to document.body, outside the .dark/.light wrapper where the theme
 * declares its tokens, so var(--background) resolves to nothing there. The
 * value is read here, where the wrapper is still reachable, and written onto
 * the dialog element as paint rather than as a variable — a var() the dialog
 * cannot resolve makes the whole declaration invalid and the panel comes out
 * transparent.
 */
export function skinDialog(root: HTMLElement | undefined): void {
  if (!root || typeof document === "undefined") return;

  /* Tried again on the next frame if the dialog is not there yet.
   *
   * onMount runs once a component's own nodes exist, which is not the same as
   * them being in the document: a panel created inside a portal that is still
   * being assembled has no ancestors to walk, so closest() finds nothing and
   * the popup keeps its glass chrome. One retry is enough — by the next frame
   * the portal has been inserted — and it costs nothing when the first attempt
   * already worked. */
  if (!paint(root) && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => paint(root));
  }
}

function paint(root: HTMLElement): boolean {
  const dialog = root.closest('[role="dialog"][aria-modal="true"]') as HTMLElement | null;
  if (!dialog) return false;

  const themeRoot = readThemeRoot();
  const background = pageBackground(themeRoot);
  if (!background) return false;

  dialog.style.setProperty("--gh-dialog-bg", background);
  dialog.style.setProperty("background", background, "important");
  dialog.style.setProperty("backdrop-filter", "none", "important");
  dialog.style.setProperty("-webkit-backdrop-filter", "none", "important");
  dialog.style.setProperty("border", "0", "important");
  dialog.style.setProperty("box-shadow", "none", "important");
  return true;
}

/**
 * The colour the dashboard paints its page with. The token is the honest
 * answer — it is what the theme's own Background setting writes — but it is
 * only readable where it is declared, so fall back to the colour actually
 * painted on the theme root, then on body and html.
 */
function pageBackground(themeRoot: Element): string {
  const token = getComputedStyle(themeRoot).getPropertyValue("--background").trim();
  if (token) return token;

  const transparent = /^(transparent|rgba?\([^)]*,\s*0(\.0+)?\s*\))$/;
  for (const el of [themeRoot, document.body, document.documentElement]) {
    if (!el) continue;
    const painted = getComputedStyle(el).backgroundColor?.trim();
    if (painted && !transparent.test(painted)) return painted;
  }

  const dark = themeRoot.classList?.contains("dark") ?? true;
  return dark ? "#0d100e" : "#f6f7f9";
}
