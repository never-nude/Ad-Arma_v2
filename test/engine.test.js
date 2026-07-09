// Engine smoke + invariant tests: drive full random games through the public
// action API and assert the rules hold at every step.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createGame, applyAction, aliveUnits, unitById, orderableUnits,
  attackTargets, reachable, viewFor, attackOdds, inDeployZone,
} from '../public/js/engine/engine.js';
import { C, UNIT_TYPES } from '../public/js/engine/constants.js';
import { TILES, STRATAGEMS } from '../public/js/engine/council.js';
import { distance } from '../public/js/engine/hex.js';

function rnd(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPlacements(state, side, rng) {
  const cells = Object.entries(state.board.cells)
    .filter(([k, t]) => t !== 'river')
    .map(([k]) => k.split(',').map(Number))
    .filter(([q, r]) => inDeployZone(side, r))
    .sort(() => rng() - 0.5);
  return aliveUnits(state, side).map((u, i) => ({ id: u.id, q: cells[i][0], r: cells[i][1] }));
}

// A chaotic but legal player: picks random legal actions.
function randomAction(state, rng) {
  const side = state.turn;
  switch (state.phase) {
    case 'take': {
      const index = Math.floor(rng() * state.council.length);
      return { t: 'take', index, valve: rng() < 0.15 };
    }
    case 'order': {
      const { units, max } = orderableUnits(state, state.turnCtx.tileId, state.turnCtx.valve);
      const shuffled = [...units].sort(() => rng() - 0.5);
      const n = Math.floor(rng() * (Math.min(max, shuffled.length) + 1));
      const action = { t: 'order', unitIds: shuffled.slice(0, n).map(u => u.id) };
      // sometimes try a heal
      if (!state.turnCtx.valve && TILES[state.turnCtx.tileId].special === 'heal' && rng() < 0.8) {
        const gen = aliveUnits(state, side).find(u => u.type === 'general');
        if (gen) {
          const hurt = aliveUnits(state, side).filter(u =>
            u.blocks < u.maxBlocks && distance(u, gen) === 1 && u.id !== gen.id);
          if (hurt.length) action.heal = rnd(hurt, rng).id;
        }
      }
      return action;
    }
    case 'move': {
      const movers = aliveUnits(state, side).filter(u => u.ordered && !u.moved);
      if (!movers.length || rng() < 0.25) return { t: 'endPhase' };
      const u = rnd(movers, rng);
      const bonus = (!state.turnCtx.valve && TILES[state.turnCtx.tileId].bonus === 'move') ? 1 : 0;
      const reach = reachable(state, u, UNIT_TYPES[u.type].move + bonus);
      const keys = Object.keys(reach.dist);
      if (!keys.length) return { t: 'endPhase' };
      const k = rnd(keys, rng);
      const [q, r] = k.split(',').map(Number);
      return { t: 'move', unitId: u.id, to: { q, r } };
    }
    case 'battle': {
      if (rng() < 0.1 && state.fortuna[side] >= C.ARM_COST
        && state.scrolls[side].length < C.MAX_SCROLLS
        && state.turnCtx.armedThisTurn < C.ARMS_PER_TURN) {
        const effects = Object.keys(STRATAGEMS);
        const effect = rnd(effects, rng);
        const def = STRATAGEMS[effect];
        let secret;
        if (def.secret === 'section') secret = { section: Math.floor(rng() * 3) };
        if (def.secret === 'hex') {
          const cells = Object.entries(state.board.cells).filter(([, t]) => t !== 'river');
          const [k] = rnd(cells, rng);
          const [q, r] = k.split(',').map(Number);
          secret = { q, r };
        }
        return { t: 'arm', effect, secret };
      }
      const fighters = aliveUnits(state, side).filter(u => u.ordered && !u.attacked);
      const options = [];
      for (const f of fighters) {
        for (const tgt of attackTargets(state, f)) {
          options.push({ t: 'attack', unitId: f.id, targetId: tgt.unit.id, warcry: rng() < 0.1 && state.fortuna[side] >= C.WARCRY_COST });
        }
      }
      if (!options.length || rng() < 0.3) return { t: 'endTurn' };
      return rnd(options, rng);
    }
    case 'combat': {
      if (rng() < 0.2 && state.pending.rerolls < C.REROLL_COSTS.length
        && state.fortuna[side] >= C.REROLL_COSTS[state.pending.rerolls]) {
        const n = state.pending.dice.length;
        const indices = [...Array(n).keys()].filter(() => rng() < 0.5);
        if (indices.length) return { t: 'reroll', indices };
      }
      return { t: 'resolve' };
    }
    case 'pursuit':
      return rng() < 0.6 ? { t: 'pursue' } : { t: 'declinePursuit' };
    default:
      throw new Error('unhandled phase ' + state.phase);
  }
}

function checkInvariants(state) {
  for (const u of state.units) {
    if (!u.dead) {
      assert.ok(u.blocks >= 1 && u.blocks <= u.maxBlocks, `unit ${u.id} blocks ${u.blocks}`);
      const t = state.board.cells[`${u.q},${u.r}`];
      assert.ok(t && t !== 'river', `unit ${u.id} standing on ${t}`);
      const others = state.units.filter(o => !o.dead && o !== u && o.q === u.q && o.r === u.r);
      assert.equal(others.length, 0, `stacked units at ${u.q},${u.r}`);
    }
  }
  for (const side of [0, 1]) {
    assert.ok(state.fortuna[side] >= 0 && state.fortuna[side] <= C.FORTUNA_CAP, 'fortuna range');
    assert.ok(state.scrolls[side].length <= C.MAX_SCROLLS, 'scroll cap');
  }
  if (state.winner === null) {
    assert.ok(state.laurels[0] < C.LAURELS_TO_WIN && state.laurels[1] < C.LAURELS_TO_WIN, 'game should have ended');
    assert.equal(state.council.length + '', state.phase === 'take' ? String(C.COUNCIL_SIZE) : state.council.length + '', 'council refilled at turn start');
  }
}

test('random playouts complete legally', () => {
  const scenarios = ['openField', 'riverCrossing', 'hillCountry', 'randomField'];
  let wins = [0, 0];
  for (let g = 0; g < 24; g++) {
    const rng = mulberry(1000 + g);
    const deployMode = g % 2 === 1; // half the games use Battle Plans
    let state = createGame({ scenarioId: scenarios[g % 4], seed: 'test-' + g, deployMode });
    let steps = 0;
    while (state.winner === null && steps < 4000) {
      let side = state.turn, action;
      if (state.phase === 'deploy') {
        side = state.deployed[0] ? 1 : 0;
        action = { t: 'deploy', placements: randomPlacements(state, side, rng) };
      } else {
        action = randomAction(state, rng);
      }
      const res = applyAction(state, side, action);
      assert.ok(res.ok, `step ${steps} action ${JSON.stringify(action)} failed: ${res.error}`);
      state = res.state;
      checkInvariants(state);
      steps++;
    }
    assert.ok(state.winner !== null, `game ${g} did not finish in 4000 steps (turn ${state.turnCount})`);
    if (state.winner >= 0) wins[state.winner]++;
  }
  // both sides should be able to win under random play
  assert.ok(wins[0] > 0 && wins[1] > 0, `win split ${wins}`);
});

test('battle plans: blind deployment stays blind and validated', () => {
  const rng = mulberry(77);
  let state = createGame({ seed: 'deploy', deployMode: true });
  assert.equal(state.phase, 'deploy');

  // both sides see only their own muster
  assert.ok(viewFor(state, 0).units.every(u => u.side === 0));
  assert.ok(viewFor(state, 1).units.every(u => u.side === 1));

  // turn-gated actions are rejected during deployment
  assert.equal(applyAction(state, 0, { t: 'take', index: 0 }).ok, false);
  assert.equal(applyAction(state, 1, { t: 'take', index: 0 }).ok, false);

  // illegal placements bounce
  const good = randomPlacements(state, 0, rng);
  const outsideZone = good.map((p, i) => (i === 0 ? { ...p, r: 3 } : p));
  assert.equal(applyAction(state, 0, { t: 'deploy', placements: outsideZone }).ok, false);
  const dupHex = good.map((p, i) => (i === 1 ? { ...p, q: good[0].q, r: good[0].r } : p));
  assert.equal(applyAction(state, 0, { t: 'deploy', placements: dupHex }).ok, false);
  assert.equal(applyAction(state, 0, { t: 'deploy', placements: good.slice(1) }).ok, false);

  // side 0 commits; still blind to side 1, and cannot re-commit
  let r0 = applyAction(state, 0, { t: 'deploy', placements: good });
  assert.ok(r0.ok, r0.error);
  state = r0.state;
  assert.equal(applyAction(state, 0, { t: 'deploy', placements: good }).ok, false);
  const v1 = viewFor(state, 1);
  assert.ok(v1.units.every(u => u.side === 1), 'side 1 must not see enemy positions');
  assert.equal(v1.pendingDeploy[0], null, 'enemy pending plan must be hidden');
  const commitEvt = v1.events.find(e => e.t === 'deployCommitted' && e.side === 0);
  assert.ok(commitEvt && commitEvt.priv === undefined, 'commit event must carry no placements');

  // side 1 uses the standard-formation fallback; battle begins revealed
  const r1 = applyAction(state, 1, { t: 'deploy', default: true });
  assert.ok(r1.ok, r1.error);
  state = r1.state;
  assert.equal(state.phase, 'take');
  assert.equal(state.turn, 0);
  for (const u of aliveUnits(state)) {
    assert.ok(inDeployZone(u.side, u.r), `unit ${u.id} outside its zone at reveal`);
  }
  assert.equal(viewFor(state, 0).units.length, state.units.length, 'reveal shows everything');
  assert.ok(viewFor(state, 0).events.some(e => e.t === 'deployReveal'));
});

test('illegal actions are rejected without corrupting state', () => {
  const state = createGame({ seed: 'illegal' });
  const cases = [
    [1, { t: 'take', index: 0 }],            // not your turn
    [0, { t: 'order', unitIds: ['R0'] }],    // wrong phase
    [0, { t: 'attack', unitId: 'R0', targetId: 'C0' }],
    [0, { t: 'take', index: 99 }],
    [0, { t: 'resolve' }],
    [0, { t: 'arm', effect: 'nonsense' }],
  ];
  for (const [side, action] of cases) {
    const res = applyAction(state, side, action);
    assert.equal(res.ok, false, `should reject ${JSON.stringify(action)}`);
  }
  const res = applyAction(state, 0, { t: 'take', index: 0 });
  assert.ok(res.ok);
});

test('views hide secrets', () => {
  let state = createGame({ seed: 'secrets' });
  // give side 0 a scroll by force-play: take, order none, arm via fortuna cheat
  state.fortuna[0] = 10;
  let r = applyAction(state, 0, { t: 'take', index: 0 });
  r = applyAction(r.state, 0, { t: 'order', unitIds: [] });
  r = applyAction(r.state, 0, { t: 'arm', effect: 'caltrops', secret: { q: 3, r: 4 } });
  assert.ok(r.ok, r.error);
  const v1 = viewFor(r.state, 1);
  assert.equal(v1.scrolls[0][0].hidden, true, 'enemy scroll must be hidden');
  assert.equal(v1.scrolls[0][0].effect, undefined);
  const armedEvt = v1.events.find(e => e.t === 'armed');
  assert.equal(armedEvt.priv, undefined, 'armed event payload must be private');
  const v0 = viewFor(r.state, 0);
  assert.equal(v0.scrolls[0][0].effect, 'caltrops');
  assert.equal(v0.rng, undefined, 'rng must never reach clients');
  assert.equal(v0.bag, undefined, 'bag order must never reach clients');
});

test('attack odds are sane', () => {
  let state = createGame({ seed: 'odds' });
  // walk an infantry unit adjacent to an enemy by hand
  const att = state.units.find(u => u.side === 0 && u.type === 'infantry');
  const tgt = state.units.find(u => u.side === 1 && u.type === 'infantry');
  att.q = tgt.q; att.r = tgt.r + 1; // adjacent (SE of target)
  const odds = attackOdds(state, att.id, tgt.id, {});
  assert.ok(odds.dice >= 1);
  assert.ok(odds.pKill >= 0 && odds.pKill <= 1);
  assert.ok(odds.expHits > 0);
});
