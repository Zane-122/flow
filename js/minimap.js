// minimap.js — bottom-corner overview map + center-camera control.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;

  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  const MAP_W = 168, MAP_H = 112;
  let transform = null;
  let dragging = false;

  function resizeMinimap(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(MAP_W * dpr);
    canvas.height = Math.floor(MAP_H * dpr);
    canvas.style.width = MAP_W + 'px';
    canvas.style.height = MAP_H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeMinimap();
  window.addEventListener('resize', resizeMinimap);

  // Bounding box of all canvas content (world coords).
  F.getWorldBounds = function(pad){
    pad = pad == null ? 48 : pad;
    if (!S.objects.length) return { x: -240, y: -180, w: 480, h: 360 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const o of S.objects){
      if (o.type === 'shape' || o.type === 'panel' || o.type === 'group' || o.type === 'workflow'){
        const s = G.normBox(o); grow(s.x, s.y); grow(s.x + s.w, s.y + s.h);
      } else if (o.type === 'text'){
        const b = F.textBounds(o); grow(b.x, b.y); grow(b.x + b.w, b.y + b.h);
      } else {
        for (const p of F.routeArrow(o)) grow(p.x, p.y);
      }
    }
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  };

  function getViewportBounds(pad){
    pad = pad == null ? 0 : pad;
    const cam = F.cam;
    const vLeft = -cam.x / cam.scale, vTop = -cam.y / cam.scale;
    const vW = F.W / cam.scale, vH = F.H / cam.scale;
    return { x: vLeft - pad, y: vTop - pad, w: vW + pad * 2, h: vH + pad * 2 };
  }

  function unionBounds(a, b){
    const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.w, b.x + b.w), maxY = Math.max(a.y + a.h, b.y + b.h);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // Minimap always fits both content and the current camera view.
  function getMinimapBounds(){
    const content = F.getWorldBounds(48);
    const view = getViewportBounds(32);
    const u = unionBounds(content, view);
    const minW = Math.max(u.w, view.w), minH = Math.max(u.h, view.h);
    if (minW > u.w || minH > u.h){
      const cx = u.x + u.w / 2, cy = u.y + u.h / 2;
      return { x: cx - minW / 2, y: cy - minH / 2, w: minW, h: minH };
    }
    return u;
  }

  function fitTransform(bounds){
    const scale = Math.min(MAP_W / bounds.w, MAP_H / bounds.h) * 0.9;
    const offX = (MAP_W - bounds.w * scale) / 2 - bounds.x * scale;
    const offY = (MAP_H - bounds.h * scale) / 2 - bounds.y * scale;
    return { scale, offX, offY, bounds };
  }

  function worldToMap(wx, wy){
    if (!transform) return { x: 0, y: 0 };
    return { x: wx * transform.scale + transform.offX, y: wy * transform.scale + transform.offY };
  }

  function mapToWorld(mx, my){
    if (!transform) return { x: 0, y: 0 };
    return { x: (mx - transform.offX) / transform.scale, y: (my - transform.offY) / transform.scale };
  }

  // Move the main camera so `world` sits at the screen center.
  F.centerCamera = function(){
    const b = F.getWorldBounds(60);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    F.cam.x = F.W / 2 - cx * F.cam.scale;
    F.cam.y = F.H / 2 - cy * F.cam.scale;
  };

  function panCameraToWorld(wx, wy){
    F.cam.x = F.W / 2 - wx * F.cam.scale;
    F.cam.y = F.H / 2 - wy * F.cam.scale;
  }

  F.drawMinimap = function(){
    const bounds = getMinimapBounds();
    transform = fitTransform(bounds);
    const { scale, offX, offY } = transform;
    const cam = F.cam;

    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = 'rgba(14,17,22,0.92)';
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // faint grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const step = 40 * scale;
    if (step > 6){
      const x0 = offX % step, y0 = offY % step;
      for (let x = x0; x < MAP_W; x += step){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke(); }
      for (let y = y0; y < MAP_H; y += step){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke(); }
    }

    for (const o of S.objects){
      if (o.type === 'panel'){
        const s = G.normBox(o);
        const p0 = worldToMap(s.x, s.y), p1 = worldToMap(s.x + s.w, s.y + s.h);
        ctx.fillStyle = o.color || '#6ea8ff';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        ctx.globalAlpha = 1;
      } else if (o.type === 'workflow'){
        const s = G.normBox(o);
        const p0 = worldToMap(s.x, s.y), p1 = worldToMap(s.x + s.w, s.y + s.h);
        ctx.strokeStyle = o.color || '#8b97a8';
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(p0.x + 0.5, p0.y + 0.5, p1.x - p0.x - 1, p1.y - p0.y - 1);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else if (o.type === 'group'){
        const s = G.normBox(o);
        const p0 = worldToMap(s.x, s.y), p1 = worldToMap(s.x + s.w, s.y + s.h);
        ctx.fillStyle = o.color || '#6ea8ff';
        ctx.globalAlpha = 0.2;
        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = o.color || '#6ea8ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(p0.x + 0.5, p0.y + 0.5, p1.x - p0.x - 1, p1.y - p0.y - 1);
        ctx.globalAlpha = 1;
      } else if (o.type === 'shape'){
        const s = G.normBox(o);
        const p0 = worldToMap(s.x, s.y), p1 = worldToMap(s.x + s.w, s.y + s.h);
        ctx.fillStyle = o.fill || 'rgba(232,237,245,0.35)';
        ctx.strokeStyle = o.stroke || '#e8edf5';
        ctx.lineWidth = 1;
        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        ctx.strokeRect(p0.x + 0.5, p0.y + 0.5, p1.x - p0.x - 1, p1.y - p0.y - 1);
      } else if (o.type === 'text'){
        const b = F.textBounds(o);
        const p0 = worldToMap(b.x, b.y), p1 = worldToMap(b.x + b.w, b.y + b.h);
        ctx.fillStyle = o.color || '#e8edf5';
        ctx.globalAlpha = 0.7;
        ctx.fillRect(p0.x, p0.y, Math.max(2, p1.x - p0.x), Math.max(2, p1.y - p0.y));
        ctx.globalAlpha = 1;
      } else if (o.type === 'arrow'){
        const pts = F.routeArrow(o);
        if (pts.length < 2) continue;
        ctx.strokeStyle = o.color || '#e8edf5';
        ctx.lineWidth = Math.max(1, (o.width || 3) * scale * 0.35);
        ctx.beginPath();
        const pStart = worldToMap(pts[0].x, pts[0].y);
        ctx.moveTo(pStart.x, pStart.y);
        for (let i = 1; i < pts.length; i++){
          const p = worldToMap(pts[i].x, pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    // current viewport
    const vLeft = -cam.x / cam.scale, vTop = -cam.y / cam.scale;
    const vW = F.W / cam.scale, vH = F.H / cam.scale;
    const vp0 = worldToMap(vLeft, vTop), vp1 = worldToMap(vLeft + vW, vTop + vH);
    const vx = vp0.x, vy = vp0.y, vw = vp1.x - vp0.x, vh = vp1.y - vp0.y;
    ctx.fillStyle = 'rgba(110,168,255,0.12)';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
  };

  function mapPointFromEvent(e){
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    const mp = mapPointFromEvent(e);
    const wp = mapToWorld(mp.x, mp.y);
    panCameraToWorld(wp.x, wp.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const mp = mapPointFromEvent(e);
    const wp = mapToWorld(mp.x, mp.y);
    panCameraToWorld(wp.x, wp.y);
  });
  function endDrag(){ dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  document.getElementById('centerCamBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    F.centerCamera();
  });
})();
