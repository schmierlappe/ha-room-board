import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Icon, useService, type EntityView } from "@glasshome/widget-sdk";
import { StateGlyph, Thermostat } from "./thermostat";
import { Spark } from "./spark";
import { TickDial } from "./dial";
import { attr, openable, verdict, warmth } from "./util";
import { Half } from "./half";

const MODE_ICONS: Record<string, string> = {
  auto: "mdi:autorenew",
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  heat_cool: "mdi:sun-snowflake-variant",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
  off: "mdi:power",
};

export const targetOf = (entity: EntityView | undefined) =>
  attr<number | undefined>(entity, "temperature", undefined);

export const currentOf = (entity: EntityView | undefined) =>
  attr<number | undefined>(entity, "current_temperature", undefined);

/* Swing reads as a direction, so each option gets the arrow it describes
   rather than the same oscillation glyph four times over. */
const SWING_ICONS: Record<string, string> = {
  off: "mdi:minus-circle-outline",
  on: "mdi:arrow-oscillating",
  both: "mdi:arrow-all",
  vertical: "mdi:arrow-up-down",
  horizontal: "mdi:arrow-left-right",
  auto: "mdi:autorenew",
};

const swingIcon = (value: string) => {
  const known = SWING_ICONS[value.toLowerCase()];
  if (known) return known;
  if (/vert|up|down/i.test(value)) return "mdi:arrow-up-down";
  return /horiz|left|right/i.test(value) ? "mdi:arrow-left-right" : "mdi:arrow-oscillating";
};

/**
 * What the machine is doing right now.
 *
 * hvac_action is the compressor, not the setting: a thermostat set to "heat"
 * in a room that has reached its target reads "idle", and a card that showed
 * the setting alone said "Heat" through an entirely quiet afternoon.
 */
const ACTIONS = new Set(["heating", "cooling", "drying", "fan"]);

/* What each mode does when it runs, for a thermostat that never says. */
const MODE_ACTION: Record<string, string> = {
  heat: "heating",
  cool: "cooling",
  dry: "drying",
  fan_only: "fan",
};

/**
 * What the machine is doing: its own hvac_action where the integration
 * publishes one, and otherwise the work its mode implies — plenty of air
 * conditioners report a mode and nothing else, and read literally that was a
 * unit set to cool shown as idle all day. For heat_cool and auto the room is
 * compared with the setpoint to say which way it is working.
 */
export const actionOf = (entity: EntityView | undefined): string => {
  const reported = attr<string>(entity, "hvac_action", "");
  if (reported) return reported;
  const mode = entity?.state ?? "";
  if (mode === "off" || !mode) return "off";
  const direct = MODE_ACTION[mode];
  if (direct) return direct;
  if (mode === "heat_cool" || mode === "auto") {
    const target = attr<number | undefined>(entity, "temperature", undefined);
    const room = attr<number | undefined>(entity, "current_temperature", undefined);
    if (target !== undefined && room !== undefined && Math.abs(room - target) >= 0.3)
      return room < target ? "heating" : "cooling";
  }
  return "idle";
};

export const isRunning = (entity: EntityView | undefined) => ACTIONS.has(actionOf(entity));

/** The kind of work a mode stands for, for its mark when it is not running. */
export const modeKind = (mode: string) => MODE_ACTION[mode] ?? "idle";

/** Which way the air is going, for everything that takes a colour from it. */
export function toneOf(entity: EntityView | undefined): string {
  const action = actionOf(entity);
  if (action === "heating") return "hot";
  if (action === "cooling") return "cold";
  if (action === "drying") return "dry";
  const mode = entity?.state ?? "";
  if (mode === "heat") return "hot";
  if (mode === "cool") return "cold";
  if (mode === "dry") return "dry";
  return "idle";
}

/** Modes whose icon should turn rather than breathe. */
const SPINS = new Set(["fan_only", "dry", "auto"]);

const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

/**
 * A mode tile that opens its list.
 *
 * Tapping used to step to the next mode, which meant finding "cool" on a
 * five-mode thermostat was four taps through heat and dry — each one a real
 * command to a real boiler. A list shows what there is and asks once.
 */
function ModeTile(props: {
  icon: string;
  value: string;
  label: string;
  options: string[];
  iconFor?: (value: string) => string;
  /** hot, cold, dry or idle — what colour the tile burns. */
  tone?: string;
  /** True while the machine is actually working, which is what animates. */
  live?: boolean;
  /** Turning rather than breathing: a fan, not a flame. */
  spin?: boolean;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  /* Which way the list opens and how tall it may be, measured as it opens:
     toward whichever side of the tile has more of the sheet, and no taller
     than that side — so a list is never cut at the sheet's top or its foot,
     and a long one scrolls inside itself. */
  const [place, setPlace] = createSignal<{ up: boolean; room: number }>({ up: false, room: 320 });
  let wrap: HTMLDivElement | undefined;

  const toggle = () => {
    if (!open() && wrap) {
      const tile = wrap.getBoundingClientRect();
      const frame = (wrap.closest(".rb-sheet-body, [role='dialog']") as HTMLElement | null)?.getBoundingClientRect();
      const top = frame?.top ?? 0;
      // window is a stand-in in the sealed engine, without innerHeight.
      const bottom = frame?.bottom ?? globalThis.innerHeight ?? tile.bottom + 320;
      const above = tile.top - top - 12;
      const below = bottom - tile.bottom - 12;
      const up = above > below;
      setPlace({ up, room: Math.max(120, Math.floor(up ? above : below)) });
    }
    setOpen((was) => !was);
  };

  return (
    <div class="rb-mode-wrap" ref={wrap}>
      <button
        class="rb-mode"
        data-open={open()}
        data-tone={props.tone ?? "idle"}
        data-live={props.live === true}
        data-spin={props.spin === true}
        onClick={toggle}
      >
        <span class="rb-mode-badge">
          <Icon icon={props.icon} width="20" />
        </span>
        <span class="rb-mode-value">{label(props.value)}</span>
        <span class="rb-mode-label">{props.label}</span>
        <Icon class="rb-mode-caret" icon="mdi:chevron-down" width="16" />
      </button>

      <Show when={open()}>
        {/* A backdrop rather than a blur listener: one press anywhere closes
            it, including a press on another tile. */}
        <button type="button" class="rb-mode-backdrop" tabIndex={-1} aria-label="Close menu" onClick={() => setOpen(false)} />
        <div
          class="rb-mode-list"
          data-up={place().up}
          style={{ "max-height": `${place().room}px` }}
        >
          <For each={props.options}>
            {(option) => (
              <button
                class="rb-mode-option"
                data-active={option === props.value}
                onClick={() => {
                  setOpen(false);
                  if (option !== props.value) props.onPick(option);
                }}
              >
                <Icon icon={props.iconFor?.(option) ?? props.icon} width="16" />
                <span class="rb-truncate">{label(option)}</span>
                <Show when={option === props.value}>
                  <Icon icon="mdi:check" width="15" />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * The board card.
 *
 * The same plan as the vacuum's: the machine in the corner, one line saying
 * what it is doing, and the controls you would actually reach for. The air
 * moves only while the unit is running, so the card distinguishes "set to
 * cool" from "cooling" without a word for it.
 */
export function ClimateCard(props: { climate: EntityView; onOpen: () => void }) {
  const { callService } = useService();

  const nudge = (event: Event, delta: number) => {
    event.stopPropagation();
    const current = targetOf(props.climate);
    if (current === undefined) return;
    const min = attr<number>(props.climate, "min_temp", 7);
    const max = attr<number>(props.climate, "max_temp", 35);
    const step = attr<number>(props.climate, "target_temp_step", 0.5);
    void callService(
      "climate",
      "set_temperature",
      { temperature: Math.min(max, Math.max(min, current + delta * step)) },
      { entity_id: props.climate.id },
    );
  };

  const active = () => props.climate.state !== "off";
  const running = () => isRunning(props.climate);

  /* What it is doing, as one word and one moving mark: the work while the
     machine runs — Heating, Cooling, Drying, Fan — "Idle" while it is on and
     the room is where it was asked to be, and Off. */
  /* The mark: the work itself while it runs — moving — and otherwise the
     mode's own mark standing still, so a unit set to cool that has reached
     its target still says Cool rather than a bare "Idle". */
  const action = () => {
    if (!active()) return "off";
    const doing = actionOf(props.climate);
    return ACTIONS.has(doing) ? doing : modeKind(props.climate.state);
  };

  const word = () => {
    if (!active()) return "Off";
    if (running()) return label(actionOf(props.climate));
    return label(props.climate.state);
  };

  const target = () => targetOf(props.climate);
  const room = () => currentOf(props.climate);
  const min = () => attr<number>(props.climate, "min_temp", 7);
  const max = () => attr<number>(props.climate, "max_temp", 35);

  return (
    <article
      class="rb-card rb-card--climate"
      data-on={active()}
      data-running={running()}
      data-tone={toneOf(props.climate)}
      {...openable(props.onOpen, "Climate")}
    >
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">
            {props.climate.friendlyName ?? "Heating"}
          </h3>
        </div>

        {/* The state in the corner, as a chip with its own moving mark: a
            flame that flickers while it heats, a snowflake that turns while
            it cools. */}
        <span class="rb-clim-state" data-action={action()}>
          <StateGlyph action={action()} still={!running()} width="13" />
          <span class="rb-truncate">{word()}</span>
        </span>
      </header>

      {/* Straight under the name: what it is set to, and what the room is. */}
      <div class="rb-clim-card-read">
        <b>
          {target() === undefined ? "—" : target()!.toFixed(1)}
          <i>°</i>
        </b>
        <Show when={room() !== undefined}>
          <span>Room {room()!.toFixed(1)}°</span>
        </Show>
      </div>

      {/* The keys at the foot, the thermostat in the other corner. */}
      <div class="rb-clim-main">
        <div class="rb-clim-keys">
          <button aria-label="Cooler" onClick={(e) => nudge(e, -1)}>
            <Icon icon="mdi:minus" width="15" />
          </button>
          <button aria-label="Warmer" onClick={(e) => nudge(e, 1)}>
            <Icon icon="mdi:plus" width="15" />
          </button>
        </div>
      </div>

      <Thermostat
        target={target()}
        current={room()}
        min={min()}
        max={max()}
        tone={toneOf(props.climate)}
        running={running()}
        on={active()}
        action={action()}
      />
      <Half icon="mdi:thermostat" name={props.climate.friendlyName ?? "Climate"} status={room() !== undefined ? `${word()} · room ${room()}°` : word()} tone={running() ? "#ff8a3d" : "#94a3b8"} lit={running()} value={target() === undefined ? undefined : `${target()}°`} />
    </article>
  );
}

/**
 * The thermostat in full.
 *
 * Laid out the way the reference is: the modes down the left as tiles, the
 * target in the middle at the size it deserves, the presets and the room's own
 * history on the right, and the dial along the bottom. The whole panel is one
 * screen — a thermostat is a thing you look at and adjust, not a list you
 * scroll.
 */
export function ClimatePanel(props: {
  climate: EntityView;
  /** The room's temperature sensor, for the history card. */
  historyEntityId?: string;
  historyHours: number;
}) {
  const { callService } = useService();

  const min = () => attr<number>(props.climate, "min_temp", 7);
  const max = () => attr<number>(props.climate, "max_temp", 35);
  const step = () => attr<number>(props.climate, "target_temp_step", 0.5);

  /* The slider shows where the finger is; the thermostat is only told on
     release. Calling the service on every input event sends dozens of commands
     during one drag, and a radiator valve answers each of them. */
  const [dragging, setDragging] = createSignal<number | undefined>();
  /* What was sent, held until the thermostat says so: without it the handle
     jumped back to the old target on release and over again a moment later. */
  const [sent, setSent] = createSignal<number | undefined>();
  let sentTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const target = targetOf(props.climate);
    if (sent() !== undefined && target !== undefined && Math.abs(target - sent()!) < 0.01) setSent(undefined);
  });
  onCleanup(() => clearTimeout(sentTimer));
  const shown = () => dragging() ?? sent() ?? targetOf(props.climate) ?? min();

  const send = (value: number) => {
    setSent(value);
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => setSent(undefined), 8000);
    apply(value);
  };
  /* One step either way, from what is shown: tapped twice quickly, the second
     tap goes on from the first rather than from what the thermostat had. */
  const nudge = (direction: number) => {
    const by = step() > 0 ? step() : 0.5;
    const next = Math.min(max(), Math.max(min(), Math.round((shown() + direction * by) / by) * by));
    send(Number(next.toFixed(2)));
  };

  const apply = (value: number) =>
    void callService(
      "climate",
      "set_temperature",
      { temperature: value },
      { entity_id: props.climate.id },
    );

  const modes = () => attr<string[]>(props.climate, "hvac_modes", []);
  const fanModes = () => attr<string[]>(props.climate, "fan_modes", []);
  /* Swing, where the machine has vanes. Home Assistant splits it in two on
     newer integrations — one axis each — and older ones publish a single list
     whose values name the axis instead. Both are offered as they are found. */
  const swingModes = () => attr<string[]>(props.climate, "swing_modes", []);
  const swingHModes = () => attr<string[]>(props.climate, "swing_horizontal_modes", []);
  const presets = () => attr<string[]>(props.climate, "preset_modes", []);
  const preset = () => attr<string>(props.climate, "preset_mode", "");

  /* An eco or away preset is the one worth a switch of its own; the rest stay
     in the list, because a row of five toggles is a settings page. */
  const ecoPreset = () =>
    presets().find((value) => /eco|away|night|sleep/i.test(value));

  return (
    <div class="rb-clim-panel">
      {/* The room, and nothing else: the current temperature is on the line
          under the number, where it was already being said. */}
      <header class="rb-clim-head">
        <h2 class="rb-clim-title rb-truncate">{props.climate.friendlyName ?? "Heating"}</h2>
        <span class="rb-clim-target-label">Target</span>
      </header>

      <div class="rb-clim-body">
        {/* Left: what the machine is doing. */}
        <div class="rb-clim-modes">
          <Show when={modes().length > 1}>
            <ModeTile
              icon={MODE_ICONS[props.climate.state] ?? "mdi:thermostat"}
              value={props.climate.state}
              label="Mode"
              tone={toneOf(props.climate)}
              live={isRunning(props.climate)}
              spin={SPINS.has(props.climate.state)}
              options={modes()}
              iconFor={(value) => MODE_ICONS[value] ?? "mdi:thermostat"}
              onPick={(value) =>
                void callService(
                  "climate",
                  "set_hvac_mode",
                  { hvac_mode: value },
                  { entity_id: props.climate.id },
                )
              }
            />
          </Show>

          <Show when={fanModes().length > 1}>
            <ModeTile
              icon="mdi:fan"
              value={attr<string>(props.climate, "fan_mode", "—")}
              label="Ventilation"
              live={isRunning(props.climate)}
              spin
              options={fanModes()}
              onPick={(value) =>
                void callService(
                  "climate",
                  "set_fan_mode",
                  { fan_mode: value },
                  { entity_id: props.climate.id },
                )
              }
            />
          </Show>

        </div>

        {/* Middle: the number. */}
        <div class="rb-clim-read" style={{ "--rb-warmth": `${warmth(shown())}` }}>
          {/* The number between a step down and a step up — the buttons
              show on a phone, where a thumb taps more surely than it drags. */}
          <div class="rb-clim-setter">
            <button class="rb-clim-step" aria-label="Lower" onClick={() => nudge(-1)}>
              <Icon icon="mdi:minus" width="22" />
            </button>
            <span class="rb-clim-value">
              {shown().toFixed(shown() % 1 ? 1 : 0)}
              <i>°C</i>
            </span>
            <button class="rb-clim-step" aria-label="Raise" onClick={() => nudge(1)}>
              <Icon icon="mdi:plus" width="22" />
            </button>
          </div>

          <Show when={currentOf(props.climate) !== undefined}>
            <span class="rb-clim-feels">
              <span class="rb-clim-feels-badge">
                <Icon icon="mdi:thermometer" width="16" />
              </span>Now {currentOf(props.climate)}°C<b>{verdict("temperature", currentOf(props.climate)!)}</b>
            </span>
          </Show>

          {/* The room's own line, bare under the readout rather than boxed off
              in the side column — it is the same measurement as the number
              above it, so it should not look like a separate card. */}
          <Show when={props.historyEntityId}>
            <div class="rb-clim-history">
              <Spark
                entityId={props.historyEntityId!}
                hours={props.historyHours}
                kind="line"
                interactive
                caption={`Last ${props.historyHours} h`}
                target={props.climate?.state === "off" || targetOf(props.climate) === undefined ? undefined : shown()}
                warmth={warmth(currentOf(props.climate) ?? shown())}
              />
            </div>
          </Show>
        </div>

        {/* Right: where the air is pointed, the presets and the room's own
            history. Swing lives here rather than beside the mode tiles — it is
            about the room, not about what the machine is doing. */}
        <div class="rb-clim-side">
          <Show when={swingModes().length > 1}>
            <ModeTile
              icon={swingIcon(attr<string>(props.climate, "swing_mode", "off"))}
              value={attr<string>(props.climate, "swing_mode", "—")}
              label={swingHModes().length > 1 ? "Swing (vertical)" : "Swing"}
              options={swingModes()}
              iconFor={swingIcon}
              onPick={(value) =>
                void callService(
                  "climate",
                  "set_swing_mode",
                  { swing_mode: value },
                  { entity_id: props.climate.id },
                )
              }
            />
          </Show>

          <Show when={swingHModes().length > 1}>
            <ModeTile
              icon="mdi:arrow-left-right"
              value={attr<string>(props.climate, "swing_horizontal_mode", "—")}
              label="Swing (horizontal)"
              options={swingHModes()}
              iconFor={swingIcon}
              onPick={(value) =>
                void callService(
                  "climate",
                  "set_swing_horizontal_mode",
                  { swing_horizontal_mode: value },
                  { entity_id: props.climate.id },
                )
              }
            />
          </Show>
          <Show when={ecoPreset()}>
            <div class="rb-clim-tile">
              <span class="rb-clim-tile-name">{label(ecoPreset()!)}</span>
              <span class="rb-clim-tile-state">
                {preset() === ecoPreset() ? "Turned on" : "Turned off"}
              </span>
              <button
                class="rb-switch"
                role="switch"
                aria-checked={preset() === ecoPreset()}
                data-on={preset() === ecoPreset()}
                onClick={() =>
                  void callService(
                    "climate",
                    "set_preset_mode",
                    {
                      preset_mode:
                        preset() === ecoPreset()
                          ? (presets().find((value) => value !== ecoPreset()) ?? "none")
                          : ecoPreset(),
                    },
                    { entity_id: props.climate.id },
                  )
                }
              >
                <i />
              </button>
            </div>
          </Show>

        </div>
      </div>

      {/* The dial. A ruled track rather than a plain bar: the ticks are what
          make a temperature feel like something being set rather than a
          percentage being filled. */}
      <TickDial
        min={min()}
        max={max()}
        step={step()}
        value={shown()}
        label="Target temperature"
        onPreview={setDragging}
        onCommit={(value) => {
          setDragging(undefined);
          send(value);
        }}
      />
    </div>
  );
}
