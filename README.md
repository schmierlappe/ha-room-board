# Room Board

A Home Assistant card for a room at a glance: its photo and a clock on one side, and on the other everything the room measures and controls — climate with its history, lights, blinds, switches, media, the vacuum, locks, cameras, the calendar, the weather and what changed last. Made for a wall tablet, and just as much at home on a desktop browser and a phone.

> **Status: early.** Room Board started as a widget for the GlassHome dashboard and now runs as a Home Assistant card. The board itself is the same; the card around it is new. Expect rough edges, and please open an issue when something looks or behaves wrong.

## Requirements

- Home Assistant 2024.1 or newer
- Areas set up in Home Assistant, with your devices in them: the board shows a room by its area

## Install

### HACS

1. HACS → three-dot menu → **Custom repositories**
2. Add `https://github.com/schmierlappe/ha-room-board`, category **Dashboard**
3. Find **Room Board** in HACS and install it
4. Hard-refresh your browser

### Manual

Copy `dist/room-board-card.js` to `/config/www/community/ha-room-board/`, then add the resource under Settings → Dashboards → three-dot menu → **Resources**:

```
/local/community/ha-room-board/room-board-card.js
```

as a **JavaScript module**.

## Set up a board

The board wants the whole screen. Give it a dashboard of its own with one view of type **Panel**:

1. Settings → Dashboards → **Add dashboard** → *New dashboard from scratch*, e.g. "Room Board"
2. Open it, three-dot menu → **Edit dashboard** → three-dot menu → **Raw configuration editor**
3. Paste, and change the areas to yours:

```yaml
views:
  - title: Room Board
    type: panel
    cards:
      - type: custom:room-board-card
        rooms:
          - kind: room
            area: living_room
            label: Living Room
            icon: mdi:sofa
          - kind: room
            area: kitchen
            label: Kitchen
            icon: mdi:silverware-fork-knife
```

To open it straight away on a device — the tablet on the wall, your phone — pick it under your profile → **Browser settings** → **Dashboard**.

### Full screen on a tablet or phone

The board fills the screen below whatever Home Assistant shows above it. For the whole screen:

- **Home Assistant's sidebar and header:** install [kiosk-mode](https://github.com/NemesisRE/kiosk-mode) from HACS (category Dashboard) and add to the top of the board's dashboard (Raw configuration editor):

  ```yaml
  kiosk_mode:
    kiosk: true
  ```

  To keep them on the desktop and hide them only on the tablet, use `hide_sidebar` / `hide_header` in kiosk-mode's per-user or per-entity settings instead, or open the dashboard with `?kiosk` in its address on the tablet. Without the sidebar the board keeps a way back: open the board's menu (☰ on the photo), and **Home Assistant** at its top opens the sidebar — under kiosk-mode it reloads the page with `?disable_km`, which shows the header and sidebar until the next reload.
- **Android's status and navigation bars:** in the Home Assistant Companion app, Settings → Companion app → turn on **Full screen** (it may sit under *Other settings*, depending on the app's version).

### Portrait screens

On a screen taller than it is wide — a wall display such as the Shelly Wall Display, or a tablet stood upright — the board lays itself out as on a phone: the room's photo across the top, the cards below it, as many columns as keep each tile about a phone's size (three or four), and the activity at the foot. Landscape screens keep the side-by-side layout.

### Arranging cards

**Arrange** in the Overview line lets you move cards, remove them, and pick a size for each. Drag a card onto another to put it there: with a mouse just drag it, on a touch screen hold it for a moment and then drag (a quick swipe still scrolls). The arrows move a card one place at a time. Sizes:

- **Small** (1×1), **Wide** (2×1), **Tall** (1×2), **Big** (2×2).
- **16:9** (3×2): bigger than the big square, in a picture's shape. Good for the player, a camera, the weather or the reading that matters most.

On a two-column phone, 16:9 takes the full width and is drawn like Big. Phones (and portrait screens) also get **Half** (½ tile): one column wide and half a tile high, so two stack in the space of one small tile — every card type shows its icon, its name, one line of status and its switch or reading; the media card becomes a strip with the cover, the title, play and the volume.

### A layout for each screen

Each screen keeps its own layout: arrange or hide cards on your phone and the tablet and wall display stay as they are. A screen you haven't changed shows the shared layout (on a board from before this, the layout you already had). The ☰ menu says which one a screen is showing, and once it has its own:

- **Use for new:** screens that haven't been changed yet start from this layout.
- **Reset:** forget this screen's layout and go back to the shared one.

Each is kept in Home Assistant under your user, and the screen is recognised by its browser. Clearing the browser's or the Companion app's data makes it a new screen, which starts from the shared layout. Set `layout_per_device: false` for one layout on every screen, as before.

### Match bar on game day

On a phone, on the day a team you follow with [TeamTracker](https://github.com/vasqued2/ha-teamtracker) plays, the match is docked at the foot of the screen in every room, above the activity line. It shows the kick-off time before the match, the live score and minute during it (the score flashes when a goal goes in), and the result afterwards until midnight. Tap it for the matchday, table and news. If two teams play on the same day, a live match comes first. Set `matchBar: false` to leave it out.

### TV channel logos

A receiver's channels (a Vu+ or any Enigma2 box) show their logos in the favourites, the remote's channel list and on the player while a channel is on. They come from the [picons project](https://github.com/picons/picons) in a separate file, `room-board-picons.js` (GPL-3.0), that HACS installs beside the card and that is loaded only when a channel is shown. Where it is missing beside the card, the card loads the same file for its version from this repository through jsDelivr. Channels without a picon keep a logo or their name on the channel's colour. See `picons/README.md` to add more.

### Guest Wi-Fi on a tablet

On a tablet (a touch screen with the photo beside the cards), the guest Wi-Fi's QR code sits on the room photo above the room picker, with the network's name. Guests scan it with their phone to join; a tap makes it bigger. It uses UniFi's guest QR code image (`image.…_guest_qr_code`) by itself; pick another image with `wifiQr`, or turn it off with `wifiQrShow: false`. Phones and desktops don't show it.

### Updates

When Home Assistant has updates waiting (Home Assistant itself, add-ons, HACS, integrations, device firmware), an **Updates** button with their number appears in the Overview line beside Arrange. On a phone it's a row in the bar at the foot, above the activity line, naming what is waiting. Either opens a list with each one's installed and new version, its release notes ("What's new"), and an **Update** button. Updates that can make a backup first (Home Assistant and its add-ons) do so unless you switch it off for that one. **Skip** hides that version, and **Update all** installs every one. Update, Update all and Skip each need a second tap. A running install shows its progress. Set `updates: false` to leave it out.

### Network, servers and monitors

Four cards appear by themselves where they belong:

- **Network (UniFi):** in a room whose area holds UniFi devices, or whose name says *server*, *rack*, *network* or *unifi*. The gateway's throughput (or your speed test's), its load, clients and latency; tap for every device and Wi-Fi network.
- **Proxmox:** in a room whose area holds Proxmox VE devices, or whose name says *server*, *rack* or *proxmox*. The nodes and their guests; tap for the whole cluster.
- **Uptime Kuma:** the monitors in the room's area. A room with *server* in its name shows every monitor in the house in the activity column (on a phone, as a bar at the foot), the trouble first; tap for all of them, grouped by their Uptime Kuma tags.

- **Synology:** in a room whose area holds a Synology NAS, or whose name says *server*, *rack*, *nas* or *storage*. Each NAS as a small front panel: its drive bays with a light each, its volume's fill and its load; tap for the volumes, every drive's temperature and health, and Restart, Shut down and the fan mode.

They use Home Assistant's own [UniFi Network](https://www.home-assistant.io/integrations/unifi/), [Proxmox VE](https://www.home-assistant.io/integrations/proxmoxve/), [Uptime Kuma](https://www.home-assistant.io/integrations/uptime_kuma/) and [Synology DSM](https://www.home-assistant.io/integrations/synology_dsm/) integrations; nothing to configure on the card.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `rooms` | `[]` | The rooms, each `kind: room` with an `area` (its area id), and optionally `label`, `icon` and `image` (a photo, e.g. `/local/rooms/living.jpg`; without one, the area's own picture from Home Assistant is used). The room picker at the foot of the photo switches between them. |
| `subtitle` | `My Home` | A line under the room's name. |
| `clock` | `24h` | `24h`, `12h` or `off`: the clock on the photo. |
| `clockStyle` | `bold` | `bold`, `thin`, `hairline`, `mono`, `frosted` or `gradient`: how the digits look. |
| `people` | `[]` | `person` entities shown on the board. |
| `historyHours` | `6` | How many hours the charts show. |
| `maxCards` | `5` | How many readings the board shows before it folds the rest. |
| `musicAssistant` | `true` | Music Assistant's search, queue and library in the media popup. |
| `vacuumMapImage` / `vacuumMapCamera` | | The vacuum's map, where it is not found by itself. |
| `vacuumRooms` | `[]` | The vacuum's rooms, for cleaning one. |
| `vacuumSensors` | `[]` | Consumable sensors (filter, brushes) for the vacuum card. |
| `theme` | `aurora` | `aurora`: the board's own look — soft glows of colour drifting behind frosted glass, in dark and light following Home Assistant's dark-mode setting. `home_assistant`: the colours of your Home Assistant theme. |
| `statusBar` | `visible` | `hidden` when the phone shows no status bar (the Home Assistant app's full-screen mode): the clock, date and temperature move up to the very top of the screen. |
| `height` | full screen | The board's height, e.g. `800px`. On a panel view it fills the screen. |
| `wifiQr` | auto | The image entity with the Wi-Fi QR code; empty finds UniFi's guest QR code. |
| `wifiQrShow` | `true` | Show the Wi-Fi QR code on tablets. |
| `matchBar` | `true` | On a phone, a TeamTracker team's match docked at the foot on game day, with the live score. |
| `updates` | `true` | An Updates button beside Arrange (on a phone, a row in the bar at the foot) when updates are waiting, with a list to install them. |
| `layout_per_device` | `true` | Each screen keeps its own arrangement and hidden cards. `false`: one layout for every screen. |
| `storage_key` | | Name for this board's saved layout; set it when you have more than one board. |

What you change on the board itself — the cards hidden in a room, their order and their sizes — is saved for your Home Assistant user, so it is the same on every device you sign in on.

## Development

```bash
bun install
bun run build   # typecheck and dist/room-board-card.js
```

The board is SolidJS. It imports the GlassHome widget SDK's API, which `vite.config.ts` points at `src/ha/sdk.tsx`: the same functions on Home Assistant's `hass` object. `src/card.tsx` is the card element.

## License

MIT, see [LICENSE](LICENSE). The card contains SolidJS, zod, Tailwind CSS's base styles and parts of @glasshome/widget-sdk (all MIT), and the Geist font (SIL Open Font License 1.1): see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Room Board is an independent project, not affiliated with or endorsed by GlassHome, Home Assistant, ESPN, Plex or any other service it shows. The football card's details come from ESPN's public website data, for personal use.
