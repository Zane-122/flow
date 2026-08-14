// geometry.js — pure geometry helpers used by drawing + hit-testing.
(function(){
  "use strict";
  const G = {};

  G.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  G.perpDist = function(p, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  };

  // Ramer–Douglas–Peucker simplification
  G.rdp = function rdp(pts, eps){
    if (pts.length < 3) return pts.slice();
    const a = pts[0], b = pts[pts.length - 1];
    let idx = -1, dmax = 0;
    for (let i = 1; i < pts.length - 1; i++){
      const d = G.perpDist(pts[i], a, b);
      if (d > dmax){ dmax = d; idx = i; }
    }
    if (dmax > eps){
      const l = rdp(pts.slice(0, idx + 1), eps);
      const r = rdp(pts.slice(idx), eps);
      return l.slice(0, -1).concat(r);
    }
    return [a, b];
  };

  G.pathLength = function(pts){
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += G.dist(pts[i - 1], pts[i]);
    return s;
  };

  // Distance from a point to a polyline
  G.distToPolyline = function(p, pts){
    let best = Infinity;
    for (let i = 1; i < pts.length; i++){
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx, py = a.y + t * dy;
      best = Math.min(best, Math.hypot(p.x - px, p.y - py));
    }
    return best;
  };

  // Point a given distance back from the end of a polyline (stable arrow dir)
  G.pointBack = function(pts, d){
    let acc = 0;
    for (let i = pts.length - 1; i > 0; i--){
      const a = pts[i], b = pts[i - 1], seg = G.dist(a, b);
      if (acc + seg >= d){
        const t = (d - acc) / seg;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      acc += seg;
    }
    return pts[0];
  };

  // Return a copy of a polyline trimmed by distance `d` from its end,
  // so the drawn line stops cleanly at the base of the arrowhead.
  G.trimEnd = function(pts, d){
    if (pts.length < 2 || d <= 0) return pts.slice();
    let acc = 0;
    for (let i = pts.length - 1; i > 0; i--){
      const a = pts[i], b = pts[i - 1], seg = G.dist(a, b);
      if (acc + seg >= d){
        const t = (d - acc) / seg;
        const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        return pts.slice(0, i).concat([cut]);
      }
      acc += seg;
    }
    return [pts[0], pts[0]];
  };

  // Normalize a shape/text box to positive w/h
  G.normBox = function(o){
    let { x, y, w, h } = o;
    if (w < 0){ x += w; w = -w; }
    if (h < 0){ y += h; h = -h; }
    return { ...o, x, y, w, h };
  };

  // ---- easing --------------------------------------------------------------
  G.easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  G.easeOutQuint = t => 1 - Math.pow(1 - t, 5);

  // ---- color ---------------------------------------------------------------
  G.hexToRgba = function(hex, a){
    const c = hex.replace('#', '');
    const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  };
  G.readableText = function(bg){
    if (!bg) return '#e8edf5';
    const c = bg.replace('#', '');
    const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
    const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.6 ? '#12161d' : '#f4f7fb';
  };

  window.Flow.geo = G;
})();
