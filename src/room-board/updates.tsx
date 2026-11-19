import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useService } from "@glasshome/widget-sdk";
import type { EntityView } from "@glasshome/widget-sdk";
import { hass } from "../ha/store";
import { attr } from "./util";

/**
 * Home Assistant's update entities: the core, the OS, add-ons, HACS cards and
 * integrations, device firmware. The house's, not a room's — they sit in no
 * area — so the board asks for all of them and says how many are waiting.
 */

/* UpdateEntityFeature, as Home Assistant numbers it. */
const INSTALL = 1;
const BACKUP = 8;
const RELEASE_NOTES = 16;

const has = (entity: EntityView, feature: number) =>
  (attr<number>(entity, "supported_features", 0) & feature) === feature;

/** Installing: the newer flag, the older percentage-or-true one, either way. */
export const installing = (entity: EntityView) => {
  const flag = entity.attributes.in_progress;
  return flag === true || typeof flag === "number";
};

/** Waiting to be installed, or being installed now. */
export const pending = (entity: EntityView) => entity.state === "on" || installing(entity);

/** How far along an install is, 0–100, where the integration says. */
const progress = (entity: EntityView): number | undefined => {
  const percent = entity.attributes.update_percentage ?? entity.attributes.in_progress;
  return typeof percent === "number" ? Math.max(0, Math.min(100, percent)) : undefined;
};

const titleOf = (entity: EntityView) =>
  attr<string>(entity, "title", "") || entity.friendlyName.replace(/\s+(firmware|update)$/i, "") || entity.id;

/** The order of the list: what is installing, then Home Assistant's own, then by name. */
const rank = (entity: EntityView) => {
  if (installing(entity)) return 0;
  if (/^update\.home_assistant_(core|operating_system|supervisor)/.test(entity.id)) return 1;
  return 2;
};

/**
 * Release notes as plain text. They come as Markdown: headings, bold, links
 * and HTML comments read as clutter when shown as they are, and rendering
 * someone else's HTML into the board is not something to do for a changelog.
 */
const plainNotes = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The pill on the room's photo: how many updates are waiting. */
export function UpdatesPill(props: { updates: EntityView[]; onOpen: () => void }) {
  const busy = () => props.updates.some(installing);
  return (
    <button
      class="rb-updates-pill"
      data-busy={busy()}
      aria-label={`${props.updates.length} updates available`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
    >
      <span class="rb-updates-pill-icon">
        <Icon icon={busy() ? "mdi:progress-download" : "mdi:arrow-up-bold-circle"} width="14" />
      </span>
      <span>
        {busy() && props.updates.length === 1
          ? "Updating…"
          : `${props.updates.length} ${props.updates.length === 1 ? "update" : "updates"}`}
      </span>
    </button>
  );
}

/** The overlay: every waiting update, with its versions, notes and button. */
export function UpdatesPanel(props: { updates: EntityView[] }) {
  const sorted = createMemo(() =>
    [...props.updates].sort((a, b) => rank(a) - rank(b) || titleOf(a).localeCompare(titleOf(b))),
  );
  const installable = () => sorted().filter((entity) => has(entity, INSTALL) && !installing(entity));

  /* "Update all" asks twice, like every install here: Home Assistant itself
     restarts for some of them, and a firmware install can take a device
     offline for minutes. */
  const { callService } = useService();
  const [asking, setAsking] = createSignal("");
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(askTimer));
  const ask = (key: string, then: () => void) => {
    clearTimeout(askTimer);
    if (asking() !== key) {
      setAsking(key);
      askTimer = setTimeout(() => setAsking(""), 3500);
      return;
    }
    setAsking("");
    then();
  };

  /* Backup before installing, where the integration offers it (Home
     Assistant and its add-ons) — on unless switched off for that one. */
  const [noBackup, setNoBackup] = createSignal<ReadonlySet<string>>(new Set());
  const backupOn = (entity: EntityView) => has(entity, BACKUP) && !noBackup().has(entity.id);
  const toggleBackup = (id: string) =>
    setNoBackup((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* Asked for: the button shows as busy until Home Assistant reports the
     install, which can take a moment to start. */
  const [started, setStarted] = createSignal<ReadonlySet<string>>(new Set());
  const install = (entity: EntityView) => {
    setStarted((before) => new Set(before).add(entity.id));
    void callService("update", "install", backupOn(entity) ? { backup: true } : {}, { entity_id: entity.id });
  };
  const skip = (entity: EntityView) => {
    void callService("update", "skip", {}, { entity_id: entity.id });
  };

  return (
    <div class="rb-updates">
      <Show
        when={sorted().length}
        fallback={
          <div class="rb-updates-none">
            <span class="rb-updates-none-badge">
              <Icon icon="mdi:check-decagram" width="28" />
            </span>
            <b>Everything is up to date</b>
          </div>
        }
      >
        <header class="rb-updates-head">
          <span>
            <b>{sorted().length}</b> {sorted().length === 1 ? "update" : "updates"} available
          </span>
          <Show when={installable().length > 1}>
            <button
              class="rb-updates-all"
              data-asking={asking() === "all"}
              onClick={() => ask("all", () => installable().forEach(install))}
            >
              <Icon icon="mdi:download-multiple" width="16" />
              <span>{asking() === "all" ? `Install ${installable().length}?` : "Update all"}</span>
            </button>
          </Show>
        </header>

        <ul class="rb-updates-list">
          <For each={sorted()}>
            {(entity) => (
              <UpdateRow
                entity={entity}
                asking={asking()}
                started={started().has(entity.id)}
                backup={backupOn(entity)}
                onBackup={() => toggleBackup(entity.id)}
                onInstall={() => ask(`install:${entity.id}`, () => install(entity))}
                onSkip={() => ask(`skip:${entity.id}`, () => skip(entity))}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function UpdateRow(props: {
  entity: EntityView;
  asking: string;
  started: boolean;
  backup: boolean;
  onBackup: () => void;
  onInstall: () => void;
  onSkip: () => void;
}) {
  const entity = () => props.entity;
  const busy = () => installing(entity()) || (props.started && entity().state === "on");
  const picture = () => attr<string>(entity(), "entity_picture", "");
  const installed = () => attr<string>(entity(), "installed_version", "");
  const latest = () => attr<string>(entity(), "latest_version", "");
  const summary = () => attr<string>(entity(), "release_summary", "");
  const url = () => attr<string>(entity(), "release_url", "");
  const [pictureFailed, setPictureFailed] = createSignal(false);

  /* The full notes, fetched when opened — they can be pages long, and most
     rows are never opened. */
  const [open, setOpen] = createSignal(false);
  const [notes, setNotes] = createSignal<string>();
  const toggleNotes = async () => {
    const next = !open();
    setOpen(next);
    if (!next || notes() !== undefined) return;
    if (!has(entity(), RELEASE_NOTES)) {
      setNotes(summary());
      return;
    }
    try {
      const reply = await hass().connection.sendMessagePromise<string | null>({
        type: "update/release_notes",
        entity_id: entity().id,
      });
      setNotes(reply || summary() || "");
    } catch {
      setNotes(summary() || "");
    }
  };
  const canExpand = () => has(entity(), RELEASE_NOTES) || summary().length > 0;

  return (
    <li class="rb-update" data-busy={busy()}>
      <div class="rb-update-main">
        <span class="rb-update-pic">
          <Show
            when={picture() && !pictureFailed()}
            fallback={<Icon icon={entity().icon || "mdi:package-up"} width="22" />}
          >
            <img src={picture()} alt="" loading="lazy" onError={() => setPictureFailed(true)} />
          </Show>
        </span>

        <span class="rb-update-text">
          <b class="rb-truncate">{titleOf(entity())}</b>
          <span class="rb-update-versions">
            <Show when={installed()}>
              <span class="rb-update-from">{installed()}</span>
              <Icon icon="mdi:arrow-right" width="12" />
            </Show>
            <span class="rb-update-to">{latest()}</span>
          </span>
        </span>

        <Show
          when={!busy()}
          fallback={
            <span class="rb-update-state">
              <Icon icon="mdi:loading" width="16" class="rb-spin" />
              <span>{progress(entity()) !== undefined ? `${Math.round(progress(entity())!)}%` : "Installing"}</span>
            </span>
          }
        >
          <Show
            when={has(entity(), INSTALL)}
            fallback={
              <Show when={url()}>
                <a class="rb-update-btn" data-quiet="true" href={url()} target="_blank" rel="noreferrer">
                  Open
                </a>
              </Show>
            }
          >
            <button
              class="rb-update-btn"
              data-asking={props.asking === `install:${entity().id}`}
              onClick={props.onInstall}
            >
              {props.asking === `install:${entity().id}` ? "Sure?" : "Update"}
            </button>
          </Show>
        </Show>
      </div>

      <Show when={busy() && progress(entity()) !== undefined}>
        <span class="rb-update-bar" style={{ "--rb-progress": `${progress(entity())}%` }} />
      </Show>

      <div class="rb-update-extras">
        <Show when={canExpand()}>
          <button class="rb-update-link" aria-expanded={open()} onClick={() => void toggleNotes()}>
            <Icon icon={open() ? "mdi:chevron-up" : "mdi:text-box-outline"} width="14" />
            <span>{open() ? "Hide notes" : "What's new"}</span>
          </button>
        </Show>
        <Show when={url() && has(entity(), INSTALL)}>
          <a class="rb-update-link" href={url()} target="_blank" rel="noreferrer">
            <Icon icon="mdi:open-in-new" width="14" />
            <span>Release</span>
          </a>
        </Show>
        <Show when={has(entity(), BACKUP) && !busy()}>
          <button class="rb-update-link" data-on={props.backup} aria-pressed={props.backup} onClick={props.onBackup}>
            <Icon icon={props.backup ? "mdi:checkbox-marked-circle" : "mdi:checkbox-blank-circle-outline"} width="14" />
            <span>Backup first</span>
          </button>
        </Show>
        <Show when={!busy() && entity().state === "on"}>
          <button
            class="rb-update-link rb-update-skip"
            data-asking={props.asking === `skip:${entity().id}`}
            onClick={props.onSkip}
          >
            <Icon icon="mdi:debug-step-over" width="14" />
            <span>{props.asking === `skip:${entity().id}` ? "Skip this version?" : "Skip"}</span>
          </button>
        </Show>
      </div>

      <Show when={open()}>
        <div class="rb-update-notes">
          <Show when={notes() !== undefined} fallback={<span class="rb-update-loading">Loading…</span>}>
            {plainNotes(notes() ?? "") || "No notes for this release."}
          </Show>
        </div>
      </Show>
    </li>
  );
}
