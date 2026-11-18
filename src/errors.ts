/**
 * What went wrong, as words for the person looking at the widget.
 *
 * Home Assistant rejects a call with a plain object ({ code, message }) as
 * often as with an Error, and String() on that says "[object Object]"; its
 * message is read either way. Anything without one gets the fallback.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string") return err || fallback;
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message ? message : fallback;
}

/** The error's code, where it carries one ("CAPABILITY_DENIED"). */
export function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "";
}
