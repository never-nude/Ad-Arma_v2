// Scenario definitions — every board is pure data. A scenario declares its
// dimensions, per-side laurel targets, armies (with placements), deployment
// zones, and terrain. Adding a battle (historical or otherwise) should never
// require touching the engine.
//
// Grid: pointy-top hexes, "odd-r" offset mapped to axial: q = col - floor(row/2).
// Side 0 deploys south (high rows) and retreats toward row rows-1.
// Side 1 deploys north (low rows) and retreats toward row 0.

import { key } from './hex.js';
import { nextFloat } from './rng.js';

export function axial(col, row) {
  return { q: col - Math.floor(row / 2), r: row };
}

export function colOf(q, r) {
  return q + Math.floor(r / 2);
}

// Board thirds (Left / Center / Right) — trap-targeting zones.
export function thirds(cols) {
  const a = Math.floor(cols / 3);
  return [[0, a - 1], [a, cols - 1 - a], [cols - a, cols - 1]];
}

// Section of a hex on a given board (-1 off-board).
export function sectionOf(board, q, r) {
  const col = colOf(q, r);
  for (let s = 0; s < board.sections.length; s++) {
    if (col >= board.sections[s][0] && col <= board.sections[s][1]) return s;
  }
  return -1;
}

function baseCells(dims) {
  const cells = {};
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const { q, r } = axial(col, row);
      cells[key(q, r)] = 'open';
    }
  }
  return cells;
}

function set(cells, col, row, type) {
  const { q, r } = axial(col, row);
  const k = key(q, r);
  if (k in cells) cells[k] = type;
}

// Mirror a southern army list into both sides: [{type, col, row}, ...]
function mirrored(dims, south) {
  const armies = [[], []];
  for (const u of south) {
    armies[0].push({ ...u });
    armies[1].push({ type: u.type, col: dims.cols - 1 - u.col, row: dims.rows - 1 - u.row });
  }
  return armies;
}

// The classic 9-unit muster on a 13x9 field.
function standardArmies(dims) {
  return mirrored(dims, [
    { type: 'skirmisher', col: 3, row: 7 }, { type: 'infantry', col: 4, row: 7 },
    { type: 'infantry', col: 5, row: 7 }, { type: 'infantry', col: 7, row: 7 },
    { type: 'infantry', col: 8, row: 7 }, { type: 'skirmisher', col: 9, row: 7 },
    { type: 'cavalry', col: 2, row: 8 }, { type: 'general', col: 6, row: 8 },
    { type: 'cavalry', col: 10, row: 8 },
  ]);
}

const DIMS_13 = { cols: 13, rows: 9 };
const DIMS_17 = { cols: 17, rows: 11 };
const DIMS_21 = { cols: 21, rows: 13 };

function zones(dims, depth = 3) {
  return [
    { minRow: dims.rows - depth, maxRow: dims.rows - 1 },
    { minRow: 0, maxRow: depth - 1 },
  ];
}

export const SCENARIOS = {
  riverCrossing: {
    name: 'The River Crossing',
    blurb: 'A cold river splits the field. Two fords. Whoever holds them holds the battle.',
    dims: DIMS_13,
    laurelTarget: [5, 5],
    deployZones: zones(DIMS_13),
    armies: standardArmies(DIMS_13),
    build(rngCursor, dims) {
      const cells = baseCells(dims);
      for (let col = 0; col < dims.cols; col++) set(cells, col, 4, 'river');
      set(cells, 3, 4, 'ford');
      set(cells, 9, 4, 'ford');
      set(cells, 1, 2, 'forest'); set(cells, 11, 2, 'forest');
      set(cells, 1, 6, 'forest'); set(cells, 11, 6, 'forest');
      set(cells, 6, 2, 'hill'); set(cells, 6, 6, 'hill');
      return cells;
    },
  },
  hillCountry: {
    name: 'Hill Country',
    blurb: 'A ridge commands the center; dark woods crowd the flanks. Take the high ground.',
    dims: DIMS_13,
    laurelTarget: [5, 5],
    deployZones: zones(DIMS_13),
    armies: standardArmies(DIMS_13),
    build(rngCursor, dims) {
      const cells = baseCells(dims);
      set(cells, 5, 4, 'hill'); set(cells, 6, 4, 'hill'); set(cells, 7, 4, 'hill');
      set(cells, 6, 3, 'hill'); set(cells, 6, 5, 'hill');
      set(cells, 1, 3, 'forest'); set(cells, 2, 3, 'forest');
      set(cells, 10, 3, 'forest'); set(cells, 11, 3, 'forest');
      set(cells, 1, 5, 'forest'); set(cells, 2, 5, 'forest');
      set(cells, 10, 5, 'forest'); set(cells, 11, 5, 'forest');
      return cells;
    },
  },
  openField: {
    name: 'Open Field',
    blurb: 'Line against line under an open sky. The purest test of the commander.',
    dims: DIMS_13,
    laurelTarget: [5, 5],
    deployZones: zones(DIMS_13),
    armies: standardArmies(DIMS_13),
    build(rngCursor, dims) {
      const cells = baseCells(dims);
      set(cells, 3, 3, 'forest'); set(cells, 9, 5, 'forest');
      set(cells, 9, 3, 'forest'); set(cells, 3, 5, 'forest');
      set(cells, 6, 4, 'hill');
      set(cells, 2, 4, 'hill'); set(cells, 10, 4, 'hill');
      return cells;
    },
  },
  randomField: {
    name: 'Random Field',
    blurb: 'The augurs draw a new land. Mirrored and fair — but never seen before.',
    dims: DIMS_13,
    laurelTarget: [5, 5],
    deployZones: zones(DIMS_13),
    armies: standardArmies(DIMS_13),
    build(rngCursor, dims) {
      const cells = baseCells(dims);
      const midRow = (dims.rows - 1) / 2;
      const river = nextFloat(rngCursor) < 0.35;
      if (river) {
        for (let col = 0; col < dims.cols; col++) set(cells, col, midRow, 'river');
        const f1 = 1 + Math.floor(nextFloat(rngCursor) * (midRow + 1));
        set(cells, f1, midRow, 'ford');
        set(cells, dims.cols - 1 - f1, midRow, 'ford');
        if (nextFloat(rngCursor) < 0.5) set(cells, Math.floor(dims.cols / 2), midRow, 'ford');
      }
      for (let row = 2; row <= (river ? midRow - 1 : midRow); row++) {
        for (let col = 0; col < dims.cols; col++) {
          if (row === midRow && col > Math.floor(dims.cols / 2)) break; // mirror covers the rest
          const roll = nextFloat(rngCursor);
          let t = null;
          if (roll < 0.13) t = 'forest';
          else if (roll < 0.23) t = 'hill';
          if (t) {
            set(cells, col, row, t);
            set(cells, dims.cols - 1 - col, dims.rows - 1 - row, t);
          }
        }
      }
      return cells;
    },
  },
  grandField: {
    name: 'Grand Field',
    blurb: 'A wider war: thirteen units a side and room to be truly outflanked.',
    dims: DIMS_17,
    laurelTarget: [7, 7],
    nightfallTurn: 80,
    deployZones: zones(DIMS_17),
    armies: mirrored(DIMS_17, [
      { type: 'skirmisher', col: 3, row: 9 }, { type: 'skirmisher', col: 8, row: 9 },
      { type: 'skirmisher', col: 13, row: 9 },
      { type: 'infantry', col: 5, row: 9 }, { type: 'infantry', col: 6, row: 9 },
      { type: 'infantry', col: 7, row: 9 }, { type: 'infantry', col: 9, row: 9 },
      { type: 'infantry', col: 10, row: 9 }, { type: 'infantry', col: 11, row: 9 },
      { type: 'cavalry', col: 2, row: 10 }, { type: 'cavalry', col: 14, row: 10 },
      { type: 'cavalry', col: 6, row: 10 },
      { type: 'general', col: 8, row: 10 },
    ]),
    build(rngCursor, dims) {
      const cells = baseCells(dims);
      set(cells, 8, 5, 'hill'); set(cells, 4, 5, 'hill'); set(cells, 12, 5, 'hill');
      set(cells, 8, 4, 'hill'); set(cells, 8, 6, 'hill');
      set(cells, 2, 3, 'forest'); set(cells, 14, 3, 'forest');
      set(cells, 2, 7, 'forest'); set(cells, 14, 7, 'forest');
      set(cells, 5, 3, 'forest'); set(cells, 11, 7, 'forest');
      set(cells, 11, 3, 'forest'); set(cells, 5, 7, 'forest');
      return cells;
    },
  },
  greatPlain: {
    name: 'Great Plain',
    blurb: 'Seventeen units a side on an endless steppe. Bring a plan — and reserves.',
    dims: DIMS_21,
    laurelTarget: [9, 9],
    nightfallTurn: 100,
    deployZones: zones(DIMS_21),
    armies: mirrored(DIMS_21, [
      { type: 'skirmisher', col: 4, row: 10 }, { type: 'skirmisher', col: 8, row: 10 },
      { type: 'skirmisher', col: 12, row: 10 }, { type: 'skirmisher', col: 16, row: 10 },
      { type: 'infantry', col: 6, row: 11 }, { type: 'infantry', col: 7, row: 11 },
      { type: 'infantry', col: 8, row: 11 }, { type: 'infantry', col: 9, row: 11 },
      { type: 'infantry', col: 11, row: 11 }, { type: 'infantry', col: 12, row: 11 },
      { type: 'infantry', col: 13, row: 11 }, { type: 'infantry', col: 14, row: 11 },
      { type: 'cavalry', col: 3, row: 12 }, { type: 'cavalry', col: 7, row: 12 },
      { type: 'cavalry', col: 13, row: 12 }, { type: 'cavalry', col: 17, row: 12 },
      { type: 'general', col: 10, row: 12 },
    ]),
    build(rngCursor, dims) {
      const cells = baseCells(dims);
      set(cells, 10, 6, 'hill'); set(cells, 5, 6, 'hill'); set(cells, 15, 6, 'hill');
      set(cells, 3, 4, 'forest'); set(cells, 17, 4, 'forest');
      set(cells, 3, 8, 'forest'); set(cells, 17, 8, 'forest');
      set(cells, 10, 3, 'forest'); set(cells, 10, 9, 'forest');
      return cells;
    },
  },
};

export function getScenario(scenarioId) {
  return SCENARIOS[scenarioId] || SCENARIOS.openField;
}

export function makeBoard(scenarioId, rngCursor) {
  const sc = getScenario(scenarioId);
  const cells = sc.build(rngCursor, sc.dims);
  // army placement rows are always clear ground
  for (const army of sc.armies) {
    for (const u of army) set(cells, u.col, u.row, 'open');
  }
  return {
    scenarioId,
    cells,
    cols: sc.dims.cols,
    rows: sc.dims.rows,
    sections: thirds(sc.dims.cols),
    deployZones: sc.deployZones.map(z => ({ ...z })),
  };
}

export function makeUnits(scenarioId) {
  const sc = getScenario(scenarioId);
  const units = [];
  let n = 0;
  for (const side of [0, 1]) {
    for (const u of sc.armies[side]) {
      const { q, r } = axial(u.col, u.row);
      units.push({
        id: (side === 0 ? 'R' : 'C') + n++,
        side,
        type: u.type,
        q, r,
        blocks: undefined, // filled by engine from UNIT_TYPES
      });
    }
  }
  return units;
}
