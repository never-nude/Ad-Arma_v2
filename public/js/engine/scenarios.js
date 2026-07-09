// Boards and army deployments. 13 cols x 9 rows, pointy-top hexes,
// "odd-r" offset mapped to axial: q = col - floor(r/2).
// Side 0 (Rome) deploys south (rows 7-8) and retreats toward row 8.
// Side 1 (Carthage) deploys north (rows 0-1) and retreats toward row 0.

import { C } from './constants.js';
import { key } from './hex.js';
import { nextFloat } from './rng.js';

export function axial(col, row) {
  return { q: col - Math.floor(row / 2), r: row };
}

export function colOf(q, r) {
  return q + Math.floor(r / 2);
}

export function sectionOf(q, r) {
  const col = colOf(q, r);
  for (let s = 0; s < C.SECTIONS.length; s++) {
    if (col >= C.SECTIONS[s][0] && col <= C.SECTIONS[s][1]) return s;
  }
  return -1;
}

function baseCells() {
  const cells = {};
  for (let row = 0; row < C.BOARD_ROWS; row++) {
    for (let col = 0; col < C.BOARD_COLS; col++) {
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

// Standard deployment, mirrored. Returns [{type, col, row, side}].
function standardArmies() {
  const south = [
    ['skirmisher', 3, 7], ['infantry', 4, 7], ['infantry', 5, 7],
    ['infantry', 7, 7], ['infantry', 8, 7], ['skirmisher', 9, 7],
    ['cavalry', 2, 8], ['general', 6, 8], ['cavalry', 10, 8],
  ];
  const units = [];
  for (const [type, col, row] of south) {
    units.push({ type, col, row, side: 0 });
    units.push({ type, col: C.BOARD_COLS - 1 - col, row: C.BOARD_ROWS - 1 - row, side: 1 });
  }
  return units;
}

const DEPLOY_ROWS = [0, 1, 7, 8];

function clearDeployRows(cells) {
  for (const row of DEPLOY_ROWS) {
    for (let col = 0; col < C.BOARD_COLS; col++) set(cells, col, row, 'open');
  }
}

export const SCENARIOS = {
  riverCrossing: {
    name: 'The River Crossing',
    blurb: 'A cold river splits the field. Two fords. Whoever holds them holds the battle.',
    build() {
      const cells = baseCells();
      for (let col = 0; col < C.BOARD_COLS; col++) set(cells, col, 4, 'river');
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
    build() {
      const cells = baseCells();
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
    build() {
      const cells = baseCells();
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
    build(rngCursor) {
      const cells = baseCells();
      const river = nextFloat(rngCursor) < 0.35;
      if (river) {
        for (let col = 0; col < C.BOARD_COLS; col++) set(cells, col, 4, 'river');
        const f1 = 1 + Math.floor(nextFloat(rngCursor) * 5); // 1..5
        set(cells, f1, 4, 'ford');
        set(cells, C.BOARD_COLS - 1 - f1, 4, 'ford');
        if (nextFloat(rngCursor) < 0.5) set(cells, 6, 4, 'ford');
      }
      for (let row = 2; row <= (river ? 3 : 4); row++) {
        for (let col = 0; col < C.BOARD_COLS; col++) {
          if (row === 4 && col > 6) break; // mirror handles the rest of the middle row
          const roll = nextFloat(rngCursor);
          let t = null;
          if (roll < 0.13) t = 'forest';
          else if (roll < 0.23) t = 'hill';
          if (t) {
            set(cells, col, row, t);
            set(cells, C.BOARD_COLS - 1 - col, C.BOARD_ROWS - 1 - row, t);
          }
        }
      }
      clearDeployRows(cells);
      return cells;
    },
  },
};

export function makeBoard(scenarioId, rngCursor) {
  const sc = SCENARIOS[scenarioId] || SCENARIOS.openField;
  const cells = sc.build(rngCursor);
  return { scenarioId, cells };
}

export function makeUnits() {
  const units = [];
  let n = 0;
  for (const u of standardArmies()) {
    const { q, r } = axial(u.col, u.row);
    units.push({
      id: (u.side === 0 ? 'R' : 'C') + n++,
      side: u.side,
      type: u.type,
      q, r,
      blocks: undefined, // filled by engine from UNIT_TYPES
    });
  }
  return units;
}
