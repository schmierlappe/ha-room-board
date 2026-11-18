/**
 * Home Assistant's state as a Solid store, fed from the card's `hass` object.
 *
 * Home Assistant hands a card a new `hass` on every change, but keeps the
 * objects inside it that did not change: a state object is replaced only when
 * that entity changed, a registry map only when the registry did. So each
 * update compares by identity and writes only what is new, and a component
 * reading one entity is woken only by that entity.
 */
import { batch, createSignal, type Accessor, type Setter } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export type HassEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
  context?: { id: string; parent_id: string | null; user_id: string | null };
};

/** An entity registry entry as the SDK's widgets read it. */
export type RegistryEntry = {
  entity_id: string;
  name?: string | null;
  icon?: string | null;
  platform?: string;
  device_id?: string | null;
  area_id?: string | null;
  labels?: string[];
  hidden_by?: string | null;
  disabled_by?: string | null;
  entity_category?: string | null;
  translation_key?: string | null;
};

export type DeviceEntry = {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  area_id?: string | null;
  via_device_id?: string | null;
  configuration_url?: string | null;
};

export type AreaEntry = {
  area_id: string;
  name: string;
  icon?: string | null;
  picture?: string | null;
  floor_id?: string | null;
  aliases?: string[];
  temperature_entity_id?: string | null;
  humidity_entity_id?: string | null;
};

/** The parts of Home Assistant's frontend `hass` object this card reads. */
export type Hass = {
  states: Record<string, HassEntity>;
  entities?: Record<string, any>;
  devices?: Record<string, any>;
  areas?: Record<string, any>;
  config?: Record<string, any>;
  themes?: { darkMode?: boolean };
  locale?: { language?: string; time_format?: string };
  language?: string;
  user?: { id: string; name: string };
  connection: {
    sendMessagePromise<T = any>(message: Record<string, unknown>): Promise<T>;
    subscribeMessage<T = any>(callback: (message: T) => void, message: Record<string, unknown>): Promise<() => void>;
  };
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, unknown>,
    notifyOnError?: boolean,
    returnResponse?: boolean,
  ): Promise<any>;
  callApi<T = any>(method: "GET" | "POST", path: string, data?: Record<string, unknown>): Promise<T>;
  hassUrl?(path?: string): string;
};

export type State = {
  entityRegistry: Record<string, RegistryEntry>;
  devices: Record<string, DeviceEntry>;
  areas: Record<string, AreaEntry>;
  config: Record<string, any>;
  dark: boolean;
  language: string;
};

const [state, setState] = createStore<State>({
  entityRegistry: {},
  devices: {},
  areas: {},
  config: {},
  dark: true,
  language: "en",
});

export { state };

/* The entities are kept apart from the store: a store merges a new object
   into the old one when it is set, so an entity's view would not change and
   an attribute Home Assistant dropped would stay. Here each entity is a
   signal holding Home Assistant's own state object, replaced whole, and a
   separate signal changes only when entities come or go. */
let rawStates: Record<string, HassEntity> = {};
const entitySignals = new Map<string, [Accessor<HassEntity | undefined>, Setter<HassEntity | undefined>]>();
const [idsVersion, bumpIds] = createSignal(0);

function signalFor(id: string) {
  let found = entitySignals.get(id);
  if (!found) {
    found = createSignal<HassEntity | undefined>(rawStates[id], { equals: (a, b) => a === b });
    entitySignals.set(id, found);
  }
  return found;
}

/** An entity's state object, reactive to that entity alone. */
export function entity(id: string): HassEntity | undefined {
  return signalFor(id)[0]();
}

/** Whether an entity exists, reactive only to entities coming or going. */
export function hasEntity(id: string): boolean {
  idsVersion();
  return id in rawStates;
}

/** Every entity id, reactive only to entities coming or going. */
export function entityIds(): string[] {
  idsVersion();
  return Object.keys(rawStates);
}

let current: Hass | undefined;
let lastStates: Hass["states"] | undefined;
let lastEntities: unknown;
let lastDevices: unknown;
let lastAreas: unknown;

/** The `hass` the card was last given: for service calls and the websocket. */
export function hass(): Hass {
  if (!current) throw new Error("Home Assistant is not connected yet");
  return current;
}

export function hasHass(): boolean {
  return current !== undefined;
}

/** Takes in a new `hass`, writing only what changed since the last one. */
export function applyHass(next: Hass): void {
  const previous = current;
  current = next;
  batch(() => {
    if (next.states !== lastStates) {
      const before = rawStates;
      rawStates = next.states;
      let keysChanged = false;
      for (const [id, raw] of Object.entries(next.states)) {
        if (before[id] === raw) continue;
        if (!(id in before)) keysChanged = true;
        entitySignals.get(id)?.[1](() => raw);
      }
      for (const id of Object.keys(before)) {
        if (id in next.states) continue;
        keysChanged = true;
        entitySignals.get(id)?.[1](undefined);
      }
      if (keysChanged) bumpIds((n) => n + 1);
      lastStates = next.states;
    }
    if (next.entities !== lastEntities) {
      setState("entityRegistry", reconcile(registryOf(next.entities ?? {})));
      lastEntities = next.entities;
    }
    if (next.devices !== lastDevices) {
      setState("devices", reconcile({ ...(next.devices ?? {}) } as Record<string, DeviceEntry>));
      lastDevices = next.devices;
    }
    if (next.areas !== lastAreas) {
      setState("areas", reconcile({ ...(next.areas ?? {}) } as Record<string, AreaEntry>));
      lastAreas = next.areas;
    }
    if (!previous || previous.config !== next.config) setState("config", reconcile({ ...(next.config ?? {}) }));
    const dark = next.themes?.darkMode ?? true;
    if (state.dark !== dark) setState("dark", dark);
    const language = next.locale?.language ?? next.language ?? "en";
    if (state.language !== language) setState("language", language);
  });
}

/** Home Assistant's display registry (`hass.entities`) in the shape the
    widgets read: disabled entities are not in it at all. */
function registryOf(entries: Record<string, any>): Record<string, RegistryEntry> {
  const out: Record<string, RegistryEntry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    out[id] = {
      entity_id: id,
      name: entry.name ?? null,
      icon: entry.icon ?? null,
      platform: entry.platform,
      device_id: entry.device_id ?? null,
      area_id: entry.area_id ?? null,
      labels: entry.labels ?? [],
      hidden_by: entry.hidden ? "user" : null,
      disabled_by: null,
      entity_category: entry.entity_category ?? null,
      translation_key: entry.translation_key ?? null,
    };
  }
  return out;
}
