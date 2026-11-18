/**
 * The widgets' stylesheets, collected for the card's shadow root.
 *
 * The widgets import their CSS as a side effect (`import "./styles.css"`).
 * The build (vite.config.ts) turns each such import into a call here, so the
 * card can put all of it inside its own shadow root, where Home Assistant's
 * page styles do not reach and the card's do not leak out.
 */
const sheets: string[] = [];

export function addCss(text: string): void {
  sheets.push(text);
}

export function cardCss(): string {
  return sheets.join("\n");
}
