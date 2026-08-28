// core/machine.js — the printer profile. There is no logic here to test, so what these tests
// defend is that the table still says what the rest of the project believes it says.
//
// That is not busywork. Every threshold in this file is quoted by name somewhere else —
// core/overhangs.js reads the bands, T06 reads the build volume, T07 reads the densities — and
// a silent edit to one number here changes what the report tells the user about a real part
// with nothing to catch it. These tests are the something.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENDER3_V3_KE } from '../core/machine.js';

test('the profile is the Ender-3 V3 KE as Creality lists it', () => {
  assert.equal(ENDER3_V3_KE.name, 'Creality Ender-3 V3 KE');
  assert.deepEqual(ENDER3_V3_KE.buildVolumeMm, [220, 220, 240]);
  assert.equal(ENDER3_V3_KE.nozzleMm, 0.4);
  assert.equal(ENDER3_V3_KE.layerHeightMm, 0.2);
  assert.equal(ENDER3_V3_KE.usableMarginMm, 5);
});

test('the overhang bands are the four thresholds DESIGN.md §2.5 tabulates, ascending', () => {
  const { mild, steep, severe, ceiling } = ENDER3_V3_KE.overhangBandsDeg;
  assert.deepEqual([mild, steep, severe, ceiling], [30, 45, 60, 85]);
  // Ascending is not decoration: core/overhangs.js walks them in order and a table out of
  // order would put every face in the first band that matched, silently.
  assert.ok(mild < steep && steep < severe && severe < ceiling);
  for (const edge of [mild, steep, severe, ceiling]) {
    assert.ok(edge > 0 && edge < 90, `${edge} is not an overhang angle`);
  }
});

test('the band-edge tolerance is smaller than any gap between two bands', () => {
  // The snap in core/overhangs.js pulls an angle onto the nearest edge. If the tolerance were
  // ever half a band wide it would pull faces across a whole band, which is the failure the
  // snap exists to prevent, in the other direction.
  const edges = [30, 45, 60, 85];
  const smallestGap = Math.min(...edges.slice(1).map((edge, i) => edge - edges[i]));
  assert.ok(ENDER3_V3_KE.bandEdgeToleranceDeg > 0);
  assert.ok(ENDER3_V3_KE.bandEdgeToleranceDeg < smallestGap / 2);
  assert.equal(ENDER3_V3_KE.bandEdgeToleranceDeg, 0.01);
});

test('wall minimums follow from the nozzle, and the preferred one is the larger', () => {
  assert.equal(ENDER3_V3_KE.minWallMm, 0.86); // two perimeters at 0.43 mm extrusion width
  assert.equal(ENDER3_V3_KE.preferredMinWallMm, 1.2);
  assert.ok(ENDER3_V3_KE.preferredMinWallMm > ENDER3_V3_KE.minWallMm);
  assert.ok(ENDER3_V3_KE.minWallMm > ENDER3_V3_KE.nozzleMm);
});

test('bed contact tolerance is a fraction of a layer', () => {
  // A tolerance at or above the layer height would count the whole first layer of a curved
  // base as flat contact, and the footprint would read far larger than it prints.
  assert.equal(ENDER3_V3_KE.bedContactToleranceMm, 0.05);
  assert.ok(ENDER3_V3_KE.bedContactToleranceMm < ENDER3_V3_KE.layerHeightMm);
});

test('both materials carry a density and a label for the report', () => {
  assert.deepEqual(Object.keys(ENDER3_V3_KE.materials).sort(), ['petg', 'pla']);
  assert.equal(ENDER3_V3_KE.materials.pla.densityGPerCm3, 1.24);
  assert.equal(ENDER3_V3_KE.materials.petg.densityGPerCm3, 1.27);
  for (const [key, material] of Object.entries(ENDER3_V3_KE.materials)) {
    assert.equal(typeof material.label, 'string', key);
    assert.ok(material.densityGPerCm3 > 0.5 && material.densityGPerCm3 < 3, key);
  }
});

test('the profile is data only — nothing in it is a function', () => {
  // DESIGN.md §2.5 requires retuning to be a one-line change to a table. A function here would
  // be a threshold that cannot be read off the page.
  const walk = (value, path) => {
    assert.notEqual(typeof value, 'function', `${path} is a function`);
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  };
  walk(ENDER3_V3_KE, 'ENDER3_V3_KE');
});
