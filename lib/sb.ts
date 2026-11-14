import "server-only";
import type { ProjektDaten, Projekt } from "./twin-model";

/**
 * Read-only access to Hendrik's structured Supabase database (uebersetzer/schema.sql).
 * Runs on the server only: the service key never reaches the browser.
 */
const URL = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_KEY ?? "";

export function supabaseConfigured() {
  return Boolean(URL && KEY);
}

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

export async function getProjekte(): Promise<Projekt[]> {
  return rest<Projekt[]>("projekte?select=*&order=angelegt_am");
}

export async function getProjektDaten(projekt: string): Promise<ProjektDaten | null> {
  const p = eq(projekt);
  const [projekte, tops, eintraege, signale, plaene, lv, verlauf, quellen, sollAenderungen, checkFirst] = await Promise.all([
    rest<Projekt[]>(`projekte?select=*&projekt=${p}`),
    rest<ProjektDaten["tops"]>(`tops?select=*&projekt=${p}`),
    rest<ProjektDaten["eintraege"]>(`eintraege_mit_quelle?select=*&projekt=${p}&order=zeitpunkt.asc,nr.asc`),
    rest<ProjektDaten["signale"]>(`signale?select=*&projekt=${p}&order=erstellt_am.asc`),
    rest<ProjektDaten["plaene"]>(`plaene_aktuell?select=*&projekt=${p}`),
    rest<ProjektDaten["lv"]>(`lv_positionen?select=*&projekt=${p}&order=pos_nr`),
    rest<ProjektDaten["verlauf"]>(`signal_verlauf?select=*&order=zeitpunkt.asc`).catch(() => [] as ProjektDaten["verlauf"]),
    rest<ProjektDaten["quellen"]>(`quellen?select=typ,kanal,absender,zeitpunkt,text,anhang_pfad,anhang_typ,anhang_name,content_hash&projekt=${p}&order=zeitpunkt.asc.nullslast`).catch(() => [] as ProjektDaten["quellen"]),
    rest<ProjektDaten["sollAenderungen"]>(`soll_aenderungen?select=*&projekt=${p}&order=erstellt_am.asc`).catch(() => [] as ProjektDaten["sollAenderungen"]),
    rest<NonNullable<ProjektDaten["checkFirst"]>>(`check_first?select=*&projekt=${p}&order=zeitpunkt.asc`).catch(() => null),
  ]);
  if (!projekte[0]) return null;
  const ids = new Set(signale.map((x) => x.id));
  return { projekt: projekte[0], quellen, sollAenderungen, checkFirst, tops, eintraege, signale, plaene, lv, verlauf: verlauf.filter((v) => ids.has(v.signal_id)), geladen: new Date().toISOString() };
}

/** Photos and PDFs live in Santino's private bucket; stream them through the server. */
export async function getAnhang(pfad: string): Promise<Response> {
  const bucket = process.env.ABLAGE_BUCKET ?? "ablage";
  const clean = pfad.replace(/^\/+/, "").replace(new RegExp(`^${bucket}/`), "");
  return fetch(`${URL}/storage/v1/object/${bucket}/${clean.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: "no-store",
  });
}
