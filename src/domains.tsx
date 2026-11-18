import { createContext, createMemo, useContext, type Accessor } from "solid-js";
import { byDomain } from "@glasshome/widget-sdk";

type Domains = ReturnType<typeof byDomain>;

/**
 * The house's entity ids, grouped by domain, once.
 *
 * byDomain() is not cached: every call walks every entity id in the house.
 * The room board's cards called it a dozen times while the board was first
 * drawn, which on a house of a few thousand entities was most of the work the
 * sealed engine allows a widget for starting up. The board makes one grouping
 * (createDomains) and shares it with everything under it through this
 * context; the grouping is reworked only when entities come or go.
 */
export const DomainsContext = createContext<Accessor<Domains>>();

/** A grouping of its own, for the widget that shares it. Call during setup. */
export function createDomains(): Accessor<Domains> {
  return createMemo(() => byDomain());
}

/** The shared grouping when there is one, or one of the caller's own. Call during setup. */
export function useDomains(): Accessor<Domains> {
  return useContext(DomainsContext) ?? createDomains();
}

/**
 * For createMemo's `equals`: two lists of entity ids alike. An id list given
 * to useEntities is read again on every change of one of its entities; as a
 * memo of its own, made with this, it is worked out again only when what it
 * is made from changes, and passed on only when the ids do.
 */
export const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);
