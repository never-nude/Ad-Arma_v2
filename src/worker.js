// Ad Arma worker: serves the static client and routes /api/* to GameRoom
// Durable Objects. The DO runs the same engine module as the browser, so the
// server is authoritative: it validates every action, keeps the only true
// state, and each client sees only its own filtered view.

import { DurableObject } from 'cloudflare:workers';
import { createGame, applyAction, viewFor } from '../public/js/engine/engine.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O — unambiguous
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;         // idle rooms dissolve after a day
const VIEW_EVENT_TAIL = 50;                       // events kept on full-view sends

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// Static mirrors of the client (ad-arma.com/v2 on GitHub Pages) call the API
// cross-origin. WebSockets need no CORS; room creation does.
const ALLOWED_ORIGINS = new Set([
  'https://ad-arma.com',
  'https://www.ad-arma.com',
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/room' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/api/room' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = makeCode();
        const stub = env.ROOMS.getByName(code);
        const claimed = await stub.init(body.scenarioId, body.deployMode);
        if (claimed) return Response.json({ code }, { headers: corsHeaders(request) });
      }
      return new Response('no rooms available', { status: 503, headers: corsHeaders(request) });
    }

    const m = url.pathname.match(/^\/api\/room\/([A-Za-z]{4})\/ws$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const stub = env.ROOMS.getByName(m[1].toUpperCase());
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

function filterEvents(events, seat, over) {
  return events.map(e => {
    if (!e.priv) return e;
    if (e.side === seat || over) return e;
    const { priv, ...pub } = e;
    return pub;
  });
}

// A per-seat view whose event log is capped — updates carry the fresh events
// separately, the view tail exists for rejoins and the game-over screen.
function seatView(state, seat) {
  const v = viewFor(state, seat);
  return { ...v, events: v.events.slice(-VIEW_EVENT_TAIL) };
}

export class GameRoom extends DurableObject {
  // Claims this room code. Returns false if the code is already in use.
  async init(scenarioId, deployMode) {
    if (await this.ctx.storage.get('created')) return false;
    await this.ctx.storage.put('created', Date.now());
    await this.ctx.storage.put('config', {
      scenarioId: typeof scenarioId === 'string' ? scenarioId : 'openField',
      deployMode: !!deployMode,
    });
    await this.ctx.storage.put('players', []);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    return true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const key = (url.searchParams.get('key') || '').slice(0, 64);
    const name = (url.searchParams.get('name') || 'Commander').slice(0, 16).trim() || 'Commander';

    if (!(await this.ctx.storage.get('created'))) {
      return this._rejectSocket('No such room. Check the code.');
    }
    if (!key) return this._rejectSocket('Missing player key.');

    const players = (await this.ctx.storage.get('players')) || [];
    let player = players.find(p => p.key === key);
    if (!player) {
      if (players.length >= 2) return this._rejectSocket('The room is full.');
      player = { key, name, seat: players.length };
      players.push(player);
      await this.ctx.storage.put('players', players);
    } else if (player.name !== name) {
      player.name = name;
      await this.ctx.storage.put('players', players);
    }

    // a fresh connection for this seat supersedes any zombie sockets
    for (const old of this.ctx.getWebSockets('seat' + player.seat)) {
      try { old.close(4002, 'superseded by a new connection'); } catch { /* already gone */ }
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['seat' + player.seat]);
    pair[1].serializeAttachment({ seat: player.seat, key });

    const state = await this.ctx.storage.get('state');
    this._send(pair[1], {
      t: 'joined',
      seat: player.seat,
      started: !!state,
      view: state ? seatView(state, player.seat) : undefined,
      players: this._roster(players),
    });
    await this._broadcastPlayers(players);

    if (!state && players.length === 2) await this._startGame(players);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    if (msg.t === 'ping') { this._send(ws, { t: 'pong' }); return; }
    if (msg.t !== 'action' || !msg.action) return;

    const att = ws.deserializeAttachment();
    let state = await this.ctx.storage.get('state');
    if (!state) { this._send(ws, { t: 'error', msg: 'The battle has not begun.' }); return; }

    let res;
    try {
      res = applyAction(state, att.seat, msg.action);
    } catch (e) {
      // untrusted input must never take the room down
      this._send(ws, { t: 'error', msg: 'invalid action' });
      return;
    }
    if (!res.ok) { this._send(ws, { t: 'error', msg: res.error }); return; }
    state = res.state;
    await this.ctx.storage.put('state', state);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);

    const over = state.winner !== null;
    for (const sock of this.ctx.getWebSockets()) {
      const a = sock.deserializeAttachment();
      this._send(sock, {
        t: 'update',
        view: seatView(state, a.seat),
        events: filterEvents(res.events, a.seat, over),
      });
    }
  }

  async webSocketClose(ws) {
    const players = (await this.ctx.storage.get('players')) || [];
    await this._broadcastPlayers(players, ws);
  }

  async webSocketError(ws) {
    const players = (await this.ctx.storage.get('players')) || [];
    await this._broadcastPlayers(players, ws);
  }

  // idle for a full TTL — dissolve the room
  async alarm() {
    for (const sock of this.ctx.getWebSockets()) {
      try { sock.close(4001, 'room expired'); } catch { /* already gone */ }
    }
    await this.ctx.storage.deleteAll();
  }

  async _startGame(players) {
    const config = (await this.ctx.storage.get('config')) || {};
    const seed = [...crypto.getRandomValues(new Uint32Array(2))].join('-');
    const state = createGame({
      scenarioId: config.scenarioId,
      deployMode: config.deployMode,
      seed: 'room-' + seed,
      names: [players[0]?.name || 'Rome', players[1]?.name || 'Carthage'],
    });
    await this.ctx.storage.put('state', state);
    for (const sock of this.ctx.getWebSockets()) {
      const a = sock.deserializeAttachment();
      this._send(sock, { t: 'start', view: seatView(state, a.seat) });
    }
  }

  // `closing` — a socket mid-close that must not count as connected (during
  // webSocketClose the runtime may still list it).
  _roster(players, closing = null) {
    return players.map(p => ({
      seat: p.seat,
      name: p.name,
      connected: this.ctx.getWebSockets('seat' + p.seat).some(s => s !== closing),
    }));
  }

  async _broadcastPlayers(players, closing = null) {
    const roster = this._roster(players, closing);
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === closing) continue;
      this._send(sock, { t: 'players', players: roster });
    }
  }

  _send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket already closed */ }
  }

  _rejectSocket(msg) {
    const pair = new WebSocketPair();
    pair[1].accept();
    try {
      pair[1].send(JSON.stringify({ t: 'error', msg }));
      pair[1].close(4000, 'rejected');
    } catch { /* nothing to do */ }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}
