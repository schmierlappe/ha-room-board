import { Show, createSignal } from "solid-js";
import { initials, resolveLogo } from "./util";

/**
 * ESPN's logo CDN is a different origin, and the dashboard's CSP may refuse
 * it — the media-player widget needed a host proxy for exactly this with
 * cover art. Rather than leave a broken image, a failed load (or a missing
 * URL) falls back to the club's initials, so the tile still reads correctly
 * with no proxy configured at all.
 */
export function Crest(props: {
  name: string;
  logo?: string;
  proxyBase: string;
  /** ESPN's own short code (KSC, WOB) — a better badge than derived initials. */
  abbreviation?: string;
  class?: string;
}) {
  const [failed, setFailed] = createSignal(false);
  const src = () => resolveLogo(props.logo, props.proxyBase);

  return (
    <div class={`sc-crest ${props.class ?? ""}`} title={props.name}>
      <Show when={src() && !failed()} fallback={<span>{props.abbreviation || initials(props.name)}</span>}>
        <img src={src()} alt="" loading="lazy" onError={() => setFailed(true)} />
      </Show>
    </div>
  );
}

/**
 * The oversized, faded club badge behind each half of the tile. Purely
 * decorative, so it hides itself rather than showing a broken image when the
 * logo can't load — which is the default until a proxy base is configured.
 */
export function CrestWatermark(props: { logo?: string; proxyBase: string; side: "home" | "away" }) {
  const [failed, setFailed] = createSignal(false);
  const src = () => resolveLogo(props.logo, props.proxyBase);

  return (
    <Show when={src() && !failed()}>
      <img
        class={`sc-bg-logo sc-bg-logo--${props.side}`}
        src={src()}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
