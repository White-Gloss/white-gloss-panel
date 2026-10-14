# Kundenportal „Mein White Gloss“

Stand: 14. Oktober 2026. Dieser Stand beschreibt den Code. Live verfügbar ist er erst nach einem
eigenen, freigegebenen IONOS-Release mit Live-Nachweis.

Adresse: **https://panel.white-gloss.de/kunde**

Der Kunde meldet sich einmal mit der E-Mail-Adresse seiner Anfrage an (persönlicher Link + PIN,
wie bisher beim Angebot) und sieht dort **alle seine Aufträge** an einem Ort.

## Was der Kunde im Portal hat

| Bereich | Inhalt |
| --- | --- |
| Status | Fahrzeug mit Kennzeichen, Auftragsnummer, Stand in einem Satz und Fortschritt von „Anfrage“ bis „Bezahlt“ (aktueller Schritt mit Namen, nicht nur farbig) |
| Für Sie zu erledigen | „Angebot prüfen und annehmen“, „Annahme-/Rückgabeprotokoll prüfen und unterschreiben“, „Ergänztes Angebot unterschreiben“ – öffnet die bestehende Unterschriftsseite |
| Termin | Beginn, voraussichtliches Ende, Übergabeart, Ort; „Termin verschieben?“ sendet einen Wunsch |
| Leistungen | Gebuchte Leistungen mit Einzelpreisen und Festpreis (erst ab dem Angebot, nicht während „Preise prüfen“) |
| Zusatzleistungen | Buchbare Extras aus dem Katalog mit Preis für die Fahrzeugklasse; „Unverbindlich anfragen“ |
| Nachrichten und Fotos | Der bestehende Kundenchat direkt im Portal, „Fotos senden“ öffnet die Kamera/Galerie |
| Dokumente | Auftragsbestätigung mit Unterschrift, Annahme- und Rückgabeprotokoll als PDF |
| Rechnung | Betrag, Status, Fälligkeit, Bankverbindung, PDF und „Online bezahlen“ (Qonto) |
| Bewertung | Nach „Erledigt“/„Bezahlt“: „Auf Google bewerten“ (Link aus Einstellungen → Bewertungslink) |

## Zusatzleistungen: Anfrage statt Sofortbuchung

1. Kunde wählt Extras und sendet „Unverbindlich anfragen“.
2. Die Anfrage erscheint als Kundennachricht im Chat (mit E-Mail-Hinweis an dich wie bei jeder
   Chatnachricht) und oben im Auftrag als „Offene Kundenwünsche aus dem Kundenportal“.
3. Du wählst **In Leistungen übernehmen** – die Extras werden als Positionen mit Katalogpreis in
   „Leistungen & Angebot“ eingetragen – oder **Ablehnen**.
4. Ist das Angebot schon unterschrieben: Preise prüfen → **Ersatzangebot erstellen**. Der Kunde sieht
   es im Portal unter „Für Sie zu erledigen“ und unterschreibt selbst. Erst dann ist es gebucht.
   Ist das Angebot noch offen, zeigt es die Extras nach dem Speichern der Preise direkt an.

Extras, die schon gebucht oder im Paket enthalten sind (z. B. Lederpflege bei Keramikschutz), und
derzeit nicht buchbare Extras werden nicht angeboten. Nach „Erledigt“ gibt es keine Extras mehr.
Extras „nach Prüfung“ erscheinen mit „ab“-Preis.

## Terminwunsch

„Termin verschieben?“ sendet einen Freitext. Er erscheint im Chat und oben im Auftrag. Bis du
antwortest, gilt der bisherige Termin. „Erledigt“ oder „Ablehnen“ zeigt dem Kunden den Stand.

## Für dich im Panel

- Auftrag → **Kundenportal-Vorschau**: zeigt genau das, was der Kunde sieht (alle Aufträge mit
  derselben E-Mail), ohne dass Aktionen möglich sind. Damit lässt sich das Portal live prüfen,
  ohne dich als Kunde anzumelden.
- Oben im Auftrag: Kundenwünsche aus dem Portal mit „In Leistungen übernehmen“, „Erledigt“,
  „Ablehnen“.
- Auf der Übersicht stehen alle offenen Kundenwünsche – auch dann, wenn der Chat eines Auftrags
  beendet ist und deshalb keine Chatnachricht entsteht.
- Der Portal-Link ist für alle Kunden gleich: `https://panel.white-gloss.de/kunde`. Er steht
  automatisch in den Mails mit Auftragsbestätigung/Protokoll-PDF und in Rechnungsmails.
  Tipp: Auf white-gloss.de im Menü „Kundenlogin“ auf diese Adresse verlinken.

## Datenschutz und Sicherheit

- Anmeldung nur für E-Mail-Adressen mit mindestens einem echten Auftrag (nicht Papierkorb, nicht
  Testbereich). Die Antwort ist immer dieselbe neutrale Meldung – auch wenn der Mailversand gerade
  gestört ist –, damit niemand herausfinden kann, ob es zu einer Adresse einen Auftrag gibt.
  Versandprobleme stehen nur im Serverprotokoll.
- Bereits angefragte Zusatzleistungen werden nicht erneut angeboten (keine doppelten Wünsche).
- Der Kunde sieht ausschließlich Aufträge, deren Kunden-E-Mail genau seiner Anmeldung entspricht
  (Groß-/Kleinschreibung egal). Testaufträge und Aufträge im Papierkorb erscheinen nie.
- Dokumente, Rechnungs-PDF und Unterschriftslinks werden für jede Anfrage neu gegen die Anmeldung
  geprüft. Ein vom Betreiber gesperrter Chatlink wird über das Portal nicht wieder geöffnet.
  Beim ersten Start nach dem Update gelten bestehende Chats **ohne** aktiven Kundenlink als gesperrt
  (ein früher gesperrter Link ist nicht von einem nie erstellten zu unterscheiden). Im Chat
  „Kundenzugang“ → „Kundenlink erstellen“ gibt ihn für das Portal frei. Neue Chats sind sofort verfügbar.
- Gesperrte Kundenakten zeigen im Portal nur Auftragsnummer und den Hinweis, sich zu melden.
- „In Leistungen übernehmen“ ändert ein noch offenes Angebot nicht: Erst wenn du die Preise
  prüfst und speicherst, sieht der Kunde das ergänzte Angebot.
- Kundenwünsche werden nie gelöscht (Datenbank-Sperre). Es gehen keine automatischen
  Kundenmails aus dem Portal hinaus; Benachrichtigungen an dich laufen über den Chat.
- Begrenzung: 30 Portal-Aktionen je Kunde und Stunde.
- **Hinweis:** Die Datenschutzerklärung auf white-gloss.de sollte das Kundenportal nennen
  (Zweck: Auftragsabwicklung; Speicherort IONOS). Keine Rechtsberatung – bitte prüfen lassen.

## Technik

- Server: `server/portal.mjs` (eingebunden in `server/application.mjs`), Tabelle
  `portal_requests`; `server/chat.mjs` erhält `portalChat`/`portalNotice` und die Spalte
  `chat_threads.link_revoked`. Alles entsteht beim Start automatisch, keine neue Konfiguration.
- Oberfläche: `public/kunde.html`, `public/kunde.js`, `public/kunde.css` (nutzt `chat-ui.js`).
- Endpunkte Kunde: `GET /api/portal/me`, `GET /api/portal/o/<id>/pdf/<acceptance|intake|return>`,
  `GET /api/portal/o/<id>/rechnung.pdf`, `POST /api/portal/o/<id>/(chat|extras|termin|sign/<art>)`.
- Endpunkte Betreiber: `GET /api/portal/me?vorschau=<id>`, `GET /api/portal-admin/requests[?order=<id>]`,
  `POST /api/portal-admin/request` (`apply`, `done`, `decline`).
- Nur IONOS-Laufzeit; die frühere Sites-Kopie hat kein Portal.
- Tests: `tests/portal.test.mjs` (Zugriff, Extras, Termin, Chat, Unterschrift, PDF, Vorschau),
  `tests/portal-ui.test.mjs` (Oberfläche in jsdom, keine Inline-Styles wegen CSP).

## Live-Prüfung nach dem Release (ohne echte Kundendaten)

1. `https://panel.white-gloss.de/kunde` ohne Anmeldung → Weiterleitung zur Anmeldung mit
   `returnTo=/kunde` und dem Text „Mein White Gloss – Ihr Kundenportal …“.
2. Im Panel Testbereich → Testauftrag öffnen → „Kundenportal-Vorschau“ → Portal erscheint mit
   gelbem Hinweis „Betreibervorschau“, Knöpfe sind gesperrt.
3. Bei einem echten Auftrag (eigene E-Mail als Kunde, nur mit Freigabe): Anmeldung, Extras
   anfragen, Nachricht erscheint im Panel-Posteingang.
