import { subscribe } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Server-Sent Events: tells clients to refresh whenever the record changes. */
export function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (kind: string) => controller.enqueue(enc.encode(`data: ${kind}\n\n`));
      send("hello");
      const unsub = subscribe(send);
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 20_000);
      cleanup = () => { unsub(); clearInterval(ping); };
      req.signal.addEventListener("abort", () => { cleanup(); try { controller.close(); } catch {} });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
