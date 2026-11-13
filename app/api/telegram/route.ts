import { ingest } from "@/lib/pipeline";
import { downloadPhoto, sendMessage } from "@/lib/telegram";

interface TgUpdate {
  message?: {
    chat: { id: number };
    from?: { first_name?: string; last_name?: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number }[];
  };
}

/** Telegram webhook: every group message becomes input for the twin. */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json()) as TgUpdate;
  const msg = update.message;
  if (!msg) return Response.json({ ok: true });
  const sender = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Telegram";
  const text = msg.text ?? msg.caption ?? "";
  let image;
  if (msg.photo?.length) {
    const largest = msg.photo.reduce((a, b) => (b.width > a.width ? b : a));
    const data = await downloadPhoto(largest.file_id);
    if (data) image = { data, mediaType: "image/jpeg" as const };
  }
  if (!text && !image) return Response.json({ ok: true });
  const result = await ingest({ source: "telegram", sender, text, image });
  if ("answer" in result && result.answer) {
    await sendMessage(msg.chat.id, `🤖 ${result.answer}`);
    return Response.json({ ok: true });
  }
  const critical = result.flags.filter((f) => f.severity !== "medium");
  if (critical.length) {
    await sendMessage(msg.chat.id, `⚠️ Achtung: ${critical.map((f) => f.title).join("; ")}. Bauleitung ist informiert, bitte auf Freigabe warten.`);
  } else if (result.flags.some((f) => f.rule === "low_confidence")) {
    await sendMessage(msg.chat.id, `❓ ${sender}, welches Bauteil meinst du genau (Raum / Wandnummer)?`);
  }
  return Response.json({ ok: true });
}
