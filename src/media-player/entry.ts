import { createSignal } from "solid-js";
import { hass } from "../ha/store";

/**
 * music_assistant.search and get_library require a config_entry_id. The card
 * option is optional, so when it is left empty the Music Assistant entry is
 * looked up once from Home Assistant: the first loaded one, else the first.
 * Without this, opening an album or artist from Search, Browse or Discover
 * failed with "required key not provided".
 */
let found: Promise<string> | undefined;

async function lookup(): Promise<string> {
  try {
    const entries = await hass().connection.sendMessagePromise<
      { entry_id: string; state?: string }[]
    >({ type: "config_entries/get", domain: "music_assistant" });
    const list = Array.isArray(entries) ? entries : [];
    return (list.find((e) => e.state === "loaded") ?? list[0])?.entry_id ?? "";
  } catch {
    return "";
  }
}

export function useMusicAssistantEntry(configured: () => string | undefined): () => string {
  const [auto, setAuto] = createSignal("");
  // Asked when the card starts, not on the first tap: the tap would win the race.
  found ??= lookup();
  found.then((id) => {
    if (id) setAuto(id);
    else found = undefined; // asked again by the next card
  });
  return () => configured()?.trim() || auto();
}
