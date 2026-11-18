import { field } from "@glasshome/widget-sdk";

/**
 * The remote profiles, as a config field.
 *
 * Declared here rather than in either widget because both of them offer the
 * same Remote tab: the media player widget and the room board's media popup
 * render the same `Panels`, so they have to describe the same settings or the
 * tab is configurable in one place and empty in the other.
 */
/* One card, several devices. A living room where navigation is ADB for a
   Shield but Harmony device control for a Sky box, volume is a separate AV
   receiver, and power is a Harmony activity cannot be described by a single
   entity — so each way in is its own profile and the tab offers a picker. */
export const remoteProfilesField = () =>
  field.list(
    field.variants(
      "kind",
      {
        adb: {
          player: field.entity("media_player", {
            title: "Android / Fire TV player",
            description: "The androidtv (ADB) media player. Also supplies the app list.",
          }),
        },
        harmony: {
          hub: field.entity("remote", { title: "Harmony hub" }),
          device: field.text({
            title: "Device",
            description: 'The device inside the hub, exactly as Harmony names it — e.g. "Sky Q".',
            default: "",
          }),
        },
        remote: {
          entity: field.entity("remote", {
            title: "Remote entity",
            description: "Android TV Remote or Apple TV.",
          }),
        },
      },
      {
        title: "Remote profile",
        labels: {
          adb: "Android TV / Fire TV (ADB)",
          harmony: "Harmony device",
          remote: "Remote entity",
        },
        shared: {
          label: field.text({
            title: "Name",
            description: "Shown on the profile picker, e.g. Shield, Sky Q, Fire TV.",
            default: "",
          }),
          /* The matching lives here rather than on the card: one card can
             carry a living room and a bedroom, and a music speaker should
             get no remote at all. Empty means the profile is offered
             everywhere. */
          forPlayers: field.entities("media_player", {
            title: "Show for these players",
            description:
              "The remote appears only while one of these is the selected player. Leave empty " +
              "to offer it for every player; list none of your music speakers and they get no " +
              "Remote tab.",
          }),
          volumePlayers: field.entities("media_player", {
            title: "Volume controls",
            description:
              "What the volume slider drives for this profile — a receiver, an Echo Sub, or " +
              "several at once when the room is grouped. Empty falls back to the device itself.",
          }),
          activityHub: field.entity("remote", {
            title: "Harmony activities",
            description:
              "Optional, per profile. Its activities become the power menu for this room.",
          }),
          preset: field.choice(
            ["androidtv", "firetv", "appletv", "harmony", "vuplus", "custom"],
            {
              title: "Command names",
              description:
                "Which key names to send. Android TV Remote uses DPAD_UP; ADB uses UP; Harmony " +
                "uses its own per-device names; VU+ / Enigma2 uses OK, Menu and Exit. Anything " +
                "left over is fixed with the custom list below.",
              default: "firetv",
            },
          ),
          commands: field.stringList({
            title: "Custom commands",
            description:
              "Overrides for this profile, one per line as action=command. Actions: up, down, " +
              "left, right, select, back, home, menu, playPause, volumeUp, volumeDown, mute, " +
              "power. Harmony device names vary, so this is where a stubborn key gets fixed.",
          }),
        },
      },
    ),
    {
      title: "Remote profiles",
      description: "Each is one way into a device. The Remote tab offers a picker when there are several.",
      max: 6,
      addLabel: "Add profile",
      labelField: "kind",
    },
  );

export const remoteHoldRepeatsField = () =>
  field.toggle({
    title: "Hold to repeat OK",
    description: "Holding the pad repeats OK, the way a physical remote does.",
    default: true,
  });
