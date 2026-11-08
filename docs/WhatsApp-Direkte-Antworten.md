# Direkte Antworten im Panel

Der Betreiber kann in einer eingegangenen WhatsApp-Unterhaltung einen Text mit bis
zu 4096 Zeichen schreiben und ausdrücklich senden. Der Empfänger kommt aus einer
signierten Kundennachricht der aktuell geprüften WhatsApp-Verbindung. Eine Nummer
aus dem Browser oder einem bearbeitbaren Kundendatensatz wird nicht übernommen.
Es gibt keine automatischen Antworten, Anhänge oder Hintergrundversände.

Das 24-Stunden-Fenster beginnt mit dem gültigen Meta-Zeitstempel der letzten
eingegangenen Nutzernachricht. Systemmeldungen, Echos, Vorlagen, Zustellstatus,
ausgehende Nachrichten und ungültige oder zukünftige Zeitstempel öffnen kein
Fenster. Ein verspäteter oder wiederholter Webhook verschiebt es nicht. Alte
Datensätze aus der Zeit vor dieser Erweiterung gelten nicht als neuer Nachweis;
für sie wird eine neue Kundennachricht benötigt. Außerhalb des Fensters ist eine
genehmigte Vorlage erforderlich. Das freie Anschreiben neuer Nummern und eine
Auswahl solcher Vorlagen sind nicht Teil dieser Erweiterung.

Vor dem Anbieteraufruf wird ein dauerhafter Versandversuch gespeichert. Dieselbe
Versand-ID kann keinen zweiten Anbieteraufruf auslösen. Bei unklarem Ergebnis
bleiben Text und Versuch sichtbar; weitere Antworten an diesen Empfänger werden
gesperrt, bis der offene Versand geklärt ist. Es gibt keine automatische
Wiederholung. Der Browser bewahrt Entwurf und Versuch in seiner Sitzung auf und
gibt sie erst nach eindeutiger Serverbestätigung frei. Eine explizite Antwort
`notSent:true` bezeichnet nur einen abgewiesenen Versuch ohne Versandnachweis.
Für unklare Versuche ohne bestätigte Meta-ID gibt es bewusst keinen automatischen
oder im Panel bedienbaren Rücksetzknopf. Eine solche Sperre erfordert eine
gesonderte Prüfung durch den Betreiber; ein neuer Versand darf nicht vermutet werden.

„Von Meta angenommen“ ist kein Zustellbeleg. Signierte Status-Webhooks zeigen
gesondert „Gesendet“, „Zugestellt“, „Gelesen“ oder „Fehlgeschlagen“. Sie werden nur
über die eigene Meta-Nachrichten-ID, die Absender-Phone-ID und den genauen Empfänger
zugeordnet. Wiederholte oder verspätete Ereignisse stufen einen bestätigten
Zustell-/Lesestatus nicht zurück. Es werden höchstens 1000 frühe, noch nicht über
die Versandantwort zuordenbare Ereignisse aufbewahrt; erforderlich ist ein eigener
offener Versuch für denselben Absender und Empfänger. Verlorene Versandantworten
werden dadurch nicht durch eine Vermutung als erfolgreich markiert.

Der separate Meta-Prüfzugang bleibt unverändert: fester `hello_world`-Testempfänger,
keine direkten Antworten und kein Nachrichteneingang. Der synthetische Testbereich
versendet ebenfalls keine echten Nachrichten. Kunden, Aufträge und Termine werden
durch direkte Antworten nicht geändert.

Primärquellen für die Anbietervorgaben:

- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/),
  Abschnitt 2: freier Antworttext nur innerhalb von 24 Stunden nach Nutzernachricht.
- [Meta Business Messaging OpenAPI](https://github.com/meta/openapi/blob/main/business-messaging-api_v23.0.yaml):
  Textnachrichten und signierte Nachrichtenstatus. API-Version und Token werden
  weiterhin aus der tatsächlich eingerichteten Meta-App übernommen.
