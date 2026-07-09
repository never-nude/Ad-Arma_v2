// The War Council — the shared drafting row of order tiles — and the six
// secret stratagems armed with Fortuna.
//
// tile.order modes:
//   'any'    — up to `max` units anywhere
//   'type'   — units of `unitType` (subset allowed), optionally capped by `max`
// tile.bonus: 'melee' | 'ranged' | 'move' | 'steadfast' | null
// tile.special: 'heal' | 'auspices' | null
// Relief valve: ANY tile may instead be taken as a plain order —
// order exactly 1 unit anywhere, no bonuses (action.valve = true).

export const TILES = {
  march: {
    name: 'March',
    count: 4,
    order: { mode: 'any', max: 3 },
    text: 'Order up to 3 units.',
    flavor: 'The column moves at dawn.',
  },
  assault: {
    name: 'Assault',
    count: 3,
    order: { mode: 'any', max: 2 },
    bonus: 'melee',
    text: 'Order up to 2 units. +1 die in melee.',
    flavor: 'Ladders, rams, and bad intentions.',
  },
  cavalryWings: {
    name: 'Cavalry Wings',
    count: 2,
    order: { mode: 'type', unitType: 'cavalry' },
    bonus: 'melee',
    text: 'Order all cavalry. +1 die in melee.',
    flavor: 'Thunder on the wings.',
  },
  volley: {
    name: 'Volley',
    count: 2,
    order: { mode: 'type', unitType: 'skirmisher' },
    bonus: 'ranged',
    text: 'Order all skirmishers. +1 die ranged.',
    flavor: 'A dark sleet of iron.',
  },
  shieldWall: {
    name: 'Shield Wall',
    count: 2,
    order: { mode: 'type', unitType: 'infantry', max: 3 },
    bonus: 'steadfast',
    text: 'Order up to 3 infantry. They ignore pushes until your next turn.',
    flavor: 'Lock shields. Not one step.',
  },
  forcedMarch: {
    name: 'Forced March',
    count: 2,
    order: { mode: 'any', max: 2 },
    bonus: 'move',
    text: 'Order up to 2 units. +1 movement.',
    flavor: 'Be where they least expect.',
  },
  rally: {
    name: 'Rally',
    count: 2,
    order: { mode: 'any', max: 1 },
    special: 'heal',
    text: 'Heal 1 block on a unit beside your General; then order 1 unit.',
    flavor: 'The old man rides the line, and the line remembers itself.',
  },
  auspices: {
    name: 'Auspices',
    count: 2,
    order: { mode: 'any', max: 1 },
    special: 'auspices',
    text: 'Gain 2 Fortuna; order 1 unit.',
    flavor: 'The birds fly east. Someone pays for that.',
  },
};

export const STRATAGEMS = {
  ambush: {
    name: 'Ambush',
    secret: 'section',
    text: 'The first enemy that ends its move adjacent to your unit in the secret section is struck at +1 die.',
  },
  countercharge: {
    name: 'Countercharge',
    secret: null,
    text: 'The first enemy that ends its move adjacent to your cavalry is charged at +1 die.',
  },
  caltrops: {
    name: 'Caltrops',
    secret: 'hex',
    text: 'The first enemy entering the secret hex stops dead and loses 1 block.',
  },
  feignedRetreat: {
    name: 'Feigned Retreat',
    secret: 'section',
    text: 'The first melee strike against your unit in the secret section is wasted — it slips 2 hexes away first.',
  },
  holdTheLine: {
    name: 'Hold the Line',
    secret: 'section',
    text: 'The first pushes against your unit in the secret section are ignored — and it battles back at +1 die.',
  },
  rallyStandards: {
    name: 'Rally the Standards',
    secret: null,
    text: 'When one of your units falls, up to 2 adjacent comrades immediately strike back.',
  },
};

export function buildBag() {
  const bag = [];
  for (const [id, tile] of Object.entries(TILES)) {
    for (let i = 0; i < tile.count; i++) bag.push(id);
  }
  return bag;
}
