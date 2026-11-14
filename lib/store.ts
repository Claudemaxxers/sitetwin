import "server-only";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedEvents } from "./scenario";
import type { Flag, SiteEvent } from "./types";

/**
 * Append-only event log + flags in SQLite (node:sqlite, no native build).
 * Events are never updated or deleted, only appended.
 */
const g = globalThis as unknown as { __sitetwin?: { db: DatabaseSync; bus: EventEmitter } };

/**
 * Lokal liegt die Datenbank unter ./data. Auf Vercel ist das Projektverzeichnis
 * schreibgeschützt, dort geht sie nach /tmp: flüchtig, pro Funktionsinstanz,
 * und wird bei jedem Kaltstart neu mit den Startdaten gefüllt.
 */
function dataDir() {
  return process.env.VERCEL ? path.join(os.tmpdir(), "sitetwin") : path.join(process.cwd(), "data");
}

function init() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "sitetwin.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, ts TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS flags  (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, ts TEXT, data TEXT);
  `);
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  if (count.n === 0) insertEvents(db, seedEvents());
  return { db, bus };
}

function insertEvents(db: DatabaseSync, events: SiteEvent[]) {
  const stmt = db.prepare("INSERT INTO events (id, ts, data) VALUES (?, ?, ?)");
  for (const e of events) stmt.run(e.id, e.ts, JSON.stringify(e));
}

function ctx() {
  return (g.__sitetwin ??= init());
}

export function getEvents(): SiteEvent[] {
  return (ctx().db.prepare("SELECT data FROM events ORDER BY seq").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function getFlags(): Flag[] {
  return (ctx().db.prepare("SELECT data FROM flags ORDER BY seq").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function appendEvent(e: SiteEvent) {
  insertEvents(ctx().db, [e]);
}

export function saveFlag(f: Flag) {
  ctx()
    .db.prepare("INSERT INTO flags (id, ts, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(f.id, f.ts, JSON.stringify(f));
}

export function resetStore() {
  const { db } = ctx();
  db.exec("DELETE FROM events; DELETE FROM flags;");
  insertEvents(db, seedEvents());
  broadcast("reset");
}

export function broadcast(kind: string) {
  ctx().bus.emit("change", kind);
}

export function subscribe(fn: (kind: string) => void): () => void {
  const { bus } = ctx();
  bus.on("change", fn);
  return () => bus.off("change", fn);
}
