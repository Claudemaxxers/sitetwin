import { NextResponse } from "next/server";
import { getProjektDaten, supabaseConfigured } from "@/lib/sb";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_KEY fehlen" }, { status: 500 });
  const { id } = await params;
  try {
    const daten = await getProjektDaten(decodeURIComponent(id));
    if (!daten) return NextResponse.json({ error: "Projekt nicht gefunden" }, { status: 404 });
    return NextResponse.json(daten);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
