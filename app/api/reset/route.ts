import { resetStore } from "@/lib/store";

export function POST() {
  resetStore();
  return Response.json({ ok: true });
}
