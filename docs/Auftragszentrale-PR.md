# WG-UX-001: Eine Auftragsnavigation mit nachvollziehbaren Dokumentzuständen

Die bisherige Ablaufleiste und die Reiter führen mehrfach zu denselben Bereichen.
Zudem erklärt der Gesamtstatus frühere Schritte als erledigt, auch wenn ein
Protokoll fehlt. Die Auftragszentrale verwendet jetzt eine einzige Navigation
mit sechs unabhängig erreichbaren Bereichen und zeigt Dokumentnachweise getrennt
von manuellen Vermerken. Rückgabe bleibt ohne vorherige Annahme erreichbar.

Der Kopf ergänzt Preis und Termin; Wunsch, unbestätigter Vorschlag und bestätigter
Termin sind ausdrücklich getrennt. Die vorhandenen Obsidian-/Platin-Tokens,
Geschäftslogik und Schutzmechanismen bleiben bestehen.

## Prüfung

- 46 gezielte Modul-/UI-Tests bestanden.
- Lint, Typprüfung, Build und Server-Syntaxprüfung bestanden.
- Vollständige Testsuite: 697/698 bestanden; unveränderter Installertest lehnt
  die Root-UID dieser Umgebung ab. Prüfung auf unprivilegiertem GitHub-Runner offen.
- Acht Browserfälle für Hell/Dunkel bei 320/390/768/1440 px vorbereitet.
- Browserläufe, Screenshots und Designabnahme noch offen.

## Veröffentlichung

Als Draft-PR nach `main` vorgesehen. Kein Merge und kein Produktionsrelease ohne
konkrete Freigabe. Der Push wurde durch die automatische Freigabeprüfung blockiert,
weil der Zielbranch in einem öffentlichen Repository liegt. Es existiert noch
kein Pull Request. Die neuen Dateien enthalten ausschließlich Quellcode,
synthetische Testdaten und Projektdokumentation.
