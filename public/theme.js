// Tag/Nacht-Schalter. Läuft im <head> vor den Stylesheets, damit die gewählte Anzeige ohne Aufblitzen erscheint.
// Ohne Wahl bestimmt das Gerät die Anzeige (prefers-color-scheme); die Wahl wird im Browser gemerkt.
(function () {
  var KEY = 'wg-theme', root = document.documentElement, COLORS = {dark: '#0e1218', light: '#f5f3ee'};
  function saved() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function deviceLight() { try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { return false; } }
  function shown() { return root.dataset.theme || (deviceLight() ? 'light' : 'dark'); }
  function paint() {
    var explicit = root.dataset.theme, label = shown() === 'dark' ? 'Zu Tag wechseln' : 'Zu Nacht wechseln', i, el;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (i = 0; i < metas.length; i++) {
      el = metas[i];
      if (!el.dataset.auto) el.dataset.auto = el.content;
      el.content = explicit ? COLORS[explicit] : el.dataset.auto;
    }
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (i = 0; i < buttons.length; i++) { buttons[i].setAttribute('aria-label', label); buttons[i].setAttribute('title', label); }
  }
  var start = saved();
  if (start) root.dataset.theme = start;
  document.addEventListener('click', function (event) {
    var target = event.target, button = target && target.closest ? target.closest('[data-theme-toggle]') : null;
    if (!button) return;
    var next = shown() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* Auswahl gilt dann nur für diese Sitzung. */ }
    root.dataset.theme = next;
    paint();
  });
  try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', paint); } catch (e) { /* älterer Browser */ }
  if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint);
  // Das Panel zeichnet seine Leisten neu; die Beschriftung der Schalter folgt der Anzeige.
  try { new window.MutationObserver(paint).observe(root, {childList: true, subtree: true}); } catch (e) { /* ohne Beobachter: Beschriftung bleibt allgemein */ }
})();
