// Unsaved form text kept in this browser (per form), so a reload or a failed save never loses it.
// Storage can be blocked (private windows), so every call is guarded and the form works without it.

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "anryh:draft:";

function store(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft<T>(key: string, s: Store | null = store()): T | null {
  try {
    const raw = s?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown, s: Store | null = store()) {
  try {
    s?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the form still works, it just can't be restored
  }
}

export function clearDraft(key: string, s: Store | null = store()) {
  try {
    s?.removeItem(PREFIX + key);
  } catch {
    // nothing to clear
  }
}
