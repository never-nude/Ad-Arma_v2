// Every balance knob in the game lives here — one-pass tuning sweeps.

export const C = {
  LAURELS_TO_WIN: 5,
  GENERAL_LAURELS: 2,
  NIGHTFALL_TURN: 60,    // after this many player-turns, night ends the battle

  COUNCIL_SIZE: 5,       // face-up tiles in the War Council row
  COIN_CAP: 3,           // max bribe coins on one tile
  COIN_PER_TURN: 1,      // added to each tile that sits through your turn

  FORTUNA_START: 2,
  SECOND_PLAYER_FORTUNA: 0,  // knob: sides measured even at 0 (49.3% over 150 AI games)
  FORTUNA_CAP: 12,
  REROLL_COSTS: [1, 2, 3],   // escalating within a single battle; max 3 rerolls
  WARCRY_COST: 2,
  WARCRY_DICE: 1,
  ARM_COST: 3,               // arm one secret stratagem
  MAX_SCROLLS: 2,            // armed stratagems at once
  ARMS_PER_TURN: 1,
  OMEN_FORTUNA: 1,           // rolling a 1 pays the roller
  DEATH_FORTUNA: 1,          // the gods pity the fallen
  DESPERATE_AT: 4,           // when opponent first reaches this many laurels...
  DESPERATE_FORTUNA: 2,      // ...you receive this
  AUSPICES_FORTUNA: 2,

  // d6 outcomes
  HIT_MIN: 5,                // 5-6 hit
  GENERAL_HIT_MIN: 6,        // generals hit only on 6
  PUSH_FACE: 4,              // 4 pushes
  OMEN_FACE: 1,              // 1 is an omen

  EVADE_DIST: 2,
  EVADE_DICE: 1,
  FEIGNED_DIST: 2,
  AMBUSH_BONUS: 1,
  COUNTER_BONUS: 1,
  HOLD_BONUS: 1,
  CALTROPS_DAMAGE: 1,
  RALLY_UNITS: 2,            // strikes from Rally the Standards
  HEAL_AMOUNT: 1,            // Rally tile heal

  FLANK_BONUS: 1,            // defender engaged by 2+ enemies
  AURA_BONUS: 1,             // attacker adjacent to own General
  HILL_RANGED_BONUS: 1,
  UPHILL_PENALTY: 1,
  FOREST_MAX_DICE: 2,
  FORD_MAX_DICE: 2,
  MIN_DICE: 1,

  BOARD_COLS: 13,
  BOARD_ROWS: 9,
  // column spans, inclusive: [Left, Center, Right] — used only for trap targeting
  SECTIONS: [[0, 3], [4, 8], [9, 12]],
};

export const UNIT_TYPES = {
  infantry:   { blocks: 4, move: 1, range: 0, name: 'Infantry' },
  cavalry:    { blocks: 3, move: 3, range: 0, name: 'Cavalry' },
  skirmisher: { blocks: 2, move: 2, range: 2, name: 'Skirmishers' },
  general:    { blocks: 2, move: 2, range: 0, name: 'General' },
};

export const SECTION_NAMES = ['Left', 'Center', 'Right'];

export const SIDE_NAMES = ['Rome', 'Carthage'];
