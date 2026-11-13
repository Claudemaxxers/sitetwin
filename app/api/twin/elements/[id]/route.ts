import { ROOMS, WALLS, elementName, wallsFor } from "@/lib/model";
import { getEvents, getFlags } from "@/lib/store";
import { deriveTwin } from "@/lib/twin";

export const dynamic = "force-dynamic";

/** Machine-readable twin for agents and robots: GET /api/twin/elements/EG-W-12 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const walls = wallsFor(id);
  if (!walls.length) return Response.json({ error: "unbekanntes Element", known: [...ROOMS, ...WALLS].map((x) => x.id) }, { status: 404 });
  const events = getEvents();
  const twin = deriveTwin(events);
  const flags = getFlags().filter((f) => walls.includes(f.elementId) || f.elementId === id);
  const byId = new Map(events.map((e) => [e.id, e]));
  return Response.json({
    id,
    name: elementName(id),
    walls: walls.map((w) => ({
      ...twin[w],
      name: elementName(w),
      geometry: WALLS.find((x) => x.id === w),
      history: twin[w].history.map((h) => byId.get(h)).filter(Boolean),
    })),
    openFlags: flags.filter((f) => f.status === "open"),
    blocked: flags.some((f) => f.status === "stopped"),
  });
}
