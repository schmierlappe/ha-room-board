import { Index, Show, createMemo } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import { useTrackedHistory } from "../history";
import { STATUS_LABEL, formatMs, sinceLabel, type Monitor, type Status } from "./model";
import { SAMPLE_PREFIX, sampleTimeline } from "./sample";

/**
 * A monitor as Uptime Kuma lists it: its uptime as a pill, its name, and
 * under the name a row of heartbeat bars — the last day in slices, newest on
 * the right, each slice the worst its monitor was in it. Drawn the same in the widget, its
 * popup and the room board's card.
 */

type Beat = "up" | "down" | "pending" | "maintenance" | "empty";

/** The worst first: a slice with any downtime in it is a down slice. */
const WORST: Beat[] = ["down", "pending", "maintenance", "up"];

const beatOf = (state: string): Beat => {
  const s = state.toLowerCase();
  return s === "up" || s === "down" || s === "pending" || s === "maintenance" ? s : "empty";
};

/**
 * The monitor's last day from its status history: one beat per slice, and
 * the share of the checked time it was up. Maintenance is not held against
 * it, and a gap with no reading is neither up nor down.
 */
export function useHeartbeat(entityId: () => string, slices = 40, hours = 24) {
  const sample = () => entityId().startsWith(SAMPLE_PREFIX);
  const history = useTrackedHistory(() => (sample() ? "" : entityId()), hours);

  return createMemo(() => {
    const now = Date.now() / 1000;
    const start = now - hours * 3600;
    const timeline = sample() ? sampleTimeline(entityId(), now) : (history()?.timeline ?? []);
    const points = timeline
      .map((point) => ({ t: point.timestamp, beat: beatOf(String(point.state)) }))
      .sort((a, b) => a.t - b.t);

    /* Each reading holds until the next one, the last until now; a reading
       from before the window holds from its start. */
    const segments: { from: number; to: number; beat: Beat }[] = [];
    points.forEach((point, index) => {
      const to = points[index + 1]?.t ?? now;
      const from = Math.max(point.t, start);
      if (to > from) segments.push({ from, to, beat: point.beat });
    });

    const width = (now - start) / slices;
    const beats: Beat[] = Array.from({ length: slices }, (_, index) => {
      const a = start + index * width;
      const b = a + width;
      const inSlice = new Set(segments.filter((s) => s.from < b && s.to > a).map((s) => s.beat));
      return WORST.find((beat) => inSlice.has(beat)) ?? "empty";
    });

    let up = 0;
    let counted = 0;
    for (const s of segments) {
      if (s.beat === "empty" || s.beat === "maintenance") continue;
      counted += s.to - s.from;
      if (s.beat === "up") up += s.to - s.from;
    }

    return { beats, uptime: counted > 0 ? (up / counted) * 100 : undefined };
  });
}

/** "100%", "99.84%", "87.5%". */
export function formatUptime(pct: number): string {
  if (pct >= 99.995) return "100%";
  /* Two decimals near the top, where they matter; through a number and back
     so "99.50" reads 99.5 and "90.0" reads 90. */
  const digits = pct >= 99 ? 2 : 1;
  return `${Number(pct.toFixed(digits))}%`;
}

export function MonitorRow(props: {
  monitor: Monitor;
  /** The popup's second line: state, how long, response time, certificate. */
  detail?: boolean;
  slices?: number;
}) {
  /* The popup has the widest rows: more, finer slices to fill them. */
  const heartbeat = useHeartbeat(() => props.monitor.id, props.slices ?? (props.detail ? 72 : 48));
  const pill = () => {
    const pct = heartbeat().uptime;
    return pct === undefined ? STATUS_LABEL[props.monitor.status] : formatUptime(pct);
  };
  const certWarn = () => props.monitor.certDays !== undefined && props.monitor.certDays <= 30;

  return (
    <div class="up-line" data-status={props.monitor.status} data-detail={props.detail === true}>
      <span class="up-pill" data-status={props.monitor.status as Status}>
        {pill()}
      </span>
      <span class="up-line-text">
        <span class="up-line-name up-truncate">{props.monitor.name}</span>
        <Show when={props.detail}>
          <span class="up-line-sub up-truncate">
            {STATUS_LABEL[props.monitor.status]}
            <Show when={sinceLabel(props.monitor.since)}> · {sinceLabel(props.monitor.since)}</Show>
            <Show when={props.monitor.responseMs !== undefined}> · {formatMs(props.monitor.responseMs)}</Show>
            <Show when={props.monitor.certDays !== undefined}>
              <span class="up-line-cert" data-warn={certWarn()}>
                <Icon icon="mdi:certificate-outline" width="12" />
                {props.monitor.certDays} d
              </span>
            </Show>
          </span>
        </Show>
        <span class="up-beats" aria-hidden="true">
          <Index each={heartbeat().beats}>{(beat) => <i data-beat={beat()} />}</Index>
        </span>
      </span>
    </div>
  );
}
