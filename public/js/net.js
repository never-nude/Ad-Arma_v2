// WebSocket client for private rooms. Auto-reconnects with the player key so
// a refresh (or a dropped connection) resumes the same seat.

export class RoomConnection {
  constructor(code, name) {
    this.code = code.toUpperCase();
    this.name = name;
    this.key = localStorage.getItem('adarma-key-' + this.code) || crypto.randomUUID();
    localStorage.setItem('adarma-key-' + this.code, this.key);
    this.ws = null;
    this.handlers = {};
    this.closed = false;
    this.retries = 0;
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  _emit(type, data) { if (this.handlers[type]) this.handlers[type](data); }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/room/${this.code}/ws` +
      `?key=${encodeURIComponent(this.key)}&name=${encodeURIComponent(this.name || 'Commander')}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.retries = 0; this._emit('open'); };
    this.ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._emit(msg.t, msg);
    };
    this.ws.onclose = e => {
      this._emit('close', e);
      if (!this.closed && e.code !== 4000 && e.code !== 4001 && this.retries < 8) {
        this.retries++;
        setTimeout(() => this.connect(), Math.min(500 * 2 ** this.retries, 8000));
        this._emit('reconnecting', this.retries);
      }
    };
    this.ws.onerror = () => {};
    return this;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  action(action) { this.send({ t: 'action', action }); }

  close() {
    this.closed = true;
    if (this.ws) this.ws.close();
  }
}

export async function createRoom(scenarioId, deployMode) {
  const res = await fetch('/api/room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId, deployMode: !!deployMode }),
  });
  if (!res.ok) throw new Error('could not create room');
  return res.json(); // { code }
}
