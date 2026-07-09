// Canvas board renderer: terrain, units, highlights, and lightweight
// animations (slides, flashes, floating text). One rAF loop redraws the
// whole scene — the board is small enough that this is trivially cheap.

import * as H from './engine/hex.js';
import { C, UNIT_TYPES } from './engine/constants.js';
import { colOf } from './engine/scenarios.js';

const TERRAIN_FILL = {
  open: '#2a241b',
  forest: '#1d2b1c',
  hill: '#3a2f1e',
  river: '#1b2f3d',
  ford: '#274152',
};

const SIDE_COLOR = ['#c0392b', '#5b7fb5'];
const SIDE_EDGE = ['#e8b090', '#b9cbe8'];

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = null;
    this.mySide = 0;
    this.size = 30;
    this.origin = { x: 0, y: 0 };
    this.pos = new Map();      // unitId -> {x, y} animated pixel position
    this.anims = [];           // active tweens
    this.effects = [];         // floaters / rings
    this.hi = {};              // highlight sets
    this.hover = null;
    this.onCellClick = null;
    this.onHover = null;

    canvas.addEventListener('click', e => this._click(e));
    canvas.addEventListener('mousemove', e => this._move(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; if (this.onHover) this.onHover(null); });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    const loop = () => { this._draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setView(view, mySide) {
    this.view = view;
    this.mySide = mySide;
    // snap any unit we haven't seen yet; keep animated positions for the rest
    for (const u of view.units) {
      if (!this.pos.has(u.id)) this.pos.set(u.id, this._px(u.q, u.r));
    }
  }

  setHighlights(hi) { this.hi = hi || {}; }

  resize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth, h = el.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // fit 13 cols x 9 rows with margin
    const sw = w / (Math.sqrt(3) * (C.BOARD_COLS + 1.2));
    const sh = h / (1.5 * C.BOARD_ROWS + 1.4);
    this.size = Math.max(12, Math.min(sw, sh));
    const bw = Math.sqrt(3) * this.size * (C.BOARD_COLS + 0.5);
    const bh = this.size * (1.5 * (C.BOARD_ROWS - 1) + 2);
    this.origin = { x: (w - bw) / 2 + Math.sqrt(3) * this.size / 2, y: (h - bh) / 2 + this.size };
    // re-snap all units on resize
    if (this.view) for (const u of this.view.units) this.pos.set(u.id, this._px(u.q, u.r));
  }

  _px(q, r) {
    const p = H.toPixel(q, r, this.size);
    return { x: p.x + this.origin.x, y: p.y + this.origin.y };
  }

  _hexAt(mx, my) {
    const { q, r } = H.fromPixel(mx - this.origin.x, my - this.origin.y, this.size);
    return this.view && this.view.board.cells[H.key(q, r)] !== undefined ? { q, r } : null;
  }

  _evtPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _click(e) {
    if (!this.onCellClick || !this.view) return;
    const { x, y } = this._evtPos(e);
    const hex = this._hexAt(x, y);
    if (!hex) return;
    const unit = this.view.units.find(u => !u.dead && u.q === hex.q && u.r === hex.r) || null;
    this.onCellClick({ ...hex, unit });
  }

  _move(e) {
    if (!this.view) return;
    const { x, y } = this._evtPos(e);
    const hex = this._hexAt(x, y);
    const prev = this.hover && H.key(this.hover.q, this.hover.r);
    const now = hex && H.key(hex.q, hex.r);
    this.hover = hex;
    if (prev !== now && this.onHover) {
      const unit = hex ? this.view.units.find(u => !u.dead && u.q === hex.q && u.r === hex.r) || null : null;
      this.onHover(hex ? { ...hex, unit, clientX: e.clientX, clientY: e.clientY } : null);
    }
  }

  // ---------------------------------------------------------- animations

  animateMove(unitId, path, msPerHex = 160) {
    return new Promise(res => {
      const from = this.pos.get(unitId);
      const pts = [from ? { ...from } : this._px(path[0].q, path[0].r),
        ...path.map(h => this._px(h.q, h.r))];
      if (pts.length < 2) return res();
      this.anims.push({
        unitId, pts,
        dur: msPerHex * (pts.length - 1),
        start: performance.now(),
        done: res,
      });
    });
  }

  snapUnit(unitId, q, r) { this.pos.set(unitId, this._px(q, r)); }

  flashHex(q, r, color = '#e74c3c', dur = 500) {
    this.effects.push({ kind: 'ring', p: this._px(q, r), color, start: performance.now(), dur });
  }

  floatText(q, r, text, color = '#e8d9b8', dur = 1100) {
    this.effects.push({ kind: 'float', p: this._px(q, r), text, color, start: performance.now(), dur });
  }

  shake(dur = 300) {
    this.effects.push({ kind: 'shake', start: performance.now(), dur });
  }

  // --------------------------------------------------------------- drawing

  _hexPath(cx, cy, s) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = cx + s * Math.cos(a), y = cy + s * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this.view) return;
    const now = performance.now();

    ctx.save();
    // screen shake
    for (const fx of this.effects) {
      if (fx.kind === 'shake') {
        const k = 1 - (now - fx.start) / fx.dur;
        if (k > 0) ctx.translate((Math.random() - .5) * 8 * k, (Math.random() - .5) * 8 * k);
      }
    }

    this._drawBoard(now);
    this._drawHighlights(now);
    this._drawUnits(now);
    this._drawEffects(now);
    ctx.restore();

    this.effects = this.effects.filter(fx => now - fx.start < fx.dur);
    this._stepAnims(now);
  }

  _drawBoard(now) {
    const ctx = this.ctx;
    const s = this.size;
    for (const [k, terr] of Object.entries(this.view.board.cells)) {
      const { q, r } = H.unkey(k);
      const { x, y } = this._px(q, r);
      this._hexPath(x, y, s * 0.985);
      ctx.fillStyle = TERRAIN_FILL[terr] || TERRAIN_FILL.open;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // subtle inner light
      this._hexPath(x, y, s * 0.985);
      ctx.strokeStyle = 'rgba(232,217,184,.05)';
      ctx.stroke();
      this._drawTerrainDeco(terr, x, y, s, q, r, now);
    }
    // section tint while picking a section
    if (this.hi.sectionPick !== undefined && this.hi.sectionPick !== null) {
      for (const [k] of Object.entries(this.view.board.cells)) {
        const { q, r } = H.unkey(k);
        const col = colOf(q, r);
        const sec = C.SECTIONS.findIndex(([a, b]) => col >= a && col <= b);
        if (sec === this.hi.sectionPick) {
          const { x, y } = this._px(q, r);
          this._hexPath(x, y, s * 0.985);
          this.ctx.fillStyle = 'rgba(201,162,39,.16)';
          this.ctx.fill();
        }
      }
    }
  }

  _drawTerrainDeco(terr, x, y, s, q, r, now) {
    const ctx = this.ctx;
    if (terr === 'forest') {
      ctx.fillStyle = '#2f4a2b';
      for (const [dx, dy, k] of [[-0.32, 0.1, 0.8], [0.25, -0.05, 1], [0, 0.32, 0.7]]) {
        const tx = x + dx * s, ty = y + dy * s, ts = s * 0.3 * k;
        ctx.beginPath();
        ctx.moveTo(tx, ty - ts);
        ctx.lineTo(tx + ts * 0.7, ty + ts * 0.6);
        ctx.lineTo(tx - ts * 0.7, ty + ts * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    } else if (terr === 'hill') {
      ctx.strokeStyle = 'rgba(201,162,39,.3)';
      ctx.lineWidth = 1.4;
      for (const k of [0.55, 0.34]) {
        ctx.beginPath();
        ctx.arc(x, y + s * 0.15, s * k, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
    } else if (terr === 'river') {
      ctx.strokeStyle = 'rgba(127,163,215,.35)';
      ctx.lineWidth = 1.2;
      const ph = (now / 900 + (q * 7 + r * 13) % 10) % (Math.PI * 2);
      for (const dy of [-0.25, 0.15]) {
        ctx.beginPath();
        for (let i = -0.6; i <= 0.6; i += 0.1) {
          const wx = x + i * s;
          const wy = y + dy * s + Math.sin(i * 6 + ph) * s * 0.06;
          i === -0.6 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
    } else if (terr === 'ford') {
      ctx.fillStyle = 'rgba(232,217,184,.45)';
      for (const [dx, dy] of [[-0.3, 0.1], [0, -0.12], [0.3, 0.12], [-0.05, 0.3]]) {
        ctx.beginPath();
        ctx.ellipse(x + dx * s, y + dy * s, s * 0.12, s * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawHighlights(now) {
    const ctx = this.ctx;
    const s = this.size;
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    const paint = (keys, fill, stroke) => {
      if (!keys) return;
      for (const k of keys) {
        const { q, r } = H.unkey(k);
        const { x, y } = this._px(q, r);
        this._hexPath(x, y, s * 0.9);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
      }
    };
    paint(this.hi.reachable, 'rgba(201,162,39,.14)', 'rgba(201,162,39,.45)');
    paint(this.hi.hexPick, 'rgba(201,162,39,.2)', 'rgba(201,162,39,.6)');
    if (this.hi.targets) {
      for (const k of this.hi.targets) {
        const { q, r } = H.unkey(k);
        const { x, y } = this._px(q, r);
        this._hexPath(x, y, s * (0.88 + pulse * 0.06));
        ctx.strokeStyle = `rgba(224,85,69,${0.55 + pulse * 0.4})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    // own caltrops marker
    if (this.hi.ownCaltrops) {
      for (const k of this.hi.ownCaltrops) {
        const { q, r } = H.unkey(k);
        const { x, y } = this._px(q, r);
        ctx.strokeStyle = 'rgba(201,162,39,.8)';
        ctx.lineWidth = 1.6;
        for (const a of [0, Math.PI / 3, 2 * Math.PI / 3]) {
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(a) * s * 0.22, y - Math.sin(a) * s * 0.22);
          ctx.lineTo(x + Math.cos(a) * s * 0.22, y + Math.sin(a) * s * 0.22);
          ctx.stroke();
        }
      }
    }
    if (this.hover && (this.hi.reachable || this.hi.targets || this.hi.hexPick)) {
      const { x, y } = this._px(this.hover.q, this.hover.r);
      this._hexPath(x, y, s * 0.9);
      ctx.strokeStyle = 'rgba(232,217,184,.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  _drawUnits(now) {
    const ctx = this.ctx;
    const s = this.size;
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    for (const u of this.view.units) {
      if (u.dead) continue;
      const p = this.pos.get(u.id) || this._px(u.q, u.r);
      const R = s * 0.58;
      const mine = u.side === this.mySide;

      // shadow
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + R * 0.55, R * 0.9, R * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fill();

      // status rings
      if (this.hi.selected === u.id) {
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.32, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(232,217,184,.9)'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      if (this.hi.orderables && this.hi.orderables.has(u.id)) {
        ctx.beginPath(); ctx.arc(p.x, p.y, R * (1.28 + pulse * 0.1), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(201,162,39,${0.5 + pulse * 0.4})`; ctx.lineWidth = 2; ctx.stroke();
      }
      if (this.hi.ordered && this.hi.ordered.has(u.id)) {
        ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.22, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(201,162,39,.85)'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      if (this.hi.healables && this.hi.healables.has(u.id)) {
        ctx.beginPath(); ctx.arc(p.x, p.y, R * (1.3 + pulse * 0.12), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(127,176,105,${0.6 + pulse * 0.4})`; ctx.lineWidth = 2.5; ctx.stroke();
      }

      // token
      const grad = ctx.createRadialGradient(p.x - R * 0.35, p.y - R * 0.4, R * 0.2, p.x, p.y, R);
      const base = SIDE_COLOR[u.side];
      grad.addColorStop(0, shade(base, 30));
      grad.addColorStop(1, shade(base, -25));
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();
      ctx.lineWidth = u.steadfast ? 3.2 : 1.8;
      ctx.strokeStyle = u.steadfast ? '#e8d9b8' : SIDE_EDGE[u.side];
      ctx.stroke();

      // exhausted dim
      const spent = this.view.turn === u.side && u.ordered && u.moved && u.attacked;
      if (spent) {
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
      }

      this._drawGlyph(u, p, R);

      // block pips
      const n = u.maxBlocks;
      const bw = R * 0.42;
      const total = n * bw + (n - 1) * 2;
      for (let i = 0; i < n; i++) {
        const bx = p.x - total / 2 + i * (bw + 2);
        const by = p.y + R * 1.12;
        ctx.fillStyle = i < u.blocks ? '#e8d9b8' : 'rgba(232,217,184,.18)';
        ctx.fillRect(bx, by, bw, s * 0.14);
      }
    }
  }

  _drawGlyph(u, p, R) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#f4ead2';
    ctx.fillStyle = '#f4ead2';
    ctx.lineWidth = Math.max(1.6, R * 0.14);
    ctx.lineCap = 'round';
    const s = R * 0.55;
    if (u.type === 'infantry') {
      // shield + gladius
      ctx.beginPath();
      ctx.moveTo(p.x - s * 0.55, p.y - s * 0.8);
      ctx.quadraticCurveTo(p.x - s * 0.75, p.y + s * 0.3, p.x, p.y + s * 0.9);
      ctx.quadraticCurveTo(p.x + s * 0.75, p.y + s * 0.3, p.x + s * 0.55, p.y - s * 0.8);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s * 0.55); ctx.lineTo(p.x, p.y + s * 0.55);
      ctx.moveTo(p.x - s * 0.3, p.y - s * 0.15); ctx.lineTo(p.x + s * 0.3, p.y - s * 0.15);
      ctx.stroke();
    } else if (u.type === 'cavalry') {
      // horse-head silhouette (simple)
      ctx.beginPath();
      ctx.moveTo(p.x - s * 0.6, p.y + s * 0.8);
      ctx.lineTo(p.x - s * 0.1, p.y - s * 0.1);
      ctx.lineTo(p.x - s * 0.25, p.y - s * 0.7);
      ctx.lineTo(p.x + s * 0.35, p.y - s * 0.25);
      ctx.lineTo(p.x + s * 0.65, p.y + s * 0.15);
      ctx.lineTo(p.x + s * 0.25, p.y + s * 0.25);
      ctx.lineTo(p.x + s * 0.35, p.y + s * 0.8);
      ctx.stroke();
    } else if (u.type === 'skirmisher') {
      // bow + arrow
      ctx.beginPath();
      ctx.arc(p.x - s * 0.1, p.y, s * 0.85, -Math.PI / 2.6, Math.PI / 2.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - s * 0.55, p.y); ctx.lineTo(p.x + s * 0.75, p.y);
      ctx.moveTo(p.x + s * 0.75, p.y); ctx.lineTo(p.x + s * 0.4, p.y - s * 0.22);
      ctx.moveTo(p.x + s * 0.75, p.y); ctx.lineTo(p.x + s * 0.4, p.y + s * 0.22);
      ctx.stroke();
    } else if (u.type === 'general') {
      // laurel + star
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 0.8, Math.PI * 0.15, Math.PI * 0.85, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 0.8, Math.PI * 1.15, Math.PI * 1.85, false);
      ctx.stroke();
      // star
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * (Math.PI * 4 / 5);
        const x = p.x + Math.cos(a) * s * 0.45, y = p.y + Math.sin(a) * s * 0.45;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawEffects(now) {
    const ctx = this.ctx;
    for (const fx of this.effects) {
      const t = (now - fx.start) / fx.dur;
      if (t >= 1) continue;
      if (fx.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(fx.p.x, fx.p.y, this.size * (0.4 + t * 0.8), 0, Math.PI * 2);
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'float') {
        ctx.font = `700 ${Math.max(14, this.size * 0.55)}px "Iowan Old Style", Palatino, Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = fx.color;
        ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        ctx.fillText(fx.text, fx.p.x, fx.p.y - this.size * (0.6 + t * 1.1));
        ctx.globalAlpha = 1;
      }
    }
  }

  _stepAnims(now) {
    for (const a of [...this.anims]) {
      const t = Math.min(1, (now - a.start) / a.dur);
      const segs = a.pts.length - 1;
      const seg = Math.min(segs - 1e-9, t * segs);
      const i = Math.floor(seg);
      const frac = ease(seg - i);
      const cur = {
        x: a.pts[i].x + (a.pts[i + 1].x - a.pts[i].x) * frac,
        y: a.pts[i].y + (a.pts[i + 1].y - a.pts[i].y) * frac,
      };
      this.pos.set(a.unitId, t >= 1 ? { ...a.pts[segs] } : cur);
      if (t >= 1) {
        this.anims.splice(this.anims.indexOf(a), 1);
        a.done();
      }
    }
  }
}

function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}
