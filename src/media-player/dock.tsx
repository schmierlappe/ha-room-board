import { Index, Show, createSignal } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { Keyed } from "./keyed";
import { Choice, SubSheet } from "./subsheet";
import { PlayingBars } from "./playing";
import type { Tab, TabItem } from "./tabs";
import { attr, isActiveState } from "./util";

/**
 * The popup's foot on a phone: a tab bar of icons over their names, at the
 * bottom of the sheet where a thumb already is. The speaker is the last tab,
 * named after itself, and opens the list of the others.
 */
/** What a speaker is doing, in the words under its name. */
export function describe(player: EntityView): string {
  const title = attr<string>(player, "media_title", "");
  const artist = attr<string>(player, "media_artist", "");
  if (isActiveState(player) && title) return artist ? `${title} · ${artist}` : title;
  const state = player.state ?? "";
  if (state === "off" || state === "standby") return "Off";
  if (state === "unavailable") return "Unavailable";
  if (state === "paused") return title ? `Paused · ${title}` : "Paused";
  return "Idle";
}

export function Dock(props: {
  player: () => EntityView | undefined;
  artwork: () => string | undefined;
  items: TabItem[];
  active: Tab;
  onPick: (tab: Tab) => void;
  players: () => EntityView[];
  activeId: string;
  onSelectPlayer: (id: string) => void;
}) {
  const [devicesOpen, setDevicesOpen] = createSignal(false);

  const name = () => props.player()?.friendlyName ?? "Speaker";

  return (
    <div class="mp-dock">
      {/* The speakers, as a sheet of their own over the popup — the same
          slide-in, back arrow and title as the room board's overlays, one
          level deeper. */}
      <Show when={devicesOpen() && props.players().length > 1}>
        <SubSheet title="Speakers" onBack={() => setDevicesOpen(false)}>
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
                  setDevicesOpen(false);
                }}
              />
            )}
          </Keyed>
        </SubSheet>
      </Show>

      <nav class="mp-dock-tabs">
        <Index each={props.items}>
          {(item) => (
            <button
              class="mp-dock-tab"
              data-active={props.active === item().id}
              onClick={() => {
                setDevicesOpen(false);
                props.onPick(item().id);
              }}
            >
              <Icon icon={item().icon} width="24" />
              <span>{item().label}</span>
            </button>
          )}
        </Index>

        <Show when={props.players().length > 1}>
          <button
            class="mp-dock-tab mp-dock-tab--device"
            data-active={devicesOpen()}
            aria-expanded={devicesOpen()}
            onClick={() => setDevicesOpen((open) => !open)}
          >
            <Icon icon="mdi:speaker" width="24" />
            <span class="mp-truncate">{name()}</span>
          </button>
        </Show>
      </nav>
    </div>
  );
}
