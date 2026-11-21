import { useDomains } from "../domains";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Icon, useEntities, useService, type EntityView } from "@glasshome/widget-sdk";
/* The camera widget's own readers rather than a second set that would drift
   from them: the same token handling, the same companion-entity matching. Only
   the markup is the board's, because a widget's stylesheet does not reach
   another widget's. */
import { companionIds, isMotion, motionOn, sinceLabel, stillUrl } from "../camera/util";
import { Keyed } from "./keyed";
import { openable } from "./util";
import { errorMessage } from "../errors";
import { Half } from "./half";

/** The still, as a background rather than an <img>, so it can crop freely. */
function Shot(props: { camera: EntityView | undefined; tick: number }) {
  const [failed, setFailed] = createSignal(false);
  const src = () => stillUrl(props.camera, props.tick);

  createEffect(() => {
    src();
    setFailed(false);
  });

  return (
    <Show
      when={src() && !failed()}
      fallback={
        <div class="rb-cam-empty">
          <Icon icon="mdi:cctv-off" width="22" />
        </div>
      }
    >
      <img class="rb-cam-img" src={src()} alt="" decoding="async" onError={() => setFailed(true)} />
    </Show>
  );
}

/**
 * Motion, for whichever camera is being shown.
 *
 * Blink names the sensor after the camera, so the card finds it rather than
 * asking for it — a room with four cameras would otherwise be four more
 * entities to configure.
 */
function useMotion(camera: () => EntityView | undefined) {
  const domains = useDomains();
  const ids = () =>
    companionIds(camera(), domains().binary_sensor ?? []).filter((id) => /motion/i.test(id));
  const sensors = useEntities(ids);
  return () => sensors().some(isMotion);
}

/** A picture with a name on it: the board card. */
export function CameraCard(props: {
  cameras: EntityView[];
  activeId: string;
  onSelect: (id: string) => void;
  onOpen: () => void;
}) {
  const [tick, setTick] = createSignal(Date.now());

  const index = () => {
    const at = props.cameras.findIndex((camera) => camera.id === props.activeId);
    return Math.max(0, at);
  };

  const camera = () => props.cameras[index()];
  const moving = useMotion(camera);

  const step = (delta: number) => {
    const count = props.cameras.length;
    if (count < 2) return;
    const next = (index() + delta + count) % count;
    props.onSelect(props.cameras[next]!.id);
  };

  /* Swipe to page, tap to open.
   *
   * One gesture handler rather than a carousel library: the card is a single
   * picture, and what it needs is to tell a drag from a tap. A drag that
   * travels far enough sideways pages and swallows the click that follows it,
   * so a swipe never opens the overlay by accident. */
  let start: { x: number; y: number } | undefined;
  let swiped = false;

  const onPointerDown = (event: PointerEvent) => {
    start = { x: event.clientX, y: event.clientY };
    swiped = false;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = undefined;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    swiped = true;
    step(dx < 0 ? 1 : -1);
  };

  const onClick = () => {
    if (swiped) {
      swiped = false;
      return;
    }
    props.onOpen();
  };

  /* A reload, not a trigger: this re-fetches the still Home Assistant already
     holds, so it costs nothing at a battery camera. */
  createEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <article
      class="rb-card rb-card--camera"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      {...openable(onClick, "Cameras")}
    >
      <Shot camera={camera()} tick={tick()} />
      <div class="rb-cam-veil" />

      <div class="rb-cam-top">
        <span class="rb-cam-badge" data-live={moving()}>
          <i />
          <span>{moving() ? "Motion" : "Clear"}</span>
        </span>

        <Show when={props.cameras.length > 1}>
          <span class="rb-cam-count">
            {index() + 1}/{props.cameras.length}
          </span>
        </Show>
      </div>

      <div class="rb-cam-foot">
        <div class="rb-cam-foot-meta">
          <h3 class="rb-cam-name rb-truncate">{camera()?.friendlyName ?? "Camera"}</h3>
          <span class="rb-cam-age">{sinceLabel(camera()?.lastChanged) || "No still yet"}</span>
        </div>

        {/* Where you are in the set, and a way through it without a swipe —
            a mouse has no gesture, and a dot is a target. Kept to the right,
            clear of the name, which is the part that needs the width. */}
        <Show when={props.cameras.length > 1}>
          <span class="rb-cam-dots">
            <For each={props.cameras}>
              {(other, at) => (
                <button
                  class="rb-cam-dot"
                  data-active={at() === index()}
                  aria-label={`Show ${other.friendlyName ?? other.id}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelect(other.id);
                  }}
                />
              )}
            </For>
          </span>
        </Show>
      </div>
      <Half icon={moving() ? "mdi:motion-sensor" : "mdi:cctv"} name={camera()?.friendlyName ?? "Camera"} status={moving() ? "Motion" : "Live"} tone={moving() ? "#ef4444" : "#38bdf8"} lit={moving()} value={props.cameras.length > 1 ? `${index() + 1}/${props.cameras.length}` : undefined} />
    </article>
  );
}

/**
 * The overlay: the picture at the size it deserves, what the camera can be
 * told, its own sensors, and the room's other cameras as pictures.
 */
export function CameraPanel(props: {
  cameras: EntityView[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const domains = useDomains();
  const { callService } = useService();
  const [tick, setTick] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  const [note, setNote] = createSignal<string | undefined>();

  const active = () =>
    props.cameras.find((camera) => camera.id === props.activeId) ?? props.cameras[0];
  const moving = useMotion(active);

  const slug = () => (active()?.id ?? "").split(".")[1] ?? "";

  const companions = useEntities(() =>
    companionIds(active(), domains().sensor ?? []),
  );

  const readings = createMemo(() =>
    companions().filter((entity) => entity.state && entity.state !== "unavailable"),
  );

  const call = async (domain: string, service: string, entityId: string) => {
    setNote(undefined);
    setBusy(true);
    try {
      await callService(domain, service, {}, { entity_id: entityId });
    } catch (error) {
      setNote(errorMessage(error, "That did not work"));
    } finally {
      setBusy(false);
    }
  };

  /* Waking the camera is a button, not something the overlay does on open:
     a Blink camera pays for every still in battery. */
  const refresh = async () => {
    const id = active()?.id;
    if (!id) return;
    await call("blink", "trigger_camera", id);
    setTimeout(() => setTick(Date.now()), 2500);
  };

  const shortName = (entity: EntityView) => {
    const name = entity.friendlyName ?? entity.id;
    const bare = name.replace(new RegExp(slug().replaceAll("_", "[ _]"), "i"), "").trim();
    return (bare || name).replace(/^./, (c) => c.toUpperCase());
  };

  return (
    <div class="rb-cam-panel">
      {/* The picker rides beside the picture rather than under the controls:
          it is how you change what you are looking at, so it belongs next to
          what you are looking at. It drops below the stage on a narrow
          overlay, where a column would leave the still too small to read. */}
      <div class="rb-cam-main">
      <div class="rb-cam-stage">
        <Shot camera={active()} tick={tick()} />

        <div class="rb-cam-top">
          <span class="rb-cam-badge" data-live={moving()}>
            <i />
            <span>{moving() ? "Motion" : "Clear"}</span>
          </span>
          <span class="rb-cam-stage-name rb-truncate">
            {active()?.friendlyName ?? "Camera"}
          </span>
        </div>

        <span class="rb-cam-stage-age">{sinceLabel(active()?.lastChanged)}</span>
      </div>

      <Show when={props.cameras.length > 1}>
        <div class="rb-cam-strip">
          <Keyed each={props.cameras}>
            {(camera) => (
              <button
                class="rb-cam-thumb"
                data-active={camera.id === active()?.id}
                onClick={() => props.onSelect(camera.id)}
              >
                <Shot camera={camera} tick={tick()} />
                <span class="rb-cam-thumb-name rb-truncate">
                  {camera.friendlyName ?? camera.id}
                </span>
              </button>
            )}
          </Keyed>
        </div>
      </Show>
      </div>

      <div class="rb-cam-actions">
        <button class="rb-vac-key rb-vac-key--go" disabled={busy()} onClick={refresh}>
          <Icon icon="mdi:camera-retake-outline" width="18" />
          <span>{busy() ? "Waking…" : "New still"}</span>
        </button>

        <button
          class="rb-vac-key rb-cam-key"
          data-active={motionOn(active())}
          onClick={() =>
            call(
              "camera",
              motionOn(active()) ? "disable_motion_detection" : "enable_motion_detection",
              active()?.id ?? "",
            )
          }
        >
          <Icon
            icon={motionOn(active()) ? "mdi:motion-sensor" : "mdi:motion-sensor-off"}
            width="18"
          />
          <span>{motionOn(active()) ? "Recording" : "Paused"}</span>
        </button>
      </div>

      <Show when={note()}>
        <p class="rb-vac-status">{note()}</p>
      </Show>

      <Show when={readings().length}>
        <div class="rb-cam-readings">
          <For each={readings()}>
            {(sensor) => (
              <span class="rb-cam-reading">
                <span class="rb-truncate">{shortName(sensor)}</span>
                <b>
                  {sensor.state}
                  {sensor.unitOfMeasurement ? ` ${sensor.unitOfMeasurement}` : ""}
                </b>
              </span>
            )}
          </For>
        </div>
      </Show>

    </div>
  );
}
