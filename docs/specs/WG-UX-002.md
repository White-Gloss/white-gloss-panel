# WG-UX-002 – Dokumente und Nachweise im Auftrag

Stand: 07.11.2026. **Design ausdrücklich freigegeben; isolierte Umsetzung in Prüfung.**
Basis: `649469a3fd6e2680a8810641b70abbcabb162cca`, produktiver Merge von PR #63.
Umsetzungsbranch: `codex/wg-ux-002-order-evidence`.

## Ziel und verbindliche Grenzen

Lars findet innerhalb eines geöffneten Auftrags die aktuelle Dokumentfassung,
fehlende Unterschriften, vorhandene Zustandsfotos und den passenden Kommunikationsweg,
ohne mehrere Bearbeitungsformulare durchsuchen zu müssen.

- Obsidian & Platin, bestehende Schrift, Tokens und Hell-/Dunkelwahl erhalten.
- Sechs unabhängig erreichbare Auftragsschritte erhalten; keine neue Prozesssperre.
- Keine Änderung an Signaturbindung, Dokumentversionierung, Kundenberechtigungen,
  Rechnungsfinalisierung, Versandfreigaben, Papierkorb, Anbieter- oder Authentifizierungslogik.
- Kein neuer Anbieter, keine Bibliothek, Datenmigration, KI-Bildbewertung oder Rechtsformulierung.
- Keine produktiven Testbuchungen, Uploads, Kundenkommunikation, Merge oder Deployment.
- Erst Designfreigabe, dann Implementierung auf `codex/wg-ux-002-order-evidence`.
  Ein Draft-PR darf anschließend ausschließlich diesen isolierten Entwicklungsstand zeigen.

## Belege und Grenzen der Analyse

### Aktuelle öffentliche Prüfung

Am 06.11.2026 um 23:56 Uhr Europe/Berlin: `GET /healthz` antwortete HTTP 200,
`ok`, `x-panel-commit: 649469a3fd6e2680a8810641b70abbcabb162cca`.
CSP, HSTS, nosniff und Frame-Schutz sind in dieser Antwort vorhanden; daraus folgt
keine vollständige Sicherheitszertifizierung.
Zusätzlich aktuell per HTTPS abgerufen: `app.js`, `order-workspace.js`, `surface.css`
und `enterprise.css`: jeweils HTTP 200, bytegenau identisch mit `origin/main`
am oben genannten Commit.

Browser Use meldet für `/auth/login` bei 1440×900 und 390×844 eine lesbare
Anmeldemaske ohne offensichtlichen Überlauf. Login-Wall erreicht; nichts ausgefüllt
oder abgesendet. Die gelieferten Screenshotpfade liegen in der Browser-Sitzung,
nicht als hier unabhängig betrachtete Bilddateien vor. Daher kein vollständiges
visuelles Live-Audit behauptet.

Nicht geprüft: angemeldete Aufträge, echte Signaturen/PDFs, Vollständigkeit der
Kundenfotos, Versandzustellung, reale Safari-/Android-Geräte und Screenreader.
Der Live-Abruf aktueller Auftragsdaten ist in diesem Turn nicht verfügbar und wurde
für diesen Auftrag nicht versucht. Keine Panel-Datenwerkzeuge gefunden.

### Codebefunde am festgehaltenen Commit

| Bereich | Konkreter Befund | Konsequenz für WG-UX-002 |
| --- | --- | --- |
| Dokumente | `public/app.js`: `priceDetail`, `protocolDetail`, `paymentDetail`, `historyHTML` verteilen Angebot, PDF, Protokoll und Verlauf auf drei Bereiche. | Zentrale, lesende Übersicht mit Absprung in vorhandene Bearbeitung. |
| Signaturen | `src/domain.mjs:150–187` trennt unterschriebenes Original, offenen Ersatz, verworfene Anfragen und manuelle Schrittvermerke. | Keine einzige pauschale Ampel „erledigt“. Original und offene Ersatzfassung zugleich sichtbar. |
| Vollständigkeit | `src/worker.mjs:32` reduziert Listenaufträge (`slim:true`), entfernt Historien und Signaturdetails. | Übersicht ausschließlich aus vollständig geladenem Auftragsdetail; bei Kurzdatensatz Ladezustand, keine behauptet fehlenden Dokumente. |
| Rechnung | `public/invoice-ui.js` besitzt `invoiceStatusLabel`, `invoiceView`, `invoiceResultHTML`; Entwurf und endgültige Rechnung sind getrennt. | Bezeichnungen wiederverwenden; weder „bezahlt“ aus Gesamtstatus noch endgültig aus bloßer Existenz eines Entwurfs ableiten. |
| Fotos | `server/booking-photos.mjs` liefert höchstens 40 Buchungs-/Chatmedien; Protokollfotos stehen separat in Dokumentfassungen. | Quellen und Fassungen getrennt anzeigen; Buchungsmedienzahl nicht als vollständiges Fotoarchiv ausgeben. |
| Seiteneffekte | `server/providers.mjs:114` ruft beim Foto-GET derzeit Synchronisation auf. | Neuer ausdrücklich lesender Modus für gespeicherte Medien. Bestehender Synchronisationsweg bleibt unverändert. |
| Fahrzeugzustand | `public/protocol-form.js` enthält Schäden, Skizze, Lackmessung, Übergabeerlaubnis und Fotos; Rückgabe kann Annahme vergleichen. | Vorhandene Daten und Vergleich nutzen; keine neue Schadenserkennung oder automatische Vorher-/Nachher-Zuordnung. |
| Kommunikation | `openChatForOrder` nutzt POST `/api/chats/open`; Chatabrufe können Lesestand/Präsenz beeinflussen. | Übersicht montiert keinen Chat und öffnet ihn nicht automatisch. Erst bewusster Absprung. |
| E-Mail | Communication Center ist allgemeines Postfach; fremde Bilder können Öffnungsinformationen senden. | Keine automatische E-Mail-Vorschau und keine behauptete lückenlose Zuordnung allein über Kundenadresse. |
| Navigation | `order-workspace.js` trennt Dokumentnachweis und manuelle Annotation; `workflowStep` kennt genau sechs IDs. | IDs und gespeicherte Schrittzustände unverändert lassen. |
| UX | Tokens und responsive Reiter vorhanden; lange Formulare bleiben lang. | Nachweise in kompakter Übersicht, Bearbeitung bleibt am bisherigen Ort. Kein ungeprüfter Komplettumbau. |

Projektunterlagen: AGENTS.md, README-Prüfweg, Roadmap, Auftragszentrale,
Obsidian-und-Platin, Protokolle-Papierkorb-Rechnungsentwurf, Protokoll-Kunde-nicht-vor-Ort,
Kundenchat und Communication-Center gelesen. Ältere IONOS- und V2-Statusangaben sind
historisch; aktueller Code/Releasebeleg haben Vorrang. Die ältere allgemeine
Releasefreigabe in AGENTS.md gilt NICHT für den ausdrücklich gesperrten WG-UX-002-Release.

## Vorgeschlagene Gestaltung – Freigabe erforderlich

**Eine Kundenakte, sechs Reiter:** Der bestehende Reiter „Kundenakte & Status“
(ID `notes`) heißt künftig „Kundenakte & Dokumente“. Darin stehen vier klar
beschriftete Abschnitte, in dieser Reihenfolge:

1. **Dokumente:** vier kompakte Zeilen – Angebot/Auftragsbestätigung, Annahme,
   Rückgabe, Rechnung. Pro Zeile Titel, belegter Dokumentstatus, Unterschrift,
   vorhandenes Datum und primär „Bereich öffnen“. Offene Ersatzfassung darunter,
   frühere Fassungen über ein natives aufklappbares Element.
2. **Fotos & Fahrzeugzustand:** drei Quellgruppen – Anfrage/Kommunikation,
   Annahme, Rückgabe. Gespeicherte Medien erst beim Aufklappen laden. Dokumentgebundene
   Fotos behalten die Fassung; aktuelle Aufnahmen niemals an ein altes Original hängen.
3. **Kommunikation:** „Kundenchat öffnen“, vorhandene Versandhinweise mit präziser
   Bedeutung sowie „Communication Center öffnen“. Kein automatisch geladener Chat,
   keine neue Nachrichtenschaltfläche in der Dokumentzeile.
4. **Notizen & Status:** vorhandene Notizen, Wiedervorlagen und Statusbearbeitung
   vollständig erhalten. Kein neues Speichern allein durch Wechsel in die Übersicht.

Desktop: Zeilen mit klaren Spalten, keine zusätzliche Sidebar. Mobil: dieselben
Zeilen untereinander, Status und Aktion umbrechen; keine horizontal zu schiebende
Dokumenttabelle. Vorhandene Navigation bleibt bestehen. Kein zusätzliches Sticky-
Element über der mobilen Hauptnavigation. Gold nur für bestehenden Warn-/Aktivzustand.

Warum: Ein gemeinsamer Nachweisbereich verkürzt die Suche; die bisherige Bearbeitung
und ihre Schutzdialoge bleiben an genau einer Stelle. Freigabe betrifft die
Umbenennung, Abschnittsreihenfolge, kompakte Zeilen und aufklappbare Foto-/Historiengruppen.

## Zustandsvertrag

| Datensatz | Darstellung und zulässige Aktion |
| --- | --- |
| Kein Dokument | „Noch nicht vorhanden“, vorhandenen Fachbereich öffnen; kein PDF-Link. |
| Angebot ohne Annahme | „Annahme offen“; Angebot öffnen. |
| Annahme ohne Signatur | „Ohne Kundenunterschrift angenommen“ bzw. ausdrücklich dokumentierte Betriebsfreigabe; niemals „unterschrieben“. |
| Gespeichertes Protokoll ohne Kundensignatur | „Gespeichert · Kundenunterschrift fehlt“. Betriebsunterschrift separat, falls tatsächlich vorhanden. |
| Unterschriebenes Original | „Vom Kunden unterschrieben“, vorhandenes Datum; PDF nur über bereits unterstützten aktuellen Download. |
| Offene Ersatzfassung | Original bleibt aktuelle gültige Fassung; zusätzlich „Neue Fassung · Unterschrift offen“. Kein Überschreiben im Anzeigemodell. |
| Verworfene Anfrage/Historie | Inaktiv/frühere Fassung; keine aktive Kundenlink- oder Versandaktion. Historischer PDF-Export wird nicht erfunden. |
| Rechnung | Rechnung/Entwurf anhand vorhandener Modelle unterscheiden; unbekannten Anbieterstatus als unbekannt anzeigen. |
| Übersprungener Schritt | „Übersprungen“ mit Grund/Datum, neben Dokumentstatus, nie an dessen Stelle. |
| Vorab-Übergabeerlaubnis | Separater Nachweis, keine Gleichsetzung mit konkreter Protokollunterschrift. Keine neue Sperre. |
| Fehlendes Datum/Signatur | „Nicht hinterlegt“, keine aus dem Gesamtstatus erfundene Information. |
| Medienfehler | „Aufnahmen konnten nicht geladen werden“ + Wiederholen; gespeicherte Protokollnachweise bleiben sichtbar. |
| Kurzdatensatz | „Auftrag wird geladen“, keine irreführenden Leerzustände. |

PDFs werden weder vorab erzeugt noch automatisch heruntergeladen. Teilen, Links
neu erzeugen, Abgleich, Versand, Rechnungsstellung und Signieren bleiben ausschließlich
in den bestehenden Fachbereichen samt ihren Bestätigungen. Die zentrale Ansicht
zeigt keine Tokens oder Signaturbilder und lädt keine externen E-Mail-Bilder.

## Akzeptanzkriterien

- A1: Genau sechs Auftragstab-IDs bleiben erhalten. Annahme übersprungen, Rückgabe
  dennoch direkt erreichbar; Grund und tatsächlicher Nachweis bleiben getrennt.
- A2: Vollständige/fehlende/unsignierte/signierte Dokumente, offene Ersatzfassung,
  verworfene Anfrage und frühere Fassung entsprechen der Tabelle. Modell mutiert nichts.
- A3: Kurzdatensatz wird nicht als „keine Dokumente“ dargestellt; verspätete Antwort
  von Auftrag A darf nach Wechsel zu B keine Inhalte in B anzeigen.
- A4: Öffnen der Übersicht erzeugt keinen Chat, Versandjob, Link, PDF, Upload,
  Anbieterabgleich oder Website-Fotoimport und ändert keine Auftragsversion.
- A5: Lesender Fotoabruf enthält nur dem Auftrag zugeordnete gespeicherte Medien;
  Benutzerrechte, Papierkorbgrenzen und Testdatentrennung gelten unverändert.
- A6: Fotoquelle und Dokumentfassung sind sichtbar. Bilder mit sinnvollem Alternativtext;
  Videos/PDF-Anhänge werden nach MIME korrekt bezeichnet, niemals als defektes Bild gerendert.
  „Bis zu 40 zuletzt gespeicherte Medien“ benennt die bestehende Grenze ehrlich.
- A7: Alle Absprünge nutzen vorhandene Guards für ungespeicherte Texte/Fotos/Signaturen.
  Abgelehnte Verwerfen-Warnung hält die aktuelle Eingabe und Ansicht.
- A8: Kein Rohstatus `unpaid`, kein `undefined`; Betriebsfreigabe, Kundenunterschrift,
  Mailübergabe und Zustellung werden nicht gleichgesetzt.
- A9: 320/390/768/1024/1440 px, Hell/Dunkel, 200 % Zoom: keine horizontale
  Seitenüberbreite, kein abgeschnittener Aktionsname, Zielgrößen mindestens 44×44 px,
  Auftragsreiter weiterhin mindestens 48×48 px. Fokus sichtbar, native Tastaturbedienung,
  Status nicht nur durch Farbe, logische Überschriften, reduzierte Bewegung respektiert.
- A10: Lade-/Leer-/Teilfehlerzustände verständlich; wiederholtes Öffnen erzeugt keine
  doppelten Abfragen; Fehler werden per ruhiger Statusmeldung zugänglich angekündigt.
- A11: Fremde Auftrags-IDs, HTML in Namen/Notizen und manipulierte Medienreferenzen
  führen weder zu Datenlecks noch Script-Ausführung. Keine neuen öffentlichen Medienpfade.
- A12: Bestehende Signatur-, Versions-, Rechnungs-, Auth-, Papierkorb- und Versandtests
  unverändert grün. Vollständige CI plus tatsächlich gesichtete Screenshots im Draft-PR.

## Ausdrücklich nicht in diesem Schritt

Globales Dokumentenarchiv über alle Kunden, neue Dokumenttypen, historischer PDF-Export,
vollständige E-Mail-/WhatsApp-Zusammenführung, neue Uploads, automatisch beschriftete
Fotos, neue Vor-Ort-App oder native Apps. Diese Themen brauchen separate Spezifikationen.

## Freigabe und offener Nachweis

Offene Produktentscheidung: Zustimmung zum oben beschriebenen Aufbau oder Änderungswunsch.
Keine Implementierung vor dieser Freigabe. Danach vier testbare Lieferpakete laut Plan.
Physische Geräte-/Screenreaderprüfung bleibt separat; keine Behauptung vollständiger
Barrierefreiheit aus Screenshots oder statischer Codelektüre.
