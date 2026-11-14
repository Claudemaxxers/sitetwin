import { notFound } from "next/navigation";
import AppShell, { type Ansicht } from "@/components/app/AppShell";
import { getProjektDaten, supabaseConfigured } from "@/lib/sb";

export const dynamic = "force-dynamic";

export default async function ProjektPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ansicht?: string }> }) {
  if (!supabaseConfigured()) notFound();
  const { id } = await params;
  const daten = await getProjektDaten(decodeURIComponent(id));
  if (!daten) notFound();
  const { ansicht } = await searchParams;
  const start = (["aenderungen", "inbox", "bautagebuch", "protokoll", "benachrichtigungen"] as const).find((a) => a === ansicht) as Ansicht | undefined;
  return <AppShell initial={daten} start={start} />;
}
