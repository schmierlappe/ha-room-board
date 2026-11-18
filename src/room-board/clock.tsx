import { Show, createSignal, onCleanup } from "solid-js";

export type ClockFormat = "24h" | "12h";

/** How the digits are drawn on the photo; the stylesheet has one look per name. */
export const CLOCK_STYLES = ["bold", "thin", "hairline", "mono", "frosted", "gradient"] as const;
export type ClockStyle = (typeof CLOCK_STYLES)[number];

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The time in the corner of the room's photo: large, the way a clock on a
 * wall reads from across the room, and under it the room's name and the day
 * — it stands in for the photo's titles. Six looks for the digits (`look`),
 * bold hours over thin minutes by default — the one that holds up on a bright
 * photo as well as a dark one.
 *
 * It moves on the minute rather than every second — a board on the wall
 * all day has no use for a ticking second, and each tick is a repaint over
 * the blurred glass. The timer is set to the next full minute each time, so
 * it stays on the minute however long the board is up.
 */
export function SceneClock(props: { format: ClockFormat; look: ClockStyle; room: string }) {
  const [now, setNow] = createSignal(new Date());

  let timer: ReturnType<typeof setTimeout> | undefined;
  const next = () => {
    timer = setTimeout(
      () => {
        setNow(new Date());
        next();
      },
      60_000 - (Date.now() % 60_000) + 50,
    );
  };
  next();
  onCleanup(() => clearTimeout(timer));

  const hours = () => {
    const h = now().getHours();
    return props.format === "12h" ? String(h % 12 || 12) : pad(h);
  };
  const half = () => (now().getHours() < 12 ? "AM" : "PM");
  const day = () => now().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div class="rb-scene-clock" data-look={props.look}>
      <time class="rb-clock-time" dateTime={now().toISOString()}>
        <span class="rb-clock-h">{hours()}</span>
        <span class="rb-clock-colon">:</span>
        <span class="rb-clock-m">{pad(now().getMinutes())}</span>
        <Show when={props.format === "12h"}>
          <span class="rb-clock-half">{half()}</span>
        </Show>
      </time>
      <span class="rb-clock-room rb-truncate">{props.room}</span>
      <span class="rb-clock-day rb-truncate">{day()}</span>
    </div>
  );
}
