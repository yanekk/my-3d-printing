// The printer profile: every tuned threshold in this project, in one place.
//
// DESIGN.md §2.5 requires this. The overhang bands, the wall minimums and the bed-contact
// tolerance are not universal truths — they are what a direct-drive Ender-3 V3 KE gets away
// with, and they will be wrong the first time a real print disagrees. Retuning them must be a
// one-line change to this table, not a hunt through five modules for a scattered `45`.
//
// **Data only. No logic lives here, and nothing here is computed.** A function in this file
// would be a threshold that cannot be read off the page, which defeats the point.
//
// The numbers came from Creality's own listing for the machine rather than from memory
// (FINDINGS.md, 2026-08-26): 220 x 220 x 240 mm, 0.4 mm nozzle, 300 C hotend, direct drive.

/**
 * @typedef {{
 *   mild: number, steep: number, severe: number, ceiling: number
 * }} OverhangBandsDeg
 */

/**
 * @typedef {{
 *   name: string,
 *   buildVolumeMm: [number, number, number],
 *   usableMarginMm: number,
 *   nozzleMm: number,
 *   layerHeightMm: number,
 *   minWallMm: number,
 *   preferredMinWallMm: number,
 *   bedContactToleranceMm: number,
 *   bandEdgeToleranceDeg: number,
 *   overhangBandsDeg: OverhangBandsDeg,
 *   materials: Record<string, {densityGPerCm3: number, label: string}>
 * }} Machine
 */

/** @type {Machine} */
export const ENDER3_V3_KE = {
  name: 'Creality Ender-3 V3 KE',
  buildVolumeMm: [220, 220, 240],
  usableMarginMm: 5, // bed clips and the purge line eat the edges
  nozzleMm: 0.4,
  layerHeightMm: 0.2,
  minWallMm: 0.86, // two perimeters at 0.43 mm extrusion width
  preferredMinWallMm: 1.2,
  bedContactToleranceMm: 0.05,

  // How near a band edge counts as *on* it, in degrees. An STL stores float32, so a face a
  // designer drew at exactly 45 degrees measures 45.000003 about one time in twenty-five
  // (FINDINGS.md, 2026-08-28: 39 of 1060 exact-45 faces measured above the line). Without
  // this, the commonest feature on a printed part — a 45 degree chamfer — is called "will
  // show sag" at random, and two exports of one model disagree.
  //
  // A face within this of an edge is snapped to the edge, which the half-open bands then put
  // in the *gentler* band (user's decision, 2026-08-28). 0.01 degrees is four thousand times
  // the measured float32 scatter and far below anything a printer can show: the honest
  // measurement error in the file is larger than the correction.
  bandEdgeToleranceDeg: 0.01,

  overhangBandsDeg: { mild: 30, steep: 45, severe: 60, ceiling: 85 },

  materials: {
    pla: { densityGPerCm3: 1.24, label: 'PLA' },
    petg: { densityGPerCm3: 1.27, label: 'PETG' },
  },
};
