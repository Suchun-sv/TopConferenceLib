import { listVenues } from "@tcr/db/queries";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  const venues = await listVenues();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Venues</h1>
      <ul className="grid gap-2 sm:grid-cols-2">
        {venues.map((v) => (
          <li key={v.id}>
            <Link
              href={`/v/${v.id}`}
              className="block rounded-md border border-zinc-200 bg-white p-3 hover:bg-zinc-50"
            >
              <span className="font-medium">{v.conference} {v.year}</span>
              <span className="ml-2 text-sm text-zinc-500">{v.paperCount} papers</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
