import { listVenues } from "@tcr/db/queries";
import { notFound } from "next/navigation";
import { VenueList } from "@/components/venue-list";

export const dynamic = "force-dynamic";

export default async function VenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ unseen?: string }>;
}) {
  const { id } = await params;
  const { unseen } = await searchParams;
  const onlyUnseen = unseen === "1";
  const venues = await listVenues();
  const v = venues.find((x) => x.id === id);
  if (!v) notFound();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-zinc-500">venue</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {v.conference} {v.year}
        </h1>
      </header>
      <VenueList venueId={id} unseen={onlyUnseen} />
    </div>
  );
}
