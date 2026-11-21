import { useDomains } from "../domains";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useEntities, useService, type EntityView } from "@glasshome/widget-sdk";
import { numeric, openable, sinceLabel } from "./util";
import { Keyed } from "./keyed";
import { Half } from "./half";

/** HA's lock domain: 1 is "can pull the latch". */
const FEATURE_OPEN = 1;

export const canUnlatch = (entity: EntityView | undefined) =>
  ((entity?.supportedFeatures ?? 0) & FEATURE_OPEN) === FEATURE_OPEN;

/**
 * The room's locks.
 *
 * A lock has more states than on and off — it can be turning, and it can be
 * jammed, which is the one worth knowing about. Jammed sorts first, then
 * unlocked, because a card that leads with "all secure" while the back door
 * is stuck has told you the opposite of what matters.
 */
export type LockState = "locked" | "unlocked" | "moving" | "jammed" | "unknown";

export const stateOf = (entity: EntityView): LockState => {
  switch (entity.state) {
    case "locked":
      return "locked";
    case "unlocked":
    case "open":
      return "unlocked";
    case "locking":
    case "unlocking":
    case "opening":
      return "moving";
    case "jammed":
      return "jammed";
    default:
      return "unknown";
  }
};

const RANK: Record<LockState, number> = {
  jammed: 0,
  unlocked: 1,
  moving: 2,
  unknown: 3,
  locked: 4,
};

export const sortLocks = (locks: EntityView[]) =>
  [...locks].sort(
    (a, b) =>
      RANK[stateOf(a)] - RANK[stateOf(b)] ||
      (a.friendlyName ?? a.id).localeCompare(b.friendlyName ?? b.id),
  );

const LABEL: Record<LockState, string> = {
  locked: "Locked",
  unlocked: "Unlocked",
  moving: "Turning",
  jammed: "Jammed",
  unknown: "Unknown",
};

/**
 * The lock, built as the one on the door.
 *
 * A Nuki is not a padlock: it is a rounded body sitting over the euro
 * cylinder with a turning knob on its face and a ring of light around it.
 * That is what this draws — the collar where it meets the door, the body,
 * the knob with its turn mark, and the ring, which is the part that actually
 * tells you anything from the hallway. Built from spans and gradients the
 * same way the light card's pendant is.
 */
function LockKnob(props: { state: LockState }) {
  return (
    <div class="rb-lock-art" data-state={props.state} aria-hidden="true">
      <span class="rb-lock-shadow" />
      <span class="rb-sl-lock">
        <span class="rb-sl-body">
          <i class="rb-sl-dial">
            <b class="rb-sl-ring" />
            <b class="rb-sl-turn">
              <i class="rb-sl-mark" />
            </b>
          </i>
          <i class="rb-sl-badge" />
          <i class="rb-sl-gloss" />
        </span>
      </span>
    </div>
  );
}

/**
 * What the lock's own device says beyond locked or not.
 *
 * Nuki publishes the battery, whether it is critical, and — where the door
 * sensor is fitted — whether the door is actually shut, all as separate
 * entities named after the lock. Found by that name rather than configured,
 * the same way the vacuum's battery and the camera's sensors are.
 */
export type LockExtras = {
  battery?: number;
  batteryCritical: boolean;
  doorOpen?: boolean;
  others: EntityView[];
};

export function useLockExtras(lock: () => EntityView | undefined) {
  const domains = useDomains();
  /* Matched on the lock's own device, not on a name that happens to start the
     same way: "lock.home…" pulled in Home Assistant's own CPU, memory and
     supervisor sensors, which have nothing to do with a door. Only where the
     lock reports no device at all does the name get a look, and then only for
     the two readings a lock actually publishes. */
  /* Only the sensors named after the lock are subscribed to, and the device
     check below narrows those. Handing every sensor in the house to
     useEntities to find the device's two made the board follow them all. */
  const ids = () => {
    const slug = (lock()?.id ?? "").split(".")[1] ?? "";
    if (!slug) return [];
    const pool = [...(domains().sensor ?? []), ...(domains().binary_sensor ?? [])];
    return pool.filter((id) => (id.split(".")[1] ?? "").startsWith(`${slug}_`));
  };

  const companions = useEntities(ids);

  return (): LockExtras => {
    const device = lock()?.deviceId;
    const list = device
      ? companions().filter((entity) => entity.deviceId === device)
      : companions();
    const battery = list.find((entity) => entity.deviceClass === "battery");
    const critical = list.find((entity) => /battery.?critical|critical.?battery/i.test(entity.id));
    const door = list.find(
      (entity) => entity.domain === "binary_sensor" && entity.deviceClass === "door",
    );

    return {
      battery: numeric(battery),
      batteryCritical: critical?.state === "on",
      doorOpen: door ? door.state === "on" : undefined,
      /* Only what belongs to a lock: how it is connected, and whether it is
         reachable. Anything else the device publishes is diagnostics, and a
         room board is not a diagnostics page. */
      others: list.filter(
        (entity) =>
          entity !== battery &&
          entity !== critical &&
          entity !== door &&
          !entity.entityCategory &&
          ["connectivity", "signal_strength", "problem", "tamper"].includes(
            entity.deviceClass ?? "",
          ) &&
          !["unknown", "unavailable"].includes(entity.state),
      ),
    };
  };
}

/** Green at full through amber to red, the ramp the rest of the board uses. */
const batteryColour = (percent: number) =>
  `hsl(${Math.round(Math.max(0, Math.min(140, percent * 1.4)))} 74% 52%)`;

/**
 * The board card: whether the room is shut, and the one safe action.
 *
 * The knob leads the card rather than floating in its corner — it is the
 * thing being reported, so it sits where the eye starts, with the state
 * beside it and the battery of that lock where a battery belongs: next to
 * the lock it will run out on.
 */
export function LockCard(props: { locks: EntityView[]; onOpen: () => void }) {
  const { callService } = useService();
  const ordered = createMemo(() => sortLocks(props.locks));

  /* Worst first, so the card opens on the lock worth knowing about — and
     paging is from there. */
  const [at, setAt] = createSignal(0);
  const index = () => Math.min(at(), Math.max(0, ordered().length - 1));
  const lock = () => ordered()[index()];
  const extras = useLockExtras(lock);

  const state = () => (lock() ? stateOf(lock()!) : "unknown");

  const step = (delta: number) => {
    const count = ordered().length;
    if (count < 2) return;
    setAt((was) => (was + delta + count) % count);
  };

  /* Swipe to page, tap to open. A drag that travels far enough sideways
     swallows the click behind it, so paging never opens the overlay. */
  let start: { x: number; y: number } | undefined;
  let swiped = false;

  const onPointerDown = (event: PointerEvent) => {
    start = { x: event.clientX, y: event.clientY };
    swiped = false;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = undefined;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    swiped = true;
    step(dx < 0 ? 1 : -1);
  };

  const verdict = () => {
    const current = lock();
    if (!current) return "";
    return [
      current.friendlyName ?? current.id,
      sinceLabel(current.lastChanged),
      extras().doorOpen === true ? "door open" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };

  /* Locking is the safe direction, so it is the button. Unlocking a door from
     a wall tablet is a deliberate act and lives in the overlay behind a
     confirm. */
  const lockIt = (event: Event) => {
    event.stopPropagation();
    const id = lock()?.id;
    if (id) void callService("lock", "lock", {}, { entity_id: id });
  };

  return (
    <article
      class="rb-card rb-card--lock"
      data-state={state()}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      {...openable(() => {
        if (swiped) {
          swiped = false;
          return;
        }
        props.onOpen();
      }, "Locks")}
    >
      {/* Behind the card in the corner, the way the vacuum's robot is: the
          lock is the card's illustration, not a member of its layout. */}
      <LockKnob state={state()} />

      <div class="rb-lock-top">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">{LABEL[state()]}</h3>
          <span class="rb-card-verdict rb-truncate">{verdict()}</span>

          {/* Which of them you are looking at, under the state it belongs to
              rather than floating opposite it. */}
          <Show when={ordered().length > 1}>
            <span class="rb-lock-count">
              {index() + 1}/{ordered().length}
            </span>
          </Show>
        </div>

        <div class="rb-lock-badges">
          {/* The battery of the lock on screen — a dying Nuki is what turns
              "locked" into a problem tomorrow. */}
          <Show when={extras().battery !== undefined}>
            <span
              class="rb-lock-batt"
              data-warn={extras().batteryCritical || (extras().battery ?? 100) < 20}
              style={{ "--batt": batteryColour(extras().battery!) }}
            >
              <Icon icon="mdi:battery" width="13" />
              <b>{Math.round(extras().battery!)}%</b>
            </span>
          </Show>
        </div>
      </div>

      <div class="rb-lock-row">
        <Show when={state() !== "locked"}>
          <button class="rb-lock-go" aria-label="Lock this" onClick={lockIt}>
            <Icon icon="mdi:lock" width="16" />
            <span>Lock</span>
          </button>
        </Show>
      </div>
      <Half art={<LockKnob state={state()} />} icon={state() === "locked" ? "mdi:lock" : "mdi:lock-open-variant"} name={lock()?.friendlyName ?? "Lock"} status={state() === "locked" ? "Locked" : state() === "unlocked" ? "Unlocked" : state()} tone={state() === "locked" ? "#22c55e" : "#fb923c"} lit={state() !== "locked"} />
    </article>
  );
}

/**
 * One lock in the overlay: what it is doing, what its device knows, and the
 * three things it can be told.
 */
function LockRow(props: { lock: EntityView; armed: string | undefined; onArm: (id: string) => void }) {
  const { callService } = useService();
  const extras = useLockExtras(() => props.lock);

  const state = () => stateOf(props.lock);
  const call = (service: string) =>
    void callService("lock", service, {}, { entity_id: props.lock.id });

  return (
    <div class="rb-lock-row-card" data-state={state()}>
      <div class="rb-lock-head">
        <LockKnob state={state()} />

        <div class="rb-lock-meta">
          <span class="rb-lock-name rb-truncate">{props.lock.friendlyName ?? props.lock.id}</span>
          <span class="rb-lock-state">
            {LABEL[state()]} · {sinceLabel(props.lock.lastChanged)}
          </span>
        </div>
      </div>

      {/* What the device knows besides the bolt: the battery, and whether the
          door is even shut — a locked bolt on an open door is worth seeing. */}
      <div class="rb-lock-facts">
        <Show when={extras().battery !== undefined}>
          <span
            class="rb-lock-fact"
            data-warn={extras().batteryCritical || (extras().battery ?? 100) < 20}
            style={{ "--batt": batteryColour(extras().battery!) }}
          >
            <Icon icon="mdi:battery" width="14" />
            <b>{Math.round(extras().battery!)}%</b>
            <Show when={extras().batteryCritical}>
              <span>critical</span>
            </Show>
          </span>
        </Show>

        <Show when={extras().doorOpen !== undefined}>
          <span class="rb-lock-fact" data-warn={extras().doorOpen}>
            <Icon icon={extras().doorOpen ? "mdi:door-open" : "mdi:door-closed"} width="14" />
            <b>{extras().doorOpen ? "Door open" : "Door closed"}</b>
          </span>
        </Show>

        <For each={extras().others.slice(0, 3)}>
          {(entity) => (
            <span class="rb-lock-fact">
              <span class="rb-truncate">{entity.friendlyName ?? entity.id}</span>
              <b>
                {entity.state}
                {entity.unitOfMeasurement ? ` ${entity.unitOfMeasurement}` : ""}
              </b>
            </span>
          )}
        </For>
      </div>

      <div class="rb-lock-keys">
        <Show when={state() !== "locked"}>
          <button class="rb-lock-key rb-lock-key--go" onClick={() => call("lock")}>
            <Icon icon="mdi:lock" width="16" />
            <span>Lock</span>
          </button>
        </Show>

        <Show when={state() !== "unlocked"}>
          <button
            class="rb-lock-key"
            data-armed={props.armed === `unlock:${props.lock.id}`}
            onClick={() => {
              if (props.armed === `unlock:${props.lock.id}`) call("unlock");
              else props.onArm(`unlock:${props.lock.id}`);
            }}
          >
            <Icon
              icon={props.armed === `unlock:${props.lock.id}` ? "mdi:check" : "mdi:lock-open-variant"}
              width="16"
            />
            <span>{props.armed === `unlock:${props.lock.id}` ? "Sure?" : "Unlock"}</span>
          </button>
        </Show>

        {/* Unlatch pulls the door open rather than just freeing the bolt, so
            it asks twice as well — and only appears where the lock can do it. */}
        <Show when={canUnlatch(props.lock)}>
          <button
            class="rb-lock-key"
            data-armed={props.armed === `open:${props.lock.id}`}
            onClick={() => {
              if (props.armed === `open:${props.lock.id}`) call("open");
              else props.onArm(`open:${props.lock.id}`);
            }}
          >
            <Icon
              icon={props.armed === `open:${props.lock.id}` ? "mdi:check" : "mdi:door-open"}
              width="16"
            />
            <span>{props.armed === `open:${props.lock.id}` ? "Sure?" : "Unlatch"}</span>
          </button>
        </Show>
      </div>
    </div>
  );
}

/** The overlay: every lock, with unlocking kept behind a second tap. */
export function LockPanel(props: { locks: EntityView[] }) {
  const { callService } = useService();
  const ordered = createMemo(() => sortLocks(props.locks));

  const [armed, setArmed] = createSignal<string | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  /* One armed action at a time, and it disarms itself: a confirm left waiting
     on a wall tablet is a confirm somebody else will press. */
  const arm = (key: string) => {
    setArmed(key);
    clearTimeout(timer);
    timer = setTimeout(() => setArmed(undefined), 3500);
  };

  const open = () => ordered().filter((lock) => stateOf(lock) !== "locked");

  return (
    <div class="rb-lock-panel">
      <Show when={ordered().length} fallback={<p class="rb-act-none">This room has no locks.</p>}>
        <Show when={open().length > 1}>
          <div class="rb-lock-all">
            <span class="rb-truncate">{open().length} not locked</span>
            <button
              class="rb-lock-key rb-lock-key--go"
              onClick={() =>
                void callService("lock", "lock", {}, {
                  entity_id: open().map((lock) => lock.id),
                })
              }
            >
              <Icon icon="mdi:lock" width="16" />
              <span>Lock all</span>
            </button>
          </div>
        </Show>

        <div class="rb-lock-rows">
          <Keyed each={ordered()}>
            {(entity) => <LockRow lock={entity} armed={armed()} onArm={arm} />}
          </Keyed>
        </div>
      </Show>
    </div>
  );
}
