# Handlungszentrale auf der Übersicht

Stand: 03.11.2026. Roadmap-Aufgabe V1.

## Zweck

Die Übersicht zeigt oben **„Heute zu erledigen“**: alle fälligen Schritte in einer Liste.
Ein Klick öffnet den richtigen Auftrag direkt im passenden Bereich.

Reihenfolge:

1. **Überfällig** (rot)
2. **Heute** (orange)
3. **Wartet auf Kunde** (grau, gestrichelt)

Innerhalb einer Stufe steht das Älteste oben. Acht Einträge sind sichtbar, weitere öffnen
sich über „Weitere … anzeigen“.

## Einträge

| Eintrag | Bedingung | Stufe | Öffnet |
| --- | --- | --- | --- |
| Rechnung überfällig | Qonto-Rechnung offen, Fälligkeit vor heute, Auftrag nicht „Bezahlt“ | Überfällig | Zahlung & Rechnung |
| Wiedervorlage | Notiz mit Wiedervorlagedatum heute oder früher | Überfällig / Heute | Kundenakte & Status |
| Termin vorbei · Annahme fehlt | „Termin verbindlich“, Termin vor heute | Überfällig | Annahme |
| Terminvorschlag verstrichen | Vorschlag ohne Bestätigung, Termin vor heute (auch vor der Angebotsannahme) | Überfällig | Angebot & Termin |
| Termin heute | Termin heute; Vorschlag, vor Angebotsannahme, verbindlich oder in Arbeit | Heute | Angebot & Termin / Annahme / Rückgabe |
| Preise prüfen | Status „Preise prüfen“ | Heute | Angebot & Termin |
| Abrechnen | Status „Erledigt“ ohne Rechnung | Heute | Zahlung & Rechnung |
| Neue Rechnung ausstellen | Status „Erledigt“, bisherige Rechnung storniert | Heute | Zahlung & Rechnung |
| Angebot läuft ab | „Angebot offen“, Ablauf in höchstens 48 Stunden | Heute | Angebot & Termin |
| Kundenwunsch | Offene Wünsche aus dem Kundenportal | Heute | Auftrag |
| Neue Kundennachrichten | Ungelesene Nachrichten im Kundenchat | Heute | Nachrichten |
| Unterschrift offen | Angebot, Annahme- oder Rückgabeprotokoll wartet auf den Kunden | Wartet | betroffener Bereich |
| Angebot wartet auf Annahme | „Angebot offen“ ohne Unterschriftsanfrage, Ablauf in mehr als 48 Stunden | Wartet | Angebot & Termin |
| Terminbestätigung offen | Terminvorschlag in der Zukunft ohne Bestätigung | Wartet | Angebot & Termin |

Abgelehnte, stornierte und abgelaufene Aufträge erzeugen außer Wiedervorlagen keine
Einträge. Testbereich und Live-Bereich bleiben getrennt. Gelöschte Aufträge erscheinen nicht.

## Weitere Änderungen auf der Übersicht

- Die Kennzahl **„Zahlungen · Monat“** zählt die im Panel erfassten, nicht stornierten
  Zahlungen des aktuellen Monats (Europe/Berlin). Vorher war es die Summe aller Zeiten.
- Der **Arbeitsvorrat** ist nach Dringlichkeit sortiert, nicht mehr nach der letzten Änderung:
  zuerst Aufträge mit Überfälligem, dann mit Heutigem, danach nach Status. Warten auf den
  Kunden zählt nicht als eigene Arbeit.
- Die Handlungszentrale ersetzt drei Einzelblöcke auf der Übersicht: den Hinweis zu offenen
  Unterschriften, den Hinweis zu Kundenwünschen und die kompakte Agenda. Die vollständige
  7-Tage-Agenda bleibt im Kalender.

## Grenzen

- Die Liste **liest nur**. Sie versendet nichts, ändert keinen Status und ruft keinen Anbieter auf.
- Kundenwünsche und Chatnachrichten kommen aus den vorhandenen Endpunkten
  `GET /api/portal-admin/requests` und `GET /api/chats/summary`. Schlägt einer fehl, zeigt
  die Liste „konnte nicht geladen werden“ mit „Erneut laden“.
- Unmögliche Datumsangaben (z. B. `2026-13-01`) werden ignoriert und brechen die Übersicht nicht.
- Wiedervorlagen lassen sich bisher nicht als erledigt markieren. Eine überfällige
  Wiedervorlage bleibt deshalb sichtbar, wie in der Kundenbetreuung.
- WhatsApp, E-Mail und abgelehnte Website-Anfragen sind noch nicht enthalten. Sie folgen mit
  der Roadmap-Aufgabe „Kommunikation bündeln“, nachdem ihre Bedeutung geprüft ist.

## Technik und Tests

- Logik: `public/action-center.mjs` (reine Funktionen, keine Schreibvorgänge)
- Oberfläche: `public/app.js` (`overview()`, `actionCenterHTML()`, `loadActionExtras()`),
  Darstellung in `public/enterprise.css`
- Tests: `tests/action-center.test.mjs` (Regeln, Sortierung, Berliner Tagesgrenze,
  Monatssumme), `tests/ui.test.mjs` (Übersicht, Klickziele, Sortierung),
  `browser-tests/navigation.test.mjs` (Layout von 320 bis 1440 px, nur auf dem GitHub-Runner)
- Keine Datenbankänderung. Ein Rückfall per Revert ist ohne Datenverlust möglich.
