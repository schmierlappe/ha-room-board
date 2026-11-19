import { For, Index, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js";
import {
  monotoneCubicPath,
  trackEntityHistory,
  untrackEntityHistory,
  useEntity,
  useEntityHistory,
  useEntityStatistics,
} from "@glasshome/widget-sdk";
import { inLane, laneSlot } from "../lanes";

/**
 * A reading's recent history, as a line or as bars.
 *
 * Drawn in a 100×40 viewBox with preserveAspectRatio off, so the same path
 * stretches to whatever the card is without the widget having to measure it —
 * a chart that needs a ResizeObserver to decide its own points redraws on
 * every layout pass for no benefit at this size.
 */
/**
 * How many charts are holding each entity's history.
 *
 * The same sensor can be on screen twice — the room's temperature leads the
 * board and also draws the line under the thermostat — and the history store
 * is keyed by entity, not by chart. Tracked twice and untracked twice, the
 * first release took the record out from under the chart still using it, and
 * the next store update walked into a hole: "undefined is not an object
 * (evaluating 'e.entity.id')", thrown inside the sync layer during a signal
 * write, which stops the widget dead.
 *
 * Counting here means the store is told once for the first chart and once
 * more only when the last one goes.
 */
const holders = new Map<string, number>();
/** Waiting for a lane slot to be tracked. */
const queued = new Set<string>();

function hold(entityId: string, hours: number): void {
  const count = (holders.get(entityId) ?? 0) + 1;
  holders.set(entityId, count);
  if (count > 1) return;

  /* Through the lane queue (src/lanes.ts), once: a chart that went before
     its turn came is not asked for, and one asked again meanwhile is not
     asked twice. */
  if (queued.has(entityId)) return;
  queued.add(entityId);
  void inLane(async () => {
    queued.delete(entityId);
    if (!holders.has(entityId)) return;
    await trackEntityHistory(entityId, {
      startTime: new Date(Date.now() - hours * 3_600_000),
      minimalResponse: true,
      significantChangesOnly: false,
    });
  }).catch(() => undefined);
}

function release(entityId: string): void {
  const count = (holders.get(entityId) ?? 1) - 1;
  if (count > 0) {
    holders.set(entityId, count);
    return;
  }
  holders.delete(entityId);
  untrackEntityHistory(entityId);
}

export function Spark(props: {
  entityId: string;
  hours: number;
  kind?: "line" | "bars" | "capsules";
  /** Gridlines, a gradient stroke and a clock along the foot — the hero's
   *  chart has the room for all three; a card two inches wide has not. */
  rich?: boolean;
  /** 0–1. Tints the whole chart, so a bad reading reads as bad at a glance. */
  health?: number;
  /** 0–1 cold to hot. Where it applies — a temperature — it replaces health:
   *  "too cold" and "too hot" are both bad, and one number cannot say which. */
  warmth?: number;
  /** Overrides the colour the chart derives for itself, so a card's icon and
   *  its chart are always the same colour. */
  tone?: string;
  /** The comfortable range in the reading's own units. Capsules outside it are
   *  drawn warm, which is what turns a chart into a verdict. */
  band?: [number, number];
  /** A chart to read rather than glance at: a caption with the window's low
   *  and high over it, a clock under it, and a finger or pointer on it shows
   *  the reading at that moment. */
  interactive?: boolean;
  /** Heading of an interactive chart, e.g. "Last 6 h". */
  caption?: string;
  /** A level to draw across the chart — the thermostat's target. Left out when
   *  it is so far from the readings that showing it would flatten the line. */
  target?: number;
}) {
  /* The chart is drawn from Home Assistant's statistics, its 5-minute
     means, rather than from the raw history.
     *
     * The raw history of a sensor that reports every few seconds is thousands
     * of points for a six-hour window, and in the sealed engine of Dash 1.5
     * every chart that comes or goes has the history of all the others sent
     * into the widget again: removing one card while arranging went over the
     * engine's limit for a step and stopped the widget. Statistics are 72
     * points for the same six hours, asked for once, and the chart thins to
     * 24 columns anyway. The window moves on every ten minutes; the reading's
     * current value is the line's last point, so the end of it is live. */
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 10 * 60_000);
  onCleanup(() => clearInterval(tick));
  /* The query changes only with the sensor, the window or the ten-minute
     tick. Described inline, it was a new query each time the card's props
     were handed over again, and every chart on the board asked Home Assistant
     afresh whenever a card was removed. */
  const entityId = createMemo(() => props.entityId);
  const hours = createMemo(() => props.hours);
  const query = createMemo(() => ({
    startTime: new Date(now() - hours() * 3_600_000),
    period: "5minute" as const,
  }));
  /* Asked for only once there is a lane slot for it (src/lanes.ts): a board
     drawing twenty charts at once went over the engine's sixteen requests in
     flight. Until then the query names no sensor, which the SDK answers with
     nothing and without asking. The slot is given back when the answer
     comes, or when the chart goes. */
  const slot = laneSlot();
  onCleanup(slot.release);
  const [granted, setGranted] = createSignal(false);
  void slot.ready.then(() => setGranted(true));
  const asked = createMemo(() => (granted() ? entityId() : ""));
  const statistics = useEntityStatistics(asked, query);
  /* Answered: the query went out and came back, either way. */
  const [answered, setAnswered] = createSignal(false);
  let loading = false;
  createEffect(() => {
    if (!granted()) return;
    if (!entityId()) {
      slot.release();
      return;
    }
    if (statistics.loading) {
      loading = true;
      return;
    }
    if (loading || statistics.state === "errored") {
      slot.release();
      setAnswered(true);
    }
  });
  /* A refused or failed query reads as no statistics; read as it stands it
     would throw its error into the board and stop it. */
  const rows = () => (statistics.state === "errored" ? undefined : statistics());
  const live = useEntity(entityId);

  /* A sensor without statistics (no state_class) is drawn from its history,
     as before: one tracker per chart, released on cleanup, and held back
     until the card is on screen. */
  let box: HTMLDivElement | undefined;
  const needsHistory = () => answered() && !(rows()?.length ?? 0);

  createEffect(() => {
    if (!needsHistory()) return;
    const id = props.entityId;
    let tracking = false;
    const start = () => {
      if (tracking) return;
      tracking = true;
      hold(id, props.hours);
    };
    if (!box || typeof IntersectionObserver === "undefined") {
      start();
    } else {
      const watcher = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            start();
            watcher.disconnect();
          }
        },
        { rootMargin: "200px" },
      );
      watcher.observe(box);
      onCleanup(() => watcher.disconnect());
    }
    onCleanup(() => {
      if (tracking) release(id);
    });
  });

  const history = useEntityHistory(() => (needsHistory() ? props.entityId : ""));

  /** The points to draw, in the history timeline's own shape: seconds and a state. */
  const timeline = createMemo(() => {
    const found = rows();
    if (found?.length) {
      const points = found.map((row) => ({
        timestamp: row.start / 1000,
        state: String(row.mean ?? row.state ?? Number.NaN),
      }));
      const current = live();
      if (current) points.push({ timestamp: Date.now() / 1000, state: current.state });
      return points;
    }
    return history()?.timeline ?? [];
  });

  const frame = createMemo(() => {
    const cutoff = Date.now() / 1000 - props.hours * 3600;

    const values = timeline()
      .filter((point) => point.timestamp >= cutoff)
      .map((point) => ({ t: point.timestamp, v: Number(point.state) }))
      .filter((point) => Number.isFinite(point.v));

    if (values.length < 2) return { points: [], target: undefined };

    /* Thinned to a fixed count rather than plotted in full: a six-hour window
       can hold thousands of points, and a path with one node per pixel column
       is the most a 100-unit viewBox can show anyway.
     *
     * Fewer nodes also read as a smoother curve. A monotone spline through 48
     * points of noisy sensor data still shows every wobble, because it is
     * faithfully drawing every wobble; halving the nodes and averaging what
     * falls between them is what turns a reading into a trend. */
    /* An interactive chart is read point by point, so it keeps a few more:
       ten minutes a column over six hours rather than fifteen. */
    const COLUMNS = props.interactive ? 36 : 24;
    const first = values[0]!.t;
    const span = Math.max(1, values.at(-1)!.t - first);
    const buckets: number[][] = Array.from({ length: COLUMNS }, () => []);

    for (const point of values) {
      const index = Math.min(COLUMNS - 1, Math.floor(((point.t - first) / span) * COLUMNS));
      buckets[index]!.push(point.v);
    }

    const filled: number[] = [];
    /* What the reading did inside each bucket, not just where it ended up:
       the capsule spans that, which is what gives the chart its texture. */
    const spans: [number, number][] = [];
    let carry = values[0]!.v;
    for (const bucket of buckets) {
      if (bucket.length) carry = bucket.reduce((sum, v) => sum + v, 0) / bucket.length;
      filled.push(carry);
      spans.push(bucket.length ? [Math.min(...bucket), Math.max(...bucket)] : [carry, carry]);
    }

    /* One pass of a three-wide moving average. The bucket average already
       removes the sampling noise; this removes the step between one bucket and
       the next, which is what the eye reads as a kink in the line. */
    const pass = (from: number[]) =>
      from.map((value, index) => {
        const before = from[index - 1] ?? value;
        const after = from[index + 1] ?? value;
        return (before + value * 2 + after) / 4;
      });
    /* A tile gets a second pass: at two inches wide, the trend is the whole
       point, and the wobble left after one pass reads as jitter. */
    const smooth = props.rich || props.interactive ? pass(filled) : pass(pass(filled));

    /* Capsules span the raw low and high of each bucket, not the smoothed
       value, so the scale has to cover those too. Measured on the smoothed
       line alone, a bucket that caught a jump — the first one usually, where
       the window opens part-way through a change — drew its capsule straight
       through the floor of the chart and off the bottom of the card. */
    const capsules = props.kind === "capsules";
    const extent = capsules ? [...smooth, ...spans.flat()] : [...smooth];
    /* The target joins the scale only when it is near the readings: a room at
       21° with the heating off and a target of 7° would otherwise be a flat
       line along the top. */
    const lowest = Math.min(...extent);
    const highest = Math.max(...extent);
    const target =
      props.target !== undefined && props.target >= lowest - 2 && props.target <= highest + 2
        ? props.target
        : undefined;
    if (target !== undefined) extent.push(target);
    const min = Math.min(...extent);
    const max = Math.max(...extent);
    // A flat reading would divide by zero and, worse, draw a line along the
    // floor as though it had bottomed out; it belongs in the middle.
    const range = max - min || 1;
    const flat = max === min;

    const place = (value: number) => (flat ? 20 : 38 - ((value - min) / range) * 34);

    /* Capsules are strokes with round caps, centred on their x. At 0 and 100
       half of the first and last one fell outside the box, so they are drawn
       in from the edges by their own width. A line runs edge to edge as it
       always has — its fill closes to the corners. */
    const inset = capsules ? 2.5 : 0;
    /* A tile's line stops short of the right-hand edge, so the "now" dot and
       its halo sit on the end of it rather than half off the card. */
    const end = !capsules && !props.rich && !props.interactive ? 96 : 100 - inset;

    const points = smooth.map((value, index) => {
      const [low, high] = spans[index] ?? [value, value];
      const band = props.band;
      return {
        x: inset + (index / (COLUMNS - 1)) * (end - inset),
        y: place(value),
        v: value,
        /* What the reading was there, for the readout: the column's own
           average rather than the smoothed curve, and the moment that column
           stands for on the clock under the chart. */
        raw: filled[index]!,
        t: first + (index / (COLUMNS - 1)) * span,
        // The capsule's own ends, with a floor so a still reading is a mark
        // rather than nothing at all.
        top: Math.min(place(high), place(value) - 1.5),
        bottom: Math.max(place(low), place(value) + 1.5),
        out: !!band && (value < band[0] || value > band[1]),
      };
    });
    return { points, target: target === undefined ? undefined : place(target) };
  });
  const points = () => frame().points;

  /* The window's low and high, from the readings themselves. */
  const range = createMemo(() => {
    const values = points().map((point) => point.raw);
    return values.length ? { low: Math.min(...values), high: Math.max(...values) } : undefined;
  });
  const unit = () => {
    const found = live()?.attributes?.unit_of_measurement;
    return typeof found === "string" ? found : "";
  };
  const reading = (value: number) => `${value.toFixed(1)}${unit().startsWith("°") ? "°" : ` ${unit()}`}`.trim();
  const clock = (seconds: number) =>
    new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  /* The column under the pointer or finger. A mouse shows it while it is
     over the chart; a finger leaves it up for a moment after letting go, so
     there is time to read it. A vertical swipe is the sheet scrolling
     (touch-action: pan-y), which cancels the pointer and takes it away. */
  const [hovered, setHovered] = createSignal<number>();
  let plot: HTMLDivElement | undefined;
  let fade: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(fade));
  const scrub = (event: PointerEvent) => {
    const count = points().length;
    if (!plot || count < 2) return;
    clearTimeout(fade);
    const rect = plot.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    setHovered(Math.round(at * (count - 1)));
  };
  const letGo = (event: PointerEvent, delay: number) => {
    clearTimeout(fade);
    if (event.pointerType === "mouse") {
      /* A click leaves the mouse where it was; it goes when the mouse does. */
      if (event.type !== "pointerup") setHovered(undefined);
    } else fade = setTimeout(() => setHovered(undefined), delay);
  };
  /* A point's own colour on the warm–cool ramp the line is drawn in, so the
     dot and the bubble match the stretch of line they sit on. */
  const tint = (y: number) => {
    const found = points();
    const ys = found.map((point) => point.y);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const warm = bottom === top ? 0.5 : (bottom - y) / (bottom - top);
    return `color-mix(in oklch, var(--rb-hot) ${Math.round(warm * 100)}%, var(--rb-cold))`;
  };
  const active = () => {
    const index = hovered();
    return index === undefined ? undefined : points()[index];
  };

  const path = createMemo(() => monotoneCubicPath(points().map((p) => ({ x: p.x, y: p.y }))));

  /* The clock along the foot reads from the data rather than from the window
     setting: a sensor that only started reporting an hour ago should not be
     labelled as though it had been going all six. */
  const stamps = createMemo(() => {
    if (props.interactive) {
      const found = points();
      if (found.length < 2) return [];
      return [0, 1, 2, 3].map((index) => clock(found[0]!.t + ((found.at(-1)!.t - found[0]!.t) * index) / 3));
    }
    const cutoff = Date.now() / 1000 - props.hours * 3600;
    const within = timeline().filter((point) => point.timestamp >= cutoff);
    if (within.length < 2) return [];

    const first = within[0]!.timestamp * 1000;
    const last = within.at(-1)!.timestamp * 1000;
    const marks = 4;

    return Array.from({ length: marks }, (_, index) => {
      const at = first + ((last - first) * index) / (marks - 1);
      return new Date(at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    });
  });

  /* Gradients are referenced by id, and every chart on the board renders its
     own — a shared id would have them all painting from whichever instance
     mounted last. */
  const fillId = createUniqueId();
  /* A temperature runs its colour up the chart, warm peaks over cool dips;
     anything else fades in along it, from the past into now. */
  const vertical = () => props.interactive === true || props.warmth !== undefined;
  const strokeId = createUniqueId();

  return (
    <div
      ref={box}
      class="rb-spark"
      data-rich={props.rich === true || props.interactive === true}
      data-interactive={props.interactive === true}
      data-tone={props.warmth === undefined ? "health" : "temp"}
      style={{
        "--rb-health": `${props.health ?? 1}`,
        "--rb-warmth": `${props.warmth ?? 0.5}`,
        ...(props.tone ? { "--rb-chart": props.tone } : {}),
      }}
    >
      <Show when={props.interactive}>
        {/* While a moment is picked out the heading reads it: the value,
            when, and how it compares with the reading now. In the heading
            rather than in a bubble at the cursor, where a finger covers it. */}
        <div class="rb-spark-head-row" data-reading={active() !== undefined}>
          <Show
            when={active()}
            fallback={<span class="rb-spark-caption">{props.caption}</span>}
          >
            {(point) => (
              <span class="rb-spark-read" style={{ "--rb-chart": tint(point().y) }}>
                <b>{reading(point().raw)}</b>
                <span>{clock(point().t)}</span>
              </span>
            )}
          </Show>
          <Show when={active()}>
            {(point) => {
              const delta = () => point().raw - (points().at(-1)?.raw ?? point().raw);
              return (
                <span class="rb-spark-delta">
                  {Math.abs(delta()) < 0.05
                    ? "same as now"
                    : `${delta() > 0 ? "+" : "−"}${reading(Math.abs(delta()))} vs now`}
                </span>
              );
            }}
          </Show>
          <Show when={!active() && range()}>
            {(found) => (
              <span class="rb-spark-range">
                <span data-end="low">↓ {reading(found().low)}</span>
                <span data-end="high">↑ {reading(found().high)}</span>
              </span>
            )}
          </Show>
        </div>
      </Show>

      <Show when={points().length > 1} fallback={<div class="rb-spark-empty">No history yet</div>}>
        <div
          class="rb-spark-plot"
          ref={plot}
          data-scrubbing={hovered() !== undefined}
          onPointerDown={(event) => {
            if (!props.interactive) return;
            scrub(event);
          }}
          onPointerMove={(event) => {
            if (!props.interactive) return;
            if (event.pointerType === "mouse" || event.buttons) scrub(event);
          }}
          onPointerUp={(event) => props.interactive && letGo(event, 2500)}
          onPointerCancel={(event) => props.interactive && letGo(event, 0)}
          onPointerLeave={(event) => props.interactive && event.pointerType === "mouse" && letGo(event, 0)}
        >
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop class="rb-stop-top" offset="0%" />
              <stop class="rb-stop-bottom" offset="100%" />
            </linearGradient>

            {/* Along the line rather than down it: the curve starts in the
                cool end of the scale and arrives at whatever the reading is
                now, which is what makes a temperature trace read as a
                journey rather than as a shape. */}
            {/* An interactive chart runs its colour up the chart instead:
                the peaks warm, the dips cool, matching the ↑ and ↓ over it. */}
            <linearGradient
              id={strokeId}
              x1="0"
              y1="0"
              x2={vertical() ? "0" : "1"}
              y2={vertical() ? "1" : "0"}
            >
              <stop class="rb-stop-from" offset="0%" />
              <stop class="rb-stop-to" offset="100%" />
            </linearGradient>
          </defs>

          {/* Uprights behind the line, so the eye has something to read the
              curve against without a box around it. */}
          <Show when={props.rich && !props.interactive}>
            <g class="rb-grid-lines">
              <For each={[0, 25, 50, 75, 100]}>
                {(at) => <line x1={at} y1="0" x2={at} y2="40" />}
              </For>
            </g>
          </Show>

          {/* Bars for a bar chart, and as the track behind a capsule chart.
              Capsules on their own read as loose dashes with nothing to say
              where the floor is; a faint post under each one is what makes
              them a chart. The posts start at the capsule's foot, so a long
              capsule never has a post running on past it. */}
          <Show when={props.kind === "bars" || props.kind === "capsules"}>
            {/* By position: every reading re-derives every point, and a list
                keyed on those new objects redrew the whole chart each time. */}
            <Index each={points()}>
              {(point) => {
                const top = () => (props.kind === "capsules" ? point().bottom : point().y);
                return (
                  <rect
                    class="rb-bar"
                    data-track={props.kind === "capsules"}
                    x={point().x - 0.8}
                    y={top()}
                    width="1.6"
                    height={Math.max(0.8, 40 - top())}
                    rx="0.8"
                  />
                );
              }}
            </Index>
          </Show>

          <Show when={props.kind === "capsules"}>
            {/* Rounded strokes rather than rects: the chart is drawn in a box
                stretched to the card, so a rect's corners stretch with it. A
                line with a round cap keeps its shape at any width. */}
            <g class="rb-capsules">
              <Index each={points()}>
                {(point) => (
                  <line
                    data-out={point().out}
                    x1={point().x}
                    y1={point().top}
                    x2={point().x}
                    y2={point().bottom}
                    stroke-linecap="round"
                  />
                )}
              </Index>
            </g>
          </Show>

          <Show when={(props.kind ?? "line") === "line"}>
            {/* The fill is the same path closed to the floor, so the two can
                never disagree about where the line runs. */}
            <path class="rb-spark-fill" fill={`url(#${fillId})`} d={`${path()} L ${points().at(-1)?.x ?? 100} 40 L 0 40 Z`} />
            <path
              class="rb-line"
              d={path()}
              /* As a style: the stylesheet's own stroke outranks an
                 attribute, and the gradient never showed. */
              style={{ stroke: `url(#${strokeId})` }}
            />
          </Show>
        </svg>

        {/* The marker is an element rather than an SVG circle. The chart is
            drawn in a 100×40 box stretched to whatever the card is, so a
            circle in there comes out as an ellipse — which is exactly what it
            looked like. An HTML dot positioned by percentage stays round. */}
        <Show when={(props.kind ?? "line") === "line"}>
          <span
            class="rb-spark-head"
            aria-hidden="true"
            style={{
              left: `${points().at(-1)!.x}%`,
              top: `${(points().at(-1)!.y / 40) * 100}%`,
              ...(vertical() ? { "--rb-chart": tint(points().at(-1)!.y) } : {}),
            }}
          />
        </Show>

        <Show when={props.interactive && frame().target !== undefined}>
          <div class="rb-spark-target" style={{ top: `${(frame().target! / 40) * 100}%` }}>
            <span>{reading(props.target!)}</span>
          </div>
        </Show>

        <Show when={active()}>
          {(point) => (
            <>
              <span
                class="rb-spark-cursor"
                aria-hidden="true"
                style={{ left: `${point().x}%`, "--rb-chart": tint(point().y) }}
              />
              <span
                class="rb-spark-dot"
                aria-hidden="true"
                style={{ left: `${point().x}%`, top: `${(point().y / 40) * 100}%`, "--rb-chart": tint(point().y) }}
              />
            </>
          )}
        </Show>
        </div>
      </Show>

      <Show when={(props.rich || props.interactive) && stamps().length}>
        <div class="rb-spark-axis" aria-hidden="true">
          <For each={stamps()}>{(stamp) => <span>{stamp}</span>}</For>
        </div>
      </Show>
    </div>
  );
}
