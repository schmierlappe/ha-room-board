import { Index } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";

export type TabItem<T extends string> = { id: T; label: string; icon: string };

/**
 * The overlay's tab bar.
 *
 * Deliberately the media popup's bar rather than a second design: the two
 * panels open from the same board into the same sheet, and a different tab
 * shape in each would read as two applications. Outlined, with the active tab
 * carrying the only fill in the row.
 */
export function Tabs<T extends string>(props: {
  items: TabItem<T>[];
  active: T;
  onPick: (id: T) => void;
}) {
  return (
    <nav class="rb-nav">
      {/* By position, not by item: panels build their tab list afresh on
          every state change — the light overlay on every report from a lit
          bulb — and a list keyed on those new objects rebuilt every button,
          icons and all, which blinked the bar while the icons reloaded. */}
      <Index each={props.items}>
        {(item) => (
          <button
            data-active={props.active === item().id}
            onClick={() => props.onPick(item().id)}
          >
            <Icon icon={item().icon} width="16" />
            <span>{item().label}</span>
          </button>
        )}
      </Index>
    </nav>
  );
}
