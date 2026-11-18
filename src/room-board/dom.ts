/*
 * DOM writes that happen only when they change something.
 *
 * The layout and the arranging controls are applied to every card each time
 * a card comes or goes. In the sealed engine of Dash 1.5 every DOM write is
 * copied out to the dashboard, so the same values written again on every card
 * cost most of a step's budget on a full board — removing one card while
 * arranging went over it. What was last written is kept here rather than read
 * back from the element: reading a style in the sealed DOM costs about as much
 * as writing it.
 */

const written = new WeakMap<Element, Map<string, string | undefined>>();

function changes(el: Element, key: string, value: string | undefined): boolean {
  let mine = written.get(el);
  if (!mine) {
    mine = new Map();
    written.set(el, mine);
  }
  if (mine.has(key) && mine.get(key) === value) return false;
  mine.set(key, value);
  return true;
}

export function setStyle(el: HTMLElement, property: string, value: string): void {
  if (changes(el, `style:${property}`, value)) el.style.setProperty(property, value);
}

export function clearStyle(el: HTMLElement, property: string): void {
  if (changes(el, `style:${property}`, undefined)) el.style.removeProperty(property);
}

export function setData(el: HTMLElement, key: string, value: string): void {
  if (changes(el, `data:${key}`, value)) el.dataset[key] = value;
}

export function clearData(el: HTMLElement, key: string): void {
  if (changes(el, `data:${key}`, undefined)) delete el.dataset[key];
}

export function setDisabled(el: HTMLButtonElement | null, value: boolean): void {
  if (el && changes(el, "disabled", String(value))) el.disabled = value;
}
