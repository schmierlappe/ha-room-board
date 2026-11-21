import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Icon, useEntity, useService, type EntityView } from "@glasshome/widget-sdk";
/* What the DWD publishes beside the forecast: what it is warning about, and
   what is in the air. Both come off the area's own sensors. */
import { PollenList, WeatherWarnings, pollenOf, warningsOf } from "./dwd";
/* The same bar the light and vacuum overlays use: three views of one sky
   read better as tabs than as one long scroll. */
import { Tabs, type TabItem } from "./tabs";
/* The weather widget's own readers and its animated scenes rather than a
   second set: the same entity, the same conditions, the same drawing. Only
   the layout here is the board's. */
import { WeatherScene } from "../weather/scene";
/* The dial's own cold-to-hot ramp, so a forecast bar and the thermostat agree
   about what twenty-two degrees looks like. */
import { rampAt } from "./dial";
import {
  attr,
  conditionLabel,
  readForecast,
  isNight,
  sceneFor,
  supportsForecast,
  temp,
  type ForecastEntry,
} from "../weather/util";
import { openable } from "./util";
import { Half } from "./half";

/** Mon, Tue — the forecast strip's own labels, from the entry's own stamp. */
const dayLabel = (entry: ForecastEntry) => {
  const date = new Date(entry.datetime);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { weekday: "short" })
    : "";
};

/**
 * The forecast, fetched the way Home Assistant expects.
 *
 * The `forecast` attribute was removed in 2024.4, so the days have to be asked
 * for with a response-returning service call. One call on mount and every half
 * hour after: a forecast that refreshes on every state change would call the
 * provider dozens of times an hour for a figure that changes twice a day.
 */
function useForecast(entityId: () => string) {
  const { callService } = useService();
  const entity = useEntity(entityId);
  const [daily, setDaily] = createSignal<ForecastEntry[]>([]);
  const [hourly, setHourly] = createSignal<ForecastEntry[]>([]);

  const ask = async (kind: "daily" | "hourly") => {
    const id = entityId();
    if (!id || !supportsForecast(entity(), kind)) return [];
    try {
      const response = await callService(
        "weather",
        "get_forecasts",
        { type: kind },
        { entity_id: id },
        { returnResponse: true },
      );
      return readForecast(response, id);
    } catch {
      // A provider that refuses the call simply gets no strip; the card still
      // has the condition and the temperature, which is most of the point.
      return [];
    }
  };

  const load = async () => {
    setDaily(await ask("daily"));
    setHourly(await ask("hourly"));
  };

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), 30 * 60_000);
    onCleanup(() => clearInterval(timer));
  });

  return { entity, daily, hourly };
}

const tempOf = (entity: EntityView | undefined) =>
  attr<number | undefined>(entity, "temperature", undefined);

/** Where a temperature sits on the ramp: -5° is cold, 35° is hot. */
const shade = (value: number | undefined) =>
  rampAt(((value ?? 15) + 5) / 40);

/**
 * The week's own span, so every bar is drawn against the same scale.
 *
 * A bar per day scaled to itself says nothing — every day would be a full
 * bar. Scaled to the week, a mild Tuesday between two cold days is a short
 * bar sitting high, which is the whole point of drawing it.
 */
function span(days: ForecastEntry[]) {
  const values = days.flatMap((day) =>
    [day.temperature, day.templow].filter((value): value is number => typeof value === "number"),
  );
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max - min < 1 ? { min: min - 1, max: max + 1 } : { min, max };
}

/** A day's low-to-high as a share of the week, measured from the left. */
function bar(day: ForecastEntry, range: { min: number; max: number }) {
  const total = range.max - range.min || 1;
  const high = day.temperature ?? range.max;
  const low = day.templow ?? high;
  const start = ((low - range.min) / total) * 100;
  const end = ((high - range.min) / total) * 100;
  return {
    from_pct: `${start}%`,
    to_pct: `${Math.max(0, 100 - Math.max(end, start + 6))}%`,
    from: shade(low),
    to: shade(high),
  };
}

/** Rain worth mentioning. */
const rainOdds = (day: ForecastEntry) => {
  const odds = day.precipitation_probability;
  return typeof odds === "number" && odds >= 20 ? Math.round(odds) : undefined;
};

/** A forecast's tooltip: the condition, and the rain where it is likely. */
const forecastTitle = (entry: ForecastEntry) => {
  const odds = rainOdds(entry);
  return odds ? `${conditionLabel(entry.condition)} · ${odds}% rain` : conditionLabel(entry.condition);
};

/** The board card: what it is doing outside, and the next few days. */
export function WeatherCard(props: { entityId: string; title: string; onOpen: () => void }) {
  const { entity, daily, hourly } = useForecast(() => props.entityId);

  const scene = () => sceneFor(entity()?.state);
  /* The sun itself rather than the clock: "sunny" is what Home Assistant
     calls it until the sun is under the horizon. */
  const sun = useEntity(() => "sun.sun");
  const night = () => isNight(sun(), entity()?.state);
  /* Four rows on a wide card: enough to see the week turning, few enough
     that each one has the height to be read. A standing card has room for a
     fifth, and the stylesheet shows it only there. */
  const days = () => daily().slice(0, 5);
  const range = () => span(days());
  /* From the hour we are in: a provider's list can start an hour back. */
  const hours = () => {
    const from = Date.now() - 60 * 60_000;
    return hourly()
      .filter((entry) => new Date(entry.datetime).getTime() > from)
      .slice(0, 7);
  };

  return (
    <article class="rb-card rb-card--weather" {...openable(props.onOpen, "Weather")}>
      {/* The same atmosphere the weather widget fills its own card with, with
          a scrim over it: rain drawn across a card is weather, rain drawn
          across the words on it is noise. */}
      <div class="rb-wx-sky">
        <WeatherScene scene={scene()} variant="background" animate night={night()} />
      </div>
      <div class="rb-wx-scrim" />

      {/* A square card is a poster, not a dashboard: the temperature at the
          size of the card, the condition under it, and today's two figures at
          the foot. The row of days needs width it does not have, so it is
          swapped in only when the card is wide enough to hold it. */}
      <div class="rb-wx-poster">
        <span class="rb-wx-big">{temp(tempOf(entity()))}</span>
        <span class="rb-wx-cond rb-truncate">{conditionLabel(entity()?.state)}</span>
        <span class="rb-wx-place rb-truncate">
          {props.title || entity()?.friendlyName || "Weather"}
        </span>

        <Show when={days()[0]}>
          <span class="rb-wx-hilo">
            <b>{temp(days()[0]!.temperature)}</b>
            <i>·</i>
            <span>{temp(days()[0]!.templow)}</span>
          </span>
        </Show>
      </div>

      <header class="rb-card-head rb-wx-wide">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">
            {props.title || entity()?.friendlyName || "Weather"}
          </h3>
          <span class="rb-card-verdict rb-truncate">{conditionLabel(entity()?.state)}</span>
        </div>

        <span class="rb-wx-now">{temp(tempOf(entity()))}</span>
      </header>

      {/* Rows, not columns.
       *
       * A column has to stack the day, the sky, a bar and two temperatures in
       * a card that is wider than it is tall — five of them left every number
       * clipped. Turned on its side the same information has the card's width
       * to spread into: the day, the sky, the span drawn against the week, and
       * the two figures at the end where there is room for them. */}
      <Show when={days().length}>
        <div class="rb-wx-strip rb-wx-wide">
          <For each={days()}>
            {(day) => (
              <span
                class="rb-wx-day"
                title={forecastTitle(day)}
              >
                <span class="rb-wx-day-name">{dayLabel(day)}</span>
                <WeatherScene scene={sceneFor(day.condition)} size="1.1rem" />

                {/* The bar is the first thing to go when the card is narrow:
                    it is the luxury in the row, and the two numbers are not. */}
                <span class="rb-wx-bar">
                  <i
                    style={{
                      left: bar(day, range()).from_pct,
                      right: bar(day, range()).to_pct,
                      background: `linear-gradient(90deg, ${bar(day, range()).from}, ${bar(day, range()).to})`,
                    }}
                  />
                </span>

                <span class="rb-wx-temps">
                  <b>{temp(day.temperature)}</b>
                  <span>{temp(day.templow)}</span>
                </span>
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* Standing, the card has the height for two forecasts, one over the
          other: the next hours, then the next days, each running left to
          right under its own small-caps head, each with a hairline along its
          foot coloured by the temperatures above it. */}
      <Show when={hours().length || days().length}>
        <div class="rb-wx-cols">
          <Show when={hours().length}>
            <ForecastColumn
              label="Hourly"
              entries={hours()}
              name={(entry, index) => (index === 0 ? "Now" : hourLabel(entry))}
            />
          </Show>
          <Show when={days().length}>
            <ForecastColumn
              label="Daily"
              entries={daily().slice(0, 7)}
              name={(entry, index) => (index === 0 ? "Today" : dayLabel(entry))}
              low
            />
          </Show>
        </div>
      </Show>
      <Half icon="mdi:weather-partly-cloudy" name={props.title || entity()?.friendlyName || "Weather"} status={conditionLabel(entity()?.state)} tone="#38bdf8" value={temp(tempOf(entity()))} />
    </article>
  );
}

/** 14, 15 — or 2 PM where the clock is twelve-hour. */
const hourLabel = (entry: ForecastEntry) => {
  const date = new Date(entry.datetime);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: "numeric" })
    : "";
};

/**
 * One forecast of the standing card: a head, and an entry per hour or per
 * day, left to right — when, the sky, and the temperature (the high over the
 * low for a day).
 *
 * The hairline along the foot is the temperatures themselves, each entry's
 * shade from the thermostat's ramp under it, so a cold night coming shows as
 * the line turning blue before any figure is read.
 */
function ForecastColumn(props: {
  label: string;
  entries: ForecastEntry[];
  name: (entry: ForecastEntry, index: number) => string;
  low?: boolean;
}) {
  const spine = () => {
    const stops = props.entries.map((entry) => shade(entry.temperature));
    return stops.length > 1 ? `linear-gradient(90deg, ${stops.join(", ")})` : stops[0] ?? "transparent";
  };

  return (
    <div class="rb-wx-col" data-kind={props.low ? "daily" : "hourly"} style={{ "--rb-wx-spine": spine() }}>
      <span class="rb-wx-col-head">
        {props.label}
      </span>
      <div class="rb-wx-col-rows">
        <For each={props.entries}>
          {(entry, index) => (
            <span
              class="rb-wx-tick"
              data-first={index() === 0}
              title={forecastTitle(entry)}
            >
              <span class="rb-wx-tick-when">{props.name(entry, index())}</span>
              <span class="rb-wx-tick-sky">
                <WeatherScene scene={sceneFor(entry.condition)} size="1rem" />
              </span>
              {/* The chance of rain on a line of its own under the sky, a
                  drop and a figure — kept (empty) on a dry day too, so every
                  column's temperatures stay level. */}
              <span class="rb-wx-tick-wet" data-on={!!rainOdds(entry)}>
                <Show when={rainOdds(entry)}>
                  <Icon icon="mdi:water" width="9" />
                  {rainOdds(entry)}%
                </Show>
              </span>
              <span class="rb-wx-tick-temp">
                <b>{temp(entry.temperature)}</b>
                <Show when={props.low && entry.templow !== undefined}>
                  <span>{temp(entry.templow)}</span>
                </Show>
              </span>
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

/** The overlay: the week, and what the sky is doing beyond its temperature. */
export function WeatherPanel(props: {
  entityId: string;
  title: string;
  entities?: EntityView[];
}) {
  const { entity, daily } = useForecast(() => props.entityId);
  const panelSun = useEntity(() => "sun.sun");

  const warnings = createMemo(() => warningsOf(props.entities ?? []));
  const pollen = createMemo(() => pollenOf(props.entities ?? []));

  type View = "week" | "alerts" | "pollen";
  const [tab, setTab] = createSignal<View | "">("");

  const tabs = createMemo(() => {
    const items: TabItem<View>[] = [
      { id: "week", label: "Forecast", icon: "mdi:calendar-week" },
    ];
    if (warnings().length) items.push({ id: "alerts", label: "Warnings", icon: "mdi:alert-outline" });
    if (pollen().length) items.push({ id: "pollen", label: "Pollen", icon: "mdi:flower-pollen" });
    return items;
  });

  /* A warning in force opens on itself: a storm is the reason the panel was
     opened, and making it a tab nobody presses would hide it. Everything else
     opens on the week. */
  const active = (): View => {
    const chosen = tab();
    if (chosen && tabs().some((item) => item.id === chosen)) return chosen;
    return warnings().some((warning) => !warning.advance) ? "alerts" : "week";
  };

  const details = () => {
    const reading = entity();
    return [
      { icon: "mdi:water-percent", name: "Humidity", value: attr<number | undefined>(reading, "humidity", undefined), unit: "%" },
      { icon: "mdi:weather-windy", name: "Wind", value: attr<number | undefined>(reading, "wind_speed", undefined), unit: attr<string>(reading, "wind_speed_unit", "km/h") },
      { icon: "mdi:gauge", name: "Pressure", value: attr<number | undefined>(reading, "pressure", undefined), unit: attr<string>(reading, "pressure_unit", "hPa") },
      { icon: "mdi:thermometer-low", name: "Feels like", value: attr<number | undefined>(reading, "apparent_temperature", undefined), unit: "°" },
    ].filter((row) => row.value !== undefined);
  };

  return (
    <div class="rb-wx-panel">
      <div class="rb-wx-hero">
        <WeatherScene
          scene={sceneFor(entity()?.state)}
          size="4.5rem"
          animate
          night={isNight(panelSun(), entity()?.state)}
        />

        <div class="rb-wx-hero-meta">
          <span class="rb-wx-hero-temp">{temp(tempOf(entity()))}</span>
          <span class="rb-wx-hero-name">
            {conditionLabel(entity()?.state)}
            <Show when={props.title || entity()?.friendlyName}>
              {` · ${props.title || entity()?.friendlyName}`}
            </Show>
          </span>
        </div>
      </div>

      <Show when={tabs().length > 1}>
        <Tabs items={tabs()} active={active()} onPick={setTab} />
      </Show>

      <Show when={active() === "alerts"}>
        <WeatherWarnings warnings={warnings()} />
      </Show>

      <Show when={active() === "pollen"}>
        <PollenList items={pollen()} />
      </Show>

      <Show when={active() === "week" && details().length}>
        <div class="rb-cam-readings">
          <For each={details()}>
            {(row) => (
              <span class="rb-cam-reading">
                <Icon icon={row.icon} width="14" />
                <span class="rb-truncate">{row.name}</span>
                <b>{row.unit === "°" ? temp(row.value) : `${Math.round(row.value!)} ${row.unit}`}</b>
              </span>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={active() === "week" && daily().length}
        fallback={
          <Show when={active() === "week"}>
            <p class="rb-act-none">This provider publishes no daily forecast.</p>
          </Show>
        }
      >
        <div class="rb-wx-days">
          <For each={daily().slice(0, 7)}>
            {(day) => {
              const week = span(daily().slice(0, 7));
              const total = week.max - week.min || 1;
              const high = day.temperature ?? week.max;
              const low = day.templow ?? high;
              return (
                <div class="rb-wx-row">
                  <span class="rb-wx-row-day">{dayLabel(day)}</span>
                  <WeatherScene scene={sceneFor(day.condition)} size="1.6rem" />
                  <span class="rb-wx-row-cond rb-truncate">
                    {conditionLabel(day.condition)}
                    <Show when={rainOdds(day)}>
                      <b class="rb-wx-row-rain">
                        <Icon icon="mdi:water" width="11" />
                        {rainOdds(day)}%
                      </b>
                    </Show>
                  </span>

                  <span class="rb-wx-row-low">{temp(day.templow)}</span>

                  {/* Every day against the same week, so the row reads as a
                      week rather than as seven unrelated pairs. */}
                  <span class="rb-wx-track">
                    <i
                      style={{
                        left: `${((low - week.min) / total) * 100}%`,
                        right: `${100 - ((high - week.min) / total) * 100}%`,
                        background: `linear-gradient(90deg, ${shade(low)}, ${shade(high)})`,
                      }}
                    />
                  </span>

                  <span class="rb-wx-row-high">{temp(day.temperature)}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * The sky behind the top of the weather overlay, the way the iOS weather app
 * draws it: the colour of the hour and the condition, with what is actually
 * happening moving in it — clouds drifting, rain falling, snow, a flash in a
 * storm, stars at night — fading into the sheet before the forecast starts.
 *
 * Plain elements and CSS rather than a canvas: a dozen layers animated by
 * transform cost the browser next to nothing, keep running when the widget
 * does not, and stop for anyone who asked for less motion.
 */
export function WeatherSky(props: { entityId: string }) {
  const weather = useEntity(() => props.entityId);
  const sun = useEntity(() => "sun.sun");
  const scene = () => sceneFor(weather()?.state);
  const night = () => isNight(sun(), weather()?.state);
  const heavy = () => weather()?.state === "pouring" || weather()?.state === "lightning-rainy";
  return (
    <div
      class="rb-sky"
      aria-hidden="true"
      data-scene={scene()}
      data-night={night()}
      data-heavy={heavy()}
    >
      <i class="rb-sky-stars" />
      <i class="rb-sky-orb" />
      <i class="rb-sky-rays" />
      <For each={[0, 1, 2, 3, 4]}>{(index) => <i class="rb-sky-cloud" style={{ "--i": index }} />}</For>
      <For each={[0, 1, 2]}>{(index) => <i class="rb-sky-fog" style={{ "--i": index }} />}</For>
      <i class="rb-sky-rain" data-layer="far" />
      <i class="rb-sky-rain" data-layer="near" />
      <i class="rb-sky-snow" data-layer="far" />
      <i class="rb-sky-snow" data-layer="near" />
      <i class="rb-sky-flash" />
    </div>
  );
}
