import { For, Show } from "solid-js";
import { PlayingBars } from "./playing";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { FEATURE, isMusicAssistant, supports } from "./features";
import { attr, isAlive, isActiveState } from "./util";

/**
 * Grouping maps onto two HA services:
 *   media_player.join   → target = master, data.group_members = players to add
 *   media_player.unjoin → target = the player that should leave
 * `group_members` on the master lists the current group, master first.
 */
export function RoomsPanel(props: {
  player: () => EntityView | undefined;
  rooms: () => EntityView[];
}) {
  const { callService } = useService();

  const masterId = () => props.player()?.id;
  const members = () => attr<string[]>(props.player(), "group_members", []);
  const isJoined = (id: string) => members().includes(id) && id !== masterId();
  /**
   * Only players that can actually join the selected one.
   *
   * Home Assistant doesn't expose an entity's integration, so this uses the two
   * signals it does give us: the GROUPING feature bit (which a Fire TV, Vu+ or
   * Sky box lacks), and whether both sides are Music Assistant players — a
   * group is only ever formed within one integration.
   */
  const compatible = (candidate: EntityView) => {
    if (!supports(candidate, FEATURE.GROUPING)) return false;
    return isMusicAssistant(props.player()) === isMusicAssistant(candidate);
  };

  const candidates = () =>
    props.rooms().filter((e) => e.id !== masterId() && compatible(e));

  const excluded = () =>
    props.rooms().filter((e) => e.id !== masterId() && !compatible(e)).length;

  const join = (ids: string[]) => {
    const master = masterId();
    if (master && ids.length)
      void callService("media_player", "join", { group_members: ids }, { entity_id: master });
  };

  const unjoin = (id: string) => void callService("media_player", "unjoin", {}, { entity_id: id });

  const setVolume = (id: string, pct: number) =>
    void callService("media_player", "volume_set", { volume_level: pct / 100 }, { entity_id: id });

  return (
    <div class="mp-panel">
      <div class="mp-spread">
        <span class="mp-room-state">
          {members().length > 1 ? `Grouped with ${members().length - 1}` : "Playing alone"}
        </span>
        <div class="mp-right">
          <button
            class="mp-pill"
            onClick={() => join(candidates().filter(isAlive).map((e) => e.id))}
          >
            Join all
          </button>
          <button
            class="mp-pill"
            disabled={members().length < 2}
            onClick={() => members().forEach(unjoin)}
          >
            Ungroup
          </button>
        </div>
      </div>

      <Show when={props.player()}>
        <RoomRow
          entity={props.player()!}
          joined
          master
          onToggle={() => unjoin(masterId()!)}
          onVolume={(v) => setVolume(masterId()!, v)}
        />
      </Show>

      <For
        each={candidates()}
        fallback={
          <div class="mp-empty">
            {excluded()
              ? "None of your other players can group with this one."
              : "Add more players in settings to group them."}
          </div>
        }
      >
        {(entity) => (
          <RoomRow
            entity={entity}
            joined={isJoined(entity.id)}
            onToggle={() => (isJoined(entity.id) ? unjoin(entity.id) : join([entity.id]))}
            onVolume={(v) => setVolume(entity.id, v)}
          />
        )}
      </For>

      <Show when={excluded() && candidates().length}>
        <div class="mp-hint">
          {excluded()} other player{excluded() > 1 ? "s" : ""} can't be grouped with this one.
        </div>
      </Show>
    </div>
  );
}

function RoomRow(props: {
  entity: EntityView;
  joined: boolean;
  master?: boolean;
  onToggle: () => void;
  onVolume: (pct: number) => void;
}) {
  const volume = () => Math.round(attr<number>(props.entity, "volume_level", 0) * 100);
  const available = () => isAlive(props.entity);
  /* Add a room; take one out; the room it is grouped on can only leave. */
  const toggleLabel = () => {
    if (!props.joined) return "Add";
    return props.master ? "Leave" : "Remove";
  };

  return (
    <div class="mp-room" data-joined={props.joined} data-available={available()}>
      <div class="mp-row">
        {/* The equaliser replaces the speaker glyph while a room is playing,
            so a grouped set shows at a glance which ones have audio. */}
        <Show
          when={isActiveState(props.entity)}
          fallback={
            <Icon
              icon={props.master ? "mdi:speaker-wireless" : "mdi:speaker"}
              width="18"
              style={{ opacity: 0.7, flex: "none" }}
            />
          }
        >
          <PlayingBars size="1.1rem" />
        </Show>
        <div class="mp-flex1">
          <div class="mp-room-name mp-truncate">{props.entity.friendlyName}</div>
          <div class="mp-room-state mp-truncate">
            {props.master ? "Group leader" : props.entity.state}
          </div>
        </div>
        <button
          class="mp-pill"
          data-joined={props.joined}
          disabled={!available()}
          onClick={props.onToggle}
        >
          {toggleLabel()}
        </button>
      </div>

      <Show when={props.joined && available()}>
        <div class="mp-row">
          <input
            class="mp-range"
            style={{ "--fill": `${volume()}%` }}
            type="range"
            min={0}
            max={100}
            value={volume()}
            onInput={(e) => props.onVolume(Number(e.currentTarget.value))}
          />
          <span class="mp-pct">{volume()}%</span>
        </div>
      </Show>
    </div>
  );
}
