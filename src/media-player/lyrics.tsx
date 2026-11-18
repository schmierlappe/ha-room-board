import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { Dynamic } from "solid-js/web";
import { replaceEnclosed } from "../text";
import { firstAnswer } from "../async";

/**
 * Lyrics, from LRCLIB (lrclib.net): an open database of song lyrics, most of
 * them synced to the line, asked by artist, title, album and length — no key,
 * no account. Home Assistant's players carry no lyrics of their own.
 *
 * Asked through the artwork proxy first, as the board's other third-party
 * requests are (the dashboard's content policy keeps it off other hosts), and
 * straight to LRCLIB only if there is no proxy or it will not have it. A song
 * is asked once per session; one with no lyrics is remembered as such.
 */

export type LyricLine = { at?: number; text: string };
export type Lyrics = { synced: boolean; lines: LyricLine[] };

const cache = new Map<string, Promise<Lyrics | undefined>>();

/** Seconds the highlighted line runs ahead of the player's reported position. */
const LEAD = 1;

/** "[01:23.45] words" → seconds and words; a blank line is kept as a pause. */
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = replaceEnclosed(raw, "[", "]").trim();
    for (const stamp of stamps) lines.push({ at: Number(stamp[1]) * 60 + Number(stamp[2]), text });
  }
  lines.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return lines;
}

function readAnswer(data: any): Lyrics | undefined {
  const item = Array.isArray(data) ? data.find((d) => d?.syncedLyrics || d?.plainLyrics) : data;
  if (!item || item.instrumental) return undefined;
  if (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) {
    const lines = parseLrc(item.syncedLyrics);
    if (lines.length) return { synced: true, lines };
  }
  if (typeof item.plainLyrics === "string" && item.plainLyrics.trim()) {
    return {
      synced: false,
      lines: item.plainLyrics.split(/\r?\n/).map((text: string) => ({ text: text.trim() })),
    };
  }
  return undefined;
}

async function ask(path: string, proxy: string): Promise<any> {
  const urls = [
    ...(proxy.includes("{hostpath}") ? [proxy.replace("{hostpath}", path)] : []),
    `https://${path}`,
  ];
  return firstAnswer(urls, async (url) => {
    try {
      const response = await fetch(url);
      /* Not found is an answer: there are no lyrics, whichever way is asked. */
      if (response.status === 404) return { answer: undefined };
      if (!response.ok) return undefined;
      return { answer: await response.json() };
    } catch {
      // The other way round, if there is one.
      return undefined;
    }
  });
}

export function fetchLyrics(
  track: { title: string; artist: string; album?: string; duration?: number },
  proxy = "",
): Promise<Lyrics | undefined> {
  const key = `${track.artist}|${track.title}|${track.album ?? ""}`.toLowerCase();
  const known = cache.get(key);
  if (known) return known;

  const query = new URLSearchParams({ artist_name: track.artist, track_name: track.title });
  if (track.album) query.set("album_name", track.album);
  if (track.duration) query.set("duration", String(Math.round(track.duration)));

  const found = (async () => {
    const exact = readAnswer(await ask(`lrclib.net/api/get?${query}`, proxy));
    if (exact) return exact;
    /* Not matched exactly — an album named differently, a length a second
       out: the search, and its best hit with lyrics. */
    const search = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
    return readAnswer(await ask(`lrclib.net/api/search?${search}`, proxy));
  })();
  cache.set(key, found);
  return found;
}

/**
 * The lyrics column: every line faded by its distance from the one being
 * sung, which is bright and a little larger and held a third of the way down
 * as the song moves. A line is a place in the song — tapping it seeks there.
 * Unsynced lyrics drift down with the song's progress instead.
 */
export function LyricsView(props: {
  lyrics: Lyrics;
  position: () => number | undefined;
  duration: () => number | undefined;
  onSeek?: (seconds: number) => void;
}) {
  let box: HTMLDivElement | undefined;
  const [offset, setOffset] = createSignal(0);

  const current = createMemo(() => {
    if (!props.lyrics.synced) return -1;
    /* A little ahead of the reported position: Home Assistant's lags the
       sound itself, and a line lit as it is already being sung reads late. */
    const now = (props.position() ?? 0) + LEAD;
    let at = -1;
    props.lyrics.lines.forEach((line, i) => {
      if ((line.at ?? 0) <= now) at = i;
    });
    return at;
  });

  const seekable = (line: LyricLine) => line.at !== undefined && !!props.onSeek;

  /* Kept a third of the way down: the line's own place, measured. */
  const follow = () => {
    if (!box) return;
    const rows = box.querySelectorAll<HTMLElement>(".mp-lyric");
    if (props.lyrics.synced) {
      const row = rows[Math.max(0, current())];
      if (!row) return;
      setOffset(Math.max(0, row.offsetTop - box.clientHeight * 0.34));
    } else {
      const total = (box.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
      const share = (props.position() ?? 0) / Math.max(1, props.duration() ?? 1);
      setOffset(Math.max(0, (total - box.clientHeight * 0.6) * Math.min(1, share)));
    }
  };

  createEffect(on([current, () => props.lyrics], () => requestAnimationFrame(follow)));
  if (!props.lyrics.synced) {
    const timer = setInterval(follow, 1000);
    onCleanup(() => clearInterval(timer));
  }

  return (
    <div ref={box} class="mp-lyrics" data-synced={props.lyrics.synced}>
      <div class="mp-lyrics-track" style={{ transform: `translateY(${-offset()}px)` }}>
        <For each={props.lyrics.lines}>
          {(line, i) => (
            /* A line with a time is a button that plays from it. */
            <Dynamic
              component={seekable(line) ? "button" : "p"}
              type={seekable(line) ? "button" : undefined}
              class="mp-lyric"
              data-now={i() === current()}
              data-past={props.lyrics.synced && i() < current()}
              style={{
                "--far": `${props.lyrics.synced ? Math.min(4, Math.abs(i() - current())) : 0}`,
              }}
              onClick={seekable(line) ? () => props.onSeek!(line.at!) : undefined}
            >
              <Show when={line.text} fallback={<span class="mp-lyric-pause">♪</span>}>
                {line.text}
              </Show>
            </Dynamic>
          )}
        </For>
      </div>
    </div>
  );
}
