# Storno, Bewertungsanfragen und ausstehende Freigaben

Stand: 7. Oktober 2026. Technische Vorbereitung in der isolierten Arbeitskopie;
keine Veröffentlichung, echte Nachricht, Gebührenrechnung oder Zahlung.

## Stornoregeln

Der Betreiber hat persönliche Gebührenbestätigung sowie einen Ermessensspielraum
zum Reduzieren oder Erlassen bestätigt und die konkrete, rechtlich vertretbare
Abgrenzung delegiert. Daraus wurde die folgende konservative Regel als
**Prüfentwurf** vorbereitet. Die bloße Existenz eines Abholservices beseitigt
keinen individuellen Entschuldigungs- oder Minderungsgrund automatisch.

`src/customer-policy.mjs` enthält `proposedCancellationPolicy`, eine tief
eingefrorene vorgeschlagene Version mit `approved: false` und noch nicht
bestätigter Prüfung des konkreten Vertrags. Es wird keine freigegebene aktive
Standardversion ausgeliefert. Für eine Kundengebühr sind eine belastbar geprüfte,
freigegebene Version und ihre Annahme vor Vertragsschluss erforderlich.

### Konservative vorgeschlagene Abgrenzung

| Zeitpunkt | Obergrenze |
| --- | --- |
| Mindestens 120 exakt verbleibende Stunden bis Terminbeginn | Kostenlos, einschließlich genau 120 Stunden |
| Weniger als 120, aber mehr als 72 verbleibende Stunden | Höchstens 25 Prozent |
| Genau 72 Stunden und darunter, vor dem Berliner Dienstleistungstag | Höchstens 50 Prozent |
| Ab 00:00 Europe/Berlin am Dienstleistungstag | Höchstens 75 Prozent |
| Nichterscheinen, erst nach vereinbartem Terminbeginn feststellbar | Höchstens 75 Prozent |
| Betreiberabsage | Keine Stornogebühr |
| Gesetzlicher Widerruf | Keine Gebühr aus dieser Stornostaffel; gesetzliche Folgen gesondert prüfen |

Prozentuale Grundlage ist der kundenseitig angenommene Gesamtfestpreis mit
angenommenen Nachträgen. Der Prozentbetrag wird auf ganze Cent abgerundet.
Entscheidend ist immer der niedrigere Betrag aus Prozentobergrenze und konkret
nachgewiesenem wirtschaftlichem Verlust nach ersparten Aufwendungen und
Ersatzverdiensten. Ein geprüfter Kundennachweis keines oder geringeren Schadens
begrenzt den Betrag zusätzlich. Die Vorschau ordnet keine Umsatzsteuer zu und
erstellt keine Rechnung.

Diese Obergrenzen werden konservativ gewählt, damit eine kurzfristige Absage
keine pauschale Forderung ohne nachgewiesenen Verlust auslöst. Der Betreiber
bestätigt einen Betrag persönlich; er kann ihn mit dokumentiertem Grund
reduzieren oder vollständig erlassen. Es gibt keine automatische Gebührenrechnung
und keine rückwirkende Anwendung auf Altaufträge ohne angenommene Bedingungen.

Vor Aktivierung müssen der Prüfentwurf und die konkrete Vertragsverwendung
bestätigt und dokumentiert werden:

- Exakte Stunden mit den oben angegebenen Gleichheitsregeln und Berliner
  Mitternacht als Beginn des Dienstleistungstages.
- Berechnungsgrundlage einschließlich Umgang mit Extras, Abholung, Nachträgen,
  Rabatten und gegebenenfalls Netto-/Bruttobetrag.
- Nichterscheinen, Betreiberstornierungen und Sonderfälle.
- Gebührenbeleg ausschließlich nach Betreiberbestätigung; steuerliche Behandlung
  und vorhandenen Rechnungsanbieter einer Forderung gesondert prüfen.
- Vollständiger Kundenwortlaut und Möglichkeit zum Nachweis keines oder eines
  wesentlich geringeren Schadens; belastbare Prüfung des konkreten Ablaufs.

Vertragsschluss, Widerruf und Stornierung müssen fachlich getrennt bleiben.
Schadenspauschalen in AGB unterliegen insbesondere
[§ 309 Nr. 5 und 6 BGB](https://www.gesetze-im-internet.de/bgb/__309.html).
Bei einem Werkvertrag sind nach
[§ 648 BGB](https://www.gesetze-im-internet.de/bgb/__648.html)
ersparte Aufwendungen und anderweitiger Erwerb zu berücksichtigen. Welcher
Vertragstyp tatsächlich vorliegt, ist noch zu prüfen.

Für Fernabsatz gilt gegebenenfalls
[§ 312g BGB](https://www.gesetze-im-internet.de/bgb/__312g.html).
Die seit 19. Juni 2026 geltende elektronische Widerrufsfunktion bei entsprechenden
online geschlossenen Verträgen verlangt einen zugänglichen Zwei-Schritt-Ablauf
und eine unverzügliche Eingangsbestätigung mit Datum/Uhrzeit:
[§ 356a BGB](https://www.gesetze-im-internet.de/bgb/__356a.html),
[amtlicher Inkraft-Hinweis](https://www.bundesregierung.de/breg-de/bundesregierung/bundeskanzleramt/besserer-verbraucherschutz-2382536).
Eine unverbindliche Anfrage und ein online geschlossener Auftrag sind vorher
anhand des tatsächlichen Buchungsablaufs zu unterscheiden.

### Datenvertrag

`cancellationPolicyErrors(policy, now)` liefert offene Punkte. Pflichtfelder:

| Feld | Erforderlicher Inhalt |
| --- | --- |
| `version`, `approved`, `approvedBy`, `approvedAt` | Eindeutige Version, ausdrücklich `true`, Freigebender, ISO-Zeitpunkt mit Offset |
| `timeBasis`, `timeZone` | `elapsed-hours` oder `berlin-calendar-days`; `Europe/Berlin` |
| `boundaries.fiveDays` | `atEquality`: `free` oder `25-percent`; exakte `definition` |
| `boundaries.threeDays` | `atEquality`: `25-percent` oder `50-percent`; exakte `definition` |
| `boundaries.serviceDay` | `startsAt`: `berlin-midnight`, `appointment-start` oder `explicit-local-time`; exakte `definition`; bei letzterem `localTime` als `HH:mm` |
| `feeBasis`, `noShow`, `operatorCancellation`, `exceptions` | Ausdrücklich bestätigter vollständiger Wortlaut |
| `feeCreation` | Ausschließlich `operator-confirmation`, entsprechend der ausdrücklichen Betreiberanweisung |
| `rates` | Ausdrücklich bestätigte beauftragte Werte: `free: 0`, `afterFiveDays: 25`, `fromThreeDays: 50`, `serviceDay: 75` |
| `lowerDamageText`, `terms` | Freigegebener Nachweishinweis und vollständige Kundenbedingungen |
| `legalReview` | `approved: true`, `reviewer`, `reviewedAt`, `evidence`; Prüfung vor Betreiberfreigabe |

`cancellationSnapshot(policy, acceptance, now)` ist erst danach erlaubt.
`acceptance` braucht `accepted: true`, `role: 'customer'`, `orderId`, `customerId`,
`at` und die tatsächlich angezeigte `version`. Die Kundenannahme darf nicht vor
der Freigabe oder in der Zukunft liegen. Der Snapshot enthält eine tiefe Kopie
der Version und die konkrete Vorgangszuordnung. Signierter Kundenwortlaut und
Auftrag müssen zusammen dauerhaft gespeichert werden; spätere Konfigurationen
dürfen frühere Annahmen nicht überschreiben.

Die Validierung prüft strukturierte Pflichtangaben und vorhandene Nachweise.
Sie prüft weder die juristische Qualität eines Textes noch die Echtheit eines
manuell eingetragenen Nachweises und ist keine Bestätigung der Rechtswirksamkeit.

### Gebührenvorschau

`cancellationPreview(order, input, policy, now)` verwendet ausschließlich die
vorstehende konservative Stundenregel, wenn sie rechtlich geprüft, freigegeben
und vor Vertragsschluss ausdrücklich angenommen wurde. Andere vollständig
konfigurierte Zeitregeln werden von dieser Vorschau nicht stillschweigend
interpretiert. `order.cancellationTerms` enthält den angenommenen Snapshot;
`order.acceptance.at` darf nicht vor dessen Kundenannahme liegen. Die Policy
muss inhaltlich unverändert zum Snapshot passen. Abgeschlossene oder bereits
begonnene Leistungen werden nicht durch diesen Vorschaupfad abgerechnet.

`input` enthält:

- `reason`: `customer`, `no-show`, `operator` oder `withdrawal`.
- Bei positiver Obergrenze ausdrücklich `documentedLossCents`,
  `sparedCostsCents`, `replacementEarningsCents` und `lossEvidence`.
  Auch null Euro ersparte Kosten oder Ersatzverdienst müssen ausdrücklich
  eingetragen werden; fehlende Angaben werden nicht als null angenommen.
- Optional `customerProvenLossCents` mit `customerEvidence`.
- Bei persönlicher Bestätigung `confirmed: true`, `confirmedBy` und
  `feeCents`; liegt der Betrag unter dem berechneten Höchstbetrag, zusätzlich
  `waiverReason`.

Die Ausgabe enthält unter anderem `eligible`, `blocked`, `capPercent`,
`basisCents`, `capCents`, `maxFeeCents`, `confirmed`, `feeCents` und stets
`issueAllowed: false`. Sie verändert keinen Auftrag und erzeugt keine Rechnung,
Forderung, Zahlung oder Nachricht. Der Aufrufer muss den Betreiber authentifizieren
und die persönliche Bestätigung sowie Nachweise in einem unveränderlichen Audit
festhalten. Der tatsächlich verwendbare und steuerlich geprüfte
Gebührenrechnungsweg ist weiterhin eine separate Voraussetzung.

## Drei Tage nach Dienstleistungsabschluss

Die bisherige `dueJobs`-Regel (168 Stunden und altes Zustimmungsfeld) bleibt
erhalten. Der separat vorbereitete Drei-Tage-Pfad hat **keine automatische
Aktivierung**. Der bisherige Versandablauf wird nicht stillschweigend verkürzt.

Vor Aktivierung erforderlich:

- E-Mail als konkreten vorhandenen Versandkanal bestätigen; andere Kanäle sind
  durch dieses Modul nicht implementiert.
- Zwischen genau 72 Stunden und drei Berliner Kalendertagen wählen. Für die
  Kalenderoption ist zusätzlich dieselbe Berliner Uhrzeit ausdrücklich zu
  bestätigen. Diese Wahl ist offen und wird nicht vorgegeben.
- Konkreten Google-Link am richtigen Unternehmensprofil prüfen und den Nachweis
  mit Zeitpunkt speichern; eine erlaubte Google-Domain allein beweist die
  richtige Unternehmenszuordnung nicht.
- Versandanbieter, Versand und dauerhafte Hintergrundverarbeitung bestätigen.
- Ausdrückliche, dokumentierte Einwilligung des betreffenden Empfängers für den
  betreffenden Vorgang und tatsächlich nutzbaren Widerspruchsweg bereitstellen.
- Neue aktive Version mit Freigebendem und Freigabezeitpunkt speichern.

Kundenzufriedenheitsanfragen per E-Mail sind Werbung; eine beigefügte Rechnung
ändert das nicht:
[BGH VI ZR 225/17](https://juris.bundesgerichtshof.de/cgi-bin/rechtsprechung/document.py?Art=en&Blank=1.pdf&Datum=2018-7&Gericht=bgh&Seite=6&anz=302&nr=87436&pos=195).
[§ 7 UWG](https://www.gesetze-im-internet.de/uwg_2004/__7.html)
verlangt grundsätzlich vorherige ausdrückliche Einwilligung; seine
Bestandskundenausnahme hat mehrere Voraussetzungen. Für den neuen Pfad wird
keine solche Ausnahme pauschal unterstellt. Einwilligungsnachweis und einfacher
Widerruf ergeben sich bei dieser Grundlage aus
[Art. 7 DSGVO](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679).

Die Anfrage ist neutral und erhält keine Belohnung oder Auswahl nach
Zufriedenheit:
[Google-Richtlinie](https://support.google.com/contributionpolicy/answer/7400114?hl=en).

### Datenvertrag und Integration

`config.reviewPolicy` braucht:

- `active: true`, `approved: true`, `version`, `approvedBy`, `approvedAt`.
- `schedule`: `elapsed-72-hours` oder `berlin-calendar-days`.
- `timeZone: 'Europe/Berlin'`; bei Kalendertagen ausdrücklich
  `calendarTime: 'same-local-time'`.
- `channel: 'email'`, `googleUrl`, `googleUrlVerified: true`,
  `googleUrlVerifiedAt`, `googleUrlEvidence`, `optOutText`.

Die bestehenden Konfigurationsfreigaben `emailVerified`, `sendApproved` und
`backgroundApproved` müssen jeweils ausdrücklich `true` sein.

`order.reviewConsent` braucht `granted: true`, `channel: 'email'`, die identische
`orderId`, die konkrete E-Mail als `recipient`, `grantedAt`, `version` und
`evidence`. `revoked: true` oder vorhandenes `revokedAt` sperrt den Versand.
Ein bloßes altes `source.reviewConsent: true` reicht für den neuen Pfad nicht.
Ein anderer Auftrag oder eine spätere Änderung der Empfängeradresse übernimmt
keine Einwilligung. Zeitpunkte brauchen ein ISO-Format mit `Z` oder UTC-Offset.

`reviewEligibility(order, config, now)` liefert `{due, dueAt, reason}`;
`reviewDue(order, config, now)` liefert einen booleschen Wert. Beide Funktionen
sind ohne Seiteneffekte. Nur `Erledigt`/`Bezahlt` mit gültigem `completedAt` zählt.
Stornierte, unvollständige oder als synthetisch markierte Vorgänge sind gesperrt.
72 Stunden sind exakt; drei Kalendertage bewahren die Berliner Uhrzeit und
können beim Zeitwechsel 71 oder 73 Stunden bedeuten. Eine nicht existierende
oder doppeldeutige Zieluhrzeit hält den Versand an, bis der Umgang damit
ausdrücklich entschieden wurde.

Die Hintergrundintegration muss die Zulässigkeit beim Ermitteln der Jobs **und
unmittelbar vor Versand mit dem neu geladenen Auftrag** prüfen. Bei aktiver,
aber ungültiger neuer Version darf nicht auf den alten Bewertungsversand
zurückgefallen werden. Die bestehende dauerhafte Job-Deduplizierung und der
Provider-Idempotenzschlüssel bleiben zuständig für höchstens einen Versand pro
Vorgang. Ein ungeklärtes Providerergebnis darf keinen automatischen Neuversuch
auslösen.

`reviewRequestText(url, optOutText)` liefert ausschließlich neutralen Text mit
dem übergebenen Ziel und dem tatsächlich bestätigten Widerspruchsweg. Es sendet
keine Nachricht. Änderungen am konkreten Versandkanal und die Aktivierung
bleiben bis zur Betreiberentscheidung und Veröffentlichungsfreigabe offen.

## Prüfung

`node --test tests/customer-policy.test.mjs`: 38 isolierte Prüfungen, darunter
alle fehlenden Stornofreigaben, Grenzentscheidungen, unveränderliche Vorgänge,
exakte 72-Stunden-Grenze, Berliner Zeitwechsel einschließlich unmöglicher und
doppeldeutiger Uhrzeiten, Widerruf, fremde Einwilligung, fehlender Abschluss,
Stornierung, Providerfreigaben und unveränderte 168-Stunden-Regel. Außerdem
120-/72-Stunden-Grenzen, Mitternacht bei beiden Zeitwechseln, Kosten-/Ersatzverdienst-
Abzug, Erlass, Reduktion, Kundennachweis, Betreiberabsage, Widerruf,
Nichterscheinen und Sperre rückwirkender oder veränderter Bedingungen.
