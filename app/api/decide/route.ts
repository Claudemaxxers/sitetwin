import { decide } from "@/lib/pipeline";

export async function POST(req: Request) {
  const { flagId, outcome, comment, by } = (await req.json()) as {
    flagId?: string; outcome?: string; comment?: string; by?: string;
  };
  if (!flagId || (outcome !== "approve" && outcome !== "stop")) {
    return Response.json({ error: "flagId und outcome (approve|stop) nötig" }, { status: 400 });
  }
  try {
    return Response.json(await decide(flagId, outcome, (comment ?? "").slice(0, 500), by?.slice(0, 80) || undefined));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Fehler" }, { status: 409 });
  }
}
