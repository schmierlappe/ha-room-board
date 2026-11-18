import { setVars } from "../theme";
import { Index, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { NowPlaying } from "./controls";
import { SearchPanel } from "./search";
import { RoomsPanel } from "./rooms";
import { BrowsePanel } from "./browse";
import { FavouritesPanel } from "./favourites";
import { LibraryPanel } from "./library";
import { DiscoverPanel } from "./discover";
import { RemotePanel, type RemoteProfile } from "./remote";
import { profilesFor, tabsFor, type Tab } from "./tabs";
import { FEATURE, isMusicAssistant, supports } from "./features";
import { PlayingBars } from "./playing";
import { haptic, isActiveState, themeVars } from "./util";
import { Keyed } from "./keyed";
import { Dock, describe } from "./dock";
import { QueueSheet } from "./queue";
import { Choice } from "./subsheet";

/**
 * Shown inside the widget, never in a dashboard popup: over the media
 * player's own tile (its .mp-sheet) and in room-board's sheet. A popup is drawn
 * outside the widget, where the sealed engine gives it none of the widget's
 * styles; inside it, the widget's stylesheet reaches the panels.
 */
export function Panels(props: {
  player: () => EntityView | undefined;
  rooms: () => EntityView[];
  artwork: () => string | undefined;
  players: () => EntityView[];
  activeId: string;
  onSelectPlayer: (id: string) => void;
  musicAssistant: boolean;
  lookupArtwork: boolean;
  configEntryId: string;
  artworkProxy: string;
  haBaseUrl: string;
  remoteProfiles: RemoteProfile[];
  remoteHoldRepeats: boolean;
  /** The room board's remote layout rather than the media player's own. */
  boardRemote?: boolean;
  /** Inside the room board's overlay, not the widget's own popup: the two
   *  are laid out separately — the board's tabs at the foot, its side panels
   *  from the right, its lyrics — and the popup keeps its own. */
  board?: boolean;
  /** Panel to open on, set by the tile's shortcut row. */
  initialTab?: Tab;
}) {
  /* Opened from a shortcut on the tile, the popup lands on that panel rather
     than on Now. The signal is seeded once and then followed, since the popup
     stays mounted between openings on some hosts. */
  const [tab, setTab] = createSignal<Tab>(props.initialTab ?? "now");
  createEffect(() => {
    const wanted = props.initialTab;
    if (wanted) setTab(wanted);
  });

  /* The widget's own popup on a desktop has the room for the queue as a tab
     of its own, beside Now; the board and the phone open it from a button. */
  const queueTab = () =>
    !props.board && !phone() && props.musicAssistant && isMusicAssistant(props.player());

  const items = () => {
    const list = tabsFor(props.player(), {
      musicAssistant: props.musicAssistant,
      remoteProfiles: props.remoteProfiles,
      activeId: props.activeId,
      players: props.players(),
    });
    if (queueTab()) list.splice(1, 0, { id: "queue", label: "Queue", icon: "mdi:playlist-music" });
    return list;
  };

  const remoteProfiles = () => profilesFor(props.remoteProfiles, props.activeId);

  // Keep the active tab valid when switching to a less capable player.
  const [deviceOpen, setDeviceOpen] = createSignal(false);

  /* Favourites through the media browser where the player has one; players
     found to have no Favorites folder go back to their source list. */
  /* What the player can do, not whether it is answering this second: a Sonos
     reports "unavailable" for a moment while it regroups, and switching the
     tab to the fallback list and back rebuilt the browser each time. The
     capability bits are remembered for the session (see supports). */
  const browsable = () =>
    supports(props.player(), FEATURE.BROWSE_MEDIA) && supports(props.player(), FEATURE.PLAY_MEDIA);
  const [noFolder, setNoFolder] = createSignal<string[]>([]);
  const noteNoFolder = () => {
    const id = props.player()?.id;
    if (id) setNoFolder((was) => [...was, id]);
  };

  const activePlayer = () => props.players().find((p) => p.id === props.activeId);
  const activeName = () => activePlayer()?.friendlyName ?? "Select a player";
  const activePlaying = () => isActiveState(activePlayer());

  const activeTab = (): Tab => {
    const ids = items().map((i) => i.id);
    return ids.includes(tab()) ? tab() : "now";
  };

  // Delegated, so every control in the popup confirms itself — including the
  // ones inside Browse, Search and Discover, and any added later. The remote's
  // D-pad calls haptic() directly, with its own stronger pulse for select.
  /**
   * How much height the panel actually has.
   *
   * The container queries below run on width alone, which is all
   * `container-type: inline-size` can offer — and width is the wrong question
   * here. The room board opens this inside its own sheet, so on a phone the
   * panel is narrow *and* short, and the narrow rules sized the artwork
   * against `dvh`: a measure of the screen, which the sheet is only a part
   * of. The cover came out taller than the box holding it and, being centred
   * in a box told not to clip, spilled over the tab row above it.
   *
   * So the height is measured. Below this, Now Playing goes back to being a
   * row — a small cover beside its title — instead of a full-height poster.
   */
  const [short, setShort] = createSignal(false);
  /* Shorter again. The room board's sheet on a phone leaves this panel about
     255px, and at that height a cover stacked above its title cannot be
     bigger than a stamp whatever the rules say — the rows under it are all
     fixed. So below this it goes beside the words instead, where its size is
     the height of two lines rather than what is left over. */
  const [tiny, setTiny] = createSignal(false);
  /* A phone: the tabs and the speaker picker go into the dock at the foot. */
  const [phone, setPhone] = createSignal(false);
  const [sheetsClosed, setSheetsClosed] = createSignal(0);
  /* Wide enough to keep Now in view while another panel is open beside it. */
  const [wide, setWide] = createSignal(false);

  /* On a wide popup, Discover, Search, Favourites and the grouping open as a
     panel from the right over Now — the same as the queue — rather than
     replacing it: what is playing stays in view while something else is
     found or another room joined. */
  const DRAWER_TABS = new Set<Tab>(["discover", "search", "rooms", "favourites"]);
  const [drawer, setDrawer] = createSignal<Tab | undefined>();
  const drawerOn = (): Tab | undefined => {
    const open = drawer();
    if (!open || !props.board || !wide() || phone()) return undefined;
    return items().some((item) => item.id === open) ? open : undefined;
  };
  const drawerTitle = () => items().find((item) => item.id === drawerOn())?.label ?? "";

  /* The speakers, on a wide popup, in the same panel from the right rather
     than a list dropping from the button. */
  const [speakers, setSpeakers] = createSignal(false);
  /* Board only: the popup keeps its list from the device button. */
  const boardWide = () => !!props.board && wide() && !phone();
  const speakersOn = () => speakers() && boardWide() && props.players().length > 1;

  const pickTab = (id: Tab) => {
    if (props.board && wide() && !phone() && DRAWER_TABS.has(id)) {
      setSpeakers(false);
      setTab("now");
      setDrawer(drawer() === id ? undefined : id);
      return;
    }
    setDrawer(undefined);
    setTab(id);
  };

  let root: HTMLDivElement | undefined;

  onMount(() => {
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box?.height) return;
      /* Measured on the whole panel, tab row included — so the thresholds
         carry that row's own height. Now Playing gets roughly fifty pixels
         less than these numbers: the nav and the gap under it. The first
         reading of 300 was against the inner view and never fired, which is
         why a sheet with 255px to spend kept drawing the tall layout.
         Width matters as much as height. A tablet sheet is short and wide,
         and keying the phone layout on height alone dressed a two-column
         desktop view in phone styling — flat buttons, no device pill, a
         transport spread across a column it did not own. */
      const narrowEnough = box.width < 640;
      setShort(narrowEnough && box.height < 470);
      setTiny(narrowEnough && box.height < 360);
      setPhone(box.width < 480);
      setWide(box.width >= 800);
    });
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  /* The phone dock's height, for the sheets (queue, speakers) to stop above
     it: in the popup they cover the panel but leave its tab bar in view. */
  createEffect(() => {
    if (!phone() || !root || typeof ResizeObserver === "undefined") return;
    const panel = root;
    const frame = requestAnimationFrame(() => {
      const dock = panel.querySelector<HTMLElement>(".mp-dock");
      if (!dock) return;
      const observer = new ResizeObserver(() =>
        panel.style.setProperty("--mp-dock-h", `${dock.offsetHeight}px`),
      );
      observer.observe(dock);
      onCleanup(() => observer.disconnect());
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const content = () => (
    <>
      <Show when={activeTab() === "now"}>
        {/* The source list moves to Remote when a profile claims this player,
            so Now does not carry a second copy of it. */}
        <NowPlaying
          player={props.player}
          artwork={props.artwork}
          showSource={!remoteProfiles().length}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
          compact={short()}
          phone={phone()}
          board={props.board}
          queueTab={queueTab()}
          closeSheets={sheetsClosed()}
        />
      </Show>
      <Show when={activeTab() === "queue"}>
        <QueueSheet
          player={props.player}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
          onClose={() => setTab("now")}
          inSheet
        />
      </Show>
      <Show when={activeTab() === "discover"}>
        <DiscoverPanel
          player={props.player}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
          configEntryId={props.configEntryId}
          lookupArtwork={props.lookupArtwork}
        />
      </Show>
      <Show when={activeTab() === "browse"}>
        <BrowsePanel
          player={props.player}
          configEntryId={props.configEntryId}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
        />
      </Show>
      <Show when={activeTab() === "library"}>
        <LibraryPanel
          player={props.player}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
        />
      </Show>
      {/* The speaker's own Favorites folder, through the media browser, where
          it can be browsed; the source list, as before, where it cannot or
          where the browser turns out to have no such folder. */}
      <Show when={activeTab() === "favourites"}>
        <Show
          when={browsable() && !noFolder().includes(props.player()?.id ?? "")}
          fallback={
            <FavouritesPanel
              player={props.player}
              lookupArtwork={props.lookupArtwork}
              artworkProxy={props.artworkProxy}
              haBaseUrl={props.haBaseUrl}
              onPlayed={() => setTab("now")}
            />
          }
        >
          <LibraryPanel
            player={props.player}
            artworkProxy={props.artworkProxy}
            haBaseUrl={props.haBaseUrl}
            startInFavourites
            onPlayed={() => setTab("now")}
            onNoFavourites={noteNoFolder}
          />
        </Show>
      </Show>
      <Show when={activeTab() === "search"}>
        <SearchPanel
          player={props.player}
          configEntryId={props.configEntryId}
          artworkProxy={props.artworkProxy}
          haBaseUrl={props.haBaseUrl}
        />
      </Show>
      <Show when={activeTab() === "rooms"}>
        <RoomsPanel player={props.player} rooms={props.rooms} />
      </Show>
      <Show when={activeTab() === "remote"}>
        <RemotePanel
          profiles={remoteProfiles()}
          holdRepeats={props.remoteHoldRepeats}
          player={props.player}
          board={props.boardRemote}
        />
      </Show>

      {/* Now only: picking a device belongs with what is playing, and on
          Browse or Search it competed with a scrolling grid. Pinned to the
          bottom of the panel, so it sits in the same place for every player
          regardless of how tall that player's Now panel is. */}
    </>
  );

  return (
    <div
      ref={(el) => {
              root = el;
              setVars(el, () => themeVars());
            }}
      class="mp-panel"
      data-short={short()}
      data-tiny={tiny()}
      data-phone={phone()}
      data-board={!!props.board}
      onPointerDown={(e) => {
        const el = e.target as Element | null;

        // A press anywhere outside the device bar dismisses its list, so the
        // popup does not need a full-screen backdrop to catch it.
        if (deviceOpen() && !el?.closest?.(".mp-nav")) setDeviceOpen(false);

        if (e.pointerType !== "touch") return;
        if (el?.closest?.('button, [role="switch"], input[type="range"], a[href]')) haptic(8);
      }}
    >


      {/* On a phone the tabs scroll inside a body of their own, and the dock
          is simply the panel's last row: pinned by the layout, not by
          position: sticky, which held only as long as the right ancestor
          happened to be the one scrolling. Elsewhere the tabs sit directly
          in the panel, where the wide layouts' selectors expect them. */}
      <Show when={phone()} fallback={content()}>
        <div class="mp-body">{content()}</div>
      </Show>

      <Show when={phone()}>
        <Dock
          player={props.player}
          artwork={props.artwork}
          items={items()}
          active={activeTab()}
          onPick={(id) => {
            /* A tab tapped while a sheet is open over Now leaves the sheet,
               even when the tab is Now itself. */
            setSheetsClosed((n) => n + 1);
            setTab(id);
          }}
          players={props.players}
          activeId={props.activeId}
          onSelectPlayer={props.onSelectPlayer}
        />
      </Show>

      {/* Wide: the speakers, from the right — each a tile with what it is
          playing, the one in use marked. */}
      <Show when={speakersOn()}>
        <aside class="mp-snow-queue" aria-label="Speakers">
          <header class="mp-snow-queue-head">
            <h3>Speakers</h3>
            <button class="mp-pnow-btn" aria-label="Close speakers" onClick={() => setSpeakers(false)}>
              <Icon icon="mdi:close" width="18" />
            </button>
          </header>
          <div class="mp-drawer-body mp-speaker-list">
            <Keyed each={props.players()}>
              {(player) => (
                <Choice
                  icon={
                    <Show when={isActiveState(player)} fallback={<Icon icon="mdi:speaker" width="20" />}>
                      <PlayingBars size="1rem" />
                    </Show>
                  }
                  name={player.friendlyName ?? player.id}
                  sub={describe(player)}
                  active={props.activeId === player.id}
                  lit={isActiveState(player)}
                  onClick={() => {
                    props.onSelectPlayer(player.id);
                    setSpeakers(false);
                  }}
                />
              )}
            </Keyed>
          </div>
        </aside>
      </Show>

      {/* Wide: Discover, Search or the grouping, from the right over Now. */}
      <Show when={drawerOn()}>
        {(open) => (
          <aside class="mp-snow-queue mp-drawer" aria-label={drawerTitle()}>
            <header class="mp-snow-queue-head">
              <h3>{drawerTitle()}</h3>
              <button
                class="mp-pnow-btn"
                aria-label={`Close ${drawerTitle()}`}
                onClick={() => setDrawer(undefined)}
              >
                <Icon icon="mdi:close" width="18" />
              </button>
            </header>
            <div class="mp-drawer-body">
              <Show when={open() === "discover"}>
                <DiscoverPanel
                  player={props.player}
                  artworkProxy={props.artworkProxy}
                  haBaseUrl={props.haBaseUrl}
                  configEntryId={props.configEntryId}
                  lookupArtwork={props.lookupArtwork}
                />
              </Show>
              <Show when={open() === "search"}>
                <SearchPanel
                  player={props.player}
                  configEntryId={props.configEntryId}
                  artworkProxy={props.artworkProxy}
                  haBaseUrl={props.haBaseUrl}
                />
              </Show>
              <Show when={open() === "rooms"}>
                <RoomsPanel player={props.player} rooms={props.rooms} />
              </Show>
              {/* Starting a favourite closes the panel: Now is underneath. */}
              <Show when={open() === "favourites"}>
                <Show
                  when={browsable() && !noFolder().includes(props.player()?.id ?? "")}
                  fallback={
                    <FavouritesPanel
                      player={props.player}
                      lookupArtwork={props.lookupArtwork}
                      artworkProxy={props.artworkProxy}
                      haBaseUrl={props.haBaseUrl}
                      onPlayed={() => setDrawer(undefined)}
                    />
                  }
                >
                  <LibraryPanel
                    player={props.player}
                    artworkProxy={props.artworkProxy}
                    haBaseUrl={props.haBaseUrl}
                    startInFavourites
                    onPlayed={() => setDrawer(undefined)}
                    onNoFavourites={noteNoFolder}
                  />
                </Show>
              </Show>
            </div>
          </aside>
        )}
      </Show>

      {/* The tabs at the foot on a tablet and a desktop, where the thumb and
          the eye finish, with the speaker picker beside them on Now. */}
      <Show when={!phone()}>
        <div class="mp-foot">
          <nav class="mp-nav">
            {/* By position: the list is worked out afresh on every update from
                the player, and a map over it rebuilt every button — icons
                reloading — several times a second while something played. */}
            <Index each={items()}>
              {(item) => (
                <button
                  class={`mp-tab--${item().id}`}
                  data-active={drawerOn() ? drawerOn() === item().id : activeTab() === item().id}
                  onClick={() => pickTab(item().id)}
                >
                  <Icon icon={item().icon} width="16" />
                  <span>{item().label}</span>
                </button>
              )}
            </Index>

            {/* The speaker as the bar's last item, after a hairline: one bar
                for where to look and what to play it on. Wide, it opens the
                speakers from the right; narrower, a list over the bar. */}
            <Show when={activeTab() === "now" && props.players().length > 1}>
              <span class="mp-nav-sep" aria-hidden="true" />
              <button
                class="mp-nav-speaker"
                data-active={speakersOn() || deviceOpen()}
                aria-expanded={speakersOn() || deviceOpen()}
                aria-label={`Speaker: ${activeName()}`}
                onClick={() => {
                  setDrawer(undefined);
                  if (boardWide()) setSpeakers((open) => !open);
                  else setDeviceOpen((open) => !open);
                }}
              >
                <Show when={activePlaying()} fallback={<Icon icon="mdi:speaker" width="16" />}>
                  <PlayingBars size="0.85rem" />
                </Show>
                <span class="mp-truncate">{activeName()}</span>
              </button>
            </Show>

            <Show when={deviceOpen()}>
              {/* Opens upward — there is nothing below it. */}
              <div class="mp-device-list">
                {/* Keyed on the player: every position tick hands over new
                    entities, and rows keyed on those were rebuilt — icons,
                    meters and all — several times a second. */}
                <Keyed each={props.players()}>
                  {(p) => (
                    <button
                      class="mp-picker-item"
                      data-active={props.activeId === p.id}
                      onClick={() => {
                        props.onSelectPlayer(p.id);
                        setDeviceOpen(false);
                      }}
                    >
                      <Show
                        when={isActiveState(p)}
                        fallback={<Icon icon="mdi:speaker" width="15" style={{ opacity: 0.5 }} />}
                      >
                        <PlayingBars size="0.85rem" />
                      </Show>
                      <span class="mp-truncate">{p.friendlyName}</span>
                    </button>
                  )}
                </Keyed>
              </div>
            </Show>
          </nav>
        </div>
      </Show>
    </div>
  );
}
