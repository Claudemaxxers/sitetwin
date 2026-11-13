import { ingest, type IngestInput } from "@/lib/pipeline";

const SOURCES = ["telegram", "mail", "foto", "chat", "ui"] as const;
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<IngestInput>;
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : "";
  const sender = typeof body.sender === "string" && body.sender.trim() ? body.sender.slice(0, 120) : "Unbekannt";
  const source = SOURCES.includes(body.source as never) ? body.source! : "chat";
  const image =
    body.image && typeof body.image.data === "string" && MEDIA.includes(body.image.mediaType as never) ? body.image : undefined;
  if (!text && !image) return Response.json({ error: "text oder image nötig" }, { status: 400 });
  return Response.json(await ingest({ source, sender, text, image }));
}
