import { listPapers, listVenues } from "@tcr/db/queries";
import { PaperCard } from "@/components/paper-card";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function VenuePage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string }> },
) {
  const { id } = await params;
  const { sort } = await searchParams;

  const venues = await listVenues();
  const v = venues.find((x) => x.id === id);
  if (!v) notFound();

  const papers = await listPapers({ venueId: id, sort: (sort as any) ?? "rating-desc", limit: 100 });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-zinc-500">venue</p>
        <h1 className="text-3xl font-bold tracking-tight">{v.conference} {v.year}</h1>
        <p className="mt-1 text-sm text-zinc-600">{v.paperCount} papers</p>
      </header>
      <div className="grid gap-3">
        {papers.map((p) => (
          <PaperCard key={p.id} p={p as any} />
        ))}
      </div>
    </div>
  );
}
