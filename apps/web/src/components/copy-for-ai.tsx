"use client";

import { useState } from "react";

export type CopyForAiPaper = {
  id: string;
  title: string;
  titleZh?: string | null;
  authors: string[];
  venueId: string;
  decision: string | null;
  abstract: string | null;
  abstractZh?: string | null;
  openreviewUrl: string | null;
  pdfUrl: string | null;
};

function buildMarkdown(p: CopyForAiPaper): string {
  const lines: string[] = [];
  lines.push(`# ${p.title}`);
  if (p.titleZh) lines.push(`*（中文）${p.titleZh}*`);
  lines.push("");
  lines.push(`**Authors:** ${p.authors.join(", ")}`);
  lines.push(`**Venue:** ${p.venueId}${p.decision ? ` · ${p.decision}` : ""}`);
  if (p.pdfUrl) lines.push(`**PDF:** ${p.pdfUrl}`);
  if (p.openreviewUrl) lines.push(`**Source:** ${p.openreviewUrl}`);
  lines.push("");
  if (p.abstract) {
    lines.push("## Abstract");
    lines.push(p.abstract);
    lines.push("");
  }
  if (p.abstractZh) {
    lines.push("## 摘要（中文）");
    lines.push(p.abstractZh);
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Please read the paper at the PDF/Source link above, give me a thorough summary, then wait for my questions.",
  );
  return lines.join("\n");
}

export function CopyForAi({ paper }: { paper: CopyForAiPaper }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");

  async function onClick() {
    const md = buildMarkdown(paper);
    try {
      await navigator.clipboard.writeText(md);
      setState("ok");
    } catch {
      // Fallback for non-secure contexts: textarea + execCommand
      const ta = document.createElement("textarea");
      ta.value = md;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setState("ok");
      } catch {
        setState("err");
      }
      document.body.removeChild(ta);
    }
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <button
      onClick={onClick}
      title="Copy paper metadata + a summarise-and-wait prompt for ChatGPT / Claude"
      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
    >
      {state === "ok" ? "✓ Copied" : state === "err" ? "× Failed" : "Copy for AI"}
    </button>
  );
}
