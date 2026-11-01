// Versionierter Erklärungstext. Änderungen erfordern eine neue Dokumentversion und Unterschrift.
export const REMOTE_HANDOVER_VERSION = "2026-10-29.v1";
export function remoteHandoverText(kind) {
  return kind === "return"
    ? "Ich bevollmächtige die genannte Person, das in diesem Dokument bezeichnete Fahrzeug für mich von White Gloss entgegenzunehmen. Ich habe das Rückgabeprotokoll einschließlich Zustandsangaben, Fotos, offener Punkte und ausgeführter Leistungen geprüft und bestätige die dokumentierte Übergabe. Gesetzliche Rechte bleiben unberührt."
    : "Ich bevollmächtige die genannte Person, das in diesem Dokument bezeichnete Fahrzeug für mich an White Gloss zu übergeben. Ich habe das Annahmeprotokoll einschließlich Zustandsangaben, Fotos und dokumentierter Übergabedaten geprüft und bestätige die dokumentierte Übergabe. Gesetzliche Rechte bleiben unberührt.";
}
