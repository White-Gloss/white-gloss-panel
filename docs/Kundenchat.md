# Kundenchat im Panel

Stand: 13. Oktober 2026. Dieser Stand beschreibt den Code. Live verfügbar ist er erst nach einem
eigenen, freigegebenen IONOS-Release mit Live-Nachweis.

Kunde und Betreiber schreiben sich direkt im Panel – wie bei WhatsApp, aber auf dem eigenen
IONOS-Server: Text, Fotos, Videos und PDF-Dateien, mit Lesebestätigung und Live-Aktualisierung.

## Warum Eigenbau statt fertigem Chat-Programm

Geprüft wurden Chatwoot (selbst gehostet), Crisp, tawk.to, Userlike, Tidio und die WhatsApp Business
Platform (Stand Oktober 2026).

| Option | Ergebnis für White Gloss |
| --- | --- |
| Chatwoot | Mindestens 4 GB RAM, PostgreSQL, Redis, Ruby und Sidekiq – zu schwer für den Panel-VPS, eigene Kundenidentität. |
| Crisp, Tidio, Userlike | Externe Skripte und Server, eigenes Besucherkonto statt Auftrag + PIN, zusätzlicher AV-Vertrag, teils kostenpflichtig ab 1 Platz. |
| tawk.to | Daten in den USA, Tracking-Cookies, Einwilligung und Transferprüfung nötig. |
| WhatsApp Business Platform | Seit 1. Oktober 2026 kostenpflichtige Antworten nach 1.000 Service-Nachrichten/Monat, Meta-Verifizierung, Vorlagenfreigaben, Medien nur 7 Tage abrufbar, Zuordnung über Telefonnummer statt Auftrag. |
| **Eigenbau im Panel** | **0 €, keine Drittanbieter, Daten bleiben auf IONOS, nutzt den vorhandenen Kundenzugang mit Link + PIN, vorhandene Sicherung und vorhandenen Mailversand.** |

Der kostenlose WhatsApp-Link (`wa.me`) bleibt als zusätzlicher Weg erhalten: Aus dem Chat kann der
Kundenlink per WhatsApp verschickt werden.

## Bedienung

**Chat beginnen:** Auftrag öffnen → „Kundenchat“. Pro Auftrag gibt es genau einen Chat.

**Kunden einladen:** Im Chat oben „Kundenzugang“:

- „Einladung per E-Mail (Link + PIN)“ – der Kunde erhält seinen persönlichen Chatlink und eine
  einmalige PIN in einer E-Mail (wie beim Angebot). Benötigt geprüften und freigegebenen E-Mail-Versand.
- „Kundenlink kopieren“ oder „Link per WhatsApp senden“ – der Kunde öffnet den Link und meldet sich
  mit der E-Mail-Adresse seines Auftrags an; er bekommt dann Link und PIN per E-Mail.
- „Neuen Link erzeugen“ macht den alten Link ungültig, „Kundenlink sperren“ beendet den Zugang.
- „Chat beenden“: Der Kunde kann den Verlauf noch lesen, aber nicht mehr schreiben. Jederzeit
  wieder zu öffnen.

**Nachrichten:** Unter „Nachrichten“ in der Navigation stehen alle Chats, neueste zuerst, mit Zähler
für ungelesene Kundennachrichten (auch im Browser-Tab). Neue Nachrichten erscheinen ohne Neuladen.
Am Handy zeigt das Panel erst die Liste, dann den Chat. Fotos per Büroklammer, Einfügen
(Strg+V) oder Ziehen in das Fenster. Enter sendet am Computer, Umschalt+Enter macht eine neue Zeile.

**Kundenseite:** `https://panel.white-gloss.de/chat/<persönlicher Link>` – Vollbild-Chat fürs Handy
mit Anruf-Knopf, Fotos direkt aus der Kamera oder Galerie, Lesebestätigung (✓ gesendet, ✓✓ gelesen).

**Testbereich:** Chats von Testaufträgen bleiben getrennt. Es gibt dort keinen Kundenzugang und
keinen E-Mail-Versand; der Kundenlink dient nur der Betreibervorschau.

## Benachrichtigungen per E-Mail

- **An dich (info@white-gloss.de):** Wenn ein Kunde schreibt und du das Panel nicht offen hast –
  höchstens eine E-Mail je Chat in 10 Minuten, mit Nachrichtentext und Direktlink zum Chat.
- **An den Kunden:** Wenn du schreibst und der Kunde den Chat gerade nicht offen hat – höchstens eine
  E-Mail je Chat in 30 Minuten, mit frischem Zugangslink und PIN (24 Stunden gültig, einmal nutzbar).
  Nur mit geprüftem und freigegebenem E-Mail-Versand (Einstellungen), nie im Testbereich.
- Antworten des Kunden auf diese E-Mails gehen an info@white-gloss.de (Reply-To).
- Der 15-Minuten-Hintergrundlauf holt Hinweise nach, wenn jemand den Chat verlassen hat, ohne die
  neuen Nachrichten gesehen zu haben. Ein unklares Versandergebnis wird nicht wiederholt.

## Datenschutz und Sicherheit

- Alles liegt auf dem IONOS-Server in Deutschland: Nachrichten in SQLite, Dateien im privaten
  Dateispeicher außerhalb des Webroots. Keine externen Skripte, keine Cookies außer der vorhandenen
  Anmeldesitzung.
- Kunden sehen ausschließlich den Chat ihres eigenen Auftrags: gültiger Chatlink **und** Anmeldung
  mit genau der E-Mail-Adresse des Auftrags. Der Link wird nur als Hash und verschlüsselt gespeichert.
- Erlaubt sind JPEG, PNG, WebP, MP4, MOV und PDF bis 15 MB, höchstens 10 Dateien je Nachricht. Der
  Server prüft den tatsächlichen Dateiinhalt. Fotos werden im Browser auf höchstens 2048 Pixel
  verkleinert und neu gespeichert – dabei entfallen Standortdaten und andere Metadaten.
- Nachrichten werden wie Aufträge nie geändert oder gelöscht (Datenbank-Sperre). Chatdateien stehen
  in der Dateitabelle und sind damit Teil der täglichen Sicherung.
  Nur hochgeladene, aber nie gesendete Dateien (z. B. Fenster während des Sendens geschlossen) werden
  nach 24 Stunden automatisch entfernt.
- Chatdateien werden mit Sandbox-Richtlinie ausgeliefert; PDFs werden heruntergeladen statt im Panel
  geöffnet. Videos und Bilder werden vom Speicher gestreamt, nicht komplett in den Arbeitsspeicher geladen.
- Begrenzungen gegen Missbrauch: 120 Nachrichten und 80 Dateien pro Stunde und Chat für Kunden.
- **Zu erledigen außerhalb des Codes:** Die Datenschutzerklärung auf white-gloss.de sollte den
  Kundenchat nennen (Zweck: Kommunikation zum Auftrag; Speicherort IONOS; Speicherdauer wie
  Auftragsunterlagen). Das ist keine Rechtsberatung – bitte rechtlich prüfen lassen.

## Technik

- Server: `server/chat.mjs` (eingebunden in `server/application.mjs`), Tabellen `chat_threads`,
  `chat_messages`, `chat_attachments`; Dateien zusätzlich in `assets` mit `kind='chat'`.
  Die Tabellen entstehen beim Start automatisch. Keine neue Konfiguration, kein neuer Port.
- Oberfläche: `public/chat-ui.js` (gemeinsame Chatansicht), `public/chat-inbox.js` (Panel),
  `public/kunde-chat.js` + `public/chat.html` (Kunde), `public/chat.css`.
- Uploads dürfen bis zu 180 Sekunden dauern (vorher 30 Sekunden für alle Anfragen), damit Videos auch
  über langsames Mobilfunknetz ankommen.
- Live-Aktualisierung über wartende Abfragen (bis 25 Sekunden, höchstens 200 gleichzeitig, 20 je Chat) – keine
  WebSockets, keine zusätzlichen Pakete, funktioniert unverändert hinter Caddy.
- Lesebestätigung: Ein Gerät bestätigt den Empfang mit seiner nächsten Abfrage. Ein geschlossenes
  Fenster markiert deshalb nichts als gelesen.
- Endpunkte Betreiber: `GET /api/chats`, `GET /api/chats/summary`, `POST /api/chats/open`,
  `GET|POST /api/chats/t/<id>[/message|/file|/link|/invite|/close]`, `GET /api/chats/t/<id>/file/<datei>`.
- Endpunkte Kunde: `GET /api/kundenchat/<link>`, `POST …/message`, `POST …/file`,
  `GET …/file/<datei>` (Videos mit Byte-Ranges für iPhone).
- Tests: `tests/chat.test.mjs` (Zugriff, Dateien, Lesebestätigung, Benachrichtigungen),
  `tests/chat-ui.test.mjs` (Kundenseite und Posteingang in jsdom, Sicherung enthält Chatfotos).

## Live-Prüfung nach dem Release (ohne echte Kundendaten)

1. `https://panel.white-gloss.de/chat/` + 64 Nullen öffnen → Weiterleitung zur Anmeldung mit
   `returnTo=/chat/…`.
2. Im Panel Testbereich einschalten → Testauftrag → „Kundenchat“ → Nachricht und Foto senden.
3. „Kundenzugang“ → „Kundenlink erstellen“ → Link im selben Browser öffnen → Betreibervorschau.
4. Navigation „Nachrichten“ zeigt den Test-Chat nur im Testbereich.

## Mögliche nächste Schritte

- Push-Benachrichtigungen aufs Handy (Web Push mit VAPID) für Betreiber und Kunden.
- Chatlink automatisch in Angebots- und Rechnungsmails sowie im Kundenbereich anzeigen.
- Schnellantworten (Textbausteine) für häufige Fragen.
