// Heuristic AI. Works from a filtered view (viewFor(state, side)) — it cannot
// see enemy scrolls, the bag order, or the RNG, so it plays by the same
// information rules as a human. Returns one action per call; the caller
// applies it and asks again.
//
// Difficulties: 'legate' (sloppy, no Fortuna), 'consul' (solid),
// 'imperator' (sharp: denial drafting, traps, EV-based Fortuna spends).

import { C, UNIT_TYPES } from './constants.js';
import { TILES, STRATAGEMS } from './council.js';
import {
  aliveUnits, unitById, unitAt, terrainAt, reachable, attackTargets,
  orderableUnits, attackOdds, diceFor, inDeployZone,
} from './engine.js';
import { sectionOf, colOf } from './scenarios.js';
import * as H from './hex.js';

const KILL_VALUE = { infantry: 3, cavalry: 3.5, skirmisher: 2.5, general: 8 };

export function aiAction(view, difficulty = 'consul') {
  // during blind deployment the view contains only our own units, so the
  // side can be read straight off them; otherwise we act on our turn
  const side = view.phase === 'deploy' ? view.units[0].side : view.turn;
  switch (view.phase) {
    case 'deploy': return planDeployment(view, side);
    case 'take': return pickTile(view, side, difficulty);
    case 'order': return pickOrders(view, side, difficulty);
    case 'move': return pickMove(view, side, difficulty);
    case 'battle': return pickBattle(view, side, difficulty);
    case 'combat': return pickCombat(view, side, difficulty);
    case 'pursuit': return pickPursuit(view, side, difficulty);
    default: return { t: 'endTurn' };
  }
}

// ------------------------------------------------------------- deployment

// Battle Plans muster: reads ONLY terrain and our own zone (the enemy is not
// even in this view). Infantry line center, cavalry on the wings, skirmishers
// screening (drawn to hills and fords), general center rear — with a little
// jitter so no two musters are identical.
function planDeployment(view, side) {
  const mine = aliveUnits(view, side);
  const zone = view.board.deployZones[side];
  const cols = view.board.cols;
  const center = Math.floor(cols / 2);
  // side 0's zone sits south, so its row nearest the enemy is the lowest one
  const front = side === 0 ? zone.minRow : zone.maxRow;
  const back = side === 0 ? zone.maxRow : zone.minRow;
  const mid = Math.round((front + back) / 2);
  const cells = Object.entries(view.board.cells)
    .map(([k, t]) => ({ ...H.unkey(k), t }))
    .filter(c => c.t !== 'river' && inDeployZone(view, side, c.r));
  const used = new Set();

  const fordCols = Object.entries(view.board.cells)
    .filter(([, t]) => t === 'ford')
    .map(([k]) => { const h = H.unkey(k); return colOf(h.q, h.r); });

  const wingCols = fordCols.length >= 2
    ? fordCols
    : fordCols.length === 1 ? [fordCols[0], fordCols[0] > center ? 2 : cols - 3] : [2, cols - 3];
  const screenCols = fordCols.length ? fordCols.slice(0, 2) : [3, cols - 4];
  while (screenCols.length < 2) screenCols.push(screenCols[0] ?? 3);

  // infantry line spreads outward from the center
  const lineCols = [];
  for (let i = 0; lineCols.length < mine.length; i++) {
    lineCols.push(center + (i % 2 ? 1 : -1) * Math.ceil(i / 2));
  }

  const wish = [];
  const gen = mine.find(u => u.type === 'general');
  if (gen) wish.push({ u: gen, col: center, row: back, hill: 0 });
  mine.filter(u => u.type === 'infantry').forEach((u, i) => {
    wish.push({ u, col: lineCols[i], row: mid, hill: 0.5 });
  });
  mine.filter(u => u.type === 'cavalry').forEach((u, i) => {
    wish.push({ u, col: i < 2 ? wingCols[i % wingCols.length] : center + (i % 2 ? 2 : -2), row: mid, hill: 0 });
  });
  mine.filter(u => u.type === 'skirmisher').forEach((u, i) => {
    wish.push({ u, col: i < 2 ? screenCols[i] : lineCols[i * 2 % lineCols.length], row: front, hill: 2 });
  });
  // any unit type not covered above (future-proofing)
  for (const u of mine) if (!wish.some(w => w.u.id === u.id)) wish.push({ u, col: center, row: mid, hill: 0 });

  const placements = [];
  for (const w of wish) {
    let best = null, bestScore = Infinity;
    for (const c of cells) {
      const k = H.key(c.q, c.r);
      if (used.has(k)) continue;
      const col = colOf(c.q, c.r);
      let score = Math.abs(col - w.col) + Math.abs(c.r - w.row) * 1.6 + Math.random() * 1.2;
      if (c.t === 'hill') score -= w.hill;
      if (c.t === 'forest' && w.u.type === 'cavalry') score += 2; // no horses in the trees
      if (score < bestScore) { bestScore = score; best = c; }
    }
    used.add(H.key(best.q, best.r));
    placements.push({ id: w.u.id, q: best.q, r: best.r });
  }
  return { t: 'deploy', placements };
}

// ---------------------------------------------------------------- scoring

function noise(difficulty) {
  if (difficulty === 'legate') return () => Math.random() * 2.2;
  if (difficulty === 'consul') return () => Math.random() * 0.7;
  return () => Math.random() * 0.15;
}

// How juicy is attacking from where this unit currently stands?
function standingAttackEV(view, unit) {
  let best = 0;
  for (const { unit: tgt } of attackTargets(view, unit)) {
    best = Math.max(best, attackEV(view, unit, tgt));
  }
  return best;
}

// Expected value of one attack: damage + kill chance − battle-back risk.
function attackEV(view, att, tgt) {
  const odds = attackOdds(view, att.id, tgt.id, {});
  if (!odds) return 0;
  let ev = odds.expHits * 1.2 + odds.expPushes * 0.35 + odds.pKill * KILL_VALUE[tgt.type];
  if (odds.battleBack) {
    const bbDice = diceFor(view, tgt, att, { melee: true });
    const bbHits = bbDice / 3;
    ev -= bbHits * 1.0;
    if (bbHits >= att.blocks) ev -= 1.5; // could die to the counter
  }
  if (odds.evade) ev *= 0.45; // parting shot at an evader is usually poor
  return ev;
}

// Can this unit likely reach a fight if ordered? (cheap potential estimate)
function reachPotential(view, unit, bonusMove = 0) {
  const move = UNIT_TYPES[unit.type].move + bonusMove;
  let best = 0;
  for (const e of aliveUnits(view, 1 - unit.side)) {
    const d = H.distance(unit, e);
    if (d <= move + 1) best = Math.max(best, 1.4 - d * 0.12);
    else best = Math.max(best, 0.6 - d * 0.05);
  }
  return Math.max(best, 0);
}

function unitOpportunity(view, unit, tile, valve) {
  const bonusMove = !valve && tile && tile.bonus === 'move' ? 1 : 0;
  let v = standingAttackEV(view, unit) + reachPotential(view, unit, bonusMove);
  if (!valve && tile && tile.bonus === 'melee') v += 0.35;
  if (!valve && tile && tile.bonus === 'ranged' && unit.type === 'skirmisher') v += 0.35;
  if (!valve && tile && tile.bonus === 'steadfast') {
    // steadfast is worth most when enemies are breathing on you
    v += Math.min(adjEnemyCount(view, unit) * 0.5, 1);
  }
  if (unit.type === 'general') v *= 0.35; // the general is not a spearhead
  return v;
}

function adjEnemyCount(view, unit) {
  return H.neighbors(unit.q, unit.r)
    .map(n => unitAt(view, n.q, n.r))
    .filter(u => u && u.side !== unit.side).length;
}

// ------------------------------------------------------------------- take

function pickTile(view, side, difficulty) {
  const n = noise(difficulty);
  let best = null;
  for (let i = 0; i < view.council.length; i++) {
    const slot = view.council[i];
    const tile = TILES[slot.tile];
    for (const valve of [false, true]) {
      const { units, max } = orderableUnits(view, slot.tile, valve);
      const opps = units
        .map(u => unitOpportunity(view, u, tile, valve))
        .sort((a, b) => b - a)
        .slice(0, max);
      let score = opps.reduce((s, v) => s + v, 0) + slot.coins * 0.8 + n();
      if (valve) score -= 0.4; // prefer the tile's real text when comparable
      if (!valve && tile.special === 'auspices') score += C.AUSPICES_FORTUNA * 0.7;
      if (!valve && tile.special === 'heal' && healTarget(view, side)) score += 2.2;
      if (!valve && difficulty === 'imperator') {
        // denial: what would the enemy do with this tile?
        const enemyView = { ...view, turn: 1 - side };
        const eo = orderableUnits(enemyView, slot.tile, false).units
          .map(u => unitOpportunity(enemyView, u, tile, false))
          .sort((a, b) => b - a)
          .slice(0, max);
        score += eo.reduce((s, v) => s + v, 0) * 0.25;
      }
      if (!best || score > best.score) best = { score, action: { t: 'take', index: i, valve } };
    }
  }
  return best.action;
}

function healTarget(view, side) {
  const gen = aliveUnits(view, side).find(u => u.type === 'general');
  if (!gen) return null;
  const hurt = aliveUnits(view, side).filter(u =>
    u.id !== gen.id && u.blocks < u.maxBlocks && H.distance(u, gen) === 1);
  hurt.sort((a, b) => (b.maxBlocks - b.blocks) - (a.maxBlocks - a.blocks));
  return hurt[0] || null;
}

// ------------------------------------------------------------------ order

function pickOrders(view, side, difficulty) {
  const ctx = view.turnCtx;
  const tile = TILES[ctx.tileId];
  const { units, max } = orderableUnits(view, ctx.tileId, ctx.valve);
  const n = noise(difficulty);
  const scored = units
    .map(u => ({ u, v: unitOpportunity(view, u, tile, ctx.valve) + n() }))
    .sort((a, b) => b.v - a.v);
  const picked = scored.slice(0, max).filter(x => x.v > 0.15).map(x => x.u.id);
  const action = { t: 'order', unitIds: picked };
  if (!ctx.valve && tile.special === 'heal') {
    const target = healTarget(view, side);
    if (target) action.heal = target.id;
  }
  return action;
}

// ------------------------------------------------------------------- move

function scoreDest(view, unit, q, r, difficulty) {
  const ghost = { ...unit, q, r };
  const patched = patchUnitPos(view, unit.id, q, r);
  let v = standingAttackEV(patched, ghost) * 1.1;

  const terr = terrainAt(view, q, r);
  const nearest = nearestEnemy(view, unit.side, q, r);
  const dNear = nearest ? H.distance({ q, r }, nearest) : 9;

  if (unit.type === 'general') {
    // stay behind the line, near friends, out of reach
    v -= Math.max(0, 3 - dNear) * 2.2;
    const friends = aliveUnits(view, unit.side)
      .filter(u => u.id !== unit.id && u.type !== 'general');
    const dFriend = friends.length
      ? Math.min(...friends.map(u => H.distance({ q, r }, u))) : 0;
    v -= Math.abs(dFriend - 1) * 0.8;       // ideally adjacent to the line
    v -= Math.abs(dNear - 3) * 0.3;         // lurk ~3 hexes back
  } else {
    v -= dNear * 0.22;                      // press toward the enemy
    if (terr === 'hill' && unit.type === 'skirmisher') v += 0.7;
    if (terr === 'ford') v -= 0.5;          // don't stand in the water
    if (terr === 'hill') v += 0.25;
    // flanking setup: an enemy there already engaged by a friend
    for (const nb of H.neighbors(q, r)) {
      const e = unitAt(view, nb.q, nb.r);
      if (e && e.side !== unit.side) {
        const friends = H.neighbors(e.q, e.r)
          .map(x => unitAt(view, x.q, x.r))
          .filter(u => u && u.side === unit.side && u.id !== unit.id);
        if (friends.length >= 1) v += 0.5;
      }
    }
    // skirmishers keep their distance when they can shoot
    if (unit.type === 'skirmisher' && dNear === 1) v -= 0.6;
    // danger: how many enemies can pile onto this hex next turn
    const threat = aliveUnits(view, 1 - unit.side).filter(e =>
      H.distance({ q, r }, e) <= UNIT_TYPES[e.type].move + 1).length;
    v -= threat * (unit.blocks <= 1 ? 0.45 : 0.12);
  }
  // aura: stand next to the general when brawling
  const gen = aliveUnits(view, unit.side).find(u => u.type === 'general');
  if (gen && unit.type !== 'general' && H.distance({ q, r }, gen) === 1 && dNear <= 2) v += 0.4;
  return v;
}

function patchUnitPos(view, id, q, r) {
  return {
    ...view,
    units: view.units.map(u => (u.id === id ? { ...u, q, r } : u)),
  };
}

function nearestEnemy(view, side, q, r) {
  let best = null, bd = Infinity;
  for (const e of aliveUnits(view, 1 - side)) {
    const d = H.distance({ q, r }, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function pickMove(view, side, difficulty) {
  const ctx = view.turnCtx;
  const bonus = !ctx.valve && TILES[ctx.tileId].bonus === 'move' ? 1 : 0;
  const movers = aliveUnits(view, side).filter(u => u.ordered && !u.moved);
  const n = noise(difficulty);
  let best = null;
  for (const u of movers) {
    const stay = scoreDest(view, u, u.q, u.r, difficulty);
    const reach = reachable(view, u, UNIT_TYPES[u.type].move + bonus);
    for (const k of Object.keys(reach.dist)) {
      const { q, r } = H.unkey(k);
      const v = scoreDest(view, u, q, r, difficulty) - stay + n();
      if (v > 0.25 && (!best || v > best.v)) {
        best = { v, action: { t: 'move', unitId: u.id, to: { q, r } } };
      }
    }
  }
  return best ? best.action : { t: 'endPhase' };
}

// ----------------------------------------------------------------- battle

function pickBattle(view, side, difficulty) {
  const n = noise(difficulty);
  const fighters = aliveUnits(view, side).filter(u => u.ordered && !u.attacked);
  let best = null;
  for (const f of fighters) {
    for (const { unit: tgt } of attackTargets(view, f)) {
      const ev = attackEV(view, f, tgt) + n();
      if (!best || ev > best.ev) best = { ev, f, tgt };
    }
  }
  if (best && best.ev > 0.35) {
    const action = { t: 'attack', unitId: best.f.id, targetId: best.tgt.id };
    if (difficulty !== 'legate' && view.fortuna[side] >= C.WARCRY_COST + 2) {
      const plain = attackOdds(view, best.f.id, best.tgt.id, {});
      const loud = attackOdds(view, best.f.id, best.tgt.id, { warcry: true });
      if (plain && loud && (loud.pKill - plain.pKill) * KILL_VALUE[best.tgt.type] > 1.1) {
        action.warcry = true;
      }
    }
    return action;
  }
  const arm = maybeArm(view, side, difficulty);
  if (arm) return arm;
  return { t: 'endTurn' };
}

function maybeArm(view, side, difficulty) {
  if (difficulty === 'legate') return null;
  if (!view.turnCtx || view.turnCtx.armedThisTurn >= C.ARMS_PER_TURN) return null;
  if (view.scrolls[side].length >= C.MAX_SCROLLS) return null;
  const reserve = difficulty === 'imperator' ? 1 : 3;
  if (view.fortuna[side] < C.ARM_COST + reserve) return null;
  if (Math.random() < (difficulty === 'imperator' ? 0.75 : 0.4)) return null;

  const have = new Set(view.scrolls[side].map(s => s.effect));
  const mine = aliveUnits(view, side);
  const theirs = aliveUnits(view, 1 - side);
  const options = [];

  // caltrops on a ford (or a hex on the enemy's shortest approach)
  const fords = Object.entries(view.board.cells)
    .filter(([, t]) => t === 'ford')
    .map(([k]) => H.unkey(k))
    .filter(h => !unitAt(view, h.q, h.r));
  if (!have.has('caltrops') && fords.length) {
    const h = fords.sort((a, b) =>
      minDistTo(theirs, a) - minDistTo(theirs, b))[0];
    if (minDistTo(theirs, h) <= 4) options.push({ w: 3, a: { t: 'arm', effect: 'caltrops', secret: { q: h.q, r: h.r } } });
  }
  // ambush where my line meets theirs
  const hotSection = bestSection(view, side);
  if (!have.has('ambush') && hotSection !== -1) {
    options.push({ w: 2.5, a: { t: 'arm', effect: 'ambush', secret: { section: hotSection } } });
  }
  if (!have.has('holdTheLine') && hotSection !== -1) {
    options.push({ w: 2, a: { t: 'arm', effect: 'holdTheLine', secret: { section: hotSection } } });
  }
  if (!have.has('countercharge') && mine.some(u => u.type === 'cavalry' && !u.dead)) {
    options.push({ w: 1.8, a: { t: 'arm', effect: 'countercharge' } });
  }
  if (!have.has('rallyStandards')) {
    const clustered = mine.filter(u => H.neighbors(u.q, u.r)
      .map(x => unitAt(view, x.q, x.r))
      .some(o => o && o.side === side)).length;
    if (clustered >= 3) options.push({ w: 1.5, a: { t: 'arm', effect: 'rallyStandards' } });
  }
  if (!have.has('feignedRetreat') && hotSection !== -1) {
    options.push({ w: 1.2, a: { t: 'arm', effect: 'feignedRetreat', secret: { section: hotSection } } });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.w - a.w);
  return options[0].a;
}

function minDistTo(units, h) {
  return Math.min(...units.map(u => H.distance(u, h)), 99);
}

// section where my units face the most enemy pressure
function bestSection(view, side) {
  const pressure = [0, 0, 0];
  for (const u of aliveUnits(view, side)) {
    if (u.type === 'general') continue;
    const sec = sectionOf(view.board, u.q, u.r);
    if (sec === -1) continue;
    const near = aliveUnits(view, 1 - side).filter(e => H.distance(u, e) <= 3).length;
    pressure[sec] += near;
  }
  const max = Math.max(...pressure);
  return max > 0 ? pressure.indexOf(max) : -1;
}

// ----------------------------------------------------------------- combat

function pickCombat(view, side, difficulty) {
  const p = view.pending;
  if (!p || difficulty === 'legate' || p.rerolls >= C.REROLL_COSTS.length) return { t: 'resolve' };
  const cost = C.REROLL_COSTS[p.rerolls];
  if (view.fortuna[side] < cost) return { t: 'resolve' };
  const tgt = unitById(view, p.targetId);
  if (!tgt) return { t: 'resolve' };
  const hitMin = tgt.type === 'general' ? C.GENERAL_HIT_MIN : C.HIT_MIN;
  const hits = p.dice.filter(d => d >= hitMin).length;
  const rerollable = p.dice
    .map((d, i) => ({ d, i }))
    .filter(x => x.d < hitMin && x.d !== C.PUSH_FACE); // keep pushes; 1s already paid
  if (!rerollable.length) return { t: 'resolve' };
  const need = tgt.blocks - hits;
  const pHit = (7 - hitMin) / 6;
  const expNew = rerollable.length * pHit;
  const killValue = KILL_VALUE[tgt.type];
  const worthIt =
    (need > 0 && need <= rerollable.length && expNew >= need * 0.55 && killValue >= 3) ||
    (difficulty === 'imperator' && expNew * 1.2 > cost * 0.8 && view.fortuna[side] >= cost + 2);
  if (!worthIt) return { t: 'resolve' };
  return { t: 'reroll', indices: rerollable.map(x => x.i) };
}

// ---------------------------------------------------------------- pursuit

function pickPursuit(view, side, difficulty) {
  const p = view.pending;
  const u = unitById(view, p.unitId);
  if (!u) return { t: 'declinePursuit' };
  const before = scoreDest(view, u, u.q, u.r, difficulty);
  const after = scoreDest(view, u, p.hex.q, p.hex.r, difficulty);
  // the bonus battle is usually worth a small positional dip
  return after + 0.8 > before ? { t: 'pursue' } : { t: 'declinePursuit' };
}
