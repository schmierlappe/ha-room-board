import { For, createEffect, createSignal } from "solid-js";
import { useCalendarEvents } from "@glasshome/widget-sdk";
import { toAgenda, upcoming, type AgendaEntry } from "./util";

/**
 * Several calendars, read as one agenda.
 *
 * useCalendarEvents subscribes to a single entity, and the number of calendars
 * is a setting — so it cannot be called in a loop from the panel itself
 * without the hook count changing between renders. One renderless child per
 * calendar keeps each subscription owned by a component of its own, and the
 * parent merges what they report.
 */
function Feed(props: {
  id: string;
  daysAhead: number;
  onEntries: (id: string, entries: AgendaEntry[]) => void;
}) {
  const events = useCalendarEvents(() => props.id, { daysAhead: props.daysAhead });
  createEffect(() => props.onEntries(props.id, toAgenda(events()?.events ?? [])));
  return null;
}

export function createCalendarAgenda(ids: () => string[], daysAhead = 30) {
  const [byCalendar, setByCalendar] = createSignal<Record<string, AgendaEntry[]>>({});

  const Feeds = () => (
    <For each={ids()}>
      {(id) => (
        <Feed
          id={id}
          daysAhead={daysAhead}
          onEntries={(key, entries) =>
            setByCalendar((previous) => ({ ...previous, [key]: entries }))
          }
        />
      )}
    </For>
  );

  /* Read through the current ids rather than over everything collected, so a
     calendar removed in settings stops contributing immediately instead of
     leaving its entries behind until the widget is remounted. Each entry is
     tagged on the way out, because once they are merged and sorted there is
     nothing else left to say which calendar an entry came from. */
  const agenda = () =>
    upcoming(
      ids()
        .flatMap((id) => (byCalendar()[id] ?? []).map((entry) => ({ ...entry, calendarId: id })))
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    );

  return { Feeds, agenda };
}

/**
 * A colour per calendar.
 *
 * Assigned by the calendar's position in the settings rather than hashed from
 * its entity id: two calendars next to each other in the list are the two most
 * likely to appear side by side on a busy day, and a hash would happily give
 * them neighbouring hues. Ordered to stay distinct on a dark card.
 */
const PALETTE = [
  "#34d399",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#a3e635",
];

export function calendarColour(ids: string[], id?: string): string {
  const index = id ? ids.indexOf(id) : -1;
  return PALETTE[Math.max(0, index) % PALETTE.length]!;
}
