import { For, Show, createEffect, createSignal, createUniqueId, on } from "solid-js";
import { Icon, useService } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { numeric, openable, sinceLabel } from "./util";
import { Half } from "./half";

/**
 * A washing machine, out of the pile of sensors an appliance integration
 * publishes.
 *
 * Home Assistant gives a machine no single entity — it gives a dozen, named
 * State, Program, Progress, Time Remaining and so on, tied together only by
 * the device they belong to. So the card groups by device and picks the roles
 * it knows by name, which means a machine appears on the board the moment its
 * integration is set up, with nothing to configure.
 */
export type Appliance = {
  key: string;
  name: string;
  state?: EntityView;
  program?: EntityView;
  phase?: EntityView;
  progress?: EntityView;
  remaining?: EntityView;
  duration?: EntityView;
  power?: EntityView;
  energy?: EntityView;
  running?: EntityView;
  /* What WashData and its like add: the run so far and the last one. */
  elapsed?: EntityView;
  cycles?: EntityView;
  maintenance?: EntityView;
  lastStart?: EntityView;
  lastDuration?: EntityView;
  lastEnergy?: EntityView;
  /** WashData's "Mark unloaded" button: offered while the integration enables it. */
  unload?: EntityView;
  /** Everything the device publishes, for the overlay's list. */
  all: EntityView[];
};

const ROLES: [keyof Appliance, RegExp][] = [
  /* The last run's before the general ones: "last_cycle_energy" also ends in
     "energy", "last_cycle_duration" in "duration". */
  ["lastStart", /last_cycle_start$/],
  ["lastDuration", /last_cycle_duration$/],
  ["lastEnergy", /last_cycle_energy$/],
  ["elapsed", /elapsed(_time)?$/],
  ["cycles", /cycle_count$/],
  ["maintenance", /maintenance(_due)?$/],
  ["phase", /(current_)?phase$/],
  ["progress", /progress$/],
  ["remaining", /(time_)?remaining$/],
  ["duration", /(total_)?duration$/],
  ["power", /power$/],
  ["energy", /energy(_total)?$/],
  ["running", /running$/],
  ["program", /program$/],
  ["state", /state$/],
];

/** "washing_machine_time_remaining" → "washing_machine". */
const deviceSlug = (entity: EntityView) => {
  const slug = entity.id.split(".")[1] ?? "";
  for (const [, pattern] of ROLES) {
    const match = new RegExp(`^(.*?)_?${pattern.source}`).exec(slug);
    if (match?.[1]) return match[1];
  }
  return slug;
};

const titleCase = (slug: string) =>
  slug.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());

/** The room's sensors by the device they belong to — or, without one, by
    the name they share. */
function sensorsByDevice(entities: EntityView[]): Map<string, EntityView[]> {
  const groups = new Map<string, EntityView[]>();
  for (const entity of entities) {
    if (entity.domain !== "sensor" && entity.domain !== "binary_sensor") continue;
    if (entity.entityCategory || entity.isHidden) continue;
    const key = entity.deviceId ?? deviceSlug(entity);
    const list = groups.get(key) ?? [];
    list.push(entity);
    groups.set(key, list);
  }
  return groups;
}

/** A device's sensors read into its parts: the first that matches each role. */
function machineOf(key: string, list: EntityView[]): Appliance {
  const machine: Appliance = { key, name: "", all: list };
  for (const entity of list) {
    const slug = entity.id.split(".")[1] ?? "";
    const role = ROLES.find(([r, pattern]) => !machine[r] && pattern.test(slug))?.[0];
    if (role) (machine as Record<string, unknown>)[role] = entity;
  }
  return machine;
}

/** Machines are the devices that report both a state and a run. */
export function appliancesOf(entities: EntityView[]): Appliance[] {
  const found: Appliance[] = [];
  for (const [key, list] of sensorsByDevice(entities)) {
    const machine = machineOf(key, list);
    // A machine is a thing with a state and a job to be part-way through.
    if (!machine.state || !(machine.progress || machine.remaining || machine.program)) continue;
    machine.name = titleCase(deviceSlug(machine.state));
    found.push(machine);
  }
  /* The "unloaded" button sits on the same device, as a button. */
  for (const entity of entities) {
    if (entity.domain !== "button" || entity.isHidden) continue;
    if (!/(mark_)?unload(ed)?$/.test(entity.id.split(".")[1] ?? "")) continue;
    const key = entity.deviceId ?? deviceSlug(entity);
    const machine = found.find((m) => m.key === key);
    if (machine && !machine.unload) machine.unload = entity;
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

/** Waiting to be emptied: WashData enables its button only then. */
export const canUnload = (machine: Appliance) =>
  /* A button's state is when it was last pressed, "unknown" if never —
     either way available; "unavailable" is the integration saying not now. */
  !!machine.unload && machine.unload.state !== "unavailable" && !isRunning(machine);

/**
 * "Mark unloaded": presses the integration's button, so its count of what
 * waits in the drum is right — and the card goes back to sleep. Inside a card
 * that opens its overlay on a tap, so the tap stops here.
 */
function UnloadButton(props: { machine: Appliance; size?: "lg" }) {
  const { callService } = useService();
  const [pressed, setPressed] = createSignal(false);
  /* Back to normal once Home Assistant reports the press (or the machine moves on). */
  createEffect(on(() => `${props.machine.unload?.lastChanged}${props.machine.state?.state}`, () => setPressed(false), { defer: true }));
  const stop = (event: Event) => event.stopPropagation();
  return (
    <button
      class="rb-wash-unload"
      data-size={props.size}
      data-pressed={pressed()}
      disabled={pressed()}
      onPointerDown={stop}
      onKeyDown={stop}
      onClick={(event) => {
        event.stopPropagation();
        if (!props.machine.unload) return;
        setPressed(true);
        void callService("button", "press", {}, { entity_id: props.machine.unload.id });
      }}
    >
      <Icon icon={pressed() ? "mdi:check" : "mdi:basket-check-outline"} width={props.size === "lg" ? "18" : "15"} />
      <span>{pressed() ? "Unloaded" : "Mark unloaded"}</span>
    </button>
  );
}

/* ---------- what it is doing ---------- */

const RUNNING = new Set(["running", "run", "washing", "on", "in_use", "active"]);
const DONE = new Set(["finished", "complete", "completed", "ready", "done"]);

export const isRunning = (machine: Appliance) => {
  const state = (machine.state?.state ?? "").toLowerCase();
  if (RUNNING.has(state)) return true;
  return machine.running?.state === "on" && !DONE.has(state);
};

export const isDone = (machine: Appliance) =>
  DONE.has((machine.state?.state ?? "").toLowerCase());

const label = (value: string | undefined) =>
  (value ?? "").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());

/** A reading that is only ever "Unknown" while the machine sleeps. */
const ASLEEP = new Set(["unknown", "unavailable", "none", ""]);
const known = (entity: EntityView | undefined) => !!entity && !ASLEEP.has(entity.state.toLowerCase());

/** Minutes or seconds, whichever the integration chose, as "1 h 05" or "42 min". */
export function timeLeft(entity: EntityView | undefined): string {
  if (!known(entity)) return "";
  const raw = numeric(entity);
  if (raw === undefined) return entity!.state;

  const unit = entity!.unitOfMeasurement ?? "";
  const minutes = /^s(ec)?/i.test(unit) ? Math.round(raw / 60) : Math.round(raw);
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

const progressOf = (machine: Appliance) => {
  const value = numeric(machine.progress);
  return value === undefined ? undefined : Math.max(0, Math.min(100, value));
};

/** A dryer or a washer — read from the name, since both publish the same roles. */
export type MachineKind = "washer" | "dryer";

export const kindOf = (machine: Appliance): MachineKind =>
  /dry|trock|tumble/i.test(`${machine.name} ${machine.key}`) ? "dryer" : "washer";

/**
 * The machine itself, drawn after the real thing: a white front-loader with a
 * chrome door, seen straight on.
 *
 * The two are told apart the way they are in a shop — by the panel along the
 * top and what is behind the glass. The washer has its detergent drawer, a
 * display and a dial, and water in the drum; the dryer has a display and two
 * buttons, a vent at its foot, and a warm light where the water would be.
 *
 * What it is doing is what moves: the load tumbles while it runs and whirls
 * while it spins, the water sloshes or the heat breathes, and how far through
 * it is runs round the door as an arc. Finished, the door ring glows green —
 * the one thing worth seeing from the other end of the flat.
 */
export function Washer(props: {
  kind?: MachineKind;
  running: boolean;
  spinning: boolean;
  done: boolean;
  /** 0–100, drawn round the door. */
  progress?: number;
}) {
  /* Gradients and the clip are referenced by id, and the card and the overlay
     can both be drawing a machine at once — a shared id would have one of
     them painted from whichever mounted last. */
  const body = createUniqueId();
  const panel = createUniqueId();
  const chrome = createUniqueId();
  const glass = createUniqueId();
  const water = createUniqueId();
  const heat = createUniqueId();
  const porthole = createUniqueId();

  const dryer = () => props.kind === "dryer";
  /* The arc round the door: the ring's circumference, less what is still to
     go. r = 15.5, so the full turn is 2π × 15.5. */
  const ARC = 2 * Math.PI * 15.5;

  return (
    <svg
      class="rb-wash-svg"
      viewBox="0 0 64 66"
      data-kind={dryer() ? "dryer" : "washer"}
      data-running={props.running}
      data-spinning={props.spinning}
      data-done={props.done}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fdfdfe" />
          <stop offset="100%" stop-color="#d3d9e0" />
        </linearGradient>
        <linearGradient id={panel} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f1f3f6" />
          <stop offset="100%" stop-color="#dfe4e9" />
        </linearGradient>
        <linearGradient id={chrome} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="45%" stop-color="#a3adb8" />
          <stop offset="70%" stop-color="#e6eaee" />
          <stop offset="100%" stop-color="#8d97a3" />
        </linearGradient>
        <radialGradient id={glass} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stop-color="#3a4756" />
          <stop offset="100%" stop-color="#0f141a" />
        </radialGradient>
        <linearGradient id={water} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7cb7ff" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#2563eb" stop-opacity="0.9" />
        </linearGradient>
        <radialGradient id={heat} cx="50%" cy="60%" r="65%">
          <stop offset="0%" stop-color="#ffb347" stop-opacity="0.85" />
          <stop offset="100%" stop-color="#ff7a18" stop-opacity="0" />
        </radialGradient>
        <clipPath id={porthole}>
          <circle cx="32" cy="39" r="11.4" />
        </clipPath>
      </defs>

      {/* Standing on the card: a soft shadow along its foot. */}
      <ellipse class="rb-wash-shadow" cx="32" cy="63" rx="22" ry="2.2" />

      {/* The cabinet, and the control strip across its top. */}
      <rect x="8" y="4" width="48" height="57" rx="6.5" fill={`url(#${body})`} class="rb-wash-body" />
      <path
        d="M8 17 V10.5 A6.5 6.5 0 0 1 14.5 4 H49.5 A6.5 6.5 0 0 1 56 10.5 V17 Z"
        fill={`url(#${panel})`}
      />
      <line class="rb-wash-seam" x1="8" y1="17" x2="56" y2="17" />

      <Show
        when={dryer()}
        fallback={
          <>
            {/* Washer: detergent drawer, display, dial. */}
            <rect class="rb-wash-drawer" x="12" y="7.5" width="12" height="6" rx="1.4" />
            <line class="rb-wash-handle" x1="15" y1="11.8" x2="21" y2="11.8" />
            <rect class="rb-wash-display" x="27" y="8.5" width="12" height="4.5" rx="1.2" />
            <rect class="rb-wash-readout" x="28.6" y="10" width="5" height="1.5" rx="0.75" />
          </>
        }
      >
        {/* Dryer: display, two buttons, dial. */}
        <rect class="rb-wash-display" x="12" y="8.5" width="13" height="4.5" rx="1.2" />
        <rect class="rb-wash-readout" x="13.6" y="10" width="5.5" height="1.5" rx="0.75" />
        <rect class="rb-wash-button" x="28" y="9.2" width="4.2" height="3" rx="1.5" />
        <rect class="rb-wash-button" x="34" y="9.2" width="4.2" height="3" rx="1.5" />
      </Show>

      <circle cx="48" cy="10.6" r="3.6" fill={`url(#${chrome})`} class="rb-wash-dial" />
      <circle class="rb-wash-dial-cap" cx="48" cy="10.6" r="2.2" />
      <line class="rb-wash-dial-tick" x1="48" y1="8.9" x2="48" y2="9.9" />

      {/* The door: chrome ring, rubber gasket, glass. */}
      <circle cx="32" cy="39" r="15.5" fill={`url(#${chrome})`} class="rb-wash-ring" />
      <circle class="rb-wash-gasket" cx="32" cy="39" r="12.6" />
      <circle cx="32" cy="39" r="11.4" fill={`url(#${glass})`} />

      <g clip-path={`url(#${porthole})`}>
        {/* Behind the glass: water in the washer, warmth in the dryer. */}
        <Show
          when={dryer()}
          fallback={<path class="rb-wash-water" d="M17 41 q7.5 -3.6 15 0 t15 0 V56 H17 Z" fill={`url(#${water})`} />}
        >
          <circle class="rb-wash-heat" cx="32" cy="42" r="12" fill={`url(#${heat})`} />
        </Show>

        {/* The load: three garments turning with the drum. */}
        <g class="rb-wash-load">
          <ellipse cx="26.5" cy="44" rx="4.2" ry="2.6" fill="#f87171" />
          <ellipse cx="36.5" cy="45.5" rx="4.6" ry="2.4" fill="#60a5fa" />
          <ellipse cx="32" cy="34" rx="3.6" ry="2.2" fill="#fbbf24" />
        </g>

        {/* The glass itself: a highlight across its upper left. */}
        <path class="rb-wash-shine" d="M24.5 33.5 A 10 10 0 0 1 33 29" fill="none" stroke-linecap="round" />
      </g>

      {/* How far through, round the door. */}
      <Show when={props.running && props.progress !== undefined}>
        <circle
          class="rb-wash-arc"
          cx="32"
          cy="39"
          r="15.5"
          fill="none"
          stroke-dasharray={`${(ARC * (props.progress ?? 0)) / 100} ${ARC}`}
          transform="rotate(-90 32 39)"
        />
      </Show>

      {/* The dryer's vent grille, along its foot. */}
      <Show when={dryer()}>
        <g class="rb-wash-vent">
          <line x1="24" y1="57" x2="40" y2="57" />
          <line x1="26" y1="59" x2="38" y2="59" />
        </g>
      </Show>
    </svg>
  );
}

/** Whether a reading says anything beyond "the machine is asleep". */
const meaningful = (entity: EntityView | undefined, state: string) => {
  if (!known(entity)) return false;
  const value = entity!.state.toLowerCase();
  return value !== state.toLowerCase() && !["off", "none", "idle", "0"].includes(value);
};

/** Minutes, whichever unit the integration chose. */
const minutesOf = (entity: EntityView | undefined): number | undefined => {
  if (!known(entity)) return undefined;
  const raw = numeric(entity);
  if (raw === undefined) return undefined;
  const unit = entity!.unitOfMeasurement ?? "";
  if (/^s(ec)?/i.test(unit)) return raw / 60;
  if (/^h/i.test(unit)) return raw * 60;
  return raw;
};

/** "38 min" as a number and its unit, for the big figure: "38" "min", "1:05" "h". */
const splitTime = (minutes: number | undefined): [string, string] | undefined => {
  if (minutes === undefined || minutes <= 0) return undefined;
  const m = Math.round(minutes);
  if (m < 60) return [String(m), "min"];
  return [`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, "h"];
};

const spoken = (minutes: number | undefined) => {
  const parts = splitTime(minutes);
  if (!parts) return "";
  return parts[1] === "min" ? `${parts[0]} min` : `${parts[0].replace(":", " h ")}`;
};

/** When it will be done, on the clock: "22:31". */
const readyAt = (minutes: number | undefined) => {
  if (minutes === undefined || minutes <= 0) return "";
  return new Date(Date.now() + minutes * 60_000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

const kwh = (entity: EntityView | undefined) => {
  const value = known(entity) ? numeric(entity) : undefined;
  if (value === undefined) return "";
  return `${value < 10 ? value.toFixed(2) : value.toFixed(value < 100 ? 1 : 0)} kWh`;
};

const watts = (entity: EntityView | undefined) => {
  const value = known(entity) ? numeric(entity) : undefined;
  return value === undefined ? "" : `${Math.round(value)} W`;
};

/** Its colour: water for the washer, warmth for the dryer, green when done. */
const ACCENT: Record<MachineKind, string> = { washer: "#38bdf8", dryer: "#fb923c" };

/** Everything the card and the overlay say about one machine, read once. */
function readMachine(machine: Appliance) {
  const running = isRunning(machine);
  const done = isDone(machine);
  const kind = kindOf(machine);
  const stateText = label(machine.state?.state) || "Off";
  const sleeping = machine.state?.state ?? "";
  const phase = meaningful(machine.phase, sleeping) ? label(machine.phase!.state) : "";
  const program = meaningful(machine.program, sleeping) ? label(machine.program!.state) : "";
  const left = running ? minutesOf(machine.remaining) : undefined;
  const lastStart = known(machine.lastStart) ? machine.lastStart!.state : undefined;
  const due = machine.maintenance?.state === "on";
  return {
    running,
    done,
    kind,
    stateText,
    phase,
    program,
    percent: progressOf(machine),
    left,
    spinning: /spin|schleuder/i.test(machine.phase?.state ?? ""),
    pill: done ? "Ready" : stateText,
    accent: done ? "#22c55e" : ACCENT[kind],
    lastAgo: lastStart ? sinceLabel(lastStart) : "",
    lastDuration: spoken(minutesOf(machine.lastDuration)),
    lastEnergy: kwh(machine.lastEnergy),
    elapsed: spoken(minutesOf(machine.elapsed)),
    power: running ? watts(machine.power) : "",
    cycles: known(machine.cycles) ? numeric(machine.cycles) : undefined,
    energy: kwh(machine.energy),
    due,
    finishedAgo: done ? sinceLabel(machine.state?.lastChanged) : "",
    unload: canUnload(machine),
  };
}

/**
 * The board card: the machine at the left, turning while it runs, with how
 * far it is round its door; at the right the one thing worth reading from
 * across the room — the minutes left and when it will be done, "Ready" once
 * it is, or when it last ran while it sleeps.
 */
export function ApplianceCard(props: { machine: Appliance; onOpen: () => void }) {
  const m = () => readMachine(props.machine);
  const time = () => splitTime(m().left);

  /* The words for the half tile, and for a screen reader on the full one. */
  const verdict = () => {
    const now = m();
    if (now.done) return "Ready to unload";
    if (now.running) {
      const left = spoken(now.left);
      return left ? `${now.phase || now.stateText} · ${left} left` : now.phase || now.stateText;
    }
    return now.lastAgo ? `${now.stateText} · ran ${now.lastAgo}` : now.stateText;
  };

  return (
    <article
      class="rb-card rb-card--wash"
      data-card={`wash:${props.machine.key}`}
      data-kind={m().kind}
      data-on={m().running}
      data-done={m().done}
      style={{ "--wash-accent": m().accent }}
      {...openable(props.onOpen, "Laundry")}
    >
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">{props.machine.name}</h3>
          <span class="rb-wash-pills">
            <span class="rb-wash-pill" data-live={m().running || m().done}>
              <i />
              <span class="rb-truncate">{m().pill}</span>
            </span>
            <Show when={m().due}>
              <span class="rb-wash-care" title="Maintenance due" aria-label="Maintenance due">
                <Icon icon="mdi:wrench-clock" width="12" />
              </span>
            </Show>
          </span>
        </div>
      </header>

      <div class="rb-wash-body" aria-label={verdict()}>
        <div class="rb-wash-stage">
          <Washer kind={m().kind} running={m().running} spinning={m().spinning} done={m().done} progress={m().percent} />
        </div>

        <div class="rb-wash-facts">
          <Show
            when={m().running}
            fallback={
              <Show
                when={m().done}
                fallback={
                  <>
                    <span class="rb-wash-k">{m().lastAgo ? "Last run" : m().stateText}</span>
                    <b class="rb-wash-mid">{m().lastAgo || (m().cycles !== undefined ? `${m().cycles}×` : "—")}</b>
                    <span class="rb-wash-sub">
                      {[m().lastDuration, m().lastEnergy].filter(Boolean).join(" · ") ||
                        (m().cycles !== undefined && m().lastAgo ? `${m().cycles} cycles` : "")}
                    </span>
                  </>
                }
              >
                <span class="rb-wash-k">Finished{m().finishedAgo ? ` ${m().finishedAgo}` : ""}</span>
                <b class="rb-wash-mid rb-wash-ready">
                  <Icon icon="mdi:check-circle" width="18" />
                  Ready
                </b>
                <span class="rb-wash-sub">to unload</span>
              </Show>
            }
          >
            <span class="rb-wash-k rb-truncate">{m().phase || m().stateText}</span>
            <Show
              when={time()}
              fallback={<b class="rb-wash-mid">{m().percent !== undefined ? `${Math.round(m().percent!)}%` : "Running"}</b>}
            >
              {(parts) => (
                <b class="rb-wash-big">
                  {parts()[0]}
                  <small>{parts()[1]}</small>
                </b>
              )}
            </Show>
            <span class="rb-wash-sub">
              {[
                time() && m().percent !== undefined ? `${Math.round(m().percent!)}%` : "",
                readyAt(m().left) ? `ready ${readyAt(m().left)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Show when={m().program || m().power}>
              <span class="rb-wash-tags">
                <Show when={m().program}>
                  <span class="rb-truncate">{m().program}</span>
                </Show>
                <Show when={m().power}>
                  <span>
                    <Icon icon="mdi:flash" width="11" />
                    {m().power}
                  </span>
                </Show>
              </span>
            </Show>
          </Show>
        </div>
      </div>

      {/* Done (or gone quiet with the drum still full): the one thing to do. */}
      <Show when={m().unload}>
        <UnloadButton machine={props.machine} />
      </Show>

      <Show when={m().running && m().percent !== undefined}>
        <span class="rb-wash-track" aria-hidden="true">
          <i style={{ width: `${m().percent}%` }} />
        </span>
      </Show>

      <Half art={<Washer kind={m().kind} running={m().running} spinning={m().spinning} done={m().done} progress={m().percent} />} icon={m().kind === "dryer" ? "mdi:tumble-dryer" : "mdi:washing-machine"} name={props.machine.name ?? "Appliance"} status={verdict()} tone={m().accent} lit={m().running || m().done} value={m().running && m().percent !== undefined ? `${Math.round(m().percent!)}%` : undefined} />
    </article>
  );
}

/** One figure in the overlay's grid. */
function Stat(props: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div class="rb-wash-stat">
      <span class="rb-wash-stat-icon">
        <Icon icon={props.icon} width="16" />
      </span>
      <span class="rb-wash-stat-text">
        <small>{props.label}</small>
        <b class="rb-truncate">{props.value}</b>
        <Show when={props.sub}>
          <span class="rb-truncate">{props.sub}</span>
        </Show>
      </span>
    </div>
  );
}

/** "Washing Machine Current Power" → "Current Power", under the machine's own heading. */
const shortName = (entity: EntityView, machine: Appliance) => {
  const name = entity.friendlyName ?? entity.id;
  const words = machine.name.toLowerCase();
  const trimmed = name.replace(/^laundry\s+/i, "");
  return trimmed.toLowerCase().startsWith(words) ? trimmed.slice(words.length).trim() || name : name;
};

const reading = (entity: EntityView) => {
  if (entity.deviceClass === "timestamp") {
    const since = sinceLabel(entity.state);
    if (since) return since;
  }
  const value = numeric(entity);
  const unit = entity.unitOfMeasurement ?? "";
  if (value !== undefined && /^s$/i.test(unit) && value >= 60) return spoken(value / 60);
  return `${label(entity.state)}${unit ? ` ${unit}` : ""}`;
};

/** The overlay: each machine at size, what it is doing, its last run, and everything it reports. */
export function AppliancePanel(props: { machines: Appliance[] }) {
  const readings = (machine: Appliance) =>
    machine.all
      .filter((entity) => known(entity))
      .sort((a, b) => shortName(a, machine).localeCompare(shortName(b, machine)));

  return (
    <div class="rb-wash-panel">
      <For each={props.machines}>
        {(machine) => {
          const m = () => readMachine(machine);
          const headline = () => {
            const now = m();
            if (now.done) return `Ready to unload${now.finishedAgo ? ` · finished ${now.finishedAgo}` : ""}`;
            if (now.running) return [now.program, now.phase].filter(Boolean).join(" · ") || now.stateText;
            return now.lastAgo ? `Last ran ${now.lastAgo}` : now.stateText;
          };

          return (
            <section
              class="rb-wash-block"
              data-kind={m().kind}
              data-on={m().running}
              data-done={m().done}
              style={{ "--wash-accent": m().accent }}
            >
              <div class="rb-wash-hero">
                <div class="rb-wash-hero-art">
                  <Washer kind={m().kind} running={m().running} spinning={m().spinning} done={m().done} progress={m().percent} />
                </div>

                <div class="rb-wash-hero-meta">
                  <span class="rb-wash-pill" data-live={m().running || m().done}>
                    <i />
                    <span>{m().pill}</span>
                  </span>
                  <h3 class="rb-wash-name">{machine.name}</h3>
                  <span class="rb-wash-state">{headline()}</span>
                  <Show when={m().unload}>
                    <UnloadButton machine={machine} size="lg" />
                  </Show>

                  <Show when={m().running}>
                    <div class="rb-wash-countdown">
                      <Show when={splitTime(m().left)}>
                        {(parts) => (
                          <b class="rb-wash-big">
                            {parts()[0]}
                            <small>{parts()[1]} left</small>
                          </b>
                        )}
                      </Show>
                      <Show when={readyAt(m().left)}>
                        <span class="rb-wash-eta">
                          <Icon icon="mdi:clock-check-outline" width="14" />
                          Ready at <b>{readyAt(m().left)}</b>
                        </span>
                      </Show>
                    </div>
                    <Show when={m().percent !== undefined}>
                      <span class="rb-wash-bar rb-wash-bar--lg" aria-hidden="true">
                        <i style={{ width: `${m().percent}%` }} />
                      </span>
                      <span class="rb-wash-numbers">
                        <span>{Math.round(m().percent!)}% done</span>
                        <Show when={m().elapsed}>
                          <span>{m().elapsed} in</span>
                        </Show>
                      </span>
                    </Show>
                  </Show>
                </div>
              </div>

              <Show when={m().due}>
                <div class="rb-wash-care-banner">
                  <Icon icon="mdi:wrench-clock" width="18" />
                  <span>
                    <b>Maintenance due</b>
                    <small>Time to clean the {m().kind === "dryer" ? "lint filter and condenser" : "drum, filter and drawer"}.</small>
                  </span>
                </div>
              </Show>

              <div class="rb-wash-stats">
                <Show when={m().running && m().power}>
                  <Stat icon="mdi:flash" label="Power now" value={m().power} />
                </Show>
                <Show when={m().running && m().program}>
                  <Stat icon="mdi:tune-variant" label="Programme" value={m().program} />
                </Show>
                <Show when={m().lastAgo || m().lastDuration}>
                  <Stat
                    icon="mdi:history"
                    label="Last run"
                    value={m().lastAgo || m().lastDuration}
                    sub={m().lastAgo ? m().lastDuration : undefined}
                  />
                </Show>
                <Show when={m().lastEnergy}>
                  <Stat icon="mdi:lightning-bolt-outline" label="Last run used" value={m().lastEnergy} />
                </Show>
                <Show when={m().cycles !== undefined}>
                  <Stat icon="mdi:counter" label="Cycles" value={String(m().cycles)} />
                </Show>
                <Show when={m().energy}>
                  <Stat icon="mdi:chart-bar" label="Energy, all time" value={m().energy} />
                </Show>
              </div>

              <details class="rb-wash-all">
                <summary>
                  <Icon icon="mdi:format-list-bulleted" width="14" />
                  All sensors <small>{readings(machine).length}</small>
                  <Icon class="rb-wash-all-caret" icon="mdi:chevron-down" width="16" />
                </summary>
                <div class="rb-cam-readings">
                  <For each={readings(machine)}>
                    {(entity) => (
                      <span class="rb-cam-reading">
                        <span class="rb-truncate">{shortName(entity, machine)}</span>
                        <b>{reading(entity)}</b>
                      </span>
                    )}
                  </For>
                </div>
              </details>
            </section>
          );
        }}
      </For>

      <Show when={!props.machines.length}>
        <p class="rb-act-none">No appliance in this room reports a programme yet.</p>
      </Show>
    </div>
  );
}
