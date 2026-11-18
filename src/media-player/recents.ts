import { useWidgetState, z } from "@glasshome/widget-sdk";
import { untrack } from "solid-js";
import type { MediaType } from "./cover";

export type RecentItem = {
  name: string;
  subtitle?: string;
  image?: string;
  mediaType: MediaType;
  mediaId: string;
};

type Store = Record<string, RecentItem[]>;

const LIMIT = 8;

const storeSchema = z.record(
  z.string(),
  z.array(
    z.object({
      name: z.string(),
      subtitle: z.string().optional(),
      image: z.string().optional(),
      mediaType: z.custom<MediaType>((v) => typeof v === "string"),
      mediaId: z.string(),
    }),
  ),
);

const withoutImages = (items: RecentItem[]): RecentItem[] =>
  items.map(({ image: _image, ...rest }) => rest);

/**
 * The recently played rail, kept in widget state so it survives a reload: for
 * this widget on its board and this person. It was browser storage, which the
 * sealed engine keeps in memory only and empties on every reload.
 *
 * Call it while a panel is set up, like any hook. Every panel of one widget
 * reads the same value, so a play in Browse shows up in Search at once.
 */
export function useRecents() {
  const [store, setStore] = useWidgetState<Store>("recents", storeSchema, {});

  /* A value may hold 8 KB. Several players' rails with long picture URLs can
     outgrow that, so a refused write falls back to this player's rail alone,
     and then to that rail without its pictures. */
  const persist = (next: Store, playerId: string) => {
    if (setStore(next) === "ok") return;
    const own = next[playerId];
    if (!own) return;
    if (setStore({ [playerId]: own }) === "ok") return;
    setStore({ [playerId]: withoutImages(own) });
  };

  const recentsFor = (playerId: string): RecentItem[] => store()[playerId] ?? [];

  const pushRecent = (playerId: string, item: RecentItem) => {
    if (!playerId || !item.mediaId) return;
    const s = untrack(store);
    persist(
      {
        ...s,
        [playerId]: [item, ...(s[playerId] ?? []).filter((x) => x.mediaId !== item.mediaId)].slice(
          0,
          LIMIT,
        ),
      },
      playerId,
    );
  };

  const clearRecents = (playerId: string) => {
    const next = { ...untrack(store) };
    delete next[playerId];
    setStore(next);
  };

  return { recentsFor, pushRecent, clearRecents };
}
