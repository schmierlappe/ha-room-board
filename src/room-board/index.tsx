import { setVars } from "../theme";
import { useArtworkService } from "../artwork";
import { clearData, clearStyle, setData, setStyle } from "./dom";
import { DomainsContext, createDomains, useDomains } from "../domains";
import {
  ErrorBoundary,
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
  type JSX,
} from "solid-js";
import {
  Icon,
  Widget,
  WidgetDialog,
  defineConfig,
  defineWidget,
  field,
  imageUrl,
  useArea,
  useEntities,
  useWidgetContext,
  useWidgetDialog,
  useWidgetGestures,
  type EntityView,
  type Infer,
  state,
} from "@glasshome/widget-sdk";
import { Panels as MediaPanels } from "../media-player/panels";
import {
  remoteHoldRepeatsField,
  remoteProfilesField,
} from "../media-player/remote-config";
import { ActivityBar, ActivityCard, ActivityPanel } from "./activity";
import { ApplianceCard, AppliancePanel, appliancesOf } from "./appliance";
import { CalendarCard, CalendarPanel } from "./calendar";
import { CameraCard, CameraPanel } from "./camera";
/* Shutters, blinds, curtains, awnings and the garage — one domain, drawn by
   what each one actually is. */
import { CoverCard, CoverPanel, coversOf } from "./covers";
import {
  ClimateCard,
  ClimatePanel,
  currentOf,
  isRunning as climateRunning,
  targetOf,
} from "./climate";
import { LightCard, LightPanel } from "./lights";
import { LockCard, LockPanel } from "./locks";
import { PlexCard, PlexPanel, looksLikePlex, mediaOf } from "./plex";
import { OpeningsCard, OpeningsPanel, openingsOf } from "./openings";
import { MediaCard, MiniPlayer, artworkOf, isPlaying, pickPlayer } from "./media";
import { usePlexPlayers, withPlexTwin } from "../media-player/plex-twin";
import { PeoplePanel, PersonRow, usePeople, useZones } from "./people";
/* The vacuum widget's own guesser rather than a second table that would drift
   from it: both are answering "what does a room called this look like". */
import { roomIcon } from "../vacuum/util";
import { SetupPanel } from "./setup";
import { SwitchCard, SwitchPanel } from "./switches";
import { WasteCard, WastePanel, looksLikeWaste } from "./waste";
import { MatchBar, MatchPanel, SportCard, barMatch, isFootball, looksLikeTeamTracker } from "./sport";
import { state as haStore } from "../ha/store";
import { sameIds } from "../domains";
import { WeatherCard, WeatherPanel, WeatherSky } from "./weather";
import { UptimeBar, UptimeCard, UptimeBoardPanel } from "./uptime";
import { UnifiBoardPanel, UnifiCard, usePingList } from "./unifi";
import { ProxmoxBoardPanel, ProxmoxCard } from "./proxmox";
import { useCluster } from "../proxmox/model";
import { useNetwork, usePings } from "../unifi/model";
import { groupMonitors, isMonitor, tagGroups, useMonitors } from "../uptime/model";
import { VacuumCard, VacuumPanel } from "./vacuum";
import { HeroMetric, Metric } from "./metrics";
import {
  applyLayout,
  refitCinema,
  attachControls,
  cardKey,
  detachControls,
  sizeOf,
  layoutRoom,
  orderedCards,
  readLayout,
  writeLayout,
  type RoomLayout,
  type Size,
} from "./arrange";
import { RoomMenuRow, StatusChips, roomStatus } from "./roomstatus";
/* The weather scenes are the weather widget's own drawings, and they come
   with the widget's own stylesheet — both are prefixed, so the two live in
   this shadow root side by side. */
/* The board's stylesheet, and those of the cards it borrows from other
   widgets. Imported as CSS so the build puts them in the widget's stylesheet;
   they were <style> elements, which the sealed engine refuses. The order is
   the order they cascade in. */
import "./styles.css";
import "../weather/styles.css";
import "../media-player/styles.css";
import "../soccer/styles.css";
import "../uptime/styles.css";
import "../unifi/styles.css";
import "../unifi/gauge.css";
import "../unifi/styles-2.css";
import "../proxmox/styles.css";
import { widgetDialogProps } from "./ui";
import { attr, classOf, metricsOf, numeric, safeIcon, themeVars } from "./util";
import { Keyed } from "./keyed";
import { errorMessage } from "../errors";
import { CLOCK_STYLES, SceneClock } from "./clock";
import { UpdatesBar, UpdatesButton, UpdatesPanel, pending as updatePending } from "./updates";
import { WifiQr, useTablet } from "./wifi";

/**
 * The players a stand-in player names: a universal media player the one in
 * charge (active_child), a media player group or a Music Assistant group
 * its members (entity_id, group_members). Empty for an ordinary player.
 */
function standsFor(player: EntityView): string[] {
  const active = attr<string>(player, "active_child", "");
  const members = [player.attributes?.["entity_id"], player.attributes?.["group_members"]]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((id): id is string => typeof id === "string" && id.startsWith("media_player."));
  return active ? [active, ...members] : members;
}

/* Home Assistant's address and an artwork proxy were settings here once. In
   the sealed engine of Dash 1.5 every picture comes through the dashboard's
   media proxy or the GlassHome Artwork integration, so they are gone; the
   media player, camera and soccer components the board shares still take
   them for their own widgets, and get nothing from the board. */
const NO_ADDRESS = "";

const configSchema = defineConfig({
  title: field.title(),
  subtitle: field.text({
    title: "Subtitle",
    default: "My Home",
    description: "Under the room name on the photo panel, when the clock is off.",
  }),
  clock: field.choice(["24h", "12h", "off"], {
    title: "Clock on the photo",
    default: "24h",
    labels: { "24h": "24-hour", "12h": "12-hour", off: "Off" },
    description:
      "The time, large in the corner of the room's photo, with the room's name and the day " +
      "under it. Off shows the name and the subtitle there instead.",
  }),
  clockStyle: field.choice(CLOCK_STYLES, {
    title: "Clock style",
    default: "bold",
    labels: {
      bold: "Bold hours, thin minutes",
      thin: "Thin",
      hairline: "Hairline",
      mono: "Mono",
      frosted: "Frosted glass",
      gradient: "Soft gradient",
    },
    description: "How the digits look on the photo.",
  }),

  rooms: field.list(
    field.variants(
      "kind",
      {
        room: {
          area: field.area({ title: "Area" }),
          image: field.image({ title: "Photo" }),
        },
      },
      {
        title: "Room",
        labels: { room: "Room" },
        shared: {
          label: field.text({
            title: "Name",
            description: "Shown on the chip and over the photo. Defaults to the area's own name.",
            default: "",
          }),
          icon: field.text({
            title: "Icon",
            description:
              "Optional, e.g. mdi:sofa. Guessed from the room's name when left empty — the " +
              "chips along the photo are icons, and only the room you are in is named.",
            default: "",
          }),
        },
      },
    ),
    {
      title: "Rooms",
      description:
        "One per area. The chips along the bottom of the photo switch between them, and the " +
        "board rebuilds from whatever that area holds.",
      /* Was 8. A house has more rooms than that; the menu on the photo
         scrolls once it runs out of height (fitRoomMenu), so the list can be
         as long as the house. */
      max: 24,
      addLabel: "Add room",
      labelField: "label",
    },
  ),

  /* The media popup is the media player widget's own, so it needs the same
     settings that widget has. They are repeated here rather than read from
     that card: two widgets on a dashboard are independent, and a board should
     not stop working because a media player card was moved or removed. */
  matchBar: field.toggle({
    title: "Match bar on game day",
    default: true,
    description:
      "On a phone, a TeamTracker team's match (live score, kick-off or result) docked at the foot on the day it plays.",
  }),
  updates: field.toggle({
    title: "Update notifications",
    default: true,
    description: "A pill on the room's photo when Home Assistant has updates, with a list to install them.",
  }),
  musicAssistant: field.toggle({
    title: "Music Assistant features",
    default: true,
    description: "Browse, Search and Discover in the media popup.",
  }),
  configEntryId: field.text({
    title: "Music Assistant config entry ID",
    description:
      "Optional. Settings → Devices & services → Music Assistant; the id is the last part " +
      "of the URL.",
  }),
  /* The vacuum overlay's own sources. A map entity is published as an image by
     newer integrations and as a camera by older ones, so both are offered and
     whichever is set wins. */
  /* The Remote tab in the media popup. The board renders the media player's
     own panels, so it has to carry the same settings — without them the tab
     is configurable in the widget and permanently empty here. */
  remoteProfiles: remoteProfilesField(),
  remoteHoldRepeats: remoteHoldRepeatsField(),

  vacuumMapImage: field.entity("image", {
    title: "Vacuum map (image entity)",
    description: "Optional: the vacuum's map is found by name, the current floor's first.",
  }),
  wifiQr: field.entity("image", {
    title: "Guest Wi-Fi QR code",
    description:
      "An image entity with the network's QR code, shown on tablets above the room picker. Left empty, UniFi's guest QR code is found by itself.",
  }),
  wifiQrShow: field.toggle({
    title: "Show the Wi-Fi QR code on tablets",
    default: true,
  }),
  vacuumMapCamera: field.entity("camera", { title: "Vacuum map (camera entity)", description: "Optional, for integrations that publish the map as a camera." }),
  vacuumRooms: field.stringList({
    title: "Vacuum rooms",
    description:
      "One per room, as Label=area_id — the id the integration uses for that room. Add a " +
      "third field to choose the icon, as Label=area_id=mdi:icon-name; without it the icon " +
      "is guessed from the label.",
  }),
  vacuumSensors: field.entities("sensor", {
    title: "Vacuum consumables",
    description: "Filter and brush life, cleaning area, total time — listed in the overlay.",
  }),

  /* Written by the menu on the photo rather than typed here: an area can hold
     eighty entities and the board has room for a dozen, so the choice belongs
     in front of the room, not in a form about the widget. */
  hidden: field.stringList({
    title: "Hidden entities",
    description:
      "Entity ids this board leaves out. Managed by the menu at the top of the room photo.",
  }),

  /* The bins go out for the whole house rather than for a room, so this one
     is named here. The weather entity is not: put it in an area and the board
     for that area shows it, the same as every other thing in the room. */
  people: field.entities("person", {
    title: "People",
    description:
      "Who appears at the end of the overview line. Leave empty for everyone Home Assistant " +
      "tracks.",
  }),

  historyHours: field.number({
    title: "Chart window (hours)",
    default: 6,
    description: "How far back the sparklines reach.",
  }),

  /* Written by Arrange on the board, not typed here (see arrange.ts). */
  layout: field.stringList({
    title: "Card arrangement",
    description:
      "The order and the big cards of each room, as arranged on the board. Managed by Arrange.",
  }),

  maxCards: field.number({
    title: "Readings on the board",
    default: 5,
    description:
      "Besides the large one, until the menu on the photo is used — after that the board " +
      "shows exactly what is switched on there.",
  }),
});

type Config = Infer<typeof configSchema>;

type RoomConfig = {
  kind: "room";
  label?: string;
  icon?: string;
  area?: string;
  image?: string;
};

/**
 * Which room each board was last looking at.
 *
 * The host rebuilds a widget when its config changes, and a rebuilt board
 * starts on its first room — so saving the menu's choice sent you back to the
 * lounge. The selection is remembered out here, keyed by the board's own list
 * of rooms, and a rebuilt board picks up where the old one left off. Two
 * boards over the same rooms share the entry, which is the one case where
 * they would agree anyway.
 */
const lastRoom = new Map<string, number>();

/**
 * A card that cannot take the board down with it.
 *
 * Solid stops updating a tree once a render throws, which is why one bad card
 * never looked like a broken card — it looked like a frozen widget that
 * ignored every click afterwards. Each card gets a boundary of its own, so a
 * failure costs that card, says what went wrong, and offers to try again.
 */
function Guard(props: { name: string; children: JSX.Element }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <article class="rb-card rb-card--error">
          <h3 class="rb-card-name rb-truncate">{props.name}</h3>
          <span class="rb-card-verdict">This card stopped</span>
          <p class="rb-error-why">
            {errorMessage(error)}
          </p>
          <button
            class="rb-error-retry"
            onClick={(event) => {
              event.stopPropagation();
              reset();
            }}
          >
            <Icon icon="mdi:refresh" width="14" />
            <span>Try again</span>
          </button>
        </article>
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}

/* The names of the cards that have no entity of their own to be named after. */
const CARD_ICONS: Record<string, string> = {
  media: "mdi:play-circle-outline",
  light: "mdi:lightbulb-group-outline",
  weather: "mdi:weather-partly-cloudy",
  cover: "mdi:blinds",
  lock: "mdi:lock-outline",
  openings: "mdi:door-open",
  switch: "mdi:toggle-switch-outline",
  climate: "mdi:thermostat",
  vacuum: "mdi:robot-vacuum",
  camera: "mdi:cctv",
};

const METRIC_ICONS: Record<string, string> = {
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  pressure: "mdi:gauge",
  atmospheric_pressure: "mdi:gauge",
  carbon_dioxide: "mdi:molecule-co2",
  illuminance: "mdi:brightness-5",
  pm25: "mdi:blur",
  volatile_organic_compounds: "mdi:air-filter",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
  battery: "mdi:battery",
};

const CARD_LABELS: Record<string, string> = {
  media: "Media",
  light: "Lights",
  weather: "Weather",
  cover: "Shutters & blinds",
  lock: "Locks",
  openings: "Doors & windows",
  switch: "Switches",
  climate: "Climate",
  vacuum: "Vacuum",
  camera: "Cameras",
};

/* The same entities in the same order: a card's list is unchanged, so the
   card is not drawn again. Hiding one card's entities rebuilds the room's
   list, and without this every card was redrawn with it — on a large house
   more than the sealed engine allows for one step, and the widget stopped. */
const NONE: EntityView[] = [];
const SAME_ITEMS = {
  equals: (a: readonly unknown[], b: readonly unknown[]) =>
    a === b || (a.length === b.length && a.every((item, i) => item === b[i])),
};

/* One grouping of the house by domain, shared with the board and every card
   (domains.tsx). Made here, above the board, so the hooks the board calls in
   its own body find it too. */
function RoomBoardWidget(props: { config: Config }) {
  /* Covers from outside Home Assistant (src/artwork.ts). */
  useArtworkService();
  /* The board is drawn a moment after the widget starts.
   *
   * The sealed engine gives a widget a burst of work for starting up and
   * refills it at a steady rate. Loading this widget and copying in the
   * house's entities take most of that burst on a house of a few thousand
   * entities, and drawing the board as well went over it ("It took too long
   * to start"). Drawn a moment later, the board's work comes out of the
   * refilled budget instead. Not decided by counting the house: counting
   * its entities alone cost a tenth of the burst. The demo house, which the
   * hub's thumbnails and `bun widget preview` render against, is small and
   * is drawn at once. */
  /* On a Home Assistant card there is no start-up budget to wait out: the
     board is drawn at once. */
  const [awake] = createSignal(true);
  return (
    <Show when={awake()} fallback={<Widget tone="neutral"><Widget.Content class="rb-root">{null}</Widget.Content></Widget>}>
      <SharedDomains>
        <RoomBoard config={props.config} />
      </SharedDomains>
    </Show>
  );
}

function SharedDomains(props: { children: JSX.Element }) {
  const domains = createDomains();
  return <DomainsContext.Provider value={domains}>{props.children}</DomainsContext.Provider>;
}

/**
 * A vacuum's map when none is picked in settings, found by name: Roborock
 * publishes one image per floor as image.<vacuum>_<floor>, and the Roborock
 * Custom Map integration a version with the rooms drawn in as <…>_custom,
 * which is preferred. The floor is the one select.<vacuum>_selected_map is
 * on; without it, the first one.
 */
function mapOfVacuum(vacuumId: string | undefined, images: readonly string[], selects: readonly EntityView[]): string | undefined {
  if (!vacuumId) return undefined;
  const base = vacuumId.slice(vacuumId.indexOf(".") + 1);
  const mine = images.filter((id) => id.startsWith(`image.${base}_`)).sort((a, b) => a.localeCompare(b));
  if (!mine.length) return undefined;
  const floor = selects.find((select) => select.id === `select.${base}_selected_map`)?.state?.toLowerCase().replaceAll(/\W+/g, "_");
  const onFloor = floor ? mine.filter((id) => id === `image.${base}_${floor}` || id === `image.${base}_${floor}_custom`) : [];
  const pool = onFloor.length ? onFloor : mine;
  return pool.find((id) => id.endsWith("_custom")) ?? pool[0];
}

/* Home Assistant keeps an uploaded area picture as a link to its 512×512
   copy, too small for the photo side of a board; its image server also has
   the upload as it was, under "original". */
function fullSize(picture: string | null | undefined): string | undefined {
  if (!picture) return undefined;
  return picture.replace(/^(\/api\/image\/serve\/[^/]+)\/\d+x\d+$/, "$1/original");
}

function RoomBoard(props: { config: Config }) {
  const domains = useDomains();
  const ctx = useWidgetContext();
  const dialog = useWidgetDialog("controls");

  const rooms = () => (props.config.rooms ?? []) as RoomConfig[];

  const roomsKey = () =>
    rooms()
      .map((room) => room.area ?? room.label ?? "")
      .join("|");

  const [index, setIndex] = createSignal(lastRoom.get(roomsKey()) ?? 0);
  const [roomsOpen, setRoomsOpen] = createSignal(false);
  createEffect(() => lastRoom.set(roomsKey(), index()));

  /* Clamped rather than stored: a room removed in settings would otherwise
     leave the board pointing past the end of the list. */
  const current = () => rooms()[Math.min(index(), Math.max(0, rooms().length - 1))];

  const area = useArea(() => current()?.area ?? "");

  /* Everything the area holds, and everything it holds that this board is
     meant to show — the menu on the photo is the only difference between
     them. */
  /* Cached, and shared by every card. Read from the area, the entity list is
     built afresh — every entity's view rebuilt — on each read, and dozens of
     things on the board read it: a room switch rebuilt the whole room's
     entities dozens of times over, which was most of the second it took. */
  const allEntities = createMemo(() => area()?.entities ?? []);

  /* The choice is held here while the menu is open and written to the config
     when it closes.
     *
     * Writing on every switch closed the menu under the finger: the host
     * rebuilds the widget when its config changes, and the rebuilt one has no
     * overlay open. Holding it locally keeps the board reacting immediately —
     * a switch still empties its card straight away — and costs one write for
     * a whole session of tidying rather than one per tap. */
  const [draft, setDraft] = createSignal<string[] | undefined>();
  const hidden = () => draft() ?? props.config.hidden ?? [];
  /* Kept the same list while the same entities are in it: a card taken off
     by name while arranging changes the hidden list but hides no entity, and
     a new list then made every card on the board work out its content again. */
  const entities = createMemo(
    () => {
      const hide = new Set(hidden());
      return allEntities().filter((entity) => !hide.has(entity.id));
    },
    NONE,
    SAME_ITEMS,
  );

  /* The room's entities by domain, in one pass. Each card used to filter the
     whole room for its own domain, a few dozen passes over every entity in it;
     in a room of a couple of thousand entities that alone was more than the
     sealed engine allows a widget for starting up. */
  const inRoom = createMemo(() => {
    const groups: Record<string, EntityView[]> = {};
    for (const entity of entities()) {
      const list = groups[entity.domain] ?? [];
      list.push(entity);
      groups[entity.domain] = list;
    }
    return groups;
  });
  const ofDomain = (domain: string): EntityView[] => inRoom()[domain] ?? NONE;

  /* Updates are the house's, like the lists: Home Assistant, its add-ons,
     HACS and device firmware sit in no room. Only the waiting ones are
     watched closely; the rest are filtered out here. */
  const updateAll = useEntities(() => (props.config.updates === false ? [] : (domains().update ?? [])));
  const updates = createMemo(() => updateAll().filter(updatePending), NONE, SAME_ITEMS);

  /* Shopping and to-do lists are the household's, not a room's — Bring's
     list sits in no area — so they are offered in every room's list of what
     it shows, under a group of their own, and shown on the agenda while
     they are switched on. */
  const todoAll = useEntities(() => domains().todo ?? []);
  const todoIds = createMemo(
    () => {
      const hide = new Set(hidden());
      return todoAll()
        .map((entity) => entity.id)
        .filter((id) => !hide.has(id));
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );
  const setupEntities = createMemo(() => {
    const own = new Set(allEntities().map((entity) => entity.id));
    return [...allEntities(), ...todoAll().filter((entity) => !own.has(entity.id))];
  });

  const setHidden = (next: string[]) => setDraft(next);

  /* Merged rather than replaced: updateConfig is handed the whole config, so
     a host that replaces wholesale cannot drop the other settings. */
  const flushHidden = () => {
    const pending = draft();
    setDraft(undefined);
    if (!pending) return;

    const saved = props.config.hidden ?? [];
    const same =
      pending.length === saved.length && pending.every((id) => saved.includes(id));
    if (!same) ctx.updateConfig({ ...props.config, hidden: pending });
  };

  /* The room's own players. A board is a room, so the card lists what is in
     it rather than every player in the house. */
  const players = createMemo(() => ofDomain("media_player"), NONE, SAME_ITEMS);
  const [chosenPlayer, setChosenPlayer] = createSignal("");

  /* The player the media overlay opened on, held for as long as it is open.
     Unchosen, the card follows whichever player is playing — and with two
     speakers, or a Sonos group, that answer changes from one update to the
     next. Followed inside the overlay, each change was a different player:
     the panel redrew and the favourites went back to their folder. */
  const [heldPlayer, setHeldPlayer] = createSignal("");
  const plexPlayers = usePlexPlayers();
  /* A Shield running Plex says what is playing through Plex's own player for
     it — the title, the episode, the cover (media-player/plex-twin.ts). */
  /* A player that stands for others — a universal media player, a media
     player group, a Music Assistant group — names them: universal ones the
     one in charge (active_child), groups their members. Read here so the
     overlay can open on the one actually playing rather than the stand-in. */
  const childIds = createMemo(
    () => {
      const own = new Set(players().map((player) => player.id));
      const ids = new Set(players().flatMap(standsFor));
      return [...ids].filter((id) => !own.has(id)).sort((a, b) => a.localeCompare(b));
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );
  const children = useEntities(childIds);
  /* The room's players and those they stand for, so the overlay can hold one
     that is not in the room's own list. */
  const panelPlayers = createMemo(() => [...players(), ...children()]);
  /* Which player a stand-in is playing through: its active child, else the
     member playing, else the member paused with something on. */
  type Child = ReturnType<typeof children>[number];
  const playingThrough = (stand: EntityView | undefined): Child | undefined => {
    if (!stand) return undefined;
    const all = children();
    const active = attr<string>(stand, "active_child", "");
    if (active) return all.find((e) => e.id === active);
    const members = standsFor(stand)
      .map((id) => all.find((e) => e.id === id))
      .filter((e): e is Child => !!e);
    return members.find(isPlaying) ?? members.find((e) => e.state === "paused" && !!attr<string>(e, "media_title", ""));
  };

  /* For the card and the mini player: each stand-in replaced by the player
     it is playing through, so they show — and control — what is actually
     on: its title, its cover. A stand-in with nothing behind it stays. */
  const cardPlayers = createMemo(() => {
    const out: EntityView[] = [];
    for (const player of players()) {
      const through = playingThrough(player) as EntityView | undefined;
      const shown = through ?? player;
      if (!out.some((p) => p.id === shown.id)) out.push(shown);
    }
    return out;
  });

  const activePlayer = createMemo(() =>
    withPlexTwin(pickPlayer(panelPlayers(), chosenPlayer() || heldPlayer()), plexPlayers()),
  );
  const activeArtwork = () =>
    artworkOf(
      activePlayer(),
      NO_ADDRESS,
      NO_ADDRESS,
      plexPlayers(),
    );

  /**
   * The room's lights, with any group standing aside for what it contains.
   *
   * A light group put in an area is a single entity as far as the board is
   * concerned, so a house behind one "All lights" group read as one light —
   * "1 light on" for a whole home, one row in the overlay, and no way to see
   * which bulbs were actually lit. A group publishes its members in its own
   * `entity_id` attribute, so the board subscribes to those and lists them
   * instead: the group's own switch is still on the card as "Every light".
   *
   * One level deep. A group of groups would need the members' members, which
   * means a second subscription keyed off the first — worth doing the day
   * somebody has one, and not before.
   */
  const rawLights = createMemo(() => ofDomain("light"), NONE, SAME_ITEMS);

  const isLightGroup = (entity: EntityView) => {
    const members = attr<unknown>(entity, "entity_id", undefined);
    return Array.isArray(members) && members.length > 0;
  };

  const memberIds = createMemo(() => {
    const ids = new Set<string>();
    for (const light of rawLights()) {
      const members = attr<unknown>(light, "entity_id", undefined);
      if (!Array.isArray(members)) continue;
      for (const id of members) {
        if (typeof id === "string" && id.startsWith("light.")) ids.add(id);
      }
    }
    return [...ids];
    /* The same members are the same list. Every brightness change on any
       light in the room re-ran this; a new array each time had useEntities
       drop and re-register every member, the list came back empty for a
       moment, and the light overlay flickered between the group and its
       bulbs on every update. */
  }, [], { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });

  const members = useEntities(memberIds);

  const lights = createMemo(() => {
    const resolved = members();
    if (!resolved.length) return rawLights();

    /* Neither the group itself nor a member that also sits in the area on its
       own account — otherwise a bulb listed twice is counted twice. */
    const seen = new Set(resolved.map((entity) => entity.id));
    const kept = rawLights().filter(
      (entity) => !isLightGroup(entity) && !seen.has(entity.id),
    );
    return [...kept, ...resolved];
  });
  const vacuums = createMemo(() => ofDomain("vacuum"), NONE, SAME_ITEMS);
  /* The vacuum's map: the one picked in settings, else found by name. */
  const selectedMaps = useEntities(() => (domains().select ?? []).filter((id) => id.endsWith("_selected_map")));
  const vacuumMap = createMemo(
    () =>
      props.config.vacuumMapImage?.[0] ??
      props.config.vacuumMapCamera?.[0] ??
      mapOfVacuum(vacuums()[0]?.id, domains().image ?? [], selectedMaps()) ??
      "",
  );
  const climates = createMemo(() => ofDomain("climate"), NONE, SAME_ITEMS);
  const cameras = createMemo(() => ofDomain("camera"), NONE, SAME_ITEMS);

  const weathers = createMemo(() => ofDomain("weather"), NONE, SAME_ITEMS);

  /* Doors and windows, by device class — the room already knows which of its
     sensors are on its edges. */
  const openings = createMemo(() => openingsOf(ofDomain("binary_sensor")));
  const locks = createMemo(() => ofDomain("lock"), NONE, SAME_ITEMS);
  const covers = createMemo(() => coversOf(ofDomain("cover")), NONE, SAME_ITEMS);

  /* Solar, grid, battery and every measuring plug the room holds, read as one
     set of flows. Off the unfiltered list: a plug hidden from the board is
     still part of what the house is drawing. */
  /* A "recently added" sensor, found by the shape of what it publishes rather
     than by its name — the Upcoming Media Card schema is unmistakable, and
     Plex, Sonarr and Radarr all speak it. */
  /* One slot, two answers.
   *
   * While something is playing, the player is what the room wants to show; the
   * moment it stops, that card is a paused thumbnail nobody needs and the
   * shelf of what has just landed is the more useful thing in the same space.
   * Both span two columns, so they trade places rather than reflow the board. */
  const playing = () => players().some(isPlaying);

  const plex = () => ofDomain("sensor").find(looksLikePlex);
  const plexItems = createMemo(() =>
    mediaOf(plex(), {
      proxy: NO_ADDRESS,
      haBase: NO_ADDRESS,
    }),
  );

  /* People are not furniture: they belong to the house rather than to a room,
     so the row is the same whichever board is showing. */
  const people = usePeople(() => props.config.people ?? []);


  /* The zones, for how far away each person is. */
  const zones = useZones();

  /* Any sensor in the room whose reading the waste parsers can make sense of.
     Assign the schedule sensor to an area and it appears, the same as every
     other thing on the board — there is nothing to name in settings. */
  const wasteId = () => ofDomain("sensor").find(looksLikeWaste)?.id ?? "";
  /* Teams followed with TeamTracker: a card each, in the room the sensor is in. */
  const teams = createMemo(() => ofDomain("sensor").filter(looksLikeTeamTracker), NONE, SAME_ITEMS);
  /* Every team followed in the house, for the match bar: a match is news in
     every room, not only the one its sensor was put in. Found by the
     integration that made them, so the house's thousands of other sensors
     are never read. */
  const houseTeamIds = createMemo(
    () =>
      props.config.matchBar === false
        ? []
        : (domains().sensor ?? []).filter((id) => haStore.entityRegistry[id]?.platform === "teamtracker"),
    [],
    { equals: sameIds },
  );
  const houseTeams = useEntities(houseTeamIds);
  const allTeams = createMemo(() => {
    const seen = new Set(houseTeams().map((team) => team.id));
    return [...houseTeams(), ...teams().filter((team) => !seen.has(team.id))];
  });
  /* Game day turns over at midnight, and a kick-off's day is checked against
     the clock: a minute's tick is plenty. */
  const [today, setToday] = createSignal(new Date());
  const dayTick = setInterval(() => setToday(new Date()), 60_000);
  onCleanup(() => clearInterval(dayTick));

  /* Which team's overlay is open. */
  const [matchTeam, setMatchTeam] = createSignal("");
  const openTeam = () => allTeams().find((team) => team.id === matchTeam());

  /* Likewise the calendars: the ones assigned to this area, in the order the
     area lists them, which is what gives each its colour. */
  /* The same ids are the same list, so the agenda is not asked again on
     every update from anything else in the room. */
  const calendarIds = createMemo(
    () =>
      ofDomain("calendar").map((entity) => entity.id),
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );
  /* Switches, minus the ones Home Assistant hides away as configuration —
     a dock's "child lock" is not something a room board should offer. */
  /* Washers, dryers and anything else that reports a programme and a run. */
  const machines = createMemo(() => appliancesOf(entities()));
  /* The sensors the washers' and dryers' cards are made of, for the setup
     list: a machine's state is a word, and it is on the board all the same. */
  const applianceSensors = createMemo(() => new Set(machines().flatMap((machine) => machine.all.map((entity) => entity.id))));

  const switches = createMemo(
    () => ofDomain("switch").filter((entity) => !entity.entityCategory),
    NONE,
    SAME_ITEMS,
  );

  /* Which camera the card is on. Held here rather than in the card, so the
     overlay opens on whatever was being shown. */
  const [chosenCamera, setChosenCamera] = createSignal("");
  /* The room's own scenes, for the light overlay — a scene set up for this
     room beats any preset colour the widget could invent. */
  const scenes = createMemo(() => ofDomain("scene"), NONE, SAME_ITEMS);

  /* The room's own temperature sensor, for the thermostat view's history —
     a climate entity's state is its mode, so it has no numeric timeline of
     its own to chart. */
  const temperatureSensor = () =>
    metrics().find((entity) => entity.deviceClass === "temperature")?.id;

  /* Which panel the popup shows. One dialog rather than one per card: the
     host gives a widget a single dialog, and three of them would each need
     their own open state to keep in step. */
  /* An overlay inside the card rather than the host's dialog.
   *
   * The dialog portals to document.body, outside the widget's shadow root —
   * and a widget's stylesheet lives inside that root, so every one of these
   * panels rendered there as unstyled text. Keeping them in the card also lets
   * them look like the board rather than like a dialog dropped on top of it.
   * The host's dialog stays for settings, where the form brings its own. */
  type Panel =
    | "media"
    | "lights"
    | "switches"
    | "openings"
    | "locks"
    | "plex"
    | "appliance"
    | "vacuum"
    | "climate"
    | "camera"
    | "calendar"
    | "weather"
    | "waste"
    | "covers"
    | "people"
    | "uptime"
    | "unifi"
    | "proxmox"
    | "activity"
    | "match"
    | "updates"
    | "setup";
  const [panel, setPanel] = createSignal<Panel | undefined>();


  const PANEL_TITLES: Record<Panel, string> = {
    media: "Now playing",
    lights: "Lights",
    switches: "Switches",
    openings: "Doors & windows",
    locks: "Locks",
    plex: "Recently added",
    appliance: "Appliances",
    vacuum: "Vacuum",
    climate: "Air temperature",
    camera: "Cameras",
    calendar: "Agenda",
    weather: "Weather",
    waste: "Waste collection",
    covers: "Shutters & blinds",
    people: "Who is home",
    uptime: "Uptime Kuma",
    unifi: "Network",
    proxmox: "Proxmox",
    activity: "Activity",
    match: "Matchday",
    updates: "Updates",
    setup: "Shown in this room",
  };

  /* The house's own room — one named Home — on a phone: its player is a
     slim bar docked at the foot with the activity line, not a card. */
  const homeDock = () =>
    narrow() && players().length > 0 && /^home$/i.test((current()?.label || area()?.name || current()?.area || "").trim());

  const openUptime = (group: number | null) => {
    setUptimeOpen({ group });
    openPanel("uptime");
  };
  const openPanel = (which: Panel) => {
    if (which === "media") {
      /* Opened on what is actually playing: the speaker behind a stand-in. */
      const shown = activePlayer();
      setHeldPlayer(playingThrough(shown)?.id ?? shown?.id ?? "");
    }
    setPanel(which);
  };

  /* Let go of the held player when the overlay closes, whichever way it was
     closed, so the card goes back to following the music. */
  createEffect(() => {
    if (panel() !== "media") setHeldPlayer("");
  });

  /* A panel belongs to the room it was opened from.
   *
   * Switching rooms with one open left it pointed at things the new room does
   * not have — and a panel handed an entity that is no longer there threw on
   * its first read, which takes the whole board down with it: the card stops
   * redrawing and every control stops answering. That is the freeze. The
   * panels are guarded individually as well, so the same cannot happen when an
   * entity simply goes away. */
  createEffect(
    on(
      index,
      () => {
        if (panel() === "setup") flushHidden();
        if (arranging()) finishArranging();
        setPanel(undefined);
        setRoomsOpen(false);
      },
      { defer: true },
    ),
  );

  const closePanel = () => {
    if (panel() === "setup") flushHidden();
    setPanel(undefined);
  };

  // A board torn down with the menu open should still keep the choice.
  onCleanup(flushHidden);

  /* An appliance's sensors belong to its own card: a "Washing Machine
     Progress 0%" tile beside the machine that is already showing it is the
     same fact twice, and the second one has no history to chart. */
  const machineIds = createMemo(() => {
    const ids = new Set<string>();
    for (const machine of machines()) for (const entity of machine.all) ids.add(entity.id);
    return ids;
  });

  /* Uptime Kuma's monitors in this room's area: their status sensors, and
     with them every sensor on the same devices — the response time, the
     certificate, the URL — which belong to the Uptime card rather than each
     becoming a reading of its own. */
  const monitorIds = createMemo(() =>
    ofDomain("sensor")
      .filter((entity) => isMonitor(entity))
      .map((entity) => entity.id),
  );
  const roomMonitors = useMonitors(monitorIds, { auto: false });
  /* The server room — any room with "server" in its name — is where the
     whole of Uptime Kuma lives on the board: its card takes the activity
     feed's column, and shows every monitor in the house unless the room's
     area holds monitors of its own. */
  const serverRoom = () => /server/i.test(current()?.label || area()?.name || current()?.area || "");
  const houseMonitors = useMonitors(() => [], { auto: () => serverRoom() && monitorIds().length === 0 });
  const monitors = createMemo(() => (serverRoom() && !roomMonitors().length ? houseMonitors() : roomMonitors()));
  /* Grouped by their Uptime Kuma tags, as the Uptime widget groups them. */
  const uptimeGroups = createMemo(() => groupMonitors(monitors(), tagGroups(monitors())));
  const [uptimeOpen, setUptimeOpen] = createSignal<{ group: number | null }>({ group: null });
  const uptimeIds = createMemo(() => {
    const ids = new Set(monitorIds());
    const devices = new Set(
      entities()
        .filter((entity) => ids.has(entity.id) && entity.deviceId)
        .map((entity) => entity.deviceId!),
    );
    for (const entity of entities()) if (entity.deviceId && devices.has(entity.deviceId)) ids.add(entity.id);
    return ids;
  });
  const platformOf = (id: string) =>
    (state.entityRegistry?.[id] as { platform?: string } | undefined)?.platform;
  const isUnifi = (id: string) => platformOf(id) === "unifi";
  const isProxmox = (id: string) => platformOf(id) === "proxmoxve";

  /* The UniFi network, in the room that holds it: one whose area has UniFi
     devices in it, or whose name says it is where the network lives — the
     server room, the rack, the network cupboard. The network is read only
     there; its entities in the room become the card, not readings. */
  const unifiRoom = createMemo(
    () =>
      entities().some((entity) => isUnifi(entity.id)) ||
      /server|network|netzwerk|rack|unifi/i.test(current()?.label || area()?.name || current()?.area || ""),
  );
  const network = useNetwork(() => ({ off: !unifiRoom() }));
  const pingHosts = usePings(() => [], () => !unifiRoom());
  const unifiPings = usePingList(network, pingHosts);
  /* The rates the card shows — a speed test's, where the gateway has none —
     are the card's, not readings of their own. */
  const rateIds = createMemo(
    () => new Set([network().throughput.down?.id, network().throughput.up?.id].filter((id): id is string => !!id)),
  );
  const hasNetwork = () => unifiRoom() && (!!network().gateway || network().devices.length > 0);
  /* Proxmox, likewise: in a room whose area holds its entities, or whose
     name says it is where the servers live. Read only there. */
  const proxmoxRoom = createMemo(
    () =>
      entities().some((entity) => isProxmox(entity.id)) ||
      /server|proxmox|rack/i.test(current()?.label || area()?.name || current()?.area || ""),
  );
  const cluster = useCluster(() => ({ off: !proxmoxRoom() }));
  const hasCluster = () => proxmoxRoom() && (cluster().nodes.length > 0 || cluster().guests.length > 0);

  const metrics = createMemo(() =>
    metricsOf(
      entities().filter(
        (entity) =>
          !machineIds().has(entity.id) &&
          !uptimeIds().has(entity.id) &&
          !rateIds().has(entity.id) &&
          !isUnifi(entity.id) &&
          !isProxmox(entity.id),
      ),
    ),
  );

  /* The agenda takes the big tile when there is one, and the reading that
     would have led drops back into the grid rather than disappearing. */
  const shownMetrics = () => metrics().filter((entity) => !removedCards().has(`metric:${entity.id}`));
  const hero = () => (calendarIds().length ? undefined : shownMetrics()[0]);

  /* The cap is a default, not a rule. It exists so an untouched board of
     eighty sensors is not eighty cards; once the menu has been used, the
     menu is the answer to what belongs here and trimming it would be the
     board arguing with the person who just told it. */
  const rest = () => {
    const from = hero() ? 1 : 0;
    return hidden().some((id) => id.startsWith("sensor."))
      ? shownMetrics().slice(from)
      : shownMetrics().slice(from, from + Math.max(1, props.config.maxCards ?? 5));
  };

  const name = () => current()?.label || area()?.name || props.config.title || "Room";
  /* The room's own photo from the settings, else the picture Home Assistant
     keeps for the area (Settings → Areas → the area → its picture). */
  const photo = () => imageUrl(current()?.image) ?? imageUrl(fullSize(area()?.picture));

  const gestures = useWidgetGestures(() => ({
    /* A tap on the board's own background does nothing: every card on it is
       its own target, and opening settings by brushing past one was the most
       annoying thing about the first build. Hold still opens them. */
    hold: { action: () => dialog.openDialog() },
  }));
  onCleanup(gestures.dispose);

  const swallow = (e: Event) => e.stopPropagation();

  /* The room menu, held to the room the board has for it: from the button up
     to the board's top edge (down to its foot when it opens downward on a
     phone). Within that it shows every room unscrolled as before; a house
     with more rooms than that scrolls, starting at the room you are in. */
  const fitRoomMenu = (menu: HTMLElement) => {
    const board = rootEl?.getBoundingClientRect();
    const pick = menu.parentElement?.getBoundingClientRect();
    if (!board || !pick) return;
    const gap = 12;
    const room = narrow() ? board.bottom - pick.bottom - gap : pick.top - board.top - gap;
    menu.style.maxHeight = `${Math.max(120, Math.floor(room))}px`;
    const active = menu.querySelector<HTMLElement>('[data-active="true"]');
    if (active && menu.scrollHeight > menu.clientHeight) {
      menu.scrollTop = active.offsetTop - menu.clientHeight / 2 + active.offsetHeight / 2;
    }
  };

  /* The board is a tablet layout, and on a narrow card the two panels stack
     into something neither half is designed for — so it says so rather than
     rendering a mess. */
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let rootEl: HTMLDivElement | undefined;

  createEffect(() => {
    if (!rootEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setSize({ w: box.width, h: box.height });
    });
    observer.observe(rootEl);
    onCleanup(() => observer.disconnect());
  });

  /* A memo, so a board that only changes height (a card taken off, a panel
     opened) leaves everything that asks "is this a phone?" alone. */
  /* A portrait wall screen (the Shelly Wall Display, a tablet on its side)
     is a tall phone, not a short desktop: the photo across the top and the
     cards in two columns under it read far better than three panels
     squeezed side by side. */
  const narrow = createMemo(() => {
    const { w, h } = size();
    return w > 0 && (w < 560 || (w < 1000 && h > w * 1.15));
  });

  /* The guest Wi-Fi's QR code: the one chosen, or UniFi's guest code found
     by its name. Tablets only — touch, and the side-by-side layout with a
     photo column tall enough to hold it. */
  const tablet = useTablet();
  const wifiQrId = createMemo(() => {
    if (props.config.wifiQrShow === false || narrow() || !tablet()) return "";
    const chosen = props.config.wifiQr?.[0];
    if (chosen) return chosen;
    const images = domains().image ?? [];
    return images.find((id) => /guest_qr_code/.test(id)) ?? images.find((id) => /qr_code/.test(id)) ?? "";
  });

  /* The match docked at the foot on a phone, on game day (sport.tsx). */
  const matchToday = createMemo(() =>
    narrow() && props.config.matchBar !== false
      ? barMatch(allTeams().filter(looksLikeTeamTracker), today())
      : undefined,
  );

  /* How many columns the narrow board's tiles take: two on a phone, and on
     a wider portrait screen as many as keep a tile about a phone's size —
     two columns across a wall display made every tile a third of the
     screen. */
  const columns = createMemo(() => {
    const w = size().w;
    return w < 560 ? 2 : Math.min(4, Math.max(3, Math.round(w / 190)));
  });

  /* The person overlay: its tab, whether it has anything to map, and home
     for "how far away". */
  const homeCoord = () => {
    const zone = zones().find((entity) => entity.id === "zone.home");
    const lat = Number(zone?.attributes?.["latitude"]);
    const lon = Number(zone?.attributes?.["longitude"]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  };

  /* The phone board's mosaic (mosaic.ts). Planned from the cards actually on
     the board, and planned again whenever one comes or goes — a light turning
     on can add a card, a player going idle can take one away. The grid sits
     inside a Show, so it is held as a signal rather than a plain ref: the
     observer has to follow it when it is replaced. */
  const [gridEl, setGridEl] = createSignal<HTMLDivElement>();

  /* The room's arrangement (arrange.ts): what was saved, or the draft while
     arranging — written to the config only when Done is pressed, since a
     config write rebuilds the widget and would end the arranging. */
  const roomKey = () => current()?.area || current()?.label || "room";
  const [arranging, setArranging] = createSignal(false);
  const [layoutDraft, setLayoutDraft] = createSignal<string[] | undefined>();
  const layoutEntries = () => layoutDraft() ?? props.config.layout ?? [];
  /* A phone has an arrangement of its own (arrange.ts). */
  const layoutKey = () => layoutRoom(roomKey(), narrow());
  const layout = createMemo((): RoomLayout => {
    const own = readLayout(layoutEntries(), layoutKey());
    /* A phone not yet arranged follows the desktop's order, as it did. */
    if (narrow() && !own.sizes && !own.order.length) return { order: readLayout(layoutEntries(), roomKey()).order };
    return own;
  });

  /* Cards that are off the board keep their place in the order, so one
     brought back returns where it was rather than at the end. */
  const change = (next: RoomLayout) => {
    const order = [...next.order];
    layout().order.forEach((key, index) => {
      if (!order.includes(key)) order.splice(Math.min(index, order.length), 0, key);
    });
    setLayoutDraft(writeLayout(layoutEntries(), layoutKey(), { ...next, order }));
  };

  /* The keys in the order they are on the board now. */
  const shownKeys = () => {
    const grid = gridEl();
    if (!grid) return [];
    /* As they stand on the board: on a phone the mosaic may have moved a
       card to a slot that fits it, and "earlier" means earlier there. */
    return orderedCards(grid, layout().order)
      .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0))
      .map(cardKey)
      .filter(Boolean);
  };

  /* Every card's size as it stands, the board's own choice included. */
  const currentSizes = () => {
    const grid = gridEl();
    const sizes = new Map<string, Size>();
    if (!grid) return sizes;
    for (const card of orderedCards(grid, layout().order)) sizes.set(cardKey(card), sizeOf(card, layout(), narrow()));
    return sizes;
  };

  const moveCard = (key: string, by: -1 | 1) => {
    const keys = shownKeys();
    const at = keys.indexOf(key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to]!, keys[at]!];
    change({ order: keys, sizes: currentSizes() });
  };

  /* Dragged and dropped: the card takes the other one's place, and the
     cards between move along by one. */
  const placeCard = (key: string, onto: string) => {
    const keys = shownKeys();
    const from = keys.indexOf(key);
    const to = keys.indexOf(onto);
    if (from < 0 || to < 0 || from === to) return;
    keys.splice(from, 1);
    keys.splice(to, 0, key);
    change({ order: keys, sizes: currentSizes() });
  };

  const resizeCard = (key: string, size: Size) => {
    const sizes = currentSizes();
    sizes.set(key, size);
    change({ order: shownKeys(), sizes });
  };

  /* The X while arranging takes a card off by name, and it comes back from
     the row the arranging shows above the cards. It used to switch the card's
     entities off as "Shown in this room" would; that changed the room's
     entities, so the whole board worked out its content again in one step —
     more than the sealed engine of Dash 1.5 allows for one, and the widget
     stopped. By name, only the card goes. */
  const removedPrefix = () => `@card:${roomKey()}:`;
  const removedCards = createMemo(
    () => new Set(hidden().filter((id) => id.startsWith(removedPrefix())).map((id) => id.slice(removedPrefix().length))),
  );
  /* Cards taken off while arranging, applied when arranging ends.
     *
     * The X only hides the card where it stands, and leaves its place empty.
     * Changing the hidden list on the spot made the board work out its content
     * again inside the tap, and taking the card out of the grid (display: none)
     * made every other card move and resize in the same step; in the sealed
     * engine of Dash 1.5 either went over the limit for one step and stopped
     * the widget. Done applies them all at once, with the layout, in the one
     * config write arranging already makes. */
  const [pendingOff, setPendingOff] = createSignal<ReadonlySet<string>>(new Set());

  /* Takes the card out of the grid, or puts it back, on the spot. */
  const showCard = (key: string, shown: boolean) => {
    const grid = gridEl();
    if (!grid) return;
    for (const card of [...grid.children] as HTMLElement[])
      if (card.classList.contains("rb-card") && cardKey(card) === key) {
        if (shown) {
          clearData(card, "removed");
          clearStyle(card, "display");
        } else {
          setData(card, "removed", "");
          setStyle(card, "display", "none");
        }
      }
  };

  const removeCard = (key: string) => {
    if (arranging()) {
      setPendingOff(new Set([...pendingOff(), key]));
      showCard(key, false);
      return;
    }
    setHidden([...new Set([...hidden(), `${removedPrefix()}${key}`])]);
  };
  const restoreCard = (key: string) => {
    /* Taken off in this round of arranging: it comes straight back. */
    if (pendingOff().has(key)) {
      const next = new Set(pendingOff());
      next.delete(key);
      setPendingOff(next);
      showCard(key, true);
      return;
    }
    setHidden(hidden().filter((id) => id !== `${removedPrefix()}${key}`));
  };
  /* Everything off the board while arranging: what was taken off before, and
     what was taken off just now. */
  const offBoard = () => [...new Set([...removedCards(), ...pendingOff()])];
  /* What the row of removed cards calls each one. A reading is named
     without the room — the row is in the room already — and without a
     leading "Sensor": "Sensor Living Room Humidity" is "Humidity". */
  const entityOfCard = (key: string) =>
    key.includes(":") ? allEntities().find((item) => item.id === key.slice(key.indexOf(":") + 1)) : undefined;
  const cardName = (key: string) => {
    if (key.startsWith("wash:")) return machines().find((m) => `wash:${m.key}` === key)?.name ?? "Appliance";
    if (key.includes(":")) {
      const full = entityOfCard(key)?.friendlyName ?? key.slice(key.indexOf(":") + 1);
      let short = full.replace(/^sensor\s+/i, "");
      for (const room of [area()?.name, name()])
        if (room) {
          const escaped = room.replace(/[.*+?^$()|[\]\\{}]/g, String.raw`\$&`);
          short = short.replace(new RegExp(String.raw`\b${escaped}\b`, "i"), "");
        }
      short = short.replace(/\s{2,}/g, " ").trim();
      return short ? short.charAt(0).toUpperCase() + short.slice(1) : full;
    }
    return CARD_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  };
  const cardIcon = (key: string) => {
    if (key.startsWith("wash:")) return "mdi:washing-machine";
    if (key.includes(":")) return METRIC_ICONS[classOf(entityOfCard(key) ?? ({} as EntityView))] ?? "mdi:chart-line";
    return CARD_ICONS[key] ?? "mdi:card-outline";
  };

  const finishArranging = () => {
    setArranging(false);
    const pending = layoutDraft();
    setLayoutDraft(undefined);
    const base = draft() ?? props.config.hidden ?? [];
    const off = [...pendingOff()].map((key) => `${removedPrefix()}${key}`);
    setPendingOff(new Set<string>());
    const hiddenNow = off.length ? [...new Set([...base, ...off])] : draft();
    /* Kept as the draft until the written config comes back, so the cards
       stay off in between rather than coming back for a moment. */
    setDraft(hiddenNow);
    const layoutChanged = !!pending && pending.join("\n") !== (props.config.layout ?? []).join("\n");
    const saved = props.config.hidden ?? [];
    const hiddenChanged =
      !!hiddenNow && (hiddenNow.length !== saved.length || hiddenNow.some((id) => !saved.includes(id)));
    /* One write for both: each write rebuilds the widget from the config. */
    if (layoutChanged || hiddenChanged)
      ctx.updateConfig({
        ...props.config,
        ...(layoutChanged ? { layout: pending } : {}),
        ...(hiddenChanged ? { hidden: hiddenNow } : {}),
      });
  };

  /* The layout, laid again whenever a card comes or goes, the arrangement
     changes, or arranging starts or ends. The grid sits inside a Show, so it
     is held as a signal rather than a plain ref: the observer has to follow
     it when it is replaced. */
  createEffect(() => {
    const grid = gridEl();
    if (!grid) return;
    const lay = () => {
      /* Cards hidden by name are taken out before the layout is planned, so
         they leave no hole. */
      const removed = removedCards();
      for (const card of [...grid.children] as HTMLElement[]) {
        if (!card.classList.contains("rb-card")) continue;
        /* Untracked: the X hides its card itself, and laying the whole
           grid again for it is work the tap does not need. */
        const off = removed.has(cardKey(card)) || untrack(pendingOff).has(cardKey(card));
        if (off) setData(card, "removed", "");
        else clearData(card, "removed");
        if (off) setStyle(card, "display", "none");
        else clearStyle(card, "display");
      }
      const current = layout();
      applyLayout(grid, narrow(), current);
      if (arranging())
        attachControls(grid, current, narrow(), { move: moveCard, resize: resizeCard, remove: removeCard, place: placeCard });
      else detachControls(grid);
    };
    lay();
    /* A 16:9 card's width follows the grid's column count, which changes
       with the window rather than with the cards. */
    if (typeof ResizeObserver !== "undefined") {
      let columns = "";
      const watcher = new ResizeObserver(() => {
        const now = String(Math.round(grid.clientWidth / 50));
        if (now === columns) return;
        columns = now;
        refitCinema(grid);
      });
      watcher.observe(grid);
      onCleanup(() => watcher.disconnect());
    }
    /* The cards as elements, so a card replaced by a new one of the same
       kind (the player and Plex's shelf share a place) is laid as well. */
    const cardsOf = () => [...grid.children];
    const same = (a: Element[], b: Element[]) => a.length === b.length && a.every((el, i) => el === b[i]);
    let seen = cardsOf();
    if (typeof MutationObserver !== "undefined") {
      /* Only when the cards themselves changed. The sealed engine's observer
         also reports attribute changes, and laying the grid writes
         attributes: the X while arranging set one, the observer laid the
         grid, which set more, and the widget went round that loop until the
         engine stopped it. */
      const watch = new MutationObserver(() => {
        const now = cardsOf();
        if (same(now, seen)) return;
        seen = now;
        untrack(lay);
      });
      watch.observe(grid, { childList: true });
      onCleanup(() => watch.disconnect());
      return;
    }
    /* No MutationObserver: look twice a second whether the cards changed. */
    const timer = setInterval(() => {
      const now = cardsOf();
      if (same(now, seen)) return;
      seen = now;
      untrack(lay);
    }, 500);
    onCleanup(() => clearInterval(timer));
  });

  /* The hero reading, when the hero is the room's temperature — the tile the
     narrow layout drops in favour of the chip on the photo. */
  const heroTemp = () => {
    const first = hero();
    return first && classOf(first) === "temperature" && numeric(first) !== undefined
      ? first
      : undefined;
  };

  /* What that chip says: the sensor whose tile it stands in for, or failing
     that whatever the thermostat reports. */
  const roomTemp = () => {
    const sensor = heroTemp();
    if (sensor) return Math.round(numeric(sensor)! * 10) / 10;
    return currentOf(climates()[0]) ?? targetOf(climates()[0]);
  };

  /* Whether the photo has a clock, which then stands in for its titles. */
  const clockOn = () => (props.config.clock ?? "24h") !== "off";

  return (
    <>
      <Widget
        tone="neutral"
        gestures={gestures}
        emptyState={
          rooms().length
            ? undefined
            : {
                icon: <Icon icon="mdi:view-dashboard-outline" width="28" />,
                title: "No rooms",
                message: "Hold to add an area",
              }
        }
      >
        <Widget.Content class="rb-root">
          <div
            ref={(el) => {
              rootEl = el;
              setVars(el, () => themeVars());
            }}
            class="rb-board"
            data-narrow={narrow()}
            data-cols={columns()}
            style={{ "--rb-cols": String(columns()) }}
            data-overlay={panel() !== undefined}
            data-scheme={themeVars()["color-scheme"]}
          >
            {/* Left: the room itself. */}
            <aside class="rb-scene">
              <Show when={photo()}>
                <div class="rb-scene-photo" style={{ "background-image": `url("${photo()}")` }} />
              </Show>
              <div class="rb-scene-veil" />

              <div class="rb-scene-head">
                {/* The clock in the corner, the room's name in its line; with
                    the clock off, the name and the subtitle as titles. */}
                <Show
                  when={clockOn()}
                  fallback={
                    <div class="rb-scene-titles">
                      <h2 class="rb-scene-name rb-truncate">{name()}</h2>
                      <Show when={props.config.subtitle}>
                        <span class="rb-scene-sub">
                          <Icon icon="mdi:folder-outline" width="13" />
                          {props.config.subtitle}
                        </span>
                      </Show>
                    </div>
                  }
                >
                  <SceneClock
                    format={props.config.clock === "12h" ? "12h" : "24h"}
                    look={props.config.clockStyle ?? "bold"}
                    room={name()}
                  />
                </Show>

                {/* The room's own menu: what this board shows of the area. In
                    the title row rather than floating in the corner, so it
                    lines up with the name and clears the panel's overlap.
                    On a phone the two swap: the temperature takes this corner,
                    where it is read with the room's name, and the menu goes
                    down beside the room picker, the other control on the
                    photo, in the same glass (below). */}
                <Show
                  when={!narrow()}
                  fallback={
                    <Show when={roomTemp() !== undefined}>
                      <button
                        class="rb-scene-temp"
                        data-running={climateRunning(climates()[0])}
                        data-tap={!!climates().length}
                        aria-label="Climate"
                        onPointerDown={swallow}
                        onClick={() => climates().length && openPanel("climate")}
                      >
                        <Icon icon="mdi:thermometer" width="11" />
                        <span>{roomTemp()}°</span>
                      </button>
                    </Show>
                  }
                >
                  <button
                    class="rb-scene-menu"
                    aria-label="Choose what this room shows"
                    title="Choose what this room shows"
                    onPointerDown={swallow}
                    onClick={() => openPanel("setup")}
                  >
                    <Icon icon="mdi:menu" width="20" />
                  </button>
                </Show>
              </div>


              {/* One button rather than a row of them: a strip of chips is a
                  menu left permanently open across the photograph, and with
                  more than four rooms it either wrapped or scrolled. The
                  button says where you are; the list says where else. */}
              {/* The guest Wi-Fi, on a tablet: over the floor of the photo,
                  above the room picker. */}
              <Show when={wifiQrId()}>
                <div class="rb-scene-wifi">
                  <WifiQr entityId={wifiQrId()} />
                </div>
              </Show>

              <Show when={rooms().length > 1}>
                <div class="rb-roompick" onPointerDown={swallow}>
                  <Show when={roomsOpen()}>
                    {/* Inside the photo rather than over the page: a fixed,
                        full-viewport catcher that outlives its menu takes
                        every click on the dashboard with it, which is exactly
                        what "one change and then it freezes" looks like. */}
                    <div
                      class="rb-roommenu-backdrop"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setRoomsOpen(false);
                      }}
                    />
                    <div class="rb-roommenu" ref={(el) => requestAnimationFrame(() => fitRoomMenu(el))}>
                      {/* By position: a config handed over afresh would
                          otherwise rebuild every row, and each row's own
                          area subscription with it — the menu blinked empty
                          and filled again. */}
                      <Index each={rooms()}>
                        {(room, position) => {
                          const name = () => room().label || room().area || "Room";
                          return (
                            <RoomMenuRow
                              area={room().area ?? ""}
                              name={name()}
                              icon={safeIcon(room().icon, roomIcon(name()))}
                              active={position === index()}
                              entities={position === index() ? entities() : undefined}
                              hidden={hidden()}
                              onPick={() => {
                                /* Closed first: whatever the switch costs in
                                   re-rendering happens with the menu already
                                   gone, so nothing is left floating over the
                                   board if that work is slow. */
                                setRoomsOpen(false);
                                /* An overlay open over the board belongs to
                                   the room being left: it closes, and the new
                                   room's board is what the tap lands on. */
                                if (position !== index() && panel()) closePanel();
                                /* And the new room a frame later. Set in the
                                   same breath, the menu stayed on screen until
                                   the whole board had been rebuilt for the new
                                   room — the tap seemed to do nothing. Now the
                                   menu goes at once, and the board follows. */
                                if (position !== index()) {
                                  const next = position;
                                  requestAnimationFrame(() => setTimeout(() => setIndex(next), 0));
                                }
                              }}
                            />
                          );
                        }}
                      </Index>
                    </div>
                  </Show>

                  <button
                    class="rb-roomswitch"
                    data-open={roomsOpen()}
                    aria-haspopup="listbox"
                    aria-expanded={roomsOpen()}
                    onClick={() => setRoomsOpen((was) => !was)}
                  >
                    <Icon
                      icon={safeIcon(
                        current()?.icon,
                        roomIcon(current()?.label || current()?.area || "Room"),
                      )}
                      width="17"
                    />
                    <span class="rb-truncate">
                      {current()?.label || current()?.area || "Room"}
                    </span>
                    <StatusChips marks={roomStatus(entities()).marks} compact />
                    <Icon class="rb-roomswitch-caret" icon="mdi:chevron-up" width="16" />
                  </button>
                </div>
              </Show>

              {/* The menu, on a phone: bottom right, opposite the room picker
                  and dressed like it, so the photo's two controls read as a
                  pair along its foot. */}
              <Show when={narrow()}>
                <button
                  class="rb-scene-menu rb-scene-menu--foot"
                  aria-label="Choose what this room shows"
                  title="Choose what this room shows"
                  onPointerDown={swallow}
                  onClick={() => openPanel("setup")}
                >
                  <Icon icon="mdi:menu" width="18" />
                </button>
              </Show>
            </aside>

            {/* Right: whatever that area is measuring. */}
            <section class="rb-panel" onPointerDown={swallow}>
              <header class="rb-panel-head">
                <h2 class="rb-panel-title">Overview</h2>
                <span class="rb-panel-meta">
                  {entities().length} {entities().length === 1 ? "entity" : "entities"}
                </span>

                {/* Waiting updates, beside Arrange on a wide screen; on a
                    phone they are in the bar at the foot instead. */}
                <Show when={!narrow() && updates().length}>
                  <UpdatesButton updates={updates()} onOpen={() => openPanel("updates")} />
                </Show>

                {/* Arrange: move the cards and choose the big ones. */}
                <button
                  class="rb-arrange-toggle"
                  data-on={arranging()}
                  aria-pressed={arranging()}
                  onPointerDown={swallow}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (arranging()) finishArranging();
                    else setArranging(true);
                  }}
                >
                  <Icon icon={arranging() ? "mdi:check" : "mdi:view-dashboard-edit-outline"} width="16" />
                  <span>{arranging() ? "Done" : "Arrange"}</span>
                </button>

                <Show when={people().length}>
                  <PersonRow
                    people={people()}
                    haBaseUrl={NO_ADDRESS}
                    onOpen={() => openPanel("people")}
                  />
                </Show>
              </header>

              <Show
                when={
                  metrics().length ||
                  calendarIds().length ||
                  players().length ||
                  lights().length ||
                  switches().length ||
                  openings().length ||
                  locks().length ||
                  !!plex() ||
                  weathers().length ||
                  !!wasteId() ||
                  teams().length ||
                  covers().length ||
                  machines().length ||
                  vacuums().length ||
                  climates().length ||
                  hasNetwork() ||
                  hasCluster() ||
                  monitors().length > 0
                }
                fallback={
                  <div class="rb-empty">
                    <Icon icon="mdi:gauge-empty" width="30" />
                    <span>
                      {current()?.area
                        ? "This area has no sensors the board can chart yet."
                        : "Pick an area for this room in settings."}
                    </span>
                  </div>
                }
              >
                <div
                  class="rb-panel-body"
                  style={{
                    /* How tall the dock at a phone's foot is, so the tiles
                       can scroll clear of it: the activity line, and a row
                       for each of the match, the player and the updates. */
                    "--rb-dock-h": `${3.6 + (matchToday() ? 3.4 : 0) + (homeDock() ? 3.5 : 0) + (updates().length ? 2.6 : 0)}rem`,
                  }}
                >
                <Show when={arranging() && offBoard().length}>
                  <div class="rb-removed" onPointerDown={swallow}>
                    <div class="rb-removed-head">
                      <Icon icon="mdi:eye-off-outline" width="15" />
                      <span>Off the board</span>
                      <small>Tap one to put it back</small>
                    </div>
                    <div class="rb-removed-list">
                      <For each={offBoard()}>
                        {(key) => (
                          <button type="button" class="rb-restore" title={`Put ${cardName(key)} back`} onClick={() => restoreCard(key)}>
                            <Icon icon={cardIcon(key)} width="16" />
                            <span>{cardName(key)}</span>
                            <Icon icon="mdi:plus" width="15" class="rb-restore-add" />
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
                <div class="rb-grid" ref={setGridEl} data-arranging={arranging()}>
                  <Show when={calendarIds().length}>
                    <Guard name="Agenda"><CalendarCard
                      ids={calendarIds()}
                      todoIds={todoIds()}
                      onOpen={() => openPanel("calendar")}
                    /></Guard>
                  </Show>

                  {/* Not on a phone when it is the room's temperature: at
                      one column the big reading and its chart cost a screen
                      to say a number the chip on the photo already says. Any
                      other hero — humidity, CO₂, a power draw — stays, since
                      nothing else on a narrow board would report it. */}
                  <Show when={hero() && !(narrow() && heroTemp())}>
                    <Guard name="Reading"><HeroMetric entity={hero()!} hours={props.config.historyHours ?? 6} /></Guard>
                  </Show>

                  <Show when={players().length && (playing() || !plex()) && !homeDock()}>
                    <Guard name="Media"><MediaCard
                      players={cardPlayers()}
                      haBaseUrl={NO_ADDRESS}
                      artworkProxy={NO_ADDRESS}
                      chosen={chosenPlayer()}
                      onOpen={() => openPanel("media")}
                    /></Guard>
                  </Show>

                  <Show when={lights().length}>
                    <Guard name="Lights"><LightCard lights={lights()} onOpen={() => openPanel("lights")} /></Guard>
                  </Show>

                  <Keyed each={machines()} by={(machine) => machine.key}>
                    {(machine) => (
                      <Guard name="Appliance"><ApplianceCard machine={machine} onOpen={() => openPanel("appliance")} /></Guard>
                    )}
                  </Keyed>

                  <Show when={weathers().length}>
                    <Guard name="Weather"><WeatherCard
                      entityId={weathers()[0]!.id}
                      /* The area's name rather than the provider's: "Home"
                         says where this weather is, "Tomorrow.io Home" says
                         who sells it and then runs out of room. */
                      title={area()?.name ?? ""}
                      onOpen={() => openPanel("weather")}
                    /></Guard>
                  </Show>

                  <Show when={covers().length}>
                    <Guard name="Covers">
                      <CoverCard covers={covers()} onOpen={() => openPanel("covers")} />
                    </Guard>
                  </Show>

                  <Show when={wasteId()}>
                    <Guard name="Waste"><WasteCard entityId={wasteId()} onOpen={() => openPanel("waste")} /></Guard>
                  </Show>

                  {/* Keyed on the sensor: a loop over its state objects rebuilt
                      the card, crests and all, on every update. */}
                  <Keyed each={teams()}>
                    {(team) => (
                      <Guard name="Match">
                        <SportCard
                          entity={team}
                          proxy={NO_ADDRESS}
                          haBase={NO_ADDRESS}
                          onOpen={
                            isFootball(team)
                              ? () => {
                                  setMatchTeam(team.id);
                                  openPanel("match");
                                }
                              : undefined
                          }
                        />
                      </Guard>
                    )}
                  </Keyed>

                  <Show when={plex() && !playing()}>
                    <Guard name="Recently added">
                      <PlexCard
                        entity={plex()!}
                        items={plexItems()}
                        onOpen={() => openPanel("plex")}
                      />
                    </Guard>
                  </Show>

                  <Show when={locks().length}>
                    <Guard name="Locks">
                      <LockCard locks={locks()} onOpen={() => openPanel("locks")} />
                    </Guard>
                  </Show>

                  <Show when={openings().length}>
                    <Guard name="Openings">
                      <OpeningsCard
                        openings={openings()}
                        onOpen={() => openPanel("openings")}
                      />
                    </Guard>
                  </Show>

                  <Show when={switches().length}>
                    <Guard name="Switches"><SwitchCard switches={switches()} onOpen={() => openPanel("switches")} /></Guard>
                  </Show>

                  <Show when={climates().length}>
                    <Guard name="Climate"><ClimateCard climate={climates()[0]!} onOpen={() => openPanel("climate")} /></Guard>
                  </Show>

                  <Show when={vacuums().length}>
                    {/* No map on the card: it keeps the robot, and the map is
                        a swipe away in the vacuum's overlay. */}
                    <Guard name="Vacuum"><VacuumCard
                      vacuum={vacuums()[0]!}
                      onOpen={() => openPanel("vacuum")}
                    /></Guard>
                  </Show>

                  <Show when={cameras().length}>
                    <Guard name="Cameras"><CameraCard
                      cameras={cameras()}
                      activeId={chosenCamera()}
                      onSelect={setChosenCamera}
                      onOpen={() => openPanel("camera")}
                    /></Guard>
                  </Show>

                  <Show when={hasNetwork()}>
                    <Guard name="Network">
                      <UnifiCard network={network()} pings={unifiPings()} onOpen={() => openPanel("unifi")} />
                    </Guard>
                  </Show>

                  <Show when={hasCluster()}>
                    <Guard name="Proxmox">
                      <ProxmoxCard cluster={cluster()} onOpen={() => openPanel("proxmox")} />
                    </Guard>
                  </Show>

                  <Show when={monitors().length && !serverRoom()}>
                    <Guard name="Uptime">
                      <UptimeCard monitors={monitors()} groups={uptimeGroups()} onOpen={openUptime} />
                    </Guard>
                  </Show>

                  <Keyed each={rest()}>
                    {(entity) => (
                      <Metric entity={entity} hours={props.config.historyHours ?? 6} />
                    )}
                  </Keyed>
                </div>

                {/* The room's feed, fixed down the right-hand side rather than
                    taking a turn among the tiles: it is a column of things
                    happening, and a square tile could only ever show three.
                    On a phone the two columns become one, and the feed would
                    be a second scrolling list underneath the first — so there
                    it is a bar along the foot instead, and opens from it. */}
                <Show
                  when={serverRoom() && monitors().length}
                  fallback={
                    <Show when={!narrow()} fallback={
                      <Show
                        when={homeDock() || matchToday() || updates().length}
                        fallback={
                          <Guard name="Activity">
                            <ActivityBar entities={entities()} onOpen={() => openPanel("activity")} />
                          </Guard>
                        }
                      >
                        {/* Docked at the foot of the screen, over the
                            activity line: the match on game day, in every
                            room, and the Home room's player. */}
                        <div class="rb-dock" data-match={!!matchToday()} data-player={homeDock()} data-updates={updates().length > 0}>
                          <Show when={matchToday()}>
                            {(team) => (
                              <Guard name="Match">
                                <MatchBar
                                  entity={team()}
                                  proxy={NO_ADDRESS}
                                  haBase={NO_ADDRESS}
                                  onOpen={
                                    isFootball(team())
                                      ? () => {
                                          setMatchTeam(team().id);
                                          openPanel("match");
                                        }
                                      : undefined
                                  }
                                />
                              </Guard>
                            )}
                          </Show>
                          <Show when={homeDock()}>
                            <Guard name="Media">
                              <MiniPlayer
                                players={cardPlayers()}
                                haBaseUrl={NO_ADDRESS}
                                artworkProxy={NO_ADDRESS}
                                chosen={chosenPlayer()}
                                onOpen={() => openPanel("media")}
                              />
                            </Guard>
                          </Show>
                          <Show when={updates().length}>
                            <Guard name="Updates">
                              <UpdatesBar updates={updates()} onOpen={() => openPanel("updates")} />
                            </Guard>
                          </Show>
                          <Guard name="Activity">
                            <ActivityBar entities={entities()} onOpen={() => openPanel("activity")} />
                          </Guard>
                        </div>
                      </Show>
                    }>
                      <Guard name="Activity"><ActivityCard entities={entities()} onOpen={() => openPanel("activity")} /></Guard>
                    </Show>
                  }
                >
                  {/* The server room: Uptime Kuma in the feed's place — and on a
                      phone, as the feed is there, a bar along the foot. */}
                  <Show
                    when={!narrow()}
                    fallback={
                      <Guard name="Uptime">
                        <UptimeBar monitors={monitors()} onOpen={() => openUptime(null)} />
                      </Guard>
                    }
                  >
                    <Guard name="Uptime">
                      <UptimeCard monitors={monitors()} groups={uptimeGroups()} onOpen={openUptime} side />
                    </Guard>
                  </Show>
                </Show>
                </div>
              </Show>

              {/* The panel, over the board. */}
              <Show when={panel()}>
                <div class="rb-overlay" onPointerDown={swallow}>
                  <button type="button" class="rb-overlay-scrim" tabIndex={-1} aria-label="Close" onClick={closePanel} />

                  <section class="rb-sheet" data-panel={panel()}>
                    {/* The weather's own sky behind the top of its sheet. */}
                    <Show when={panel() === "weather" && weathers().length}>
                      <WeatherSky entityId={weathers()[0]?.id ?? ""} />
                    </Show>
                    <header class="rb-sheet-head">
                      <button
                        class="rb-sheet-back"
                        aria-label="Back to the board"
                        onClick={closePanel}
                      >
                        <Icon icon="mdi:arrow-left" width="18" />
                      </button>
                      <h2 class="rb-sheet-title rb-truncate">{PANEL_TITLES[panel()!]}</h2>
                    </header>

                    <div class="rb-sheet-body">
                      <ErrorBoundary
                        fallback={(error, reset) => (
                          <div class="rb-panel-error">
                            <Icon icon="mdi:alert-circle-outline" width="22" />
                            <p>{errorMessage(error)}</p>
                            <button class="rb-error-retry" onClick={reset}>
                              <Icon icon="mdi:refresh" width="14" />
                              <span>Try again</span>
                            </button>
                          </div>
                        )}
                      >
                      <Show when={panel() === "media" && players().length}>
                        <MediaPanels
                          player={activePlayer}
                          rooms={players}
                          players={players}
                          artwork={activeArtwork}
                          activeId={activePlayer()?.id ?? ""}
                          onSelectPlayer={setChosenPlayer}
                          musicAssistant={props.config.musicAssistant !== false}
                          lookupArtwork={false}
                          configEntryId={props.config.configEntryId ?? ""}
                          artworkProxy={NO_ADDRESS}
                          haBaseUrl={NO_ADDRESS}
                          remoteProfiles={props.config.remoteProfiles ?? []}
                          remoteHoldRepeats={props.config.remoteHoldRepeats !== false}
                          boardRemote
                          board
                        />
                      </Show>

                      <Show when={panel() === "lights" && lights().length}>
                        <LightPanel lights={lights()} scenes={scenes()} narrow={narrow()} />
                      </Show>

                      <Show when={panel() === "appliance" && machines().length}>
                        <AppliancePanel machines={machines()} />
                      </Show>

                      <Show when={panel() === "calendar" && calendarIds().length}>
                        <CalendarPanel ids={calendarIds()} todoIds={todoIds()} />
                      </Show>

                      <Show when={panel() === "weather" && weathers().length}>
                        <WeatherPanel
                          entityId={weathers()[0]?.id ?? ""}
                          title={area()?.name ?? ""}
                          /* Warnings and pollen are read off the area's own
                             sensors. The unfiltered list on purpose: these are
                             readings the panel quotes rather than cards the
                             menu tidies, so hiding a sensor from the board
                             should not take its warning away. */
                          entities={allEntities()}
                        />
                      </Show>

                      <Show when={panel() === "covers" && covers().length}>
                        <CoverPanel covers={covers()} />
                      </Show>

                      <Show when={panel() === "match" && openTeam()}>
                        {(team) => (
                          <MatchPanel entity={team()} proxy={NO_ADDRESS} />
                        )}
                      </Show>

                      <Show when={panel() === "waste" && !!wasteId()}>
                        <WastePanel entityId={wasteId()} />
                      </Show>

                      <Show when={panel() === "plex" && plex()}>
                        <PlexPanel entity={plex()!} items={plexItems()} />
                      </Show>

                      <Show when={panel() === "locks" && locks().length}>
                        <LockPanel locks={locks()} />
                      </Show>

                      <Show when={panel() === "openings" && openings().length}>
                        <OpeningsPanel openings={openings()} />
                      </Show>

                      <Show when={panel() === "switches" && switches().length}>
                        <SwitchPanel switches={switches()} />
                      </Show>

                      <Show when={panel() === "vacuum" && vacuums().length}>
                        <VacuumPanel
                          vacuums={vacuums()}
                          mapEntityId={vacuumMap()}
                          rooms={props.config.vacuumRooms ?? []}
                          sensorIds={props.config.vacuumSensors ?? []}
                        />
                      </Show>

                      <Show when={panel() === "unifi" && hasNetwork()}>
                        <UnifiBoardPanel network={network()} pings={unifiPings()} />
                      </Show>

                      <Show when={panel() === "proxmox" && hasCluster()}>
                        <ProxmoxBoardPanel cluster={cluster()} />
                      </Show>

                      <Show when={panel() === "uptime" && monitors().length}>
                        <UptimeBoardPanel monitors={monitors()} groups={uptimeGroups()} open={uptimeOpen()} />
                      </Show>

                      <Show when={panel() === "people" && people().length}>
                        <div class="rb-people-stack">
                          <PeoplePanel
                            people={people()}
                            haBaseUrl={NO_ADDRESS}
                            home={homeCoord()}
                          />
                        </div>
                      </Show>

                      <Show when={panel() === "updates"}>
                        <UpdatesPanel updates={updates()} />
                      </Show>

                      <Show when={panel() === "activity"}>
                        <ActivityPanel entities={entities()} />
                      </Show>

                      <Show when={panel() === "camera" && cameras().length}>
                        <CameraPanel
                          cameras={cameras()}
                          activeId={chosenCamera()}
                          onSelect={setChosenCamera}
                        />
                      </Show>

                      <Show when={panel() === "setup"}>
                        <SetupPanel
                          entities={setupEntities()}
                          onCards={applianceSensors()}
                          hidden={hidden()}
                          onSet={setHidden}
                        />
                      </Show>

                      <Show when={panel() === "climate" && climates().length}>
                        <ClimatePanel
                          climate={climates()[0]!}
                          historyEntityId={temperatureSensor()}
                          historyHours={props.config.historyHours ?? 6}
                        />
                      </Show>
                      </ErrorBoundary>
                    </div>
                  </section>
                </div>
              </Show>
            </section>

          </div>
        </Widget.Content>
      </Widget>

      <WidgetDialog
        {...widgetDialogProps}
        {...dialog.dialogProps}
        title={name()}
        maxWidth="lg"
        configSchema={configSchema}
        config={props.config}
        onConfigSave={(config) => {
          ctx.updateConfig(config);
          dialog.setShowDialog(false);
        }}
      />
    </>
  );
}

export default defineWidget<Config>({
  manifest: {
    name: "Room Board",
    description: "A tablet board: the room on the left, everything it measures on the right",
    icon: "mdi:view-dashboard-outline",
    minSize: { w: 4, h: 3 },
    /* Room to take a whole tablet or a wall display: the board scales its own
       columns with the space it is given rather than multiplying them, so a
       bigger card is the same board drawn larger. */
    maxSize: { w: 24, h: 16 },
    defaultSize: { w: 8, h: 4 },
    examples: [
      {
        /* The hub's thumbnail is this example rendered against its demo home,
           so it names the demo's own areas. With no rooms the board had nothing
           to build from and the preview came out as an empty frame. Living
           Room leads because the demo fills it — lights, readings, media,
           climate — and the other two give the room picker somewhere to go. */
        label: "Lounge",
        /* Larger than the default placement on purpose: at 8×4 the thumbnail
           showed one reading and the activity feed, and the cards that make
           this a board rather than a sensor tile were all below the fold. */
        size: { w: 12, h: 6 },
        config: {
          title: "",
          subtitle: "My Home",
          clock: "24h",
          clockStyle: "bold",
          rooms: [
            { kind: "room", label: "Living Room", icon: "mdi:sofa", area: "living_room" },
            { kind: "room", label: "Bedroom", icon: "mdi:bed", area: "bedroom" },
            { kind: "room", label: "Kitchen", icon: "mdi:silverware-fork-knife", area: "kitchen" },
          ],
          musicAssistant: true,
          remoteProfiles: [],
          remoteHoldRepeats: true,
          hidden: [],
          layout: [],
          people: [],
          vacuumMapImage: [],
          vacuumMapCamera: [],
          vacuumRooms: [],
          vacuumSensors: [],
          historyHours: 6,
          maxCards: 5,
        },
      },
    ],
    configVersion: 19,
    sdkVersion: "^1.14.3",
  },
  configSchema,
  /**
   * Nothing to do: the host parses a saved config in zod's strip mode, so the
   * keys of settings that have since been retired are dropped on the way in
   * and everything still in the schema comes through untouched.
   */
  migrate: (config) => config,
  component: RoomBoardWidget,
});
