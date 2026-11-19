/**
 * A way back to Home Assistant from a board in kiosk mode.
 *
 * Home Assistant opens its sidebar on `hass-toggle-menu`. kiosk-mode hides the
 * sidebar outright, so that alone does nothing there; if the sidebar is still
 * not on screen a moment later, the page is opened again with kiosk-mode's
 * own way out, `?disable_km`, which brings the header and the sidebar back
 * until the next reload without it.
 */

const sidebar = (): HTMLElement | null =>
  (document
    .querySelector("home-assistant")
    ?.shadowRoot?.querySelector("home-assistant-main")
    ?.shadowRoot?.querySelector("ha-sidebar") as HTMLElement | null) ?? null;

/** Whether Home Assistant's sidebar is on screen now. */
export function sidebarShown(): boolean {
  const el = sidebar();
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const box = el.getBoundingClientRect();
  return box.width > 8 && box.right > 8 && box.left < innerWidth;
}

export function openHomeAssistant(from: HTMLElement): void {
  from.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true, detail: { open: true } }));
  setTimeout(() => {
    if (sidebarShown()) return;
    const url = new URL(location.href);
    url.searchParams.set("disable_km", "");
    location.href = url.toString();
  }, 450);
}
