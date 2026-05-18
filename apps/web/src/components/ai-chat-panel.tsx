"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "./markdown-view";
import {
  DEFAULTS,
  LlmSettings,
  Provider,
  clearCachedSalt,
  clearSessionPassphrase,
  getCachedSalt,
  getSessionPassphrase,
  isSyncEnabled,
  loadSettings,
  saveSettings,
  setCachedSalt,
  setSessionPassphrase,
  setSyncEnabled,
} from "@/lib/llm-settings";
import { decryptJson, deriveKey, encryptJson, randomSaltB64 } from "@/lib/crypto";

type Msg = { role: "user" | "assistant"; content: string };

export function AiChatPanel({ paperId, hasPdf }: { paperId: string; hasPdf: boolean }) {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [processStatus, setProcessStatus] = useState<"unknown" | "ready" | "missing" | "processing" | "error">("unknown");
  const [processInfo, setProcessInfo] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1) Use local settings immediately so the UI isn't blocked.
    setSettings(loadSettings());

    // 2) If sync is enabled and we have a passphrase cached this session,
    //    try to pull the encrypted blob and merge it in. Silent on failure;
    //    user can re-open the dialog and enter the passphrase manually.
    (async () => {
      if (!isSyncEnabled()) return;
      const pass = getSessionPassphrase();
      if (!pass) return;
      try {
        const r = await fetch("/api/me/settings");
        if (!r.ok) return;
        const j = await r.json();
        if (!j?.exists) return;
        const key = await deriveKey(pass, j.salt);
        const remote = await decryptJson<LlmSettings>(j.ciphertext, j.iv, key);
        saveSettings(remote);
        setCachedSalt(j.salt);
        setSettings(remote);
      } catch {
        // wrong passphrase or other issue — leave local settings as-is
      }
    })();

    // 3) probe pdf status
    fetch(`/api/paper/${encodeURIComponent(paperId)}/process`)
      .then((r) => r.json())
      .then((d) => {
        setProcessStatus(d?.ready ? "ready" : "missing");
        if (d?.ready) setProcessInfo(`cached · ${(d.length / 1000).toFixed(0)}k chars`);
      })
      .catch(() => setProcessStatus("missing"));

    // 4) load saved conversation
    fetch(`/api/paper/${encodeURIComponent(paperId)}/chat`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.messages) && d.messages.length > 0) {
          setMessages(d.messages);
        }
      })
      .catch(() => {});
  }, [paperId]);

  async function persistMessages(next: Msg[]) {
    try {
      await fetch(`/api/paper/${encodeURIComponent(paperId)}/chat`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
    } catch {
      // ignore — local state still has it
    }
  }

  async function clearConversation() {
    if (messages.length === 0) return;
    if (!confirm("Clear this paper's conversation?")) return;
    setMessages([]);
    try {
      await fetch(`/api/paper/${encodeURIComponent(paperId)}/chat`, { method: "DELETE" });
    } catch {}
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function processPdf() {
    if (!hasPdf) {
      setProcessStatus("error");
      setProcessInfo("this paper has no PDF link");
      return;
    }
    setProcessStatus("processing");
    setProcessInfo("downloading + extracting…");
    try {
      const r = await fetch(`/api/paper/${encodeURIComponent(paperId)}/process`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        setProcessStatus("error");
        setProcessInfo(d?.error ?? `error ${r.status}`);
        return;
      }
      setProcessStatus("ready");
      setProcessInfo(`${d.cached ? "cached" : "ready"} · ${(d.length / 1000).toFixed(0)}k chars`);
    } catch (e: any) {
      setProcessStatus("error");
      setProcessInfo(e?.message ?? "fetch failed");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!settings) {
      setSettingsOpen(true);
      return;
    }
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paperId,
          messages: next,
          provider: settings.provider,
          apiKey: settings.apiKey,
          model: settings.model,
          baseUrl: settings.baseUrl,
        }),
      });
      if (!r.ok || !r.body) {
        const err = await r.text().catch(() => "");
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${err || `error ${r.status}`}` };
          return copy;
        });
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
      // persist after successful completion
      persistMessages([...next, { role: "assistant", content: acc }]);
    } catch (e: any) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${e?.message ?? "error"}` };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  const ready = processStatus === "ready";
  const canChat = !!settings;

  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-700">Ask AI about this paper</h2>
        <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
          {ready ? (
            <span className="text-emerald-700">● {processInfo || "ready"}</span>
          ) : processStatus === "processing" ? (
            <span>⏳ {processInfo}</span>
          ) : processStatus === "error" ? (
            <span className="text-red-600">⚠ {processInfo}</span>
          ) : (
            <span>not processed</span>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="LLM settings"
            title={settings ? `${settings.provider} · ${settings.model}` : "Configure LLM"}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100"
          >
            <span>⚙</span>
            <span className="hidden sm:inline">
              {settings ? `${settings.provider} · ${settings.model}` : "Configure LLM"}
            </span>
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              aria-label="Clear conversation"
              title="Clear conversation"
              className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100"
            >
              🗑
            </button>
          )}
        </div>
      </header>

      {!ready && (
        <div className="px-3 py-3 text-sm text-zinc-600">
          <p className="mb-2">
            To answer questions about this paper, the server needs to download and extract the PDF text once.
            Abstract-only chat works without processing.
          </p>
          <button
            onClick={processPdf}
            disabled={processStatus === "processing" || !hasPdf}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {processStatus === "processing" ? "Processing…" : "Process for AI"}
          </button>
          {!hasPdf && <p className="mt-2 text-xs text-zinc-500">No PDF link — chat will rely on abstract only.</p>}
        </div>
      )}

      <div ref={scrollRef} className="max-h-[60vh] space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-2 text-sm text-zinc-500">
            <p>Try:</p>
            <ul className="space-y-1">
              {[
                "Summarize this paper in 5 bullet points.",
                "What's the key technical contribution?",
                "Compare with prior work — what's actually new?",
                "用中文给我讲一下这篇论文的核心思路。",
              ].map((q) => (
                <li key={q}>
                  <button
                    onClick={() => setInput(q)}
                    className="rounded bg-zinc-100 px-2 py-1 text-left text-zinc-700 hover:bg-zinc-200"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 whitespace-pre-wrap rounded-md bg-blue-50 px-3 py-2 text-sm text-zinc-900"
                : "mr-8 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-800"
            }
          >
            {m.role === "assistant" ? (
              m.content ? (
                <MarkdownView source={m.content} />
              ) : (
                <span className="text-zinc-400">…</span>
              )
            ) : (
              m.content
            )}
          </div>
        ))}
      </div>

      <footer className="flex gap-2 border-t border-zinc-100 px-3 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={canChat ? "Ask anything about this paper…" : "Configure LLM first →"}
          disabled={streaming}
          className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-400"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="rounded bg-zinc-900 px-3 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Send
        </button>
      </footer>

      {settingsOpen && (
        <LlmSettingsDialog
          initial={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(s) => {
            saveSettings(s);
            setSettings(s);
            setSettingsOpen(false);
          }}
        />
      )}
    </section>
  );
}

function LlmSettingsDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: LlmSettings | null;
  onClose: () => void;
  onSave: (s: LlmSettings) => void;
}) {
  const [provider, setProvider] = useState<Provider>(initial?.provider ?? "openai");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [model, setModel] = useState(initial?.model ?? DEFAULTS.openai.model);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [sync, setSync] = useState<boolean>(isSyncEnabled());
  const [pass, setPass] = useState<string>(getSessionPassphrase() ?? "");
  const [remoteExists, setRemoteExists] = useState<boolean | null>(null);
  const [remoteSalt, setRemoteSalt] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  // On mount, look up whether a remote blob exists so we can show the right CTA.
  useEffect(() => {
    fetch("/api/me/settings")
      .then((r) => r.json())
      .then((j) => {
        setRemoteExists(!!j?.exists);
        if (j?.exists) setRemoteSalt(j.salt);
      })
      .catch(() => setRemoteExists(false));
  }, []);

  function switchProvider(p: Provider) {
    setProvider(p);
    if (!model || model === DEFAULTS[provider].model) setModel(DEFAULTS[p].model);
    if (p === "custom" && !baseUrl) setBaseUrl(DEFAULTS.custom.baseUrl!);
  }

  async function pullFromServer() {
    if (!pass) {
      setSyncMsg("enter passphrase first");
      return;
    }
    setSyncBusy(true);
    setSyncMsg("decrypting…");
    try {
      const r = await fetch("/api/me/settings");
      const j = await r.json();
      if (!j?.exists) {
        setSyncMsg("no remote settings yet");
        return;
      }
      const key = await deriveKey(pass, j.salt);
      const remote = await decryptJson<LlmSettings>(j.ciphertext, j.iv, key);
      setProvider(remote.provider);
      setApiKey(remote.apiKey);
      setModel(remote.model);
      setBaseUrl(remote.baseUrl ?? "");
      setCachedSalt(j.salt);
      setSessionPassphrase(pass);
      setSyncMsg("✓ pulled from server");
    } catch (e: any) {
      setSyncMsg(`× wrong passphrase or bad blob`);
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveAll() {
    const local: LlmSettings = {
      provider,
      apiKey,
      model,
      baseUrl: provider === "custom" ? baseUrl : undefined,
    };
    setSyncEnabled(sync);

    if (sync) {
      if (!pass) {
        setSyncMsg("set a passphrase first");
        return;
      }
      setSyncBusy(true);
      try {
        // Reuse remote salt if one exists; otherwise generate (first-time push).
        let salt = remoteSalt ?? getCachedSalt();
        if (!salt) salt = randomSaltB64();
        const key = await deriveKey(pass, salt);
        const { ciphertext, iv } = await encryptJson(local, key);
        const r = await fetch("/api/me/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ciphertext, iv, salt }),
        });
        if (!r.ok) {
          setSyncMsg(`× upload failed: ${r.status}`);
          setSyncBusy(false);
          return;
        }
        setCachedSalt(salt);
        setSessionPassphrase(pass);
        setSyncMsg("✓ synced");
      } catch (e: any) {
        setSyncMsg(`× encrypt failed: ${e?.message ?? e}`);
        setSyncBusy(false);
        return;
      }
      setSyncBusy(false);
    } else {
      clearCachedSalt();
      clearSessionPassphrase();
    }

    onSave(local);
  }

  async function deleteRemote() {
    if (!confirm("Delete encrypted settings from server? Local copy remains.")) return;
    setSyncBusy(true);
    try {
      await fetch("/api/me/settings", { method: "DELETE" });
      setRemoteExists(false);
      setRemoteSalt(null);
      setSyncMsg("✓ remote deleted");
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-md bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">LLM settings</h3>
        <p className="text-xs text-zinc-500">
          Stored in your browser. Optional end-to-end encrypted sync stores a ciphertext blob on
          our server that we cannot decrypt.
        </p>

        <label className="block text-sm">
          <span className="block text-xs text-zinc-500">Provider</span>
          <div className="mt-1 flex gap-1">
            {(["openai", "anthropic", "custom"] as Provider[]).map((p) => (
              <button
                key={p}
                onClick={() => switchProvider(p)}
                className={`flex-1 rounded border px-2 py-1 text-sm ${
                  provider === p
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 hover:bg-zinc-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </label>

        <label className="block text-sm">
          <span className="block text-xs text-zinc-500">API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              provider === "openai" ? "sk-…" : provider === "anthropic" ? "sk-ant-…" : "your key"
            }
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-400"
          />
        </label>

        <label className="block text-sm">
          <span className="block text-xs text-zinc-500">Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULTS[provider].model}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-400"
          />
        </label>

        {provider === "custom" && (
          <label className="block text-sm">
            <span className="block text-xs text-zinc-500">Base URL (OpenAI-compatible)</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-400"
            />
          </label>
        )}

        <div className="mt-2 rounded border border-zinc-200 p-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sync}
              onChange={(e) => setSync(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Sync across devices (end-to-end encrypted)</span>
          </label>

          {sync && (
            <div className="mt-2 space-y-2">
              <label className="block text-sm">
                <span className="block text-xs text-zinc-500">
                  Passphrase {remoteExists ? "(enter the one you used before)" : "(set one, remember it — can't be recovered)"}
                </span>
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="passphrase"
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-400"
                />
              </label>
              <div className="flex flex-wrap gap-2 text-xs">
                {remoteExists && (
                  <button
                    onClick={pullFromServer}
                    disabled={syncBusy || !pass}
                    className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Pull from server
                  </button>
                )}
                {remoteExists && (
                  <button
                    onClick={deleteRemote}
                    disabled={syncBusy}
                    className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete remote
                  </button>
                )}
                {syncMsg && <span className="self-center text-zinc-500">{syncMsg}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100">
            Cancel
          </button>
          <button
            onClick={saveAll}
            disabled={
              syncBusy ||
              !apiKey ||
              !model ||
              (provider === "custom" && !baseUrl) ||
              (sync && !pass)
            }
            className="rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {sync ? "Save & sync" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
