import { useDomains } from "../domains";
import { For, Show, createMemo } from "solid-js";
import { Icon, useEntities, type EntityView } from "@glasshome/widget-sdk";
import { sealedImage } from "../url";
import { artSrc, entityPicture } from "../artwork";
/* The media player widget's breaker: a portrait that cannot load must not be
   asked for once per person per reload. */
import { imageBlocked, noteImageFailure } from "../media-player/cover";
import { attr, sinceLabel } from "./util";
import { Keyed } from "./keyed";

export const isHome = (person: EntityView) => person.state === "home";

/** Home, Away, or wherever Home Assistant says they are. */
export const whereabouts = (person: EntityView) => {
  const state = person.state ?? "";
  if (state === "home") return "Home";
  if (state === "not_home") return "Away";
  if (!state || state === "unknown" || state === "unavailable") return "Unknown";
  return state.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
};

/**
 * The colour of where someone is.
 *
 * Home is green, as it always was. A named zone gets a colour of its own —
 * work blue, school amber, the gym pink, any other zone a steady colour of
 * its own taken from its name, so "Weiher" is the same colour every day.
 * Plain "away" gets none: it is the default state of a person out, and
 * colouring it said nothing.
 */
const ZONE_PALETTE = ["#8b5cf6", "#06b6d4", "#f97316", "#6366f1", "#14b8a6", "#e879f9", "#eab308"];

export function placeColour(person: EntityView): string | undefined {
  const state = (person.state ?? "").toLowerCase();
  if (state === "home") return "#22c55e";
  if (!state || ["not_home", "unknown", "unavailable", "away"].includes(state)) return undefined;
  if (/work|arbeit|office|b(ü|ue)ro|job/.test(state)) return "#3b82f6";
  if (/school|schule|uni|kita|kindergarten/.test(state)) return "#f59e0b";
  if (/gym|sport|fitness|training|yoga/.test(state)) return "#ec4899";
  let hash = 0;
  for (const character of state) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return ZONE_PALETTE[hash % ZONE_PALETTE.length];
}

/** Their photo, where Home Assistant has one. */
/* Through the dashboard's media proxy when it serves the path (an uploaded
   profile picture, /api/image/serve/…). A photo under /local/ it does not: the
   GlassHome Artwork integration reads the person's own entity_picture and
   hands it back as a small JPEG. Initials until then, or without it.
   Reactive: read inside a memo or JSX. */
const faceOf = (person: EntityView) => {
  const picture = attr<string | undefined>(person, "entity_picture", undefined);
  if (!picture) return undefined;
  return sealedImage(picture) ?? artSrc(entityPicture(person.id, 0, "entity_picture"), 160);
};

/** "MS" — what to draw when there is no photo. */
const initials = (person: EntityView) =>
  (person.friendlyName ?? person.id)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

/**
 * The people to show: the ones named in settings, or everyone Home Assistant
 * tracks when nothing is named. Empty means "all" rather than "none" so the
 * row works out of the box and narrows only when asked.
 */
export function usePeople(chosen: () => string[]) {
  const domains = useDomains();
  return useEntities(() => (chosen().length ? chosen() : (domains().person ?? [])));
}

function Face(props: { person: EntityView; haBase: string; size?: string }) {
  const src = () => faceOf(props.person);

  return (
    <span
      class="rb-face"
      data-home={isHome(props.person)}
      data-placed={placeColour(props.person) !== undefined}
      style={{
        ...(props.size ? { width: props.size, height: props.size } : {}),
        ...(placeColour(props.person) ? { "--rb-place": placeColour(props.person) } : {}),
      }}
    >
      <Show when={src() && !imageBlocked(src())} fallback={<b>{initials(props.person) || "?"}</b>}>
        <img
          src={src()}
          alt=""
          decoding="async"
          onError={(event) => {
            noteImageFailure(src());
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      </Show>
    </span>
  );
}

/**
 * Who is in, at the end of the overview line.
 *
 * Overlapped on purpose: a household is a group before it is a list, and the
 * stack says "four people, two of them home" in the space a single avatar
 * would take. Each one is still its own button — the faces overlap from the
 * right, so every face keeps its leading edge clear to be pressed.
 */
export function PersonRow(props: {
  people: EntityView[];
  haBaseUrl: string;
  onOpen: () => void;
}) {
  const shown = () => props.people.slice(0, 5);
  const rest = () => props.people.length - shown().length;

  return (
    <button class="rb-faces" aria-label="Who is home" onClick={props.onOpen}>
      <Keyed each={shown()}>
        {(person, position) => (
          <span
            class="rb-faces-slot"
            style={{ "z-index": String(shown().length - position()) }}
          >
            <Face person={person} haBase={props.haBaseUrl} />

            {/* The name appears where the face is, on hover: a stack of faces
                is unreadable until you point at one, and a native tooltip
                arrives a second too late to feel like part of the board. */}
            <span class="rb-face-tip">
              <b>{person.friendlyName ?? person.id}</b>
              <span>{whereabouts(person)}</span>
            </span>
          </span>
        )}
      </Keyed>

      <Show when={rest() > 0}>
        <span class="rb-faces-slot rb-faces-more">+{rest()}</span>
      </Show>
    </button>
  );
}

/** The overlay: everyone, where they are, and since when. */
/* ---------- what their phone says ---------- */

/**
 * The phone's sensors, by what they are.
 *
 * The Home Assistant companion app names every sensor after the phone —
 * sensor.pixel_8_battery_level, sensor.iphone_ssid — and the person lists the
 * phone among its device trackers. So a person's phone facts are found by
 * name, from the tracker, with nothing to configure. Android and iOS call a
 * few of them differently; both spellings are tried.
 */
const PHONE: Record<string, string[]> = {
  battery: ["battery_level"],
  charging: ["battery_state", "charger_type", "is_charging"],
  wifi: ["wifi_connection", "ssid"],
  steps: ["steps_sensor", "steps", "daily_steps"],
  activity: ["detected_activity", "activity"],
  place: ["geocoded_location"],
  alarm: ["next_alarm"],
};

/** The phones behind a person: the tracker it is using now first. */
const phonesOf = (person: EntityView) => {
  const source = attr<string | undefined>(person, "source", undefined);
  const trackers = attr<string[] | undefined>(person, "device_trackers", undefined) ?? [];
  const ordered = source ? [source, ...trackers.filter((id) => id !== source)] : trackers;
  return [...new Set(ordered)]
    .filter((id) => id.startsWith("device_tracker."))
    .map((id) => id.slice("device_tracker.".length));
};

const usable = (entity: EntityView | undefined) =>
  !!entity && !["unknown", "unavailable", "", "none"].includes((entity.state ?? "").toLowerCase());

/** Kilometres between two points, as the crow flies. */
const kmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const ACTIVITY: Record<string, [string, string]> = {
  still: ["Still", "mdi:human-handsdown"],
  stationary: ["Still", "mdi:human-handsdown"],
  walking: ["Walking", "mdi:walk"],
  on_foot: ["On foot", "mdi:walk"],
  running: ["Running", "mdi:run"],
  on_bicycle: ["Cycling", "mdi:bike"],
  cycling: ["Cycling", "mdi:bike"],
  in_vehicle: ["Driving", "mdi:car"],
  automotive: ["Driving", "mdi:car"],
};

const batteryIcon = (level: number, charging: boolean) => {
  if (charging) return "mdi:battery-charging";
  const step = Math.max(1, Math.min(10, Math.round(level / 10))) * 10;
  return step >= 100 ? "mdi:battery" : `mdi:battery-${step}`;
};

/** "Tomorrow 06:30", "Fri 07:00" — when the next alarm goes. */
const alarmLabel = (value: string) => {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date();
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
};

type Fact = { icon: string; label: string; value: string; tone?: "good" | "warn" | "bad" | "live" };

/** A battery's colour: charging, low, getting low, or fine. */
function batteryTone(level: number, charging: boolean): Fact["tone"] {
  if (charging) return "live";
  if (level <= 15) return "bad";
  return level <= 35 ? "warn" : "good";
}

/** Whether a phone's charger sensor says it is charging, in any of the words
    the apps use. */
const isCharging = (state: string) => /charg|ac|usb|wireless|true|on/.test(state) && !/dis|not|none|false/.test(state);

function batteryFact(battery: EntityView | undefined, charger: EntityView | undefined): Fact | undefined {
  const level = Number(battery?.state);
  if (!battery || !Number.isFinite(level)) return undefined;
  const charging = isCharging((charger?.state ?? "").toLowerCase());
  return {
    icon: batteryIcon(level, charging),
    label: charging ? "Charging" : "Battery",
    value: `${Math.round(level)}%`,
    tone: batteryTone(level, charging),
  };
}

/** The Wi-Fi it is on, or that it is on mobile data. */
function wifiFact(wifi: EntityView | undefined): Fact | undefined {
  if (!wifi) return undefined;
  const off = /not connected|<not connected>|disconnected/i.test(wifi.state);
  return off
    ? { icon: "mdi:signal-cellular-3", label: "Network", value: "Mobile data" }
    : { icon: "mdi:wifi", label: "Wi-Fi", value: wifi.state };
}

function stepsFact(steps: EntityView | undefined): Fact | undefined {
  const count = Number(steps?.state);
  if (!steps || !Number.isFinite(count)) return undefined;
  return { icon: "mdi:shoe-print", label: "Steps", value: Math.round(count).toLocaleString() };
}

/** What they are doing — walking, driving — where the phone knows. */
function activityFact(activity: EntityView | undefined): Fact | undefined {
  const doing = ACTIVITY[(activity?.state ?? "").toLowerCase()];
  return doing ? { icon: doing[1], label: "Now", value: doing[0] } : undefined;
}

/** How far from home they are, while they are out. */
function distanceFact(person: EntityView, home: { lat: number; lon: number } | undefined): Fact | undefined {
  const lat = attr<number | undefined>(person, "latitude", undefined);
  const lon = attr<number | undefined>(person, "longitude", undefined);
  if (isHome(person) || !home || lat === undefined || lon === undefined) return undefined;
  const km = kmBetween(home, { lat, lon });
  return { icon: "mdi:map-marker-distance", label: "From home", value: km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km` };
}

function alarmFact(alarm: EntityView | undefined): Fact | undefined {
  const when = alarm ? alarmLabel(alarm.state) : "";
  return when ? { icon: "mdi:alarm", label: "Next alarm", value: when } : undefined;
}

/**
 * The people, one card each: where they are, and what their phone says — the
 * charge and whether it is on the cable, the network it is on, the steps, what
 * it thinks they are doing, the street it is on, the next alarm, and how far
 * from home. Only what the phone actually reports is shown; a person with no
 * companion app is a face and a place.
 */
export function PeoplePanel(props: {
  people: EntityView[];
  haBaseUrl: string;
  /** Home, for "how far away". */
  home?: { lat: number; lon: number };
}) {
  const sensorIds = createMemo(() =>
    props.people.flatMap((person) =>
      phonesOf(person).flatMap((slug) =>
        Object.values(PHONE)
          .flat()
          .map((suffix) => `sensor.${slug}_${suffix}`),
      ),
    ),
  );
  const sensors = useEntities(sensorIds);
  const byId = createMemo(() => new Map(sensors().map((entity) => [entity.id, entity])));

  /** The first of a role's sensors this person's phones actually have. */
  const find = (person: EntityView, role: string) => {
    for (const slug of phonesOf(person)) {
      for (const suffix of PHONE[role] ?? []) {
        const entity = byId().get(`sensor.${slug}_${suffix}`);
        if (usable(entity)) return entity;
      }
    }
    return undefined;
  };

  /* What there is to say about a person, from their phone and where they
     are: each fact its own small reader below, the ones with nothing to
     say left out. */
  const factsOf = (person: EntityView): Fact[] =>
    [
      batteryFact(find(person, "battery"), find(person, "charging")),
      wifiFact(find(person, "wifi")),
      stepsFact(find(person, "steps")),
      activityFact(find(person, "activity")),
      distanceFact(person, props.home),
      alarmFact(find(person, "alarm")),
    ].filter((fact): fact is Fact => !!fact);

  /* The street the phone is on, while they are out: the most useful line
     there is, and too long for a chip. */
  const streetOf = (person: EntityView) => {
    if (isHome(person)) return "";
    const place = find(person, "place")?.state ?? "";
    return place.split("\n")[0]?.split(",").slice(0, 2).join(",").trim() ?? "";
  };

  const sorted = () =>
    [...props.people].sort(
      (a, b) =>
        Number(isHome(b)) - Number(isHome(a)) ||
        (a.friendlyName ?? a.id).localeCompare(b.friendlyName ?? b.id),
    );

  return (
    <div class="rb-people-panel">
      <Show
        when={props.people.length}
        fallback={<p class="rb-act-none">Home Assistant tracks nobody yet.</p>}
      >
        <div class="rb-people-rows">
          <Keyed each={sorted()}>
            {(person) => (
              <div
                class="rb-people-card"
                data-home={isHome(person)}
                data-placed={placeColour(person) !== undefined}
                style={placeColour(person) ? { "--rb-place": placeColour(person) } : undefined}
              >
                <div class="rb-people-row">
                  <Face person={person} haBase={props.haBaseUrl} size="3rem" />

                  <span class="rb-people-meta">
                    <span class="rb-people-name rb-truncate">
                      {person.friendlyName ?? person.id}
                    </span>
                    <span class="rb-people-where">
                      <Icon
                        icon={isHome(person) ? "mdi:home" : "mdi:map-marker-outline"}
                        width="13"
                      />
                      {whereabouts(person)}
                    </span>
                    <Show when={streetOf(person)}>
                      <span class="rb-people-street rb-truncate">{streetOf(person)}</span>
                    </Show>
                  </span>

                  <span class="rb-people-since">{sinceLabel(person.lastChanged)}</span>
                </div>

                <Show when={factsOf(person).length}>
                  <div class="rb-people-facts">
                    <For each={factsOf(person)}>
                      {(fact) => (
                        <span class="rb-people-fact" data-tone={fact.tone}>
                          <Icon icon={fact.icon} width="16" />
                          <span class="rb-people-fact-text">
                            <b class="rb-truncate">{fact.value}</b>
                            <span class="rb-truncate">{fact.label}</span>
                          </span>
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </Keyed>
        </div>
      </Show>
    </div>
  );
}

/** The house's zones, for how far away each person is. */
export function useZones() {
  const domains = useDomains();
  return useEntities(() => domains().zone ?? []);
}
