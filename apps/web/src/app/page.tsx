import { listVenues, topKeywords } from "@tcr/db/queries";
import { KeywordCloud } from "@/components/keyword-cloud";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [cloud, venues] = await Promise.all([
    topKeywords(200),
    listVenues(),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Research directions</h1>
        <p className="mb-6 text-zinc-600">
          Click any keyword to see papers in that direction. Bigger = more papers; blue = trending recently.
        </p>
        <KeywordCloud items={cloud} />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Venues</h2>
        <ul className="flex flex-wrap gap-2">
          {venues.length === 0 && (
            <li className="text-sm text-zinc-500">No venues ingested yet.</li>
          )}
          {venues.map((v) => (
            <li key={v.id}>
              <Link
                href={`/v/${v.id}`}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm hover:bg-zinc-50"
              >
                {v.conference} {v.year}
                <span className="ml-2 text-xs text-zinc-500">{v.paperCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
