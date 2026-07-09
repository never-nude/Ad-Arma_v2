// DOM layer: topbar, council row, context panel, chronicle, dice tray,
// seal reveals, modals, tooltips. main.js drives everything through here.

import { C, UNIT_TYPES, SECTION_NAMES } from './engine/constants.js';
import { TILES, STRATAGEMS } from './engine/council.js';

export const $ = id => document.getElementById(id);

export function show(id) { $(id).classList.remove('hidden'); }
export function hide(id) { $(id).classList.add('hidden'); }

export function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

export function banner(text, ms = 1600) {
  const b = $('board-banner');
  b.textContent = text;
  b.classList.remove('hidden');
  clearTimeout(b._h);
  b._h = setTimeout(() => b.classList.add('hidden'), ms);
}

// ------------------------------------------------------------------ topbar

export function updateTopbar(view, mySide) {
  for (const side of [0, 1]) {
    $(`tb-name-${side}`).textContent = view.names[side] + (side === mySide ? ' (you)' : '');
    const l = view.laurels[side];
    $(`tb-laurels-${side}`).innerHTML =
      Array.from({ length: view.laurelTarget[side] }, (_, i) =>
        `<span class="${i < l ? 'got' : 'not'}">🏆</span>`).join('');
    const f = $(`tb-fortuna-${side}`);
    const prev = f._v;
    f.textContent = `☘ ${view.fortuna[side]}`;
    if (prev !== undefined && prev !== view.fortuna[side]) {
      f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash');
    }
    f._v = view.fortuna[side];
    const scrolls = view.scrolls[side];
    $(`tb-scrolls-${side}`).textContent = scrolls.length ? '📜'.repeat(scrolls.length) : '';
  }
  const mine = view.turn === mySide;
  const tt = $('tb-turn');
  if (view.winner !== null) tt.textContent = 'battle over';
  else if (view.phase === 'deploy') tt.textContent = 'BATTLE PLANS';
  else tt.textContent = mine ? 'YOUR TURN' : `${view.names[view.turn]} commands`;
  tt.classList.toggle('mine', (mine || view.phase === 'deploy') && view.winner === null);
  const roundsLeft = Math.max(0, Math.ceil((view.nightfallTurn - view.turnCount + 1) / 2));
  const night = $('tb-night');
  night.textContent = roundsLeft > 5 ? `☀ ${roundsLeft}` : `🌙 ${roundsLeft}`;
  night.title = `Nightfall in ${roundsLeft} rounds — most Laurels wins at dusk`;
  night.style.color = roundsLeft <= 5 ? '#e05545' : '';
}

// ----------------------------------------------------------------- council

export function renderCouncil(view, canTake, onTake) {
  const row = $('council-row');
  row.innerHTML = '';
  view.council.forEach((slot, i) => {
    const tile = TILES[slot.tile];
    const div = document.createElement('div');
    div.className = 'tile' + (canTake ? ' takeable' : '');
    div.innerHTML = `
      <div class="tile-name">${tile.name}</div>
      <div class="tile-text">${tile.text}</div>
      ${slot.coins ? `<div class="tile-coins">+${slot.coins}</div>` : ''}`;
    if (canTake) div.onclick = () => onTake(i);
    row.appendChild(div);
  });
}

// ----------------------------------------------------------------- context

export function setContext(html, buttons = []) {
  $('ctx-text').innerHTML = html;
  const wrap = $('ctx-buttons');
  wrap.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.innerHTML = b.label;
    btn.disabled = !!b.disabled;
    btn.onclick = b.cb;
    wrap.appendChild(btn);
  }
}

// --------------------------------------------------------------- chronicle

export function log(html, cls = '') {
  const lines = $('log-lines');
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.innerHTML = html;
  lines.appendChild(div);
  lines.scrollTop = lines.scrollHeight;
  while (lines.children.length > 120) lines.removeChild(lines.firstChild);
}

export function clearLog() { $('log-lines').innerHTML = ''; }

// --------------------------------------------------------------- dice tray

// opts: { title, dice, hitMin, selectable, selected:Set, onToggle, info, buttons }
export function showDiceTray(opts) {
  show('dicetray');
  $('tray-title').innerHTML = opts.title || 'The dice fall';
  const tray = $('tray-dice');
  tray.innerHTML = '';
  opts.dice.forEach((d, i) => {
    const die = document.createElement('div');
    const kind = d >= (opts.hitMin ?? C.HIT_MIN) ? 'hit' : d === C.PUSH_FACE ? 'push' : d === C.OMEN_FACE ? 'omen' : 'miss';
    die.className = `die ${kind}` + (opts.fresh ? ' rolling' : '');
    die.innerHTML = `${['', 'I', 'II', 'III', 'IV', 'V', 'VI'][d]}<div class="tag">${
      { hit: 'HIT', push: 'PUSH', omen: 'OMEN', miss: '·' }[kind]}</div>`;
    if (opts.selectable) {
      die.classList.add('selectable');
      if (opts.selected && opts.selected.has(i)) die.classList.add('selected-re');
      die.onclick = () => opts.onToggle(i);
    }
    tray.appendChild(die);
  });
  $('tray-info').innerHTML = opts.info || '';
  const btns = $('tray-buttons');
  btns.innerHTML = '';
  for (const b of opts.buttons || []) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.innerHTML = b.label;
    btn.disabled = !!b.disabled;
    btn.onclick = b.cb;
    btns.appendChild(btn);
  }
}

export function hideDiceTray() { hide('dicetray'); }

// ------------------------------------------------------------- seal reveal

const SEAL_GLYPH = {
  ambush: '🗡', countercharge: '🐎', caltrops: '✦',
  feignedRetreat: '🌀', holdTheLine: '🛡', rallyStandards: '🦅',
};

export function showSeal(effect, subtitle, ms = 2100) {
  return new Promise(res => {
    $('seal-wax').textContent = SEAL_GLYPH[effect] || '✠';
    $('seal-name').textContent = STRATAGEMS[effect] ? STRATAGEMS[effect].name.toUpperCase() : effect;
    $('seal-desc').textContent = subtitle || '';
    show('sealreveal');
    setTimeout(() => { hide('sealreveal'); res(); }, ms);
  });
}

// ------------------------------------------------------------------ modals

export function showModal(html, buttons = [{ label: 'Close' }]) {
  const box = $('modal-box');
  box.innerHTML = html;
  const wrap = document.createElement('div');
  wrap.className = 'tray-buttons modal-close';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.innerHTML = b.label;
    btn.onclick = () => { hideModal(); if (b.cb) b.cb(); };
    wrap.appendChild(btn);
  }
  box.appendChild(wrap);
  show('modal');
}

export function hideModal() { hide('modal'); }

// --------------------------------------------------------------- arm picker

export function showArmPicker(view, side, onPick) {
  const afford = view.fortuna[side] >= C.ARM_COST;
  const cards = Object.entries(STRATAGEMS).map(([id, s]) => `
    <div class="strat-card" data-id="${id}">
      <b>${SEAL_GLYPH[id] || ''} ${s.name}</b>
      <span>${s.text}</span>
      <span>${s.secret === 'hex' ? 'You will pick a secret hex.' : s.secret === 'section' ? 'You will pick a secret section.' : 'No target needed.'}</span>
    </div>`).join('');
  showModal(`
    <h2>ARM A STRATAGEM</h2>
    <p>Cost: <b style="color:var(--bronze)">${C.ARM_COST} Fortuna</b> (you have ${view.fortuna[side]}).
    Your enemy sees only that a scroll was sealed — never which. It fires itself. Max ${C.MAX_SCROLLS} armed.</p>
    ${afford ? `<div class="strat-pick">${cards}</div>` : '<p class="err">Not enough Fortuna.</p>'}
  `, [{ label: 'Never mind' }]);
  if (afford) {
    $('modal-box').querySelectorAll('.strat-card').forEach(el => {
      el.onclick = () => { hideModal(); onPick(el.dataset.id); };
    });
  }
}

// ----------------------------------------------------------------- tooltip

let tipEl = null;
export function showOdds(odds, x, y, targetName) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'odds-tip';
    document.body.appendChild(tipEl);
  }
  tipEl.style.display = 'block';
  const pct = v => Math.round(v * 100) + '%';
  tipEl.innerHTML = `
    <div class="big">${odds.dice} dice ${odds.melee ? '⚔ melee' : '🏹 ranged'}${odds.evade ? ' — they will evade!' : ''}</div>
    ~${odds.expHits.toFixed(1)} hits · ~${odds.expPushes.toFixed(1)} pushes<br>
    Kill ${targetName}: <b>${pct(odds.pKill)}</b>${odds.battleBack ? `<br>They battle back with ${odds.battleBack} dice` : ''}`;
  const pad = 14;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = Math.min(x + pad, window.innerWidth - w - 8) + 'px';
  tipEl.style.top = Math.max(8, y - h - pad) + 'px';
}

export function hideOdds() { if (tipEl) tipEl.style.display = 'none'; }

// ------------------------------------------------------------------- rules

export function rulesHTML() {
  return `
    <h2>HOW TO PLAY</h2>
    <p><b style="color:var(--parch)">Take an order from the War Council, execute it, and break the enemy.
    First to the field's Laurel target wins</b> (5 on the standard field — the trophy row up top shows yours).
    Each enemy unit destroyed is a Laurel; their General is worth ${C.GENERAL_LAURELS}.</p>

    <h3>YOUR TURN</h3>
    <ul>
      <li><b>Take a tile</b> from the Council row (pocket any coins on it as Fortuna). Every order you take is denied to your enemy — and tiles nobody takes grow richer each turn.</li>
      <li><b>Move</b> the units it names, then each may <b>fight once</b>.</li>
      <li>Any tile may instead be taken as a <em>plain order</em>: order 1 unit anywhere, no bonuses.</li>
    </ul>

    <h3>THE DICE</h3>
    <p>A unit rolls <b>dice equal to its remaining blocks</b>.</p>
    <table>
      <tr><th>V–VI</th><td>Hit — remove a block (a General is hit only by VI)</td></tr>
      <tr><th>IV</th><td>Push — defender retreats 1 hex; <b>every blocked push costs a block instead</b></td></tr>
      <tr><th>II–III</th><td>Miss</td></tr>
      <tr><th>I</th><td>Omen — miss, but <b>you</b> gain 1 Fortuna. The gods notice.</td></tr>
    </table>
    <p>+1 die when the defender is engaged by 2+ of your units (flanking) · +1 beside your General ·
    hills help archers and hinder uphill attacks · forests and fords cap attacks at 2 dice.
    A melee defender that holds its ground <b>battles back</b> at full dice.</p>

    <h3>FORTUNA ☘</h3>
    <p>Earn it from Omens, from council coins, and when your units die (the gods pity the fallen; +${C.DESPERATE_FORTUNA} the first time the enemy comes within a Laurel of victory).
    Spend it on your turn: <b>reroll</b> any of your dice (${C.REROLL_COSTS.join(', then ')}), a <b>War Cry</b> +1 die (${C.WARCRY_COST}), or…</p>

    <h3>STRATAGEMS 📜 (${C.ARM_COST} Fortuna)</h3>
    <p>Secretly arm a trap; the engine springs it on your enemy automatically — even while you sleep. They see only your scroll count. Ambushes, caltrops on a secret hex, feigned retreats… Unsprung scrolls are revealed when the battle ends.</p>

    <h3>THE UNITS</h3>
    <table>
      <tr><th>Infantry</th><td>4 blocks, move 1 — the anvil</td></tr>
      <tr><th>Cavalry</th><td>3 blocks, move 3 — pursues into a hex it clears in melee for a bonus battle</td></tr>
      <tr><th>Skirmishers</th><td>2 blocks, move 2, shoot at range 2 (no battle-back) — auto-evades melee unless flanked</td></tr>
      <tr><th>General</th><td>2 blocks, move 2 — no attack; +1 die to adjacent friends; evades; worth ${C.GENERAL_LAURELS} Laurels</td></tr>
    </table>

    <h3>NIGHTFALL 🌙</h3>
    <p>The sun counter up top counts the rounds. When night falls, the side closest to its Laurel target wins (then most surviving blocks). No battle grinds forever.</p>
  `;
}

export const SEAL_GLYPHS = SEAL_GLYPH;
