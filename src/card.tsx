/**
 * Room Board as a Home Assistant card: `custom:room-board-card`.
 *
 * Home Assistant gives the card its YAML (setConfig) and a new `hass` object on
 * every change. The board itself is the GlassHome widget's code, unchanged;
 * src/ha/sdk.tsx gives it the SDK it was written for, on `hass`.
 *
 * What the board changes by itself — the cards hidden in a room, their order
 * and sizes — is kept per Home Assistant user (frontend user data), so it
 * follows you from the desktop to the tablet and the phone. Everything else
 * is the card's YAML.
 */
/* First: the base styles the widgets were drawn with (Tailwind's preflight). */
import "./ha/preflight.css";
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import { createSignal, ErrorBoundary, type JSX } from "solid-js";
import { render } from "solid-js/web";
import widget from "./room-board/index";
import { applyHass, hass, hasHass, type Hass } from "./ha/store";
import { WidgetContext } from "./ha/sdk";
import { cardCss } from "./ha/css";
import { setThemeHost } from "./theme";

const CARD_VERSION = "0.1.0";

/** Room left under the board at the bottom of the screen. */
const BOTTOM_GAP_PX = 8;

/** The board's own changes to its config, kept per user. */
const USER_KEYS = ["hidden", "layout"] as const;

/* The widgets' typeface, Geist (SIL Open Font License 1.1). A font face has
   to be declared on the page: one in a shadow root is not used. */
function addFont(): void {
  if (document.getElementById("ha-room-board-font")) return;
  const style = document.createElement("style");
  style.id = "ha-room-board-font";
  style.textContent = `@font-face{font-family:"Geist Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(${geist}) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;
  document.head.append(style);
}

/* Home Assistant's theme, in the tokens the widgets read (src/theme.ts). The
   card is the theme root, so getComputedStyle on it resolves these. */
const HOST_CSS = `
:host {
  display: block;
  --default-font-family: "Geist Variable", var(--paper-font-body1_-_font-family, Roboto), system-ui, sans-serif;
  height: var(--room-board-height, var(--room-board-fit, calc(100vh - var(--header-height, 56px) - 16px)));
  min-height: 420px;
  --background: var(--card-background-color, var(--primary-background-color, #1c1c1c));
  --foreground: var(--primary-text-color, #e1e1e1);
  --popover: var(--card-background-color, var(--primary-background-color, #1c1c1c));
  --popover-foreground: var(--primary-text-color, #e1e1e1);
  --primary: var(--primary-color, #03a9f4);
  --primary-foreground: var(--text-primary-color, #fff);
}
.ha-rb-widget, .ha-rb-content { position: relative; width: 100%; height: 100%; box-sizing: border-box; }
.ha-rb-widget {
  border-radius: var(--ha-card-border-radius, 12px);
  overflow: hidden;
  color: var(--primary-text-color);
}
.ha-rb-empty {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--secondary-text-color); text-align: center;
}
.ha-rb-error { padding: 16px; color: var(--error-color, #db4437); }
`;

type Config = Record<string, unknown> & { type?: string; storage_key?: string; height?: string };

class RoomBoardCard extends HTMLElement {
  private readonly configSignal = createSignal<Config>({});
  private readonly overridesSignal = createSignal<Record<string, unknown>>({});
  private dispose?: () => void;
  private overridesLoaded = false;

  /** Where this card's own changes are kept: one per board, by its key. */
  private get storageKey(): string {
    const key = this.configSignal[0]().storage_key;
    return `ha-room-board${typeof key === "string" && key ? `-${key}` : ""}`;
  }

  setConfig(config: Config): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    this.configSignal[1]({ ...config });
    if (typeof config.height === "string") this.style.setProperty("--room-board-height", config.height);
    else this.style.removeProperty("--room-board-height");
  }

  set hass(next: Hass) {
    applyHass(next);
    if (!this.overridesLoaded) {
      this.overridesLoaded = true;
      void this.loadOverrides();
    }
    this.mount();
  }

  /* The board fills the screen from where it starts down to the bottom:
     measured, as it may sit under Home Assistant's header or, in a kiosk
     view, at the very top. An explicit `height` in the config wins. */
  private readonly fit = () => {
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const top = Math.max(0, this.getBoundingClientRect().top);
    this.style.setProperty("--room-board-fit", `${Math.max(420, Math.floor(viewport - top - BOTTOM_GAP_PX))}px`);
  };
  private fitTimer?: ReturnType<typeof setTimeout>;

  private startFitting(): void {
    window.addEventListener("resize", this.fit);
    window.visualViewport?.addEventListener("resize", this.fit);
    requestAnimationFrame(this.fit);
    /* Again once Home Assistant's own layout (header, sidebar) has settled. */
    this.fitTimer = setTimeout(this.fit, 500);
  }

  private stopFitting(): void {
    window.removeEventListener("resize", this.fit);
    window.visualViewport?.removeEventListener("resize", this.fit);
    clearTimeout(this.fitTimer);
  }

  connectedCallback(): void {
    this.startFitting();
    if (hasHass()) this.mount();
  }

  disconnectedCallback(): void {
    this.stopFitting();
    this.dispose?.();
    this.dispose = undefined;
  }

  getCardSize(): number {
    return 12;
  }

  getGridOptions() {
    return { columns: "full", rows: 8, min_rows: 4 };
  }

  static getStubConfig() {
    return { rooms: [] };
  }

  private async loadOverrides(): Promise<void> {
    try {
      const reply = await hass().connection.sendMessagePromise<{ value?: Record<string, unknown> | null }>({
        type: "frontend/get_user_data",
        key: this.storageKey,
      });
      if (reply?.value) this.overridesSignal[1](reply.value);
    } catch (error) {
      console.warn("room-board-card: could not read the saved layout", error);
    }
  }

  private saveOverrides(config: Record<string, unknown>): void {
    const value: Record<string, unknown> = {};
    for (const key of USER_KEYS) if (key in config) value[key] = config[key];
    this.overridesSignal[1](value);
    void hass()
      .connection.sendMessagePromise({ type: "frontend/set_user_data", key: this.storageKey, value })
      .catch((error) => console.warn("room-board-card: could not save the layout", error));
  }

  private mount(): void {
    if (this.dispose || !this.isConnected) return;
    addFont();
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = HOST_CSS + cardCss();
    const holder = document.createElement("div");
    holder.style.height = "100%";
    root.append(style, holder);
    setThemeHost(this);

    const [config] = this.configSignal;
    const [overrides] = this.overridesSignal;
    const parsed = () => {
      const merged = { ...config(), ...overrides() };
      const result = widget.configSchema.safeParse(merged);
      if (!result.success) console.warn("room-board-card: config", result.error);
      return (result.success ? result.data : merged) as never;
    };
    const Board = widget.component;
    const context = {
      updateConfig: (next: Record<string, unknown>) => this.saveOverrides(next),
      get storageKey() {
        return storageKey();
      },
    };
    const storageKey = () => this.storageKey;

    this.dispose = render(
      (): JSX.Element => (
        <WidgetContext.Provider value={context}>
          <ErrorBoundary fallback={(error) => <div class="ha-rb-error">Room Board: {String(error)}</div>}>
            <Board config={parsed()} />
          </ErrorBoundary>
        </WidgetContext.Provider>
      ),
      holder,
    );
  }
}

if (!customElements.get("room-board-card")) customElements.define("room-board-card", RoomBoardCard);

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean; documentationURL?: string }[];
  }
}

window.customCards ??= [];
window.customCards.push({
  type: "room-board-card",
  name: "Room Board",
  description: "A room at a glance: its photo and clock, and everything it measures and controls, for desktop, tablet and phone.",
  preview: false,
  documentationURL: "https://github.com/schmierlappe/ha-room-board",
});

console.info(
  `%c ROOM-BOARD-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#3a7bd5;font-weight:700;border-radius:3px 0 0 3px",
  "color:#3a7bd5;background:#fff;font-weight:700;border-radius:0 3px 3px 0",
);
