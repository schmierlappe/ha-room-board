import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useService } from "@glasshome/widget-sdk";
import { healthOf, rate, size, upFor, type Drive, type Nas, type Volume } from "./synology-model";
import { openable } from "./util";

/**
 * Synology on the board: every NAS as a small front panel — its drive bays
 * with a light each, its volumes as fill bars, and its load on one line —
 * and an overlay with all of it in full, from the volumes and every drive's
 * temperature and health to restarting it.
 */

const level = (value: number | undefined, warn: number, alarm: number) =>
  value === undefined ? "" : value >= alarm ? "alarm" : value >= warn ? "warn" : "";
const driveLevel = (drive: Drive) =>
  drive.status === "crashed" ? "alarm" : drive.status === "warning" || drive.badSectors || drive.lowLife ? "warn" : drive.status === "unknown" ? "off" : "";
const tempLevel = (temp: number | undefined, m2 = false) => level(temp, m2 ? 60 : 45, m2 ? 70 : 55);

/* The overall word for several NAS: the worst of them. */
const worst = (list: Nas[]) => {
  const all = list.map(healthOf);
  return all.find((h) => h.tone === "alarm") ?? all.find((h) => h.tone === "warn") ?? { tone: "ok" as const, text: "Healthy" };
};

function Bays(props: { drives: Drive[] }) {
  const bays = () => props.drives.filter((d) => !d.m2);
  const slots = () => props.drives.filter((d) => d.m2);
  return (
    <span class="syn-bays">
      <For each={bays()}>
        {(drive) => (
          <span class="syn-bay" data-level={driveLevel(drive)} title={`${drive.name}: ${drive.statusText}${drive.temp !== undefined ? ` · ${drive.temp}°C` : ""}`}>
            <i />
          </span>
        )}
      </For>
      <Show when={slots().length}>
        <span class="syn-m2s">
          <For each={slots()}>
            {(drive) => <span class="syn-m2" data-level={driveLevel(drive)} title={`${drive.name}: ${drive.statusText}`}><i /></span>}
          </For>
        </span>
      </Show>
    </span>
  );
}

function VolumeBar(props: { volume: Volume; compact?: boolean }) {
  const used = () => props.volume.used ?? 0;
  return (
    <span class="syn-vol" data-level={props.volume.status === "normal" ? level(props.volume.used, 80, 90) : props.volume.status === "crashed" ? "alarm" : "warn"}>
      <span class="syn-vol-top">
        <b class="rb-truncate">{props.volume.name}</b>
        <span>
          <Show when={props.volume.usedBytes !== undefined && props.volume.totalBytes !== undefined}>
            {size(props.volume.usedBytes)} <i>/ {size(props.volume.totalBytes)}</i>
          </Show>
        </span>
        <em>{Math.round(used())}%</em>
      </span>
      <span class="syn-bar">
        <i style={{ width: `${Math.min(100, used())}%` }} />
      </span>
    </span>
  );
}

/* ---------- the card ---------- */

export function SynologyCard(props: { list: Nas[]; onOpen: () => void }) {
  const overall = createMemo(() => worst(props.list));
  return (
    <article class="rb-card rb-card--synology" {...openable(props.onOpen, "Synology")}>
      <div class="syn" data-count={props.list.length}>
        <header class="syn-head">
          <span class="syn-mark">DS</span>
          <span class="syn-titles">
            <small>Synology</small>
            <b class="rb-truncate">{props.list.length === 1 ? props.list[0]!.name : `${props.list.length} DiskStations`}</b>
          </span>
          <span class="syn-pill" data-tone={overall().tone}>
            <Icon icon={overall().tone === "ok" ? "mdi:check-circle" : "mdi:alert"} width="13" />
            <span>{overall().text}</span>
          </span>
        </header>

        <For each={props.list}>
          {(nas) => {
            const health = () => healthOf(nas);
            return (
              <section class="syn-unit" data-tone={health().tone}>
                <span class="syn-unit-top">
                  <Show when={props.list.length > 1}>
                    <b class="rb-truncate">{nas.name}</b>
                    <Show when={health().tone !== "ok"}>
                      <em data-tone={health().tone}>{health().text}</em>
                    </Show>
                  </Show>
                  <Bays drives={nas.drives} />
                </span>
                {/* Every volume when the card is one NAS's; with several,
                    the fullest of each — the one that will need you first. */}
                <For each={props.list.length > 1 ? [...nas.volumes].sort((a, b) => (b.used ?? 0) - (a.used ?? 0)).slice(0, 1) : nas.volumes.slice(0, 3)}>
                  {(volume) => <VolumeBar volume={volume} />}
                </For>
                <span class="syn-stats">
                  <span data-level={level(nas.cpu, 70, 90)}>
                    <small>CPU</small>
                    {nas.cpu === undefined ? "–" : `${Math.round(nas.cpu)}%`}
                  </span>
                  <span data-level={level(nas.memory, 80, 92)}>
                    <small>RAM</small>
                    {nas.memory === undefined ? "–" : `${Math.round(nas.memory)}%`}
                  </span>
                  <Show when={nas.temp !== undefined}>
                    <span data-level={tempLevel(nas.temp)}>
                      <Icon icon="mdi:thermometer" width="11" />
                      {Math.round(nas.temp!)}°
                    </span>
                  </Show>
                  <span class="syn-net">
                    <Icon icon="mdi:arrow-down" width="11" />
                    {rate(nas.down)}
                  </span>
                </span>
              </section>
            );
          }}
        </For>
      </div>
    </article>
  );
}

/* ---------- the overlay ---------- */

export function SynologyPanel(props: { list: Nas[] }) {
  const [picked, setPicked] = createSignal("");
  const nas = () => props.list.find((n) => n.id === picked()) ?? props.list[0];
  return (
    <div class="syn-panel">
      <Show when={props.list.length > 1}>
        <div class="syn-switch" role="tablist">
          <For each={props.list}>
            {(item) => (
              <button role="tab" aria-selected={item.id === nas()?.id} data-tone={healthOf(item).tone} onClick={() => setPicked(item.id)}>
                <i class="syn-dot" />
                {item.name}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={nas()} fallback={<p class="syn-empty">No Synology found. Add Home Assistant's Synology DSM integration and its NAS show up here by themselves.</p>}>
        {(current) => <NasDetail nas={current()} />}
      </Show>
    </div>
  );
}

function Ring(props: { value?: number; label: string; hue: string; warn: number; alarm: number; note?: string }) {
  const r = 15.9155;
  return (
    <span class="syn-ring" style={{ "--syn-ring": props.hue }} data-level={level(props.value, props.warn, props.alarm)}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle class="syn-ring-track" cx="18" cy="18" r={r} />
        <circle class="syn-ring-arc" cx="18" cy="18" r={r} stroke-dasharray={`${Math.max(0, Math.min(100, props.value ?? 0))} 100`} />
      </svg>
      <b>
        {props.value === undefined ? "–" : Math.round(props.value)}
        <i>%</i>
      </b>
      <small>{props.label}</small>
      <Show when={props.note}>
        <em>{props.note}</em>
      </Show>
    </span>
  );
}

function NasDetail(props: { nas: Nas }) {
  const { callService } = useService();
  const health = () => healthOf(props.nas);
  const [asking, setAsking] = createSignal("");
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(askTimer));
  const confirm = (key: string, run: () => void) => {
    clearTimeout(askTimer);
    if (asking() !== key) {
      setAsking(key);
      askTimer = setTimeout(() => setAsking(""), 3500);
      return;
    }
    setAsking("");
    run();
  };
  const press = (id: string) => void callService("button", "press", {}, { entity_id: id });
  const bays = () => props.nas.drives.filter((d) => !d.m2);
  const slots = () => props.nas.drives.filter((d) => d.m2);

  return (
    <div class="syn-detail">
      <header class="syn-hero" data-tone={health().tone}>
        <div class="syn-hero-id">
          <span class="syn-mark syn-mark--big">DS</span>
          <span class="syn-titles">
            <small>{props.nas.model || "Synology DiskStation"}</small>
            <b class="rb-truncate">{props.nas.name}</b>
            <span class="syn-hero-sub">
              <Show when={props.nas.upSince}>Up {upFor(props.nas.upSince)}</Show>
              <Show when={props.nas.update}> · DSM {props.nas.updateVersion ?? "update"} available</Show>
            </span>
          </span>
          <span class="syn-pill" data-tone={health().tone}>
            <Icon icon={health().tone === "ok" ? "mdi:check-circle" : "mdi:alert"} width="14" />
            <span>{health().text}</span>
          </span>
        </div>
        <div class="syn-hero-stats">
          <Ring value={props.nas.cpu} label="CPU" hue="#3d8bff" warn={70} alarm={90} />
          <Ring value={props.nas.memory} label="RAM" hue="#a78bfa" warn={80} alarm={92} note={props.nas.memoryBytes ? size(props.nas.memoryBytes) : undefined} />
          <span class="syn-tile" data-level={tempLevel(props.nas.temp)}>
            <Icon icon="mdi:thermometer" width="16" />
            <b>{props.nas.temp === undefined ? "–" : `${Math.round(props.nas.temp)}°`}</b>
            <small>System</small>
          </span>
          <span class="syn-tile">
            <Icon icon="mdi:arrow-down-bold" width="16" />
            <b>{rate(props.nas.down)}</b>
            <small>Download</small>
          </span>
          <span class="syn-tile">
            <Icon icon="mdi:arrow-up-bold" width="16" />
            <b>{rate(props.nas.up)}</b>
            <small>Upload</small>
          </span>
          <Show when={props.nas.securityIssue !== undefined}>
            <span class="syn-tile" data-level={props.nas.securityIssue ? "warn" : ""}>
              <Icon icon={props.nas.securityIssue ? "mdi:shield-alert-outline" : "mdi:shield-check-outline"} width="16" />
              <b>{props.nas.securityIssue ? "Check" : "Safe"}</b>
              <small>Security</small>
            </span>
          </Show>
        </div>
      </header>

      <Show when={props.nas.volumes.length}>
        <section class="syn-section">
          <h3 class="syn-section-title">Storage</h3>
          <div class="syn-vols">
            <For each={props.nas.volumes}>
              {(volume) => (
                <div class="syn-volcard" data-level={volume.status === "normal" ? level(volume.used, 80, 90) : "warn"}>
                  <span class="syn-volcard-head">
                    <Icon icon="mdi:database" width="18" />
                    <b>{volume.name}</b>
                    <span class="syn-chip" data-state={volume.status}>{volume.statusText}</span>
                  </span>
                  <span class="syn-volcard-fig">
                    <b>{Math.round(volume.used ?? 0)}%</b>
                    <span>
                      {size(volume.usedBytes)} of {size(volume.totalBytes)} used
                      <Show when={volume.usedBytes !== undefined && volume.totalBytes !== undefined}> · {size(volume.totalBytes! - volume.usedBytes!)} free</Show>
                    </span>
                  </span>
                  <span class="syn-bar syn-bar--big">
                    <i style={{ width: `${Math.min(100, volume.used ?? 0)}%` }} />
                  </span>
                  <Show when={volume.temp !== undefined}>
                    <small class="syn-volcard-temp">
                      <Icon icon="mdi:thermometer" width="12" />
                      Drives average {Math.round(volume.temp!)}°C
                    </small>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.nas.drives.length}>
        <section class="syn-section">
          <h3 class="syn-section-title">Drives</h3>
          <div class="syn-drives">
            <For each={[...bays(), ...slots()]}>
              {(drive) => (
                <div class="syn-drive" data-level={driveLevel(drive)}>
                  <span class="syn-drive-icon">
                    <Icon icon={drive.m2 ? "mdi:expansion-card-variant" : "mdi:harddisk"} width="20" />
                    <i />
                  </span>
                  <span class="syn-drive-text">
                    <b>{drive.name}</b>
                    <small>
                      {drive.statusText}
                      <Show when={drive.smart && drive.smart !== drive.statusText.toLowerCase()}> · SMART {drive.smart}</Show>
                    </small>
                    <Show when={drive.badSectors || drive.lowLife}>
                      <em>{[drive.badSectors && "Bad sectors", drive.lowLife && "Wearing out"].filter(Boolean).join(" · ")}</em>
                    </Show>
                  </span>
                  <Show when={drive.temp !== undefined}>
                    <span class="syn-drive-temp" data-level={tempLevel(drive.temp, drive.m2)}>{Math.round(drive.temp!)}°</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.nas.fan || props.nas.reboot || props.nas.shutdown}>
        <section class="syn-section">
          <h3 class="syn-section-title">Controls</h3>
          <div class="syn-controls">
            <Show when={props.nas.fan && props.nas.fan.options.length}>
              <span class="syn-fan">
                <Icon icon="mdi:fan" width="16" />
                <For each={props.nas.fan!.options}>
                  {(option) => (
                    <button
                      aria-pressed={option === props.nas.fan!.value}
                      onClick={() => void callService("select", "select_option", { option }, { entity_id: props.nas.fan!.id })}
                    >
                      {option.replaceAll("_", " ")}
                    </button>
                  )}
                </For>
              </span>
            </Show>
            <Show when={props.nas.reboot}>
              <button class="syn-action" data-asking={asking() === "reboot"} onClick={() => confirm("reboot", () => press(props.nas.reboot!))}>
                <Icon icon="mdi:restart" width="16" />
                {asking() === "reboot" ? "Restart now?" : "Restart"}
              </button>
            </Show>
            <Show when={props.nas.shutdown}>
              <button class="syn-action" data-danger="true" data-asking={asking() === "shutdown"} onClick={() => confirm("shutdown", () => press(props.nas.shutdown!))}>
                <Icon icon="mdi:power" width="16" />
                {asking() === "shutdown" ? "Shut down now?" : "Shut down"}
              </button>
            </Show>
          </div>
        </section>
      </Show>
    </div>
  );
}
