import { For, Show, createMemo } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
/* The room widget's own agenda plumbing: one subscription per calendar, merged
   and tagged so a colour can still say where an entry came from. */
import { calendarColour, createCalendarAgenda } from "../room/calendars";
import type { AgendaEntry } from "../room/util";
import { TodoChips, TodoLists } from "./todo";
import { openable } from "./util";
import { Half } from "./half";

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Today, Tomorrow, or the day itself — what a person would call it. */
function dayName(date: Date): string {
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const timeLabel = (entry: AgendaEntry) =>
  entry.allDay
    ? "All day"
    : entry.start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Entries grouped under the day they fall on. */
function byDay(entries: AgendaEntry[]) {
  const groups: { key: number; date: Date; entries: AgendaEntry[] }[] = [];
  for (const entry of entries) {
    const key = startOfDay(entry.start);
    const last = groups.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, date: entry.start, entries: [entry] });
  }
  return groups;
}

function Row(props: { entry: AgendaEntry; ids: string[] }) {
  return (
    <div class="rb-cal-row">
      <span
        class="rb-cal-mark"
        style={{ background: calendarColour(props.ids, props.entry.calendarId) }}
      />
      <span class="rb-cal-time">{timeLabel(props.entry)}</span>
      <span class="rb-cal-name">{props.entry.summary || "Busy"}</span>
    </div>
  );
}

/**
 * The board's lead tile: the date, and what is coming.
 *
 * It takes the big slot because a day's plan is the one thing on a room board
 * that is read rather than glanced at — a temperature says everything it has
 * to say at a glance, and can sit in a small tile beside this quite happily.
 */
export function CalendarCard(props: { ids: string[]; todoIds?: string[]; onOpen: () => void }) {
  const { Feeds, agenda } = createCalendarAgenda(() => props.ids, 30);

  const today = new Date();
  const groups = createMemo(() => byDay(agenda()).slice(0, 3));
  const todayCount = () =>
    agenda().filter((entry) => startOfDay(entry.start) === startOfDay(new Date())).length;
  const countLine = () => {
    if (todayCount()) return `${todayCount()} today`;
    return agenda().length ? "Nothing today" : "Nothing ahead";
  };

  return (
    <article class="rb-card rb-card--hero rb-card--calendar" {...openable(props.onOpen, "Calendar")}>
      <Feeds />

      <header class="rb-cal-head">
        <div class="rb-cal-date">
          <span class="rb-cal-weekday">
            {today.toLocaleDateString(undefined, { weekday: "long" })}
          </span>
          <span class="rb-cal-day">{today.getDate()}</span>
          <span class="rb-cal-month">
            {today.toLocaleDateString(undefined, { month: "long" })}
          </span>
        </div>

        {/* The shopping list's count beside the day's, a chip each. */}
        <span class="rb-cal-chips">
        <TodoChips ids={props.todoIds ?? []} />
        <span class="rb-cal-count" data-busy={todayCount() > 0}>
          <Icon icon="mdi:calendar-blank-outline" width="15" />
          <i class="rb-cal-count-dot" />
          {/* Two wordings, one shown by the card's width: "Nothing today"
              is twice "1 today", and in a narrow card beside the weekday it
              ran off the edge. There it says "Free". */}
          <span class="rb-cal-count-long">
            {countLine()}
          </span>
          <span class="rb-cal-count-short">{todayCount() ? `${todayCount()} today` : "Free"}</span>
        </span>
        </span>
      </header>

      <div class="rb-cal-list">
        <For each={groups()}>
          {(group) => (
            <section class="rb-cal-group">
              <h4 class="rb-cal-dayname">{dayName(group.date)}</h4>
              <For each={group.entries.slice(0, 4)}>
                {(entry) => <Row entry={entry} ids={props.ids} />}
              </For>
            </section>
          )}
        </For>

        <Show when={!agenda().length}>
          <p class="rb-act-none">
            {props.ids.length || props.todoIds?.length
              ? "Nothing in the next month."
              : "Pick the calendars to show in settings."}
          </p>
        </Show>
      </div>
      <Half art={<span class="rb-half-date"><small>{today.toLocaleDateString(undefined, { month: "short" })}</small><b>{today.getDate()}</b></span>} icon="mdi:calendar-today" name={today.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} status={countLine()} tone="#8b7cf6" lit={todayCount() > 0} />
    </article>
  );
}

/** The overlay: the month ahead, a day at a time. */
export function CalendarPanel(props: { ids: string[]; todoIds?: string[] }) {
  const { Feeds, agenda } = createCalendarAgenda(() => props.ids, 60);
  const groups = createMemo(() => byDay(agenda()));

  return (
    <div class="rb-cal-panel" data-lists={!!props.todoIds?.length}>
      <Feeds />

      {/* The lists: above the agenda on a phone, a column to its right on a
          wider board. */}
      <Show when={props.todoIds?.length}>
        <aside class="rb-cal-lists">
          <TodoLists ids={props.todoIds ?? []} />
        </aside>
      </Show>

      <div class="rb-cal-agenda">

      <Show
        when={groups().length}
        fallback={<p class="rb-act-none">Nothing in the next two months.</p>}
      >
        <For each={groups()}>
          {(group) => (
            <section class="rb-cal-block">
              <h3 class="rb-cal-blockname">
                {dayName(group.date)}
                <span>
                  {group.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
              </h3>

              <div class="rb-cal-block-rows">
                <For each={group.entries}>
                  {(entry) => (
                    <div
                      class="rb-cal-entry"
                      style={{ "--cal": calendarColour(props.ids, entry.calendarId) }}
                    >
                      <span class="rb-cal-entry-time">{timeLabel(entry)}</span>
                      <span class="rb-cal-entry-meta">
                        <span class="rb-cal-entry-name rb-truncate">
                          {entry.summary || "Busy"}
                        </span>
                        <Show when={entry.location}>
                          <span class="rb-cal-entry-where rb-truncate">
                            <Icon icon="mdi:map-marker-outline" width="12" />
                            {entry.location}
                          </span>
                        </Show>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
      </div>
    </div>
  );
}
