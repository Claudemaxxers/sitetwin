import { getAnhang, supabaseConfigured } from "@/lib/sb";

export const dynamic = "force-dynamic";

/** Streams a photo, voice note or plan PDF from the private `ablage` bucket. No listing. */
export async function GET(req: Request) {
  const pfad = new URL(req.url).searchParams.get("pfad") ?? "";
  if (!supabaseConfigured() || !/^[\w\-/]+\.(jpe?g|png|webp|heic|pdf|opus|ogg|m4a|mp3)$/i.test(pfad) || pfad.includes("..")) {
    return new Response("not found", { status: 404 });
  }
  const res = await getAnhang(pfad);
  if (!res.ok || !res.body) return new Response("not found", { status: 404 });
  const ext = pfad.split(".").pop()!.toLowerCase();
  const type = ext === "pdf" ? "application/pdf" : ext === "opus" || ext === "ogg" ? "audio/ogg" : ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : res.headers.get("content-type") ?? "image/jpeg";
  return new Response(res.body, {
    headers: { "content-type": type, "content-disposition": "inline", "cache-control": "private, max-age=3600" },
  });
}
