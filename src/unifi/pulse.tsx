import { Show, createMemo, createUniqueId } from "solid-js";
import { useTrackedHistory } from "../history";
import { SAMPLE_PREFIX, sampleSeries } from "./sample";

/**
 * The network's pulse: the last day of download and upload as two soft
 * waves, filling the card behind everything on it. Both against the same
 * scale, so the upload sits low under the download as it does in fact.
 */

type Point = { x: number; v: number };

/** A day of a rate, averaged into 64 slices. */
export function useSeries(entityId: () => string | undefined) {
  const isSample = (id: string | undefined) => !!id?.startsWith(SAMPLE_PREFIX);
  const history = useTrackedHistory(() => (isSample(entityId()) ? undefined : entityId()));
  /* The last series drawn, kept while the history is momentarily empty —
     reloading, say — so a graph holds its line rather than blinking out.
     Only a different entity starts it afresh. */
  let last: { id?: string; points: Point[] } = { points: [] };
  return createMemo((): Point[] => {
    const id = entityId();
    const fresh = compute(id);
    if (fresh.length || last.id !== id) last = { id, points: fresh };
    return last.points;
  });

  function compute(id: string | undefined): Point[] {
    if (!id) return [];
    if (isSample(id)) return sampleSeries(id);
    const now = Date.now() / 1000;
    const start = now - 24 * 3600;
    const raw = (history()?.timeline ?? [])
      .filter((p) => p.timestamp >= start)
      .map((p) => ({ t: p.timestamp, v: Number(p.state) }))
      .filter((p) => Number.isFinite(p.v));
    if (raw.length < 2) return [];
    /* Drawn across from its first reading: a sensor only lately added has
       a short history, and against the whole day it was a stub at the end. */
    const from = Math.min(Math.max(start, raw[0]!.t), now - 600);
    const n = 40;
    const buckets: number[][] = Array.from({ length: n }, () => []);
    for (const p of raw) buckets[Math.max(0, Math.min(n - 1, Math.floor(((p.t - from) / (now - from)) * n)))]!.push(p.v);
    const points = buckets
      .map((b, i) => (b.length ? { x: i / (n - 1), v: b.reduce((a, c) => a + c, 0) / b.length } : undefined))
      .filter((p): p is Point => !!p);
    /* Eased by its neighbours: a rate jumps from one reading to the next,
       and drawn as it is the wave was a row of spikes — this is its shape. */
    return points.map((p, i) => {
      const near = points.slice(Math.max(0, i - 2), i + 3);
      return { x: p.x, v: near.reduce((a, c) => a + c.v, 0) / near.length };
    });
  }
}

/** A smooth curve through the points (Catmull-Rom as cubic Béziers). */
export function curve(points: [number, number][]): string {
  if (!points.length) return "";
  let d = `M${points[0]![0].toFixed(2)} ${points[0]![1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]!.toFixed(2)} ${c1[1]!.toFixed(2)} ${c2[0]!.toFixed(2)} ${c2[1]!.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

export function Pulse(props: { downId?: string; upId?: string }) {
  const down = useSeries(() => props.downId);
  const up = useSeries(() => props.upId);
  const ids = { down: createUniqueId(), up: createUniqueId() };

  const paths = createMemo(() => {
    const max = Math.max(1e-6, ...down().map((p) => p.v), ...up().map((p) => p.v));
    /* The wave's top at 6 of the 60 units, its foot at the card's edge. */
    const shape = (series: Point[]) => {
      if (series.length < 2) return undefined;
      const pts = series.map((p) => [p.x * 100, 60 - (p.v / max) * 52] as [number, number]);
      const line = curve(pts);
      return { line, area: `${line} L100 60 L0 60 Z` };
    };
    return { down: shape(down()), up: shape(up()) };
  });

  return (
    <svg class="uf-pulse" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={ids.down} x1="0" y1="0" x2="0" y2="1">
          <stop class="uf-pulse-down-0" offset="0" />
          <stop class="uf-pulse-down-1" offset="1" />
        </linearGradient>
        <linearGradient id={ids.up} x1="0" y1="0" x2="0" y2="1">
          <stop class="uf-pulse-up-0" offset="0" />
          <stop class="uf-pulse-up-1" offset="1" />
        </linearGradient>
      </defs>
      <Show when={paths().down}>
        {(p) => (
          <>
            <path d={p().area} fill={`url(#${ids.down})`} />
            <path class="uf-pulse-line uf-pulse-line--down" d={p().line} vector-effect="non-scaling-stroke" />
          </>
        )}
      </Show>
      <Show when={paths().up}>
        {(p) => (
          <>
            <path d={p().area} fill={`url(#${ids.up})`} />
            <path class="uf-pulse-line uf-pulse-line--up" d={p().line} vector-effect="non-scaling-stroke" />
          </>
        )}
      </Show>
    </svg>
  );
}
