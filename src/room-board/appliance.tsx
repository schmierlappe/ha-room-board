import { For, Show, createUniqueId } from "solid-js";
import type { EntityView } from "@glasshome/widget-sdk";
import { numeric, openable } from "./util";

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
  /** Everything the device publishes, for the overlay's list. */
  all: EntityView[];
};

const ROLES: [keyof Appliance, RegExp][] = [
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
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
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

/**
 * The board card.
 *
 * Stacked rather than side by side: on a one-column tile a machine drawn
 * beside its own name left both of them too narrow — the name came out as
 * "Washin…" over two lines that both said "Off". The machine gets the middle
 * of the card, the name gets the full width above it, and the line
 * underneath is whatever is actually worth saying: how long is left while it
 * runs, the programme when one is set, and nothing at all when it is asleep.
 */
export function ApplianceCard(props: { machine: Appliance; onOpen: () => void }) {
  const machine = () => props.machine;
  const running = () => isRunning(machine());
  const done = () => isDone(machine());
  const spinning = () => /spin/i.test(machine().phase?.state ?? "");
  const percent = () => progressOf(machine());

  const state = () => label(machine().state?.state) || "Off";

  /* One line, and the time left is on it while the machine runs: a second
     line under the drawing shrank the machine to two thirds of its size on
     exactly the cards where it is doing something worth seeing. */
  const verdict = () => {
    if (done()) return "Ready to unload";
    const phase = machine().phase;
    const hasPhase = meaningful(phase, machine().state?.state ?? "");
    const left = running() ? timeLeft(machine().remaining) : "";
    if (left) return `${hasPhase ? label(phase!.state) : state()} · ${left} left`;
    return hasPhase ? `${state()} · ${label(phase!.state)}` : state();
  };

  /* The programme, for a standing card, which has the height for a line
     under the machine (the stylesheet shows it only there). */
  const program = () =>
    running() && meaningful(machine().program, machine().state?.state ?? "")
      ? label(machine().program!.state)
      : "";

  return (
    <article
      class="rb-card rb-card--wash"
      data-card={`wash:${props.machine.key}`}
      data-on={running()}
      data-done={done()}
      {...openable(props.onOpen, "Laundry")}
    >
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">{machine().name}</h3>
          <span class="rb-card-verdict rb-truncate">{verdict()}</span>
        </div>
      </header>

      {/* How far through is the arc round the door now, not a bar under it. */}
      <div class="rb-wash-stage">
        <Washer
          kind={kindOf(machine())}
          running={running()}
          spinning={spinning()}
          done={done()}
          progress={percent()}
        />
      </div>

      <Show when={program()}>
        <span class="rb-wash-line rb-truncate">{program()}</span>
      </Show>
    </article>
  );
}

/** The overlay: the machine at size, and everything it reports. */
export function AppliancePanel(props: { machines: Appliance[] }) {
  const readings = (machine: Appliance) =>
    machine.all
      .filter((entity) => known(entity))
      .sort((a, b) => (a.friendlyName ?? a.id).localeCompare(b.friendlyName ?? b.id));

  return (
    <div class="rb-wash-panel">
      <For each={props.machines}>
        {(machine) => {
          const running = isRunning(machine);
          const done = isDone(machine);
          const percent = progressOf(machine);

          return (
            <section class="rb-wash-block" data-on={running} data-done={done}>
              <div class="rb-wash-hero">
                <Washer
                  kind={kindOf(machine)}
                  running={running}
                  spinning={/spin/i.test(machine.phase?.state ?? "")}
                  done={done}
                  progress={percent}
                />

                <div class="rb-wash-hero-meta">
                  <h3 class="rb-wash-name">{machine.name}</h3>
                  <span class="rb-wash-state">
                    {done ? "Ready to unload" : label(machine.state?.state)}
                  </span>

                  <Show when={percent !== undefined}>
                    <span class="rb-wash-bar rb-wash-bar--lg" aria-hidden="true">
                      <i style={{ width: `${percent}%` }} />
                    </span>
                    <span class="rb-wash-numbers">
                      <span>{Math.round(percent!)}%</span>
                      <Show when={timeLeft(machine.remaining)}>
                        <span>{timeLeft(machine.remaining)} left</span>
                      </Show>
                    </span>
                  </Show>
                </div>
              </div>

              <div class="rb-cam-readings">
                <For each={readings(machine)}>
                  {(entity) => (
                    <span class="rb-cam-reading">
                      <span class="rb-truncate">{entity.friendlyName ?? entity.id}</span>
                      <b>
                        {label(entity.state)}
                        {entity.unitOfMeasurement ? ` ${entity.unitOfMeasurement}` : ""}
                      </b>
                    </span>
                  )}
                </For>
              </div>
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
