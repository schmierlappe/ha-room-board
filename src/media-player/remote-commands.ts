/**
 * Command names and the custom-map parser, kept apart from the component so
 * they can be exercised without pulling in the SDK's DOM-only exports.
 */

/** The actions a remote pad can send, independent of what a platform calls them. */
export type RemoteAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
  | "home"
  | "menu"
  | "playPause"
  | "volumeUp"
  | "volumeDown"
  | "mute"
  | "power";

export type RemotePreset =
  | "androidtv"
  | "firetv"
  | "appletv"
  | "harmony"
  | "vuplus"
  | "custom";

/**
 * Which service carries the command. The ADB integration has no remote
 * entity at all — it drives a media_player through androidtv.adb_command —
 * so the transport is part of the preset, not an assumption.
 */
export const REMOTE_TRANSPORT: Record<RemotePreset, "remote" | "adb"> = {
  androidtv: "remote",
  firetv: "adb",
  appletv: "remote",
  harmony: "remote",
  vuplus: "remote",
  custom: "remote",
};

/**
 * Every integration names its keys differently, and getting one wrong is a
 * silent no-op rather than an error — so the mapping is a preset the user
 * picks, not a guess made from the entity.
 *
 * Android TV Remote uses the Android keycode names; Apple TV uses pyatv's
 * lowercase verbs; Harmony passes the command straight to the device profile,
 * where the names come from Logitech's own database.
 */
export const REMOTE_PRESETS: Record<
  Exclude<RemotePreset, "custom">,
  Partial<Record<RemoteAction, string>>
> = {
  androidtv: {
    up: "DPAD_UP",
    down: "DPAD_DOWN",
    left: "DPAD_LEFT",
    right: "DPAD_RIGHT",
    select: "DPAD_CENTER",
    back: "BACK",
    home: "HOME",
    menu: "MENU",
    playPause: "MEDIA_PLAY_PAUSE",
    volumeUp: "VOLUME_UP",
    volumeDown: "VOLUME_DOWN",
    mute: "MUTE",
    power: "POWER",
  },
  /**
   * Fire TV and anything else on the ADB integration. Its key names are the
   * bare Android keys — UP, ENTER — not the DPAD_* names the Android TV
   * Remote protocol uses. HOME is spelled the same in both, which is why it
   * was the one button that worked when the wrong set was being sent.
   */
  firetv: {
    up: "UP",
    down: "DOWN",
    left: "LEFT",
    right: "RIGHT",
    select: "ENTER",
    back: "BACK",
    home: "HOME",
    menu: "MENU",
    playPause: "PLAY_PAUSE",
    volumeUp: "VOLUME_UP",
    volumeDown: "VOLUME_DOWN",
    mute: "MUTE",
    power: "POWER",
  },
  appletv: {
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    select: "select",
    back: "menu",
    home: "home",
    menu: "top_menu",
    playPause: "play_pause",
    volumeUp: "volume_up",
    volumeDown: "volume_down",
    power: "turn_off",
  },
  /**
   * VU+ and other Enigma2 receivers through a Harmony hub. They have no home
   * screen and no back key: Menu is the way out to the top, Exit the way back
   * from anywhere. Selecting is OK rather than Harmony's generic Select.
   */
  vuplus: {
    up: "DirectionUp",
    down: "DirectionDown",
    left: "DirectionLeft",
    right: "DirectionRight",
    select: "OK",
    back: "Exit",
    home: "Menu",
    menu: "Menu",
    playPause: "Pause",
    volumeUp: "VolumeUp",
    volumeDown: "VolumeDown",
    mute: "Mute",
    power: "PowerToggle",
  },
  harmony: {
    up: "DirectionUp",
    down: "DirectionDown",
    left: "DirectionLeft",
    right: "DirectionRight",
    /* OK, not Select. Logitech's device profiles carry OK across the board —
       a hub's harmony.conf lists it for every device and Select for none — so
       the generic-sounding name was the one that never existed. */
    select: "OK",
    back: "Back",
    home: "Home",
    menu: "Menu",
    playPause: "Pause",
    volumeUp: "VolumeUp",
    volumeDown: "VolumeDown",
    mute: "Mute",
    power: "PowerToggle",
  },
};

/**
 * The ADB integration and the Android TV Remote protocol name the same keys
 * differently, and a Shield can legitimately be driven either way — Android TV
 * preset, ADB transport. androidtv.adb_command only knows the bare key names,
 * so a DPAD_* sent down that path is a silent no-op: nothing errors, the
 * cursor just never moves. HOME, BACK, MENU and the volume keys are spelled
 * the same in both, which is why they kept working while the pad did not.
 *
 * Only names in this table are rewritten, so a custom entry — a raw
 * `input keyevent 19`, say — passes through untouched.
 */
const ADB_KEY_ALIASES: Record<string, string> = {
  DPAD_UP: "UP",
  DPAD_DOWN: "DOWN",
  DPAD_LEFT: "LEFT",
  DPAD_RIGHT: "RIGHT",
  DPAD_CENTER: "ENTER",
  MEDIA_PLAY_PAUSE: "PLAY_PAUSE",
  MEDIA_NEXT: "NEXT",
  MEDIA_PREVIOUS: "PREVIOUS",
  MEDIA_STOP: "STOP",
};

export const toAdbKey = (command: string): string => ADB_KEY_ALIASES[command] ?? command;

/** "select=DPAD_CENTER" lines from the Custom preset's list. */
export function parseCommandMap(lines: string[]): Partial<Record<RemoteAction, string>> {
  const out: Partial<Record<RemoteAction, string>> = {};
  for (const line of lines) {
    const [action, ...rest] = line.split("=");
    const key = action?.trim() as RemoteAction | undefined;
    const command = rest.join("=").trim();
    if (key && command) out[key] = command;
  }
  return out;
}
