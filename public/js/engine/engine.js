// Ad Arma — core rules engine.
// A pure, deterministic reducer over a serializable game state. The same
// module runs in the browser (single-player) and in the GameRoom Durable
// Object (authoritative multiplayer). All randomness flows through the
// in-state RNG cursor; every mutation is appended to state.events so any
// client can replay/animate what happened.

import { C, UNIT_TYPES } from './constants.js';
import { TILES, STRATAGEMS, buildBag } from './council.js';
import { getScenario, makeBoard, makeUnits, sectionOf } from './scenarios.js';
import * as H from './hex.js';
import { hashSeed, rollDie, shuffle } from './rng.js';

// ---------------------------------------------------------------- creation

export function createGame({ scenarioId = 'openField', seed = 'ad-arma', names, deployMode = false } = {}) {
  const rng = { seed: hashSeed(String(seed)), n: 0 };
  const scenario = getScenario(scenarioId);
  const board = makeBoard(scenarioId, rng);
  const units = makeUnits(scenarioId).map(u => ({
    ...u,
    blocks: UNIT_TYPES[u.type].blocks,
    maxBlocks: UNIT_TYPES[u.type].blocks,
    dead: false,
    steadfast: false,
    ordered: false, moved: false, attacked: false, pursued: false,
  }));
  const bag = shuffle(rng, buildBag());
  const council = bag.splice(0, C.COUNCIL_SIZE).map(t => ({ tile: t, coins: 0 }));
  const state = {
    v: 1,
    scenarioId,
    scenarioName: scenario.name,
    laurelTarget: [...scenario.laurelTarget],
    nightfallTurn: scenario.nightfallTurn || C.NIGHTFALL_TURN,
    names: names || ['Rome', 'Carthage'],
    rng,
    board,
    units,
    bag,
    discard: [],
    council,
    scrolls: [[], []],
    sprung: [[], []],
    fortuna: [C.FORTUNA_START, C.FORTUNA_START + C.SECOND_PLAYER_FORTUNA],
    laurels: [0, 0],
    desperateGiven: [false, false],
    turn: 0,
    turnCount: 1,
    phase: 'take',
    turnCtx: null,
    pending: null,
    events: [],
    seq: 0,
    winner: null,
    winReason: null,
    deployMode: !!deployMode,
    deployed: [false, false],
    pendingDeploy: [null, null],
  };
  evt(state, { t: 'gameStart', scenarioId });
  if (deployMode) {
    state.phase = 'deploy';
    evt(state, { t: 'deployStart' });
  } else {
    evt(state, { t: 'turnStart', side: 0, turnCount: 1 });
  }
  return state;
}

// Deployment zones for Battle Plans mode — per-scenario row bands.
export function inDeployZone(state, side, r) {
  const z = state.board.deployZones[side];
  return r >= z.minRow && r <= z.maxRow;
}

// ------------------------------------------------------------------ events

function evt(state, e) {
  e.seq = state.seq++;
  state.events.push(e);
  return e;
}

// ----------------------------------------------------------------- helpers

export function aliveUnits(state, side = null) {
  return state.units.filter(u => !u.dead && (side === null || u.side === side));
}

export function unitById(state, id) {
  return state.units.find(u => u.id === id);
}

export function unitAt(state, q, r) {
  return state.units.find(u => !u.dead && u.q === q && u.r === r) || null;
}

export function terrainAt(state, q, r) {
  return state.board.cells[H.key(q, r)] || null; // null = off board
}

function passable(state, q, r) {
  const t = terrainAt(state, q, r);
  return t !== null && t !== 'river';
}

function adjacentEnemies(state, unit) {
  return H.neighbors(unit.q, unit.r)
    .map(n => unitAt(state, n.q, n.r))
    .filter(u => u && u.side !== unit.side);
}

function adjacentFriends(state, unit) {
  return H.neighbors(unit.q, unit.r)
    .map(n => unitAt(state, n.q, n.r))
    .filter(u => u && u.side === unit.side && u.id !== unit.id);
}

function flanked(state, unit, bySide) {
  return adjacentEnemies(state, unit).filter(u => u.side === bySide).length >= 2;
}

function nearestEnemyDist(state, side, q, r) {
  let best = Infinity;
  for (const u of aliveUnits(state, 1 - side)) {
    best = Math.min(best, H.distance({ q, r }, u));
  }
  return best;
}

function gainFortuna(state, side, amount, reason) {
  if (amount <= 0) return;
  const before = state.fortuna[side];
  state.fortuna[side] = Math.min(C.FORTUNA_CAP, before + amount);
  const delta = state.fortuna[side] - before;
  if (delta > 0) evt(state, { t: 'fortuna', side, delta, reason, total: state.fortuna[side] });
}

function spendFortuna(state, side, amount, reason) {
  state.fortuna[side] -= amount;
  evt(state, { t: 'fortuna', side, delta: -amount, reason, total: state.fortuna[side] });
}

// --------------------------------------------------------------- movement

// BFS over the board honoring: occupied hexes block, rivers block (fords ok),
// forest can be entered but ends movement. Returns { dist, parent } keyed by hex key.
export function reachable(state, unit, allowance) {
  const start = H.key(unit.q, unit.r);
  const dist = { [start]: 0 };
  const parent = {};
  const queue = [{ q: unit.q, r: unit.r }];
  while (queue.length) {
    const cur = queue.shift();
    const ck = H.key(cur.q, cur.r);
    const d = dist[ck];
    if (d >= allowance) continue;
    if (terrainAt(state, cur.q, cur.r) === 'forest' && ck !== start) continue; // forest stops movement
    for (const n of H.neighbors(cur.q, cur.r)) {
      const nk = H.key(n.q, n.r);
      if (nk in dist) continue;
      if (!passable(state, n.q, n.r)) continue;
      if (unitAt(state, n.q, n.r)) continue; // no moving through units
      dist[nk] = d + 1;
      parent[nk] = ck;
      queue.push(n);
    }
  }
  delete dist[start];
  return { dist, parent, start };
}

function pathTo(reach, destKey) {
  const path = [];
  let k = destKey;
  while (k && k !== reach.start) {
    path.unshift(H.unkey(k));
    k = reach.parent[k];
  }
  return path;
}

// Move a unit along `path` one hex at a time, springing enemy caltrops.
// Returns final position; the unit may die en route.
function walkPath(state, unit, path) {
  const walked = [];
  for (const step of path) {
    unit.q = step.q; unit.r = step.r;
    walked.push({ q: step.q, r: step.r });
    if (springCaltrops(state, unit)) break;
  }
  return walked;
}

// Returns true if caltrops fired (movement stops).
function springCaltrops(state, unit) {
  const enemy = 1 - unit.side;
  const idx = state.scrolls[enemy].findIndex(s =>
    s.effect === 'caltrops' && s.secret && s.secret.q === unit.q && s.secret.r === unit.r);
  if (idx === -1) return false;
  const scroll = state.scrolls[enemy].splice(idx, 1)[0];
  state.sprung[enemy].push(scroll);
  evt(state, { t: 'sprung', side: enemy, effect: 'caltrops', secret: scroll.secret, victimId: unit.id });
  damageUnit(state, unit, C.CALTROPS_DAMAGE, enemy, 'caltrops');
  return true;
}

// One deterministic retreat step toward the unit's own edge.
// Returns {q, r} or null if blocked.
function retreatStep(state, unit) {
  const dr = unit.side === 0 ? 1 : -1;
  const candidates = unit.side === 0
    ? [{ q: 0, r: 1 }, { q: -1, r: 1 }]
    : [{ q: 0, r: -1 }, { q: 1, r: -1 }];
  const options = [];
  for (const d of candidates) {
    const q = unit.q + d.q, r = unit.r + d.r;
    if (!passable(state, q, r)) continue;
    if (unitAt(state, q, r)) continue;
    options.push({ q, r });
  }
  if (!options.length) return null;
  options.sort((a, b) => {
    const ea = nearestEnemyDist(state, unit.side, a.q, a.r);
    const eb = nearestEnemyDist(state, unit.side, b.q, b.r);
    if (ea !== eb) return eb - ea;           // farther from enemies first
    return a.q - b.q;                        // deterministic tiebreak
  });
  return options[0];
}

// Retreat `steps` hexes (evade / feigned retreat / pushes). Fires caltrops.
// Returns number of steps actually taken; unit may die en route.
function retreatMove(state, unit, steps, reason) {
  const path = [];
  for (let i = 0; i < steps; i++) {
    if (unit.dead) break;
    const next = retreatStep(state, unit);
    if (!next) break;
    unit.q = next.q; unit.r = next.r;
    path.push(next);
    const hitCaltrops = springCaltrops(state, unit);
    if (hitCaltrops) break;
    if (terrainAt(state, unit.q, unit.r) === 'forest') break; // forest stops flight
  }
  if (path.length) evt(state, { t: 'retreat', unitId: unit.id, path, reason });
  return path.length;
}

// ----------------------------------------------------------------- combat

function tileBonusFor(state, att, melee) {
  const ctx = state.turnCtx;
  if (!ctx || ctx.valve || !att.ordered) return 0;
  const tile = TILES[ctx.tileId];
  if (!tile || !tile.bonus) return 0;
  if (tile.bonus === 'melee' && melee) return 1;
  if (tile.bonus === 'ranged' && !melee) return 1;
  return 0;
}

export function diceFor(state, att, tgt, { melee, extra = 0 }) {
  let n = att.blocks + extra;
  n += tileBonusFor(state, att, melee);
  if (melee && flanked(state, tgt, att.side)) n += C.FLANK_BONUS;
  if (adjacentFriends(state, att).some(u => u.type === 'general')) n += C.AURA_BONUS;
  const tAtt = terrainAt(state, att.q, att.r);
  const tTgt = terrainAt(state, tgt.q, tgt.r);
  if (!melee && tAtt === 'hill' && tTgt !== 'hill') n += C.HILL_RANGED_BONUS;
  if (melee && tTgt === 'hill' && tAtt !== 'hill') n -= C.UPHILL_PENALTY;
  if (tAtt === 'forest' || tTgt === 'forest') n = Math.min(n, C.FOREST_MAX_DICE);
  if (tAtt === 'ford') n = Math.min(n, C.FORD_MAX_DICE);
  return Math.max(n, C.MIN_DICE);
}

function rollDice(state, count) {
  const dice = [];
  for (let i = 0; i < count; i++) dice.push(rollDie(state.rng, 6));
  return dice;
}

function countDice(dice, targetType) {
  const hitMin = targetType === 'general' ? C.GENERAL_HIT_MIN : C.HIT_MIN;
  let hits = 0, pushes = 0, omens = 0;
  for (const d of dice) {
    if (d >= hitMin) hits++;
    else if (d === C.PUSH_FACE) pushes++;
    else if (d === C.OMEN_FACE) omens++;
  }
  return { hits, pushes, omens };
}

function damageUnit(state, unit, amount, bySide, reason) {
  unit.blocks -= amount;
  evt(state, { t: 'damage', unitId: unit.id, amount, reason, blocks: Math.max(0, unit.blocks) });
  if (unit.blocks <= 0) destroyUnit(state, unit, bySide);
}

function destroyUnit(state, unit, killerSide) {
  unit.blocks = 0;
  unit.dead = true;
  const laurels = unit.type === 'general' ? C.GENERAL_LAURELS : 1;
  state.laurels[killerSide] += laurels;
  evt(state, {
    t: 'destroyed', unitId: unit.id, bySide: killerSide,
    laurels, totals: [...state.laurels], at: { q: unit.q, r: unit.r },
  });
  gainFortuna(state, unit.side, C.DEATH_FORTUNA, 'pity');
  const loser = 1 - killerSide;
  const target = state.laurelTarget[killerSide];
  if (state.laurels[killerSide] >= target - C.DESPERATE_BEFORE_WIN && !state.desperateGiven[loser]) {
    state.desperateGiven[loser] = true;
    gainFortuna(state, loser, C.DESPERATE_FORTUNA, 'desperate');
    evt(state, { t: 'desperate', side: loser });
  }
  if (state.laurels[killerSide] >= target) {
    endGame(state, killerSide, 'laurels');
    return;
  }
  springRally(state, unit, killerSide);
}

function endGame(state, winner, reason) {
  state.winner = winner;
  state.winReason = reason;
  state.phase = 'over';
  state.pending = null;
  evt(state, {
    t: 'win', side: winner, reason,
    unsprung: state.scrolls.map(list => list.map(s => ({ effect: s.effect, secret: s.secret }))),
  });
}

// Rally the Standards: when one of `unit.side`'s units dies, up to 2 adjacent
// comrades immediately strike (the killer first if possible).
function springRally(state, fallen, killerSide) {
  const side = fallen.side;
  const idx = state.scrolls[side].findIndex(s => s.effect === 'rallyStandards');
  if (idx === -1) return;
  const strikers = H.neighbors(fallen.q, fallen.r)
    .map(n => unitAt(state, n.q, n.r))
    .filter(u => u && u.side === side && u.type !== 'general')
    .filter(u => adjacentEnemies(state, u).length > 0);
  if (!strikers.length) return;
  const scroll = state.scrolls[side].splice(idx, 1)[0];
  state.sprung[side].push(scroll);
  evt(state, { t: 'sprung', side, effect: 'rallyStandards', at: { q: fallen.q, r: fallen.r } });
  strikers.sort((a, b) => b.blocks - a.blocks || (a.id < b.id ? -1 : 1));
  for (const striker of strikers.slice(0, C.RALLY_UNITS)) {
    if (state.winner !== null || striker.dead) continue;
    const enemies = adjacentEnemies(state, striker);
    if (!enemies.length) continue;
    const killer = enemies.find(e => !e.dead && unitAt(state, e.q, e.r) === e && e.side === killerSide && isKiller(state, e));
    const target = killer || enemies.slice().sort((a, b) => a.blocks - b.blocks || (a.id < b.id ? -1 : 1))[0];
    autoAttack(state, striker, target, { extra: 0, reason: 'rally' });
  }
}

// crude marker: the most recent 'destroyed' event names the killer side, not unit;
// prefer any adjacent enemy that attacked this turn.
function isKiller(state, enemy) {
  return enemy.attacked === true;
}

// An immediate engine-driven strike (ambush / countercharge / rally).
// No battle-back, no evade, no feigned retreat, no rerolls, no pursuit.
function autoAttack(state, att, tgt, { extra = 0, reason }) {
  if (att.dead || tgt.dead || state.winner !== null) return;
  const dice = rollDice(state, diceFor(state, att, tgt, { melee: true, extra }));
  evt(state, {
    t: 'attack', attackerId: att.id, targetId: tgt.id,
    melee: true, dice, auto: true, reason,
  });
  applyDice(state, att, tgt, dice, { melee: true, evade: false, canBattleBack: false });
}

// Shared dice application: hits, omens, hold-the-line, steadfast, pushes,
// evade movement, battle-back. Returns info for pursuit decisions.
function applyDice(state, att, tgt, dice, { melee, evade, canBattleBack }) {
  const origHex = { q: tgt.q, r: tgt.r };
  let { hits, pushes, omens } = countDice(dice, tgt.type);
  if (evade) pushes = 0;
  if (omens) gainFortuna(state, att.side, omens * C.OMEN_FORTUNA, 'omen');

  let held = false;
  if (pushes > 0 && melee) held = springHoldTheLine(state, tgt);
  const steadfast = tgt.steadfast && pushes > 0;
  if (held || tgt.steadfast) pushes = 0;

  evt(state, {
    t: 'combat', attackerId: att.id, targetId: tgt.id,
    hits, pushes, omens, held, steadfast, evade,
  });

  if (hits > 0) damageUnit(state, tgt, hits, att.side, 'hits');
  if (state.winner !== null) return { targetDied: tgt.dead, origHex, retreated: false };

  let retreated = false;
  if (!tgt.dead && evade) {
    retreated = retreatMove(state, tgt, C.EVADE_DIST, 'evade') > 0;
  } else if (!tgt.dead && pushes > 0) {
    const taken = retreatMove(state, tgt, pushes, 'push');
    retreated = taken > 0;
    const blocked = pushes - taken;
    if (blocked > 0 && !tgt.dead) {
      evt(state, { t: 'pushBlocked', unitId: tgt.id, blocked });
      damageUnit(state, tgt, blocked, att.side, 'blocked-push');
    }
  }
  if (state.winner !== null) return { targetDied: tgt.dead, origHex, retreated };

  // Battle back: melee defender that survived in its hex strikes back.
  if (canBattleBack && melee && !tgt.dead && !retreated && !att.dead && tgt.type !== 'general') {
    const bonus = held ? C.HOLD_BONUS : 0;
    const bbDice = rollDice(state, diceFor(state, tgt, att, { melee: true, extra: bonus }));
    evt(state, {
      t: 'attack', attackerId: tgt.id, targetId: att.id,
      melee: true, dice: bbDice, battleBack: true,
    });
    applyDice(state, tgt, att, bbDice, { melee: true, evade: false, canBattleBack: false });
  }

  return { targetDied: tgt.dead, origHex, retreated };
}

function springHoldTheLine(state, tgt) {
  const side = tgt.side;
  const idx = state.scrolls[side].findIndex(s =>
    s.effect === 'holdTheLine' && s.secret && s.secret.section === sectionOf(state.board, tgt.q, tgt.r));
  if (idx === -1) return false;
  const scroll = state.scrolls[side].splice(idx, 1)[0];
  state.sprung[side].push(scroll);
  evt(state, { t: 'sprung', side, effect: 'holdTheLine', secret: scroll.secret, unitId: tgt.id });
  return true;
}

// After a unit finishes a voluntary move: enemy ambush / countercharge.
function springMoveTraps(state, mover) {
  if (mover.dead) return;
  const enemy = 1 - mover.side;
  // scan in armed order; each fires at most once; stop if mover dies
  for (let i = 0; i < state.scrolls[enemy].length && !mover.dead; ) {
    const s = state.scrolls[enemy][i];
    let striker = null;
    if (s.effect === 'ambush') {
      striker = H.neighbors(mover.q, mover.r)
        .map(n => unitAt(state, n.q, n.r))
        .filter(u => u && u.side === enemy && u.type !== 'general'
          && sectionOf(state.board, u.q, u.r) === s.secret.section)
        .sort((a, b) => b.blocks - a.blocks || (a.id < b.id ? -1 : 1))[0] || null;
    } else if (s.effect === 'countercharge') {
      striker = H.neighbors(mover.q, mover.r)
        .map(n => unitAt(state, n.q, n.r))
        .filter(u => u && u.side === enemy && u.type === 'cavalry')
        .sort((a, b) => b.blocks - a.blocks || (a.id < b.id ? -1 : 1))[0] || null;
    }
    if (!striker) { i++; continue; }
    state.scrolls[enemy].splice(i, 1);
    state.sprung[enemy].push(s);
    evt(state, { t: 'sprung', side: enemy, effect: s.effect, secret: s.secret, strikerId: striker.id, victimId: mover.id });
    const extra = s.effect === 'ambush' ? C.AMBUSH_BONUS : C.COUNTER_BONUS;
    autoAttack(state, striker, mover, { extra, reason: s.effect });
  }
}

// ------------------------------------------------------- order validation

export function orderableUnits(state, tileId, valve) {
  const mine = aliveUnits(state, state.turn);
  if (valve) return { units: mine, max: 1 };
  const tile = TILES[tileId];
  if (!tile) return { units: [], max: 0 };
  if (tile.order.mode === 'type') {
    const units = mine.filter(u => u.type === tile.order.unitType);
    return { units, max: tile.order.max || units.length };
  }
  return { units: mine, max: tile.order.max };
}

export function attackTargets(state, unit) {
  if (unit.dead || unit.type === 'general') return [];
  const targets = [];
  for (const enemy of aliveUnits(state, 1 - unit.side)) {
    const d = H.distance(unit, enemy);
    if (d === 1) targets.push({ unit: enemy, melee: true });
    else if (d === 2 && UNIT_TYPES[unit.type].range >= 2 && hasLos(state, unit, enemy)) {
      targets.push({ unit: enemy, melee: false });
    }
  }
  return targets;
}

function hasLos(state, a, b) {
  // range-2 shot: needs at least one non-forest hex among the common neighbors
  const an = H.neighbors(a.q, a.r).map(n => H.key(n.q, n.r));
  const bn = new Set(H.neighbors(b.q, b.r).map(n => H.key(n.q, n.r)));
  return an.some(k => {
    if (!bn.has(k)) return false;
    const t = state.board.cells[k];
    return t && t !== 'forest';
  });
}

// Live odds for the UI tooltip: expected hits/pushes and P(kill by hits).
export function attackOdds(state, attackerId, targetId, { warcry = false } = {}) {
  const att = unitById(state, attackerId);
  const tgt = unitById(state, targetId);
  if (!att || !tgt || att.dead || tgt.dead) return null;
  const melee = H.distance(att, tgt) === 1;
  const evade = melee && wouldEvade(state, att, tgt);
  const n = evade ? C.EVADE_DICE
    : diceFor(state, att, tgt, { melee, extra: warcry ? C.WARCRY_DICE : 0 });
  const pHit = (7 - (tgt.type === 'general' ? C.GENERAL_HIT_MIN : C.HIT_MIN)) / 6;
  const pPush = evade ? 0 : 1 / 6;
  // P(hits >= tgt.blocks) — binomial tail
  let pKill = 0;
  for (let k = tgt.blocks; k <= n; k++) {
    pKill += binom(n, k) * Math.pow(pHit, k) * Math.pow(1 - pHit, n - k);
  }
  return {
    dice: n, melee, evade,
    expHits: n * pHit, expPushes: n * pPush, pKill,
    battleBack: melee && !evade && tgt.type !== 'general' ? tgt.blocks : 0,
  };
}

function binom(n, k) {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

function wouldEvade(state, att, tgt) {
  if (tgt.type !== 'skirmisher' && tgt.type !== 'general') return false;
  if (flanked(state, tgt, att.side)) return false;
  return retreatStep(state, tgt) !== null;
}

// ------------------------------------------------------------- the reducer

export function applyAction(state, side, action) {
  if (!action || typeof action.t !== 'string') return err('bad action');
  const s = structuredClone(state);
  const before = s.seq;
  const fail = run(s, side, action);
  if (fail) return err(fail);
  return { ok: true, state: s, events: s.events.slice(findEventIndex(s, before)) };
}

function findEventIndex(state, seq) {
  for (let i = state.events.length - 1; i >= 0; i--) {
    if (state.events[i].seq < seq) return i + 1;
  }
  return 0;
}

function err(error) {
  return { ok: false, error };
}

// returns an error string, or null on success (state mutated in place)
function run(s, side, a) {
  if (s.winner !== null && a.t !== 'chat') return 'game over';
  // Battle Plans deployment is the one action both sides may take at once.
  if (a.t === 'deploy') return doDeploy(s, side, a);
  if (side !== s.turn) return 'not your turn';

  switch (a.t) {
    case 'take': return doTake(s, side, a);
    case 'order': return doOrder(s, side, a);
    case 'move': return doMove(s, side, a);
    case 'endPhase': return doEndPhase(s, side, a);
    case 'attack': return doAttack(s, side, a);
    case 'reroll': return doReroll(s, side, a);
    case 'resolve': return doResolve(s, side, a);
    case 'pursue': return doPursue(s, side, a, true);
    case 'declinePursuit': return doPursue(s, side, a, false);
    case 'arm': return doArm(s, side, a);
    case 'endTurn': return doEndTurn(s, side, a);
    case 'resign': endGame(s, 1 - side, 'resign'); return null;
    default: return 'unknown action';
  }
}

function doDeploy(s, side, a) {
  if (s.phase !== 'deploy') return 'wrong phase';
  if (side !== 0 && side !== 1) return 'bad side';
  if (s.deployed[side]) return 'battle plan already committed';
  const mine = aliveUnits(s, side);
  let placements;
  if (a.default) {
    placements = mine.map(u => ({ id: u.id, q: u.q, r: u.r }));
  } else {
    if (!Array.isArray(a.placements)) return 'bad placements';
    placements = a.placements.map(p => ({ id: p.id, q: p.q | 0, r: p.r | 0 }));
  }
  if (placements.length !== mine.length) return 'place every unit exactly once';
  const ids = new Set(), hexes = new Set();
  for (const p of placements) {
    const u = unitById(s, p.id);
    if (!u || u.dead || u.side !== side) return 'bad unit in placements';
    if (ids.has(p.id)) return 'unit placed twice';
    ids.add(p.id);
    const k = H.key(p.q, p.r);
    if (hexes.has(k)) return 'hex used twice';
    hexes.add(k);
    if (!passable(s, p.q, p.r)) return 'impassable hex';
    if (!inDeployZone(s, side, p.r)) return 'outside your deployment zone';
  }
  s.pendingDeploy[side] = placements;
  s.deployed[side] = true;
  evt(s, { t: 'deployCommitted', side, priv: { placements } });
  if (s.deployed[0] && s.deployed[1]) {
    for (const sd of [0, 1]) {
      for (const p of s.pendingDeploy[sd]) {
        const u = unitById(s, p.id);
        u.q = p.q; u.r = p.r;
      }
    }
    s.pendingDeploy = [null, null];
    evt(s, { t: 'deployReveal' });
    s.phase = 'take';
    s.turn = 0;
    evt(s, { t: 'turnStart', side: 0, turnCount: s.turnCount });
  }
  return null;
}

function doTake(s, side, a) {
  if (s.phase !== 'take') return 'wrong phase';
  const i = a.index | 0;
  if (i < 0 || i >= s.council.length) return 'bad tile';
  const slot = s.council.splice(i, 1)[0];
  s.discard.push(slot.tile);
  if (slot.coins > 0) gainFortuna(s, side, slot.coins, 'coins');
  const valve = !!a.valve;
  s.turnCtx = { tileId: slot.tile, valve, healUsed: false, armedThisTurn: 0 };
  evt(s, { t: 'take', side, tile: slot.tile, coins: slot.coins, valve });
  if (!valve && TILES[slot.tile].special === 'auspices') {
    gainFortuna(s, side, C.AUSPICES_FORTUNA, 'auspices');
  }
  s.phase = 'order';
  return null;
}

function doOrder(s, side, a) {
  if (s.phase !== 'order') return 'wrong phase';
  const ids = Array.isArray(a.unitIds) ? [...new Set(a.unitIds)] : [];
  const { units, max } = orderableUnits(s, s.turnCtx.tileId, s.turnCtx.valve);
  if (ids.length > max) return 'too many units';
  const pool = new Set(units.map(u => u.id));
  const chosen = [];
  for (const id of ids) {
    if (!pool.has(id)) return 'unit not orderable';
    chosen.push(unitById(s, id));
  }
  // Rally heal (optional, not on valve plays)
  if (a.heal && !s.turnCtx.valve && TILES[s.turnCtx.tileId].special === 'heal') {
    const target = unitById(s, a.heal);
    const general = aliveUnits(s, side).find(u => u.type === 'general');
    if (!target || target.dead || target.side !== side) return 'bad heal target';
    if (!general || H.distance(target, general) !== 1) return 'heal target not beside General';
    if (target.blocks >= target.maxBlocks) return 'heal target at full strength';
    target.blocks = Math.min(target.maxBlocks, target.blocks + C.HEAL_AMOUNT);
    evt(s, { t: 'heal', side, unitId: target.id, blocks: target.blocks });
  }
  for (const u of chosen) u.ordered = true;
  if (!s.turnCtx.valve && TILES[s.turnCtx.tileId].bonus === 'steadfast') {
    for (const u of chosen) u.steadfast = true;
    if (chosen.length) evt(s, { t: 'steadfast', side, unitIds: chosen.map(u => u.id) });
  }
  evt(s, { t: 'order', side, unitIds: chosen.map(u => u.id) });
  s.phase = 'move';
  return null;
}

function doMove(s, side, a) {
  if (s.phase !== 'move') return 'wrong phase';
  const u = unitById(s, a.unitId);
  if (!u || u.dead || u.side !== side) return 'bad unit';
  if (!u.ordered || u.moved) return 'unit cannot move';
  const bonus = (!s.turnCtx.valve && TILES[s.turnCtx.tileId].bonus === 'move') ? 1 : 0;
  const allowance = UNIT_TYPES[u.type].move + bonus;
  const reach = reachable(s, u, allowance);
  const destKey = H.key(a.to && a.to.q, a.to && a.to.r);
  if (!(destKey in reach.dist)) return 'unreachable';
  u.moved = true;
  const path = pathTo(reach, destKey);
  const from = { q: u.q, r: u.r };
  const walked = walkPath(s, u, path);
  evt(s, { t: 'move', side, unitId: u.id, from, path: walked });
  if (s.winner !== null) return null;
  springMoveTraps(s, u);
  return null;
}

function doEndPhase(s, side, a) {
  if (s.phase !== 'move') return 'wrong phase';
  s.phase = 'battle';
  evt(s, { t: 'phase', phase: 'battle' });
  return null;
}

function doAttack(s, side, a) {
  if (s.phase !== 'battle') return 'wrong phase';
  const att = unitById(s, a.unitId);
  const tgt = unitById(s, a.targetId);
  if (!att || att.dead || att.side !== side) return 'bad attacker';
  if (!att.ordered || att.attacked) return 'unit cannot attack';
  if (att.type === 'general') return 'generals do not attack';
  if (!tgt || tgt.dead || tgt.side === side) return 'bad target';
  const d = H.distance(att, tgt);
  const melee = d === 1;
  if (!melee) {
    if (d !== 2 || UNIT_TYPES[att.type].range < 2) return 'out of range';
    if (!hasLos(s, att, tgt)) return 'no line of sight';
  }
  let warcry = false;
  if (a.warcry) {
    if (s.fortuna[side] < C.WARCRY_COST) return 'not enough Fortuna for War Cry';
    warcry = true;
  }
  att.attacked = true;

  // Feigned Retreat: the strike is wasted before dice are rolled.
  if (melee) {
    const idx = s.scrolls[tgt.side].findIndex(x =>
      x.effect === 'feignedRetreat' && x.secret && x.secret.section === sectionOf(s.board, tgt.q, tgt.r));
    if (idx !== -1) {
      const scroll = s.scrolls[tgt.side].splice(idx, 1)[0];
      s.sprung[tgt.side].push(scroll);
      evt(s, { t: 'sprung', side: tgt.side, effect: 'feignedRetreat', secret: scroll.secret, unitId: tgt.id, attackerId: att.id });
      retreatMove(s, tgt, C.FEIGNED_DIST, 'feigned');
      return null;
    }
  }

  if (warcry) spendFortuna(s, side, C.WARCRY_COST, 'warcry');
  const evade = melee && wouldEvade(s, att, tgt);
  const n = evade ? C.EVADE_DICE
    : diceFor(s, att, tgt, { melee, extra: warcry ? C.WARCRY_DICE : 0 });
  const dice = rollDice(s, n);
  s.pending = {
    kind: 'attack', attackerId: att.id, targetId: tgt.id,
    melee, evade, warcry, dice, rerolls: 0,
  };
  s.phase = 'combat';
  evt(s, { t: 'attack', attackerId: att.id, targetId: tgt.id, melee, evade, warcry, dice });
  return null;
}

function doReroll(s, side, a) {
  if (s.phase !== 'combat' || !s.pending) return 'wrong phase';
  const p = s.pending;
  if (p.rerolls >= C.REROLL_COSTS.length) return 'no rerolls left';
  const cost = C.REROLL_COSTS[p.rerolls];
  if (s.fortuna[side] < cost) return 'not enough Fortuna';
  const idxs = Array.isArray(a.indices) ? [...new Set(a.indices.map(i => i | 0))] : [];
  if (!idxs.length || idxs.some(i => i < 0 || i >= p.dice.length)) return 'bad dice selection';
  spendFortuna(s, side, cost, 'reroll');
  for (const i of idxs) p.dice[i] = rollDie(s.rng, 6);
  p.rerolls++;
  evt(s, { t: 'reroll', side, indices: idxs, dice: [...p.dice], rerolls: p.rerolls });
  return null;
}

function doResolve(s, side, a) {
  if (s.phase !== 'combat' || !s.pending) return 'wrong phase';
  const p = s.pending;
  const att = unitById(s, p.attackerId);
  const tgt = unitById(s, p.targetId);
  s.pending = null;
  s.phase = 'battle';
  const out = applyDice(s, att, tgt, p.dice, {
    melee: p.melee, evade: p.evade, canBattleBack: true,
  });
  if (s.winner !== null) return null;
  // Cavalry pursuit: the target hex was cleared by a melee attack.
  if (att.type === 'cavalry' && p.melee && !att.dead && !att.pursued
    && (out.targetDied || out.retreated)) {
    const h = out.origHex;
    const t = terrainAt(s, h.q, h.r);
    if (t && t !== 'river' && t !== 'forest' && !unitAt(s, h.q, h.r)) {
      s.pending = { kind: 'pursuit', unitId: att.id, hex: h };
      s.phase = 'pursuit';
      evt(s, { t: 'pursuitOffer', unitId: att.id, hex: h });
    }
  }
  return null;
}

function doPursue(s, side, a, accept) {
  if (s.phase !== 'pursuit' || !s.pending || s.pending.kind !== 'pursuit') return 'wrong phase';
  const p = s.pending;
  s.pending = null;
  s.phase = 'battle';
  if (!accept) { evt(s, { t: 'pursuitDeclined', unitId: p.unitId }); return null; }
  const u = unitById(s, p.unitId);
  if (!u || u.dead) return null;
  if (unitAt(s, p.hex.q, p.hex.r)) return 'hex occupied';
  u.pursued = true;
  u.attacked = false; // the bonus battle
  const from = { q: u.q, r: u.r };
  u.q = p.hex.q; u.r = p.hex.r;
  evt(s, { t: 'pursue', unitId: u.id, from, to: p.hex });
  springCaltrops(s, u);
  if (!u.dead) springMoveTraps(s, u);
  return null;
}

function doArm(s, side, a) {
  if (!['order', 'move', 'battle'].includes(s.phase)) return 'wrong phase';
  if (!s.turnCtx || s.turnCtx.armedThisTurn >= C.ARMS_PER_TURN) return 'already armed this turn';
  if (s.scrolls[side].length >= C.MAX_SCROLLS) return 'scroll rack full';
  if (s.fortuna[side] < C.ARM_COST) return 'not enough Fortuna';
  const def = STRATAGEMS[a.effect];
  if (!def) return 'unknown stratagem';
  let secret = null;
  if (def.secret === 'section') {
    const sec = a.secret && a.secret.section;
    if (![0, 1, 2].includes(sec)) return 'pick a section';
    secret = { section: sec };
  } else if (def.secret === 'hex') {
    const q = a.secret && a.secret.q, r = a.secret && a.secret.r;
    const t = terrainAt(s, q, r);
    if (t === null || t === 'river') return 'pick a valid hex';
    secret = { q, r };
  }
  spendFortuna(s, side, C.ARM_COST, 'arm');
  s.turnCtx.armedThisTurn++;
  s.scrolls[side].push({ effect: a.effect, secret, turn: s.turnCount });
  evt(s, { t: 'armed', side, priv: { effect: a.effect, secret } });
  return null;
}

function doEndTurn(s, side, a) {
  if (!['order', 'move', 'battle'].includes(s.phase)) return 'wrong phase';
  // bribe the leftovers
  for (const slot of s.council) {
    slot.coins = Math.min(C.COIN_CAP, slot.coins + C.COIN_PER_TURN);
  }
  // refill the row
  const added = [];
  while (s.council.length < C.COUNCIL_SIZE) {
    if (!s.bag.length) {
      s.bag = shuffle(s.rng, s.discard.splice(0));
      if (!s.bag.length) break;
      evt(s, { t: 'bagShuffle' });
    }
    const tile = s.bag.pop();
    s.council.push({ tile, coins: 0 });
    added.push(tile);
  }
  for (const u of s.units) {
    u.ordered = false; u.moved = false; u.attacked = false; u.pursued = false;
  }
  evt(s, { t: 'turnEnd', side, added, council: s.council.map(c => ({ ...c })) });
  s.turn = 1 - side;
  s.turnCount++;
  if (s.turnCount > s.nightfallTurn) {
    const blocksOf = sd => aliveUnits(s, sd).reduce((sum, u) => sum + u.blocks, 0);
    // progress toward each side's own target — fair under asymmetric scenarios
    const prog = sd => s.laurels[sd] / s.laurelTarget[sd];
    let w;
    if (prog(0) !== prog(1)) w = prog(0) > prog(1) ? 0 : 1;
    else if (blocksOf(0) !== blocksOf(1)) w = blocksOf(0) > blocksOf(1) ? 0 : 1;
    else w = -1; // a bloody, pointless draw
    endGame(s, w, 'nightfall');
    return null;
  }
  // steadfast from the new player's previous turn has served its purpose
  for (const u of aliveUnits(s, s.turn)) u.steadfast = false;
  s.turnCtx = null;
  s.phase = 'take';
  evt(s, { t: 'turnStart', side: s.turn, turnCount: s.turnCount });
  return null;
}

// -------------------------------------------------------------------- views

// What `side` is allowed to see. Hides: RNG cursor, bag order, enemy scroll
// contents (until sprung or game over), and private event payloads.
export function viewFor(state, side) {
  const over = state.winner !== null;
  const deploying = state.phase === 'deploy';
  return {
    ...state,
    rng: undefined,
    bag: undefined,
    bagCount: state.bag.length,
    discard: undefined,
    // during blind deployment the enemy's muster is invisible, positions and all
    units: deploying ? state.units.filter(u => u.side === side) : state.units,
    pendingDeploy: state.pendingDeploy.map((p, i) => (i === side ? p : null)),
    scrolls: state.scrolls.map((list, i) =>
      (i === side || over)
        ? list
        : list.map(() => ({ hidden: true }))),
    events: state.events.map(e => {
      if (!e.priv) return e;
      if (e.side === side || over) return e;
      const { priv, ...pub } = e;
      return pub;
    }),
  };
}
