import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useEntity, type EntityView } from "@glasshome/widget-sdk";
import { state as haStore } from "../ha/store";
import { Spark } from "./spark";
import { openable, sinceLabel } from "./util";

/**
 * TomTom routes (the TomTom custom integration): each route is a device,
 * model "Route", with a travel time, a delay, a length, traffic reports and
 * speed cameras. Found by the device rather than the area, because a route
 * is rarely put in one: the routes of this room's area, and on the house's
 * own room (Home) every route that has no area.
 */
export type Route = {
  key: string;
  name: string;
  /** "Wiesloch - return": the way back. */
  back: boolean;
  travel?: string;
  delay?: string;
  length?: string;
  reports?: string;
  cameras?: string;
  newCameras?: string;
  /** Every entity of the route, kept off the board's own readings. */
  all: string[];
};

const ROLE: [keyof Route, RegExp][] = [
  ["travel", /_travel_time$/],
  ["delay", /_traffic_delay$/],
  ["length", /_route_length$/],
  ["reports", /_reports$/],
  ["newCameras", /_new_speed_cameras$/],
  ["cameras", /_all_speed_cameras$/],
];

const isRoute = (device: { model?: string | null; manufacturer?: string | null }) =>
  /tomtom/i.test(device.manufacturer ?? "") && /^route$/i.test(device.model ?? "");

export function routesFor(areaId: string | undefined, isHome: boolean): Route[] {
  const devices = haStore.devices;
  const wanted = new Map<string, Route>();
  for (const device of Object.values(devices)) {
    if (!device || !isRoute(device)) continue;
    const here = device.area_id ? device.area_id === areaId : isHome;
    if (!here) continue;
    const raw = (device.name_by_user || device.name || "Route").trim();
    const back = /\s*[-–]\s*return$/i.test(raw);
    wanted.set(device.id, { key: device.id, name: raw.replace(/\s*[-–]\s*return$/i, ""), back, all: [] });
  }
  if (!wanted.size) return [];
  for (const [id, entry] of Object.entries(haStore.entityRegistry)) {
    const route = entry?.device_id ? wanted.get(entry.device_id) : undefined;
    if (!route || entry.disabled_by) continue;
    route.all.push(id);
    if (!id.startsWith("sensor.")) continue;
    for (const [role, pattern] of ROLE) if (pattern.test(id) && !route[role]) (route as any)[role] = id;
  }
  /* Out and back side by side: by name, the way there first. */
  return [...wanted.values()]
    .filter((route) => route.travel)
    .sort((a, b) => a.name.localeCompare(b.name) || Number(a.back) - Number(b.back));
}

const num = (entity: EntityView | undefined) => {
  const value = Number(entity?.state);
  return Number.isFinite(value) ? value : undefined;
};

/** How bad the delay is: by the share of the trip it adds, with a floor so a
 *  minute on a ten-minute trip is not an alarm. */
function level(delay: number | undefined, free: number | undefined): "clear" | "slow" | "jam" {
  if (!delay || delay < 2) return "clear";
  const share = free ? delay / free : 0;
  if (delay >= 10 || share >= 0.35) return "jam";
  return "slow";
}

const LEVEL_WORD = { clear: "Free flowing", slow: "Slower", jam: "Heavy traffic" } as const;

function clockIn(minutes: number | undefined, now: number): string {
  if (minutes === undefined) return "";
  return new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The live reading of a route, shared by the card and the overlay. */
function useRoute(route: () => Route) {
  const travel = useEntity(() => route().travel);
  const delay = useEntity(() => route().delay);
  const length = useEntity(() => route().length);
  const reports = useEntity(() => route().reports);
  const cameras = useEntity(() => route().cameras);
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(tick));

  return createMemo(() => {
    const t = travel();
    const minutes = num(t);
    const free = Number(t?.attributes?.["travel_time_no_traffic_minutes"]);
    const usual = Number(t?.attributes?.["travel_time_historic_minutes"]);
    const late = num(delay()) ?? Number(t?.attributes?.["traffic_delay_minutes"]);
    const km = num(length()) ?? Number(t?.attributes?.["distance_km"]);
    const error = t?.attributes?.["error"];
    const lvl = level(Number.isFinite(late) ? late : undefined, Number.isFinite(free) ? free : undefined);
    return {
      minutes,
      free: Number.isFinite(free) ? free : undefined,
      usual: Number.isFinite(usual) ? usual : undefined,
      delay: Number.isFinite(late) ? late : 0,
      km: Number.isFinite(km) ? km : undefined,
      reports: num(reports()) ?? 0,
      cameras: num(cameras()) ?? 0,
      level: lvl,
      word: LEVEL_WORD[lvl],
      arrive: clockIn(minutes, now()),
      updated: (t?.attributes?.["computed_at"] as string | undefined) ?? t?.lastUpdated,
      down: !t || t.state === "unavailable" || t.state === "unknown" || (typeof error === "string" && !!error),
    };
  });
}

/** Free-flow time and the delay on top, as one bar: how much of the trip the
 *  traffic is. */
function TripBar(props: { free?: number; delay: number }) {
  const total = () => (props.free ?? 0) + props.delay;
  const share = () => (total() ? Math.min(1, props.delay / total()) : 0);
  return (
    <div class="rb-trip-bar" aria-hidden="true">
      <i style={{ width: `${(1 - share()) * 100}%` }} />
      <b style={{ width: `${share() * 100}%` }} />
    </div>
  );
}

export function RouteCard(props: { route: Route; onOpen: () => void }) {
  const r = useRoute(() => props.route);
  return (
    <article
      class="rb-card rb-card--trip"
      data-card={`route:${props.route.key}`}
      data-level={r().level}
      data-down={r().down}
      {...openable(props.onOpen, `Route ${props.route.name}`)}
    >
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name" title={props.route.back ? "Way back" : "Way there"}>
            <Icon icon={props.route.back ? "mdi:home-import-outline" : "mdi:car-arrow-right"} width="16" />
            <span class="rb-truncate">{props.route.name}</span>
            <Show when={props.route.back}><small class="rb-trip-dir">back</small></Show>
          </h3>
        </div>
      </header>

      <div class="rb-trip-body">
        <Show when={!r().down} fallback={<p class="rb-trip-down">No route right now</p>}>
          <div class="rb-trip-time">
            <span class="rb-trip-min">{r().minutes}</span>
            <span class="rb-trip-unit">min</span>
          </div>
          <div class="rb-trip-side">
            <span class="rb-trip-pill">
              <i />
              {r().delay >= 1 ? `+${Math.round(r().delay)} min` : r().level === "clear" ? "Clear" : r().word}
            </span>
            <Show when={r().reports || r().cameras}>
              <span class="rb-trip-flags">
                <Show when={r().reports}>
                  <span title="Traffic reports on the route"><Icon icon="mdi:car-brake-alert" width="12" />{r().reports}</span>
                </Show>
                <Show when={r().cameras}>
                  <span title="Speed cameras on the route"><Icon icon="mdi:cctv" width="12" />{r().cameras}</span>
                </Show>
              </span>
            </Show>
          </div>
        </Show>
      </div>

      <footer class="rb-trip-foot">
        <TripBar free={r().free} delay={r().delay} />
        <div class="rb-trip-facts">
          <Show when={r().arrive && !r().down}>
            <span>Arrive <b>{r().arrive}</b></span>
          </Show>
          <Show when={r().km !== undefined}>
            <span>{r().km!.toLocaleString(undefined, { maximumFractionDigits: 1 })} km</span>
          </Show>
        </div>
      </footer>
    </article>
  );
}

function RouteRow(props: { route: Route }) {
  const r = useRoute(() => props.route);
  return (
    <section class="rb-trip-row" data-level={r().level} data-down={r().down}>
      <header class="rb-trip-row-head">
        <Icon icon={props.route.back ? "mdi:home-import-outline" : "mdi:car-arrow-right"} width="20" />
        <div class="rb-trip-row-titles">
          <h4 class="rb-truncate">{props.route.name}</h4>
          <span class="rb-trip-row-sub">
            {props.route.back ? "Way back" : "Way there"}
            <Show when={r().updated}> · updated {sinceLabel(r().updated)}</Show>
          </span>
        </div>
        <span class="rb-trip-pill">
          <i />
          {r().down ? "No route" : r().word}
        </span>
      </header>

      <div class="rb-trip-stats">
        <div><b>{r().down ? "–" : r().minutes}</b><span>min now</span></div>
        <div><b>{r().delay >= 1 ? `+${Math.round(r().delay)}` : "0"}</b><span>min delay</span></div>
        <div><b>{r().free ?? "–"}</b><span>min free-flow</span></div>
        <div><b>{r().usual ?? "–"}</b><span>min usual</span></div>
        <div><b>{r().km?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? "–"}</b><span>km</span></div>
        <div><b>{r().down ? "–" : r().arrive}</b><span>arrival</span></div>
      </div>

      <Show when={r().reports || r().cameras}>
        <div class="rb-trip-alerts">
          <Show when={r().reports}>
            <span><Icon icon="mdi:car-brake-alert" width="15" />{r().reports} traffic report{r().reports === 1 ? "" : "s"}</span>
          </Show>
          <Show when={r().cameras}>
            <span><Icon icon="mdi:cctv" width="15" />{r().cameras} speed camera{r().cameras === 1 ? "" : "s"}</span>
          </Show>
        </div>
      </Show>

      <Show when={props.route.travel}>
        <div class="rb-trip-chart">
          <Spark entityId={props.route.travel!} hours={24} interactive caption="Travel time, last 24 h" tone="var(--trip-tone)" />
        </div>
      </Show>
    </section>
  );
}

export function RoutesPanel(props: { routes: Route[] }) {
  return (
    <div class="rb-trip-panel">
      <For each={props.routes}>{(route) => <RouteRow route={route} />}</For>
    </div>
  );
}
