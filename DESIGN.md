# AD ARMA — The War Council

*A 20-minute hex battle of the classical world. Orders are drafted, not drawn: you and your enemy scheme over the same council table, and every command you take is one you deny them. Fortuna — earned by cold dice and dead men — buys rerolls, war cries, and hidden stratagems that the engine springs at the worst possible moment.*

**The emotional hooks:**
1. **The sprung trap.** Your cavalry splashes into the ford; a horn blasts; a wax seal rips open across the screen: **CALTROPS**. You *knew* that ford was too quiet.
2. **The council steal.** You've been eyeing Cavalry Wings for two turns, letting its bribe grow — and your opponent takes it first, with your gold on it.

**Design identity check:** no hidden hand of cards, no board-section order cards, no unit-symbol dice — this is deliberately *not* Memoir '44 / Command & Colors in a toga. The engine is a public drafting row with aging bribes (never used in a hex wargame), a Fortuna economy that converts bad luck into future luck, and server-enforced secret traps that only a digital referee can adjudicate honestly.

---

## The 60-second rules speech

> On your turn: **take one order tile from the War Council row** — pocket any coins sitting on it — and execute it: move the units it names, then each may fight once. A unit rolls **dice equal to its remaining soldiers**: **5-6 hits, 4 pushes them back** — and a soldier who can't retreat bleeds instead — **1 is an Omen: the gods pay YOU a Fortuna**. Spend Fortuna to reroll (1, then 2, then 3), to add a die (War Cry, 2), or to **arm a secret stratagem** (3) the game will spring on me automatically. Orders nobody takes gain a coin each turn. First to the field's **Laurel target** wins (5 on the standard field) — each unit destroyed is a Laurel, my General is two.

Depth is opt-in: a first-timer can ignore stratagems and Fortuna entirely, just take tiles and fight, and still play a competent game.

---

## Units (per side: 4 Infantry, 2 Cavalry, 2 Skirmishers, 1 General)

Blocks = dice = health. Damage weakens output naturally. No HP tracks, no tiers.

| Unit | Blocks | Move | Identity |
|---|---|---|---|
| **Infantry** | 4 | 1 | The anvil. Slow, wide, wins grinding melees. |
| **Cavalry** | 3 | 3 | The hammer. Strikes anywhere; **pursues** after clearing a hex in melee (advance + one bonus battle, once per turn, never into forest). |
| **Skirmishers** | 2 | 2 | The wasp. Shoots at range 2 (no battle-back against ranged); toe-to-toe it must melee — but it would rather evade. **Auto-evades** melee — retreats 2 toward its own edge, attacker rolls just 1 die — unless flanked or cornered. |
| **General** | 2 | 2 | The mind. No attack. +1 die to adjacent friendly attacks. Hit **only on a 6**. Evades like a skirmisher. Worth **2 Laurels**. Heals neighbors via the Rally order. |

## Combat

Plain d6 pool — nothing to memorize, the tray explains itself:

| Die | Result |
|---|---|
| **5–6** | Hit — remove a block (General: only a **6** hits) |
| **4** | Push — defender retreats 1 hex toward its own edge; **each blocked push = 1 block lost** |
| **2–3** | Miss |
| **1** | **Omen** — miss, and the *roller* gains 1 Fortuna ("the gods notice") |

- Dice rolled = attacker's remaining blocks, then modifiers:
  - **Flanking** +1 if the defender is adjacent to 2+ attacker-side units.
  - **General's aura** +1 if the attacker is adjacent to its own General.
  - Tile bonuses (Assault, Volley, Cavalry Wings) +1.
  - **War Cry** +1 (2 Fortuna, declared before rolling).
  - Hill: ranged attack from a hill +1; melee attack uphill −1.
  - Forest: attacks into or out of it capped at 2 dice. Ford: attacker on a ford capped at 2.
  - Minimum 1 die.
- **Battle back:** a melee defender that survives in place immediately strikes back with its full dice (no Fortuna spends on battle-backs).
- **Pushes:** retreat path is chosen deterministically by the engine (straight back preferred, then away from enemies). *Steadfast* units (Shield Wall) ignore pushes. Retreating into secret Caltrops is exactly as bad as it sounds.
- All defender behavior is automatic — **zero interrupt windows**, so online play is strictly turn-taking and async-safe.

### Terrain (exactly 4)

| Terrain | Effect |
|---|---|
| **Open** | — |
| **Forest** | Must stop on entering. Attacks in/out: max 2 dice. Blocks ranged shots passing over it. No pursuit into forest. |
| **Hill** | Ranged from hill: +1 die. Melee uphill: −1 die. |
| **River / Ford** | River impassable except at fords. Attacker standing on a ford: max 2 dice. |

## The War Council (the X-factor, part 1 — public)

A shared row of **5 face-up order tiles**, refilled from a bag of 19. On your turn:

1. **TAKE** one tile (collect any coins on it as Fortuna) — or take any tile as a *plain order*: order 1 unit anywhere, no bonuses (the relief valve).
2. **EXECUTE** it: select the units it names, move them, then battle with them.
3. **ARM** (optional, once per turn, 3 Fortuna): secretly choose a stratagem and its secret target. Max 2 armed; opponent sees only your scroll count.
4. **END**: the row refills to 5; every tile that sat through your turn gains +1 coin (cap 3).

| Tile | # | Order |
|---|---|---|
| **March** | 4 | Order up to 3 units. |
| **Assault** | 3 | Order up to 2 units; +1 die in melee. |
| **Cavalry Wings** | 2 | Order all cavalry; +1 die in melee. |
| **Volley** | 2 | Order all skirmishers; +1 die ranged. |
| **Shield Wall** | 2 | Order up to 3 infantry; they ignore pushes until your next turn. |
| **Forced March** | 2 | Order up to 2 units; +1 movement. |
| **Rally** | 2 | Heal 1 block on a unit adjacent to your General; then order 1 unit. |
| **Auspices** | 2 | Gain 2 Fortuna; order 1 unit. |

Taking an order **denies it to your enemy** — the row is the battlefield before the battlefield. Coins make stale orders tempting: the longer everyone ignores Volley, the richer it gets.

## Stratagems (the X-factor, part 2 — hidden)

Armed with Fortuna (3), chosen secretly from all six — the engine watches the board and **springs them automatically, mandatorily, one-shot**, with a full-screen wax-seal reveal. No interrupts, and your trap fires even if you're offline.

- **AMBUSH (secret section):** first enemy that ends its move adjacent to your unit in that section is struck at +1 die (no battle-back).
- **COUNTERCHARGE:** first enemy that ends its move adjacent to your cavalry is charged at +1 die (no battle-back).
- **CALTROPS (secret hex):** first enemy entering that hex stops dead and loses 1 block.
- **FEIGNED RETREAT (secret section):** first melee strike against your unit there is wasted — the unit slips 2 hexes back before dice are rolled.
- **HOLD THE LINE (secret section):** first pushes against your unit there are all ignored — and it battles back at +1 die.
- **RALLY THE STANDARDS:** when one of your units is destroyed, up to 2 adjacent comrades immediately strike (the killer first).

Sections (Left / Center / Right board thirds) exist *only* as trap-targeting zones. At game end, unsprung scrolls are revealed so a wasted seal is legible.

## Fortuna (public track, start 2, cap 12)

- **Earn:** +1 per Omen (1) you roll · +1 when one of *your* units dies ("the gods pity the fallen") · **Desperate Hour:** +2 every time the leader takes a Laurel while 2+ ahead or within one of victory · coins from passed-over council tiles · +2 from Auspices.
- **Spend (your turn only):** rerolls at 1/2/3 per battle · War Cry +1 die (2) · arm a stratagem (3).
- **The gods love an underdog:** while you trail by 2+ Laurels, every Fortuna price is discounted by 1 (minimum 1).

This is the luck-to-skill valve *and* the comeback engine: cold dice and lost units literally fund your counterpunch. The best strategist doesn't always win a game — but wins the rematch series.

## Victory

First to the scenario's **Laurel target** (5 on the standard 13×9 fields; 7 on Grand Field; 9 on Great Plain). Destroyed unit = 1; enemy General = 2.

**Nightfall:** after 30 rounds each, darkness ends the battle — most Laurels wins (tiebreak: most surviving blocks; then a draw). No battle grinds forever, and a trailing player must force the issue before dusk.

## Board & scenarios

13 × 9 hex board (pointy-top). Scenarios: **The River Crossing** (three fords), **Hill Country** (central ridge, wooded flanks), **Open Field**, **Random Field** (seeded, mirrored, fair).

## Modes

- **vs. Computer** — client-side heuristic AI, three difficulties (Legate / Consul / Imperator).
- **vs. a Friend** — private room with a 4-letter code; server-authoritative Durable Object; rejoin-safe; async-friendly.
- **Battle Plans** (optional muster, both modes) — blind deployment: each side secretly arranges its army in its three home rows; the engine reveals both plans at once and the battle begins. The AI musters from its own filtered view, so it *cannot* peek. Standard mirrored deployment stays the default.

## UX doctrine

- Live **odds tooltip** before confirming any attack: expected hits/pushes, kill %.
- Everything public is BIG: Fortuna tracks, Laurel tallies, scroll counts, council coins.
- Wax-seal full-screen reveal on every sprung stratagem; end-game reveal of unsprung ones.
- "How to play" is one screen; tooltips carry the rest.

## Deliberately cut

Hidden hands of cards; board-section order cards; unit-symbol dice (all three: too close to Command & Colors). Quality tiers, unit points, medics/runners (old game's bookkeeping). Interrupt windows of any kind. Trap-cancels-trap. Simultaneous orders. Hotseat.

## Tuning constants

All balance knobs live in `public/js/engine/constants.js` — laurel target, Fortuna prices/caps/income, council size, coin caps, tile mix — for one-pass balance sweeps.
