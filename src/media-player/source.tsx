import { For, Show } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { FEATURE, supports } from "./features";
import { attr } from "./util";

/**
 * Sound mode, for the players that have one — a receiver's Stereo, Movie,
 * Direct.
 *
 * This used to carry the source list as well, as a dropdown on Now. It is not
 * here any more: every player that has sources gets them as the Favourites
 * tab — or, for a TV a remote profile claims, as the Remote tab's app list —
 * and a second, plainer copy of the same list under the transport was the
 * same choice offered twice.
 */
export function SourceSelect(props: { player: () => EntityView | undefined }) {
  const { callService } = useService();

  const call = (service: string, data: Record<string, unknown>) => {
    const target = props.player()?.id;
    if (target) void callService("media_player", service, data, { entity_id: target });
  };

  const soundModes = () => attr<string[]>(props.player(), "sound_mode_list", []);
  const soundMode = () => attr<string>(props.player(), "sound_mode", "");

  const hasSoundMode = () =>
    supports(props.player(), FEATURE.SELECT_SOUND_MODE) && soundModes().length > 0;

  return (
    <Show when={hasSoundMode()}>
      <div class="mp-source">
        <label class="mp-source-row">
          <Icon icon="mdi:equalizer-outline" width="16" style={{ opacity: 0.55 }} />
          <select
            class="mp-select mp-flex1"
            value={soundMode()}
            onChange={(e) => call("select_sound_mode", { sound_mode: e.currentTarget.value })}
          >
            <Show when={!soundModes().includes(soundMode())}>
              <option value="">{soundMode() || "Select a sound mode"}</option>
            </Show>
            <For each={soundModes()}>{(m) => <option value={m}>{m}</option>}</For>
          </select>
        </label>
      </div>
    </Show>
  );
}
