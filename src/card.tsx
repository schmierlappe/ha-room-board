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
/** How far the card may start from the status bar's edge and still be taken
    to sit right under it. */
const BLEED_SLACK_PX = 6;

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

/* Aurora: the board's own theme, dark and light following Home Assistant's
   setting. Soft glows of colour drift slowly behind frosted glass: the page
   colour stays opaque (the popups are painted with it), the card colour is
   see-through, so the panel and the tiles show the glow through a blur. The
   tokens are the ones the widgets read (src/theme.ts); `theme:
   home_assistant` leaves Home Assistant's own in charge. */
const AURORA_CSS = `
:host([data-theme="aurora"]) {
  --background: #0b0e1a;
  --foreground: #edf0fa;
  --card: rgba(22, 26, 44, 0.46);
  --popover: #151a2c;
  --popover-foreground: #edf0fa;
  --border: rgba(255, 255, 255, 0.1);
  --primary: #8b7bff;
  --primary-foreground: #ffffff;
  --rb-glow-1: rgba(124, 92, 255, 0.7);
  --rb-glow-2: rgba(28, 196, 186, 0.5);
  --rb-glow-3: rgba(255, 92, 170, 0.34);
}
:host([data-theme="aurora"][data-mode="light"]) {
  --background: #eef0f8;
  --foreground: #161a2b;
  --card: rgba(255, 255, 255, 0.52);
  --popover: #ffffff;
  --popover-foreground: #161a2b;
  --border: rgba(22, 26, 43, 0.1);
  --primary: #5b4dff;
  --primary-foreground: #ffffff;
  --rb-glow-1: rgba(150, 128, 255, 0.6);
  --rb-glow-2: rgba(86, 186, 255, 0.5);
  --rb-glow-3: rgba(255, 168, 136, 0.48);
}
:host([data-theme="aurora"]) .ha-rb-widget {
  isolation: isolate;
  background: var(--background);
}
:host([data-theme="aurora"]) .ha-rb-widget::before {
  content: "";
  position: absolute;
  inset: -25%;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(38% 42% at 18% 16%, var(--rb-glow-1), transparent 70%),
    radial-gradient(42% 46% at 84% 82%, var(--rb-glow-2), transparent 72%),
    radial-gradient(30% 34% at 72% 12%, var(--rb-glow-3), transparent 70%),
    radial-gradient(34% 30% at 30% 88%, var(--rb-glow-3), transparent 72%);
  filter: blur(18px);
  animation: rb-aurora 46s ease-in-out infinite alternate;
}
@keyframes rb-aurora {
  0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); }
  50% { transform: translate3d(4%, -3%, 0) rotate(8deg) scale(1.06); }
  100% { transform: translate3d(-3%, 4%, 0) rotate(-6deg) scale(1.02); }
}
@media (prefers-reduced-motion: reduce) {
  :host([data-theme="aurora"]) .ha-rb-widget::before { animation: none; }
}
:host([data-theme="aurora"]) .rb-panel {
  -webkit-backdrop-filter: blur(28px) saturate(150%);
  backdrop-filter: blur(28px) saturate(150%);
}
/* The bars at the foot float over the tiles in the page colour itself:
   inside the panel's own glass a second blur does not take, and any
   see-through let the tiles passing under them read through. */
:host([data-theme="aurora"]) :is(.rb-dock, .rb-act-bar) {
  background: var(--background);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  backdrop-filter: blur(24px) saturate(160%);
}
:host([data-theme="aurora"]) .rb-dock > .rb-act-bar { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
`;

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
  --card: var(--ha-card-background, var(--card-background-color, var(--background)));
  --border: var(--divider-color, rgba(127, 127, 127, 0.2));
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
${AURORA_CSS}
/* Reads the safe-area insets for the card (--rb-safe-* stand in for them in
   a test page). */
.ha-rb-safe {
  position: absolute; visibility: hidden; pointer-events: none; width: 0; height: 0;
  padding-top: var(--rb-safe-top, env(safe-area-inset-top, 0px));
  padding-bottom: var(--rb-safe-bottom, env(safe-area-inset-bottom, 0px));
}
/* Under the status bar: square corners, the picture behind the bar, and the
   clock and the panel's heading below it. */
:host([data-bleed]) .ha-rb-widget { border-radius: 0; }
:host([data-bleed]) .rb-scene { padding-top: calc(1rem + var(--rb-bleed-top, 0px)); }
/* The photo band on a phone gains the status bar's height rather than
   losing it from what is under the clock. */
:host([data-bleed]) .rb-board[data-narrow="true"]:has(.rb-scene-photo) {
  grid-template-rows: calc(clamp(11rem, 28%, 16rem) + var(--rb-bleed-top, 0px)) 1fr;
}
:host([data-bleed]) .rb-board:not([data-narrow="true"]) .rb-panel { padding-top: calc(var(--rb-pad) + var(--rb-bleed-top, 0px)); }
`;

type Config = Record<string, unknown> & { type?: string; storage_key?: string; height?: string; theme?: string };

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
    /* Aurora unless Home Assistant's own theme is asked for. */
    const theme = config.theme === "home_assistant" || config.theme === "home-assistant" ? "home_assistant" : "aurora";
    this.setAttribute("data-theme", theme);
  }

  set hass(next: Hass) {
    /* Before the state: the board reads the theme's colours when the mode
       changes, and they must be the new mode's by then. */
    this.setAttribute("data-mode", next.themes?.darkMode === false ? "light" : "dark");
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
    const { top: safeTop, bottom: safeBottom } = this.safeArea();
    /* Where the card would start without the bleed below. */
    const natural = Math.max(0, this.getBoundingClientRect().top + this.bleedTop);
    /* Right under the status bar, with nothing of Home Assistant's above it
       (a kiosk view on a phone): the card takes the status bar's strip as
       well, the picture running up behind it and the clock below it. */
    const bleed = safeTop > 0 && Math.abs(natural - safeTop) <= BLEED_SLACK_PX ? natural : 0;
    if (bleed !== this.bleedTop) {
      this.bleedTop = bleed;
      this.style.marginTop = bleed ? `${-bleed}px` : "";
      this.toggleAttribute("data-bleed", bleed > 0);
      this.style.setProperty("--rb-bleed-top", `${bleed}px`);
    }
    /* Down to the screen's edge where there is a home indicator to sit
       above (the bar keeps its words clear of it), a little short of it
       otherwise. */
    const gap = bleed > 0 || safeBottom > 0 ? 0 : BOTTOM_GAP_PX;
    this.style.marginBottom = safeBottom > 0 ? `${-safeBottom}px` : "";
    this.style.setProperty("--room-board-fit", `${Math.max(420, Math.floor(viewport - (natural - bleed) - gap))}px`);
  };
  private bleedTop = 0;

  /** The screen's safe-area insets (the status bar, the home indicator), as
      the page is given them. */
  private safeArea(): { top: number; bottom: number } {
    const root = this.shadowRoot;
    if (!root) return { top: 0, bottom: 0 };
    let probe = root.querySelector<HTMLElement>(".ha-rb-safe");
    if (!probe) {
      probe = document.createElement("div");
      probe.className = "ha-rb-safe";
      root.append(probe);
    }
    const style = getComputedStyle(probe);
    return { top: Number.parseFloat(style.paddingTop) || 0, bottom: Number.parseFloat(style.paddingBottom) || 0 };
  }
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
