# Channel logos (picons)

The TV channel logos in `logos/` come from the [picons project](https://github.com/picons/picons)
(`build-source/logos`) and are licensed under the GNU General Public License v3.0 — see
`LICENSE` in this folder. The logos themselves are the trademarks of their channels.

They are **not** part of the card's MIT-licensed code. `scripts/picons.ts` turns them into a
separate file, `dist/room-board-picons.js` (GPL-3.0, with a notice at its top), which the card
loads at runtime the first time it shows a channel. Without that file the card falls back to
its own logos and name wordmarks.

To add a channel, copy its `<name>.light.svg` (the version for dark backgrounds) or
`<name>.default.svg` from the picons repository into `logos/` and run `bun run build`. The
name is the picons' simplified channel name: lowercase, without "HD" and punctuation
("Das Erste HD" → `daserste`).
