/* The arrow keys: up and right raise a value, down and left lower it. */
const DIRECTION: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

/**
 * How far a key moves a slider: `step` for an arrow, `page` for Page Up or
 * Page Down where the slider has those, nothing for any other key.
 */
export function keyStep(key: string, step = 1, page?: number): number {
  if (Object.hasOwn(DIRECTION, key)) return DIRECTION[key]! * step;
  if (page === undefined) return 0;
  if (key === "PageUp") return page;
  return key === "PageDown" ? -page : 0;
}
