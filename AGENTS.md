# White Gloss Panel

## Betreiberregel

Lokales Hosting dieser White-Gloss-App ist auf dem Rechner des Betreibers
ausdrücklich verboten. Keine Dev-, Preview-, QA-, Produktions-, statischen,
Docker-, WSL- oder Tunnel-Server starten. Die Sperre nicht umgehen oder abschwächen.
Dateibearbeitung, Builds, Lint, Typprüfung und Tests ohne Website-Server sind
erlaubt. Vorhandene isolierte Linux-GitHub-Prüfungen dürfen dort laufen.

## Betrieb und Veröffentlichung

Der aktuelle Code enthält einen Sites-Worker und eine separate IONOS-Laufzeit.
Vor einer Migration `docs/IONOS-und-Google.md` lesen und den aktuellen Zustand
erneut prüfen. Keine vermeintliche Node-Startanweisung erfinden.

IONOS-Veröffentlichungen müssen den freigegebenen Weg nutzen. Der bestehende
Website-Deployment-Helfer gehört zu `white-gloss.de`; mit ihm darf dieses Panel
nicht über die Hauptwebsite ausgerollt werden. Für das Panel den bestehenden
separaten Dienst mit seinem eigenen Release- und Datenpfad verwenden und dessen
aktuellen Zustand vor jeder Veröffentlichung prüfen.

Betreiberauftrag vom 18.10.2026: Beauftragte Codeänderungen an
`White-Gloss/white-gloss-panel` nach erfolgreicher Prüfung direkt über den
bestehenden separaten Panel-Releaseweg auf `https://panel.white-gloss.de`
veröffentlichen und online prüfen. Für diesen Weg ist keine erneute
Veröffentlichungsbestätigung erforderlich; die Freigabe umfasst den separaten
IONOS-Paneldienst. Den aktuellen Hauptbranch und aktiven Serverstand vor jedem
Release prüfen. Fehlt der technische Serverzugang, den konkreten Blocker melden;
ein Commit, Releasepaket oder grüner Testlauf gilt weiterhin nicht als Deployment.

Stand 22.10.2026: Website und Panel laufen auf dem Hostinger-VPS, der alte
IONOS-Server bleibt nur als Rückfall. Der automatische IONOS-Release ist
abgeschaltet, weil er den alten Server träfe. Die Freigabe vom 18.10.2026
umfasste den IONOS-Paneldienst und gilt nicht automatisch für Hostinger.

Stand 03.11.2026: Der Hostinger-Releaseweg ist aktiv und in
`docs/Hostinger-Umzug.md` mit GitHub-Lauf und Commit belegt. Der Job
`Hostinger panel release` veröffentlicht jeden Push auf `main` nach den
Code- und Browserprüfungen automatisch. Ein Merge auf `main` ist deshalb eine
Veröffentlichung. Betreiberauftrag vom 03.11.2026: Beauftragte Aufgaben aus
`docs/Roadmap.md` nach erfolgreicher Prüfung selbst freigeben, über diesen Weg
veröffentlichen und das Ergebnis des Release-Jobs prüfen. Der Betreiber arbeitet
allein; die Rollen sind Betreiber, Kunde und Steuerberater. Andere
Serveränderungen, echte Kundenaktionen und Anbieteraktionen bleiben an eine
ausdrückliche Freigabe gebunden.

Zugangsschlüssel, OAuth-Geheimnisse, Kundendaten, Datenbankdateien, Fotos,
Unterschriften, Backups und Umgebungsdateien nicht committen oder in Ausgaben
offenlegen. Laufzeitgeheimnisse bleiben außerhalb des Repositorys.

Echte Kundenmails, Rechnungen, Zahlungen, Kundenannahmen und Kundenuploads nur
innerhalb einer ausdrücklich dafür erteilten Betreiberfreigabe auslösen.
Anbieterzugänge ausschließlich mit dem tatsächlich vorhandenen Umfang nutzen.

Implementiert, getestet, veröffentlicht und live geprüft getrennt berichten.
Ein grüner Prüfjob ist kein Beleg für einen Release. Beleg ist nur ein
erfolgreicher Job `Hostinger panel release` mit der Logzeile
„Hostinger-Panel veröffentlicht und über HTTPS geprüft: <Commit>“.

## Cloud Agent

Dieselben Prüfungen wie im README unter „Prüfungen ohne lokalen Website-Server“ ausführen. Node.js 22.23.2 wird von der Entwicklungsumgebung bereitgestellt. `npm run test:browser` bleibt dem echten Linux-GitHub-Runner vorbehalten.
