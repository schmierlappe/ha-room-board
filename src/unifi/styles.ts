import { isDarkTheme } from "../theme";

/** UniFi's blue, and the status colours a shade deeper on a light theme. */
export function unifiVars(photo = false): Record<string, string> {
  /* Over a photo the card is dark in every theme: white words on its shade. */
  const dark = photo || typeof document === "undefined" ? true : isDarkTheme();
  return dark
    ? {
        "--uf-blue": "#3d8bff",
        "--uf-ok": "#4ade80",
        "--uf-bad": "#f87171",
        "--uf-up": "#a78bfa",
        "--uf-warn": "#fbbf24",
        "--uf-teal": "#2dd4bf",
        "--uf-glass": "#1c2028",
      }
    : {
        "--uf-blue": "#006fff",
        "--uf-ok": "#16a34a",
        "--uf-bad": "#dc2626",
        "--uf-up": "#7c3aed",
        "--uf-warn": "#d97706",
        "--uf-teal": "#0d9488",
        "--uf-glass": "#ffffff",
      };
}
