// render.js — all canvas drawing: primitives, shapes, text, and the render loop.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;
  const R = {};

  // ---- Shape outlines ------------------------------------------------------
  R.shapePath = function(ctx, o){
    const { x, y, w, h } = o;
    switch (o.shape){
      case 'ellipse':
        ctx.ellipse(x + w/2, y + h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, Math.PI*2);
        break;
      case 'triangle':
        ctx.moveTo(x + w/2, y); ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h); ctx.closePath();
        break;
      case 'diamond':
        ctx.moveTo(x + w/2, y); ctx.lineTo(x + w, y + h/2);
        ctx.lineTo(x + w/2, y + h); ctx.lineTo(x, y + h/2); ctx.closePath();
        break;
      default: // box — plain rectangle (sharp corners)
        ctx.rect(x, y, w, h);
    }
  };

  // ---- Curves & arrowheads -------------------------------------------------
  R.catmull = function(ctx, pts){
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2){ ctx.lineTo(pts[1].x, pts[1].y); return; }
    for (let i = 0; i < pts.length - 1; i++){
      const p0 = pts[i-1]||pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2]||p2;
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x)/6, p1.y + (p2.y - p0.y)/6,
        p2.x - (p3.x - p1.x)/6, p2.y - (p3.y - p1.y)/6,
        p2.x, p2.y
      );
    }
  };
  R.drawArrowhead = function(ctx, tip, from, col, size, alpha){
    const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    const a = Math.PI/6.2; // slightly wider wings for a bold end
    const notch = size * 0.28; // concave back so it reads as a crisp arrow
    ctx.save();
    ctx.globalAlpha *= (alpha === undefined ? 1 : alpha);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - size*Math.cos(ang - a), tip.y - size*Math.sin(ang - a));
    ctx.lineTo(tip.x - (size - notch)*Math.cos(ang), tip.y - (size - notch)*Math.sin(ang));
    ctx.lineTo(tip.x - size*Math.cos(ang + a), tip.y - size*Math.sin(ang + a));
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
  };

  // ---- Text ----------------------------------------------------------------
  R.shapeFont = (size, weight) => `${weight || 600} ${size}px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif`;

  // Break `text` into lines that fit `maxW` at the current ctx.font. Honors
  // explicit newlines, wraps on spaces, and hard-breaks over-long single words.
  function wrapLines(ctx, text, maxW){
    const paras = String(text == null ? '' : text).split('\n');
    const out = [];
    for (const para of paras){
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length){ out.push(''); continue; }
      let line = '';
      for (let word of words){
        while (ctx.measureText(word).width > maxW && word.length > 1){
          let k = 1;
          while (k < word.length && ctx.measureText(word.slice(0, k + 1)).width <= maxW) k++;
          if (line){ out.push(line); line = ''; }
          out.push(word.slice(0, k));
          word = word.slice(k);
        }
        const test = line ? line + ' ' + word : word;
        if (!line || ctx.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = word; }
      }
      if (line) out.push(line);
    }
    return out.length ? out : [''];
  }

  // Cache layout by shape/size/text so we don't re-wrap every frame.
  const _labelCache = new Map();

  // Largest font size (world units) at which the wrapped `text` fits shape `s`.
  R.fitLabelSize = function(s, text){
    // usable fraction of the box for each shape's interior
    let fw = 0.82, fh = 0.78;
    if (s.shape === 'diamond'){ fw = 0.58; fh = 0.58; }
    else if (s.shape === 'triangle'){ fw = 0.5; fh = 0.5; }
    else if (s.shape === 'ellipse'){ fw = 0.72; fh = 0.76; }
    const maxW = Math.max(6, Math.abs(s.w) * fw);
    const maxH = Math.max(6, Math.abs(s.h) * fh);

    const key = s.shape + '|' + Math.round(maxW) + '|' + Math.round(maxH) + '|' + text;
    const cached = _labelCache.get(key);
    if (cached) return cached;

    const ctx = F.ctx;
    ctx.save();
    let best = null;
    for (let size = 48; size >= 9; size--){
      ctx.font = R.shapeFont(size);
      const lh = size * 1.25;
      const lines = wrapLines(ctx, text, maxW);
      let widest = 0;
      for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width);
      if (widest <= maxW && lines.length * lh <= maxH){ best = { size, lh, lines }; break; }
      if (size === 9) best = { size, lh, lines }; // smallest we allow — accept overflow
    }
    ctx.restore();

    if (_labelCache.size > 400) _labelCache.clear();
    _labelCache.set(key, best);
    return best;
  };

  R.drawLabel = function(ctx, s, text, bg){
    const { size, lh, lines } = R.fitLabelSize(s, text);
    ctx.save();
    ctx.fillStyle = G.readableText(bg);
    ctx.font = R.shapeFont(size);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cx = s.x + s.w/2;
    const startY = s.y + s.h/2 - (lines.length - 1) * lh/2;
    lines.forEach((ln, i) => ctx.fillText(ln, cx, startY + i * lh));
    ctx.restore();
  };

  // Fixed pixel-size badge (does not scale with canvas zoom).
  R.drawNodeBadgePx = function(ctx, x, y, label, alpha, fill){
    const fs = 10;
    ctx.save();
    ctx.globalAlpha = (alpha === undefined ? 1 : alpha);
    ctx.font = '500 ' + fs + 'px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = G.readableText(fill);
    ctx.fillText(label, x + 5, y + 5);
    ctx.restore();
  };

  R.drawNodeBadgesOverlay = function(ctx, cam, nodeLabels){
    const hovered = S.hoveredShape;
    if (!hovered || hovered === S.editingObj) return;
    const nid = nodeLabels.get(hovered.id);
    if (!nid) return;
    const dpr = F.DPR;
    const s = G.normBox(hovered);
    const a = G.easeOutCubic(progress(hovered, 'shape'));
    const sx = s.x * cam.scale + cam.x;
    const sy = s.y * cam.scale + cam.y;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.drawNodeBadgePx(ctx, sx, sy, nid, a, hovered.fill);
    ctx.restore();
  };

  // (o.x, o.y) is the CENTER. Optional o.w/o.h define a resizable box; otherwise auto-fit.
  R.textBounds = function(o){
    if (o.w > 0 && o.h > 0) return { x: o.x - o.w/2, y: o.y - o.h/2, w: o.w, h: o.h };
    const ctx = F.ctx, size = o.size || 18, lh = size * 1.3;
    ctx.save();
    ctx.font = R.shapeFont(size, o.bold ? 800 : 600);
    const lines = String(o.text || ' ').split('\n');
    let w = 0;
    for (const ln of lines) w = Math.max(w, ctx.measureText(ln || ' ').width);
    ctx.restore();
    w += 10; const h = lines.length * lh + 6;
    return { x: o.x - w/2, y: o.y - h/2, w, h };
  };
  R.textBox = R.textBounds;

  // Best font size + wrapped lines that fit inside a text object's box.
  R.fitTextInBox = function(o){
    const maxCap = o.size || 22;
    const maxW = Math.max(16, (o.w || 80) - 10);
    const maxH = Math.max(12, (o.h || 30) - 6);
    const ctx = F.ctx;
    ctx.save();
    let best = { size: 9, lh: 9 * 1.3, lines: [''] };
    for (let size = Math.min(60, maxCap); size >= 9; size--){
      ctx.font = R.shapeFont(size, o.bold ? 800 : 600);
      const lh = size * 1.3;
      const lines = wrapLines(ctx, o.text || ' ', maxW);
      let widest = 0;
      for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width);
      if (widest <= maxW && lines.length * lh <= maxH){ best = { size, lh, lines }; break; }
      if (size === 9) best = { size, lh, lines };
    }
    ctx.restore();
    return best;
  };

  // Minimum box size that contains the text at the current font size.
  R.autoTextBoxSize = function(o){
    const size = o.size || 18, lh = size * 1.3;
    const ctx = F.ctx;
    ctx.save();
    ctx.font = R.shapeFont(size, o.bold ? 800 : 600);
    const lines = wrapLines(ctx, o.text || ' ', 2000);
    let w = 0;
    for (const ln of lines) w = Math.max(w, ctx.measureText(ln || ' ').width);
    ctx.restore();
    return { w: w + 10, h: lines.length * lh + 6 };
  };

  // Sharp border drawn around a text object.
  R.drawTextDecor = function(ctx, o, alpha){
    if (!o.border) return;
    const b = R.textBounds(o), pad = 9;
    const x = b.x - pad, y = b.y - pad, w = b.w + pad*2, h = b.h + pad*2;
    ctx.save();
    ctx.globalAlpha *= (alpha === undefined ? 1 : alpha);
    ctx.beginPath(); ctx.rect(x, y, w, h);
    ctx.lineWidth = 2.5; ctx.strokeStyle = o.color || '#e8edf5'; ctx.stroke();
    ctx.restore();
  };

  R.drawText = function(ctx, o, alpha, dy){
    const { size, lh, lines } = R.fitTextInBox(o);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = o.color || '#e8edf5';
    ctx.font = R.shapeFont(size, o.bold ? 800 : 600);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const startY = o.y - (lines.length - 1) * lh / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, o.x, startY + i * lh + (dy || 0)));
    ctx.restore();
  };

  // Sub-path covering the first `frac` (0..1) of a polyline's length.
  function partialPath(pts, frac){
    if (frac >= 1) return pts;
    const total = G.pathLength(pts) * frac;
    if (total <= 0) return [pts[0], pts[0]];
    let acc = 0; const out = [pts[0]];
    for (let i = 1; i < pts.length; i++){
      const a = pts[i-1], b = pts[i], seg = G.dist(a, b);
      if (acc + seg >= total){ const t = (total - acc) / seg; out.push({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t }); return out; }
      out.push(b); acc += seg;
    }
    return out;
  }
  function pointAtFrac(pts, f){
    const total = G.pathLength(pts) * f; let acc = 0;
    for (let i = 1; i < pts.length; i++){
      const a = pts[i-1], b = pts[i], seg = G.dist(a, b);
      if (acc + seg >= total){ const t = (total - acc) / seg; return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t }; }
      acc += seg;
    }
    return pts[pts.length - 1];
  }
  // Animated dots travelling along the arrow (direction indicator).
  function drawFlowDots(ctx, pts, col, width){
    const len = G.pathLength(pts);
    if (len < 6) return;
    const r = Math.max(4, (width || 3) * 1.9);   // large dots
    const count = Math.max(1, Math.round(len / Math.max(60, r * 4)));
    const phase = (F.now() * 0.00016) % 1;   // moves toward the tip over time
    ctx.save();
    ctx.fillStyle = col;
    for (let i = 0; i < count; i++){
      const f = (i + phase) / count;
      const p = pointAtFrac(pts, f);
      const edge = Math.min(f, 1 - f) * 4;    // fade in/out at the ends
      ctx.globalAlpha = Math.max(0, Math.min(1, edge));
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- Background grid -----------------------------------------------------
  function drawGrid(){
    const ctx = F.ctx, cam = F.cam;
    const gap = 26 * cam.scale;
    if (gap < 8) return;
    const ox = cam.x % gap, oy = cam.y % gap;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid');
    for (let x = ox; x < F.W; x += gap)
      for (let y = oy; y < F.H; y += gap){
        ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI*2); ctx.fill();
      }
  }

  // progress 0..1 for an object's entrance animation
  function progress(o, kind){
    if (o.t0 == null) return 1;
    return Math.min(1, (F.now() - o.t0) / F.ANIM[kind]);
  }

  // ---- Arrow ↔ shape connections ------------------------------------------
  R.pointInShape = function(p, o){
    const s = G.normBox(o), ctx = F.ctx;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); R.shapePath(ctx, s);
    const inside = ctx.isPointInPath(p.x, p.y);
    ctx.restore();
    return inside;
  };
  R.shapeById = id => S.objects.find(o => o.type === 'shape' && o.id === id);
  function centerOf(o){ const s = G.normBox(o); return { x: s.x + s.w/2, y: s.y + s.h/2 }; }

  // Point on a shape's outline toward `toward`, pushed out by `margin`.
  function anchorOnShape(shape, toward, margin){
    const c = centerOf(shape), s = G.normBox(shape);
    let dx = toward.x - c.x, dy = toward.y - c.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    let lo = 0, hi = Math.hypot(s.w, s.h);
    for (let i = 0; i < 18; i++){
      const mid = (lo + hi) / 2;
      if (R.pointInShape({ x: c.x + dx*mid, y: c.y + dy*mid }, shape)) lo = mid; else hi = mid;
    }
    const r = lo + margin;
    return { x: c.x + dx*r, y: c.y + dy*r };
  }

  // Point on a group's rounded-rect envelope toward `toward`.
  function anchorOnGroup(group, toward, margin){
    const s = G.normBox(group);
    const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    let dx = toward.x - c.x, dy = toward.y - c.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const halfW = s.w / 2, halfH = s.h / 2;
    const scale = Math.min(
      Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity
    );
    return { x: c.x + dx * (scale + margin), y: c.y + dy * (scale + margin) };
  }

  function anchorOnTarget(target, toward, margin){
    if (target.type === 'group') return anchorOnGroup(target, toward, margin);
    return anchorOnShape(target, toward, margin);
  }

  // Nearest shape whose edge is within `snap` of a point.
  R.bindShapeForPoint = function(pt, snap){
    let best = null, bestD = Infinity;
    for (const o of S.objects){
      if (o.type !== 'shape') continue;
      const s = G.normBox(o);
      const dx = Math.max(s.x - pt.x, 0, pt.x - (s.x + s.w));
      const dy = Math.max(s.y - pt.y, 0, pt.y - (s.y + s.h));
      const d = Math.hypot(dx, dy);
      if (d <= snap && d < bestD){ bestD = d; best = o; }
    }
    return best;
  };

  // Attach a freshly finished arrow to shapes near its ends.
  F.bindArrow = function(arrow){
    const from = R.bindShapeForPoint(arrow.pts[0], F.CONNECT_SNAP);
    const to = R.bindShapeForPoint(arrow.pts[arrow.pts.length - 1], F.CONNECT_SNAP);
    if (from) arrow.from = from.id;
    if (to && to !== from) arrow.to = to.id;
  };

  // Latch any still-free arrow ends onto nearby shapes (e.g. after a new
  // shape is added or moved next to a dangling arrow end).
  F.reconnectArrows = function(){
    for (const o of S.objects){
      if (o.type !== 'arrow') continue;
      const n = o.pts.length;
      if (o.from == null){
        const sh = R.bindShapeForPoint(o.pts[0], F.CONNECT_SNAP);
        if (sh && sh.id !== o.to) o.from = sh.id;
      }
      if (o.to == null){
        const sh = R.bindShapeForPoint(o.pts[n - 1], F.CONNECT_SNAP);
        if (sh && sh.id !== o.from) o.to = sh.id;
      }
    }
    if (F.syncAllWorkflows) F.syncAllWorkflows();
  };

  // Endpoints adjusted so a bound arrow attaches at the closest facing edges,
  // keeping a generous padding between the arrow end and each shape.
  R.routeArrow = function(o){
    if (o.from == null && o.to == null) return o.pts;
    const pts = o.pts.map(p => ({ ...p }));
    const n = pts.length;
    const fromShape = o.from != null ? R.shapeById(o.from) : null;
    const toShape = o.to != null ? R.shapeById(o.to) : null;
    const fromTarget = fromShape ? F.arrowTargetForShape(fromShape, toShape) : null;
    const toTarget = toShape ? F.arrowTargetForShape(toShape, fromShape) : null;
    const m = F.CONNECT_MARGIN;

    let p0 = fromTarget ? centerOf(fromTarget) : pts[0];
    let p1 = toTarget   ? centerOf(toTarget)   : pts[n - 1];
    for (let i = 0; i < 4; i++){
      if (fromTarget) p0 = anchorOnTarget(fromTarget, p1, m);
      if (toTarget)   p1 = anchorOnTarget(toTarget, p0, m);
    }
    if (fromTarget) pts[0] = p0;
    if (toTarget)   pts[n - 1] = p1;
    return pts;
  };

  const ENTRY_ORANGE = '#ff8800';
  const ENTRY_PAD = 12;
  const ENTRY_TAB_H = 44;
  const ENTRY_BORDER = 4;

  function entryBorderWorld(sc){
    const borderPx = Math.max(ENTRY_BORDER, ENTRY_BORDER * sc);
    return borderPx / sc;
  }

  function entryFrameWorld(entry, sc){
    sc = sc || 1;
    const s = G.normBox(entry);
    const b = entryBorderWorld(sc);
    const x0 = s.x - ENTRY_PAD;
    const x1 = s.x + s.w + ENTRY_PAD;
    const ySplit = s.y - ENTRY_PAD;
    const y0 = ySplit - ENTRY_TAB_H;
    const y1 = s.y + s.h + ENTRY_PAD;
    const tabH = ySplit - y0;
    return {
      x0, x1, y0, ySplit, y1, border: b,
      tabBox: {
        shape: 'box',
        x: x0 + b,
        y: y0 + b,
        w: Math.max(6, x1 - x0 - b * 2),
        h: Math.max(6, tabH - b)
      }
    };
  }

  // Tab fill + label in world space (same text sizing as shape labels).
  R.drawEntryPointWorld = function(ctx){
    const sc = F.cam.scale;
    const drawn = new Set();
    for (const o of S.objects){
      if (o.type !== 'workflow' || !o.entryShapeId || drawn.has(o.entryShapeId)) continue;
      const entry = R.shapeById(o.entryShapeId);
      if (!entry || entry === S.editingObj) continue;
      drawn.add(o.entryShapeId);
      const f = entryFrameWorld(entry, sc);
      ctx.save();
      ctx.fillStyle = 'rgba(255, 136, 0, 0.14)';
      ctx.fillRect(f.tabBox.x, f.tabBox.y, f.tabBox.w, f.tabBox.h);
      const { size, lh, lines } = R.fitLabelSize(f.tabBox, 'Entry point');
      ctx.fillStyle = ENTRY_ORANGE;
      ctx.font = R.shapeFont(size, 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = f.tabBox.x + f.tabBox.w / 2;
      const startY = f.tabBox.y + f.tabBox.h / 2 - (lines.length - 1) * lh / 2;
      lines.forEach((ln, i) => ctx.fillText(ln, cx, startY + i * lh));
      ctx.restore();
    }
  };

  // Screen-space orange rails — drawn last so nothing covers them.
  R.drawEntryPointsOverlay = function(ctx, cam, dpr){
    const sc = cam.scale;
    const drawn = new Set();
    for (const o of S.objects){
      if (o.type !== 'workflow' || !o.entryShapeId || drawn.has(o.entryShapeId)) continue;
      const entry = R.shapeById(o.entryShapeId);
      if (!entry || entry === S.editingObj) continue;
      drawn.add(o.entryShapeId);

      const f = entryFrameWorld(entry, sc);
      const border = Math.max(ENTRY_BORDER, ENTRY_BORDER * sc);
      const x0 = f.x0 * sc + cam.x;
      const x1 = f.x1 * sc + cam.x;
      const y0 = f.y0 * sc + cam.y;
      const ySplit = f.ySplit * sc + cam.y;
      const y1 = f.y1 * sc + cam.y;
      const frameW = x1 - x0;
      const frameH = y1 - y0;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      ctx.fillStyle = ENTRY_ORANGE;
      ctx.fillRect(x0, y0, border, frameH);
      ctx.fillRect(x1 - border, y0, border, frameH);
      ctx.fillRect(x0, y1 - border, frameW, border);
      ctx.fillRect(x0, y0, frameW, border);

      ctx.restore();
    }
  };

  // ---- Main render loop ----------------------------------------------------
  R.render = function render(){
    const ctx = F.ctx, cam = F.cam, DPR = F.DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, F.W, F.H);
    drawGrid();

    ctx.save();
    ctx.setTransform(DPR*cam.scale, 0, 0, DPR*cam.scale, DPR*cam.x, DPR*cam.y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const nodeLabels = F.nodeLabelMap();

    for (const o of S.objects){
      if (o.type === 'workflow'){
        const s = G.normBox(o);
        const p = G.easeOutCubic(progress(o, 'shape'));
        const col = o.color || '#8b97a8';
        const tab = F.workflowTabMetrics(o, cam.scale);
        const rad = 4 / cam.scale;
        ctx.save();
        ctx.globalAlpha = p * 0.85;
        ctx.fillStyle = G.hexToRgba(col, 0.06);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8 / cam.scale, 6 / cam.scale]);
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        ctx.setLineDash([]);
        ctx.fillStyle = G.hexToRgba(col, 0.22);
        ctx.beginPath();
        ctx.moveTo(tab.x + rad, tab.y);
        ctx.lineTo(tab.x + tab.w - rad, tab.y);
        ctx.quadraticCurveTo(tab.x + tab.w, tab.y, tab.x + tab.w, tab.y + rad);
        ctx.lineTo(tab.x + tab.w, tab.y + tab.h);
        ctx.lineTo(tab.x, tab.y + tab.h);
        ctx.lineTo(tab.x, tab.y + rad);
        ctx.quadraticCurveTo(tab.x, tab.y, tab.x + rad, tab.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.25 / cam.scale;
        ctx.stroke();
        ctx.font = '600 ' + tab.fontSize + 'px system-ui, sans-serif';
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tab.label, tab.x + tab.w / 2, tab.y + tab.h / 2);
        ctx.restore();

      } else if (o.type === 'panel'){
        const s = G.normBox(o);
        const p = G.easeOutCubic(progress(o, 'shape'));
        ctx.save();
        ctx.globalAlpha = p;
        ctx.fillStyle = o.color || '#6ea8ff';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.restore();

      } else if (o.type === 'group'){
        const s = G.normBox(o);
        const p = G.easeOutCubic(progress(o, 'shape'));
        const col = o.color || '#6ea8ff';
        ctx.save();
        ctx.globalAlpha = p;
        ctx.fillStyle = G.hexToRgba(col, 0.12);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        const rad = 10;
        ctx.beginPath();
        ctx.moveTo(s.x + rad, s.y);
        ctx.lineTo(s.x + s.w - rad, s.y);
        ctx.quadraticCurveTo(s.x + s.w, s.y, s.x + s.w, s.y + rad);
        ctx.lineTo(s.x + s.w, s.y + s.h - rad);
        ctx.quadraticCurveTo(s.x + s.w, s.y + s.h, s.x + s.w - rad, s.y + s.h);
        ctx.lineTo(s.x + rad, s.y + s.h);
        ctx.quadraticCurveTo(s.x, s.y + s.h, s.x, s.y + s.h - rad);
        ctx.lineTo(s.x, s.y + rad);
        ctx.quadraticCurveTo(s.x, s.y, s.x + rad, s.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = p * 0.9;
        ctx.stroke();
        if (o.label){
          ctx.font = '600 ' + (13 / cam.scale) + 'px system-ui, sans-serif';
          ctx.fillStyle = col;
          ctx.globalAlpha = p;
          ctx.textBaseline = 'top';
          ctx.fillText(o.label, s.x + 8 / cam.scale, s.y + 6 / cam.scale);
        }
        ctx.restore();

      } else if (o.type === 'shape'){
        const s = G.normBox(o);
        const p = G.easeOutCubic(progress(o, 'shape'));
        ctx.save();
        ctx.globalAlpha = p; // simple fade in — no scaling / bounce
        ctx.beginPath(); R.shapePath(ctx, s);
        ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
        ctx.fillStyle = o.fill || 'rgba(20,26,35,0.62)';
        ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = o.stroke || '#e8edf5';
        ctx.stroke();
        if (o.text && o !== S.editingObj) R.drawLabel(ctx, s, o.text, o.fill);
        ctx.restore();

      } else if (o.type === 'arrow'){
        const p = G.easeOutQuint(progress(o, 'arrow'));
        const w = o.width || 3;
        const hasHead = o.head !== false;
        ctx.save();
        ctx.lineWidth = w;
        ctx.strokeStyle = o.color || '#e8edf5';
        const rpts = R.routeArrow(o);
        const headSize = 10 + w * 3.4;
        const a = rpts[0], b = rpts[rpts.length - 1];
        const connected = o.from != null && o.to != null;
        // Two connected shapes too close for a proper line: draw only the
        // arrowhead, centered between them and pointing from -> to.
        if (hasHead && connected && G.dist(a, b) < headSize * 1.2){
          const fs = R.shapeById(o.from), ts = R.shapeById(o.to);
          const ft = fs ? F.arrowTargetForShape(fs, ts) : null;
          const tt = ts ? F.arrowTargetForShape(ts, fs) : null;
          let dx = b.x - a.x, dy = b.y - a.y;
          if (ft && tt){ const c0 = centerOf(ft), c1 = centerOf(tt); dx = c1.x - c0.x; dy = c1.y - c0.y; }
          const L = Math.hypot(dx, dy) || 1;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const tip = { x: mid.x + dx / L * headSize / 2, y: mid.y + dy / L * headSize / 2 };
          R.drawArrowhead(ctx, tip, mid, o.color || '#e8edf5', headSize, p);
        } else {
          const tip = b;
          const dir = G.pointBack(rpts, 14);
          // stop the line at the arrowhead base so nothing pokes through the tip
          const full = hasHead ? G.trimEnd(rpts, headSize * 0.82) : rpts;
          const shown = partialPath(full, p);   // draw-on reveal
          if (o.dashed) ctx.setLineDash([w * 3.2, w * 2.6]);
          ctx.beginPath(); R.catmull(ctx, shown); ctx.stroke();
          ctx.setLineDash([]);
          if (hasHead){
            const headAlpha = Math.max(0, Math.min(1, (p - 0.7) / 0.3));
            R.drawArrowhead(ctx, tip, dir, o.color || '#e8edf5', headSize, headAlpha);
          }
          if (o.flow && p >= 1) drawFlowDots(ctx, rpts, o.color || '#e8edf5', w);
        }
        ctx.restore();

      } else if (o.type === 'text'){
        if (o === S.editingObj) continue;
        const p = G.easeOutCubic(progress(o, 'text'));
        R.drawTextDecor(ctx, o, p);
        R.drawText(ctx, o, p, (1 - p) * 6);
      }

      // selection highlight (hidden while the object is being edited)
      const inSel = (o === S.selected || (S.selection && S.selection.indexOf(o) !== -1));
      if (inSel && o !== S.editingObj && o.type !== 'workflow'){
        const lone = !(S.selection && S.selection.length > 1); // endpoint handles only when a single object is selected
        ctx.save();
        ctx.strokeStyle = '#6ea8ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        if (o.type === 'shape' || o.type === 'panel' || o.type === 'group' || o.type === 'workflow'){
          const s = G.normBox(o);
          const pad = o.type === 'workflow' ? 4 : 6;
          if (o.type === 'workflow'){
            const tab = F.workflowTabMetrics(o, cam.scale);
            const pad = 4;
            const left = Math.min(s.x, tab.x) - pad;
            const top = tab.y - pad;
            const right = Math.max(s.x + s.w, tab.x + tab.w) + pad;
            const bottom = s.y + s.h + pad;
            ctx.strokeRect(left, top, right - left, bottom - top);
          } else {
            ctx.strokeRect(s.x - pad, s.y - pad, s.w + pad * 2, s.h + pad * 2);
          }
          if (lone && o.type !== 'workflow'){
            // corner + edge resize handles (drag to resize freely)
            ctx.setLineDash([]);
            const hs = 4.5 / cam.scale, cx = s.x + s.w/2, cy = s.y + s.h/2;
            const hpts = [[s.x,s.y],[cx,s.y],[s.x+s.w,s.y],[s.x+s.w,cy],[s.x+s.w,s.y+s.h],[cx,s.y+s.h],[s.x,s.y+s.h],[s.x,cy]];
            for (const [hx, hy] of hpts){
              ctx.beginPath(); ctx.rect(hx - hs, hy - hs, hs*2, hs*2);
              ctx.fillStyle = '#fff'; ctx.fill();
              ctx.lineWidth = 1.5 / cam.scale; ctx.strokeStyle = '#6ea8ff'; ctx.stroke();
            }
          }
        } else if (o.type === 'text'){
          const b = R.textBox(o);
          ctx.strokeRect(b.x - 5, b.y - 3, b.w + 10, b.h + 2);
          if (lone){
            ctx.setLineDash([]);
            const hs = 4.5 / cam.scale, cx = b.x + b.w/2, cy = b.y + b.h/2;
            const hpts = [[b.x,b.y],[cx,b.y],[b.x+b.w,b.y],[b.x+b.w,cy],[b.x+b.w,b.y+b.h],[cx,b.y+b.h],[b.x,b.y+b.h],[b.x,cy]];
            for (const [hx, hy] of hpts){
              ctx.beginPath(); ctx.rect(hx - hs, hy - hs, hs*2, hs*2);
              ctx.fillStyle = '#fff'; ctx.fill();
              ctx.lineWidth = 1.5 / cam.scale; ctx.strokeStyle = '#6ea8ff'; ctx.stroke();
            }
          }
        } else {
          const rp = R.routeArrow(o);
          ctx.beginPath(); R.catmull(ctx, rp); ctx.stroke();
          if (lone){
            // draggable endpoint handles (drag to detach / re-attach)
            ctx.setLineDash([]);
            const hr = 6 / cam.scale;
            for (const q of [rp[0], rp[rp.length - 1]]){
              ctx.beginPath(); ctx.arc(q.x, q.y, hr, 0, Math.PI*2);
              ctx.fillStyle = '#0e1116'; ctx.fill();
              ctx.lineWidth = 2 / cam.scale; ctx.strokeStyle = '#6ea8ff'; ctx.stroke();
            }
          }
        }
        ctx.restore();
      }
    }

    // live preview while dragging
    const drag = S.drag;
    if (drag && drag.active){
      if (drag.mode === 'arrow'){
        ctx.save();
        ctx.globalAlpha = 0.45;                 // semi-translucent
        ctx.lineWidth = 3; ctx.strokeStyle = S.color;
        ctx.setLineDash([1, 9]);                // dotted (round caps -> dots)
        ctx.beginPath(); R.catmull(ctx, drag.pts); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (drag.mode === 'shape'){
        const s = G.normBox(drag.preview);
        ctx.save();
        ctx.beginPath(); R.shapePath(ctx, s);
        ctx.fillStyle = G.hexToRgba(S.color, 0.10);
        ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = S.color;
        ctx.setLineDash([]); ctx.stroke();
        ctx.restore();
      } else if (drag.mode === 'panel'){
        const s = G.normBox(drag.preview);
        if (Math.abs(s.w) > 0 && Math.abs(s.h) > 0){
          ctx.save();
          ctx.fillStyle = G.hexToRgba(drag.preview.color, 0.55);
          ctx.fillRect(s.x, s.y, s.w, s.h);
          ctx.lineWidth = 1.5; ctx.strokeStyle = drag.preview.color;
          ctx.setLineDash([6, 4]); ctx.strokeRect(s.x, s.y, s.w, s.h);
          ctx.restore();
        }
      }
    }

    // alignment guides while dragging a box into line with another
    if (S.snapGuides && S.snapGuides.length){
      ctx.save();
      ctx.strokeStyle = '#ff5aa8';
      ctx.lineWidth = 1 / cam.scale;
      ctx.setLineDash([5 / cam.scale, 4 / cam.scale]);
      for (const g of S.snapGuides){
        ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y1); ctx.stroke();
      }
      ctx.restore();
    }

    // equal-distance markers while dragging a box into even spacing
    if (S.spaceMarks && S.spaceMarks.length){
      ctx.save();
      ctx.strokeStyle = '#ff5aa8';
      ctx.lineWidth = 1.5 / cam.scale;
      const tick = 5 / cam.scale;
      for (const m of S.spaceMarks){
        ctx.beginPath();
        if (m.horizontal){
          ctx.moveTo(m.x0, m.y); ctx.lineTo(m.x1, m.y);
          ctx.moveTo(m.x0, m.y - tick); ctx.lineTo(m.x0, m.y + tick);
          ctx.moveTo(m.x1, m.y - tick); ctx.lineTo(m.x1, m.y + tick);
        } else {
          ctx.moveTo(m.x, m.y0); ctx.lineTo(m.x, m.y1);
          ctx.moveTo(m.x - tick, m.y0); ctx.lineTo(m.x + tick, m.y0);
          ctx.moveTo(m.x - tick, m.y1); ctx.lineTo(m.x + tick, m.y1);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // marquee selection box (select tool, dragging on empty canvas)
    if (S.marquee){
      const m = G.normBox(S.marquee);
      ctx.save();
      ctx.fillStyle = G.hexToRgba('#6ea8ff', 0.10);
      ctx.strokeStyle = '#6ea8ff';
      ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.restore();
    }

    R.drawEntryPointWorld(ctx);

    ctx.restore();

    R.drawEntryPointsOverlay(ctx, cam, DPR);
    R.drawNodeBadgesOverlay(ctx, cam, nodeLabels);
    if (F.drawRemoteCursors) F.drawRemoteCursors(ctx, cam, DPR);

    if (S.editingObj) F.positionEditor(S.editingObj);
    if (F.drawMinimap) F.drawMinimap();
    requestAnimationFrame(render);
  };

  // Expose primitives other modules (io, interactions) need.
  F.render = R.render;
  F.shapePath = R.shapePath;
  F.catmull = R.catmull;
  F.drawArrowhead = R.drawArrowhead;
  F.drawLabel = R.drawLabel;
  F.drawNodeBadgePx = R.drawNodeBadgePx;
  F.drawNodeBadge = R.drawNodeBadgePx;
  F.fitLabelSize = R.fitLabelSize;
  F.drawText = R.drawText;
  F.drawTextDecor = R.drawTextDecor;
  F.textBounds = R.textBounds;
  F.textBox = R.textBox;
  F.fitTextInBox = R.fitTextInBox;
  F.autoTextBoxSize = R.autoTextBoxSize;
  F.pointInShape = R.pointInShape;
  F.shapeById = R.shapeById;
  F.routeArrow = R.routeArrow;
  F.bindShapeForPoint = R.bindShapeForPoint;
})();
