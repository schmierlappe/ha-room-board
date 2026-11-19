import { useDomains } from "../domains";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Icon, useEntities, useEntity, useService, type EntityView } from "@glasshome/widget-sdk";
import { sealedImage } from "../url";
/* The vacuum widget's own room parser, rather than a second one that would
   drift from it: both read the same "Label=area_id=icon" lines a user has
   already written once. */
import { parseRoomMap } from "../vacuum/util";
import { Robot } from "./robot";
import { readConsumables, wearColor, type Consumable } from "./consumables";
import { attr, numeric, openable, withParam } from "./util";
import { Keyed } from "./keyed";
import { keyStep } from "../keys";
import { inOrder } from "../async";
import { errorMessage } from "../errors";

const CLEANING = new Set(["cleaning", "returning", "going_to_spot", "spot_cleaning"]);

/**
 * Whether the machine is stuck.
 *
 * The state is the reliable half — every integration reports "error" — and the
 * `error` attribute is where the reason lives when there is one. Roborock
 * writes "none" or 0 there when all is well, which is not an error however
 * truthy it looks.
 */
const NO_ERROR = new Set(["", "none", "no error", "ok", "0"]);

export const errorOf = (entity: EntityView | undefined): string | undefined => {
  const raw = entity?.attributes?.error;
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  const real = text && !NO_ERROR.has(text.toLowerCase());
  if (entity?.state === "error") return real ? text : "Needs attention";
  return real ? text : undefined;
};

export const isCleaning = (entity: EntityView | undefined) => CLEANING.has(entity?.state ?? "");

const batteryOf = (entity: EntityView | undefined) =>
  attr<number | undefined>(entity, "battery_level", undefined);

/**
 * The charge, whether or not the vacuum entity still carries it.
 *
 * Home Assistant deprecated battery_level on the vacuum entity and moved the
 * charge to a sensor of its own, so newer Roborock and Dreame setups report
 * nothing on the attribute. The matching sensor is found by the robot's own
 * slug, out of the battery sensors in the house — exact enough that a second
 * robot, or a battery-powered anything else, cannot be mistaken for it.
 */
function useBattery(vacuum: () => EntityView | undefined) {
  const domains = useDomains();
  const candidates = () => {
    const slug = vacuum()?.id.split(".")[1] ?? "";
    if (!slug || batteryOf(vacuum()) !== undefined) return [];
    return (domains().sensor ?? []).filter(
      (id) => id.includes(slug) && /batt/i.test(id),
    );
  };

  const sensors = useEntities(candidates);

  return () => {
    const direct = batteryOf(vacuum());
    if (direct !== undefined) return direct;
    const sensor = sensors().find((entity) => entity.deviceClass === "battery") ?? sensors()[0];
    return numeric(sensor);
  };
}

/** A battery glyph that matches the reading, so the chip is legible unread. */
const batteryIcon = (percent: number, charging: boolean) => {
  const step = Math.max(0, Math.min(10, Math.round(percent / 10))) * 10;
  if (charging) return step >= 100 ? "mdi:battery-charging-100" : `mdi:battery-charging-${step || 10}`;
  if (step >= 100) return "mdi:battery";
  if (step <= 0) return "mdi:battery-outline";
  return `mdi:battery-${step}`;
};

/** Green at full through amber to red, the same ramp the consumables use. */
const batteryColor = (percent: number) =>
  `hsl(${Math.round(Math.max(0, Math.min(140, percent * 1.4)))} 74% 52%)`;

/** "38 min", from a figure that is seconds on some integrations and minutes on others. */
function runtimeLabel(raw: unknown): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return "";
  const minutes = value > 600 ? Math.round(value / 60) : Math.round(value);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "Docked", "Cleaning" — the state, in words rather than as an enum. */
const stateLabel = (entity: EntityView | undefined) =>
  (entity?.state ?? "unknown").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());


/**
 * The board card.
 *
 * The machine, the one line that says what it is doing, its charge and the
 * single button worth having on a tile this size. The drawing is the card's
 * illustration rather than an object in the layout — it sits in the corner and
 * fades out of it, so nothing has to be shuffled around it.
 */
export function VacuumCard(props: {
  vacuum: EntityView;
  onOpen: () => void;
  /** The map, for when the card is given a portrait on a phone. */
  mapEntityId?: string;
  mapBaseUrl?: string;
  /** Stop and spot cleaning beside the usual three, for a tile with room for
   *  them — the vacuum widget's larger sizes. The board leaves it off. */
  extraActions?: boolean;
}) {
  const { callService } = useService();

  /* Standing, the card has the height for the map, and the map is the best
     thing it could show — where the robot is, not a picture of one. The
     phone layout says which shape it gave the card (mosaic.ts); the card
     watches for it rather than being told, since the layout is planned after
     the cards are on the board. */
  let card: HTMLElement | undefined;
  const [shape, setShape] = createSignal("");
  const standing = () => shape() === "portrait";
  onMount(() => {
    if (!card || typeof MutationObserver === "undefined") return;
    const read = () => setShape(card!.dataset.shape ?? "");
    read();
    const watch = new MutationObserver(read);
    watch.observe(card, { attributes: true, attributeFilter: ["data-shape"] });
    onCleanup(() => watch.disconnect());
  });
  /* A big card has the room for the map beside everything else. */
  const showMap = () => (standing() || shape() === "big") && !!props.mapEntityId;
  const battery = useBattery(() => props.vacuum);
  const cleaning = () => isCleaning(props.vacuum);
  const charging = () => props.vacuum.state === "docked" && (battery() ?? 100) < 100;
  const fault = () => errorOf(props.vacuum);

  const send = (service: string) => (e: Event) => {
    e.stopPropagation();
    void callService("vacuum", service, {}, { entity_id: props.vacuum.id });
  };

  /* The run's figures, for the big card's tiles: the last run's while it
     sits, since the integration keeps them. */
  const runTime = () => runtimeLabel(attr(props.vacuum, "cleaning_time", undefined)) || "—";
  const runArea = () => {
    const area = Number(attr(props.vacuum, "cleaned_area", Number.NaN));
    return Number.isFinite(area) && area > 0 ? `${Math.round(area)} m²` : "—";
  };
  const suction = () => {
    const fan = attr<string | undefined>(props.vacuum, "fan_speed", undefined);
    return fan ? fan.charAt(0).toUpperCase() + fan.slice(1) : "—";
  };

  const primary = (e: Event) => {
    e.stopPropagation();
    void callService(
      "vacuum",
      cleaning() ? "return_to_base" : "start",
      {},
      { entity_id: props.vacuum.id },
    );
  };

  /* One line, and never the same word twice: the run while it works, the
     charge while it sits, the plain state otherwise. */
  const detail = () => {
    const problem = fault();
    if (problem) return problem;
    if (cleaning()) {
      const time = runtimeLabel(attr(props.vacuum, "cleaning_time", undefined));
      const area = Number(attr(props.vacuum, "cleaned_area", Number.NaN));
      const said = [time, Number.isFinite(area) && area > 0 ? `${Math.round(area)} m²` : ""]
        .filter(Boolean)
        .join(" · ");
      return said ? `Cleaning · ${said}` : "Cleaning";
    }
    if (charging()) return "Charging";
    return stateLabel(props.vacuum);
  };

  return (
    <article
      ref={card}
      class="rb-card rb-card--vacuum"
      data-on={cleaning()}
      data-error={fault() !== undefined}
      data-map={showMap()}
      {...openable(props.onOpen, "Vacuum")}
    >
      {/* Wide and big: the robot in a ring, lit and turning while it works.
          Elsewhere the wrapper steps aside and the robot keeps its corner. */}
      <div class="rb-vac-orb">
        <span class="rb-vac-halo" aria-hidden="true" />
        <Robot cleaning={cleaning()} docked={props.vacuum.state === "docked"} />
      </div>

      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">{props.vacuum.friendlyName ?? "Vacuum"}</h3>
          {/* A dot on the state line rather than anything happening to the
              card: the same signal the overlay's badge and the climate card
              use, so a board of live things reads as one language. */}
          <span class="rb-card-verdict rb-truncate">
            <Show when={cleaning() || fault() !== undefined}>
              <i class="rb-live-dot" data-fault={fault() !== undefined} />
            </Show>
            {detail()}
          </span>
        </div>

        <Show when={battery() !== undefined}>
          <span class="rb-vac-batt" style={{ "--batt": batteryColor(battery()!) }}>
            <Icon icon={batteryIcon(battery()!, charging())} width="13" />
            <b>{Math.round(battery()!)}%</b>
          </span>
        </Show>
      </header>

      {/* Wide and big: the charge written large, and as a slim bar. */}
      <Show when={battery() !== undefined}>
        <b class="rb-vac-level">
          {Math.round(battery()!)}
          <i>%</i>
        </b>
        <span
          class="rb-vac-charge"
          aria-hidden="true"
          style={{ "--b": `${Math.round(battery()!)}%`, "--batt": batteryColor(battery()!) }}
        />
      </Show>

      {/* Big: the run in figures, and the controls in full. */}
      <div class="rb-vac-stats">
        <span>
          <small>Time</small>
          <b>{runTime()}</b>
        </span>
        <span>
          <small>Area</small>
          <b>{runArea()}</b>
        </span>
        <span>
          <small>Suction</small>
          <b class="rb-truncate">{suction()}</b>
        </span>
      </div>

      <div class="rb-vac-actions">
        <button class="rb-vac-act" data-primary="true" onClick={send(cleaning() ? "pause" : "start")}>
          <Icon icon={cleaning() ? "mdi:pause" : "mdi:play"} width="16" />
          <span>{cleaning() ? "Pause" : "Clean"}</span>
        </button>
        <button class="rb-vac-act" onClick={send("return_to_base")}>
          <Icon icon="mdi:home-import-outline" width="16" />
          <span>Dock</span>
        </button>
        <button class="rb-vac-act" aria-label="Locate" onClick={send("locate")}>
          <Icon icon="mdi:map-marker-radius-outline" width="16" />
        </button>
        <Show when={props.extraActions}>
          <button class="rb-vac-act" data-icon="true" aria-label="Spot clean" onClick={send("clean_spot")}>
            <Icon icon="mdi:target" width="16" />
          </button>
          <button class="rb-vac-act" data-icon="true" aria-label="Stop" onClick={send("stop")}>
            <Icon icon="mdi:stop" width="16" />
          </button>
        </Show>
      </div>

      <Show when={showMap()}>
        <VacuumMap entityId={props.mapEntityId!} />
      </Show>

      <button
        class="rb-vac-go"
        aria-label={cleaning() ? "Send it home" : "Start cleaning"}
        onClick={primary}
      >
        <Icon icon={cleaning() ? "mdi:home-import-outline" : "mdi:play"} width="14" />
        <span>{cleaning() ? "Dock" : "Clean"}</span>
      </button>
    </article>
  );
}

/**
 * The map.
 *
 * Roborock publishes it as an image entity (newer integrations) or a camera
 * (older ones, and Valetudo); either way the entity carries an origin-relative
 * entity_picture (/api/image_proxy/… or /api/camera_proxy/…), which the
 * dashboard's media proxy serves — as long as the widget may read that entity,
 * hence the image and camera grants on the board.
 */
function VacuumMap(props: { entityId: string }) {
  const entity = useEntity(() => props.entityId);
  const [tick, setTick] = createSignal(0);
  const [failed, setFailed] = createSignal(false);

  // A camera does not always bump entity_picture per frame, so nudge it.
  onMount(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);
    onCleanup(() => clearInterval(timer));
  });

  const src = () => {
    const picture = attr<string | undefined>(entity(), "entity_picture", undefined);
    if (!picture) return undefined;
    const url = sealedImage(picture);
    return url ? withParam(url, "v", tick()) : undefined;
  };

  // A rotated token or a corrected base URL should clear a stale failure.
  createEffect(() => {
    src();
    setFailed(false);
  });

  return (
    <div class="rb-map">
      <Show
        when={src() && !failed()}
        fallback={
          <div class="rb-map-empty">
            <Icon icon="mdi:map-outline" width="30" />
            <span>
              {props.entityId
                ? "The map did not load."
                : "No map for this vacuum. Pick its map entity in settings."}
            </span>
          </div>
        }
      >
        <img src={src()} alt="Vacuum map" onError={() => setFailed(true)} />
      </Show>
    </div>
  );
}

/**
 * The vacuum in full: where it is, what it is doing, which rooms to send it to
 * and how its consumables are wearing.
 *
 * The map and the controls sit side by side because watching it work and
 * telling it what to do is the one pair you want together — the same reason
 * the vacuum widget merged its own two tabs.
 */
export function VacuumPanel(props: {
  vacuums: EntityView[];
  mapEntityId: string;
  /** Retired: the map comes through the dashboard's media proxy. */
  mapBaseUrl?: string;
  rooms: string[];
  sensorIds: string[];
}) {
  const domains = useDomains();
  const { callService } = useService();
  const sensors = useEntities(() => props.sensorIds);

  const vacuum = () => props.vacuums[0];
  const rooms = () => parseRoomMap(props.rooms);

  const [status, setStatus] = createSignal<string | undefined>();
  const [selected, setSelected] = createSignal<string[]>([]);
  /* The line beside the send button. */
  const sendLine = () => {
    const count = selected().length;
    if (!count) return "Tap the rooms you want cleaned";
    return `${count} room${count > 1 ? "s" : ""} selected`;
  };
  const [busy, setBusy] = createSignal(false);

  const call = async (service: string, data: Record<string, unknown> = {}) => {
    const id = vacuum()?.id;
    if (!id) return;
    setStatus(undefined);
    try {
      await callService("vacuum", service, data, { entity_id: id });
    } catch (error) {
      setStatus(errorMessage(error, "Command failed"));
    }
  };

  const toggleRoom = (areaId: string) =>
    setSelected((previous) =>
      previous.includes(areaId)
        ? previous.filter((value) => value !== areaId)
        : [...previous, areaId],
    );

  /* Sequential, not in parallel: each clean_area has to reach Home Assistant
     before the next, or "in the order they were tapped" is not true. */
  const cleanRooms = async () => {
    setBusy(true);
    await inOrder(selected(), (areaId) => call("clean_area", { cleaning_area_id: areaId }));
    setBusy(false);
    setSelected([]);
  };

  /* Every button in the house, filtered down to this robot's reset buttons by
     name — the integration publishes one per part, so the reset is an exact
     entity rather than a guessed service call. */
  const wear = () =>
    readConsumables(sensors(), { vacuumId: vacuum()?.id, buttons: domains().button ?? [] });

  const pressReset = async (entityId: string) => {
    setStatus(undefined);
    try {
      await callService("button", "press", {}, { entity_id: entityId });
    } catch (error) {
      setStatus(errorMessage(error, "Could not reset that counter"));
    }
  };

  const charging = () => vacuum()?.state === "docked" && (battery() ?? 100) < 100;

  /* A second line only where there is something to say: the run so far while
     it works, the charge while it sits, and nothing at all when neither. */
  const subline = () => {
    if (isCleaning(vacuum())) {
      const area = Number(attr(vacuum(), "cleaned_area", Number.NaN));
      const time = runtimeLabel(attr(vacuum(), "cleaning_time", undefined));
      return [time, Number.isFinite(area) && area > 0 ? `${Math.round(area)} m² cleaned` : ""]
        .filter(Boolean)
        .join(" · ");
    }
    if (charging()) return "Charging";
    if (vacuum()?.state === "docked") return battery() !== undefined ? "Charged and ready" : "Ready";
    return "";
  };

  const speeds = () => attr<string[]>(vacuum(), "fan_speed_list", []);
  const speed = () => attr<string>(vacuum(), "fan_speed", "");
  const battery = useBattery(vacuum);

  const allSelected = () => selected().length === rooms().length && rooms().length > 0;

  /* The machine first, at every size: its name and state in the sheet's
   header, the charge and a suction slider beside the robot — swiped across
   to its map — and every command a button in one bar at the foot. The rooms
   and the maintenance are sheets of their own from that bar. */
  const [view, setView] = createSignal(0);
  let views: HTMLDivElement | undefined;
  const [sheet, setSheet] = createSignal<"rooms" | "wear" | undefined>();
  /* On a wide screen the panel beside the machine shows the rooms or the
     maintenance — the wrench switches it rather than covering the whole
     overlay, so the robot and its controls stay in view. */
  const [side, setSide] = createSignal<"rooms" | "wear">("rooms");
  let sidePanel: HTMLElement | undefined;
  const besideShown = () => !!sidePanel && sidePanel.offsetParent !== null;
  const openWear = () => {
    if (besideShown()) setSide(side() === "wear" ? "rooms" : "wear");
    else setSheet("wear");
  };
  const sideNow = () => (rooms().length ? side() : "wear");

  /* The room picker: in its own sheet on a phone, beside everything else
     on a tablet or a desktop. */
  const roomPicker = () => (
    <>
      <div class="rb-vac-label-row">
        <h3 class="rb-vac-label">Pick the rooms to clean</h3>
        <button
          class="rb-vac-chip"
          onClick={() => setSelected(allSelected() ? [] : rooms().map((room) => room.areaId))}
        >
          {allSelected() ? "Clear" : "Select all"}
        </button>
      </div>

      <div class="rb-rooms rb-rooms--large">
        <Keyed each={rooms()} by={(room) => room.areaId}>
          {(room) => (
            <button
              class="rb-room"
              data-active={selected().includes(room.areaId)}
              aria-pressed={selected().includes(room.areaId)}
              onClick={() => toggleRoom(room.areaId)}
            >
              <span class="rb-room-ico">
                <Icon icon={room.icon} width="26" />
              </span>
              <span class="rb-room-label">{room.label}</span>
              <Show when={selected().includes(room.areaId)}>
                <span class="rb-room-tick">
                  <Icon icon="mdi:check" width="12" />
                </span>
              </Show>
            </button>
          )}
        </Keyed>
      </div>

      <div class="rb-vac-send" data-ready={selected().length > 0}>
        <span class="rb-vac-send-text rb-truncate">
          {sendLine()}
        </span>
        <button
          class="rb-vac-run"
          disabled={busy() || !selected().length}
          onClick={async () => {
            await cleanRooms();
            setSheet(undefined);
          }}
        >
          <Icon icon="mdi:play" width="16" />
          <span>{busy() ? "Sending…" : "Start cleaning"}</span>
        </button>
      </div>
    </>
  );

  const phoneView = () => (
    <div class="rb-vacm" data-on={isCleaning(vacuum())} data-charging={charging()}>
      <header class="rb-vacm-head">
        <h2 class="rb-vacm-name">{vacuum()?.friendlyName ?? "Vacuum"}</h2>
        <span class="rb-vacm-sub">
          <Show when={isCleaning(vacuum()) || errorOf(vacuum()) !== undefined}>
            <i class="rb-live-dot" data-fault={errorOf(vacuum()) !== undefined} />
          </Show>
          {errorOf(vacuum()) ?? (subline() || stateLabel(vacuum()))}
        </span>
      </header>

      <div class="rb-vacm-main">
        <div class="rb-vacm-hero">
          <div class="rb-vacm-side">
            <Show when={battery() !== undefined}>
              <div class="rb-vacm-batt">
                <b>
                  {Math.round(battery()!)}
                  <i>%</i>
                  {/* Charging: a bolt that pulses beside the number. */}
                  <Show when={charging()}>
                    <Icon icon="mdi:lightning-bolt" width="18" class="rb-vacm-bolt" />
                  </Show>
                </b>
                <span>{charging() ? "Charging" : "Battery"}</span>
                {/* The charge as a slim bar, with a light running along it while
                    it fills. */}
                <span
                  class="rb-vacm-charge"
                  aria-hidden="true"
                  style={{ "--b": `${Math.round(battery()!)}%`, "--batt": batteryColor(battery()!) }}
                >
                  <i />
                </span>
              </div>
            </Show>
            <Show when={speeds().length > 1}>
              <FanSlider
                levels={speeds()}
                value={speed()}
                onPick={(value) => call("set_fan_speed", { fan_speed: value })}
              />
            </Show>
          </div>

          {/* The robot and its map side by side, swiped between: the picture
              of the machine and the picture of where it is. Native scrolling
              with snap points, so the swipe feels like every other on the
              phone; the dots follow it and jump on a tap. */}
          <div class="rb-vacm-views">
            <div
              ref={views}
              class="rb-vacm-track"
              onScroll={(event) => {
                const el = event.currentTarget;
                setView(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
              }}
            >
              <div class="rb-vacm-slide">
                <div class="rb-vacm-robot">
                  <span class="rb-vac-halo" aria-hidden="true" />
                  <Robot cleaning={isCleaning(vacuum())} docked={vacuum()?.state === "docked"} />
                </div>
              </div>
              <Show when={props.mapEntityId}>
                <div class="rb-vacm-slide rb-vacm-slide--map">
                  <VacuumMap entityId={props.mapEntityId} />
                </div>
              </Show>
            </div>
            <Show when={props.mapEntityId}>
              <div class="rb-vacm-dots">
                <For each={["Robot", "Map"]}>
                  {(label, index) => (
                    <button
                      data-active={view() === index()}
                      aria-label={`Show the ${label.toLowerCase()}`}
                      onClick={() => {
                        /* scrollLeft, not scrollTo(): the sealed engine lets a
                           widget set the scroll but has no scrollTo. The track's
                           scroll-behavior makes it glide. */
                        if (views) views.scrollLeft = index() * views.clientWidth;
                      }}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        {/* Every command a button, in one bar. */}
        <div class="rb-vacm-bar">
          <Show
            when={isCleaning(vacuum())}
            fallback={
              <button class="rb-vacm-go" onClick={() => call("start")}>
                <Icon icon="mdi:play" width="20" />
                <span>Start</span>
              </button>
            }
          >
            <button class="rb-vacm-go" onClick={() => call("pause")}>
              <Icon icon="mdi:pause" width="20" />
              <span>Pause</span>
            </button>
          </Show>
          <Show when={rooms().length}>
            <button class="rb-vacm-key" aria-label="Clean rooms" onClick={() => setSheet("rooms")}>
              <Icon icon="mdi:floor-plan" width="20" />
            </button>
          </Show>
          <button class="rb-vacm-key" aria-label="Send to dock" onClick={() => call("return_to_base")}>
            <Icon icon="mdi:home-import-outline" width="20" />
          </button>
          <button class="rb-vacm-key" aria-label="Locate" onClick={() => call("locate")}>
            <Icon icon="mdi:map-marker-radius-outline" width="20" />
          </button>
          <Show when={wear().length}>
            <button
              class="rb-vacm-key"
              aria-label="Maintenance"
              data-active={sideNow() === "wear" && besideShown()}
              data-due={wear().some((item) => item.percent < DUE)}
              onClick={openWear}
            >
              <Icon icon="mdi:wrench-outline" width="20" />
            </button>
          </Show>
        </div>
      </div>

      {/* Wide: the rooms beside the machine rather than behind a button,
          and the maintenance in the same place, a tab away. */}
      <Show when={rooms().length || wear().length}>
        <section ref={sidePanel} class="rb-vacm-sheet-body rb-vacm-roomside" data-side={sideNow()}>
          <Show when={rooms().length && wear().length}>
            <div class="rb-vac-tabs" role="tablist" data-side={sideNow()}>
              <span class="rb-vac-tabs-glide" aria-hidden="true" />
              <button role="tab" aria-selected={sideNow() === "rooms"} onClick={() => setSide("rooms")}>
                <Icon icon="mdi:floor-plan" width="16" />
                <span>Rooms</span>
              </button>
              <button role="tab" aria-selected={sideNow() === "wear"} onClick={() => setSide("wear")}>
                <Icon icon="mdi:wrench-outline" width="16" />
                <span>Maintenance</span>
                <Show when={wear().some((item) => item.percent < DUE)}>
                  <i class="rb-vac-tabs-due" />
                </Show>
              </button>
            </div>
          </Show>
          <Show
            when={sideNow() === "wear"}
            fallback={<div class="rb-vac-pane">{roomPicker()}</div>}
          >
            <div class="rb-vac-pane">
              <Maintenance items={wear()} onReset={pressReset} />
            </div>
          </Show>
        </section>
      </Show>

      {/* The rooms and the maintenance, each a sheet over the overlay from
          its button in the control row. */}
      <Show when={sheet()}>
        <div class="rb-vacm-sheet">
          <header class="rb-sheet-head">
            <button class="rb-sheet-back" aria-label="Back" onClick={() => setSheet(undefined)}>
              <Icon icon="mdi:arrow-left" width="18" />
            </button>
            <h2 class="rb-sheet-title rb-truncate">
              {sheet() === "rooms" ? "Room cleaning" : "Maintenance"}
            </h2>
          </header>
          <Show when={sheet() === "rooms"}>
            <div class="rb-vacm-sheet-body">{roomPicker()}</div>
          </Show>
          <Show when={sheet() === "wear"}>
            <div class="rb-vacm-sheet-body">
              <Maintenance items={wear()} onReset={pressReset} />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={status()}>
        <p class="rb-vac-status">{status()}</p>
      </Show>
    </div>
  );

  return phoneView();
}

/**
 * Suction, as a tall slider with a notch for each level the machine has:
 * the strongest at the top. A drag moves between the notches and the machine
 * is told once, when it is let go; a tap on the track moves one notch toward
 * where it landed.
 */
function FanSlider(props: { levels: string[]; value: string; onPick: (value: string) => void }) {
  const [live, setLive] = createSignal<number | undefined>();
  const at = () => {
    const found = props.levels.indexOf(props.value);
    return Math.max(0, found);
  };
  const shown = () => live() ?? at();
  const steps = () => Math.max(1, props.levels.length - 1);
  let track: HTMLDivElement | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settle));

  const read = (event: PointerEvent) => {
    if (!track) return shown();
    const box = track.getBoundingClientRect();
    const fraction = 1 - (event.clientY - box.top) / box.height;
    return Math.round(Math.max(0, Math.min(1, fraction)) * steps());
  };

  const name = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

  return (
    <div class="rb-fan">
      <span class="rb-fan-end">{name(props.levels.at(-1) ?? "")}</span>
      <div
        ref={track}
        class="rb-fan-track"
        role="slider"
        tabindex="0"
        aria-label="Suction"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={steps()}
        aria-valuenow={shown()}
        aria-valuetext={props.levels[shown()]}
        style={{ "--f": `${shown() / steps()}` }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          clearTimeout(settle);
          event.currentTarget.setPointerCapture(event.pointerId);
          setLive(read(event));
        }}
        onPointerMove={(event) => {
          if (live() !== undefined && event.buttons) setLive(read(event));
        }}
        onPointerUp={() => {
          const index = live();
          if (index === undefined) return;
          const level = props.levels[index];
          if (level && level !== props.value) props.onPick(level);
          settle = setTimeout(() => setLive(undefined), 1500);
        }}
        onPointerCancel={() => setLive(undefined)}
        onKeyDown={(event) => {
          const delta = keyStep(event.key);
          if (!delta) return;
          event.preventDefault();
          const index = Math.max(0, Math.min(steps(), shown() + delta));
          const level = props.levels[index];
          if (level) props.onPick(level);
        }}
      >
        <For each={props.levels}>{(_, i) => <i class="rb-fan-notch" style={{ "--n": `${i() / steps()}` }} />}</For>
        <span class="rb-fan-fill" />
        <span class="rb-fan-knob" />
      </div>
      <span class="rb-fan-end">{name(props.levels[0] ?? "")}</span>
      <span class="rb-fan-value">
        <b>{name(props.levels[shown()] ?? "")}</b>
        <small>Suction</small>
      </span>
    </div>
  );
}

/**
 * One part's remaining life.
 *
 * A ring rather than a bar: it reads as "how much is left in this thing" at a
 * glance and packs into a grid, where four full-width bars wanted a column of
 * their own. Reset asks twice — on a wall tablet a stray thumb should not tell
 * the robot its brush is new.
 */
/** Below this much life left, a part is due: amber in the list, a dot on the wrench. */
const DUE = 20;

/**
 * The parts and how much life each has left: the most worn first, each a row
 * with a slim bar in its own colour on the wear ramp, and a line at the top
 * that says whether anything needs doing.
 */
function Maintenance(props: { items: Consumable[]; onReset: (entityId: string) => void }) {
  const sorted = () => [...props.items].sort((a, b) => a.percent - b.percent);
  const due = () => props.items.filter((item) => item.percent < DUE).length;
  return (
    <div class="rb-wear">
      <div class="rb-wear-summary" data-due={due() > 0}>
        <span class="rb-wear-summary-icon">
          <Icon icon={due() ? "mdi:alert-circle-outline" : "mdi:check-circle-outline"} width="20" />
        </span>
        <span class="rb-wear-summary-text">
          <b>{due() ? `${due()} ${due() === 1 ? "part needs" : "parts need"} attention` : "All parts in good shape"}</b>
          <small>
            {due()
              ? "Replace or clean it, then reset its counter."
              : `${props.items.length} parts tracked · the lowest at ${Math.round(sorted()[0]?.percent ?? 100)}%`}
          </small>
        </span>
      </div>
      <ul class="rb-wear-list">
        <For each={sorted()}>{(item) => <WearRow item={item} onReset={props.onReset} />}</For>
      </ul>
    </div>
  );
}

function WearRow(props: { item: Consumable; onReset: (entityId: string) => void }) {
  const [armed, setArmed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const percent = () => Math.max(0, Math.min(100, props.item.percent));

  const reset = (event: MouseEvent) => {
    event.stopPropagation();
    const id = props.item.resetId;
    if (!id) return;
    if (!armed()) {
      setArmed(true);
      timer = setTimeout(() => setArmed(false), 3200);
      return;
    }
    clearTimeout(timer);
    setArmed(false);
    props.onReset(id);
  };

  return (
    <li
      class="rb-wear-row"
      data-due={percent() < DUE}
      style={{ "--wear": `${percent()}%`, "--wear-color": wearColor(percent()) }}
    >
      <span class="rb-wear-icon">
        <Icon icon={props.item.icon} width="18" />
      </span>
      <span class="rb-wear-main">
        <span class="rb-wear-line">
          <b class="rb-truncate">{props.item.label}</b>
          <span class="rb-wear-pct">{Math.round(percent())}%</span>
        </span>
        <span class="rb-wear-bar" aria-hidden="true">
          <i />
        </span>
        <span class="rb-wear-detail rb-truncate">{props.item.detail} left</span>
      </span>
      <Show when={props.item.resetId}>
        <button
          class="rb-wear-reset"
          data-armed={armed()}
          aria-label={armed() ? `Confirm reset of ${props.item.label}` : `Reset ${props.item.label}`}
          onClick={reset}
        >
          <Icon icon={armed() ? "mdi:check" : "mdi:restart"} width="14" />
          <span>{armed() ? "Sure?" : "Reset"}</span>
        </button>
      </Show>
    </li>
  );
}

