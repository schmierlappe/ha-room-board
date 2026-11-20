import { Show, createSignal, onCleanup } from "solid-js";
import { Icon, useEntity } from "@glasshome/widget-sdk";

/**
 * The guest Wi-Fi as a QR code, on the room's photo above the room picker:
 * a visitor points their phone at the tablet on the wall and is on the
 * network. Home Assistant's UniFi integration publishes the code as an image
 * entity (image.<site>_guest_qr_code), served through its image proxy with a
 * token that changes — the entity's own entity_picture always has the
 * current one.
 *
 * Tablets only: a phone is the thing that scans it, and a desktop is not
 * where guests stand. A tap makes it bigger for a phone held further away.
 */
export function useTablet() {
  const query = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : undefined;
  const [touch, setTouch] = createSignal(query?.matches ?? false);
  const update = () => setTouch(query?.matches ?? false);
  query?.addEventListener?.("change", update);
  onCleanup(() => query?.removeEventListener?.("change", update));
  return touch;
}

export function WifiQr(props: { entityId: string }) {
  const image = useEntity(() => props.entityId);
  const [big, setBig] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const src = () => {
    const picture = image()?.attributes?.entity_picture;
    return typeof picture === "string" && picture ? picture : "";
  };
  /* The integration names the image after the network: "Guest QR Code" on
     "M1A2R3E4K5!Guest". What is left once that is taken off is the name a
     guest looks for in their phone's list. */
  const network = () =>
    (image()?.friendlyName ?? "")
      .replace(/\s*(guest\s*)?qr\s*code\s*\d*$/i, "")
      .trim() || "Guest Wi-Fi";
  const usable = () => !!src() && image()?.state !== "unavailable" && !failed();

  return (
    <Show when={usable()}>
      <button
        class="rb-wifi"
        data-big={big()}
        aria-label={big() ? "Make the Wi-Fi code smaller" : "Make the Wi-Fi code bigger"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setBig(!big());
        }}
      >
        <span class="rb-wifi-code">
          <img src={src()} alt={`Wi-Fi code for ${network()}`} draggable={false} onError={() => setFailed(true)} />
        </span>
        <span class="rb-wifi-text">
          <span class="rb-wifi-kicker">
            <Icon icon="mdi:wifi" width="13" />
            Guest Wi-Fi
          </span>
          <b>{network()}</b>
          <small>{big() ? "Tap to make it smaller" : "Scan to join"}</small>
        </span>
      </button>
    </Show>
  );
}
