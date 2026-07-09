// AI-vs-AI simulations: the AI must finish games legally, in sane time,
// and a sharper AI should beat a sloppier one over a series.
import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction, viewFor } from '../public/js/engine/engine.js';
import { aiAction } from '../public/js/engine/ai.js';

export function playGame({ scenarioId = 'openField', seed, diffs = ['consul', 'consul'], deployMode = false, maxSteps = 3000 }) {
  let state = createGame({ scenarioId, seed, deployMode });
  let steps = 0;
  while (state.winner === null && steps < maxSteps) {
    const side = state.phase === 'deploy' ? (state.deployed[0] ? 1 : 0) : state.turn;
    const action = aiAction(viewFor(state, side), diffs[side]);
    const res = applyAction(state, side, action);
    if (!res.ok) {
      // an AI proposing an illegal action is a bug — fail loudly with context
      throw new Error(`AI(${diffs[side]}) illegal action ${JSON.stringify(action)} in phase ${state.phase}: ${res.error}`);
    }
    state = res.state;
    steps++;
  }
  if (state.winner === null) throw new Error(`game did not finish (${steps} steps, turn ${state.turnCount})`);
  return { winner: state.winner, turns: state.turnCount, laurels: state.laurels, reason: state.winReason };
}

test('AI vs AI games finish legally on all scenarios', () => {
  const scenarios = ['openField', 'riverCrossing', 'hillCountry', 'randomField'];
  const lengths = [];
  for (let g = 0; g < 12; g++) {
    const out = playGame({ scenarioId: scenarios[g % 4], seed: 'ai-' + g, deployMode: g % 3 === 0 });
    lengths.push(out.turns);
  }
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  console.log(`avg game length: ${avg.toFixed(1)} player-turns (${lengths.join(', ')})`);
  assert.ok(avg < 61, 'games should mostly end before nightfall');
});

test('imperator beats legate over a series', () => {
  let imperatorWins = 0, games = 10;
  for (let g = 0; g < games; g++) {
    const impSide = g % 2; // alternate sides for fairness
    const diffs = impSide === 0 ? ['imperator', 'legate'] : ['legate', 'imperator'];
    const out = playGame({ scenarioId: 'openField', seed: 'series-' + g, diffs });
    if (out.winner === impSide) imperatorWins++;
  }
  console.log(`imperator won ${imperatorWins}/${games}`);
  assert.ok(imperatorWins >= 6, `imperator should dominate legate (won ${imperatorWins}/${games})`);
});
