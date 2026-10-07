# Kundenpanel, wiederholbare PIN und gespeicherte Nachrichten

Unterschriebene Vereinbarungen und angenommene Nachträge bleiben in ihrer
Originalansicht zugänglich. Zusätzlich bietet diese Ansicht einen PDF-Download
auf dem freigegebenen Briefpapier. Die Ausgabe verwendet den gespeicherten
angenommenen Inhalt, die persönliche Unterschrift und die damals angenommenen
Stornobedingungen. Ein aktueller Preis oder eine neue Bedingungsversion ersetzt
den Originalstand nicht. Erste PDF-Ausgaben werden mit eigener Prüfsumme und
Vorlagen-ID unveränderlich gespeichert; parallele Downloads erzeugen einen Beleg.
Ohne echtes freigegebenes Briefpapier oder ursprünglichen historischen Snapshot
bleibt der PDF-Download gesperrt, die Originalansicht bleibt erhalten.

Das IONOS-Kundenpanel liegt unter `/kundenportal`. Kunden melden sich mit ihrer
E-Mail-Adresse und ihrer persönlichen sechsstelligen PIN an. Der Login hängt
nicht vom Angebotsende, einer bereits erfolgten Unterschrift oder dem Abschluss
eines Auftrags ab. Betreiberpasswort und persönliche Betreiber-Mailbestätigung
verwenden weiterhin ihren vorhandenen separaten Ablauf.

Beim ersten Einlösen eines vorhandenen Angebotslinks mit seiner Eingabe-PIN
wird diese PIN zur dauerhaften persönlichen Kunden-PIN. Der Kunde erhält dafür
eine ausdrückliche Bestätigung vor dem Weitergehen zum Angebot. Weitere
Angebots- und Nachtragslinks behalten eine separate Eingabebestätigung und ändern
die bestehende persönliche PIN nicht. Dieselbe normalisierte E-Mail-Adresse
kann mehrere unabhängige Aufträge mit eigenen Vereinbarungen führen.

Kunden ohne aktiven Angebotslink können unter der PIN-Anmeldung „PIN vergessen /
erstmalig anfordern“ wählen. Der Versand nutzt ausschließlich den vorhandenen,
geprüften und freigegebenen Resend-Zugang. Der neue persönliche Bestätigungslink
gilt zehn Minuten und ist einmalig. Erst das erfolgreiche Einlösen mit der PIN
ändert den Zugang. Dabei werden die vorherige PIN, vorhandene Kundensitzungen
und noch offene Kundenzugangslinks gemeinsam widerrufen. Versandprobleme ändern
eine bereits aktive PIN nicht. Ein ungeklärter Versand wird nicht automatisch
wiederholt. Eine Resend-ID bestätigt die Anbieterannahme, nicht den Posteingang.

Persönliche PINs werden als scrypt-Ergebnis mit zufälligem 32-Byte-Salt gespeichert
(N=131072, r=8, p=1). Vor scrypt wird die PIN mit einem HMAC und dem vorhandenen
geschützten Konfigurationsschlüssel gebunden. Klartext-PINs existieren nur bei
der Erstellung/Anfrage im Speicher und in der ausdrücklich angeforderten
E-Mail. Anmeldeversuche werden pro E-Mail und IP in SQLite begrenzt. Eine
bestätigte Anmeldung setzt ihre Fehlversuchszähler zurück. Einmal-Link-PINs
behalten den vorhandenen Schutz mit fünf Versuchen. PINs stehen nicht in URLs.
Sitzungen bleiben HttpOnly, Secure, SameSite=Lax; Ablauf und Inaktivitätsgrenze
bleiben beim bisherigen einen Tag beziehungsweise vier Stunden.

Das Kundenpanel liefert nur begrenzte Ansichten der Aufträge, deren ursprüngliche
Kunden-E-Mail zur bestätigten Identität gehört. Betreiber-Notizen, Versandjobs,
Integrationsschlüssel, andere Kundenakten und Originaldateizugänge werden nicht
offengelegt. Nachträgliche Stammdaten- oder Fahrzeugzuordnungen ändern diese
Zugriffsprüfung nicht. Eigene unterschriebene Vereinbarungen und Nachträge zeigen
ihren gespeicherten Stand und ihre Originalsignatur. Annahme-/Rückgabe-PDFs nutzen
die vorhandene PDF-Generation beziehungsweise die gespeicherte Originaldatei.
Zahlungsnachweise verwenden den geschützten Zahlungsbelegweg; fehlendes echtes
freigegebenes Briefpapier bleibt dort eine sichtbare Sperre.

Eine Bewertungsanfrage ist erst nach einer vollständig bestätigten aktiven
Bewertungsregel und einem abgeschlossenen Auftrag im Kundenpanel auswählbar.
Die freiwillige einmalige E-Mail-Einwilligung ist nicht vorausgewählt und wird
mit Vorgang, Empfänger, Zeitpunkt, Regelversion und Nachweis gespeichert.
Widerruf bleibt auch bei später inaktiver Regel möglich. Ein bestehendes
Originalformular oder eine Unterschrift wird dafür nicht umgeschrieben. Neue
Einwilligungen lösen keine Mail aus; der bestehende unabhängige Hintergrundlauf
prüft die freigegebenen Versandvoraussetzungen erst bei Fälligkeit.

Unter „Kundenbetreuung“ zeigt der Betreiber ungelesene Kundennachrichten mit
einem direkten Einstieg in den betreffenden Auftragschat. Test- und produktive
Vorgänge bleiben dort entsprechend der gewählten Ansicht getrennt.

Chatnachrichten gehören jeweils zu einem Auftrag. Beide Seiten können auch nach
Unterschrift oder Auftragsabschluss schreiben. Text, serverseitiger Zeitpunkt,
Absenderrolle und Lesepositionen sind dauerhaft in derselben privaten SQLite
gespeichert und damit Teil der bestehenden Sicherung. Wiederholte Übermittlung
derselben Nachrichten-ID erzeugt genau eine Nachricht; veränderter Inhalt mit
derselben ID wird abgewiesen. Text wird als Text angezeigt. Neue Nachrichten
werden beim Öffnen oder Aktualisieren geladen. Externe Kundenmails oder
Push-Nachrichten werden durch den Chat nicht automatisch ausgelöst.

Für Betreiber: `/api/customer-chat?id=AUFTRAG` liefert Nachrichten und nimmt
Nachrichten/Lesemarkierungen entgegen. `/api/customer-chat/summary` liefert
Vorgänge mit ungelesenen Kundennachrichten. Die Kundenrouten verwenden dieselbe
Auftragsprüfung vor jeder Anfrage, inklusive Dokumenten und älteren Nachrichten.
Schreibende Anfragen benötigen JSON und den echten eigenen Origin.

`tests/customer-portal.test.mjs` verwendet App.fetch, SQLite im Arbeitsspeicher,
synthetische Kunden und simulierte Resend-Antworten. Geprüft werden wiederholte
Anmeldung nach Unterschrift/Angebotsablauf, mehrere Vorgänge gleicher E-Mail,
PIN-Erneuerung/Widerruf, Versandfehler, Zugriffstrennung, parallele
Nachrichtenwiederholung, Lesemarkierungen und eigene Dokumente. Es wird kein
Website-Server gestartet und keine echte Kundenmail verschickt.
