// arrows.js — turn a raw freehand stroke into a clean arrow (smooth or straight).
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;

  // Resample a path to roughly even spacing (kills jitter from fast/slow drawing).
  function resample(pts, spacing){
    if (pts.length < 2) return pts.slice();
    const out = [{ ...pts[0] }];
    let prev = pts[0], acc = 0;
    for (let i = 1; i < pts.length; i++){
      let cur = pts[i], d = G.dist(prev, cur);
      if (d === 0) continue;
      while (acc + d >= spacing){
        const t = (spacing - acc) / d;
        const np = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
        out.push(np); prev = np; d = G.dist(prev, cur); acc = 0;
      }
      acc += d; prev = cur;
    }
    const last = pts[pts.length - 1];
    if (G.dist(out[out.length - 1], last) > 0.5) out.push({ ...last });
    return out;
  }

  // Chaikin corner-cutting — soft, natural rounding, endpoints fixed.
  function chaikin(pts, iterations){
    let p = pts;
    for (let k = 0; k < iterations; k++){
      if (p.length < 3) break;
      const np = [p[0]];
      for (let i = 0; i < p.length - 1; i++){
        const a = p[i], b = p[i + 1];
        np.push({ x: a.x*0.75 + b.x*0.25, y: a.y*0.75 + b.y*0.25 });
        np.push({ x: a.x*0.25 + b.x*0.75, y: a.y*0.25 + b.y*0.75 });
      }
      np.push(p[p.length - 1]);
      p = np;
    }
    return p;
  }

  function style(arrow){
    arrow.color = S.color;
    arrow.width = S.arrowWidth;
    arrow.dashed = S.arrowDashed;
    arrow.head = S.arrowHead;
    arrow.flow = S.arrowFlow;
    arrow.t0 = F.now();
    return arrow;
  }

  F.finishArrow = function(raw){
    if (raw.length < 2) return null;
    let pts = resample(raw, 3);
    if (pts.length < 2) return null;

    const a = pts[0], b = pts[pts.length - 1];
    const span = G.dist(a, b);
    const len = G.pathLength(pts);
    if (len < 10) return null; // accidental tap

    // Straight vs. curved from peak deviation off the chord.
    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, G.perpDist(p, a, b));
    const isStraight = span > 14 && (maxDev / span < 0.055 || len / span < 1.05);

    if (isStraight){
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const step = Math.PI / 4;
      const snapped = Math.round(ang / step) * step;
      const end = Math.abs(ang - snapped) < 0.14
        ? { x: a.x + Math.cos(snapped) * span, y: a.y + Math.sin(snapped) * span }
        : { ...b };
      return style({ type:'arrow', pts:[{ ...a }, end] });
    }

    // Stronger smoothing: simplify a touch more, then extra corner-cutting.
    let s = G.rdp(pts, Math.max(2.2, span * 0.016));
    s = chaikin(s, 4);
    s = G.rdp(s, 0.6);            // drop redundant near-collinear points
    s[0] = { ...a };
    s[s.length - 1] = { ...b };
    return style({ type:'arrow', pts: s });
  };
})();
