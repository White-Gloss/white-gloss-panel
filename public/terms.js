const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export const cancellationHTML = text => text
  ? `<details class="protocolreview" open><summary>Termin- und Stornobedingungen</summary><p class="hint">Vom Betrieb hinterlegter Vertragsentwurf · zur juristischen Prüfung. Es werden keine automatischen Ausfallkosten oder Vertragsstrafen berechnet.</p><p class="withdrawal-text">${esc(text)}</p></details>`
  : "";
