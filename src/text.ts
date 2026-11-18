/**
 * The text with every part from `open` to the next `close` replaced by `put`,
 * in one pass. An `open` with no `close` after it stays, as it would with a
 * regex.
 *
 * A loop rather than a pattern like /\([^)]*\)/g: on many openings that are
 * never closed, that pattern reads the rest of the text again from each one —
 * work that grows with the square of the text's length.
 */
export function replaceEnclosed(text: string, open: string, close: string, put = ""): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf(open, at);
    const end = start < 0 ? -1 : text.indexOf(close, start);
    if (end < 0) return out + text.slice(at);
    out += text.slice(at, start) + put;
    at = end + 1;
  }
  return out;
}
