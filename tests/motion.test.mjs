import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {project, rubberband, nearestSnap, springStep, attachSheet} from '../public/motion.js';

test('project follows the exponential-decay formula', () => {
  assert.equal(project(0), 0);
  assert.ok(Math.abs(project(1000) - 499) < 0.01);
  assert.ok(Math.abs(project(-1000) + 499) < 0.01);
});

test('rubberband resists more the further it goes and is symmetric', () => {
  assert.equal(rubberband(0, 500), 0);
  const a = rubberband(50, 500), b = rubberband(100, 500), c = rubberband(400, 500);
  assert.ok(0 < a && a < 50 && a < b && b < 100 && b < c && c < 400);
  assert.equal(rubberband(-100, 500), -b);
});

test('nearestSnap picks the closest snap point', () => {
  assert.equal(nearestSnap(60, [0, 100]), 100);
  assert.equal(nearestSnap(40, [0, 100]), 0);
  assert.equal(nearestSnap(-20, [0, 100]), 0);
});

function settle(target, opts, seconds = 2) {
  let s = {value: 0, velocity: 0}, max = 0;
  for (let i = 0; i < seconds * 60; i++) { s = springStep(s, target, 1 / 60, opts); max = Math.max(max, s.value); }
  return {...s, max};
}
test('critically damped spring settles without overshoot', () => {
  const r = settle(100, {damping: 1, response: 0.35});
  assert.ok(Math.abs(r.value - 100) < 0.5, 'settled ' + r.value);
  assert.ok(r.max <= 100.5, 'no overshoot ' + r.max);
});
test('damping below one overshoots at least once', () => {
  const r = settle(100, {damping: 0.8, response: 0.35});
  assert.ok(r.max > 100.5, 'overshoot ' + r.max);
  assert.ok(Math.abs(r.value - 100) < 1);
});
test('spring keeps the incoming velocity (hand-off)', () => {
  const s = springStep({value: 0, velocity: 2000}, 100, 1 / 60, {damping: 1, response: 0.35});
  assert.ok(s.value > 20, 'moves immediately with the finger speed: ' + s.value);
});

function setup(opts = {}) {
  const dom = new JSDOM('<dialog open><div class="modalhead"><h2>T</h2></div><div class="modalbody">x</div></dialog>', {pretendToBeVisual: true});
  const w = dom.window, dialog = w.document.querySelector('dialog'), head = dialog.querySelector('.modalhead');
  dialog.getBoundingClientRect = () => ({height: 400, width: 360, top: 0, left: 0, right: 360, bottom: 400});
  dialog.setPointerCapture = () => {}; head.setPointerCapture = () => {};
  const frames = []; let clock = 0, closed = 0;
  const raf = cb => { frames.push(cb); return frames.length; };
  const caf = id => { if (frames[id - 1]) frames[id - 1] = null; };
  const detach = attachSheet(dialog, {onClose: () => { closed++; }, raf, caf, ...opts});
  const ev = (type, y, t) => {
    const e = new w.Event(type, {bubbles: true});
    Object.defineProperty(e, 'clientY', {value: y}); Object.defineProperty(e, 'pointerId', {value: 1});
    Object.defineProperty(e, 'timeStamp', {value: t});
    head.dispatchEvent(e);
  };
  const run = (max = 400) => { for (let i = 0; i < max; i++) { const cb = frames.find(Boolean); if (!cb) return; frames[frames.indexOf(cb)] = null; clock += 1000 / 60; cb(clock); } };
  const y = () => parseFloat(/translateY\((-?[\d.]+)px\)/.exec(dialog.style.transform)?.[1] ?? '0');
  return {dialog, ev, run, y, detach, closed: () => closed, frames};
}

test('a fast downward flick closes the sheet', () => {
  const s = setup();
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 100, 50); s.ev('pointermove', 300, 100); s.ev('pointerup', 300, 100);
  s.run();
  assert.equal(s.closed(), 1);
  assert.ok(s.y() >= 399, 'ended off-screen: ' + s.y());
});

test('a slow short drag springs back and does not close', () => {
  const s = setup();
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 40, 1000); s.ev('pointerup', 40, 1000);
  s.run();
  assert.equal(s.closed(), 0);
  assert.ok(Math.abs(s.y()) < 0.5, 'back at rest: ' + s.y());
});

test('dragging upwards is rubber-banded', () => {
  const s = setup();
  s.ev('pointerdown', 0, 0); s.ev('pointermove', -100, 50);
  assert.ok(s.y() < 0 && s.y() > -100, 'resisted: ' + s.y());
});

test('the sheet follows the finger one to one while dragging down', () => {
  const s = setup();
  s.ev('pointerdown', 10, 0); s.ev('pointermove', 90, 50);
  assert.equal(Math.round(s.y()), 80);
});

test('a new touch interrupts the running animation from its current position', () => {
  const s = setup();
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 200, 800); s.ev('pointerup', 200, 800);
  s.run(5);
  const before = s.y();
  assert.ok(before > 0 && before < 200, 'mid flight ' + before);
  s.ev('pointerdown', 50, 900); s.ev('pointermove', 50, 910);
  assert.ok(Math.abs(s.y() - before) < 1, 'no jump: ' + s.y() + ' vs ' + before);
});

test('reduced motion disables the drag gesture', () => {
  const s = setup({reduceMotion: true});
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 300, 50); s.ev('pointerup', 300, 50);
  assert.equal(s.dialog.style.transform, '');
  assert.equal(s.closed(), 0);
});

test('detach removes the gesture', () => {
  const s = setup(); s.detach();
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 100, 50);
  assert.equal(s.dialog.style.transform, '');
});

test('the dialog resets its position when it closes', () => {
  const s = setup();
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 100, 50);
  s.dialog.dispatchEvent(new s.dialog.ownerDocument.defaultView.Event('close'));
  assert.equal(s.dialog.style.transform, '');
});

test('the gesture stays off when the enabled check says no (desktop)', () => {
  const s = setup({enabled: () => false});
  s.ev('pointerdown', 0, 0); s.ev('pointermove', 100, 50);
  assert.equal(s.dialog.style.transform, '');
});
