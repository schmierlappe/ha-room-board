import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
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

/* A restart Home Assistant is waiting for. It says so as a repair issue —
   HACS (the marketplace) and integrations raise "restart required" after an
   update — so the board reads the repairs and offers the button while one is
   open, even after the last update has gone from the list. */
type Issue = {
  domain: string;
  issue_id: string;
  translation_key?: string;
  translation_placeholders?: Record<string, string> | null;
  dismissed_version?: string | null;
  ignored?: boolean;
};

const needsRestart = (issue: Issue) =>
  !issue.ignored &&
  !issue.dismissed_version &&
  /restart_required|restart_needed|requires_restart/i.test(`${issue.translation_key ?? ""} ${issue.issue_id}`);

const restartName = (issue: Issue) => {
  const p = issue.translation_placeholders ?? {};
  return p.name || p.repository || p.integration || p.domain || issue.domain;
};

/**
 * What waits on a restart, kept fresh: read when the board starts, whenever
 * the update entities change (an install has just finished) and when the
 * repairs change, where Home Assistant lets this user hear of that.
 */
export function useRestartNeeded(watch: () => unknown) {
  const [names, setNames] = createSignal<string[]>([]);
  let alive = true;
  onCleanup(() => (alive = false));
  const read = async () => {
    try {
      const reply = await hass().connection.sendMessagePromise<{ issues: Issue[] }>({ type: "repairs/list_issues" });
      if (!alive) return;
      const found = [...new Set((reply?.issues ?? []).filter(needsRestart).map(restartName))].sort();
      setNames((before) => (before.join("\u0000") === found.join("\u0000") ? before : found));
    } catch {
      /* Not allowed for this user, or no repairs: no button, as before. */
    }
  };
  let later: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(later));
  createEffect(
    on(watch, () => {
      void read();
      /* HACS raises its issue a moment after the entity says it is done. */
      clearTimeout(later);
      later = setTimeout(() => void read(), 4000);
    }),
  );
  let unsubscribe: (() => void) | undefined;
  hass()
    .connection.subscribeMessage(() => void read(), { type: "subscribe_events", event_type: "repairs_issue_registry_updated" })
    .then((stop) => (alive ? (unsubscribe = stop) : stop()))
    .catch(() => undefined);
  onCleanup(() => unsubscribe?.());
  return names;
}

/** The banner at the top of the overlay: what waits, and the button. */
function RestartBanner(props: { names: string[]; asking: boolean; onRestart: () => void; restarting: boolean }) {
  return (
    <div class="rb-restart" data-busy={props.restarting}>
      <span class="rb-restart-icon">
        <Icon icon={props.restarting ? "mdi:loading" : "mdi:restart-alert"} width="22" class={props.restarting ? "rb-spin" : undefined} />
      </span>
      <span class="rb-restart-text">
        <b>{props.restarting ? "Restarting Home Assistant…" : "Restart required"}</b>
        <span class="rb-truncate">
          {props.restarting ? "The board reconnects by itself" : `To finish ${props.names.join(", ")}`}
        </span>
      </span>
      <Show when={!props.restarting}>
        <button class="rb-update-btn rb-restart-btn" data-asking={props.asking} onClick={props.onRestart}>
          <Icon icon="mdi:restart" width="15" />
          <span>{props.asking ? "Restart now?" : "Restart"}</span>
        </button>
      </Show>
    </div>
  );
}

/** In the Overview line beside Arrange, on a wide screen: how many are waiting. */
export function UpdatesButton(props: { updates: EntityView[]; restart?: boolean; onOpen: () => void }) {
  const busy = () => props.updates.some(installing);
  const onlyRestart = () => !props.updates.length && props.restart;
  return (
    <button
      class="rb-updates-toggle"
      data-busy={busy()}
      data-restart={props.restart === true}
      title="Updates"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
    >
      <Icon
        icon={busy() ? "mdi:progress-download" : props.restart ? "mdi:restart-alert" : "mdi:arrow-up-bold-circle-outline"}
        width="16"
      />
      <span>{onlyRestart() ? "Restart" : props.updates.length === 1 ? "Update" : "Updates"}</span>
      <Show when={props.updates.length}>
        <b class="rb-updates-count">{props.updates.length}</b>
      </Show>
    </button>
  );
}

/** In the bar at the foot of a phone, over the activity line: how many, and which. */
export function UpdatesBar(props: { updates: EntityView[]; onOpen: () => void }) {
  const busy = () => props.updates.some(installing);
  const names = () =>
    [...props.updates]
      .sort((a, b) => rank(a) - rank(b) || titleOf(a).localeCompare(titleOf(b)))
      .map(titleOf)
      .join(", ");
  return (
    <button class="rb-updates-bar" data-busy={busy()} onClick={props.onOpen}>
      <span class="rb-updates-bar-icon">
        <Icon icon={busy() ? "mdi:progress-download" : "mdi:arrow-up-bold"} width="13" />
      </span>
      <span class="rb-updates-bar-text rb-truncate">
        <b>
          {props.updates.length} {props.updates.length === 1 ? "update" : "updates"}
          {busy() ? " · installing" : ""}
        </b>
        <span>{names()}</span>
      </span>
      <Icon icon="mdi:chevron-up" width="17" />
    </button>
  );
}

/** The overlay: every waiting update, with its versions, notes and button. */
export function UpdatesPanel(props: { updates: EntityView[]; restart?: string[] }) {
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
  const [restarting, setRestarting] = createSignal(false);
  const restart = () => {
    setRestarting(true);
    void callService("homeassistant", "restart", {});
  };

  return (
    <div class="rb-updates">
      <Show when={props.restart?.length}>
        <RestartBanner
          names={props.restart ?? []}
          asking={asking() === "restart"}
          restarting={restarting()}
          onRestart={() => ask("restart", restart)}
        />
      </Show>
      <Show
        when={sorted().length}
        fallback={
          <Show when={!props.restart?.length}>
            <div class="rb-updates-none">
            <span class="rb-updates-none-badge">
              <Icon icon="mdi:check-decagram" width="28" />
            </span>
            <b>Everything is up to date</b>
          </div>
          </Show>
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
