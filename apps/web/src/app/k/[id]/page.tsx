import { listPapers, topKeywords } from "@tcr/db/queries";
import { PaperCard } from "@/components/paper-card";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function KeywordPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string }> },
) {
  const { id } = await params;
  const { sort } = await searchParams;

  const cloud = await topKeywords(500);
  const kw = cloud.find((k) => k.id === id);
  if (!kw) notFound();

  const papers = await listPapers({
    keywordId: id,
    sort: (sort as any) ?? "rating-desc",
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-zinc-500">direction</p>
        <h1 className="text-3xl font-bold tracking-tight">{kw.label}</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {kw.paperCount} papers · sort by{" "}
          {(["rating-desc", "recent", "controversial"] as const).map((s) => (
            <a key={s} href={`?sort=${s}`} className={`ml-2 underline-offset-2 ${sort === s || (!sort && s === "rating-desc") ? "font-medium underline" : "hover:underline"}`}>
              {s}
            </a>
          ))}
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
