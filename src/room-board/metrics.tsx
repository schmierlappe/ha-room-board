import { Show } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { Spark } from "./spark";
import { classOf, health, numeric, sinceLabel, toneOf, verdict, warmth } from "./util";
import { Half } from "./half";

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

/* Every reading as the same smooth line over a fading fill, in its own
   colour. Bars and capsules said "a sample per slice" truthfully but read as
   noise on a dashboard; the line is the trend, which is what a tile is for. */
/** The range a reading is meant to sit in, in its own units. */
const BANDS: Record<string, [number, number]> = {
  humidity: [35, 60],
  temperature: [18, 24],
  carbon_dioxide: [0, 800],
  pm25: [0, 12],
  pm10: [0, 35],
};

const chartKind = (_kind: string) => "line" as const;



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
      <Half icon={ICONS[kind()] ?? "mdi:gauge"} name={props.entity.friendlyName ?? props.entity.id} status={value() !== undefined ? verdict(kind(), value()!) || "" : "Unavailable"} tone={tone()} value={value() === undefined ? "—" : `${Math.round(value()! * 10) / 10}${props.entity.unitOfMeasurement ?? ""}`} />
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
      <Half icon={ICONS[kind()] ?? "mdi:gauge"} name={props.entity.friendlyName ?? props.entity.id} status={value() !== undefined ? verdict(kind(), value()!) || "" : "Unavailable"} tone={tone()} value={value() === undefined ? "—" : `${Math.round(value()! * 10) / 10}${props.entity.unitOfMeasurement ?? ""}`} />
    </article>
  );
}
