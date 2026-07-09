// Deterministic seeded RNG (mulberry32). All engine randomness flows through
// a { seed, n } cursor stored in game state, so any holder of the state
// (browser client, Durable Object) derives identical rolls.

export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Advance the cursor and return a float in [0, 1).
export function nextFloat(cursor) {
  const f = mulberry32((cursor.seed + cursor.n * 0x9E3779B9) >>> 0)();
  cursor.n++;
  return f;
}

// Integer in [1, sides].
export function rollDie(cursor, sides) {
  return 1 + Math.floor(nextFloat(cursor) * sides);
}

// Fisher-Yates shuffle (in place) driven by the cursor.
export function shuffle(cursor, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(cursor) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
