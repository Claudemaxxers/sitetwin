import { describe, expect, it } from "vitest";
import { telefonConfig, type TelefonConfig } from "@/lib/telefon/config";
import { e164, offeneSignaleAnrufen, personZu, telefonnummer, versuche } from "@/lib/telefon/dispatcher";
import { anrufBody, signalOrt, signaturGueltig, signieren, vorname } from "@/lib/telefon/elevenlabs";
import type { Person, Signal, SignalDB, VerlaufZeile } from "@/lib/telefon/types";
import { ablagePayload, ereignisVerarbeiten, type ElevenEvent } from "@/lib/telefon/webhook";

const cfg: TelefonConfig = {
  ...telefonConfig({}),
  apiKey: "k",
  agentId: "agent_x",
  phoneNumberId: "phnum_y",
  webhookSecret: "geheim",
};

let n = 0;
function signal(teile: Partial<Signal> = {}): Signal {
  n += 1;
  return {
    id: `s${n}`,
    projekt: "BV Simmering",
    schluessel: `k${n}`,
    art: "reihenfolge",
    schwere: "kritisch",
    titel: "Wand zu vor Installation",
    begruendung: "Leerverrohrung fehlt",
    anruf_text: "Servus Stefan, die Wand im Abstellraum Top 5 bitte noch nicht zumachen.",
    top: "Top 5",
    raum: "Abstellraum",
    element: "Wand W3",
    eintrag_ids: [],
    quelle_hashes: [],
    status: "offen",
    zustaendig: "Stefan Huber",
    telefon: null,
    anruf_id: null,
    angerufen_am: null,
    geloest_am: null,
    geloest_durch: null,
    bewertung: null,
    erstellt_am: "2026-11-14T08:00:00Z",
    aktualisiert_am: "2026-11-14T08:00:00Z",
    ...teile,
  } as Signal;
}

const personen: Person[] = [
  { projekt: "BV Simmering", name: "Stefan Huber", aliase: ["Huber (Elektro Gruber)", "Stefan"], rolle: "vorarbeiter", telefon: "+43 660 000 00 01" },
  { projekt: "BV Simmering", name: "Thomas Meier", aliase: ["Meier (Krenn Bau)"], rolle: "bauleitung", telefon: "0664 1234567" },
];

/** In-memory database, logs all changes. */
function fakeDB(signale: Signal[], verlauf: VerlaufZeile[] = []) {
  const aenderungen: { id: string; felder: Partial<Signal> }[] = [];
  const db: SignalDB = {
    offeneSignale: async () => signale.filter((s) => s.status === "offen" && !s.angerufen_am),
    personen: async () => personen,
    verlauf: async () => verlauf,
    signalBeanspruchen: async (id, am) => {
      const s = signale.find((x) => x.id === id);
      if (!s || s.angerufen_am) return false;
      s.angerufen_am = am;
      return true;
    },
    signalAendern: async (id, felder) => {
      aenderungen.push({ id, felder });
      Object.assign(signale.find((x) => x.id === id) ?? {}, felder);
    },
    signalZuAnruf: async (conv) => signale.find((x) => x.anruf_id === conv) ?? null,
  };
  return { db, aenderungen };
}

describe("Telefonnummern", () => {
  it("normalisiert nach E.164", () => {
    expect(e164("+43 660 000 00 00")).toBe("+436600000000");
    expect(e164("0664-123 4567")).toBe("+436641234567");
    expect(e164("0049 171 1234567")).toBe("+491711234567");
    expect(e164("+1 (989) 718-8160")).toBe("+19897188160");
    expect(e164("")).toBeNull();
    expect(e164("Büro")).toBeNull();
  });

  it("findet die Person über Name, Alias oder Nachname", () => {
    expect(personZu("Stefan Huber", personen)?.name).toBe("Stefan Huber");
    expect(personZu("Huber (Elektro Gruber)", personen)?.name).toBe("Stefan Huber");
    expect(personZu("Meier", personen)?.name).toBe("Thomas Meier");
    expect(personZu("Unbekannt", personen)).toBeNull();
    expect(personZu(null, personen)).toBeNull();
  });

  it("nimmt die Nummer aus dem Signal, sonst aus personen, und die Testnummer vor allem", () => {
    expect(telefonnummer(signal(), personen, cfg)).toBe("+436600000001");
    expect(telefonnummer(signal({ telefon: "0699 9999999" }), personen, cfg)).toBe("+436999999999");
    expect(telefonnummer(signal({ zustaendig: "Niemand" }), personen, cfg)).toBeNull();
    expect(telefonnummer(signal(), personen, { ...cfg, testnummer: "+49 171 0000000" })).toBe("+491710000000");
  });
});

describe("ElevenLabs-Anruf", () => {
  it("schickt nur dynamic_variables, keine conversation_config_override", () => {
    const s = signal();
    const body = anrufBody(s, "+436600000001", cfg);
    expect(body.agent_id).toBe("agent_x");
    expect(body.agent_phone_number_id).toBe("phnum_y");
    expect(body.to_number).toBe("+436600000001");
    expect(Object.keys(body.conversation_initiation_client_data)).toEqual(["dynamic_variables"]);
    const v = body.conversation_initiation_client_data.dynamic_variables;
    expect(v.anruf_modus).toBe("ausgehend");
    expect(v.zustaendig_name).toBe("Stefan Huber");
    expect(v.signal_id).toBe(s.id);
    expect(v.signal_filter).toBe(`eq.${s.id}`);
    expect(v.signal_titel).toBe(s.titel);
    expect(v.anruf_text).toBe(s.anruf_text);
    expect(v.signal_begruendung).toBe(s.begruendung);
    expect(v.signal_ort).toBe("Top 5, Abstellraum");
    expect(v.projekt_name).toBe("BV Simmering");
  });

  it("Ort und Vorname fallen sinnvoll zurück", () => {
    expect(signalOrt({ top: null, raum: null, element: "Wand W3" })).toBe("Wand W3");
    expect(signalOrt({ top: null, raum: null, element: null })).toBe("der Baustelle");
    expect(vorname("Huber (Elektro Gruber)")).toBe("Huber");
    expect(vorname(null)).toBe("");
  });

  it("prüft die Webhook-Signatur wie das ElevenLabs-SDK", () => {
    const body = '{"type":"post_call_transcription"}';
    const t = Math.floor(Date.now() / 1000);
    const header = signieren(body, "geheim", t);
    expect(header).toMatch(/^t=\d+,v0=[0-9a-f]{64}$/);
    expect(signaturGueltig(body, header, "geheim")).toBe(true);
    expect(signaturGueltig(body + " ", header, "geheim")).toBe(false);
    expect(signaturGueltig(body, header, "anders")).toBe(false);
    expect(signaturGueltig(body, null, "geheim")).toBe(false);
    expect(signaturGueltig(body, header, "")).toBe(false);
    const alt = signieren(body, "geheim", t - 31 * 60);
    expect(signaturGueltig(body, alt, "geheim")).toBe(false);
  });
});

describe("Dispatcher", () => {
  it("ruft offene Signale an und setzt in_bearbeitung, anruf_id, angerufen_am, telefon", async () => {
    const s = signal();
    const { db, aenderungen } = fakeDB([s, signal({ status: "geloest" })]);
    const gestartet: string[] = [];
    const bericht = await offeneSignaleAnrufen(db, cfg, async (body) => {
      gestartet.push(body.to_number);
      return { success: true, message: "ok", conversation_id: "conv_1", callSid: "CA1" };
    });
    expect(gestartet).toEqual(["+436600000001"]);
    expect(bericht.angerufen).toHaveLength(1);
    expect(bericht.angerufen[0]).toMatchObject({ signal_id: s.id, conversation_id: "conv_1", telefon: "+436600000001", versuch: 1 });
    expect(aenderungen[0].felder).toMatchObject({ status: "in_bearbeitung", anruf_id: "conv_1", telefon: "+436600000001" });
    expect(s.status).toBe("in_bearbeitung");
    expect(s.angerufen_am).toBeTruthy();
  });

  it("ruft im Trockenlauf nichts an und ändert nichts", async () => {
    const { db, aenderungen } = fakeDB([signal()]);
    let aufrufe = 0;
    const bericht = await offeneSignaleAnrufen(db, { ...cfg, trocken: true }, async () => {
      aufrufe += 1;
      return { success: true, message: "", conversation_id: "x", callSid: null };
    });
    expect(aufrufe).toBe(0);
    expect(bericht.trocken).toBe(true);
    expect(bericht.angerufen[0].conversation_id).toBeNull();
    expect(aenderungen).toHaveLength(0);
  });

  it("überspringt ohne Zugangsdaten und ohne Nummer", async () => {
    const { db } = fakeDB([signal({ zustaendig: "Niemand" })]);
    const ohneKey = await offeneSignaleAnrufen(db, { ...cfg, apiKey: "" });
    expect(ohneKey.uebersprungen[0].grund).toMatch(/ELEVENLABS_API_KEY/);
    const ohneNummer = await offeneSignaleAnrufen(db, cfg, async () => {
      throw new Error("darf nicht aufgerufen werden");
    });
    expect(ohneNummer.uebersprungen[0].grund).toMatch(/keine Telefonnummer/);
  });

  it("gibt das Signal frei, wenn der Anruf nicht gestartet werden konnte", async () => {
    const s = signal();
    const { db } = fakeDB([s]);
    const bericht = await offeneSignaleAnrufen(db, cfg, async () => {
      throw new Error("422 to_number");
    });
    expect(bericht.uebersprungen[0].grund).toMatch(/422/);
    expect(s.angerufen_am).toBeNull();
    expect(s.status).toBe("offen");
  });

  it("begrenzt Versuche und hält die Wartezeit ein", async () => {
    const s1 = signal();
    const s2 = signal();
    const jetzt = new Date("2026-11-14T10:00:00Z");
    const verlauf: VerlaufZeile[] = [
      ...[1, 2, 3].map((i) => ({ signal_id: s1.id, status: "in_bearbeitung", zeitpunkt: `2026-11-14T0${i}:00:00Z` })),
      { signal_id: s2.id, status: "in_bearbeitung", zeitpunkt: "2026-11-14T09:55:00Z" },
    ];
    expect(versuche(s1.id, verlauf).anzahl).toBe(3);
    const { db } = fakeDB([s1, s2], verlauf);
    const bericht = await offeneSignaleAnrufen(db, cfg, async () => ({ success: true, message: "", conversation_id: "c", callSid: null }), () => jetzt);
    expect(bericht.angerufen).toHaveLength(0);
    expect(bericht.uebersprungen.map((u) => u.grund)).toEqual([expect.stringMatching(/3× versucht/), expect.stringMatching(/weniger als 10 Minuten/)]);
  });
});

describe("Webhook", () => {
  const start = Date.UTC(2026, 10, 14, 9, 51, 40) / 1000;
  const transkript: ElevenEvent = {
    type: "post_call_transcription",
    event_timestamp: start + 100,
    data: {
      agent_id: "agent_x",
      conversation_id: "conv_1",
      status: "done",
      transcript: [
        { role: "agent", message: "Servus, hier ist Leni.", time_in_call_secs: 0 },
        { role: "user", message: "Ja, passt.", time_in_call_secs: 3 },
        { role: "agent", message: null, time_in_call_secs: 5 },
      ],
      metadata: { start_time_unix_secs: start, call_duration_secs: 90 },
      analysis: { transcript_summary: "Stefan wartet mit der Wand.", call_successful: "success" },
      conversation_initiation_client_data: { dynamic_variables: { projekt_name: "BV Simmering", zustaendig_name: "Stefan Huber" } },
    },
  };

  it("baut den Ablage-Vertrag v1 aus dem Transkript", () => {
    const p = ablagePayload(transkript, signal({ anruf_id: "conv_1", telefon: "+436600000001" }));
    expect(p.call_id).toBe("conv_1");
    expect(p.gestartet_um).toBe("2026-11-14T09:51:40.000Z");
    expect(p.beendet_um).toBe("2026-11-14T09:53:10.000Z");
    expect(p.transkript).toEqual([
      { rolle: "agent", text: "Servus, hier ist Leni." },
      { rolle: "person", text: "Ja, passt." },
    ]);
    expect(p).toMatchObject({ projekt: "BV Simmering", angerufene_person: "Stefan Huber", telefon: "+436600000001", richtung: "outbound", zusammenfassung: "Stefan wartet mit der Wand." });
  });

  it("leitet das Transkript an die Ablage weiter und lässt den Status in Ruhe", async () => {
    const s = signal({ anruf_id: "conv_1", status: "in_bearbeitung", angerufen_am: "2026-11-14T09:51:00Z" });
    const { db, aenderungen } = fakeDB([s]);
    const anfragen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      anfragen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const erg = await ereignisVerarbeiten(transkript, db, { ...cfg, ablageUrl: "http://ablage:8000/", ablageToken: "tok" }, fetchFn);
    expect(erg.aktion).toBe("transkript_weitergeleitet");
    expect(anfragen[0].url).toBe("http://ablage:8000/import/call");
    expect(anfragen[0].headers["X-Ablage-Token"]).toBe("tok");
    expect(JSON.parse(anfragen[0].body).call_id).toBe("conv_1");
    expect(aenderungen).toHaveLength(0);
    expect(s.status).toBe("in_bearbeitung");
  });

  it("meldet, wenn keine Ablage konfiguriert ist, und wirft bei Ablage-Fehler", async () => {
    const { db } = fakeDB([signal({ anruf_id: "conv_1" })]);
    const ohne = await ereignisVerarbeiten(transkript, db, { ...cfg, ablageUrl: "" });
    expect(ohne.aktion).toBe("transkript_ohne_ablage");
    const kaputt = (async () => new Response("Fehler", { status: 500 })) as typeof fetch;
    await expect(ereignisVerarbeiten(transkript, db, { ...cfg, ablageUrl: "http://ablage" }, kaputt)).rejects.toThrow(/500/);
  });

  it("setzt bei call_initiation_failure zurück auf offen, damit erneut versucht wird", async () => {
    const s = signal({ anruf_id: "conv_1", status: "in_bearbeitung", angerufen_am: "2026-11-14T09:51:00Z" });
    const { db } = fakeDB([s]);
    const erg = await ereignisVerarbeiten({ type: "call_initiation_failure", data: { conversation_id: "conv_1", failure_reason: "no-answer" } }, db, cfg);
    expect(erg).toMatchObject({ aktion: "anruf_fehlgeschlagen", signal_id: s.id, details: "no-answer" });
    expect(s.status).toBe("offen");
    expect(s.angerufen_am).toBeNull();
    expect(s.anruf_id).toBe("conv_1");
  });

  it("ignoriert unbekannte Ereignisse", async () => {
    const { db } = fakeDB([]);
    const erg = await ereignisVerarbeiten({ type: "post_call_audio", data: { conversation_id: "conv_9" } }, db, cfg);
    expect(erg.aktion).toBe("ignoriert");
  });
});
