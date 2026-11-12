# Schrift ausschließlich auf der Webseite · 12.11.2026

## Korrigierter Auftrag

Lars hat klargestellt: Die neue Schrift war für `https://white-gloss.de` bestimmt und soll dort an mobile, Tablet- und Desktop-Breiten angepasst werden. Die Ausweitung auf das Panel war ein Fehler bei der Umsetzung. Die Webseite behält ihren eigenen vorbereiteten Schriftstand; dieses Panel-Repository wird gezielt auf seine bisherige Typografie zurückgeführt.

## Gezielte Rücknahme

- Die bisherige Panel-Kaskade wird wiederhergestellt: Systemschrift für die App-Flächen, die vorhandene lokale Barlow für ihre bisherigen Bedienelemente. Keine globale neue Schriftrolle oder neue Überschriftengröße.
- Kundenportal, Kundenchat, Vor-Ort-App, Buchhaltung, Steuerberateransicht und Anmeldeseiten behalten ihre ursprüngliche Schriftzuordnung.
- Neue Panel-PDFs verwenden wieder die unveränderte ursprüngliche Noto Sans. Gespeicherte und unterschriebene PDF-Dateien werden weiterhin bytegleich ausgeliefert.
- Ausgehende Panel-Mails verwenden wieder Arial/Helvetica/System-Fallback ohne Webfont-Requests. Die Isolation eingehender Mails bleibt bestehen.
- MCP-OAuth erhält seine vorherige HTML-Ausgabe und die engere ursprüngliche CSP zurück; der Leseumfang, CSRF und zulässige Weiterleitungen bleiben erhalten.
- Alte Barlow-/Noto-Dateien und ihre Lizenzen werden bytegleich aus dem Stand vor der Schriftumstellung restauriert. Syne-/Jakarta-Dateien werden aus dem Panel entfernt.
- Der Vor-Ort-Shellcache wird auf **v7** erhöht. Er enthält wieder Barlow und entfernt beim Aktivieren die alten Caches. Ein Rücksprung auf den bereits benutzten v5-Schlüssel wird vermieden. API-, Kunden- und Anmeldedaten bleiben ausgeschlossen.

## Erhaltene Korrekturen

Die Rücknahme basiert auf dem tatsächlich veröffentlichten Panel-Commit `50a652356bbff77216655ee975b159057283105c`. Die ursprüngliche Schriftgrenze liegt bei `6618a0505ba873a2150d252ae67349a7b7598ea9`.

- PR93: berechtigte Warteschlangenarbeit, Versandpause/Schutz vor ungewissen Wiederholungen, deutsche Bankstatus und geprüfte CI-Umgebung.
- PR94: Fotoanalyse nur für tatsächlich unterstützte Quellen; Kundenchatbilder bleiben sichtbar.
- PR92: Zurück-Geste, Verlauf, Menü- und Formularschutz vollständig erhalten.
- Mobile Mailbedienung mit beschriftetem Abruf und erreichbarem Kontostatus.
- Dynamische Portal-Sprungziele unter den festen Leisten; keine schreibenden Aktionen durch Navigation.
- Platz für Kartenüberschriften, Kalenderbedienung, lange Auftragsangaben und vollständige Preise.

## Prüfung und Veröffentlichung

Die vorhandenen Prüfungen werden auf die ursprünglichen Panel-Schriftrollen angepasst. Die drei Browser-Engines und neun Breiten-/Engine-Kombinationen bleiben erhalten. Fachliche Preis-, Zugriffs-, Original-PDF-, Zurück-Geste-, Formular- und Überlaufprüfungen bleiben wirksam. Lokale Website- oder Browserserver werden nicht gestartet.

Implementierung, abgeschlossene Prüfungen und tatsächlicher Produktiv-Release werden getrennt im zugehörigen Korrektur-PR dokumentiert. Eine bestandene Prüfung allein ist kein Veröffentlichungsnachweis. Es werden keine Kundendaten, Termine, Preise oder Nachrichten geändert.
