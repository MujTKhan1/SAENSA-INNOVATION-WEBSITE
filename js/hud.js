// Holographic tablet interface, drawn to a 2D canvas in screen-UV space and uploaded as a texture.
// Two families of elements: screen chrome (panels, gauges) and AR markers locked to world anchors.
import * as THREE from 'three';

const CY = (a) => `rgba(150,232,255,${a})`;
const OR = (a) => `rgba(255,140,82,${a})`;
const WH = (a) => `rgba(236,246,255,${a})`;
const PANEL = (a) => `rgba(6,18,30,${a})`;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function signal(kind, x) {
  switch (kind) {
    case 0: return 0.5 + 0.18 * Math.sin(x * 0.9) + 0.06 * Math.sin(x * 3.7) + (hash(Math.floor(x * 3)) - 0.5) * 0.06;
    case 1: return 0.6 + 0.12 * Math.sin(x * 0.5 + 1) + 0.1 * Math.sin(x * 2.3) + (hash(Math.floor(x * 4) + 9) - 0.5) * 0.08;
    case 2: return 0.35 + 0.08 * Math.sin(x * 1.3) + 0.25 * Math.max(0, Math.sin(x * 0.35)) ** 6 + (hash(Math.floor(x * 5) + 3) - 0.5) * 0.05;
    default: return 0.45 + 0.2 * Math.sin(x * 0.7 + 2) * Math.sin(x * 0.21) + (hash(Math.floor(x * 4) + 17) - 0.5) * 0.07;
  }
}

export class HUD {
  constructor(portrait) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.setOrientation(portrait);
  }

  setOrientation(portrait) {
    this.portrait = portrait;
    this.canvas.width = portrait ? 1000 : 1600;
    this.canvas.height = portrait ? 1600 : 1000;
    this.texture.dispose();
    this.texture.needsUpdate = true;
  }

  font(size, weight = 500) {
    this.ctx.font = `${weight} ${size}px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
  }

  text(str, x, y, size, color, align = 'left', weight = 500, spacing = 0.08) {
    const c = this.ctx;
    this.font(size, weight);
    c.fillStyle = color;
    c.textAlign = align;
    if ('letterSpacing' in c) c.letterSpacing = `${spacing * size}px`;
    c.fillText(str, x, y);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
  }

  glowStroke(color, width, draw, glowA = 0.18) {
    const c = this.ctx;
    c.lineCap = 'round';
    c.strokeStyle = color(glowA);
    c.lineWidth = width * 5;
    c.beginPath(); draw(); c.stroke();
    c.strokeStyle = color(0.95);
    c.lineWidth = width;
    c.beginPath(); draw(); c.stroke();
  }

  brackets(x, y, w, h, s, a, color = CY) {
    const c = this.ctx;
    c.strokeStyle = color(0.9 * a);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, y + s); c.lineTo(x, y); c.lineTo(x + s, y);
    c.moveTo(x + w - s, y); c.lineTo(x + w, y); c.lineTo(x + w, y + s);
    c.moveTo(x + w, y + h - s); c.lineTo(x + w, y + h); c.lineTo(x + w - s, y + h);
    c.moveTo(x + s, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - s);
    c.stroke();
  }

  panel(x, y, w, h, a, title, color = CY, fill = 0.55) {
    const c = this.ctx;
    const cut = 18;
    c.save();
    c.globalAlpha = a;
    c.beginPath();
    c.moveTo(x + cut, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h - cut); c.lineTo(x + w - cut, y + h); c.lineTo(x, y + h); c.lineTo(x, y + cut); c.closePath();
    c.fillStyle = PANEL(fill);
    c.fill();
    c.strokeStyle = color(0.35);
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = color(0.9);
    c.fillRect(x + cut + 6, y - 1.5, 46, 3);
    if (title) {
      this.text(title, x + 22, y + 34, 15, color(0.85), 'left', 600, 0.18);
      c.fillStyle = color(0.18);
      c.fillRect(x + 22, y + 48, w - 44, 1);
    }
    c.restore();
  }

  sparkline(x, y, w, h, kind, t, color, a) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    const N = 64;
    const pts = [];
    for (let i = 0; i <= N; i++) pts.push([x + (i / N) * w, y + h - signal(kind, i * 0.18 + t * 1.2) * h]);
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath();
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, color(0.28)); g.addColorStop(1, color(0));
    c.fillStyle = g;
    c.fill();
    this.glowStroke(color, 2, () => pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))), 0.12);
    const [lx, ly] = pts[pts.length - 1];
    c.fillStyle = WH(1);
    c.beginPath(); c.arc(lx, ly, 3.5, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  ring(cx, cy, r, value, t, a, color = CY) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = color(0.15); c.lineWidth = 10;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    const start = -Math.PI / 2;
    this.glowStroke(color, 8, () => c.arc(cx, cy, r, start, start + Math.PI * 2 * value), 0.12);
    c.strokeStyle = color(0.5); c.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2;
      const l = i % 5 === 0 ? 10 : 5;
      c.beginPath();
      c.moveTo(cx + Math.cos(ang) * (r + 14), cy + Math.sin(ang) * (r + 14));
      c.lineTo(cx + Math.cos(ang) * (r + 14 + l), cy + Math.sin(ang) * (r + 14 + l));
      c.stroke();
    }
    c.strokeStyle = color(0.6); c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, r - 18, t * 0.8, t * 0.8 + 1.2); c.stroke();
    c.beginPath(); c.arc(cx, cy, r - 18, t * 0.8 + Math.PI, t * 0.8 + Math.PI + 1.2); c.stroke();
    c.restore();
  }

  reticle(x, y, r, t, a, color = CY, label, sub, side = 1, lift = -70) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    const k = 0.6 + 0.4 * ease(a);
    r *= k;
    c.strokeStyle = color(0.85); c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const s = t * 0.9 + (i * Math.PI) / 2;
      c.beginPath(); c.arc(x, y, r, s, s + 0.9); c.stroke();
    }
    c.strokeStyle = color(0.45); c.lineWidth = 1.2;
    c.setLineDash([3, 6]);
    c.beginPath(); c.arc(x, y, r * 1.35, -t * 0.5, -t * 0.5 + Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.fillStyle = color(1);
    c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
    const pr = r * 1.4 * (0.5 + ((t * 0.6) % 1));
    c.strokeStyle = color(0.5 * (1 - ((t * 0.6) % 1)));
    c.beginPath(); c.arc(x, y, pr, 0, Math.PI * 2); c.stroke();
    if (label) {
      const ex = x + side * (r + 60), ey = y + lift;
      const lx = ex + side * 210;
      c.strokeStyle = color(0.8); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x + side * r * 0.72, y - r * 0.72 * Math.sign(-lift || 1)); c.lineTo(ex, ey); c.lineTo(lx, ey); c.stroke();
      const tx = side > 0 ? ex + 8 : lx + 8;
      this.text(label, tx, ey - 12, 17, color(1), 'left', 600, 0.12);
      if (sub) this.text(sub, tx, ey + 24, 14, WH(0.8), 'left', 400, 0.08);
    }
    c.restore();
  }

  // ---- main draw ----
  draw(s) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    if (s.hero > 0.001) this.drawHero(s, W, H, s.hero);
    for (let i = 0; i < 4; i++) if (s.steps[i] > 0.001) this[`drawStep${i}`](s, W, H, s.steps[i]);
    if (s.hero > 0.001 || s.stepsAny > 0.001) this.drawFrame(s, W, H, Math.max(s.hero, s.stepsAny));
    this.texture.needsUpdate = true;
  }

  drawFrame(s, W, H, a) {
    const c = this.ctx;
    const b = s.boot;
    const t = s.time;
    const r0 = ease((b - 0.0) / 0.25) * a;
    this.brackets(26, 26, W - 52, H - 52, 46, r0);
    this.text('◆ SAENSA', 56, 64, 18, CY(r0), 'left', 700, 0.24);
    this.text('PREDICTIVE QUALITY', 186, 64, 15, WH(0.65 * r0), 'left', 500, 0.2);
    const clock = new Date(Date.UTC(2026, 9, 30, 6, 42, 0) + t * 1000).toISOString().substr(11, 8);
    const right = this.portrait ? `LIVE  ${clock}` : `FIELD 04 · CRATE B-117 · ${clock}`;
    this.text(right, W - 56, 64, 15, WH(0.75 * r0), 'right', 500, 0.14);
    c.fillStyle = OR(r0 * (0.5 + 0.5 * Math.sin(t * 4)));
    c.beginPath(); c.arc(W - 56 - c.measureText(right).width - 22, 59, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = CY(0.25 * r0);
    c.fillRect(56, 84, (W - 112) * r0, 1);
    for (let i = 0; i <= 40; i++) c.fillRect(56 + ((W - 112) * i) / 40, 84, 1, i % 5 ? 4 : 9);
    // boot scan sweep
    if (b < 1) {
      const y = ease(b) * H;
      const g = c.createLinearGradient(0, y - 120, 0, y);
      g.addColorStop(0, CY(0)); g.addColorStop(1, CY(0.07 * a));
      c.fillStyle = g; c.fillRect(0, y - 120, W, 120);
      c.fillStyle = CY(0.7 * a); c.fillRect(0, y, W, 1.5);
    }
  }

  drawHero(s, W, H, a) {
    const c = this.ctx;
    const t = s.time, b = s.boot, P = this.portrait;
    const el = (d) => ease((b - d) / 0.22) * a * (b - d < 0.22 ? 0.65 + 0.35 * hash(Math.floor(t * 24) + d * 100) : 1);

    // AR markers
    const A = s.anchors;
    const inside = (p) => p && p.vis && p.x > 0.04 && p.x < 0.96 && p.y > 0.08 && p.y < 0.94;
    if (inside(A.crate)) this.reticle(A.crate.x * W, A.crate.y * H, 74, t, el(0.25), CY, 'CRATE B-117 · 28 UNITS', 'Freshness index 94 · stable', P ? -1 : -1, -110);
    if (inside(A.risk)) this.reticle(A.risk.x * W, A.risk.y * H, 26, t * 1.4, el(0.38), OR, 'UNIT 17 · RIPENING ↑', 'Inspect within 24 h', 1, -150);
    if (inside(A.sensor)) this.reticle(A.sensor.x * W, A.sensor.y * H, 20, t * 2, el(0.32), CY, 'S-NODE 3A', `${(12.4 + Math.sin(t * 0.7) * 0.1).toFixed(1)}°C · 88% RH`, 1, 70);
    if (inside(A.row)) this.reticle(A.row.x * W, A.row.y * H, 30, t, el(0.45), CY, 'ROW 12 · C₂H₄', `${(0.42 + Math.sin(t * 0.5) * 0.02).toFixed(2)} ppm · rising`, 1, -60);

    // Sensor signals panel
    const sig = [
      ['TEMP', `${(12.4 + Math.sin(t * 0.7) * 0.15).toFixed(1)}°C`, 0, CY],
      ['HUMIDITY', `${Math.round(88 + Math.sin(t * 0.4) * 1.5)}%`, 1, CY],
      ['ETHYLENE', `${(0.42 + Math.sin(t * 0.5) * 0.02).toFixed(2)} ppm`, 2, OR],
      ['CO₂', `${Math.round(612 + Math.sin(t * 0.3) * 9)} ppm`, 3, CY],
    ];
    const sa = el(0.3);
    if (!P) {
      const x = 56, y = 116, w = 340, h = 420;
      this.panel(x, y, w, h, sa, 'SENSOR SIGNALS');
      sig.forEach(([lab, val, k, col], i) => {
        const ry = y + 72 + i * 86;
        const ra = el(0.34 + i * 0.05);
        this.text(lab, x + 22, ry + 6, 13, WH(0.6 * ra), 'left', 500, 0.16);
        this.text(val, x + w - 22, ry + 8, 22, col(ra), 'right', 600, 0.02);
        this.sparkline(x + 22, ry + 18, w - 44, 46, k, t + i * 4, col, ra);
      });
    } else {
      const x = 56, y = 116, w = W - 112, h = 300;
      this.panel(x, y, w, h, sa, 'SENSOR SIGNALS');
      sig.forEach(([lab, val, k, col], i) => {
        const cx = x + 22 + (i % 2) * ((w - 44) / 2 + 10), cy = y + 76 + Math.floor(i / 2) * 112;
        const cw = (w - 44) / 2 - 10;
        const ra = el(0.34 + i * 0.05);
        this.text(lab, cx, cy + 6, 13, WH(0.6 * ra), 'left', 500, 0.16);
        this.text(val, cx + cw, cy + 8, 22, col(ra), 'right', 600, 0.02);
        this.sparkline(cx, cy + 20, cw, 54, k, t + i * 4, col, ra);
      });
    }

    // Predictive quality panel: freshness gauge
    const ga = el(0.42);
    const gp = P ? { x: 56, y: H - 560, w: (W - 112) / 2 - 10, h: 380 } : { x: W - 56 - 360, y: 116, w: 360, h: 330 };
    this.panel(gp.x, gp.y, gp.w, gp.h, ga, 'FRESHNESS INDEX');
    const gcx = gp.x + gp.w / 2, gcy = gp.y + (P ? 190 : 175);
    this.ring(gcx, gcy, 78, 0.94 * ease((b - 0.42) / 0.4), t, ga);
    this.text(`${Math.round(94 * ease((b - 0.42) / 0.4))}`, gcx, gcy + 16, 52, WH(ga), 'center', 600, 0);
    this.text('/ 100', gcx, gcy + 42, 13, CY(0.7 * ga), 'center', 500, 0.1);
    this.text('SHELF LIFE 6.2 D', gp.x + 22, gp.y + gp.h - 26, 14, WH(0.85 * ga), 'left', 600, 0.12);
    this.text('▲ STABLE', gp.x + gp.w - 22, gp.y + gp.h - 26, 14, CY(ga), 'right', 600, 0.12);

    // Forecast panel
    const fa = el(0.5);
    const fp = P ? { x: W / 2 + 10, y: H - 560, w: (W - 112) / 2 - 10, h: 380 } : { x: W - 56 - 360, y: 470, w: 360, h: 260 };
    this.panel(fp.x, fp.y, fp.w, fp.h, fa, 'DECAY RISK FORECAST');
    this.forecast(fp.x + 22, fp.y + 70, fp.w - 44, fp.h - 130, t, fa, ease((b - 0.5) / 0.4), false);
    this.text('RISK 72H', fp.x + 22, fp.y + fp.h - 24, 13, WH(0.65 * fa), 'left', 500, 0.14);
    this.text('8% · LOW', fp.x + fp.w - 22, fp.y + fp.h - 22, 18, CY(fa), 'right', 600, 0.06);

    // Supply chain timeline
    const ta = el(0.58);
    const ty = H - 92;
    const tx0 = P ? 90 : W * 0.3, tx1 = P ? W - 90 : W * 0.7;
    const stages = ['HARVEST', 'PACK', 'TRANSIT', 'DC', 'RETAIL'];
    c.save();
    c.globalAlpha = ta;
    c.fillStyle = CY(0.25); c.fillRect(tx0, ty, tx1 - tx0, 2);
    const prog = 0.5 + 0.02 * Math.sin(t * 0.4);
    c.fillStyle = CY(0.95); c.fillRect(tx0, ty, (tx1 - tx0) * prog * ease((b - 0.58) / 0.35), 2);
    stages.forEach((st, i) => {
      const x = tx0 + ((tx1 - tx0) * i) / 4;
      const done = i / 4 <= prog;
      c.fillStyle = done ? CY(1) : PANEL(1);
      c.strokeStyle = CY(0.9); c.lineWidth = 2;
      c.beginPath(); c.arc(x, ty + 1, i === 2 ? 8 : 6, 0, Math.PI * 2); c.fill(); c.stroke();
      this.text(st, x, ty + 32, 12, (i === 2 ? OR : WH)(i === 2 ? 1 : 0.7), 'center', 600, 0.16);
    });
    this.text('ETA RETAIL 31 H', tx0 + (tx1 - tx0) * prog, ty - 18, 13, OR(0.95), 'center', 600, 0.12);
    c.restore();

    // SNN spike raster (landscape only)
    if (!P) {
      const ra = el(0.62);
      const x = 56, y = H - 250, w = 340, h = 150;
      this.panel(x, y, w, h, ra, 'SNN · EVENT STREAM');
      this.raster(x + 22, y + 64, w - 44, h - 84, t, ra, 10);
    }

    // Center crosshair
    c.save();
    c.globalAlpha = el(0.2) * 0.6;
    c.strokeStyle = CY(0.6); c.lineWidth = 1;
    const mx = W / 2, my = H / 2;
    c.beginPath();
    c.moveTo(mx - 26, my); c.lineTo(mx - 8, my); c.moveTo(mx + 8, my); c.lineTo(mx + 26, my);
    c.moveTo(mx, my - 26); c.lineTo(mx, my - 8); c.moveTo(mx, my + 8); c.lineTo(mx, my + 26);
    c.stroke();
    c.restore();
  }

  forecast(x, y, w, h, t, a, grow, big) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    const days = 10, now = 3.2;
    const q = (d) => 0.97 - 0.012 * d - 0.42 * Math.max(0, (d - 3.8) / 6.2) ** 2 * 1.4;
    let cross = now;
    while (q(cross) > 0.7 && cross < days) cross += 0.02;
    const X = (d) => x + (d / days) * w, Y = (v) => y + h - ((v - 0.3) / 0.75) * h;
    c.strokeStyle = CY(0.1); c.lineWidth = 1;
    for (let i = 0; i <= 5; i++) { c.beginPath(); c.moveTo(x, y + (h * i) / 5); c.lineTo(x + w, y + (h * i) / 5); c.stroke(); }
    const thr = 0.7;
    c.setLineDash([6, 6]);
    c.strokeStyle = OR(0.8); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x, Y(thr)); c.lineTo(x + w, Y(thr)); c.stroke();
    c.setLineDash([]);
    this.text('QUALITY THRESHOLD', x + w, Y(thr) - 8, big ? 14 : 11, OR(0.85), 'right', 500, 0.12);
    const end = days * grow;
    c.save();
    c.beginPath(); c.rect(x - 4, y - 4, w + 8, h + 8); c.clip();
    // confidence band
    c.beginPath();
    for (let d = now; d <= Math.max(now, end); d += 0.1) c.lineTo(X(d), Y(q(d) + 0.015 + (d - now) * 0.012));
    for (let d = Math.max(now, end); d >= now; d -= 0.1) c.lineTo(X(d), Y(q(d) - 0.015 - (d - now) * 0.014));
    c.closePath();
    c.fillStyle = CY(0.09); c.fill();
    // history
    this.glowStroke(CY, big ? 3 : 2.2, () => { for (let d = 0; d <= Math.min(now, end); d += 0.05) c.lineTo(X(d), Y(q(d) + (hash(Math.floor(d * 12)) - 0.5) * 0.012)); }, 0.12);
    // forecast dashed
    c.setLineDash([8, 7]);
    c.lineDashOffset = -t * 20;
    this.glowStroke(CY, big ? 3 : 2.2, () => { for (let d = now; d <= Math.max(now, end); d += 0.05) c.lineTo(X(d), Y(q(d))); }, 0.08);
    c.setLineDash([]);
    c.restore();
    // now marker
    c.fillStyle = WH(0.9); c.fillRect(X(now), y, 1.5, h);
    this.text('NOW', X(now) + 6, y + 14, big ? 14 : 11, WH(0.8), 'left', 600, 0.14);
    if (end > cross) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      c.fillStyle = OR(1);
      c.beginPath(); c.arc(X(cross), Y(q(cross)), big ? 7 : 5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = OR(0.6 * pulse); c.lineWidth = 2;
      c.beginPath(); c.arc(X(cross), Y(q(cross)), (big ? 16 : 12) + pulse * 6, 0, Math.PI * 2); c.stroke();
      if (big) this.text('DECAY ONSET · T+71 H', X(cross) + 16, Y(q(cross)) + 32, 16, OR(1), 'left', 600, 0.1);
    }
    for (let d = 0; d <= days; d += 2) this.text(`D${d}`, X(d), y + h + (big ? 26 : 18), big ? 13 : 10, WH(0.5), 'center', 500, 0.1);
    c.restore();
  }

  raster(x, y, w, h, t, a, rows) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    const cols = Math.floor(w / 6);
    for (let r = 0; r < rows; r++) {
      const ry = y + (r / rows) * h;
      for (let k = 0; k < cols; k++) {
        const n = Math.floor(k + t * 14);
        const fire = hash(n * 13.7 + r * 91.3) > 0.9 - 0.04 * Math.sin(r + t);
        if (fire) {
          const age = (cols - k) / cols;
          c.fillStyle = (r === 3 ? OR : CY)(0.25 + 0.75 * (1 - age));
          c.fillRect(x + w - (k / cols) * w - ((t * 14) % 1) * 6, ry, 2, h / rows - 3);
        }
      }
    }
    c.restore();
  }

  stepHeader(W, a, num, title, sub) {
    this.text(num, 56, 132, 15, OR(a), 'left', 600, 0.2);
    this.text(title, 56, 172, 30, WH(a), 'left', 600, 0.06);
    this.text(sub, 56, 204, 14, CY(0.75 * a), 'left', 500, 0.12);
  }

  // Step 01 — Sense
  drawStep0(s, W, H, a) {
    const c = this.ctx, t = s.time, P = this.portrait;
    this.stepHeader(W, a, '01 / SENSE', 'Live micro-environment', 'BLE MESH · 2 S SAMPLING · 12 NODES');
    const A = s.anchors.sensor;
    if (A && A.vis) {
      const x = A.x * W, y = A.y * H;
      c.save();
      c.globalAlpha = a;
      for (let i = 0; i < 4; i++) {
        const p = (t * 0.5 + i / 4) % 1;
        c.strokeStyle = OR(0.7 * (1 - p)); c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, 20 + p * 220, 0, Math.PI * 2); c.stroke();
      }
      c.restore();
      this.reticle(x, y, 30, t * 2, a, OR, 'S-NODE 3A · ONLINE', 'Battery 87% · RSSI −61 dBm', P ? -1 : 1, -90);
    }
    const labels = [['TEMPERATURE', '°C', 12.4, 0], ['REL. HUMIDITY', '%', 88, 1], ['ETHYLENE C₂H₄', 'ppm', 0.42, 2], ['CO₂', 'ppm', 612, 3]];
    const px = P ? 56 : W - 56 - 520, py = P ? H - 760 : 250, pw = P ? W - 112 : 520, ph = P ? 640 : 640;
    this.panel(px, py, pw, ph, a, 'RAW SIGNAL STREAMS', CY, 0.72);
    labels.forEach(([lab, unit, v, k], i) => {
      const ry = py + 80 + i * ((ph - 100) / 4);
      const val = v + Math.sin(t * (0.5 + i * 0.2)) * v * 0.01;
      this.text(lab, px + 22, ry + 4, 13, WH(0.65 * a), 'left', 500, 0.16);
      this.text(`${val.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${unit}`, px + pw - 22, ry + 6, 22, (k === 2 ? OR : CY)(a), 'right', 600, 0.02);
      this.sparkline(px + 22, ry + 18, pw - 44, (ph - 100) / 4 - 46, k, t * 1.6 + i * 5, k === 2 ? OR : CY, a);
    });
  }

  // Step 02 — Learn (spiking neural network)
  drawStep1(s, W, H, a) {
    const c = this.ctx, t = s.time, P = this.portrait;
    this.stepHeader(W, a, '02 / LEARN', 'Spiking neural network', 'EVENT-DRIVEN · ON-EDGE · 4 MW');
    const px = 56, py = 250, pw = W - 112, ph = P ? H - 420 : H - 340;
    this.panel(px, py, pw, ph, a, 'RESPIRATION FINGERPRINT · LAYER ACTIVITY', CY, 0.82);
    const layers = P ? [4, 7, 7, 3] : [4, 9, 9, 6, 3];
    const lx = (i) => px + 90 + (i / (layers.length - 1)) * (pw - 180);
    const top = py + 90, bottom = py + ph * (P ? 0.62 : 0.66);
    const ny = (n, j) => top + ((j + 0.5) / n) * (bottom - top);
    c.save();
    c.globalAlpha = a;
    for (let i = 0; i < layers.length - 1; i++) {
      for (let j = 0; j < layers[i]; j++) for (let k = 0; k < layers[i + 1]; k++) {
        const w = hash(i * 100 + j * 10 + k);
        if (w < 0.45) continue;
        c.strokeStyle = CY(0.1 + w * 0.16); c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(lx(i), ny(layers[i], j)); c.lineTo(lx(i + 1), ny(layers[i + 1], k)); c.stroke();
        const ph2 = (t * 0.9 + w * 7) % 1;
        if (w > 0.82) {
          const x = lx(i) + (lx(i + 1) - lx(i)) * ph2, y = ny(layers[i], j) + (ny(layers[i + 1], k) - ny(layers[i], j)) * ph2;
          c.fillStyle = (i === layers.length - 2 ? OR : CY)(0.9);
          c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fill();
        }
      }
    }
    layers.forEach((n, i) => {
      for (let j = 0; j < n; j++) {
        const fire = hash(Math.floor(t * 6) * 7.1 + i * 13 + j) > 0.72;
        const out = i === layers.length - 1;
        c.fillStyle = PANEL(1);
        c.strokeStyle = (out ? OR : CY)(fire ? 1 : 0.5); c.lineWidth = 2;
        c.beginPath(); c.arc(lx(i), ny(n, j), fire ? 9 : 7, 0, Math.PI * 2); c.fill(); c.stroke();
        if (fire) { c.fillStyle = (out ? OR : CY)(0.9); c.beginPath(); c.arc(lx(i), ny(n, j), 4, 0, Math.PI * 2); c.fill(); }
      }
    });
    c.restore();
    const outs = ['RIPENING', 'COLD STRESS', 'MOLD RISK'];
    outs.forEach((o, j) => this.text(o, lx(layers.length - 1) - 18, ny(3, j) + 5, 13, (j === 0 ? OR : WH)(0.85 * a), 'right', 600, 0.12));
    this.raster(px + 22, bottom + 50, pw - 44, py + ph - bottom - 80, t, a, 14);
    this.text('SPIKE RASTER · 14 CHANNELS', px + 22, bottom + 36, 12, WH(0.55 * a), 'left', 500, 0.16);
  }

  // Step 03 — Predict
  drawStep2(s, W, H, a) {
    this.stepHeader(W, a, '03 / PREDICT', 'Shelf-life forecast', 'CONFIDENCE 92% · UPDATED 4 S AGO');
    const P = this.portrait;
    const px = 56, py = 250, pw = W - 112, ph = P ? 760 : H - 360;
    this.panel(px, py, pw, ph, a, 'QUALITY INDEX · CRATE B-117', CY, 0.8);
    this.forecast(px + 40, py + 90, pw - 80, ph - 160, s.time, a, 1, true);
    const A = s.anchors.risk;
    if (P && A && A.vis) this.reticle(A.x * W, A.y * H, 26, s.time, a, OR, 'UNIT 17', 'Decay onset T+71 h', 1, -80);
    if (P) {
      const y = py + ph + 60;
      [['SHELF LIFE', '6.2 days'], ['DECAY RISK 72H', '8%'], ['CONFIDENCE', '92%']].forEach(([k, v], i) => {
        this.text(k, px, y + i * 80, 14, WH(0.6 * a), 'left', 500, 0.16);
        this.text(v, px + pw, y + i * 80 + 4, 30, (i === 1 ? OR : CY)(a), 'right', 600, 0.02);
        this.ctx.fillStyle = CY(0.15 * a); this.ctx.fillRect(px, y + i * 80 + 24, pw, 1);
      });
    }
  }

  // Step 04 — Act
  drawStep3(s, W, H, a) {
    const c = this.ctx, t = s.time, P = this.portrait;
    this.stepHeader(W, a, '04 / ACT', 'Recommended actions', 'AUTO-SYNCED TO ERP · WMS · TMS');
    const actions = [
      ['RE-ROUTE B-117 → DC LYON', 'Arrives 19 h earlier · keeps 2.1 days of shelf life', OR],
      ['SWITCH TO FEFO DISPATCH', 'Ship lots by expiry, not arrival — 6 pallets affected', CY],
      ['QA CHECK · UNIT 17', 'Ripening ahead of batch · inspect within 24 h', CY],
    ];
    const px = 56, py = 250, pw = P ? W - 112 : 640;
    actions.forEach(([title, sub, col], i) => {
      const ia = ease((s.stepLocal[3] - i * 0.12) / 0.3) * a;
      const y = py + i * 128;
      const x = px + (1 - ia) * 40;
      this.panel(x, y, pw, 108, ia, null, col, 0.8);
      c.save(); c.globalAlpha = ia;
      c.strokeStyle = col(1); c.lineWidth = 2.5;
      c.beginPath(); c.arc(x + 46, y + 54, 18, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(x + 37, y + 55); c.lineTo(x + 44, y + 62); c.lineTo(x + 56, y + 47); c.stroke();
      c.restore();
      this.text(title, x + 84, y + 48, 19, col(ia), 'left', 600, 0.08);
      this.text(sub, x + 84, y + 76, 14, WH(0.75 * ia), 'left', 400, 0.02);
    });
    // route map
    const mx = P ? 56 : 56 + 640 + 40, my = P ? py + 3 * 128 + 30 : 250, mw = P ? W - 112 : W - mx - 56, mh = P ? 520 : 362;
    this.panel(mx, my, mw, mh, a, 'ROUTE OPTIMISATION', CY, 0.8);
    const nodes = { farm: [0.14, 0.62], paris: [0.82, 0.3], lyon: [0.7, 0.78] };
    const N = (k) => [mx + nodes[k][0] * mw, my + 40 + nodes[k][1] * (mh - 60)];
    c.save(); c.globalAlpha = a;
    c.setLineDash([5, 8]);
    c.strokeStyle = WH(0.3); c.lineWidth = 2;
    c.beginPath(); c.moveTo(...N('farm')); c.quadraticCurveTo(mx + mw * 0.45, my + mh * 0.2, ...N('paris')); c.stroke();
    c.setLineDash([]);
    this.glowStroke(OR, 3, () => { c.moveTo(...N('farm')); c.quadraticCurveTo(mx + mw * 0.4, my + mh * 0.95, ...N('lyon')); }, 0.15);
    const p = (t * 0.25) % 1;
    const f = N('farm'), l = N('lyon'), cpx = mx + mw * 0.4, cpy = my + mh * 0.95;
    const bx = (1 - p) ** 2 * f[0] + 2 * (1 - p) * p * cpx + p * p * l[0], by = (1 - p) ** 2 * f[1] + 2 * (1 - p) * p * cpy + p * p * l[1];
    c.fillStyle = WH(1); c.beginPath(); c.arc(bx, by, 5, 0, Math.PI * 2); c.fill();
    [['farm', 'FIELD 04', CY], ['paris', 'DC PARIS · 41 H', WH], ['lyon', 'DC LYON · 22 H', OR]].forEach(([k, lab, col]) => {
      const [x, y] = N(k);
      c.fillStyle = PANEL(1); c.strokeStyle = col(1); c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); c.stroke();
      this.text(lab, x, y - 20, 13, col(0.95), 'center', 600, 0.12);
    });
    c.restore();
    const ky = P ? my + mh + 70 : py + 3 * 128 + 50;
    this.text('−35%', px, ky + 30, 54, OR(a), 'left', 600, 0);
    this.text('RETAIL FRESHNESS REJECTIONS', px + (P ? 0 : 190), ky + (P ? 64 : 22), 13, WH(0.7 * a), 'left', 500, 0.16);
    if (!P) this.text('vs. baseline, pilot programmes', px + 190, ky + 44, 13, WH(0.45 * a), 'left', 400, 0.04);
  }
}
