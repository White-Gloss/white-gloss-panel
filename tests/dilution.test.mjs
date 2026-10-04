import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDilution, formatVolume} from '../public/dilution.mjs';

function approximately(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-12, Number.MIN_VALUE), `${actual} should equal ${expected}`);
}

test('1:10 means eleven parts: one finished litre contains 90.909 ml concentrate', () => {
  const result = calculateDilution({amount: 1, unit: 'l', concentrateParts: 1, waterParts: 10});
  approximately(result.concentrateMl, 90.9090909090909);
  approximately(result.waterMl, 909.090909090909);
  approximately(result.totalMl, 1000);
  approximately(result.concentrationPercent, 9.09090909090909);
});

test('five finished litres at 1:50 use 98.039 ml concentrate', () => {
  const result = calculateDilution({amount: 5, unit: 'l', concentrateParts: 1, waterParts: 50});
  approximately(result.concentrateMl, 98.0392156862745);
  approximately(result.waterMl, 4901.960784313725);
  approximately(result.totalMl, 5000);
  approximately(result.concentrationPercent, 1.96078431372549);
});

test('existing water basis adds concentrate instead of replacing water', () => {
  const result = calculateDilution({amount: 1, unit: 'l', concentrateParts: 1, waterParts: 10, basis: 'water'});
  approximately(result.concentrateMl, 100);
  approximately(result.waterMl, 1000);
  approximately(result.totalMl, 1100);
  approximately(result.concentrationPercent, 9.09090909090909);
});

test('German decimal commas, trimmed strings and fractional parts are accepted', () => {
  const result = calculateDilution({amount: ' 1,5 ', unit: 'l', concentrateParts: '0,5', waterParts: '2,5'});
  approximately(result.concentrateMl, 250);
  approximately(result.waterMl, 1250);
  approximately(result.totalMl, 1500);
  approximately(result.concentrationPercent, 16.6666666666667);
  assert.deepEqual(calculateDilution({amount: '500.5', concentrateParts: '1', waterParts: '1'}), {concentrateMl: 250.25, waterMl: 250.25, totalMl: 500.5, concentrationPercent: 50});
});

test('1:0 is undiluted concentrate only for finished total volume', () => {
  assert.deepEqual(calculateDilution({amount: 750, concentrateParts: 1, waterParts: 0}), {concentrateMl: 750, waterMl: 0, totalMl: 750, concentrationPercent: 100});
  assert.throws(() => calculateDilution({amount: 750, concentrateParts: 1, waterParts: 0, basis: 'water'}), /Für unverdünntes Konzentrat bitte Gesamtmenge wählen/);
});

test('invalid quantities and ambiguous strings give understandable errors', () => {
  for (const amount of [undefined, null, '', ' ', 0, -1, Infinity, NaN, 'Infinity', '12 ml', '1.000,5', '1,2,3', true, {}]) {
    assert.throws(() => calculateDilution({amount}), /Menge:/);
  }
  for (const concentrateParts of [0, -1, 'NaN', Infinity]) assert.throws(() => calculateDilution({amount: 100, concentrateParts}), /Konzentratteile:/);
  for (const waterParts of [-1, '', Infinity]) assert.throws(() => calculateDilution({amount: 100, waterParts}), /Wasserteile:/);
  assert.throws(() => calculateDilution(), /Menge:/);
  assert.throws(() => calculateDilution({amount: 100, unit: 'oz'}), /Einheit:/);
  assert.throws(() => calculateDilution({amount: 100, basis: 'concentrate'}), /Berechnungsbasis:/);
});

test('large equal ratio parts are valid even when their sum would overflow', () => {
  assert.deepEqual(calculateDilution({amount: 1000, concentrateParts: Number.MAX_VALUE, waterParts: Number.MAX_VALUE}), {concentrateMl: 500, waterMl: 500, totalMl: 1000, concentrationPercent: 50});
});

test('finite extreme results survive intermediate multiplication or division overflow', () => {
  const total = calculateDilution({amount: 1e308, concentrateParts: 1e-300, waterParts: 1});
  approximately(total.concentrateMl, 1e8);
  approximately(total.waterMl, 1e308);
  const water = calculateDilution({amount: 1e-308, concentrateParts: 1e308, waterParts: 1e-300, basis: 'water'});
  approximately(water.concentrateMl, 1e300);
  approximately(water.waterMl, 1e-308);
  approximately(water.totalMl, 1e300);
  const tinyParts = calculateDilution({amount: 1e308, concentrateParts: Number.MIN_VALUE, waterParts: 1.5});
  approximately(tinyParts.concentrateMl, 3.293770972274977e-16);
});

test('true volume overflow or unrepresentable parts never produce Infinity or silent zero', () => {
  assert.throws(() => calculateDilution({amount: Number.MAX_VALUE, unit: 'l'}), /zu groß oder zu klein/);
  assert.throws(() => calculateDilution({amount: Number.MAX_VALUE, concentrateParts: 2, waterParts: 1, basis: 'water'}), /zu groß oder zu klein/);
  assert.throws(() => calculateDilution({amount: Number.MIN_VALUE, concentrateParts: 1, waterParts: 10}), /zu groß oder zu klein/);
  assert.throws(() => calculateDilution({amount: 1000, concentrateParts: Number.MIN_VALUE, waterParts: Number.MAX_VALUE}), /zu groß oder zu klein/);
});

test('results conserve total volume and ratio for both supported bases', () => {
  for (const basis of ['total', 'water']) {
    for (const [amount, concentrateParts, waterParts] of [[375, 1, 20], [2400, 2, 3], [17.5, 0.25, 7.5]]) {
      const result = calculateDilution({amount, concentrateParts, waterParts, basis});
      approximately(result.concentrateMl + result.waterMl, result.totalMl);
      approximately(result.concentrateMl / result.waterMl, concentrateParts / waterParts);
      approximately(result.concentrateMl / result.totalMl * 100, result.concentrationPercent);
    }
  }
});

test('volume labels use German decimals and add litres from 1000 ml', () => {
  assert.equal(formatVolume(90.909090909), '90,91 ml');
  assert.equal(formatVolume(0), '0 ml');
  assert.equal(formatVolume(1000), '1.000 ml (1 L)');
  assert.equal(formatVolume(1500), '1.500 ml (1,5 L)');
  assert.equal(formatVolume(5000), '5.000 ml (5 L)');
  assert.equal(formatVolume(0.004), '0,004 ml');
  assert.notEqual(formatVolume(1e-12), '0 ml');
  for (const value of [-1, Infinity, NaN, '100']) assert.throws(() => formatVolume(value), /endliche, nichtnegative Zahl/);
});
