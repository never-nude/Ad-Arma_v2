// App controller: menu, single-player (vs AI), private rooms, and the
// event-driven animation pipeline between engine and screen.

import { C, UNIT_TYPES, SECTION_NAMES } from './engine/constants.js';
import { TILES, STRATAGEMS } from './engine/council.js';
import {
  createGame, applyAction, viewFor, aliveUnits, unitById,
  orderableUnits, attackTargets, reachable, attackOdds, costFor,
} from './engine/engine.js';
import { aiAction } from './engine/ai.js';
import * as H from './engine/hex.js';
import { BoardRenderer } from './render.js';
import * as ui from './ui.js';
import { $, show, hide, toast } from './ui.js';
import { sfx } from './sfx.js';
import { RoomConnection, createRoom } from './net.js';

const app = {
  mode: null,            // 'sp' | 'mp'
  state: null,           // sp: authoritative local state
  view: null,            // my filtered view
  prevView: null,
  mySide: 0,
  difficulty: 'legate',
  scenario: 'openField',
  deployMode: false,
  renderer: null,
  conn: null,
  busy: false,
  over: false,
  sel: {},               // per-phase selection scratch
};

// ============================================================ menu wiring

function segInit(id, cb) {
  const seg = $(id);
  seg.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      cb(b.dataset.v);
      sfx.click();
    };
  });
}

function menuShow(sub) {
  for (const id of ['menu-root', 'menu-ai-setup', 'menu-create-setup', 'menu-join-setup']) {
    $(id).classList.toggle('hidden', id !== sub);
  }
  $('menu-error').textContent = '';
}

function initMenu() {
  segInit('seg-difficulty', v => { app.difficulty = v; });
  segInit('seg-scenario', v => { app.scenario = v; });
  segInit('seg-scenario-mp', v => { app.scenario = v; });
  segInit('seg-deploy', v => { app.deployMode = v === 'plans'; });
  segInit('seg-deploy-mp', v => { app.deployMode = v === 'plans'; });

  $('btn-vs-ai').onclick = () => { sfx.click(); menuShow('menu-ai-setup'); };
  $('btn-create-room').onclick = () => { sfx.click(); menuShow('menu-create-setup'); };
  $('btn-join-room').onclick = () => { sfx.click(); menuShow('menu-join-setup'); };
  $('btn-ai-back').onclick = () => menuShow('menu-root');
  $('btn-create-back').onclick = () => menuShow('menu-root');
  $('btn-join-back').onclick = () => menuShow('menu-root');
  $('btn-howto').onclick = () => ui.showModal(ui.rulesHTML());
  $('btn-start-ai').onclick = () => startSinglePlayer();
  $('btn-do-create').onclick = () => doCreateRoom();
  $('btn-do-join').onclick = () => doJoinRoom($('join-code').value, $('join-name').value);
  $('btn-rules').onclick = () => ui.showModal(ui.rulesHTML());
  $('btn-sound').onclick = () => { $('btn-sound').textContent = sfx.toggleMute() ? '🔇' : '🔊'; };
  $('btn-resign').onclick = () => {
    if (app.over || !app.view) return;
    ui.showModal('<h2>RESIGN?</h2><p>Strike your colors and yield the field?</p>', [
      { label: 'Fight on', cls: '' },
      { label: 'Resign', cls: 'btn-gold', cb: () => sendAction({ t: 'resign' }) },
    ]);
  };
  $('btn-lobby-leave').onclick = () => location.href = location.pathname;

  $('join-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  if (localStorage.getItem('adarma-name')) {
    $('create-name').value = localStorage.getItem('adarma-name');
    $('join-name').value = localStorage.getItem('adarma-name');
  }
  // deep link: ?room=CODE
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    menuShow('menu-join-setup');
    $('join-code').value = room.toUpperCase().slice(0, 4);
  }
  if (sfx.isMuted()) $('btn-sound').textContent = '🔇';
}

function enterGame() {
  hide('screen-menu'); hide('screen-lobby'); show('screen-game');
  if (!app.renderer) {
    app.renderer = new BoardRenderer($('board'));
    app.renderer.onCellClick = onCellClick;
    app.renderer.onHover = onHover;
  }
  app.renderer.resize();
  ui.clearLog();
  app.over = false;
  app.sel = {};
}

// ============================================================ single player

function startSinglePlayer() {
  sfx.click();
  app.mode = 'sp';
  app.mySide = 0;
  app.state = createGame({
    scenarioId: app.scenario,
    seed: crypto.randomUUID(),
    deployMode: app.deployMode,
    names: ['Rome', 'The ' + { legate: 'Legate', consul: 'Consul', imperator: 'Imperator' }[app.difficulty]],
  });
  // in Battle Plans mode the AI seals its muster immediately — it reads only
  // its own filtered view, so it physically cannot peek at yours
  if (app.deployMode) {
    const aiSide = 1 - app.mySide;
    const res = applyAction(app.state, aiSide, aiAction(viewFor(app.state, aiSide), app.difficulty));
    if (res.ok) app.state = res.state;
  }
  enterGame();
  app.prevView = null;
  app.view = viewFor(app.state, app.mySide);
  app.renderer.setView(app.view, app.mySide);
  snapAll();
  ui.log(`<span class="gold">${app.state.scenarioName}</span> — the horns sound.`);
  if (app.deployMode) ui.log('The enemy has sealed its battle plan. Arrange yours.');
  updateUI();
}

async function spApply(action) {
  const res = applyAction(app.state, app.state.turn, action);
  if (!res.ok) { toast(res.error); return false; }
  app.state = res.state;
  app.prevView = app.view;
  app.view = viewFor(app.state, app.mySide);
  await animateEvents(res.events);
  return true;
}

async function spHumanAct(action) {
  if (app.busy) return;
  app.busy = true;
  clearTransientUI();
  const ok = await spApply(action);
  app.busy = false;
  updateUI();
  if (ok && !app.over && app.state.turn !== app.mySide) aiTurn();
}

async function aiTurn() {
  app.busy = true;
  updateUI();
  const aiSide = 1 - app.mySide;
  let guard = 0;
  while (app.state.winner === null && app.state.turn === aiSide && guard++ < 200) {
    await wait(320);
    const action = aiAction(viewFor(app.state, aiSide), app.difficulty);
    const ok = await spApply(action);
    if (!ok) { console.error('AI illegal action', action); break; }
    updateTopOnly();
  }
  app.busy = false;
  updateUI();
}

// ============================================================ multiplayer

async function doCreateRoom() {
  sfx.click();
  const name = ($('create-name').value || 'Commander').trim();
  localStorage.setItem('adarma-name', name);
  try {
    $('btn-do-create').disabled = true;
    const { code } = await createRoom(app.scenario, app.deployMode);
    joinRoom(code, name, true);
  } catch (e) {
    $('menu-error').textContent = 'The gates would not open. Try again.';
    $('btn-do-create').disabled = false;
  }
}

function doJoinRoom(code, name) {
  sfx.click();
  code = (code || '').trim().toUpperCase();
  name = (name || 'Commander').trim();
  if (code.length !== 4) { $('menu-error').textContent = 'The code is four letters.'; return; }
  localStorage.setItem('adarma-name', name);
  joinRoom(code, name, false);
}

function joinRoom(code, name, isCreator) {
  app.mode = 'mp';
  app.conn = new RoomConnection(code, name);
  let entered = false;

  app.conn.on('joined', msg => {
    app.mySide = msg.seat;
    app.busy = false;
    if (msg.started && msg.view) {
      entered = true;
      enterGame();
      app.prevView = null;
      app.view = msg.view;
      app.renderer.setView(app.view, app.mySide);
      snapAll();
      ui.log('<span class="gold">You rejoin the field.</span>');
      updateUI();
    } else {
      showLobby(code);
    }
  });

  app.conn.on('start', async msg => {
    entered = true;
    enterGame();
    app.prevView = null;
    app.view = msg.view;
    app.renderer.setView(app.view, app.mySide);
    snapAll();
    ui.log(`<span class="gold">${msg.view.scenarioName}</span> — the enemy is here.`);
    sfx.horn();
    updateUI();
  });

  app.conn.on('update', async msg => {
    app.busy = true;
    // an in-progress deployment draft must survive the opponent's commit
    const keepDraft = msg.view.phase === 'deploy' && !msg.view.deployed[app.mySide]
      ? app.sel.draft : null;
    clearTransientUI();
    if (keepDraft) app.sel.draft = keepDraft;
    app.prevView = app.view;
    app.view = msg.view;
    await animateEvents(msg.events || []);
    app.busy = false;
    updateUI();
  });

  app.conn.on('players', msg => {
    const other = (msg.players || []).find(p => p.seat !== app.mySide);
    if (entered) {
      if (other && !other.connected) ui.banner('THE ENEMY HAS LEFT THE FIELD', 2400);
      else if (other && other.connected) ui.banner('THE ENEMY RETURNS', 1400);
    } else {
      $('lobby-status').innerHTML = other
        ? 'The enemy arrives!' : 'Waiting for the enemy to arrive<span class="dots"></span>';
    }
  });

  app.conn.on('error', msg => {
    if (!entered) {
      hide('screen-lobby'); show('screen-menu');
      $('menu-error').textContent = msg.msg || 'Something went wrong.';
    } else {
      toast(msg.msg || 'Something went wrong.');
      app.busy = false;
      updateUI();
    }
  });

  app.conn.on('reconnecting', () => toast('Reconnecting…'));
  app.conn.on('dead', () => {
    app.busy = false;
    ui.banner('CONNECTION LOST', 4000);
    toast('Connection lost — refresh the page to rejoin this room.', 8000);
  });
  app.conn.connect();
}

function showLobby(code) {
  hide('screen-menu'); hide('screen-game'); show('screen-lobby');
  $('lobby-code').textContent = code;
  $('btn-copy-link').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied'));
  };
}

// ============================================================ actions

function sendAction(action) {
  if (app.over) return;
  if (app.mode === 'sp') spHumanAct(action);
  else if (app.conn) {
    if (app.busy) return; // one action in flight at a time — no double-spends
    app.busy = true;
    clearTransientUI();
    app.conn.action(action);
  }
}

// ============================================================ animation

const wait = ms => new Promise(r => setTimeout(r, ms));

async function animateEvents(events) {
  const R = app.renderer;
  // never leak enemy secrets that ride on events in SP mode
  events = events.map(e =>
    e.priv && e.side !== app.mySide && app.view.winner === null
      ? (({ priv, ...pub }) => pub)(e) : e);

  // draw from the PREVIOUS view while transitions play out
  if (app.prevView) R.setView({ ...app.prevView, turn: app.view.turn }, app.mySide);

  let trayOpen = false;
  for (const e of events) {
    switch (e.t) {
      case 'take': {
        const tile = TILES[e.tile];
        ui.log(`${sideName(e.side)} takes <b>${tile.name}</b>${e.coins ? ` <span class="gold">+${e.coins}☘</span>` : ''}${e.valve ? ' (plain order)' : ''}`, 'l' + e.side);
        sfx.take();
        if (e.coins) sfx.coin();
        await wait(300);
        break;
      }
      case 'heal': {
        const u = findUnit(e.unitId);
        if (u) { R.floatText(u.q, u.r, '+1', '#7fb069'); sfx.coin(); }
        ui.log(`${sideName(e.side)} rallies a unit back to strength.`, 'l' + e.side);
        await wait(500);
        break;
      }
      case 'steadfast':
        ui.log(`${sideName(e.side)} locks shields — <em>steadfast</em>.`, 'l' + e.side);
        break;
      case 'move': {
        sfx.march();
        await R.animateMove(e.unitId, e.path);
        break;
      }
      case 'sprung': {
        sfx.horn();
        R.shake();
        ui.log(`<span class="gold">⚡ ${STRATAGEMS[e.effect].name.toUpperCase()} springs!</span> (${sideName(e.side)})`);
        await ui.showSeal(e.effect, sealSubtitle(e));
        if (e.effect === 'caltrops' && e.secret) R.flashHex(e.secret.q, e.secret.r, '#c9a227', 900);
        break;
      }
      case 'attack': {
        const att = findUnit(e.attackerId), tgt = findUnit(e.targetId);
        const tgtType = tgt ? tgt.type : 'infantry';
        const mineInteractive = !e.auto && !e.battleBack
          && app.view.phase === 'combat' && app.view.turn === app.mySide
          && app.view.pending && app.view.pending.attackerId === e.attackerId
          && e.seq === lastSeqOf(events, 'attack');
        sfx.dice();
        if (tgt) R.flashHex(tgt.q, tgt.r, e.battleBack ? '#7fa3d7' : '#e05545', 600);
        if (!mineInteractive) {
          ui.showDiceTray({
            title: trayTitle(e),
            dice: e.dice, fresh: true,
            hitMin: tgtType === 'general' ? C.GENERAL_HIT_MIN : C.HIT_MIN,
            buttons: [],
          });
          trayOpen = true;
          await wait(900);
        }
        ui.log(`${trayTitle(e)} — ${e.dice.length} dice`, 'l' + (att ? att.side : 0));
        break;
      }
      case 'reroll': {
        sfx.dice();
        ui.log(`${sideName(e.side)} <span class="gold">bribes the dice</span> (reroll ${e.rerolls}).`, 'l' + e.side);
        await wait(350);
        break;
      }
      case 'combat': {
        const parts = [];
        if (e.hits) parts.push(`${e.hits} hit${e.hits > 1 ? 's' : ''}`);
        if (e.pushes) parts.push(`${e.pushes} push${e.pushes > 1 ? 'es' : ''}`);
        if (e.omens) parts.push(`${e.omens} omen${e.omens > 1 ? 's' : ''}`);
        if (e.held) parts.push('<b>they hold the line!</b>');
        if (e.steadfast) parts.push('steadfast — pushes ignored');
        if (e.evade) parts.push('they evade!');
        ui.log(`→ ${parts.length ? parts.join(', ') : 'nothing — a whiff'}`);
        if (e.hits) sfx.hit(); else if (e.pushes) sfx.push();
        if (e.omens) sfx.omen();
        if (trayOpen) { await wait(650); ui.hideDiceTray(); trayOpen = false; }
        break;
      }
      case 'damage': {
        const u = findUnit(e.unitId);
        if (u) {
          R.floatText(u.q, u.r, '−' + e.amount, '#e05545');
          R.flashHex(u.q, u.r, '#e05545', 400);
        }
        await wait(300);
        break;
      }
      case 'retreat': {
        const u = findUnit(e.unitId);
        sfx.push();
        await R.animateMove(e.unitId, e.path, 130);
        if (e.reason === 'evade') ui.log('… slipping away.');
        break;
      }
      case 'pushBlocked': {
        const u = findUnit(e.unitId);
        if (u) R.floatText(u.q, u.r, 'PINNED', '#e8cf7a');
        await wait(350);
        break;
      }
      case 'destroyed': {
        sfx.death();
        R.shake(380);
        R.flashHex(e.at.q, e.at.r, '#e05545', 800);
        R.floatText(e.at.q, e.at.r, '☠', '#e8d9b8');
        const u = findUnit(e.unitId);
        ui.log(`<b>${unitName(u)} is destroyed!</b> ${sideName(e.bySide)} claims ${e.laurels} laurel${e.laurels > 1 ? 's' : ''} (${e.totals[0]}–${e.totals[1]}).`, 'l' + e.bySide);
        sfx.laurel();
        markDead(e.unitId);
        await wait(650);
        break;
      }
      case 'fortuna': {
        if (e.delta > 0 && (e.reason === 'omen' || e.reason === 'desperate')) sfx.omen();
        if (e.reason === 'pity') ui.log(`The gods pity ${sideName(e.side)} <span class="gold">+${e.delta}☘</span>`);
        updateTopOnly();
        break;
      }
      case 'desperate': {
        ui.banner('THE DESPERATE HOUR', 1800);
        ui.log(`<span class="gold">The Desperate Hour — ${sideName(e.side)} is armed by the gods.</span>`);
        await wait(900);
        break;
      }
      case 'pursue': {
        sfx.march();
        await R.animateMove(e.unitId, [e.to], 200);
        ui.log(`${unitName(findUnit(e.unitId))} pursues!`);
        break;
      }
      case 'pursuitDeclined':
        ui.log('The cavalry holds.');
        break;
      case 'armed': {
        ui.log(`${sideName(e.side)} <span class="gold">seals a scroll…</span> 📜`, 'l' + e.side);
        sfx.take();
        if (e.priv && e.side === app.mySide) {
          toast(`${STRATAGEMS[e.priv.effect].name} armed.`);
        }
        await wait(350);
        break;
      }
      case 'deployStart':
        break;
      case 'deployCommitted': {
        ui.log(e.side === app.mySide
          ? '<span class="gold">Your battle plan is sealed.</span>'
          : `${sideName(e.side)} <span class="gold">seals their battle plan…</span>`, 'l' + e.side);
        sfx.take();
        break;
      }
      case 'deployReveal': {
        sfx.horn();
        ui.banner('THE HOSTS TAKE THE FIELD', 2000);
        ui.log('<span class="gold">Battle plans revealed — the hosts take the field.</span>');
        // enemy units flash into view at their true positions
        for (const u of app.view.units.filter(x => !x.dead && x.side !== app.mySide)) {
          R.flashHex(u.q, u.r, '#7fa3d7', 900);
          R.snapUnit(u.id, u.q, u.r);
        }
        R.setView(app.view, app.mySide);
        await wait(1200);
        break;
      }
      case 'turnEnd':
        break;
      case 'turnStart': {
        updateTopOnly();
        if (e.side === app.mySide && app.prevView) {
          ui.banner('YOUR TURN', 1100);
          sfx.take();
        }
        break;
      }
      case 'win': {
        // handled after the loop by updateUI → game over modal
        await wait(400);
        break;
      }
    }
  }
  if (trayOpen) ui.hideDiceTray();
  app.renderer.setView(app.view, app.mySide);
  snapAll();
  updateTopOnly();
}

function lastSeqOf(events, type) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t === type) return events[i].seq;
  return -1;
}

function trayTitle(e) {
  const att = findUnit(e.attackerId), tgt = findUnit(e.targetId);
  const an = unitName(att), tn = unitName(tgt);
  if (e.battleBack) return `${an} battles back at ${tn}`;
  if (e.auto) return `${an} strikes ${tn} (${e.reason ? STRATAGEMS[e.reason] ? STRATAGEMS[e.reason].name : e.reason : 'trap'})`;
  return `${an} attacks ${tn}${e.warcry ? ' — WAR CRY' : ''}`;
}

function sealSubtitle(e) {
  if (e.effect === 'caltrops') return 'Iron in the grass. The column stops dead.';
  if (e.effect === 'ambush') return `Steel from the shadows of the ${SECTION_NAMES[e.secret ? e.secret.section : 1]}.`;
  if (e.effect === 'countercharge') return 'The horses were already moving.';
  if (e.effect === 'feignedRetreat') return 'They were never really running.';
  if (e.effect === 'holdTheLine') return 'Not one step back.';
  if (e.effect === 'rallyStandards') return 'The standards do not fall alone.';
  return '';
}

// deceased units linger on the renderer's previous view until their death
// animation has played; this hides them immediately afterward.
function markDead(unitId) {
  if (app.prevView) {
    const u = app.prevView.units.find(x => x.id === unitId);
    if (u) u.dead = true;
  }
}

function findUnit(id) {
  return (app.prevView || app.view).units.find(u => u.id === id)
    || app.view.units.find(u => u.id === id) || null;
}

function unitName(u) {
  if (!u) return 'a unit';
  return `${app.view.names[u.side]}'s ${UNIT_TYPES[u.type].name}`;
}

function sideName(side) { return app.view.names[side]; }

function snapAll() {
  for (const u of app.view.units) app.renderer.snapUnit(u.id, u.q, u.r);
}

// ============================================================ UI state

function myTurn() {
  return app.view && app.view.winner === null && app.view.phase !== 'deploy'
    && app.view.turn === app.mySide && !app.busy;
}

function canDeploy() {
  return app.view && app.view.phase === 'deploy' && !app.view.deployed[app.mySide] && !app.busy;
}

// my units drawn at their draft positions while I arrange the battle plan
function draftView() {
  const v = app.view;
  if (!app.sel.draft) return v;
  return {
    ...v,
    units: v.units.map(u => app.sel.draft.has(u.id) ? { ...u, ...app.sel.draft.get(u.id) } : u),
  };
}

function deployZoneKeys() {
  const v = app.view;
  const zone = v.board.deployZones[app.mySide];
  return Object.entries(v.board.cells)
    .filter(([, t]) => t !== 'river')
    .map(([k]) => k)
    .filter(k => {
      const { r } = H.unkey(k);
      return r >= zone.minRow && r <= zone.maxRow;
    });
}

function clearTransientUI() {
  ui.hideOdds();
  app.sel = {};
}

function updateTopOnly() {
  if (app.view) ui.updateTopbar(app.view, app.mySide);
}

function updateUI() {
  const v = app.view;
  if (!v) return;
  // the dice tray must never outlive the combat decision it belongs to
  if (v.phase !== 'combat') ui.hideDiceTray();
  ui.updateTopbar(v, app.mySide);
  ui.renderCouncil(v, myTurn() && v.phase === 'take', onTakeTile);
  if (v.phase === 'deploy' && canDeploy()) {
    if (!app.sel.draft) {
      app.sel.draft = new Map(v.units.filter(u => u.side === app.mySide).map(u => [u.id, { q: u.q, r: u.r }]));
    }
    app.renderer.setView(draftView(), app.mySide);
    for (const [id, p] of app.sel.draft) app.renderer.snapUnit(id, p.q, p.r);
  } else {
    app.renderer.setView(v, app.mySide);
  }
  refreshHighlights();
  refreshContext();
  if (v.winner !== null && !app.over) {
    app.over = true;
    setTimeout(() => showGameOver(), 600);
  }
}

function onTakeTile(index) {
  if (!myTurn() || app.view.phase !== 'take') return;
  const slot = app.view.council[index];
  const tile = TILES[slot.tile];
  app.sel.tileIndex = index;
  sfx.click();
  ui.setContext(
    `<em>${tile.name}</em>${slot.coins ? ` carrying <em>+${slot.coins}☘</em>` : ''} — ${tile.text}<br>` +
    `<small>…or take it as a plain order: 1 unit anywhere, no bonus.</small>`,
    [
      { label: 'Execute', cls: 'btn-gold', cb: () => sendAction({ t: 'take', index, valve: false }) },
      { label: 'Plain order', cb: () => sendAction({ t: 'take', index, valve: true }) },
      { label: 'Cancel', cls: 'btn-ghost', cb: () => { app.sel = {}; updateUI(); } },
    ]);
}

function refreshContext() {
  const v = app.view;
  if (v.phase === 'deploy') {
    if (canDeploy()) {
      ui.setContext(
        '<em>Battle Plans.</em> The enemy cannot see your muster. Click a unit, then a hex in your zone — or swap two units. Commit when ready.',
        [
          { label: '⚔ Commit battle plan', cls: 'btn-gold', cb: commitDeploy },
          { label: 'Standard formation', cb: () => sendAction({ t: 'deploy', default: true }) },
        ]);
    } else {
      ui.setContext('Your plan is sealed. <em>Waiting for the enemy\'s battle plan…</em>');
    }
    return;
  }
  if (!myTurn()) {
    if (v.winner !== null) ui.setContext('The battle is decided.');
    else ui.setContext(`<em>${v.names[v.turn]}</em> commands the field…`);
    return;
  }
  const ctx = v.turnCtx;
  const armCost = costFor(v, app.mySide, C.ARM_COST);
  const armBtn = { label: `📜 Arm (${armCost}☘)`, cb: openArmPicker,
    disabled: v.fortuna[app.mySide] < armCost || v.scrolls[app.mySide].length >= C.MAX_SCROLLS || (ctx && ctx.armedThisTurn >= C.ARMS_PER_TURN) };

  switch (v.phase) {
    case 'take':
      if (app.sel.tileIndex === undefined) {
        ui.setContext('Choose an order from the <em>War Council</em>. What you take, the enemy cannot.');
      }
      break;
    case 'order': {
      if (app.sel.armPick) return; // picking a trap target
      const { units, max } = orderableUnits(v, ctx.tileId, ctx.valve);
      const picked = app.sel.units || [];
      const tile = TILES[ctx.tileId];
      let txt = `<em>${tile.name}</em>${ctx.valve ? ' (plain order)' : ''} — choose up to <em>${ctx.valve ? 1 : max}</em> unit${max > 1 ? 's' : ''} (${picked.length} chosen).`;
      if (!ctx.valve && tile.special === 'heal') {
        txt += app.sel.heal
          ? ` Healing <em>1 block</em>.` : ' Click a wounded unit beside your General to heal it.';
      }
      ui.setContext(txt, [
        { label: picked.length ? `Order ${picked.length} unit${picked.length > 1 ? 's' : ''}` : 'Order none', cls: 'btn-gold', cb: () => sendAction({ t: 'order', unitIds: picked, heal: app.sel.heal }) },
        armBtn,
      ]);
      break;
    }
    case 'move': {
      if (app.sel.armPick) return;
      const movers = aliveUnits(v, app.mySide).filter(u => u.ordered && !u.moved);
      ui.setContext(
        movers.length
          ? `<em>Move.</em> Click an ordered unit, then a golden hex. ${movers.length} may still move.`
          : 'All ordered units have moved.',
        [
          { label: '⚔ To battle', cls: 'btn-gold', cb: () => sendAction({ t: 'endPhase' }) },
          armBtn,
          { label: 'End turn', cls: 'btn-ghost', cb: () => sendAction({ t: 'endTurn' }) },
        ]);
      break;
    }
    case 'battle': {
      if (app.sel.armPick) return;
      const fighters = aliveUnits(v, app.mySide).filter(u => u.ordered && !u.attacked && attackTargets(v, u).length);
      ui.setContext(
        fighters.length
          ? `<em>Battle.</em> Click a unit, then a target. Hover a target to read the omens.${app.sel.warcry ? ' <em>WAR CRY armed (+1 die).</em>' : ''}`
          : 'No more attacks available.',
        [
          {
            label: app.sel.warcry ? '🔥 War Cry ON' : `War Cry (+1 die, ${costFor(v, app.mySide, C.WARCRY_COST)}☘)`,
            cls: app.sel.warcry ? 'btn-gold' : '',
            disabled: v.fortuna[app.mySide] < costFor(v, app.mySide, C.WARCRY_COST) && !app.sel.warcry,
            cb: () => { app.sel.warcry = !app.sel.warcry; sfx.click(); refreshContext(); },
          },
          armBtn,
          { label: 'End turn', cls: 'btn-gold', cb: () => sendAction({ t: 'endTurn' }) },
        ]);
      break;
    }
    case 'combat': {
      openInteractiveTray();
      ui.setContext('The dice are cast. Accept them — or bribe Fortuna for a reroll.');
      break;
    }
    case 'pursuit': {
      ui.setContext('<em>Your cavalry can pursue</em> into the hex it cleared — and strike again.', [
        { label: '🐎 Pursue!', cls: 'btn-gold', cb: () => sendAction({ t: 'pursue' }) },
        { label: 'Hold', cb: () => sendAction({ t: 'declinePursuit' }) },
      ]);
      break;
    }
  }
}

function openInteractiveTray() {
  const v = app.view;
  const p = v.pending;
  if (!p) return;
  const tgt = unitById(v, p.targetId);
  const hitMin = tgt && tgt.type === 'general' ? C.GENERAL_HIT_MIN : C.HIT_MIN;
  if (!app.sel.rerollSel) app.sel.rerollSel = new Set();
  const sel = app.sel.rerollSel;
  const canReroll = p.rerolls < C.REROLL_COSTS.length;
  const cost = canReroll ? costFor(v, app.mySide, C.REROLL_COSTS[p.rerolls]) : 0;
  const afford = canReroll && v.fortuna[app.mySide] >= cost;
  const hits = p.dice.filter(d => d >= hitMin).length;
  const omens = p.dice.filter(d => d === C.OMEN_FACE).length;
  ui.showDiceTray({
    title: trayTitle({ attackerId: p.attackerId, targetId: p.targetId, warcry: p.warcry }),
    dice: p.dice,
    hitMin,
    selectable: afford,
    selected: sel,
    onToggle: i => { sel.has(i) ? sel.delete(i) : sel.add(i); sfx.click(); openInteractiveTray(); },
    info: `${hits} hit${hits === 1 ? '' : 's'} so far.` +
      (afford ? ` Select dice to reroll (cost <b>${cost}☘</b>, you have ${v.fortuna[app.mySide]}).` : canReroll ? ' Not enough Fortuna to reroll.' : ' No rerolls left.') +
      (omens && afford ? ' <br><small>Omens pay their Fortuna only if you keep them.</small>' : ''),
    buttons: [
      ...(afford ? [{
        label: `Reroll ${sel.size || ''} (${cost}☘)`,
        disabled: !sel.size,
        cb: () => { const indices = [...sel]; app.sel.rerollSel = new Set(); sendAction({ t: 'reroll', indices }); },
      }] : []),
      { label: 'Accept the dice', cls: 'btn-gold', cb: () => { app.sel.rerollSel = new Set(); sendAction({ t: 'resolve' }); } },
    ],
  });
}

// ============================================================ board input

function refreshHighlights() {
  const v = app.view;
  const R = app.renderer;
  const hi = {};
  // own caltrops always marked
  hi.ownCaltrops = v.scrolls[app.mySide]
    .filter(s => s.effect === 'caltrops' && s.secret)
    .map(s => H.key(s.secret.q, s.secret.r));

  if (canDeploy()) {
    hi.reachable = deployZoneKeys();
    if (app.sel.active) hi.selected = app.sel.active;
    R.setHighlights(hi);
    return;
  }
  if (myTurn()) {
    const ctx = v.turnCtx;
    if (app.sel.armPick && app.sel.armPick.mode === 'hex') {
      hi.hexPick = Object.entries(v.board.cells)
        .filter(([, t]) => t !== 'river')
        .map(([k]) => k);
    } else if (v.phase === 'order') {
      const { units } = orderableUnits(v, ctx.tileId, ctx.valve);
      hi.orderables = new Set(units.map(u => u.id));
      hi.ordered = new Set(app.sel.units || []);
      if (!ctx.valve && TILES[ctx.tileId].special === 'heal') {
        const gen = aliveUnits(v, app.mySide).find(u => u.type === 'general');
        if (gen) {
          hi.healables = new Set(aliveUnits(v, app.mySide)
            .filter(u => u.id !== gen.id && u.blocks < u.maxBlocks && H.distance(u, gen) === 1)
            .map(u => u.id));
        }
      }
    } else if (v.phase === 'move') {
      hi.ordered = new Set(aliveUnits(v, app.mySide).filter(u => u.ordered && !u.moved).map(u => u.id));
      if (app.sel.active) {
        const u = unitById(v, app.sel.active);
        if (u && u.ordered && !u.moved) {
          hi.selected = u.id;
          const bonus = !ctx.valve && TILES[ctx.tileId].bonus === 'move' ? 1 : 0;
          const reach = reachable(v, u, UNIT_TYPES[u.type].move + bonus);
          hi.reachable = Object.keys(reach.dist);
        }
      }
    } else if (v.phase === 'battle') {
      hi.ordered = new Set(aliveUnits(v, app.mySide)
        .filter(u => u.ordered && !u.attacked && attackTargets(v, u).length)
        .map(u => u.id));
      if (app.sel.active) {
        const u = unitById(v, app.sel.active);
        if (u && u.ordered && !u.attacked) {
          hi.selected = u.id;
          hi.targets = attackTargets(v, u).map(t => H.key(t.unit.q, t.unit.r));
        }
      }
    }
  }
  R.setHighlights(hi);
}

function onCellClick({ q, r, unit }) {
  if (canDeploy()) { onDeployClick(q, r); return; }
  if (!myTurn()) return;
  const v = app.view;
  const ctx = v.turnCtx;

  // trap-target picking intercepts all clicks
  if (app.sel.armPick) {
    if (app.sel.armPick.mode === 'hex') {
      const t = v.board.cells[H.key(q, r)];
      if (t && t !== 'river') {
        const effect = app.sel.armPick.effect;
        app.sel.armPick = null;
        sendAction({ t: 'arm', effect, secret: { q, r } });
      }
    }
    return;
  }

  switch (v.phase) {
    case 'order': {
      if (!unit || unit.side !== app.mySide) return;
      const { units, max } = orderableUnits(v, ctx.tileId, ctx.valve);
      const tile = TILES[ctx.tileId];
      // heal pick first if eligible
      if (!ctx.valve && tile.special === 'heal') {
        const gen = aliveUnits(v, app.mySide).find(u => u.type === 'general');
        if (gen && unit.id !== gen.id && unit.blocks < unit.maxBlocks && H.distance(unit, gen) === 1
          && app.sel.heal !== unit.id && !(app.sel.units || []).includes(unit.id)) {
          app.sel.heal = unit.id;
          sfx.click();
          refreshContext(); refreshHighlights();
          return;
        }
      }
      if (!units.some(u => u.id === unit.id)) return;
      const picked = app.sel.units || (app.sel.units = []);
      const i = picked.indexOf(unit.id);
      if (i >= 0) picked.splice(i, 1);
      else {
        if (picked.length >= (ctx.valve ? 1 : max)) picked.shift();
        picked.push(unit.id);
      }
      sfx.click();
      refreshContext(); refreshHighlights();
      break;
    }
    case 'move': {
      if (unit && unit.side === app.mySide && unit.ordered && !unit.moved) {
        app.sel.active = unit.id;
        sfx.click();
        refreshHighlights();
        return;
      }
      if (app.sel.active && !unit) {
        const u = unitById(v, app.sel.active);
        if (!u) return;
        const bonus = !ctx.valve && TILES[ctx.tileId].bonus === 'move' ? 1 : 0;
        const reach = reachable(v, u, UNIT_TYPES[u.type].move + bonus);
        if (H.key(q, r) in reach.dist) {
          app.sel.active = null;
          sendAction({ t: 'move', unitId: u.id, to: { q, r } });
        }
      }
      break;
    }
    case 'battle': {
      if (unit && unit.side === app.mySide && unit.ordered && !unit.attacked) {
        app.sel.active = unit.id;
        sfx.click();
        refreshHighlights();
        return;
      }
      if (app.sel.active && unit && unit.side !== app.mySide) {
        const u = unitById(v, app.sel.active);
        if (!u) return;
        if (attackTargets(v, u).some(t => t.unit.id === unit.id)) {
          const warcry = !!app.sel.warcry;
          app.sel.active = null; app.sel.warcry = false;
          ui.hideOdds();
          sendAction({ t: 'attack', unitId: u.id, targetId: unit.id, warcry });
        }
      }
      break;
    }
  }
}

function onHover(info) {
  ui.hideOdds();
  if (!info || !myTurn() || app.view.phase !== 'battle' || !app.sel.active) return;
  const u = unitById(app.view, app.sel.active);
  if (!u || !info.unit || info.unit.side === app.mySide) return;
  if (!attackTargets(app.view, u).some(t => t.unit.id === info.unit.id)) return;
  const odds = attackOdds(app.view, u.id, info.unit.id, { warcry: !!app.sel.warcry });
  if (odds) ui.showOdds(odds, info.clientX, info.clientY, UNIT_TYPES[info.unit.type].name);
}

// ============================================================ deployment

function onDeployClick(q, r) {
  const draft = app.sel.draft;
  if (!draft) return;
  const zone = new Set(deployZoneKeys());
  const clickedId = [...draft.entries()].find(([, p]) => p.q === q && p.r === r)?.[0] || null;

  if (!app.sel.active) {
    if (clickedId) { app.sel.active = clickedId; sfx.click(); refreshHighlights(); }
    return;
  }
  // second click: place or swap
  if (clickedId === app.sel.active) { app.sel.active = null; refreshHighlights(); return; }
  if (!zone.has(H.key(q, r))) { toast('Outside your deployment zone.'); return; }
  const moving = draft.get(app.sel.active);
  if (clickedId) {
    draft.set(clickedId, { q: moving.q, r: moving.r }); // swap
    app.renderer.animateMove(clickedId, [{ q: moving.q, r: moving.r }], 120);
  }
  draft.set(app.sel.active, { q, r });
  app.renderer.animateMove(app.sel.active, [{ q, r }], 120);
  app.sel.active = null;
  sfx.march();
  app.renderer.setView(draftView(), app.mySide);
  refreshHighlights();
}

function commitDeploy() {
  const draft = app.sel.draft;
  if (!draft) return;
  const placements = [...draft.entries()].map(([id, p]) => ({ id, q: p.q, r: p.r }));
  sendAction({ t: 'deploy', placements });
}

// ============================================================ arm picker

function openArmPicker() {
  const v = app.view;
  ui.showArmPicker(v, app.mySide, effect => {
    const def = STRATAGEMS[effect];
    if (def.secret === 'hex') {
      app.sel.armPick = { effect, mode: 'hex' };
      ui.setContext(`<em>${def.name}</em> — click the secret hex. The enemy will never see it coming.`, [
        { label: 'Cancel', cls: 'btn-ghost', cb: () => { app.sel.armPick = null; updateUI(); } },
      ]);
      refreshHighlights();
    } else if (def.secret === 'section') {
      app.sel.armPick = { effect, mode: 'section' };
      ui.setContext(`<em>${def.name}</em> — choose the secret section.`, [
        ...SECTION_NAMES.map((n, i) => ({
          label: n, cb: () => { app.sel.armPick = null; sendAction({ t: 'arm', effect, secret: { section: i } }); },
        })),
        { label: 'Cancel', cls: 'btn-ghost', cb: () => { app.sel.armPick = null; updateUI(); } },
      ]);
    } else {
      sendAction({ t: 'arm', effect });
    }
  });
}

// ============================================================ game over

function showGameOver() {
  const v = app.view;
  const iWon = v.winner === app.mySide;
  const draw = v.winner === -1;
  if (draw) sfx.defeat();
  else if (iWon) sfx.victory();
  else sfx.defeat();
  const reason = {
    laurels: iWon ? 'The enemy army is broken.' : 'Your army is broken.',
    nightfall: 'Night falls on the field.',
    resign: iWon ? 'The enemy strikes their colors.' : 'You yield the field.',
  }[v.winReason] || '';
  const winEvt = [...v.events].reverse().find(e => e.t === 'win');
  let seals = '';
  if (winEvt && winEvt.unsprung && winEvt.unsprung.some(l => l.length)) {
    seals = '<h3>UNSPRUNG SCROLLS</h3><ul>' + winEvt.unsprung.map((list, side) =>
      list.map(s => `<li>${v.names[side]}: <b>${STRATAGEMS[s.effect].name}</b>${
        s.secret && s.secret.section !== undefined ? ` (${SECTION_NAMES[s.secret.section]})` :
        s.secret ? ' (secret hex)' : ''}</li>`).join('')).join('') + '</ul>';
  }
  ui.showModal(`
    <h2 style="text-align:center; font-size:34px; letter-spacing:.2em;">
      ${draw ? 'STALEMATE' : iWon ? '🏆 VICTORY' : 'DEFEAT'}
    </h2>
    <p style="text-align:center">${reason}<br>
    Laurels: ${v.names[0]} ${v.laurels[0]} — ${v.laurels[1]} ${v.names[1]}</p>
    ${seals}
  `, [
    ...(app.mode === 'sp' ? [{ label: '⚔ Rematch', cls: 'btn-gold', cb: () => startSinglePlayer() }] : []),
    { label: 'Back to the forum', cb: () => location.href = location.pathname },
  ]);
}

// ============================================================ boot

initMenu();

// debug/testing handle — harmless in production
window.__adarma = { app, sendAction, startSinglePlayer };
