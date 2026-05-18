import { listPapers, topKeywords } from "@tcr/db/queries";
import { PaperCard } from "@/components/paper-card";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function KeywordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; unseen?: string }>;
}) {
  const { id } = await params;
  const { sort, unseen } = await searchParams;
  const onlyUnseen = unseen === "1";

  const cloud = await topKeywords(500);
  const kw = cloud.find((k) => k.id === id);
  if (!kw) notFound();

  const { id: userId } = await requireUser();
  const allPapers = await listPapers(
    {
      keywordId: id,
      sort: (sort as any) ?? "rating-desc",
      limit: 100,
    },
    userId,
  );
  const papers = onlyUnseen ? allPapers.filter((p) => !p.viewedAt) : allPapers;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-zinc-500">direction</p>
        <h1 className="text-3xl font-bold tracking-tight">{kw.label}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
          <span>
            {papers.length} papers · sort by{" "}
            {(["rating-desc", "recent", "controversial"] as const).map((s) => {
              const q = new URLSearchParams();
              q.set("sort", s);
              if (onlyUnseen) q.set("unseen", "1");
              return (
                <a
                  key={s}
                  href={`?${q.toString()}`}
                  className={`ml-2 underline-offset-2 ${
                    sort === s || (!sort && s === "rating-desc") ? "font-medium underline" : "hover:underline"
                  }`}
                >
                  {s}
                </a>
              );
            })}
          </span>
          <a
            href={(() => {
              const q = new URLSearchParams();
              if (sort) q.set("sort", sort);
              if (!onlyUnseen) q.set("unseen", "1");
              const s = q.toString();
              return s ? `?${s}` : "?";
            })()}
            className={`rounded border px-2 py-0.5 text-xs ${
              onlyUnseen
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {onlyUnseen ? "Showing unseen" : "Show unseen only"}
          </a>
        </p>
      </header>
      <div className="grid gap-3">
        {papers.map((p) => (
          <PaperCard key={p.id} p={p as any} />
        ))}
      </div>
    </div>
  );
}
