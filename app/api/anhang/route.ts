import { getAnhang, supabaseConfigured } from "@/lib/sb";

export const dynamic = "force-dynamic";

/** Streams a photo from the private `ablage` bucket. Only images, no listing. */
export async function GET(req: Request) {
  const pfad = new URL(req.url).searchParams.get("pfad") ?? "";
  if (!supabaseConfigured() || !/^[\w\-/]+\.(jpe?g|png|webp|heic)$/i.test(pfad) || pfad.includes("..")) {
    return new Response("not found", { status: 404 });
  }
  const res = await getAnhang(pfad);
  if (!res.ok || !res.body) return new Response("not found", { status: 404 });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
