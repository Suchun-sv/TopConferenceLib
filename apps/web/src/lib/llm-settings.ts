"use client";

export type Provider = "openai" | "anthropic" | "custom";

export type LlmSettings = {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const KEY = "tcr.llm.v1";

export const DEFAULTS: Record<Provider, { model: string; baseUrl?: string }> = {
  openai: { model: "gpt-4o-mini" },
  anthropic: { model: "claude-haiku-4-5" },
  custom: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
};

export function loadSettings(): LlmSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LlmSettings>;
    if (!v.provider || !v.apiKey || !v.model) return null;
    return {
      provider: v.provider,
      apiKey: v.apiKey,
      model: v.model,
      baseUrl: v.baseUrl,
    };
  } catch {
    return null;
  }
}

export function saveSettings(s: LlmSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSettings(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

// ---- sync state ----

const SYNC_FLAG_KEY = "tcr.llm.sync.enabled";
const SYNC_SALT_KEY = "tcr.llm.sync.salt"; // cached so we re-use same salt across saves
const SYNC_PASSPHRASE_KEY = "tcr.llm.sync.passphrase"; // sessionStorage only

export function isSyncEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SYNC_FLAG_KEY) === "1";
}

export function setSyncEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(SYNC_FLAG_KEY, "1");
  else window.localStorage.removeItem(SYNC_FLAG_KEY);
}

export function getCachedSalt(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SYNC_SALT_KEY);
}

export function setCachedSalt(salt: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SYNC_SALT_KEY, salt);
}

export function clearCachedSalt(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SYNC_SALT_KEY);
}

/** Passphrase is held in sessionStorage so it survives reloads in the same tab
 *  but does not persist after the browser is closed. */
export function getSessionPassphrase(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(SYNC_PASSPHRASE_KEY);
}

export function setSessionPassphrase(p: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SYNC_PASSPHRASE_KEY, p);
}

export function clearSessionPassphrase(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SYNC_PASSPHRASE_KEY);
}
