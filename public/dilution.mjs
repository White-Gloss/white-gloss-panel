const decimal = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i;

function number(value, label, allowZero = false) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new RangeError(`${label}: Bitte eine Zahl eingeben.`);
  }
  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw === 'string' && !decimal.test(raw)) {
    throw new RangeError(`${label}: Bitte eine Zahl ohne Tausendertrennzeichen eingeben.`);
  }
  const parsed = typeof raw === 'string' ? Number(raw.replace(',', '.')) : raw;
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new RangeError(`${label}: Bitte eine endliche ${allowZero ? 'nichtnegative' : 'positive'} Zahl eingeben.`);
  }
  return parsed;
}

function rangeError() {
  return new RangeError('Die Menge oder das Verhältnis ist zu groß oder zu klein für eine zuverlässige Berechnung.');
}

// Change the operation order when an intermediate product or quotient would
// overflow or underflow even though the final volume is representable.
function multiplyDivide(a, b, divisor) {
  let fallback;
  const orders = [[a / divisor, b, false], [b / divisor, a, false], [a * b, divisor, true]];
  for (const [intermediate, operand, divide] of orders) {
    const candidate = divide ? intermediate / operand : intermediate * operand;
    if (Number.isFinite(candidate) && candidate > 0) {
      // A subnormal intermediate may lose precision before the second step.
      if (intermediate >= 2 ** -1022) return candidate;
      fallback ??= candidate;
    }
  }
  if (fallback !== undefined) return fallback;
  throw rangeError();
}

/**
 * A ratio of 1:10 means one part concentrate plus ten parts water.
 * `total` uses the finished volume; `water` uses water already in the bottle.
 * All result volumes are unrounded millilitres.
 */
export function calculateDilution({amount, unit = 'ml', concentrateParts = 1, waterParts = 10, basis = 'total'} = {}) {
  const volume = number(amount, 'Menge');
  const concentrate = number(concentrateParts, 'Konzentratteile');
  const water = number(waterParts, 'Wasserteile', true);
  if (unit !== 'ml' && unit !== 'l') throw new RangeError('Einheit: Bitte ml oder L auswählen.');
  if (basis !== 'total' && basis !== 'water') throw new RangeError('Berechnungsbasis: Bitte Gesamtmenge oder Wassermenge auswählen.');
  if (basis === 'water' && water === 0) throw new RangeError('Bei vorhandener Wassermenge muss das Verhältnis Wasserteile größer als 0 enthalten. Für unverdünntes Konzentrat bitte Gesamtmenge wählen.');
  const amountMl = volume * (unit === 'l' ? 1000 : 1);
  if (!Number.isFinite(amountMl) || amountMl <= 0) throw rangeError();

  // Halving both parts only when their sum overflows preserves the ratio.
  const scale = Number.isFinite(concentrate + water) ? 1 : 0.5;
  const concentrateScaled = concentrate * scale;
  const waterScaled = water * scale;
  const parts = concentrateScaled + waterScaled;
  const concentrationPercent = Math.min(100, multiplyDivide(100, concentrateScaled, parts));
  let concentrateMl, waterMl, totalMl;
  if (basis === 'total') {
    totalMl = amountMl;
    concentrateMl = multiplyDivide(totalMl, concentrateScaled, parts);
    waterMl = water === 0 ? 0 : multiplyDivide(totalMl, waterScaled, parts);
  } else {
    waterMl = amountMl;
    concentrateMl = multiplyDivide(waterMl, concentrate, water);
    totalMl = concentrateMl + waterMl;
    if (!Number.isFinite(totalMl)) throw rangeError();
  }
  return {concentrateMl, waterMl, totalMl, concentrationPercent};
}

function volumeNumber(value, maximumFractionDigits) {
  if (value > 0 && value < 0.001) {
    return new Intl.NumberFormat('de-DE', {notation: 'scientific', maximumFractionDigits: 2}).format(value);
  }
  const precision = value > 0 && value < 1
    ? Math.max(maximumFractionDigits, Math.ceil(-Math.log10(value)) + 2)
    : maximumFractionDigits;
  return new Intl.NumberFormat('de-DE', {maximumFractionDigits: precision}).format(value);
}

/** Display millilitres, adding litres from 1000 ml upwards. */
export function formatVolume(volumeMl) {
  if (typeof volumeMl !== 'number' || !Number.isFinite(volumeMl) || volumeMl < 0) {
    throw new RangeError('Die anzuzeigende Menge muss eine endliche, nichtnegative Zahl sein.');
  }
  const millilitres = `${volumeNumber(volumeMl, 2)} ml`;
  return volumeMl >= 1000 ? `${millilitres} (${volumeNumber(volumeMl / 1000, 3)} L)` : millilitres;
}
