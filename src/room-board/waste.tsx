import { For, Show, createMemo } from "solid-js";
import { Icon, useEntity, type EntityView } from "@glasshome/widget-sdk";
/* The waste widget's own readers: one sensor, a dozen integrations' worth of
   shapes behind it, and a parser that already knows all of them. */
import {
  countdownParts,
  isImminent,
  parseStateSummary,
  parseUpcoming,
  relativeLabel,
  shortTypeLabel,
  styleForType,
  type WasteItem,
} from "../waste-scheduler/util";
import { openable } from "./util";

/**
 * Whether a sensor is a waste schedule at all.
 *
 * Asked of the reading rather than of the name: the parsers already know every
 * shape waste_collection_schedule publishes, so a sensor they can read is one,
 * and a sensor they cannot is not — whatever it happens to be called in
 * whichever language.
 */
export function looksLikeWaste(entity: EntityView | undefined): boolean {
  if (entity?.domain !== "sensor" || entity.entityCategory) return false;
  return parseUpcoming(entity).length > 0 || !!parseStateSummary(entity);
}

/** The next pickup, and the ones after it. */
function useSchedule(entityId: () => string) {
  const entity = useEntity(entityId);

  const items = createMemo<WasteItem[]>(() => {
    const upcoming = parseUpcoming(entity());
    if (upcoming.length) return upcoming;
    const summary = parseStateSummary(entity());
    return summary ? [summary] : [];
  });

  return { entity, items };
}

const dayLabel = (item: WasteItem) =>
  item.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * The board card: which bin goes out next, and when.
 *
 * A countdown rather than a date, because "tomorrow" is what decides whether
 * the bin goes out tonight — the date is in the overlay for anyone planning
 * further ahead than that.
 */
export function WasteCard(props: { entityId: string; onOpen: () => void }) {
  const { items } = useSchedule(() => props.entityId);

  const next = () => items()[0];
  const rest = () => items().slice(1, 3);
  const look = () => styleForType(next()?.type ?? "");
  const soon = () => !!next() && isImminent(next()!.date);

  return (
    <article
      class="rb-card rb-card--waste"
      data-soon={soon()}
      style={{ "--rb-bin": look().color }}
      {...openable(props.onOpen, "Waste collection")}
    >
      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">
            {next() ? shortTypeLabel(next()!.type) : "Waste"}
          </h3>
          {/* The date, not the countdown: the countdown is the large figure
              underneath, and a card that says "in 5 days" twice is a card
              that has said nothing twice. */}
          <span class="rb-card-verdict rb-truncate">
            {next() ? dayLabel(next()!) : "Nothing scheduled"}
          </span>
        </div>

        <span class="rb-waste-badge">
          <Icon icon={look().icon} width="20" />
        </span>
      </header>

      <Show when={next()}>
        <div class="rb-waste-count">
          <b>{countdownParts(next()!.date).value}</b>
          <Show when={countdownParts(next()!.date).unit}>
            <span>{countdownParts(next()!.date).unit}</span>
          </Show>
        </div>
      </Show>

      {/* What follows it, on one line. Three full-width pills stacked below a
          countdown is a list, and a list does not fit on a tile. */}
      <Show when={rest().length}>
        <div class="rb-waste-next">
          <For each={rest()}>
            {(item) => (
              <span
                class="rb-waste-pip"
                style={{ "--rb-bin": styleForType(item.type).color }}
                title={`${shortTypeLabel(item.type)} — ${relativeLabel(item.date)}`}
              >
                <i />
                <span class="rb-truncate">{shortTypeLabel(item.type)}</span>
                <b>{countdownParts(item.date).value}</b>
              </span>
            )}
          </For>
        </div>
      </Show>
    </article>
  );
}

/** The overlay: everything the schedule knows about, in order. */
export function WastePanel(props: { entityId: string }) {
  const { items } = useSchedule(() => props.entityId);

  return (
    <div class="rb-waste-panel">
      <Show
        when={items().length}
        fallback={
          <p class="rb-act-none">
            No pickups found. Pick the waste schedule's "next collection" sensor in settings.
          </p>
        }
      >
        <div class="rb-waste-rows">
          <For each={items()}>
            {(item) => {
              const look = styleForType(item.type);
              return (
                <div
                  class="rb-waste-row"
                  data-soon={isImminent(item.date)}
                  style={{ "--rb-bin": look.color }}
                >
                  <span class="rb-waste-badge">
                    <Icon icon={look.icon} width="19" />
                  </span>

                  <span class="rb-waste-row-meta">
                    <span class="rb-waste-row-name rb-truncate">{shortTypeLabel(item.type)}</span>
                    <span class="rb-waste-row-date">{dayLabel(item)}</span>
                  </span>

                  <span class="rb-waste-row-when">{relativeLabel(item.date)}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
