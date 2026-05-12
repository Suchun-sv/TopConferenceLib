import { listPapersForVenueSectioned, listVenues } from "@tcr/db/queries";
import { PaperRow } from "@/components/paper-row";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function slugSection(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venues = await listVenues();
  const v = venues.find((x) => x.id === id);
  if (!v) notFound();

  const rows = await listPapersForVenueSectioned(id);

  // group preserving order (rows are already sorted by primaryArea ASC)
  const sections = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.primaryArea;
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(r);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-zinc-500">venue</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {v.conference} {v.year}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          {rows.length} papers in {sections.size} sections · sorted A–Z, then oral / spotlight / poster
        </p>
      </header>

      {/* Sticky table of contents — collapses on mobile */}
      <details className="rounded-md border border-zinc-200 bg-white p-3 sm:sticky sm:top-2 sm:z-10">
        <summary className="cursor-pointer select-none text-sm font-medium">
          Jump to section ({sections.size})
        </summary>
        <ul className="mt-2 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[...sections.keys()].map((k) => (
            <li key={k}>
              <a href={`#${slugSection(k)}`} className="block truncate text-zinc-600 hover:text-zinc-900 hover:underline">
                {k}{" "}
                <span className="text-xs text-zinc-400">({sections.get(k)!.length})</span>
              </a>
            </li>
          ))}
        </ul>
      </details>

      {/* sections */}
      <div className="space-y-8">
        {[...sections.entries()].map(([area, items]) => (
          <section key={area} id={slugSection(area)} className="scroll-mt-4">
            <h2 className="mb-2 border-b border-zinc-200 pb-1 text-sm font-semibold uppercase tracking-wide text-zinc-700">
              {area} <span className="ml-1 font-normal text-zinc-400">· {items.length}</span>
            </h2>
            <ul>
              {items.map((p) => (
                <PaperRow key={p.id} p={p as any} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
