import { Show } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { Spark } from "./spark";
import { classOf, health, numeric, sinceLabel, toneOf, verdict, warmth } from "./util";

const ICONS: Record<string, string> = {
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  carbon_dioxide: "mdi:molecule-co2",
  pm25: "mdi:blur",
  pm10: "mdi:blur",
  volatile_organic_compounds: "mdi:air-filter",
  volatile_organic_compounds_parts: "mdi:air-filter",
  illuminance: "mdi:brightness-6",
  pressure: "mdi:gauge",
  atmospheric_pressure: "mdi:gauge",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
};

/* A line for anything that drifts, bars for anything that steps. Temperature,
   pressure and humidity move slowly and continuously — a room's humidity is
   the same kind of curve as its temperature, and drawing it as a picket fence
   said it changed in steps that it never took. A CO₂ reading or a power draw
   really does jump, and bars say so without pretending to interpolate between
   samples. */
const BARS = new Set(["carbon_dioxide", "power", "energy", "illuminance"]);

/* Humidity as capsules: a room's damp is a range within the hour rather than
   a single number, and the reference draws exactly that — a floating mark per
   bucket, warm where the reading leaves the comfortable band. */
const CAPSULES = new Set(["humidity"]);

/** The range a reading is meant to sit in, in its own units. */
const BANDS: Record<string, [number, number]> = {
  humidity: [35, 60],
  temperature: [18, 24],
  carbon_dioxide: [0, 800],
  pm25: [0, 12],
  pm10: [0, 35],
};

const chartKind = (kind: string) => {
  if (CAPSULES.has(kind)) return "capsules";
  return BARS.has(kind) ? "bars" : "line";
};



/** The big card: one reading at full size with its own chart under it. */
export function HeroMetric(props: { entity: EntityView; hours: number }) {
  const value = () => numeric(props.entity);
  const unit = () => props.entity.unitOfMeasurement ?? "";
  const kind = () => classOf(props.entity);
  const tone = () => toneOf(kind(), value());

  return (
    <article class="rb-card rb-card--hero" data-card={`metric:${props.entity.id}`} style={{ "--rb-tone": tone() }}>
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name">{props.entity.friendlyName ?? props.entity.id}</h3>
          <Show when={value() !== undefined && verdict(kind(), value()!)}>
            <span class="rb-card-verdict">{verdict(kind(), value()!)}</span>
          </Show>
        </div>
      </header>

      <div class="rb-hero-read">
        <span class="rb-hero-value">
          {value() === undefined ? "—" : Math.round(value()! * 10) / 10}
        </span>
        <span class="rb-hero-unit">{unit()}</span>
        <span class="rb-hero-badge">
          <Icon icon={ICONS[kind()] ?? "mdi:gauge"} width="16" />
        </span>
      </div>

      <div class="rb-hero-since">
        <span>Updated</span>
        <b>{sinceLabel(props.entity.lastChanged ?? props.entity.lastUpdated) || "just now"}</b>
      </div>

      <Spark
        entityId={props.entity.id}
        hours={props.hours}
        kind={chartKind(kind())}
        band={BANDS[kind()]}
        tone={tone()}
        rich
        health={value() === undefined ? 1 : health(kind(), value()!)}
        warmth={
          kind() === "temperature" && value() !== undefined ? warmth(value()!) : undefined
        }
      />
    </article>
  );
}

/** The small cards down the right of the board. */
export function Metric(props: { entity: EntityView; hours: number }) {
  const value = () => numeric(props.entity);
  const kind = () => classOf(props.entity);
  const tone = () => toneOf(kind(), value());

  return (
    <article class="rb-card" data-card={`metric:${props.entity.id}`} style={{ "--rb-tone": tone() }}>
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">{props.entity.friendlyName ?? props.entity.id}</h3>
          <Show when={value() !== undefined && verdict(kind(), value()!)}>
            <span class="rb-card-verdict rb-truncate">{verdict(kind(), value()!)}</span>
          </Show>
        </div>
      </header>

      <div class="rb-read">
        <span class="rb-read-badge">
          <Icon icon={ICONS[kind()] ?? "mdi:gauge"} width="14" />
        </span>
        <span class="rb-read-value">
          {value() === undefined ? "—" : Math.round(value()! * 10) / 10}
        </span>
        <span class="rb-read-unit">{props.entity.unitOfMeasurement ?? ""}</span>
      </div>

      <Spark
        entityId={props.entity.id}
        hours={props.hours}
        kind={chartKind(kind())}
        band={BANDS[kind()]}
        tone={tone()}
        health={value() === undefined ? 1 : health(kind(), value()!)}
        warmth={
          kind() === "temperature" && value() !== undefined ? warmth(value()!) : undefined
        }
      />
    </article>
  );
}
