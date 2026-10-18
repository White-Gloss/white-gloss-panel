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
nicht über die Hauptwebsite ausgerollt werden. Für das Panel ist zuerst ein
separater, freigegebener Dienst mit eigenem Release- und Datenpfad einzurichten.

Zugangsschlüssel, OAuth-Geheimnisse, Kundendaten, Datenbankdateien, Fotos,
Unterschriften, Backups und Umgebungsdateien nicht committen oder in Ausgaben
offenlegen. Laufzeitgeheimnisse bleiben außerhalb des Repositorys.

Echte Kundenmails, Rechnungen, Zahlungen, Kundenannahmen und Kundenuploads nur
innerhalb einer ausdrücklich dafür erteilten Betreiberfreigabe auslösen.
Anbieterzugänge ausschließlich mit dem tatsächlich vorhandenen Umfang nutzen.

Implementiert, getestet, veröffentlicht und live geprüft getrennt berichten.
Ein grüner Workflow ist kein Beleg für einen erfolgreichen IONOS-Release.

## Cloud Agent

Dieselben Prüfungen wie im README unter „Prüfungen ohne lokalen Website-Server“ ausführen. Node.js 22.23.2 wird von der Entwicklungsumgebung bereitgestellt. `npm run test:browser` bleibt dem echten Linux-GitHub-Runner vorbehalten.
