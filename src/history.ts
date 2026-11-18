import { createEffect, createMemo, onCleanup } from "solid-js";
import { trackEntityHistory, untrackEntityHistory, useEntityHistory } from "@glasshome/widget-sdk";
import { inLane } from "./lanes";

/**
 * An entity's recent history, loaded while it is drawn.
 *
 * The store keeps history only for entities something has asked it to
 * track; reading it with useEntityHistory alone gets nothing on a real
 * dashboard (the preview's demo data has it regardless, which is how the
 * graphs looked right there and stayed empty on the wall). One hold per
 * entity across every chart, counted, so the first chart to go does not
 * take the history from under another still showing it.
 */
const holders = new Map<string, number>();
/** Waiting for a lane slot to be tracked. */
const queued = new Set<string>();

function hold(entityId: string, hours: number) {
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

function release(entityId: string) {
  const count = (holders.get(entityId) ?? 1) - 1;
  if (count > 0) {
    holders.set(entityId, count);
    return;
  }
  holders.delete(entityId);
  untrackEntityHistory(entityId);
}

export function useTrackedHistory(entityId: () => string | undefined, hours = 24) {
  /* The id as a value, compared as one: callers read it off data that is
     rebuilt on every update (a network, a monitor), and an effect keyed on
     that read let go of the history and asked for it again each time — the
     store dropped it in between, and the graphs flickered empty. */
  const id = createMemo(() => entityId() || undefined);
  createEffect(() => {
    const current = id();
    if (!current) return;
    hold(current, hours);
    onCleanup(() => release(current));
  });
  return useEntityHistory(() => id() ?? "");
}
