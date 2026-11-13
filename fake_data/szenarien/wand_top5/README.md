# Szenario „Wand Top 5“ – das Kernbeispiel aus KONZEPT.md

Fortsetzung der Basisdaten (`fake_data/whatsapp`, `email`, `drive`, `calls`). Die Basisdaten bleiben unverändert, weil Tests der Ablage und des Übersetzers an ihren Zahlen hängen. Dieses Szenario wird **zusätzlich** importiert.

## Was passiert

| Wann | Was | Quelle |
|---|---|---|
| Fr 13.11. 15:48 / 16:10 | Elektro macht Feierabend. Umbau Verteiler Top 5 (Plan Index C: Abstellraum statt Vorraum) ist für **Montag** geplant. | Basisdaten: WhatsApp, Call |
| Fr 13.11. 17:19–17:20 | Trockenbauer schickt Foto + Sprachnachricht: Ständerwerk steht, **Samstag 7:00 wird die Wand im Abstellraum Top 5 zugemacht**. Niemand von Elektro liest das. | `PTT-20261113-WA0022.opus`, `IMG-20261113-WA0021.jpg` |
| Fr 13.11. 17:22 | Falle: „Top 4 Vorraum und Küche machen wir Montag zu“. Dort ist Elektro fertig → **kein** Signal. | WhatsApp |
| Fr 13.11. 17:31 | Signal-Anruf beim Vorarbeiter: „Nicht zumachen lassen, da müssen noch eure Rohre rein.“ | `calls/call_2026-11-13_1731_huber_signal.json` |
| Sa 14.11. 06:05–06:55 | Elektro zieht Kasten und Rohre ein und meldet per Foto, Text und Sprachnachricht: erledigt, Wand kann zu. | `IMG-20261114-WA0004.jpg`, `PTT-20261114-WA0005.opus` |
| Sa 14.11. 07:03 | Trockenbau macht zu. | WhatsApp |

Erwartete Signale und ihr Lebenszyklus: [`../../ERWARTET.md`](../../ERWARTET.md).

## Importieren (aus `ablage/`)

```powershell
.venv\Scripts\python -m ablage import whatsapp ..\fake_data\szenarien\wand_top5\whatsapp --projekt "BV Simmering"
.venv\Scripts\python -m ablage import call     ..\fake_data\szenarien\wand_top5\calls    --projekt "BV Simmering"
```

Ergibt 10 WhatsApp-Zeilen (4 mit Anhang, beide Sprachnachrichten mit Transkript) und 1 Call-Zeile. Die Fotos und Sprachdateien sind Platzhalter; das Transkript kommt aus der Sidecar-Datei `<audio>.txt`.
