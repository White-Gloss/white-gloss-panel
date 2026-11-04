// Bewegung und Gesten nach den Regeln von Apples „Designing Fluid Interfaces“:
// Berührung 1:1, Federn statt fester Zeiten, Momentum-Projektion, Gummiband am Rand, jederzeit unterbrechbar.
// Keine Bibliothek; Animation nur über transform.

/** Wohin eine Bewegung mit Geschwindigkeit `velocity` (px/s) ausläuft (Scroll-Abbremsung). */
export function project(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/** Zunehmender Widerstand jenseits einer Grenze; Vorzeichen bleibt erhalten. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Nächster Haltepunkt zu `position` (bei Gleichstand der erste). */
export function nearestSnap(position, snaps) {
  let best = snaps[0];
  for (const s of snaps) if (Math.abs(s - position) < Math.abs(best - position)) best = s;
  return best;
}

/**
 * Ein Zeitschritt einer gedämpften Feder. `damping` 1 = ohne Überschwingen, < 1 federt nach;
 * `response` in Sekunden bestimmt die Schnelligkeit. Die Geschwindigkeit wird übernommen, nicht zurückgesetzt.
 */
export function springStep(state, target, dt, {damping = 1, response = 0.35} = {}) {
  const omega = (2 * Math.PI) / response, stiffness = omega * omega, drag = 2 * damping * omega;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / steps;
  let {value, velocity} = state;
  for (let i = 0; i < steps; i++) {
    velocity += (-stiffness * (value - target) - drag * velocity) * h;
    value += velocity * h;
  }
  return {value, velocity};
}

/**
 * Macht aus einem <dialog> ein Bottom-Sheet, das am Kopfbereich nach unten gezogen und weggewischt werden kann.
 * Rückgabe: Funktion zum Abmelden. Bei `reduceMotion` bleibt nur der Schließen-Knopf.
 */
export function attachSheet(dialog, {onClose, reduceMotion = false, handle = '.modalhead', enabled = () => true, raf, caf} = {}) {
  if (reduceMotion) return () => {};
  const request = raf ?? (cb => window.requestAnimationFrame(cb)), cancel = caf ?? (id => window.cancelAnimationFrame(id));
  let pos = 0, drag = null, animation = null;
  const height = () => dialog.getBoundingClientRect().height || 1;
  const apply = () => { dialog.style.transform = pos === 0 ? '' : `translateY(${pos}px)`; };
  const stop = () => { if (animation !== null) { cancel(animation.id); animation = null; } };
  const reset = () => { stop(); drag = null; pos = 0; apply(); };

  function animateTo(target, velocity) {
    stop();
    let state = {value: pos, velocity}, last = null;
    const spring = {damping: Math.abs(velocity) > 300 ? 0.8 : 1, response: 0.35};
    const frame = time => {
      const dt = last === null ? 1 / 60 : Math.min(0.05, (time - last) / 1000);
      last = time;
      state = springStep(state, target, dt, spring);
      pos = state.value;
      if (Math.abs(pos - target) < 0.5 && Math.abs(state.velocity) < 5) {
        pos = target; animation = null; apply();
        if (target !== 0) onClose?.();
        return;
      }
      apply();
      animation.id = request(frame);
    };
    animation = {id: 0};
    animation.id = request(frame);
  }

  const down = e => {
    if (!enabled() || !e.target.closest?.(handle) || e.target.closest('button,a,input,select,textarea')) return;
    stop();
    drag = {startY: e.clientY, base: pos, samples: [{t: e.timeStamp, y: e.clientY}]};
    try { dialog.setPointerCapture?.(e.pointerId); } catch { /* Capture ist optional. */ }
  };
  const move = e => {
    if (!drag) return;
    const raw = drag.base + (e.clientY - drag.startY);
    pos = raw >= 0 ? raw : rubberband(raw, height());
    drag.samples.push({t: e.timeStamp, y: e.clientY});
    if (drag.samples.length > 6) drag.samples.shift();
    apply();
  };
  const up = () => {
    if (!drag) return;
    const {samples} = drag, last = samples.at(-1);
    const first = samples.find(s => s.t >= last.t - 100) ?? last;
    const velocity = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
    drag = null;
    animateTo(nearestSnap(pos + project(velocity), [0, height()]), velocity);
  };

  dialog.addEventListener('pointerdown', down);
  dialog.addEventListener('pointermove', move);
  dialog.addEventListener('pointerup', up);
  dialog.addEventListener('pointercancel', up);
  dialog.addEventListener('close', reset);
  return () => {
    dialog.removeEventListener('pointerdown', down);
    dialog.removeEventListener('pointermove', move);
    dialog.removeEventListener('pointerup', up);
    dialog.removeEventListener('pointercancel', up);
    dialog.removeEventListener('close', reset);
    reset();
  };
}

const attached = new WeakSet();
/** Aktiviert die Sheet-Geste einmal pro Dialog; wirksam nur auf kleinen Bildschirmen und ohne Bewegungsreduktion. */
export function enableSheet(dialog) {
  if (attached.has(dialog) || typeof window.matchMedia !== 'function') return;
  attached.add(dialog);
  const small = window.matchMedia('(max-width:720px)'), calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  attachSheet(dialog, {onClose: () => dialog.close(), enabled: () => small.matches && !calm.matches});
}
