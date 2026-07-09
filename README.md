# AD ARMA — The War Council

A 20-minute hex battle of the classical world, in the browser. Draft your
orders from a shared War Council, roll dice equal to your remaining soldiers,
bribe Fortuna for rerolls — and seal secret stratagems the engine springs on
your enemy at the worst possible moment.

**Play it:** https://ad-arma-v2.playful-lab.workers.dev *(vs. the computer, or
raise a private room and send a friend the 4-letter code)*

## Why it's fun (the design in one breath)

- **The War Council** — no hidden hand of cards. A public row of order tiles
  shared by both players: every order you take is one your enemy doesn't get,
  and orders nobody takes accumulate bribe coins each turn. Take the strong
  order, or the weak one carrying gold?
- **Dice with a memory** — 5–6 hits, 4 pushes the enemy back (a soldier who
  can't retreat bleeds instead), and a **1 is an Omen that pays YOU** — cold
  dice literally bank future luck.
- **Fortuna** — one currency, three agonizing sinks: escalating rerolls
  (1/2/3), War Cries (+1 die), and…
- **Sealed Stratagems** — pay 3 Fortuna to secretly arm one of six traps
  (Caltrops on a secret hex, an Ambush in a secret section, a Feigned
  Retreat…). The server springs them automatically — an incorruptible referee
  no cardboard game can match. Your enemy sees only your scroll count.
- **Battle Plans mode** — optional blind deployment: both sides secretly
  arrange their armies; the engine reveals the musters simultaneously.
- **Nightfall** — after 30 rounds each, dusk ends the battle. Nothing stalls.

First to **5 Laurels** wins (a destroyed unit is one, the enemy General two).
Easy to learn — the whole teach is one screen — and the luck-to-skill valve
means the better strategist wins the series, not every game.

## Stack

- **Engine** — a pure, deterministic, seeded rules reducer
  ([public/js/engine/](public/js/engine/)) shared verbatim by the browser and
  the server. Every mutation is an event; clients animate the event stream.
- **Client** — vanilla ES modules, canvas renderer, WebAudio synth. No build
  step, no dependencies.
- **Server** — Cloudflare Worker + a `GameRoom` Durable Object (WebSocket
  hibernation) per private room. Server-authoritative: it validates every
  action and each seat receives only its own filtered view — enemy scrolls,
  hands, RNG and the bag never leave the server.
- **AI** — heuristic commander in three strengths (Legate / Consul /
  Imperator). It plays from the same filtered view a human gets, so it cannot
  cheat.

## Develop

```sh
npm install
npm test        # engine invariants, blind-deploy secrecy, AI-vs-AI sims
npm run dev     # wrangler dev
npm run deploy  # wrangler deploy
```

Every balance knob lives in
[public/js/engine/constants.js](public/js/engine/constants.js).

## Rules reference

See [DESIGN.md](DESIGN.md) — the full design document, including what was
deliberately cut and why.
