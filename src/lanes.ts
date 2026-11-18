/**
 * Room for the dashboard's "lane" requests: history, statistics, forecasts
 * and calendars.
 *
 * The sealed engine of Dash 1.5 lets a widget have only 16 of them in flight
 * at once and refuses the next with "too many requests". A board that draws
 * twenty charts at once went over it, and a refused statistics query read by
 * a chart stopped the whole widget. Everything the widgets ask for themselves
 * goes through here, at most LIMIT at a time, leaving the rest for the SDK's
 * own trackers.
 */
const LIMIT = 8;

let busy = 0;
const waiting: Array<() => void> = [];

/** Resolves once a request may go out; call the returned release when it is answered. */
export function laneSlot(): { ready: Promise<void>; release: () => void } {
  let held = false;
  let done = false;
  let grant!: () => void;
  const ready = new Promise<void>((resolve) => {
    grant = () => {
      held = true;
      busy++;
      resolve();
    };
  });
  if (busy < LIMIT) grant();
  else waiting.push(grant);

  const release = () => {
    if (done) return;
    done = true;
    if (!held) {
      /* Given up before its turn came: out of the queue, no slot to free. */
      const at = waiting.indexOf(grant);
      if (at >= 0) waiting.splice(at, 1);
      return;
    }
    busy--;
    waiting.shift()?.();
  };
  return { ready, release };
}

/** Runs a lane request when there is room for it. */
export async function inLane<T>(request: () => Promise<T>): Promise<T> {
  const slot = laneSlot();
  await slot.ready;
  try {
    return await request();
  } finally {
    slot.release();
  }
}
