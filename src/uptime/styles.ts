import { isDarkTheme } from "../theme";

/**
 * The status colours, a shade deeper on a light theme so they read on white.
 * Read once per render from the dashboard's theme wrapper: the widget's own
 * shadow root cannot see it.
 */
export function uptimeVars(): Record<string, string> {
  const dark = typeof document === "undefined" ? true : isDarkTheme();
  return dark
    ? {
        "--up-ok": "#4ade80",
        "--up-bad": "#f87171",
        "--up-wait": "#fbbf24",
        "--up-maint": "#60a5fa",
        /* The pill's words: dark on the bright dark-theme green and amber,
           as Uptime Kuma has them. */
        "--up-on": "#052e16",
        "--up-ring": "#1b1f27",
      }
    : {
        "--up-ok": "#22c55e",
        "--up-bad": "#dc2626",
        "--up-wait": "#d97706",
        "--up-maint": "#2563eb",
        "--up-on": "#fff",
        "--up-ring": "#fff",
      };
}
