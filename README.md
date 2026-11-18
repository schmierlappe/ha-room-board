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

  To keep them on the desktop and hide them only on the tablet, use `hide_sidebar` / `hide_header` in kiosk-mode's per-user or per-entity settings instead, or open the dashboard with `?kiosk` in its address on the tablet. Without the sidebar there is no menu on that screen: keep a way back to Home Assistant's settings in mind, such as the address without `?kiosk`.
- **Android's status and navigation bars:** in the Home Assistant Companion app, Settings → Companion app → turn on **Full screen** (it may sit under *Other settings*, depending on the app's version).

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
| `height` | full screen | The board's height, e.g. `800px`. On a panel view it fills the screen. |
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
