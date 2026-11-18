import type { NetDevice, Network, Port } from "./model";

/**
 * A representative network for the widget gallery only.
 *
 * The preview harness and the Hub's render worker run against a fixed demo
 * home with no UniFi integration in it, so the gallery would show an empty
 * card. This is opted into by `sampleData` in `manifest.examples[].config`,
 * which is deliberately absent from `configSchema`: the settings form can't
 * offer it, so it can never stand in for a real user's missing network.
 *
 * Its rates point at "sample:" ids, which the graphs draw as a made-up day
 * (see useSeries) rather than looking up a history that isn't there.
 */
export const SAMPLE_PREFIX = "sample:";

const ports = (count: number, linked: number[], poe: number[] = []): Port[] =>
  Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      n,
      link: linked.includes(n) || poe.includes(n),
      poe: poe.includes(n),
      poeW: poe.includes(n) ? 4.2 + (n % 3) * 1.6 : undefined,
    };
  });

const device = (id: string, name: string, model: string, kind: NetDevice["kind"], extra: Partial<NetDevice> = {}): NetDevice => ({
  id,
  name,
  model,
  kind,
  online: true,
  update: false,
  ...extra,
});

export function sampleNetwork(): Network {
  const gateway = device("sample-gw", "Cloud Gateway Fiber", "UCG Fiber", "gateway", {
    cpu: 23,
    memory: 58,
    temperature: 52,
    clients: 47,
  });
  return {
    gateway,
    devices: [
      gateway,
      device("sample-sw1", "Office Rack", "USW Pro Max 16 PoE", "switch", { ports: ports(16, [1, 2, 3, 5, 9, 10, 16], [4, 6, 7, 8]) }),
      device("sample-sw2", "Media Cabinet", "USW Flex 2.5G 5", "switch", { ports: ports(5, [1, 2, 3]) }),
      device("sample-ap1", "Living Room", "U7 Pro", "ap", { clients: 18 }),
      device("sample-ap2", "Office", "U7 Lite", "ap", { clients: 11 }),
      device("sample-ap3", "Bedroom", "U7 Lite", "ap", { clients: 6 }),
      device("sample-ap4", "Garden", "U7 Outdoor", "ap", { clients: 3 }),
    ],
    wlans: [
      { id: "sample-w1", name: "Home", enabled: true, clients: 31 },
      { id: "sample-w2", name: "IoT", enabled: true, clients: 14 },
      { id: "sample-w3", name: "Guests", enabled: false, clients: 0 },
    ],
    throughput: {
      down: { value: 312, unit: "Mbit/s", id: `${SAMPLE_PREFIX}down` },
      up: { value: 41.6, unit: "Mbit/s", id: `${SAMPLE_PREFIX}up` },
    },
    clients: 47,
    latency: [
      { id: "sample-cf", name: "Cloudflare", online: true, ms: 9 },
      { id: "sample-gg", name: "Google", online: true, ms: 12 },
      { id: "sample-ms", name: "Microsoft", online: true, ms: 17 },
    ],
  };
}

/** A day of a sample rate: quiet at night, busy in the evening. */
export function sampleSeries(id: string): { x: number; v: number }[] {
  const peak = id.endsWith("up") ? 48 : 340;
  return Array.from({ length: 40 }, (_, i) => {
    const x = i / 39;
    const evening = Math.exp(-((x - 0.78) ** 2) / 0.012);
    const day = Math.exp(-((x - 0.45) ** 2) / 0.04);
    const ripple = 0.06 * Math.sin(i * 1.7) + 0.04 * Math.cos(i * 0.9);
    return { x, v: peak * Math.max(0.05, 0.12 + 0.45 * day + 0.75 * evening + ripple) };
  });
}

