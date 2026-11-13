import { getEvents, getFlags } from "@/lib/store";
import { deriveTwin } from "@/lib/twin";

export const dynamic = "force-dynamic";

export function GET() {
  const events = getEvents();
  return Response.json({
    events,
    flags: getFlags(),
    twin: deriveTwin(events),
    engine: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "claude" : "heuristic",
  });
}
