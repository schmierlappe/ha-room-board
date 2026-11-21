import { artSrc, entityPicture } from "../artwork";
import { Show, createMemo } from "solid-js";
import { Icon } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
/* The media player's own artwork resolver: a poster is a cover by another
   name, and it has the same two problems — an origin-relative path that needs
   Home Assistant, and an absolute one the dashboard will not load without the
   proxy. */
import { resolveArtwork } from "../media-player/cover";
import { openable, sinceLabel } from "./util";
import { Keyed } from "./keyed";
import { Half } from "./half";

/**
 * What a "recently added" sensor publishes.
 *
 * The Upcoming Media Card schema, which the Plex Recently Added integration
 * and half a dozen others speak: one attribute called `data`, whose first
 * entry is the card's own template configuration and whose remaining entries
 * are the items. Recognising the shape rather than the entity id is what lets
 * the card find it without being told.
 */
export type Media = {
  id: string;
  title: string;
  line1: string;
  line2: string;
  poster?: string;
  /** The wide still, where the library has one — a card is not poster-shaped. */
  fanart?: string;
  added?: Date;
  /** The integration's own "new" marker. */
  flag: boolean;
};

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function looksLikePlex(entity: EntityView | undefined): boolean {
  if (entity?.domain !== "sensor") return false;
  const data = entity.attributes?.data;
  return (
    Array.isArray(data) &&
    data.length > 1 &&
    typeof data[0] === "object" &&
    data[0] !== null &&
    "title_default" in (data[0] as Record<string, unknown>)
  );
}

export function mediaOf(
  entity: EntityView | undefined,
  opts: { proxy?: string; haBase?: string } = {},
): Media[] {
  const data = entity?.attributes?.data;
  if (!Array.isArray(data)) return [];

  return data
    .slice(1)
    .map((raw: any, index: number): Media | undefined => {
      if (!raw || typeof raw !== "object") return undefined;
      const title = str(raw.title);
      if (!title) return undefined;

      /* A series names the episode, a film names its year — the second line
         is whichever of those the item actually has. */
      const episode = str(raw.episode);
      const number = str(raw.number);
      const aired = str(raw.aired) || str(raw.release);
      const runtime = typeof raw.runtime === "number" ? `${raw.runtime} min` : "";

      const when = str(raw.airdate);
      const added = when ? new Date(when) : undefined;

      return {
        id: `${title}-${number || aired || index}`,
        title,
        line1: episode || aired || str(raw.studio),
        line2: [number, runtime || str(raw.studio)].filter(Boolean).join(" · "),
        /* The sensor's posters are signed paths on Home Assistant that the
           dashboard's media proxy does not serve: Home Assistant fetches them
           by their place in the sensor (src/artwork.ts). The list starts
           after the sensor's own defaults, hence index + 1. */
        poster:
          resolveArtwork(str(raw.poster) || undefined, opts.proxy, opts.haBase) ??
          (str(raw.poster) ? entityPicture(entity?.id, index + 1, "poster") : undefined),
        fanart:
          resolveArtwork(str(raw.fanart) || undefined, opts.proxy, opts.haBase) ??
          (str(raw.fanart) ? entityPicture(entity?.id, index + 1, "fanart") : undefined),
        added: added && Number.isFinite(added.getTime()) ? added : undefined,
        flag: raw.flag === true,
      };
    })
    .filter(Boolean) as Media[];
}


/**
 * The board card: the newest thing, at the size of the card.
 *
 * A row of thumbnails was a contact sheet — six posters too small to read and
 * none of them the point. What the card is actually answering is "what landed
 * last", so that one takes the whole tile: its own artwork behind, its name
 * over it, and the rest of the shelf reduced to a count you can tap.
 */
export function PlexCard(props: { entity: EntityView; items: Media[]; onOpen: () => void }) {
  const lead = createMemo(() => props.items[0]);
  /* The wide still if the library has one, the poster if not: a poster
     stretched across a landscape card is mostly somebody's chin. */
  const art = () => artSrc(lead()?.fanart, 320) || artSrc(lead()?.poster, 320);

  return (
    <article class="rb-card rb-card--plex" {...openable(props.onOpen, "Plex")}>
      <Show when={art()}>
        <div class="rb-plex-bg" style={{ "background-image": `url("${art()}")` }} />
        <div class="rb-plex-scrim" />
      </Show>

      <header class="rb-card-head">
        <div class="rb-card-titles">
          <h3 class="rb-card-name rb-truncate">
            {props.entity.friendlyName ?? "Recently added"}
          </h3>
        </div>

        <Show when={props.items.length > 1}>
          <span class="rb-plex-count">+{props.items.length - 1} more</span>
        </Show>
      </header>

      <Show
        when={lead()}
        fallback={<p class="rb-act-none">Nothing has been added lately.</p>}
      >
        <div class="rb-plex-lead">
          {/* The poster beside the title, small: it is what the thing looks
              like on a shelf, and the still behind is what it looks like. */}
          <Show when={artSrc(lead()!.poster)}>
            {(poster) => <img class="rb-plex-lead-art" src={poster()} alt="" decoding="async" />}
          </Show>

          <div class="rb-plex-lead-meta">
            <Show when={lead()!.flag}>
              <span class="rb-plex-new">New</span>
            </Show>

            <span class="rb-plex-lead-title rb-truncate">{lead()!.title}</span>

            <Show when={lead()!.line1}>
              <span class="rb-plex-lead-sub rb-truncate">{lead()!.line1}</span>
            </Show>

            <span class="rb-plex-lead-foot rb-truncate">
              {[lead()!.line2, lead()!.added ? `added ${sinceLabel(lead()!.added)}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      </Show>
      <Half art={art() ? <img class="rb-half-poster" src={art()} alt="" /> : undefined} icon="mdi:plex" name={lead()?.title ?? "Plex"} status={lead()?.line1 || "Recently added"} tone="#e5a00d" value={props.items.length > 1 ? `+${props.items.length - 1}` : undefined} />
    </article>
  );
}

/** The overlay: the whole shelf, with what each thing is. */
export function PlexPanel(props: { entity: EntityView; items: Media[] }) {
  return (
    <div class="rb-plex-panel">
      <Show
        when={props.items.length}
        fallback={<p class="rb-act-none">Nothing has been added lately.</p>}
      >
        <div class="rb-plex-grid">
          {/* Keyed on the item: the shelf is read afresh on every update from
              anything in the room, and a list keyed on those new objects
              rebuilt every card — every poster reloading — each time. */}
          <Keyed each={props.items}>
            {(item) => (
              <div class="rb-plex-card">
                <div class="rb-plex-art">
                  <Show
                    when={artSrc(item.poster)}
                    fallback={
                      <span class="rb-plex-blank">
                        <Icon icon="mdi:movie-open-outline" width="22" />
                      </span>
                    }
                  >
                    {(poster) => <img src={poster()} alt="" loading="lazy" decoding="async" />}
                  </Show>
                  <Show when={item.flag}>
                    <span class="rb-plex-new">New</span>
                  </Show>
                </div>

                <span class="rb-plex-title rb-truncate">{item.title}</span>
                <Show when={item.line1}>
                  <span class="rb-plex-sub rb-truncate">{item.line1}</span>
                </Show>
                <Show when={item.line2 || item.added}>
                  <span class="rb-plex-meta rb-truncate">
                    {[item.line2, item.added ? `added ${sinceLabel(item.added)}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Show>
              </div>
            )}
          </Keyed>
        </div>
      </Show>
    </div>
  );
}
