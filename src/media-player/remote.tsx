import { For, Show, createSignal, onCleanup } from "solid-js";
import { Icon, useEntities, useEntity, useService, type EntityView } from "@glasshome/widget-sdk";
import { useDomains } from "../domains";
import {
  REMOTE_PRESETS,
  parseCommandMap,
  toAdbKey,
  type RemoteAction,
  type RemotePreset,
} from "./remote-commands";
import { activityLook, appLook, channelLook } from "./app-icons";
import { haptic } from "./util";
import { picon } from "./picons";
import { Choice, SubSheet } from "./subsheet";
import { errorMessage } from "../errors";

export { REMOTE_PRESETS, parseCommandMap } from "./remote-commands";
export type { RemoteAction, RemotePreset } from "./remote-commands";

const SWIPE_THRESHOLD = 28;
/** Below this a press is a tap, not a hold. */
const HOLD_MS = 450;

export type RemoteProfile = {
  kind: "adb" | "harmony" | "remote";
  label: string;
  preset: RemotePreset;
  commands: string[];
  /** Players this profile is offered for; empty means all of them. */
  forPlayers?: string[];
  /** What the volume slider drives here — a receiver, a sub, or a group. */
  volumePlayers?: string[];
  activityHub?: string[];
  player?: string[];
  hub?: string[];
  device?: string;
  entity?: string[];
};

export function RemotePanel(props: {
  profiles: RemoteProfile[];
  holdRepeats: boolean;
  /** The player selected in the popup — the source of the app list for
      profiles that do not drive a media_player themselves. */
  player?: () => EntityView | undefined;
  /** The room board's layout: what is on as chips, sheets for the lists, the
   *  pad beside a column of keys. The media player keeps the classic one. */
  board?: boolean;
}) {
  const { callService } = useService();
  const [flash, setFlash] = createSignal<RemoteAction | undefined>();
  const [error, setError] = createSignal<string | undefined>();
  /* The classic layout's two drop-down menus. */
  const [appsOpen, setAppsOpen] = createSignal(false);
  const [powerOpen, setPowerOpen] = createSignal(false);

  /* Which choice sheet is open over the popup, if any (the board layout). */
  const [sheet, setSheet] = createSignal<"" | "activities" | "sources">("");
  const [filter, setFilter] = createSignal("");
  const openSheet = (which: "activities" | "sources") => {
    setFilter("");
    setSheet(which);
  };
  const [volumeOpen, setVolumeOpen] = createSignal(false);
  const [keyboardOpen, setKeyboardOpen] = createSignal(false);
  const [typed, setTyped] = createSignal("");

  const [profileIndex, setProfileIndex] = createSignal(0);
  const profile = () => props.profiles[Math.min(profileIndex(), props.profiles.length - 1)];

  /* Where the keys go, per profile. ADB drives a media_player through
     androidtv.adb_command; Harmony and the remote entities both use
     remote.send_command, Harmony additionally naming a device inside the hub. */
  const usesAdb = () => profile()?.kind === "adb";
  const target = () => {
    const p = profile();
    if (!p) return "";
    if (p.kind === "adb") return p.player?.[0] ?? "";
    if (p.kind === "harmony") return p.hub?.[0] ?? "";
    return p.entity?.[0] ?? "";
  };

  /**
   * The entity whose source_list becomes the app list, and which select_source
   * is sent to. An ADB profile drives a media_player directly. Everything else
   * — a Harmony hub, a plain remote entity — is not a media_player and has no
   * sources of its own, so it falls back to the player selected in the popup:
   * a VU+ or Sky box exposes its channels there, and that is the list worth
   * showing. An explicit profile player still wins if one is configured.
   */
  const sourcePlayerId = () => {
    const configured = profile()?.player?.[0];
    if (configured) return configured;
    if (usesAdb()) return target();
    return props.player?.()?.id ?? "";
  };

  /** Apps and the state line come from that player; volume may not. */
  const device = useEntity(sourcePlayerId);

  /* Volume belongs to the profile: a bedroom Fire TV runs through an Echo Sub
     while a living room runs through a receiver, and several can be driven at
     once when the room is grouped. */
  const domains = useDomains();
  const players = useEntities(() => domains().media_player ?? []);
  /* A Music Assistant player for an Echo has no volume of its own — no
     volume_level, and a volume_set that never reaches the speaker — while
     Alexa Media Player's entity for the same Echo does. Where a listed
     player is one of those, the volume goes to its namesake that reports a
     level, so the profile can name either one and the slider still works. */
  const withVolume = (id: string) => {
    const all = players();
    const listed = all.find((player) => player.id === id);
    if (!listed || listed.attributes?.volume_level != null) return id;
    if (!("mass_player_type" in (listed.attributes ?? {}))) return id;
    const name = (listed.friendlyName ?? "").trim().toLowerCase();
    if (!name) return id;
    const twin = all.find(
      (player) =>
        player.id !== id &&
        player.attributes?.volume_level != null &&
        !("mass_player_type" in (player.attributes ?? {})) &&
        (player.friendlyName ?? "").trim().toLowerCase() === name,
    );
    return twin?.id ?? id;
  };
  const volumeTargets = () => {
    const listed = profile()?.volumePlayers ?? [];
    if (listed.length) return [...new Set(listed.map(withVolume))];
    return usesAdb() && target() ? [target()] : [];
  };

  const volumeDevice = useEntity(() => volumeTargets()[0] ?? "");
  const activityHubId = () => profile()?.activityHub?.[0] ?? "";
  const activityHub = useEntity(activityHubId);

  const activities = () => {
    const list = activityHub()?.attributes?.activity_list;
    return Array.isArray(list) ? (list as string[]) : [];
  };

  const startActivity = (activity: string) => {
    setSheet("");
    setAppsOpen(false);
    setPowerOpen(false);
    void callService("remote", "turn_on", { activity }, { entity_id: activityHubId() }).catch(
      (err: unknown) => setError(errorMessage(err, "Could not start it")),
    );
  };

  const allOff = () => {
    setSheet("");
    setAppsOpen(false);
    setPowerOpen(false);
    void callService("remote", "turn_off", {}, { entity_id: activityHubId() }).catch(
      (err: unknown) => setError(errorMessage(err, "Could not turn off")),
    );
  };

  const apps = () => {
    const list = device()?.attributes?.source_list;
    return Array.isArray(list) ? (list as string[]) : [];
  };

  /* What is on now: the hub's activity ("PowerOff" when nothing is), and the
     player's source — the app in front on a Shield, the channel on a VU+. */
  const currentActivity = () => {
    const value = activityHub()?.attributes?.current_activity;
    return typeof value === "string" && value && value !== "PowerOff" ? value : "";
  };
  const currentSource = () => {
    const value = device()?.attributes?.source;
    return typeof value === "string" ? value : "";
  };

  const filteredApps = () => {
    const term = filter().trim().toLowerCase();
    return term ? apps().filter((name) => name.toLowerCase().includes(term)) : apps();
  };

  /* Volume: the device's own keys, or a player whose level can be set. */
  const hasVolume = () => (has("volumeUp") && has("volumeDown")) || volumeTargets().length > 0;

  /* The board's volume panel closes itself once it has been left alone. */
  let volumeTimer: ReturnType<typeof setTimeout> | undefined;
  const nudgeVolume = () => {
    setVolumeOpen(true);
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => setVolumeOpen(false), 5000);
  };
  onCleanup(() => clearTimeout(volumeTimer));

  /* A key is drawn only where the profile can send it. */
  const has = (action: RemoteAction) => !!commands()[action];

  /* An ADB profile lists installed apps; everything else lists whatever the
     player calls a source, which on a VU+ or a Sky box is the channel
     bouquet. Same menu, different vocabulary — and a different icon table,
     since "Sky" as an app and "Sky Sport" as a channel are not the same row. */
  const sourceLook = (name: string) => (usesAdb() ? appLook(name) : channelLook(name));
  /* A receiver's channel with a picon shows the logo itself. */
  const sourceLogo = (name: string) => (usesAdb() ? undefined : picon(name));
  const SourceIcon = (p: { name: string; size: string }) => (
    <Show when={sourceLogo(p.name)} fallback={<Icon icon={sourceLook(p.name).icon} width={p.size} />}>
      {(logo) => <img class="mp-picon mp-picon--icon" src={logo()} alt="" draggable={false} />}
    </Show>
  );
  const sourceLabel = () => (usesAdb() ? "Apps" : "Channels");
  const sourceIcon = () => (usesAdb() ? "mdi:apps" : "mdi:television-guide");

  const volume = () =>
    Math.round(Number(volumeDevice()?.attributes?.volume_level ?? 0) * 100);

  const launch = (source: string) => {
    setSheet("");
    setAppsOpen(false);
    setPowerOpen(false);
    // The player that owns the sources, not the key target: a Harmony hub
    // cannot accept select_source.
    void callService("media_player", "select_source", { source }, {
      entity_id: sourcePlayerId(),
    }).catch((err: unknown) =>
      setError(errorMessage(err, "Could not open the app")),
    );
  };

  // Every listed target at once, so a grouped room moves together.
  const setVolume = (pct: number) => {
    const targets = volumeTargets();
    if (!targets.length) return;
    void callService("media_player", "volume_set", { volume_level: pct / 100 }, {
      entity_id: targets,
    }).catch((err: unknown) => setError(errorMessage(err, "Could not set the volume")));
  };

  /**
   * ADB's `input text` takes spaces as %s — a literal space ends the argument
   * and the rest is silently dropped.
   */
  const sendText = () => {
    const text = typed().trim();
    if (!text || !usesAdb()) return;
    setTyped("");
    setKeyboardOpen(false);
    void callService(
      "androidtv",
      "adb_command",
      { command: `input text "${text.replaceAll(/\s/g, "%s").replaceAll('"', "")}"` },
      { entity_id: target() },
    ).catch((err: unknown) =>
      setError(errorMessage(err, "Could not send text")),
    );
  };

  /* Custom lines are overrides layered on the preset, not a replacement — a
     Harmony device usually needs one or two names changed, not thirteen. */
  const commands = () => {
    const p = profile();
    if (!p) return {};
    const base = p.preset === "custom" ? {} : REMOTE_PRESETS[p.preset];
    return { ...base, ...parseCommandMap(p.commands ?? []) };
  };

  const send = (action: RemoteAction) => {
    // A Shield set up as ADB but on the Android TV preset sends DPAD_* names
    // that adb_command does not know; toAdbKey rewrites just those.
    const raw = commands()[action];
    const command = raw && usesAdb() ? toAdbKey(raw) : raw;
    const entityId = target();
    if (!command || !entityId) return;

    setFlash(action);
    // Longer for OK than for a direction: a select is a commitment, and the
    // difference is felt without looking at the screen.
    haptic(action === "select" ? 18 : 10);
    setTimeout(() => setFlash(undefined), 160);

    const dev = profile()?.device?.trim();
    const data: Record<string, unknown> = { command };
    // Harmony addresses a device inside the hub; the others ignore it, so it
    // is only sent when set.
    if (dev) data.device = dev;
    const call = usesAdb()
      ? callService("androidtv", "adb_command", { command }, { entity_id: entityId })
      : callService("remote", "send_command", data, { entity_id: entityId });

    void call.catch((err: unknown) =>
      setError(errorMessage(err, "Command failed")),
    );
  };

  /* The pad. A drag past the threshold is a direction; anything shorter is a
     tap on OK. Direction is decided by the dominant axis, so a sloppy diagonal
     still does what was meant rather than nothing. */
  let startX = 0;
  let startY = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setInterval> | undefined;
  let handled = false;

  const stopRepeat = () => {
    clearTimeout(holdTimer);
    clearInterval(repeatTimer);
    holdTimer = undefined;
    repeatTimer = undefined;
  };

  onCleanup(stopRepeat);

  const onPointerDown = (e: PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    handled = false;

    // Holding still on the pad repeats OK, the way a physical remote does.
    if (props.holdRepeats) {
      holdTimer = setTimeout(() => {
        handled = true;
        send("select");
        repeatTimer = setInterval(() => send("select"), 260);
      }, HOLD_MS);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (handled || (e.buttons === 0 && e.pointerType === "mouse")) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    stopRepeat();
    handled = true;
    if (Math.abs(dx) > Math.abs(dy)) send(dx > 0 ? "right" : "left");
    else send(dy > 0 ? "down" : "up");
  };

  const onPointerUp = (e: PointerEvent) => {
    e.stopPropagation();
    const wasRepeating = !!repeatTimer;
    stopRepeat();
    if (!handled && !wasRepeating) send("select");
    handled = false;
  };

  const onPointerCancel = () => {
    stopRepeat();
    handled = false;
  };

  /** A key on the side column. */
  const Key = (keyProps: {
    action: RemoteAction;
    icon: string;
    label: string;
    lg?: boolean;
    /** The first to go when the column is short. */
    minor?: boolean;
  }) => (
    <button
      class="mp-rem-key"
      data-lg={!!keyProps.lg}
      data-minor={!!keyProps.minor}
      data-flash={flash() === keyProps.action}
      aria-label={keyProps.label}
      onClick={() => send(keyProps.action)}
    >
      <Icon icon={keyProps.icon} width={keyProps.lg ? "28" : "22"} />
    </button>
  );

  /* The media player's own popup: the classic remote, header menus over a
     square pad with three round keys under it. */
  const classicView = () => (
    <div class="mp-panel mp-remote">
      <Show
        when={target()}
        fallback={
          <div class="mp-empty">
            Add a remote profile in settings — one per way into a device: ADB for a Shield or
            Fire TV, Harmony device control for a Sky or VU+ box, or a remote entity for Android
            TV Remote and Apple TV.
          </div>
        }
      >
        {/* Header, or the volume slider in its place. Reusing the row rather
            than adding one keeps the pad the same size either way. */}
        <div class="mp-rem-head">
          <Show
            when={!volumeOpen()}
            fallback={
              <>
                <input
                  class="mp-range mp-rem-vol"
                  style={{ "--fill": `${volume()}%` }}
                  type="range"
                  min={0}
                  max={100}
                  value={volume()}
                  aria-label="Volume"
                  onInput={(e) => setVolume(Number(e.currentTarget.value))}
                />
                <span class="mp-rem-pct">{volume()} %</span>
                <button
                  class="mp-rem-icon"
                  aria-label="Close volume"
                  onClick={() => setVolumeOpen(false)}
                >
                  <Icon icon="mdi:close" width="20" />
                </button>
              </>
            }
          >
            <span class="mp-rem-title">
              <span class="mp-rem-name">
                {profile()?.label || device()?.friendlyName || "Remote"}
              </span>
              <Show when={device()?.state}>
                <span class="mp-rem-state">{device()!.state.replaceAll("_", " ")}</span>
              </Show>
            </span>

            {/* Activities live on the hub, not on any one device: starting one
                switches inputs and powers the chain, which no per-device key
                can do. */}
            <Show when={activities().length}>
              <button
                class="mp-rem-apps"
                data-open={powerOpen()}
                aria-label="Activities"
                onClick={() => {
                  setAppsOpen(false);
                  setPowerOpen((v) => !v);
                }}
              >
                <Icon icon="mdi:power" width="19" />
                <Icon icon={powerOpen() ? "mdi:chevron-up" : "mdi:chevron-down"} width="17" />
              </button>
            </Show>

            {/* Not ADB-only: a Harmony or plain remote profile has no sources
                of its own, but the player it is paired with does. An ADB
                profile keeps the button even while the list is empty —
                source_list only fills once the box is awake. */}
            <Show when={usesAdb() || apps().length}>
              <button
                class="mp-rem-apps"
                data-open={appsOpen()}
                aria-label={sourceLabel()}
                onClick={() => setAppsOpen((v) => !v)}
              >
                <Icon icon={sourceIcon()} width="19" />
                <Icon icon={appsOpen() ? "mdi:chevron-up" : "mdi:chevron-down"} width="17" />
              </button>
            </Show>

            <Show when={volumeTargets().length}>
              <button
                class="mp-rem-icon"
                aria-label="Volume"
                onClick={() => {
                  setAppsOpen(false);
                  setVolumeOpen(true);
                }}
              >
                <Icon icon="mdi:volume-high" width="20" />
              </button>
            </Show>
          </Show>
        </div>

        {/* Floated over the pad rather than inserted above it: a menu in the
            flow pushed the touchpad down the panel and, on a phone, off the
            bottom of it. */}
        <Show when={powerOpen() && activities().length}>
          <div class="mp-rem-menu" data-side="right">
            <For each={activities()}>
              {(activity) => (
                <button class="mp-rem-menu-item" onClick={() => startActivity(activity)}>
                  <span
                    class="mp-rem-menu-icon"
                    style={{ "--mp-look": activityLook(activity).color }}
                  >
                    <Icon icon={activityLook(activity).icon} width="16" />
                  </span>
                  <span class="mp-truncate">{activity}</span>
                </button>
              )}
            </For>
            <button class="mp-rem-menu-item" data-danger="true" onClick={allOff}>
              <span class="mp-rem-menu-icon" style={{ "--mp-look": "#ef4444" }}>
                <Icon icon="mdi:power" width="16" />
              </span>
              <span>Turn everything off</span>
            </button>
          </div>
        </Show>

        {/* Several ways into one room: ADB for a Shield, Harmony device
            control for a Sky box. */}
        <Show when={props.profiles.length > 1}>
          <div class="mp-rem-profiles">
            <For each={props.profiles}>
              {(p, i) => (
                <button
                  class="mp-chip"
                  data-active={profileIndex() === i()}
                  onClick={() => {
                    setProfileIndex(i());
                    setAppsOpen(false);
                    setPowerOpen(false);
                  }}
                >
                  {p.label || p.kind}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* The list comes from the player's own source_list, so it is whatever
            is installed or tuned rather than a list to maintain by hand. */}
        <Show when={appsOpen()}>
          <div class="mp-rem-menu" data-side="right">
            <Show when={!apps().length}>
              <p class="mp-rem-menu-empty">
                No sources reported yet. Wake the device, or list its apps in the
                Android TV integration.
              </p>
            </Show>
            <For each={apps()}>
              {(source) => (
                <button class="mp-rem-menu-item" onClick={() => launch(source)}>
                  <span
                    class="mp-rem-menu-icon"
                    data-picon={!!sourceLogo(source)}
                    style={{ "--mp-look": sourceLook(source).color }}
                  >
                    <SourceIcon name={source} size="16" />
                  </span>
                  <span class="mp-truncate">{source}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div
          class="mp-pad"
          data-flash={flash()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />

        <div class="mp-rem-foot">
          <button
            class="mp-rem-round"
            data-flash={flash() === "back"}
            aria-label="Back"
            onClick={() => send("back")}
          >
            <Icon icon="mdi:chevron-left" width="24" />
          </button>

          <button
            class="mp-rem-round mp-rem-round--lg"
            data-flash={flash() === "home"}
            aria-label="Home"
            onClick={() => send("home")}
          >
            <Icon icon="mdi:home" width="30" />
          </button>

          <Show
            when={usesAdb()}
            fallback={
              <button
                class="mp-rem-round"
                data-flash={flash() === "playPause"}
                aria-label="Play or pause"
                onClick={() => send("playPause")}
              >
                <Icon icon="mdi:play-pause" width="22" />
              </button>
            }
          >
            <button
              class="mp-rem-round"
              data-open={keyboardOpen()}
              aria-label="Keyboard"
              onClick={() => setKeyboardOpen((v) => !v)}
            >
              <Icon icon="mdi:keyboard" width="22" />
            </button>
          </Show>
        </div>

        {/* Typing on the device itself is the slowest thing a remote does, so
            text is sent in one go rather than key by key. */}
        <Show when={keyboardOpen()}>
          <div class="mp-rem-type">
            <input
              class="mp-input"
              type="text"
              placeholder="Type on the TV…"
              value={typed()}
              onInput={(e) => setTyped(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
            />
            <button class="mp-go" disabled={!typed().trim()} onClick={sendText}>
              Send
            </button>
          </div>
        </Show>

        <Show when={error()}>
          <div class="mp-empty" data-error="true">{error()}</div>
        </Show>
      </Show>
    </div>
  );

  /* The room board's: see the prop. */
  const boardView = () => (
    <div class="mp-panel mp-remote" data-board="true">
      <Show
        when={target()}
        fallback={
          <div class="mp-empty">
            Add a remote profile in settings — one per way into a device: ADB for a Shield or
            Fire TV, Harmony device control for a Sky or VU+ box, or a remote entity for Android
            TV Remote and Apple TV.
          </div>
        }
      >
        {/* Several ways into one room: ADB for a Shield, Harmony device
            control for a Sky box. The picker is what makes one card serve
            all of them. */}
        <Show when={props.profiles.length > 1}>
          <div class="mp-rem-profiles">
            <For each={props.profiles}>
              {(p, i) => (
                <button
                  class="mp-chip"
                  data-active={profileIndex() === i()}
                  onClick={() => {
                    setProfileIndex(i());
                    setSheet("");
                  }}
                >
                  {p.label || p.kind}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* What is on, as two chips: the hub's activity and the player's
            source. Each is also the way to change it — a tap opens the list
            as a sheet over the popup. */}
        <div class="mp-rem-status">
          <div class="mp-rem-chips">
          <Show when={activities().length}>
            <button
              class="mp-rem-chip"
              data-on={!!currentActivity()}
              style={{
                "--mp-look": currentActivity() ? activityLook(currentActivity()).color : "#94a3b8",
              }}
              onClick={() => openSheet("activities")}
            >
              <span class="mp-rem-chip-icon">
                <Icon
                  icon={currentActivity() ? activityLook(currentActivity()).icon : "mdi:power"}
                  width="18"
                />
              </span>
              <span class="mp-rem-chip-text">
                <span class="mp-rem-chip-label">Activity</span>
                <span class="mp-rem-chip-value mp-truncate">{currentActivity() || "Off"}</span>
              </span>
              <Icon class="mp-rem-chip-caret" icon="mdi:chevron-right" width="18" />
            </button>
          </Show>

          <Show when={usesAdb() || apps().length}>
            <button
              class="mp-rem-chip"
              data-on={!!currentSource()}
              style={{
                "--mp-look": currentSource() ? sourceLook(currentSource()).color : "#94a3b8",
              }}
              onClick={() => openSheet("sources")}
            >
              <span class="mp-rem-chip-icon" data-picon={!!(currentSource() && sourceLogo(currentSource()))}>
                <Show when={currentSource()} fallback={<Icon icon={sourceIcon()} width="18" />}>
                  <SourceIcon name={currentSource()} size="18" />
                </Show>
              </span>
              <span class="mp-rem-chip-text">
                <span class="mp-rem-chip-label">{usesAdb() ? "App" : "Source"}</span>
                <span class="mp-rem-chip-value mp-truncate">{currentSource() || "Choose"}</span>
              </span>
              <Icon class="mp-rem-chip-caret" icon="mdi:chevron-right" width="18" />
            </button>
          </Show>
          </div>

          {/* The volume, as a small chip of its own: the level at a glance,
              and a tap brings the slider up over the foot of the pad. Any
              more permanent place for it came out of the pad's height. */}
          <Show when={hasVolume()}>
            <button
              class="mp-rem-vchip"
              data-open={volumeOpen()}
              aria-label="Volume"
              onClick={() => (volumeOpen() ? setVolumeOpen(false) : nudgeVolume())}
            >
              <Icon icon={volume() === 0 ? "mdi:volume-off" : "mdi:volume-high"} width="18" />
              <Show when={volumeTargets().length}>
                <span>{volume()}</span>
              </Show>
            </button>
          </Show>

          {/* The volume, as a card the width of the remote under the row: the
              card is the slider — drag anywhere on it and the fill follows —
              in the overlay's own colour. Where no player reports a level it
              is two halves instead, − and +. Gone a few seconds after the
              last touch. */}
          <Show when={volumeOpen() && hasVolume()}>
            <Show
              when={volumeTargets().length}
              fallback={
                <div class="mp-rem-vcard" data-keys="true" onPointerDown={nudgeVolume}>
                  <button
                    aria-label="Volume down"
                    data-flash={flash() === "volumeDown"}
                    onClick={() => send("volumeDown")}
                  >
                    <Icon icon="mdi:volume-minus" width="22" />
                  </button>
                  <Show when={has("mute")}>
                    <button
                      class="mp-rem-vcard-mute"
                      aria-label="Mute"
                      data-flash={flash() === "mute"}
                      onClick={() => send("mute")}
                    >
                      <Icon icon="mdi:volume-off" width="20" />
                    </button>
                  </Show>
                  <button
                    aria-label="Volume up"
                    data-flash={flash() === "volumeUp"}
                    onClick={() => send("volumeUp")}
                  >
                    <Icon icon="mdi:volume-plus" width="22" />
                  </button>
                </div>
              }
            >
              <VolumeCard
                value={volume()}
                onChange={(value) => {
                  nudgeVolume();
                  setVolume(value);
                }}
              />
            </Show>
          </Show>
        </div>

        {/* The pad on the left, the keys down the right: a thumb swipes on
            the one and presses the other without changing grip. */}
        <div class="mp-rem-body">
          <div
            class="mp-pad"
            data-flash={flash()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {/* Quiet marks: which way a swipe goes, and the middle as OK. */}
            <i class="mp-pad-hint" data-dir="up" />
            <i class="mp-pad-hint" data-dir="down" />
            <i class="mp-pad-hint" data-dir="left" />
            <i class="mp-pad-hint" data-dir="right" />
            <span class="mp-pad-ok">OK</span>
          </div>

          <div class="mp-rem-side">
            <Show when={has("power")}>
              <Key action="power" icon="mdi:power" label="Power" minor />
            </Show>
            <Key action="back" icon="mdi:arrow-u-left-top" label="Back" />
            <Key action="home" icon="mdi:home-variant" label="Home" lg />
            <Show when={has("menu")}>
              <Key action="menu" icon="mdi:menu" label="Menu" minor />
            </Show>
            <Show when={has("playPause")}>
              <Key action="playPause" icon="mdi:play-pause" label="Play or pause" />
            </Show>

            <Show when={usesAdb()}>
              <button
                class="mp-rem-key"
                data-open={keyboardOpen()}
                aria-label="Keyboard"
                onClick={() => setKeyboardOpen((v) => !v)}
              >
                <Icon icon="mdi:keyboard-outline" width="22" />
              </button>
            </Show>
          </div>

        </div>

        {/* Typing on the device itself is the slowest thing a remote does, so
            text is sent in one go rather than key by key. */}
        <Show when={keyboardOpen()}>
          <div class="mp-rem-type">
            <input
              class="mp-input"
              type="text"
              placeholder="Type on the TV…"
              value={typed()}
              onInput={(e) => setTyped(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
            />
            <button class="mp-go" disabled={!typed().trim()} onClick={sendText}>
              Send
            </button>
          </div>
        </Show>

        <Show when={error()}>
          <div class="mp-empty" data-error="true">{error()}</div>
        </Show>

        {/* The hub's activities, as a sheet over the popup. */}
        <Show when={sheet() === "activities"}>
          <SubSheet title="Activities" onBack={() => setSheet("")}>
            <For each={activities()}>
              {(activity) => (
                <Choice
                  icon={<Icon icon={activityLook(activity).icon} width="20" />}
                  look={activityLook(activity).color}
                  name={activity}
                  active={currentActivity() === activity}
                  sub={currentActivity() === activity ? "Running" : undefined}
                  onClick={() => startActivity(activity)}
                />
              )}
            </For>
            <Choice
              icon={<Icon icon="mdi:power" width="20" />}
              look="#ef4444"
              name="Turn everything off"
              danger
              active={!currentActivity()}
              onClick={allOff}
            />
          </SubSheet>
        </Show>

        {/* The player's sources — apps or channels — as a sheet, with a filter
            once the list is long enough to need one. */}
        <Show when={sheet() === "sources"}>
          <SubSheet
            title={sourceLabel()}
            onBack={() => setSheet("")}
            head={
              apps().length > 12 ? (
                <div class="mp-input-wrap">
                  <Icon icon="mdi:magnify" width="17" />
                  <input
                    class="mp-input"
                    type="search"
                    placeholder={`Find ${sourceLabel().toLowerCase()}`}
                    value={filter()}
                    onInput={(event) => setFilter(event.currentTarget.value)}
                  />
                </div>
              ) : undefined
            }
          >
            <Show when={!apps().length}>
              <p class="mp-rem-menu-empty">
                No sources reported yet. Wake the device, or list its apps in the Android TV
                integration.
              </p>
            </Show>
            <For each={filteredApps()}>
              {(source) => (
                <Choice
                  icon={<SourceIcon name={source} size="20" />}
                  look={sourceLogo(source) ? "#0f1218" : sourceLook(source).color}
                  name={source}
                  active={currentSource() === source}
                  sub={currentSource() === source ? "On now" : undefined}
                  onClick={() => launch(source)}
                />
              )}
            </For>
          </SubSheet>
        </Show>
      </Show>
    </div>
  );

  return <Show when={props.board} fallback={classicView()}>{boardView()}</Show>;
}

/**
 * The volume as a card you drag across: the fill is the level, and a press
 * anywhere on the card moves it there. The level follows the finger at once
 * and is sent as it moves, a few times a second rather than on every pixel.
 */
function VolumeCard(props: { value: number; onChange: (value: number) => void }) {
  const [held, setHeld] = createSignal<number | undefined>();
  const shown = () => held() ?? props.value;
  let last = 0;
  let sent: number | undefined;

  const at = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const share = (event.clientX - box.left) / (box.width || 1);
    return Math.round(Math.max(0, Math.min(1, share)) * 100);
  };

  const move = (event: PointerEvent, final = false) => {
    const value = at(event);
    setHeld(value);
    const now = Date.now();
    /* Once per value: a tap is a press and a release at the same spot, and
       sent both times the speaker was told the same level twice. */
    if ((final || now - last > 180) && value !== sent) {
      last = now;
      sent = value;
      props.onChange(value);
    }
  };

  return (
    <div
      class="mp-rem-vcard"
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown()}
      data-held={held() !== undefined}
      style={{ "--fill": `${shown()}%` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        sent = undefined;
        move(event, true);
      }}
      onPointerMove={(event) => {
        if (held() !== undefined) move(event);
      }}
      onPointerUp={(event) => {
        move(event, true);
        setHeld(undefined);
      }}
      onPointerCancel={() => setHeld(undefined)}
    >
      <i class="mp-rem-vcard-fill" />
      <span class="mp-rem-vcard-label">
        <Icon icon={shown() === 0 ? "mdi:volume-off" : "mdi:volume-high"} width="20" />Volume
      </span>
      <b class="mp-rem-vcard-value">{shown()}</b>
    </div>
  );
}
