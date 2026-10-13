# Auftrag des Betreibers: Phase 0 und sechs Pakete

Originaltext von Lars Hägele, 13.10.2026. Verbindliche Vorgabe für alle folgenden Arbeiten.

Phase 0: Bestandsaufnahme (nur lesen)
Du änderst keinen Code und eröffnest keinen PR. Warum: Du kennst das Panel noch nicht, und ich auch nicht im Detail. Ohne Bestandsaufnahme baust du doppelt oder brichst Bestehendes.
Bericht mit diesen Punkten:
1. Stack: Framework, Datenbank, Auth, Kalender-Bibliothek, Hosting, CI.
2. Datenmodell: Kunden, Fahrzeuge, Termine, Angebote, Rechnungen, Übergaben, Fotos. Was fehlt für die sechs Pakete?
3. Kalender heute: Ansichten, Blocker, Arbeitszeiten, Verknüpfung zur Website-Verfügbarkeit. Stand von Draft-PR #301 (Website) und white-gloss-panel#6.
4. Übergabe und Login heute: Protokoll, Fotos, Unterschrift, Kunden-Login, Rollen.
5. PWA heute: Manifest, Service Worker, Icons, Offline.
6. Personenbezogene Daten: Wo liegen sie (Datenbank, Storage, Logs, Backups)?
7. Deploy-Weg: Wie kommt Code heute nach IONOS (Skript, Service, Timer)? Wo liegt das Rollback? Gibt es Staging?
8. Geladene Regeldateien: Welche CLAUDE.md und AGENTS.md sind aktiv? Widersprüche?
9. Risiken und Lücken, nach Schwere sortiert.
10. Fragen an mich, nummeriert.
Danach schreibst du den Plan für Paket 1 und wartest.
Die sechs Pakete
Reihenfolge: 1 Kalender, 2 Löschkonzept, 3 Übergabe, 4 Web-App, 5 Dashboard, 6 B2B. Warum: Alles hängt am Termin. Das Löschkonzept muss vor Fotos und Unterschriften stehen. Die Web-App braucht die Übergabe für die Offline-Warteschlange. B2B nutzt alles davor. Weichst du ab, begründe und frage.
Paket 1: Kalender komplett
• Tag, Woche, Monat, Agenda, handytauglich. Statusfarben von Anfrage bis Bezahlt, nie Farbe allein.
• Drag & Drop mit serverseitiger Konfliktprüfung. Spalte „Unverplant“ für Hub-Anfragen.
• Mehrtägige Balken. Keramik: 1.920 Minuten, Anfrage ohne feste Zeit, nach Bestätigung mehrtägig mit Aushärte-Block (Dauer je Produkt einstellbar, Herstellerangabe prüfen).
• Blocker (Urlaub, Krank, Material, Wetter, Feiertag nach Bundesland), Arbeitszeiten, Puffer, Fahrzeit (Routes API, Schalter aus), Auslastung frei/knapp/voll nur anonymisiert an die Website, Wartelistenvorschlag nur mit Freigabe, Umbuchen/Stornieren mit Frist im Kunden-Login, ICS-Feed nur lesend mit widerrufbarem Token.
• Zwei-Wege-Sync nur nach meiner Entscheidung (syncToken, nicht nur Push).
• Abnahme: parallele Speichervorgänge ergeben nie eine Doppelbuchung. Keramik als Mehrtagesbalken. Kein Überlauf bei 360 px. Zeitumstellung verschiebt nichts.
Paket 2: Löschkonzept (DSGVO)
• Gesetzliche Fristen laut Recherche: Buchungsbelege 8 Jahre (seit 01.01.2025), Handels-/Geschäftsbriefe 6 Jahre, Jahresabschlüsse 10 Jahre, Fristbeginn am Jahresende. Ein Steuerberater bestätigt sie vor Livegang.
• Nach DIN 66398: Datenarten-Register in docs/loeschkonzept.md, pro Datenart genau eine Löschregel mit Frist und Startzeitpunkt. Fristen konfigurierbar. Vorschläge für Fristen ohne Gesetz mit Begründung, ich entscheide.
• Sperren statt löschen, solange eine Aufbewahrungspflicht läuft. Löschläufe erst als Trockenlauf-Bericht ohne Namen, dann nach meiner Freigabe. Rein technische Daten (abgelaufene Token, alte Logs) nach freigegebener Regel automatisch.
• Auskunft als Export, Löschantrag mit Eingang und Frist von einem Monat. Audit-Log nur mit IDs.
• Kein Löschen von Bestandsdaten in diesem Paket.
• Abnahme: Trockenlauf findet genau die abgelaufenen Testdaten. Beleg in der Frist lässt sich nicht löschen. Zweiter Lauf löscht nichts weiter.
Paket 3: Digitale Übergabe aus der Ferne
• Ablauf: Ich dokumentiere (Schadenskarte, Pflichtfotos, Kilometerstand, Zubehör) als Entwurf, gebe zum Versand frei, der Kunde meldet sich im Panel an (Magic-Link mit Einmalcode), prüft, erfasst Einwände pro Foto, unterschreibt oder lehnt ab. Der Server versiegelt PDF, SHA-256-Hash, Zeitstempel, IP, Gerät und Textversion.
• Nach der Unterschrift schreibgeschützt, Nachträge nur als Zusatzprotokoll. Links laufen ab (Standard 24 h) und gelten einmal. Fotos privat mit kurzlebigen URLs, GPS entfernt. Kein stillschweigendes „Genehmigt nach X Stunden“ ohne AGB-Grundlage. Schalter aus.
• Rechtlich (Stand der Recherche, keine Rechtsberatung): formfrei, einfache elektronische Signatur genügt. Beweiswert steigt mit bestätigter Identität, Hash und lückenlosem Audit-Trail.
• Abnahme: nachträgliche Änderung fällt per Hash-Test auf. Abgelaufener oder genutzter Link wird abgelehnt. Kunde A sieht nichts von Kunde B. Doppeltes Absenden ergibt eine Unterschrift.
Paket 4: Installierbare Web-App (PWA)
• Manifest (display: standalone, Icons 192/512, maskable, apple-touch-icon 180), Service Worker mit App-Shell und Offline-Seite, Update-Hinweis.
• Nie Kundendaten, API-Antworten oder Fotos cachen. Logout leert lokalen Speicher.
• iOS hat keinen Install-Prompt: kurze Anleitung (Teilen, Zum Home-Bildschirm). Offline-Warteschlange (IndexedDB), Upload beim Öffnen, idempotent. Kein Background Sync einplanen.
• Push (Schalter aus): iOS ab 16.4 nur für die installierte App, Erlaubnis nur nach Klick, Opt-in mit Zeitstempel, 404/410-Abos löschen, keine sensiblen Inhalte, E-Mail als Fallback. Unsicher: EU-Stand auf iOS, Test auf echtem iPhone.
• Abnahme: Lighthouse meldet installierbar. Offline kommt die Offline-Seite ohne Kundendaten im Cache. Nach Logout ist der Speicher leer.
Paket 5: Dashboard
• Von oben: Heute, Zu erledigen (Freigabe-Warteschlange, nichts läuft automatisch), Geld (offene Posten, überfällig, Monatsumsatz), Auslastung, Verkauf (Quote Anfrage zu Auftrag, Umsatz je Leistung, Privat gegen B2B), Pflege fällig.
• Jede Kennzahl mit fester Definition (Zähler, Nenner, Zeitraum, netto/brutto) als Tooltip und in einer Datei im Repo. Aggregation serverseitig. Netto/brutto hängt an meinem Steuerstatus: fragen.
• Abnahme: Testdaten ergeben die vorab berechneten Werte. Ziel unter 2 Sekunden bei 5.000 synthetischen Terminen. Ohne Inhaber-Rolle kein Zugriff.
Paket 6: B2B-Bereich
• Firma (Anschrift, USt-IdNr, Zahlungsbedingungen, eigene Preisliste nur von mir gepflegt), Rollen Firmen-Admin, Disponent, Fahrer. Fuhrpark mit Kennzeichen, Kostenstelle, Referenznummer.
• Firmenkonto lege nur ich an. Sammelanfrage bleibt eine Anfrage, ich bestätige. Sammelrechnung nur als Vorschlag. Pflichtangaben nach § 14 UStG gegen die aktuelle Fassung prüfen.
• E-Rechnung: Empfang seit 2025 Pflicht, Ausstellen im B2B ab 01.01.2028 (ab 2027 bei über 800.000 EUR Vorjahresumsatz), nötig sind XRechnung oder ZUGFeRD. Ob Qonto das erzeugt, ist ungeprüft: erst melden, dann bauen.
• Jede Abfrage mit company_id serverseitig gefiltert, fremde IDs ergeben 404.
• Abnahme: Firma A sieht nichts von Firma B oder Privatkunden (URL, API, Export). Fahrer sieht keine Rechnungen. Sammelanfrage mit drei Fahrzeugen ergibt eine Anfrage ohne Terminbestätigung.