import { Show, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { Icon, useService, useWidgetState, z, type EntityView } from "@glasshome/widget-sdk";
import { asType, resolveArtwork } from "./cover";
import { massCover } from "../artwork";
import { MediaGrid, type ActionId, type GridItem } from "./grid";
import { OPENABLE, openContainer, readSearch, toItem, type Level } from "./navigate";
import { useRecents } from "./recents";
import { Keyed } from "./keyed";
import { firstAnswer } from "../async";
import { errorMessage } from "../errors";

/* Every widget runs in the sealed engine from Dash 1.5 on. */
const SEALED = true;

type Row = { label: string; items: GridItem[] };

/**
 * Discover, built from the library rather than from whatever happens to be
 * playing.
 *
 * Music Assistant keeps play counts and last-played timestamps, and
 * `get_library` can order by them — so the rows come from your actual
 * listening history: recently played, most played, newly added, and a random
 * dip into the library. That is a far better answer than seeding from the
 * current track, which only ever showed you more of what was already on.
 *
 * Without Music Assistant there is no library to order, so it falls back to
 * the old behaviour: search seeded from recent plays. Music Assistant's own
 * discover page comes from provider browse endpoints, which need
 * media_player/browse_media — a WebSocket command the widget sandbox does not
 * expose.
 */

/**
 * mass_queue.get_recommendations, when that custom integration is installed.
 *
 * It reaches Music Assistant's own recommendation endpoints, which the core
 * integration does not expose — so it is the real discover page rather than
 * the library re-sorted. Its response shape is not documented anywhere the
 * widget can read, so nothing is assumed about it: the reader walks whatever
 * comes back and takes any array of media items it finds as a shelf, named by
 * the section it sat in. A build that returns a different shape still shows
 * its rows instead of an error.
 */
/** Media items arrive with the image sometimes nested and the name sometimes
 *  spelled `title`; toItem wants both flat and both present. */
function normaliseItem(raw: any, place?: { player: string; at: string }): any {
  const uri = typeof raw.uri === "string" ? raw.uri : (raw.media_id ?? raw.item_id);
  /* The cover comes from Music Assistant by the item, through the GlassHome
     Artwork integration (src/artwork.ts): the addresses in the reply are on
     other hosts, which the sealed engine refuses, and most items carry none.
     An address is kept only for a dashboard where it would load. */
  const image =
    massCover(typeof uri === "string" ? uri : undefined, place) ??
    [raw.image, raw.image?.path, raw.metadata?.images?.[0]?.path].find(
      (candidate) => typeof candidate === "string" && candidate !== "",
    );

  return {
    ...raw,
    image,
    name: typeof raw.name === "string" ? raw.name : raw.title,
    uri,
  };
}

/** "recently_played" -> "Recently played", for a section with no name. */
function prettify(key: string, fallback: string): string {
  if (!key || key.includes(".")) return fallback;
  const words = key.replaceAll(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : fallback;
}

/**
 * The sections of a recommendations reply.
 *
 * A section is recognised by carrying an `items` array — and that test has to
 * come first, because a section looks exactly like a media item otherwise: it
 * has item_id, name, uri and provider of its own. Reading it as one is what
 * turned Music Assistant's whole home page into a single shelf of folders.
 *
 * The list is fetched from wherever it sits in the reply — the action wraps it
 * under a key today, and has not always — so the first array of sections found
 * within a few levels wins.
 */
function sectionsOf(node: any, depth = 0): any[] {
  if (!node || depth > 3) return [];

  if (Array.isArray(node)) {
    return node.filter((s) => s && typeof s === "object" && Array.isArray(s.items));
  }
  if (typeof node !== "object") return [];

  for (const value of Object.values(node)) {
    const found = sectionsOf(value, depth + 1);
    if (found.length) return found;
  }
  return [];
}

/**
 * One shelf per section, in the order Music Assistant sent them — its home
 * page, not a re-ordering of it. Items are deduped within a shelf but never
 * across them: an album belongs in both "Recently played" and "Recently added
 * albums", and dropping the second copy would empty whole shelves.
 */
/* How much of Music Assistant's home page is shown. Its reply can carry
   twenty-five sections of twenty items: five hundred tiles, built in one go,
   which is more than the sealed engine of Dash 1.5 allows a widget for one
   step, and the widget stopped as Discover opened. */
const MAX_SHELVES = 8;
const MAX_PER_SHELF = 12;

export function readRecommendations(response: unknown, proxy?: string, haBase?: string, player = ""): Row[] {
  const out: Row[] = [];

  for (const [sectionIndex, section] of sectionsOf(response).entries()) {
    if (out.length >= MAX_SHELVES) break;
    const label =
      typeof section.name === "string" && section.name
        ? section.name
        : prettify(String(section.item_id ?? ""), "Recommended");

    const seen = new Set<string>();
    const items = (section.items as any[])
      .map((raw, itemIndex) =>
        toItem(normaliseItem(raw, { player, at: `${sectionIndex}.${itemIndex}` }), proxy, haBase),
      )
      .filter((item): item is GridItem => !!item && !seen.has(item.id) && !!seen.add(item.id));

    // A shelf scrolls sideways, so it carries more than a wrapping grid had
    // room for, but not the whole section (see MAX_SHELVES).
    if (items.length) out.push({ label, items: items.slice(0, MAX_PER_SHELF) });
  }

  return out;
}

/* Suffixed, so a release that changes how the call is made starts from a clean
   slate rather than inheriting a "no" recorded by an older, wronger attempt. */
const RECS_KEY = "mass-queue-recs.4";

/**
 * Only a missing integration is remembered across reloads. Anything else — a
 * rejected field, a momentary failure — is held for the session alone, so a
 * fixed setup lights up on the next refresh instead of staying dark for a day.
 */
let recsFailedThisSession = false;

const actionMissing = (message: string) =>
  /not found|unknown service|unknown action|no such/i.test(message);

/* How long a missing integration is believed. It was believed for ever:
   Discover opened once before mass_queue was installed stayed dark after it
   was, and Try again could not wake it. A day, now — and Try again forgets
   it at once (forget). */
const RULED_OUT_FOR = 24 * 60 * 60 * 1000;

/**
 * What is known about mass_queue, kept in widget state: the time it was last
 * found missing, or 0. It was browser storage, which the sealed engine keeps in
 * memory only and empties on every reload. A hook: call it during setup.
 */
function useRecommendationMemory() {
  const [missingAt, setMissingAt] = useWidgetState<number>(RECS_KEY, z.number(), 0);
  const forgetStored = () => {
    if (untrack(missingAt) !== 0) setMissingAt(0);
  };

  return {
    remember(available: boolean, message = ""): void {
      recsFailedThisSession = !available;
      if (available) forgetStored();
      else if (actionMissing(message)) setMissingAt(Date.now());
    },

    /** Forget any earlier "no", so the next build asks mass_queue afresh. */
    forget(): void {
      recsFailedThisSession = false;
      forgetStored();
    },

    ruledOut(): boolean {
      if (recsFailedThisSession) return true;
      const at = untrack(missingAt);
      if (!at) return false;
      /* Past its day: asked again. */
      if (Date.now() - at > RULED_OUT_FOR) {
        forgetStored();
        return false;
      }
      return true;
    },
  };
}

export function DiscoverPanel(props: {
  player: () => EntityView | undefined;
  artworkProxy: string;
  haBaseUrl: string;
  configEntryId: string;
  lookupArtwork: boolean;
}) {
  const { callService } = useService();
  const { pushRecent } = useRecents();
  const recsMemory = useRecommendationMemory();

  const [rows, setRows] = createSignal<Row[]>([]);
  const [trail, setTrail] = createSignal<Level[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [status, setStatus] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [maDenied, setMaDenied] = createSignal(false);
  /* Why the recommendation rows are absent. Shown under the library rows so a
     silent fallback is not mistaken for mass_queue working. */
  const [recNote, setRecNote] = createSignal<string | undefined>();

  const current = () => trail().at(-1);

  const searchFor = async (
    term: string,
    keepAll = false,
    filterClasses?: string[],
  ): Promise<GridItem[]> => {
    const target = props.player()?.id;
    if (!target) return [];

    const response = await callService(
      "media_player",
      "search_media",
      {
        search_query: term,
        ...(filterClasses?.length ? { media_filter_classes: filterClasses } : {}),
      },
      { entity_id: target },
      { returnResponse: true },
    );

    const root = response as Record<string, any> | undefined;
    const payload = root?.[target] ?? root;
    const list = payload?.result;
    if (!Array.isArray(list)) return [];

    return list.flatMap((raw: any): GridItem[] => {
      const id = raw?.media_content_id;
      const title = raw?.title;
      if (typeof id !== "string" || typeof title !== "string") return [];
      const mediaType = asType(raw.media_class ?? raw.media_content_type);
      // Tracks are the bulk of any result; albums and artists make better rows.
      // A station lookup keeps everything, since a mix can come back typed as
      // either a playlist or a radio stream depending on the provider.
      if (mediaType === "track" && !keepAll) return [];
      return [
        {
          id,
          name: title,
          subtitle: mediaType,
          image: resolveArtwork(
            typeof raw.thumbnail === "string" ? raw.thumbnail : undefined,
            props.artworkProxy,
            props.haBaseUrl,
          ),
          mediaType,
          canOpen: OPENABLE.has(mediaType),
        },
      ];
    });
  };


  /**
   * Recommendations, when mass_queue is installed. Tried against the player
   * first — the integration's actions are queue-scoped — and then domain-wide,
   * since a build that takes no target rejects the entity outright.
   *
   * No config_entry_id either way. The widget's configured entry belongs to
   * music_assistant, and mass_queue validates the field against its own
   * entries, so passing it fails with "not a valid option" — the field is
   * optional and the integration finds its entry without help.
   *
   * A failure is remembered, because the host toasts a failed action call even
   * when the widget swallows the error: without the memory every visit to
   * Discover on a dashboard without mass_queue would raise the same toast
   * again. One success clears it, so installing the integration later still
   * lights the rows up.
   */
  const buildFromRecommendations = async (): Promise<Row[]> => {
    if (recsMemory.ruledOut()) return [];

    // No player, no call: the action requires an entity and would only raise
    // the same validation error every time Discover opened.
    const id = props.player()?.id;
    if (!id) return [];

    /* The player goes in the data as `entity`, not as the call's target —
       "required key not provided at 'entity'" is what the action says to a
       targeted call, because a target arrives as entity_id and it wants a
       field of its own. The targeted form is kept behind it for a build that
       takes one instead. */
    const attempts: { data: Record<string, unknown>; target?: Record<string, unknown> }[] = [
      { data: { entity: id } },
      { data: {}, target: { entity_id: id } },
    ];

    let lastError = "";
    let sawResponse = false;

    const built = await firstAnswer(attempts, async (attempt) => {
      try {
        const response = await callService(
          "mass_queue",
          "get_recommendations",
          attempt.data,
          attempt.target,
          { returnResponse: true },
        );

        sawResponse = true;
        /* Not logged: the sealed engine of Dash 1.5 charges a widget for
           every byte it writes to the console, and this reply runs to tens
           of kilobytes. */

        const rows = readRecommendations(response, props.artworkProxy, props.haBaseUrl, id);
        return rows.length ? { answer: rows } : undefined;
      } catch (err) {
        lastError = errorMessage(err);
        return undefined;
      }
    });
    if (built) {
      recsMemory.remember(true);
      setRecNote(undefined);
      return built;
    }

    recsMemory.remember(false, lastError);
    setRecNote(
      sawResponse
        ? "mass_queue answered but nothing in the reply looked like a media item."
        : lastError || "mass_queue.get_recommendations could not be called.",
    );
    return [];
  };

  /**
   * Fill in the covers the recommendations left empty.
   *
   * Music Assistant hands out artwork per provider, not per item: Apple Music
   * ships an absolute CDN URL and the recommendation carries it, while Plex
   * and library items arrive with image: "" — the picture exists on the
   * server, but this response does not include a path to it, and MA's own
   * image proxy needs that path rather than the item's uri.
   *
   * media_player.search_media does have it. It runs on the media_player grant
   * the widget already holds, returns a thumbnail per hit, and answers with
   * the same provider uris — so a hit can be matched to the item exactly
   * rather than by name alone.
   *
   * It costs one call per cover, which is why it is a setting rather than the
   * default, and why only the items a shelf shows before it is scrolled are
   * looked up. Runs after the rows are already on screen, so the tab does not
   * wait for it.
   */
  /* The bucket music_assistant.search answers each media type in. */
  const BUCKETS: Record<string, string> = {
    artist: "artists",
    album: "albums",
    track: "tracks",
    playlist: "playlists",
    radio: "radio",
    podcast: "podcasts",
  };

  /**
   * Music Assistant's own search, asked for one media type at a time.
   *
   * media_player.search_media takes media_filter_classes to narrow a search,
   * but it is newer than some integrations and a rejected field drops the call
   * back to an unfiltered search — which answers mostly tracks. That is why
   * the first pass filled the track shelves and left every album and artist
   * grey: a query for "Reinkarnation" as an album came back as fifty songs.
   *
   * music_assistant.search takes an explicit media_type list and answers in
   * typed buckets, and it is the same call the drill-down already uses to find
   * an album's tracks — so it is known to work here and known to return
   * artwork. search_media stays as the fallback for a player that is not
   * backed by Music Assistant.
   */
  const [massSearch, setMassSearch] = createSignal(true);

  const lookup = async (item: GridItem): Promise<GridItem[]> => {
    if (massSearch()) {
      try {
        const response = await callService(
          "music_assistant",
          "search",
          {
            ...(props.configEntryId ? { config_entry_id: props.configEntryId } : {}),
            name: item.name,
            media_type: [item.mediaType],
            limit: 5,
          },
          // Domain-wide: a media_player target would be checked against the
          // music_assistant grant's domain and never match.
          undefined,
          { returnResponse: true },
        );

        const bucket = BUCKETS[item.mediaType] ?? `${item.mediaType}s`;
        const hits = readSearch(response, [bucket], props.artworkProxy, props.haBaseUrl);
        if (hits.length) return hits;
      } catch {
        setMassSearch(false);
      }
    }
    return searchFor(item.name, true).catch(() => []);
  };

  /**
   * Fill a shelf's covers when the shelf is about to be seen.
   *
   * The first version looked up a fixed budget across the whole tab, and the
   * budget ran out five shelves in: everything below it stayed grey no matter
   * how high the number went, and raising it just moved the boundary while
   * spending more calls on shelves nobody scrolled to. Doing it per shelf, on
   * approach, removes the cap altogether — the work is proportional to what is
   * actually looked at, and a tab that is opened and closed costs one shelf.
   */
  const filledRows = new Set<string>();

  const fillRow = async (label: string) => {
    /* Not in the sealed engine of Dash 1.5, which is every dashboard now: the
       covers the lookups find are Music Assistant's and the providers' own
       addresses, which it refuses to load, so each lookup was a service call
       and a step of work for a picture that could never show. */
    if (SEALED) return;
    if (!props.lookupArtwork || filledRows.has(label) || !props.player()?.id) return;
    filledRows.add(label);

    const row = rows().find((r) => r.label === label);
    if (!row) return;

    const wanted = row.items.filter((item) => !item.image);
    if (!wanted.length) return;

    const found = new Map<string, string>();
    const queue = [...wanted];

    /* The item's own cover among what the lookup found: itself by id, or
       the same kind of thing by the same name. */
    const coverFor = async (item: GridItem) => {
      const hits = await lookup(item);
      const exact = hits.find((h) => h.id === item.id);
      const byName = hits.find(
        (h) => h.mediaType === item.mediaType && h.name.toLowerCase() === item.name.toLowerCase(),
      );
      const image = (exact ?? byName)?.image;
      if (image) found.set(item.id, image);
    };

    /* Four lookups out at once, no more: each worker takes the next item
       when its own is answered, until the shelf is done. */
    const worker = async (): Promise<void> => {
      const item = queue.shift();
      if (!item) return;
      await coverFor(item);
      return worker();
    };

    await Promise.all(Array.from({ length: 4 }, worker));
    if (!found.size) return;

    setRows((prev) =>
      prev.map((r) =>
        r.label === label
          ? {
              ...r,
              items: r.items.map((item) =>
                item.image || !found.has(item.id) ? item : { ...item, image: found.get(item.id) },
              ),
            }
          : r,
      ),
    );
  };

  /* One observer for every shelf. The margin starts the lookups while the
     shelf is still a screen away, so the covers are usually there by the time
     it is scrolled to rather than appearing under the reader's eyes. */
  let shelfObserver: IntersectionObserver | undefined;
  const shelfLabels = new WeakMap<Element, string>();

  const observeShelf = (el: HTMLElement, label: string) => {
    if (typeof IntersectionObserver === "undefined") {
      void fillRow(label);
      return;
    }

    shelfLabels.set(el, label);
    shelfObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          shelfObserver?.unobserve(entry.target);
          const name = shelfLabels.get(entry.target);
          if (name) void fillRow(name);
        }
      },
      { rootMargin: "600px 0px" },
    );
    shelfObserver.observe(el);
  };

  onCleanup(() => shelfObserver?.disconnect());

  const build = async () => {
    setLoading(true);
    setStatus(null);
    try {
      /* mass_queue's recommendations are Music Assistant's own home page — its
         sections, its ordering, its mix of podcasts, playlists and albums.
         They are the tab.
       *
       * There used to be a stand-in below this: library shelves, provider
       * stations, and rows seeded from whatever had been played. It was a
       * worse home page wearing the same clothes, and because it filled the
       * tab silently there was no way to tell a working setup from a missing
       * integration. The tab now shows Music Assistant's own recommendations
       * or says plainly what provides them. */
      const recommended = await buildFromRecommendations().catch(() => [] as Row[]);
      /* Two shelves at once and the rest one by one, a moment apart: built in
         one go they were more work than one step of the sealed engine may do,
         and the pause between them lets its budget refill. */
      setRows(recommended.slice(0, 2));
      for (let shown = 2; shown < recommended.length; shown++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (disposed) return;
        setRows(recommended.slice(0, shown + 1));
      }
      // Covers are filled per shelf as each comes into view — see fillRow.
      filledRows.clear();
    } catch (err) {
      setStatus({
        text: errorMessage(err, "Could not build suggestions"),
        error: true,
      });
    } finally {
      setLoading(false);
    }
  };

  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  onMount(() => void build());

  const open = async (item: GridItem) => {
    setLoading(true);
    setStatus(null);
    try {
      const items = await openContainer(callService, item, props.configEntryId, props.artworkProxy, props.haBaseUrl);
      if (!items.length) {
        setStatus({ text: `Nothing found inside "${item.name}"`, error: true });
        return;
      }
      setTrail((t) => [...t, { title: item.name, items, parent: item }]);
    } catch (err) {
      const message = errorMessage(err);
      if (/CAPABILITY_DENIED|not covered by/i.test(message)) setMaDenied(true);
      setStatus({ text: message, error: true });
    } finally {
      setLoading(false);
    }
  };

  const run = async (item: GridItem, action: ActionId) => {
    const target = props.player()?.id;
    if (!target) return;
    setStatus(null);
    try {
      if (action === "radio") {
        await callService(
          "music_assistant",
          "play_media",
          { media_id: item.id, enqueue: "replace", radio_mode: true },
          { entity_id: target },
        );
      } else {
        await callService(
          "media_player",
          "play_media",
          { media_content_id: item.id, media_content_type: "music", enqueue: action },
          { entity_id: target },
        );
      }
      pushRecent(target, {
        name: item.name,
        subtitle: item.subtitle,
        image: item.image,
        mediaType: item.mediaType,
        mediaId: item.id,
      });
      setStatus({ text: `${item.name} — ${action}` });
    } catch (err) {
      const message = errorMessage(err, "Playback failed");
      if (/CAPABILITY_DENIED|not covered by/i.test(message)) setMaDenied(true);
      setStatus({ text: message, error: true });
    }
  };

  return (
    <div class="mp-panel">
      <Show when={trail().length}>
        {/* Titled the way a shelf is, so opening one does not drop you into a
            differently-styled view: the container's name is the heading, with
            its type above it and Play all beside it. */}
        <div class="mp-crumb">
          <button
            class="mp-btn mp-btn--ghost mp-btn--sm"
            aria-label="Back"
            onClick={() => setTrail((t) => t.slice(0, -1))}
          >
            <Icon icon="mdi:arrow-left" width="18" />
          </button>
          <div class="mp-flex1">
            <div class="mp-label">{current()!.parent?.mediaType ?? "Browsing"}</div>
            <h3 class="mp-shelf-title mp-crumb-title mp-truncate">{current()!.title}</h3>
          </div>
          <Show when={current()!.parent}>
            <button class="mp-pill" onClick={() => run(current()!.parent!, "play")}>
              Play all
            </button>
          </Show>
        </div>

        <MediaGrid
          items={current()!.items}
          onAction={run}
          onOpen={open}
          radioDisabled={maDenied()}
          layout="large"
        />
      </Show>

      <Show when={!trail().length}>
        {/* Keyed on the shelf's name: filling a shelf's covers replaces the
            shelf, and a list keyed on the row object rebuilt it — every cover
            reloading — each time one scrolled into view. */}
        <Keyed each={rows()} by={(row) => row.label}>
          {(row) => (
            <div class="mp-shelf-row" ref={(el) => observeShelf(el, row.label)}>
              <h3 class="mp-shelf-title">{row.label}</h3>
              <MediaGrid
                items={row.items}
                onAction={run}
                onOpen={open}
                radioDisabled={maDenied()}
                layout="shelf"
              />
            </div>
          )}
        </Keyed>

        <Show when={loading()}>
          <div class="mp-empty">Looking for something you might like…</div>
        </Show>

        {/* Nothing to show means one thing now: the integration that provides
            these shelves is not answering. Saying so is more use than filling
            the tab with a stand-in nobody asked for. */}
        <Show when={!loading() && !rows().length}>
          <div class="mp-setup">
            <Icon icon="mdi:playlist-music-outline" width="26" />
            <h3>Discover comes from mass_queue</h3>
            <p>
              Music Assistant's own recommendations — its home page, its ordering —
              are served by the <b>mass_queue</b> custom integration. Install it in
              Home Assistant and set it up for this player, and these shelves fill
              themselves.
            </p>
            <Show when={recNote()}>
              <p class="mp-setup-why">{recNote()}</p>
            </Show>
            {/* Asks mass_queue again whatever was concluded before: the
                point of the button is that something has changed. */}
            <button
              class="mp-action"
              onClick={() => {
                recsMemory.forget();
                void build();
              }}
            >
              <Icon icon="mdi:refresh" width="17" />Try again
            </button>
          </div>
        </Show>

        <Show when={!loading() && rows().length}>
          <button class="mp-action" onClick={build}>
            <Icon icon="mdi:refresh" width="17" />Refresh suggestions
          </button>
        </Show>
      </Show>

      <Show when={status()}>
        <div class="mp-status" data-error={!!status()!.error}>
          <Icon
            icon={status()!.error ? "mdi:alert-circle-outline" : "mdi:check-circle-outline"}
            width="16"
          />
          <span>{status()!.text}</span>
        </div>
      </Show>
    </div>
  );
}
