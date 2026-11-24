/**
 * The GlassHome widget SDK's API, on Home Assistant's frontend.
 *
 * Room Board was written as a GlassHome widget. Its code imports
 * "@glasshome/widget-sdk"; the build points that name here (vite.config.ts),
 * so the same code runs as a Home Assistant card. Each export does what the
 * SDK's does, on the `hass` object the card is given (./store.ts) instead of
 * GlassHome's own connection.
 *
 * The config schema helpers (`field`) follow @glasshome/widget-sdk's, which is
 * MIT licensed (Copyright (c) 2026 GlassHome Labs), and so is the spline in
 * `monotoneCubicPath`.
 */
import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  untrack,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js";
import { createStore } from "solid-js/store";
import { z } from "zod";
import { entity, entityIds, hasEntity, hass, hasHass, state as store, type HassEntity } from "./store";
import { BRAND_PATHS } from "../media-player/brand-logos";

export { z };
export type Infer<T extends z.ZodType> = z.infer<T>;

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export type EntityView = {
  id: string;
  domain: string;
  state: string;
  attributes: Record<string, any>;
  lastChanged: Date;
  lastUpdated: Date;
  context: { id: string; parentId: string | null; userId: string | null };
  name: string;
  friendlyName: string;
  areaId: string | null;
  deviceId: string | null;
  platform: string;
  uniqueId: string | null;
  isDisabled: boolean;
  isHidden: boolean;
  icon: string | null;
  iconSource: "registry" | "attribute" | "default";
  entityCategory: "config" | "diagnostic" | null;
  labels: string[];
  aliases: string[];
  deviceClass?: string | null;
  unitOfMeasurement?: string | null;
  supportedFeatures?: number;
};

/** The SDK's store, as far as the widgets read it directly. */
export const state = store;

export const extractDomain = (id: string) => id.slice(0, id.indexOf("."));

/* A view is made again only when its state object or registry entry changes:
   Home Assistant keeps both objects as long as nothing about them changed. */
const views = new WeakMap<HassEntity, { entry: unknown; area: string | null; view: EntityView }>();

export function getEntityView(id: string): EntityView | undefined {
  const raw = entity(id);
  if (!raw) return undefined;
  const entry = store.entityRegistry[id];
  const deviceId = entry?.device_id ?? null;
  const areaId = entry?.area_id ?? (deviceId ? (store.devices[deviceId]?.area_id ?? null) : null);
  const cached = views.get(raw);
  if (cached && cached.entry === entry && cached.area === areaId) return cached.view;

  const attributes = raw.attributes ?? {};
  const friendlyName = (attributes.friendly_name as string | undefined) ?? entry?.name ?? id;
  const registryIcon = entry?.icon ?? null;
  const attributeIcon = (attributes.icon as string | undefined) ?? null;
  const view: EntityView = {
    id,
    domain: extractDomain(id),
    state: raw.state,
    attributes,
    lastChanged: new Date(raw.last_changed),
    lastUpdated: new Date(raw.last_updated),
    context: {
      id: raw.context?.id ?? "",
      parentId: raw.context?.parent_id ?? null,
      userId: raw.context?.user_id ?? null,
    },
    name: entry?.name ?? friendlyName,
    friendlyName,
    areaId,
    deviceId,
    platform: entry?.platform ?? "",
    uniqueId: null,
    isDisabled: false,
    isHidden: !!entry?.hidden_by,
    icon: registryIcon ?? attributeIcon,
    iconSource: registryIcon ? "registry" : attributeIcon ? "attribute" : "default",
    entityCategory: (entry?.entity_category as EntityView["entityCategory"]) ?? null,
    labels: entry?.labels ?? [],
    aliases: [],
    deviceClass: (attributes.device_class as string | undefined) ?? null,
    unitOfMeasurement: (attributes.unit_of_measurement as string | undefined) ?? null,
    supportedFeatures: attributes.supported_features as number | undefined,
  };
  views.set(raw, { entry, area: areaId, view });
  return view;
}

const read = <T,>(value: Accessor<T> | T): T => (typeof value === "function" ? (value as Accessor<T>)() : value);

export function useEntity(entityId: Accessor<string | undefined> | string | undefined): Accessor<EntityView | undefined> {
  return createMemo(() => {
    const id = read(entityId);
    return id ? getEntityView(id) : undefined;
  });
}

export function useEntities(entityIds: Accessor<readonly string[]> | readonly string[]): Accessor<EntityView[]> {
  return createMemo(
    () => {
      const out: EntityView[] = [];
      for (const id of read(entityIds)) {
        const view = getEntityView(id);
        if (view) out.push(view);
      }
      return out;
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((view, i) => view === b[i]) },
  );
}

/** Entity ids by domain. Not cached: the widgets keep it in a memo (domains.tsx). */
export function byDomain(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of entityIds()) (out[extractDomain(id)] ??= []).push(id);
  return out;
}

export type AreaView = {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  floorId: string | null;
  icon: string | null;
  picture: string | null;
  entityIds: string[];
  entities: EntityView[];
  temperatureEntityId: string | null;
  humidityEntityId: string | null;
};

/** An area with its entities: those placed in it, and those of its devices. */
export function useArea(areaId: Accessor<string> | string): Accessor<AreaView | undefined> {
  const ids = createMemo(
    () => {
      const id = read(areaId);
      if (!id || !store.areas[id]) return [] as string[];
      const out: string[] = [];
      for (const [entityId, entry] of Object.entries(store.entityRegistry)) {
        const area = entry.area_id ?? (entry.device_id ? store.devices[entry.device_id]?.area_id : null);
        if (area === id && hasEntity(entityId)) out.push(entityId);
      }
      return out.sort((a, b) => a.localeCompare(b));
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) },
  );
  const entities = useEntities(ids);
  return createMemo(() => {
    const id = read(areaId);
    const area = id ? store.areas[id] : undefined;
    if (!area) return undefined;
    return {
      id,
      name: area.name,
      normalizedName: area.name.toLowerCase(),
      aliases: area.aliases ?? [],
      floorId: area.floor_id ?? null,
      icon: area.icon ?? null,
      picture: area.picture ?? null,
      entityIds: ids(),
      entities: entities(),
      temperatureEntityId: area.temperature_entity_id ?? null,
      humidityEntityId: area.humidity_entity_id ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export type ServiceTarget = { entity_id?: string | string[]; device_id?: string | string[]; area_id?: string | string[] };

export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  target?: ServiceTarget,
  options?: { returnResponse?: boolean },
): Promise<any> {
  /* Home Assistant's own error toast for what the user did, not for a read
     the board makes by itself (a list's items, a forecast): those fail
     quietly and the card shows what it has. */
  const result = await hass().callService(domain, service, data, target, !options?.returnResponse, options?.returnResponse);
  return options?.returnResponse ? (result?.response ?? result) : result;
}

const onEntity = (verb: "turn_on" | "turn_off" | "toggle") => (entityId: string, data: Record<string, unknown> = {}) =>
  callService(extractDomain(entityId), verb, data, { entity_id: entityId });

export const turnOn = onEntity("turn_on");
export const turnOff = onEntity("turn_off");
export const toggle = onEntity("toggle");

export function useService() {
  return { callService, turnOn, turnOff, toggle };
}

/* ------------------------------------------------------------------ */
/* History and statistics                                              */
/* ------------------------------------------------------------------ */

export type TimelineState = {
  timestamp: number;
  state: string;
  attributes?: Record<string, any>;
  lastChanged?: number;
  lastUpdated: number;
};

export type EntityHistoryData = {
  entityId: string;
  timeline: TimelineState[];
  entityHistory: unknown[];
  loading: boolean;
  error: Error | null;
  lastFetched: number | null;
};

const [history, setHistory] = createStore<Record<string, EntityHistoryData>>({});
const tracked = new Map<string, { count: number; dispose?: () => void }>();
const MAX_POINTS = 5760;

/** Starts keeping an entity's history: what the recorder has from
    `startTime` on, then each new state as it arrives. */
export async function trackEntityHistory(
  entityId: string,
  options: { startTime: Date; endTime?: Date; minimalResponse?: boolean; significantChangesOnly?: boolean },
): Promise<EntityHistoryData> {
  const held = tracked.get(entityId);
  if (held) {
    held.count++;
    return history[entityId]!;
  }
  const entry: { count: number; dispose?: () => void } = { count: 1 };
  tracked.set(entityId, entry);
  setHistory(entityId, { entityId, timeline: [], entityHistory: [], loading: true, error: null, lastFetched: null });
  try {
    const reply = await hass().connection.sendMessagePromise<Record<string, any[]>>({
      type: "history/history_during_period",
      start_time: options.startTime.toISOString(),
      ...(options.endTime ? { end_time: options.endTime.toISOString() } : {}),
      entity_ids: [entityId],
      minimal_response: options.minimalResponse ?? true,
      no_attributes: true,
      significant_changes_only: options.significantChangesOnly ?? false,
    });
    const rows = reply?.[entityId] ?? [];
    const timeline: TimelineState[] = rows.map((row) => {
      const updated = Number(row.lu ?? row.lc ?? 0);
      return { timestamp: updated, state: String(row.s), lastUpdated: updated, lastChanged: Number(row.lc ?? updated) };
    });
    if (!tracked.has(entityId)) return history[entityId]!;
    setHistory(entityId, { timeline, loading: false, lastFetched: Date.now() });
  } catch (error) {
    setHistory(entityId, { loading: false, error: error instanceof Error ? error : new Error(String(error)) });
  }
  /* Each later state, appended as it comes. */
  entry.dispose = createRoot((dispose) => {
    createEffect(() => {
      const raw = entity(entityId);
      if (!raw) return;
      const at = Date.parse(raw.last_updated) / 1000;
      untrack(() => {
        const timeline = history[entityId]?.timeline ?? [];
        const last = timeline[timeline.length - 1];
        if (last && last.timestamp >= at) return;
        const next = [...timeline, { timestamp: at, state: raw.state, lastUpdated: at }];
        setHistory(entityId, "timeline", next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next);
      });
    });
    return dispose;
  });
  return history[entityId]!;
}

export function untrackEntityHistory(entityId: string): void {
  const held = tracked.get(entityId);
  if (!held) return;
  if (--held.count > 0) return;
  held.dispose?.();
  tracked.delete(entityId);
  setHistory(entityId, undefined!);
}

export function useEntityHistory(entityId: Accessor<string> | string): Accessor<EntityHistoryData | undefined> {
  return () => {
    const id = read(entityId);
    return id ? history[id] : undefined;
  };
}

export type StatisticValue = { start: number; end: number; mean?: number; sum?: number; min?: number; max?: number; state?: number; change?: number };
export type StatisticsQueryOptions = { startTime: Date; endTime?: Date; period: "5minute" | "hour" | "day" | "week" | "month" };

const ms = (value: unknown) => (typeof value === "number" ? value : Date.parse(String(value)));

export function useEntityStatistics(
  statisticId: Accessor<string> | string,
  options: Accessor<StatisticsQueryOptions> | StatisticsQueryOptions,
) {
  const [rows] = createResource(
    () => {
      const id = read(statisticId);
      return id ? { id, ...read(options) } : undefined;
    },
    async (ask): Promise<StatisticValue[]> => {
      const reply = await hass().connection.sendMessagePromise<Record<string, any[]>>({
        type: "recorder/statistics_during_period",
        start_time: ask.startTime.toISOString(),
        ...(ask.endTime ? { end_time: ask.endTime.toISOString() } : {}),
        statistic_ids: [ask.id],
        period: ask.period,
        types: ["mean", "min", "max", "state", "sum", "change"],
      });
      return (reply?.[ask.id] ?? []).map((row) => ({ ...row, start: ms(row.start), end: ms(row.end) }));
    },
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Calendars                                                           */
/* ------------------------------------------------------------------ */

export type CalendarEvent = {
  start: string;
  end: string;
  summary: string;
  description?: string;
  location?: string;
  uid?: string;
  recurrence_id?: string;
  rrule?: string;
};
export type CalendarEventsData = { entityId: string; events: CalendarEvent[]; loading: boolean; error: Error | null; start: string; end: string };

const CALENDAR_REFRESH_MS = 15 * 60_000;
const day = 86_400_000;

/** A calendar's events in a window around today, asked for again when the
    calendar's state changes (an event begins or ends) and every 15 minutes. */
export function useCalendarEvents(
  entityId: Accessor<string> | string,
  options: { daysBehind?: number; daysAhead?: number } = {},
): Accessor<CalendarEventsData | undefined> {
  const [tick, setTick] = createSignal(0);
  /* The last answer that came back, to keep showing while a calendar is down. */
  let last: CalendarEventsData | undefined;
  const timer = setInterval(() => setTick((n) => n + 1), CALENDAR_REFRESH_MS);
  onCleanup(() => clearInterval(timer));
  const [events] = createResource(
    () => {
      const id = read(entityId);
      if (!id) return undefined;
      return { id, version: tick(), changed: entity(id)?.last_changed };
    },
    async ({ id }): Promise<CalendarEventsData> => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const start = new Date(now.getTime() - (options.daysBehind ?? 0) * day).toISOString();
      const end = new Date(now.getTime() + ((options.daysAhead ?? 7) + 1) * day).toISOString();
      /* One calendar failing — its integration down, the entity unavailable —
         must not take the agenda with it: a thrown fetch leaves the resource
         in error, and reading it then throws into the card. It reports no
         events instead (or keeps the last ones it had), and says why. */
      const quiet = (error: string): CalendarEventsData => ({
        entityId: id,
        loading: false,
        error: new Error(error),
        start,
        end,
        events: last?.entityId === id ? last.events : [],
      });
      if (entity(id)?.state === "unavailable") return quiet("unavailable");
      let rows: any[];
      try {
        rows = await hass().callApi<any[]>(
          "GET",
          `calendars/${id}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        );
      } catch (error) {
        console.warn(`Room Board: calendar ${id} could not be read`, error);
        return quiet(error instanceof Error ? error.message : String((error as any)?.message ?? error));
      }
      return (last = {
        entityId: id,
        loading: false,
        error: null,
        start,
        end,
        events: (Array.isArray(rows) ? rows : []).map((row) => ({
          ...row,
          start: row.start?.dateTime ?? row.start?.date ?? row.start,
          end: row.end?.dateTime ?? row.end?.date ?? row.end,
        })),
      });
    },
  );
  return () => events.latest;
}

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */

/** Home Assistant's own paths load as they are: the card is on its origin. */
export function hassMediaUrl(path: string | null | undefined): string | undefined {
  return path || undefined;
}

/** A picture chosen in the settings: a path or an address. */
export function imageUrl(value: string | null | undefined): string | undefined {
  return value || undefined;
}

/** A smooth line through the points that never overshoots them (monotone
    cubic interpolation), as an SVG path. */
export function monotoneCubicPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const [first, second] = points;
  if (points.length === 2) return `M ${first!.x} ${first!.y} L ${second!.x} ${second!.y}`;
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    dx.push(b.x - a.x);
    slope.push((b.y - a.y) / (b.x - a.x));
  }
  const tangent = [slope[0] ?? 0];
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1] ?? 0;
    const s1 = slope[i] ?? 0;
    const h0 = dx[i - 1] ?? 0;
    const h1 = dx[i] ?? 0;
    tangent.push(s0 * s1 <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / s0 + (h1 + 2 * h0) / s1));
  }
  tangent.push(slope[n - 2] ?? 0);
  let path = `M ${first!.x} ${first!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const third = (dx[i] ?? 0) / 3;
    path += ` C ${a.x + third} ${a.y + (tangent[i] ?? 0) * third}, ${b.x - third} ${b.y - (tangent[i + 1] ?? 0) * third}, ${b.x} ${b.y}`;
  }
  return path;
}

/* ------------------------------------------------------------------ */
/* Config schema                                                       */
/* ------------------------------------------------------------------ */

type Meta = { title?: string; description?: string; [key: string]: unknown };
const clean = (meta: Meta) => Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));

export const field = {
  title: () => z.string().optional().meta({ title: "Title", description: "Optional display name override" }),
  text: (o: { title?: string; description?: string; default?: string }) =>
    (o.default === undefined ? z.string().optional() : z.string().default(o.default)).meta(clean(o)),
  number: (o: { title?: string; description?: string; default?: number; min?: number; max?: number }) => {
    let n = z.number();
    if (o.min !== undefined) n = n.min(o.min);
    if (o.max !== undefined) n = n.max(o.max);
    return (o.default === undefined ? n.optional() : n.default(o.default)).meta(clean({ title: o.title, description: o.description }));
  },
  toggle: (o: { title?: string; description?: string; default?: boolean }) =>
    z.boolean().default(o.default ?? false).meta(clean({ title: o.title, description: o.description })),
  choice: <const T extends readonly [string, ...string[]]>(
    values: T,
    o: { title?: string; description?: string; default?: T[number]; labels?: Record<string, string>; icons?: Record<string, string> },
  ) => {
    const e = z.enum(values);
    return (o.default === undefined ? e.optional() : e.default(o.default as any)).meta(
      clean({ title: o.title, description: o.description, labels: o.labels, icons: o.icons }),
    );
  },
  choices: <const T extends readonly [string, ...string[]]>(
    values: T,
    o: { title?: string; description?: string; default?: T[number][]; labels?: Record<string, string> },
  ) => z.array(z.enum(values)).default([...(o.default ?? [])] as any).meta(clean({ title: o.title, description: o.description })),
  entities: (domain: string | string[], o?: { title?: string; description?: string; deviceClass?: string | string[] }) =>
    z.array(z.string()).default([]).meta(clean({ domain, title: o?.title ?? "Entities", description: o?.description })),
  entity: (domain: string | string[], o?: { title?: string; description?: string; deviceClass?: string | string[] }) =>
    z.array(z.string()).default([]).meta(clean({ domain, title: o?.title ?? "Entity", description: o?.description, singleSelect: true })),
  area: (o?: { title?: string }) => z.string().optional().meta({ formType: "area-picker", title: o?.title ?? "Area" }),
  icon: (o?: { title?: string; description?: string; default?: string }) => {
    const s = z.string().meta(clean({ formType: "icon-picker", title: o?.title ?? "Icon", description: o?.description }));
    return o?.default === undefined ? s.optional() : s.default(o.default);
  },
  image: (o?: { title?: string; description?: string; default?: string; presets?: unknown }) => {
    const s = z.string().meta(clean({ formType: "image-picker", title: o?.title ?? "Image", description: o?.description }));
    return o?.default === undefined ? s.optional() : s.default(o.default);
  },
  stringList: (o: { title?: string; description?: string }) => z.array(z.string()).default([]).meta(clean(o)),
  group: <S extends z.ZodRawShape>(shape: S, o: { title?: string }) => {
    const object = z.object(shape);
    return object.default(object.parse({}) as any).meta({ title: o.title });
  },
  list: <T extends z.ZodType>(
    item: T,
    o: { max: number; min?: number; title?: string; description?: string; addLabel?: string; labelField?: string },
  ) => {
    let list = z.array(item);
    if (o.min !== undefined) list = list.min(o.min);
    list = list.max(o.max);
    return list.default([]).meta(clean({ formType: "list", title: o.title, description: o.description }));
  },
  variants: <K extends string, V extends Record<string, z.ZodRawShape>>(
    discriminator: K,
    variants: V,
    o: { title?: string; description?: string; labels?: Record<string, string>; shared?: z.ZodRawShape },
  ) => {
    const options = Object.entries(variants).map(([name, shape]) =>
      z.object({ ...(o.shared ?? {}), ...shape, [discriminator]: z.literal(name) }),
    );
    const union = z.discriminatedUnion(discriminator, options as any);
    const first = options[0];
    let fallback: unknown = {};
    if (first) {
      try {
        fallback = first.parse({ [discriminator]: Object.keys(variants)[0] });
      } catch {
        fallback = { [discriminator]: Object.keys(variants)[0] };
      }
    }
    return union.default(fallback as any).meta(clean({ formType: "variants", title: o.title, description: o.description }));
  },
};

export function defineConfig<S extends z.ZodRawShape>(shape: S) {
  return z.object(shape);
}

export type WidgetDefinition<C> = {
  manifest: Record<string, unknown>;
  configSchema: z.ZodType<C>;
  migrate?: (config: any, from?: number) => any;
  component: (props: { config: C }) => JSX.Element;
};

export function defineWidget<C>(definition: WidgetDefinition<C>): WidgetDefinition<C> {
  return definition;
}

/* ------------------------------------------------------------------ */
/* The card around the widget                                          */
/* ------------------------------------------------------------------ */

export type WidgetContextValue = {
  /** Saves a changed config: on a card, the parts the board changes by
      itself (hidden cards, the arrangement) are kept per user. */
  updateConfig: (config: Record<string, unknown>) => void;
  /** Where the card keeps small things of its own (useWidgetState). */
  storageKey: string;
  /** Where the layout is kept: per screen, or shared by every screen. */
  layout?: {
    perDevice: () => boolean;
    /** This screen has saved a layout of its own. */
    own: () => boolean;
    /** Forget this screen's layout and go back to the shared one. */
    reset: () => void;
    /** Make this screen's layout the one new screens start from. */
    share: () => void;
  };
};

export const WidgetContext = createContext<WidgetContextValue>();

export function useWidgetContext(): WidgetContextValue {
  const ctx = useContext(WidgetContext);
  if (!ctx) throw new Error("useWidgetContext outside the card");
  return ctx;
}

/** A small value kept in this browser, per card. */
/** A value may hold this many bytes, as in GlassHome. */
const STATE_MAX_BYTES = 8192;

export function useWidgetState<T>(
  key: string,
  schema: z.ZodType<T>,
  initial: T,
): [Accessor<T>, (value: T | ((prev: T) => T)) => "ok" | "too-large" | "failed"] {
  const ctx = useContext(WidgetContext);
  const storageKey = `${ctx?.storageKey ?? "ha-room-board"}:${key}`;
  let start = initial;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const parsed = schema.safeParse(JSON.parse(saved));
      if (parsed.success) start = parsed.data;
    }
  } catch {
    /* Private window or blocked storage: start afresh. */
  }
  const [value, setValue] = createSignal<T>(start);
  const set = (next: T | ((prev: T) => T)): "ok" | "too-large" | "failed" => {
    const resolved = typeof next === "function" ? (next as (prev: T) => T)(untrack(value)) : next;
    const text = JSON.stringify(resolved);
    if (text.length > STATE_MAX_BYTES) return "too-large";
    setValue(() => resolved);
    try {
      localStorage.setItem(storageKey, text);
      return "ok";
    } catch {
      /* Not kept, but still shown. */
      return "failed";
    }
  };
  return [value, set];
}

/* The settings form of GlassHome's own dialog: on a card the settings are its
   YAML (and the card editor), so the dialog is never opened. */
export function useWidgetDialog(_kind?: string) {
  const [show, setShow] = createSignal(false);
  return {
    dialogProps: { open: show, onOpenChange: setShow },
    openDialog: () => setShow(true),
    setShowDialog: setShow,
  };
}

export function WidgetDialog(_props: { onConfigSave?: (config: any) => void; [key: string]: unknown }): JSX.Element {
  return null;
}

const Nothing = (_props: ParentProps<Record<string, unknown>>): JSX.Element => null;
export const ResponsiveDialog = Nothing;
export const ResponsiveDialogContent = Nothing;
export const ResponsiveDialogHeader = Nothing;
export const ResponsiveDialogTitle = Nothing;
export const ResponsiveDialogDescription = Nothing;
export const Button = Nothing;
export const SchemaForm = Nothing;

type Gestures = { tap?: () => void; hold?: { action: () => void }; dispose: () => void };

/** Tap and hold on the card. */
export function useWidgetGestures(get: () => { tap?: () => void; hold?: { action: () => void } }): Gestures {
  return {
    get tap() {
      return get().tap;
    },
    get hold() {
      return get().hold;
    },
    dispose: () => undefined,
  };
}

const HOLD_MS = 600;

type WidgetProps = ParentProps<{
  tone?: string;
  variant?: string;
  gestures?: Gestures;
  emptyState?: { icon?: JSX.Element; title?: string; message?: string };
  class?: string;
}>;

function WidgetFrame(props: WidgetProps): JSX.Element {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => clearTimeout(timer);
  onCleanup(stop);
  return (
    <div
      class={`ha-rb-widget ${props.class ?? ""}`}
      data-tone={props.tone}
      onPointerDown={() => {
        const hold = props.gestures?.hold;
        if (!hold) return;
        stop();
        timer = setTimeout(() => hold.action(), HOLD_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {props.emptyState ? (
        <div class="ha-rb-empty">
          {props.emptyState.icon}
          <b>{props.emptyState.title}</b>
          <span>{props.emptyState.message}</span>
        </div>
      ) : (
        props.children
      )}
    </div>
  );
}

function WidgetContent(props: ParentProps<{ class?: string }>): JSX.Element {
  return <div class={`ha-rb-content ${props.class ?? ""}`}>{props.children}</div>;
}

export const Widget = Object.assign(WidgetFrame, { Content: WidgetContent });

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/* An icon is drawn as GlassHome draws it — an inline <svg data-icon> filled
   with currentColor, 1em unless sized — because the widgets' stylesheets
   size, colour and hide icons by that element. Its shape comes from Home
   Assistant itself: a hidden <ha-icon> loads it from Home Assistant's own
   icon store (Material Design Icons, and any custom icon set installed), and
   the path it draws is read off it and kept. */
type Shape = { path: string; viewBox: string } | null;
const shapes = new Map<string, Accessor<Shape | undefined>>();
const ICON_WAIT_MS = 4000;

function loadShape(name: string, set: (shape: Shape) => void): void {
  const probe = document.createElement("ha-icon") as HTMLElement & { icon?: string };
  probe.setAttribute("icon", name);
  probe.icon = name;
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const started = performance.now();
  const look = () => {
    const svg = probe.shadowRoot?.querySelector("ha-svg-icon") as (HTMLElement & { path?: string; viewBox?: string }) | null;
    if (svg?.path) {
      probe.remove();
      set({ path: svg.path, viewBox: svg.viewBox || "0 0 24 24" });
      return;
    }
    if (performance.now() - started > ICON_WAIT_MS) {
      probe.remove();
      set(null);
      return;
    }
    setTimeout(look, 40);
  };
  look();
}

function shapeOf(name: string): Shape | undefined {
  if (!name) return null;
  /* An app's logo, carried in the card (media-player/brand-logos.ts). */
  if (name.startsWith("brand:")) {
    const path = BRAND_PATHS[name.slice("brand:".length)];
    return path ? { path, viewBox: "0 0 24 24" } : null;
  }
  let found = shapes.get(name);
  if (!found) {
    const [get, set] = createSignal<Shape | undefined>(undefined);
    shapes.set(name, get);
    found = get;
    if (typeof document !== "undefined") loadShape(name, (shape) => set(() => shape));
  }
  return found();
}

const length = (value: string | number | undefined) => (value === undefined || value === null ? undefined : String(value));

/** An icon by its name ("mdi:lightbulb"). */
export function Icon(props: {
  icon: string;
  width?: string | number;
  height?: string | number;
  class?: string;
  style?: JSX.CSSProperties | string;
}): JSX.Element {
  const [own, rest] = splitProps(props, ["icon", "width", "height"]);
  const shape = createMemo(() => shapeOf(own.icon));
  const width = () => length(own.width) ?? length(own.height) ?? "1em";
  const height = () => length(own.height) ?? length(own.width) ?? "1em";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-slot="icon"
      aria-hidden="true"
      fill="currentColor"
      data-icon={own.icon}
      viewBox={shape()?.viewBox ?? "0 0 24 24"}
      width={width()}
      height={height()}
      {...rest}
    >
      <Show
        when={own.icon.startsWith("wordmark:")}
        fallback={<Show when={shape()}>{(found) => <path d={found().path} />}</Show>}
      >
        {/* An app with no logo here: its name, set as a wordmark. */}
        <text
          x="12"
          y="12.6"
          text-anchor="middle"
          dominant-baseline="middle"
          font-size={String(Math.min(5.2, 42 / Math.max(1, own.icon.length - "wordmark:".length)))}
          font-weight="800"
          letter-spacing="-0.15"
          font-family="inherit"
        >
          {own.icon.slice("wordmark:".length)}
        </text>
      </Show>
    </svg>
  );
}

/** Whether Home Assistant is connected: the card has been given `hass`. */
export const isConnected = () => hasHass();
