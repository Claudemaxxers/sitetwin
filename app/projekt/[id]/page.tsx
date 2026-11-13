import { notFound } from "next/navigation";
import TwinView from "@/components/TwinView";
import { getProjektDaten, supabaseConfigured } from "@/lib/sb";

export const dynamic = "force-dynamic";

export default async function ProjektPage({ params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) notFound();
  const { id } = await params;
  const daten = await getProjektDaten(decodeURIComponent(id));
  if (!daten) notFound();
  return <TwinView initial={daten} />;
}
