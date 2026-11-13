import "server-only";

const API = "https://api.telegram.org";

function token() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

/** Send to the superintendent chat; silently does nothing when not configured. */
export async function notifySuperintendent(text: string) {
  const chatId = process.env.TELEGRAM_SUPER_CHAT_ID;
  if (!token() || !chatId) return;
  await sendMessage(chatId, text);
}

export async function sendMessage(chatId: string | number, text: string) {
  if (!token()) return;
  try {
    await fetch(`${API}/bot${token()}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("[telegram] send failed:", err instanceof Error ? err.message : err);
  }
}

/** Download the largest version of a Telegram photo as base64. */
export async function downloadPhoto(fileId: string): Promise<string | null> {
  if (!token()) return null;
  const meta = (await (await fetch(`${API}/bot${token()}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as {
    ok: boolean;
    result?: { file_path: string };
  };
  if (!meta.ok || !meta.result) return null;
  const buf = await (await fetch(`${API}/file/bot${token()}/${meta.result.file_path}`)).arrayBuffer();
  return Buffer.from(buf).toString("base64");
}
