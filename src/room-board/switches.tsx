import { Show, createMemo } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { openable, safeIcon } from "./util";
import { Keyed } from "./keyed";
import { Half } from "./half";

const isOn = (entity: EntityView) => entity.state === "on";

/** A plug looks like a plug; everything else is a switch. */
const iconOf = (entity: EntityView) => {
  if (entity.deviceClass === "outlet") return safeIcon(entity.icon, "mdi:power-plug");
  return safeIcon(entity.icon, isOn(entity) ? "mdi:toggle-switch" : "mdi:toggle-switch-off-outline");
};

/**
 * The room's switches.
 *
 * Everything Home Assistant calls a switch that is not a light: a plug behind
 * the sofa, a dehumidifier, the dock's dust extraction. They are the one kind
 * of thing on a board that is only ever on or off, so the card is a row of
 * them rather than a reading — and each one is live on the card, because a
 * switch you have to open a panel to flick is a light switch behind a door.
 */
export function SwitchCard(props: { switches: EntityView[]; onOpen: () => void }) {
  const { callService } = useService();
  const on = createMemo(() => props.switches.filter(isOn).length);

  const toggle = (event: Event, entity: EntityView) => {
    event.stopPropagation();
    void callService("switch", "toggle", {}, { entity_id: entity.id });
  };

  /* On first, so the card shows what is actually drawing power rather than
     whatever happens to sort first alphabetically. */
  const ordered = createMemo(() =>
    [...props.switches].sort((a, b) => Number(isOn(b)) - Number(isOn(a))),
  );

  /* One row. Three fitted only by shrinking each of them until the names were
     ellipses and the top one was half hidden behind the header — so the card
     shows the switch most worth having to hand and sends the rest to the
     overlay, where they have room to be read. */
  const shown = () => ordered().slice(0, 1);
  const rest = () => props.switches.length - shown().length;

  return (
    <article class="rb-card rb-card--switch" data-on={on() > 0} {...openable(props.onOpen, "Switches")}>
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">Switches</h3>
          <span class="rb-card-verdict rb-truncate">
            {on() ? `${on()} of ${props.switches.length} on` : "All off"}
            <Show when={rest() > 0}>{` · +${rest()} more`}</Show>
          </span>
        </div>
      </header>

      {/* Rows, not tiles: a switch's name is the whole point of it, and a
          square wide enough for an icon is never wide enough for "Sloping
          Roof Yoga". The track says which way it is set without being read. */}
      <div class="rb-sw-list">
        <Keyed each={shown()}>
          {(entity) => (
            <button
              class="rb-sw-mini"
              data-on={isOn(entity)}
              role="switch"
              aria-checked={isOn(entity)}
              title={entity.friendlyName ?? entity.id}
              onClick={(event) => toggle(event, entity)}
            >
              <Icon icon={iconOf(entity)} width="15" />
              <span class="rb-sw-mini-name rb-truncate">
                {entity.friendlyName ?? entity.id}
              </span>
              <span class="rb-switch-track rb-switch-track--sm" aria-hidden="true">
                <i />
              </span>
            </button>
          )}
        </Keyed>
      </div>
      <Half
        icon="mdi:toggle-switch-outline"
        name={props.switches.length === 1 ? (props.switches[0]!.friendlyName ?? "Switch") : "Switches"}
        status={on() ? `${on()} of ${props.switches.length} on` : "All off"}
        tone="#8b7cf6"
        lit={on() > 0}
        on={props.switches.length === 1 ? on() > 0 : undefined}
        onToggle={props.switches.length === 1 ? () => void callService("switch", "toggle", {}, { entity_id: props.switches[0]!.id }) : undefined}
        value={props.switches.length === 1 ? undefined : `${on()}/${props.switches.length}`}
      />
    </article>
  );
}

/** The overlay: every switch in the room, one row each. */
export function SwitchPanel(props: { switches: EntityView[] }) {
  const { callService } = useService();
  const on = () => props.switches.filter(isOn).length;

  const call = (service: string, ids: string[]) => {
    if (ids.length) void callService("switch", service, {}, { entity_id: ids });
  };

  return (
    <div class="rb-sw-panel">
      <header class="rb-lt-head">
        <span class="rb-lt-title">Switches</span>
        <span class="rb-lt-count">
          {on() ? `${on()} of ${props.switches.length} on` : "All off"}
        </span>
        <button
          class="rb-lt-all"
          data-on={on() > 0}
          onClick={() =>
            call(on() ? "turn_off" : "turn_on", props.switches.map((entity) => entity.id))
          }
        >
          <Icon icon="mdi:power" width="15" />
          <span>{on() ? "All off" : "All on"}</span>
        </button>
      </header>

      <div class="rb-sw-rows">
        <Keyed each={props.switches}>
          {(entity) => (
            <button
              class="rb-sw-row"
              role="switch"
              aria-checked={isOn(entity)}
              data-on={isOn(entity)}
              onClick={() => call("toggle", [entity.id])}
            >
              <span class="rb-sw-row-icon">
                <Icon icon={iconOf(entity)} width="18" />
              </span>

              <span class="rb-sw-row-meta">
                <span class="rb-sw-row-name rb-truncate">
                  {entity.friendlyName ?? entity.id}
                </span>
                <span class="rb-sw-row-state">{isOn(entity) ? "On" : "Off"}</span>
              </span>

              <span class="rb-switch-track" aria-hidden="true">
                <i />
              </span>
            </button>
          )}
        </Keyed>
      </div>
    </div>
  );
}
