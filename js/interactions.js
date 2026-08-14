// interactions.js — pointer, wheel, keyboard, hit-testing, tool switching.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo, canvas = F.canvas;

  // ---- Hit testing ---------------------------------------------------------
  function pointInShape(p, o){
    const s = G.normBox(o), ctx = F.ctx;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); F.shapePath(ctx, s);
    const inside = ctx.isPointInPath(p.x, p.y);
    ctx.restore();
    return inside;
  }
  function pointInText(p, o){
    const b = F.textBounds(o);
    return p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2;
  }
  function pointInRect(p, o){
    const s = G.normBox(o);
    return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
  }
  function hitTest(p){
    for (let i = S.objects.length - 1; i >= 0; i--){
      const o = S.objects[i];
      if (o.type === 'shape'){ if (pointInShape(p, o)) return o; }
      else if (o.type === 'text'){ if (pointInText(p, o)) return o; }
      else if (o.type === 'arrow'){ if (G.distToPolyline(p, F.routeArrow(o)) < 8) return o; }
      else if (o.type === 'group'){ if (F.pointInGroup(p, o)) return o; }
      else if (o.type === 'workflow'){ if (F.pointInWorkflow && F.pointInWorkflow(p, o)) return o; }
      else if (o.type === 'panel'){ if (pointInRect(p, o)) return o; }
    }
    return null;
  }
  F.hitTest = hitTest;

  // Topmost shape whose body contains the point (used to prevent nesting).
  function shapeAt(p){
    for (let i = S.objects.length - 1; i >= 0; i--){
      const o = S.objects[i];
      if (o.type === 'shape' && pointInShape(p, o)) return o;
    }
    return null;
  }
  F.shapeAt = shapeAt;

  // Axis-aligned bounding box of any object, for marquee selection.
  function objBBox(o){
    if (o.type === 'shape' || o.type === 'panel' || o.type === 'group' || o.type === 'workflow') return G.normBox(o);
    if (o.type === 'text'){ const b = F.textBounds(o); return { x: b.x, y: b.y, w: b.w, h: b.h }; }
    const rp = F.routeArrow(o);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of rp){ minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function rectsIntersect(a, b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function movingShapeIds(group){
    const ids = new Set();
    for (const g of group){
      if (g.obj.type === 'shape' && g.obj.id) ids.add(g.obj.id);
    }
    return ids;
  }

  // Arrows bound to moving shapes but not in the selection still need their
  // bend points translated so they don't kink when only nodes are dragged.
  function attachConnectedArrowOrigins(drag, group){
    const moving = movingShapeIds(group);
    const inGroup = new Set(group.map(g => g.obj));
    drag.arrowOrigins = new Map();
    for (const o of S.objects){
      if (o.type !== 'arrow' || inGroup.has(o)) continue;
      const touches = (o.from && moving.has(o.from)) || (o.to && moving.has(o.to));
      if (touches) drag.arrowOrigins.set(o, o.pts.map(p => ({ x: p.x, y: p.y })));
    }
  }

  // ---- Alignment snapping --------------------------------------------------
  // Snap a moving box to other shapes/panels when their left / center / right
  // (x) or top / middle / bottom (y) edges line up.
  function snapBox(mb, exclude){
    const thr = 6 / F.cam.scale;               // snap distance in world units
    const mX = [mb.x, mb.x + mb.w/2, mb.x + mb.w];
    const mY = [mb.y, mb.y + mb.h/2, mb.y + mb.h];
    let bestX = null, bestY = null;
    for (const o of S.objects){
      if (o.type !== 'shape' || exclude.has(o)) continue; // never align to back panels
      const b = G.normBox(o);
      const oX = [b.x, b.x + b.w/2, b.x + b.w];
      const oY = [b.y, b.y + b.h/2, b.y + b.h];
      for (const mx of mX) for (const ox of oX){
        const d = ox - mx;
        if (Math.abs(d) <= thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: ox, b };
      }
      for (const my of mY) for (const oy of oY){
        const d = oy - my;
        if (Math.abs(d) <= thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: oy, b };
      }
    }
    return { bestX, bestY };
  }

  // ---- Equal-spacing (distribution) snapping -------------------------------
  function overlap1D(a0, a1, b0, b1){ return Math.min(a1, b1) - Math.max(a0, b0); }
  function gapMarkX(A, B){
    const y = (Math.max(A.y, B.y) + Math.min(A.y + A.h, B.y + B.h)) / 2;
    return { horizontal: true, x0: A.x + A.w, x1: B.x, y };
  }
  function gapMarkY(A, B){
    const x = (Math.max(A.x, B.x) + Math.min(A.x + A.w, B.x + B.w)) / 2;
    return { horizontal: false, y0: A.y + A.h, y1: B.y, x };
  }
  // Snap the moving box so its gap to a neighbor matches another gap on the
  // same axis: centered between two neighbors, or equal to the nearest pair's gap.
  function spacingAxisX(mb, boxes, thr){
    const row = boxes.filter(b => overlap1D(mb.y, mb.y + mb.h, b.y, b.y + b.h) > 0);
    const left = row.filter(b => b.x + b.w <= mb.x + thr).sort((a, b) => (b.x + b.w) - (a.x + a.w));
    const right = row.filter(b => b.x >= mb.x + mb.w - thr).sort((a, b) => a.x - b.x);
    if (left[0] && right[0]){
      const L = left[0], R = right[0], t = (L.x + L.w + R.x - mb.w) / 2;
      if (Math.abs(t - mb.x) <= thr){ const n = { ...mb, x: t }; return { d: t - mb.x, marks: [gapMarkX(L, n), gapMarkX(n, R)] }; }
    }
    if (left[0] && left[1]){
      const L1 = left[0], L2 = left[1], g = L1.x - (L2.x + L2.w);
      if (g > 0){ const t = L1.x + L1.w + g; if (Math.abs(t - mb.x) <= thr){ const n = { ...mb, x: t }; return { d: t - mb.x, marks: [gapMarkX(L2, L1), gapMarkX(L1, n)] }; } }
    }
    if (right[0] && right[1]){
      const R1 = right[0], R2 = right[1], g = R2.x - (R1.x + R1.w);
      if (g > 0){ const t = R1.x - g - mb.w; if (Math.abs(t - mb.x) <= thr){ const n = { ...mb, x: t }; return { d: t - mb.x, marks: [gapMarkX(n, R1), gapMarkX(R1, R2)] }; } }
    }
    return null;
  }
  function spacingAxisY(mb, boxes, thr){
    const col = boxes.filter(b => overlap1D(mb.x, mb.x + mb.w, b.x, b.x + b.w) > 0);
    const up = col.filter(b => b.y + b.h <= mb.y + thr).sort((a, b) => (b.y + b.h) - (a.y + a.h));
    const down = col.filter(b => b.y >= mb.y + mb.h - thr).sort((a, b) => a.y - b.y);
    if (up[0] && down[0]){
      const U = up[0], D = down[0], t = (U.y + U.h + D.y - mb.h) / 2;
      if (Math.abs(t - mb.y) <= thr){ const n = { ...mb, y: t }; return { d: t - mb.y, marks: [gapMarkY(U, n), gapMarkY(n, D)] }; }
    }
    if (up[0] && up[1]){
      const U1 = up[0], U2 = up[1], g = U1.y - (U2.y + U2.h);
      if (g > 0){ const t = U1.y + U1.h + g; if (Math.abs(t - mb.y) <= thr){ const n = { ...mb, y: t }; return { d: t - mb.y, marks: [gapMarkY(U2, U1), gapMarkY(U1, n)] }; } }
    }
    if (down[0] && down[1]){
      const D1 = down[0], D2 = down[1], g = D2.y - (D1.y + D1.h);
      if (g > 0){ const t = D1.y - g - mb.h; if (Math.abs(t - mb.y) <= thr){ const n = { ...mb, y: t }; return { d: t - mb.y, marks: [gapMarkY(n, D1), gapMarkY(D1, D2)] }; } }
    }
    return null;
  }

  function startEndpoint(o, end){
    F.pushHistory();
    S.selected = o; S.selection = [o];
    S.drag = { active: true, mode: 'endpoint', obj: o, end, moved: false };
  }

  const CURSOR_FOR = { nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize', n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize' };
  // Which resize handle (if any) of a box-like object is under the point.
  function resizeHandleAt(o, wp){
    const s = o.type === 'text' ? F.textBox(o) : G.normBox(o);
    const hr = (o.type === 'text' ? 11 : 9) / F.cam.scale;
    const cx = s.x + s.w/2, cy = s.y + s.h/2;
    const pts = {
      nw:{x:s.x,y:s.y}, n:{x:cx,y:s.y}, ne:{x:s.x+s.w,y:s.y},
      e:{x:s.x+s.w,y:cy}, se:{x:s.x+s.w,y:s.y+s.h}, s:{x:cx,y:s.y+s.h},
      sw:{x:s.x,y:s.y+s.h}, w:{x:s.x,y:cy}
    };
    for (const k in pts){ if (Math.abs(wp.x - pts[k].x) <= hr && Math.abs(wp.y - pts[k].y) <= hr) return k; }
    return null;
  }
  function ensureTextBox(o){
    if (!o.w || !o.h){
      const s = F.autoTextBoxSize(o);
      o.w = s.w; o.h = s.h;
    }
  }
  function tryStartTextResize(o, wp){
    ensureTextBox(o);
    const hnd = resizeHandleAt(o, wp);
    if (!hnd) return false;
    S.selected = o; S.selection = [o];
    startResize(o, hnd);
    return true;
  }
  function startResize(o, handle){
    F.pushHistory();
    S.selected = o; S.selection = [o];
    if (o.type === 'text') ensureTextBox(o);
    const orig = o.type === 'text' ? F.textBox(o) : G.normBox(o);
    S.drag = { active: true, mode: 'resize', obj: o, handle, orig, moved: false };
  }

  function startWorkflowMove(workflow, wp){
    F.pushHistory();
    F.applySelection([]);
    S.drag = {
      active: true, mode: 'move', obj: workflow, start: wp, moved: false,
      group: F.buildWorkflowMoveGroup(workflow)
    };
    attachConnectedArrowOrigins(S.drag, S.drag.group);
  }

  function startMove(hit, wp){
    if (hit.type === 'workflow') return;
    F.pushHistory();
    // Keep the existing group only if the grabbed object is part of it.
    if (!(S.selection.length > 1 && S.selection.indexOf(hit) !== -1)){
      S.selection = [hit];
    } else if (F.filterSelectable){
      S.selection = F.filterSelectable(S.selection);
    }
    S.selected = hit;
    const group = S.selection.map(o => ({
      obj: o,
      orig: o.type === 'arrow' ? o.pts.map(p => ({ ...p })) : { x: o.x, y: o.y }
    }));
    // Dragging a node group also moves its member shapes.
    if (hit.type === 'group'){
      const seen = new Set(group.map(g => g.obj));
      for (const id of (hit.memberIds || [])){
        const sh = S.objects.find(o => o.type === 'shape' && o.id === id);
        if (sh && !seen.has(sh)){
          seen.add(sh);
          group.push({ obj: sh, orig: { x: sh.x, y: sh.y } });
        }
      }
    }
    S.drag = { active: true, mode: 'move', obj: hit, start: wp, moved: false, group };
    attachConnectedArrowOrigins(S.drag, group);
  }

  function isFormField(el){
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  // ---- Pointer -------------------------------------------------------------
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const sp = { x: e.clientX, y: e.clientY };
    const wp = F.screenToWorld(sp.x, sp.y);
    S.pointer = wp;

    if (S.spaceHeld || e.button === 1 || S.tool === 'hand'){
      S.panning = { sx: sp.x, sy: sp.y, cx: F.cam.x, cy: F.cam.y };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Drag an entire workflow by its title tab.
    const wfTitle = F.workflowTitleAt && F.workflowTitleAt(wp);
    if (wfTitle){ startWorkflowMove(wfTitle, wp); return; }

    if (S.tool === 'fill'){
      // A click fills the object under the cursor; a drag paints a filled panel.
      const hit = hitTest(wp);
      S.drag = { active: true, mode: 'panel', start: wp, hit,
                 preview: { type: 'panel', x: wp.x, y: wp.y, w: 0, h: 0, color: S.color } };
      return;
    }

    // Drag an endpoint of the selected arrow to detach / re-attach it.
    if ((S.tool === 'draw' || S.tool === 'select') && !S.wHeld && S.selected && S.selected.type === 'arrow'){
      const rp = F.routeArrow(S.selected);
      const hr = 11 / F.cam.scale;
      if (G.dist(wp, rp[0]) < hr){ startEndpoint(S.selected, 'start'); return; }
      if (G.dist(wp, rp[rp.length - 1]) < hr){ startEndpoint(S.selected, 'end'); return; }
    }

    // Drag a corner/edge handle of the selected box to resize it freely.
    if ((S.tool === 'draw' || S.tool === 'select' || S.tool === 'text') && !S.wHeld && S.selection.length === 1){
      const sel = S.selection[0];
      if (sel && (sel.type === 'shape' || sel.type === 'panel' || sel.type === 'text')){
        const hnd = resizeHandleAt(sel, wp);
        if (hnd){ startResize(sel, hnd); return; }
      }
    }

    const hit = hitTest(wp);

    if (S.tool === 'text'){
      if (hit && hit.type === 'text' && tryStartTextResize(hit, wp)) return;
      if (hit) startMove(hit, wp);
      else F.createTextAt(wp);
      return;
    }

    if (S.tool === 'select'){
      if (hit && hit.type === 'text' && tryStartTextResize(hit, wp)) return;
      const marqueeOnChrome = !hit
        || hit.type === 'workflow'
        || (hit.type === 'group' && !shapeAt(wp) && F.groupInWorkflow && F.groupInWorkflow(hit));
      if (marqueeOnChrome){
        S.selected = null; S.selection = [];
        S.marquee = { x: wp.x, y: wp.y, w: 0, h: 0 };
        S.drag = { active: true, mode: 'marquee', start: wp };
      } else if (hit){ startMove(hit, wp); }
      return;
    }

    const shapeMode = S.wHeld || S.tool === 'shape';
    if (shapeMode){
      // Never spawn a shape inside another shape — clicking one does nothing
      // (double-click still opens its text editor via the dblclick handler).
      if (shapeAt(wp)){ S.selected = null; S.selection = []; return; }
      S.selected = null; S.selection = [];
      const shape = F.SHAPES[S.shapeIndex % F.SHAPES.length];
      const preset = F.SHAPE_SIZES[S.sizeIndex];
      if (preset && preset.w > 0){
        S.drag = { active: true, mode: 'shape', start: wp, preset: true,
                   preview: { type: 'shape', shape, x: wp.x - preset.w/2, y: wp.y - preset.h/2, w: preset.w, h: preset.h } };
      } else {
        S.drag = { active: true, mode: 'shape', start: wp,
                   preview: { type: 'shape', shape, x: wp.x, y: wp.y, w: 0, h: 0 } };
      }
      return;
    }

    // default draw tool — chrome (workflow/group padding) and shapes start arrows, not moves
    if (hit && hit.type === 'text' && tryStartTextResize(hit, wp)) return;
    if (!hit || hit.type === 'workflow' || hit.type === 'group' || hit.type === 'shape'){
      S.selected = null; S.selection = [];
      S.drag = { active: true, mode: 'arrow', pts: [wp] };
      return;
    }
    startMove(hit, wp);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (S.panning){
      F.cam.x = S.panning.cx + (e.clientX - S.panning.sx);
      F.cam.y = S.panning.cy + (e.clientY - S.panning.sy);
      return;
    }
    const wp = F.screenToWorld(e.clientX, e.clientY);
    S.pointer = wp;
    if (F.collab && F.collab.sendCursor) F.collab.sendCursor(wp);
    const drag = S.drag;
    if (!drag || !drag.active){
      if (F.workflowTitleAt && F.workflowTitleAt(wp)){
        canvas.style.cursor = 'grab';
        S.hoveredShape = null;
        return;
      }
      const hit = hitTest(wp);
      S.hoveredShape = (hit && hit.type === 'shape') ? hit : null;
      if ((S.tool === 'select' || S.tool === 'draw' || S.tool === 'text') && !S.wHeld && S.selection.length === 1){
        const sel = S.selection[0];
        if (sel && (sel.type === 'shape' || sel.type === 'panel' || sel.type === 'text')){
          if (sel.type === 'text') ensureTextBox(sel);
          const hnd = resizeHandleAt(sel, wp);
          if (hnd){ canvas.style.cursor = CURSOR_FOR[hnd]; return; }
        }
      }
      updateCursor();
      return;
    }

    S.hoveredShape = null;

    if (drag.mode === 'move') canvas.style.cursor = 'grabbing';

    if (drag.mode === 'arrow'){
      const last = drag.pts[drag.pts.length - 1];
      if (!last || G.dist(last, wp) > 1.5) drag.pts.push(wp);
    } else if (drag.mode === 'marquee'){
      S.marquee = { x: drag.start.x, y: drag.start.y, w: wp.x - drag.start.x, h: wp.y - drag.start.y };
    } else if (drag.mode === 'resize'){
      const o = drag.obj, hnd = drag.handle, r = drag.orig;
      let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
      if (hnd.includes('w')) left = wp.x;
      if (hnd.includes('e')) right = wp.x;
      if (hnd.includes('n')) top = wp.y;
      if (hnd.includes('s')) bottom = wp.y;
      if (e.shiftKey && hnd.length === 2 && r.h !== 0){        // corner: keep aspect ratio
        const ar = Math.abs(r.w / r.h);
        let w = right - left, h = bottom - top;
        if (Math.abs(w) / (Math.abs(h) || 1) > ar) h = Math.sign(h || 1) * Math.abs(w) / ar;
        else w = Math.sign(w || 1) * Math.abs(h) * ar;
        if (hnd.includes('w')) left = right - w; else right = left + w;
        if (hnd.includes('n')) top = bottom - h; else bottom = top + h;
      }
      const MIN = 12;
      if (right - left < MIN){ if (hnd.includes('w')) left = right - MIN; else right = left + MIN; }
      if (bottom - top < MIN){ if (hnd.includes('n')) top = bottom - MIN; else bottom = top + MIN; }
      if (o.type === 'text'){
        const newW = right - left, newH = bottom - top;
        o.w = newW; o.h = newH;
        o.x = left + newW / 2;
        o.y = top + newH / 2;
      } else {
        o.x = left; o.y = top; o.w = right - left; o.h = bottom - top;
      }
      drag.moved = true;
    } else if (drag.mode === 'panel'){
      let w = wp.x - drag.start.x, h = wp.y - drag.start.y;
      if (e.shiftKey){ const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w||1)*m; h = Math.sign(h||1)*m; }
      drag.preview.w = w; drag.preview.h = h;
    } else if (drag.mode === 'shape'){
      if (drag.preset){
        // fixed preset size — follow the cursor as the shape's center
        drag.preview.x = wp.x - drag.preview.w/2;
        drag.preview.y = wp.y - drag.preview.h/2;
      } else {
        let w = wp.x - drag.start.x, h = wp.y - drag.start.y;
        if (e.shiftKey){ const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w||1)*m; h = Math.sign(h||1)*m; }
        drag.preview.w = w; drag.preview.h = h;
      }
    } else if (drag.mode === 'endpoint'){
      const o = drag.obj;
      drag.moved = true;
      if (drag.end === 'start'){ o.from = null; o.pts[0] = { x: wp.x, y: wp.y }; }
      else { o.to = null; o.pts[o.pts.length - 1] = { x: wp.x, y: wp.y }; }
    } else if (drag.mode === 'move'){
      let dx = wp.x - drag.start.x, dy = wp.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
      S.snapGuides = null; S.spaceMarks = null;
      const primary = drag.obj;
      if (primary.type === 'shape' || primary.type === 'panel' || primary.type === 'group' || primary.type === 'workflow'){
        const po = drag.group.find(g => g.obj === primary);
        const W = primary.w, H = primary.h;
        const boxAt = () => G.normBox({ x: po.orig.x + dx, y: po.orig.y + dy, w: W, h: H });
        const exclude = new Set(drag.group.map(g => g.obj));
        const { bestX, bestY } = snapBox(boxAt(), exclude);
        let snappedX = false, snappedY = false;
        if (bestX){ dx += bestX.d; snappedX = true; }
        if (bestY){ dy += bestY.d; snappedY = true; }
        if (bestX || bestY){
          const mb = boxAt();
          const guides = [];
          if (bestX){ const tb = bestX.b, y0 = Math.min(tb.y, mb.y), y1 = Math.max(tb.y+tb.h, mb.y+mb.h); guides.push({ x0: bestX.at, y0, x1: bestX.at, y1 }); }
          if (bestY){ const tb = bestY.b, x0 = Math.min(tb.x, mb.x), x1 = Math.max(tb.x+tb.w, mb.x+mb.w); guides.push({ x0, y0: bestY.at, x1, y1: bestY.at }); }
          S.snapGuides = guides;
        }
        // Equal-spacing snap on any axis not already edge-aligned.
        const thr = 6 / F.cam.scale;
        const boxes = S.objects.filter(o => o.type === 'shape' && !exclude.has(o)).map(o => G.normBox(o)); // never align to back panels
        if (!snappedX){ const rx = spacingAxisX(boxAt(), boxes, thr); if (rx) dx += rx.d; }
        if (!snappedY){ const ry = spacingAxisY(boxAt(), boxes, thr); if (ry) dy += ry.d; }
        const fb = boxAt(), marks = [];
        if (!snappedX){ const rx = spacingAxisX(fb, boxes, thr); if (rx) marks.push(...rx.marks); }
        if (!snappedY){ const ry = spacingAxisY(fb, boxes, thr); if (ry) marks.push(...ry.marks); }
        if (marks.length) S.spaceMarks = marks;
      }
      for (const g of drag.group){
        if (g.obj.type === 'arrow') continue;
        g.obj.x = g.orig.x + dx;
        g.obj.y = g.orig.y + dy;
      }
      const moving = movingShapeIds(drag.group);
      for (const g of drag.group){
        if (g.obj.type !== 'arrow') continue;
        const o = g.obj;
        const endpointMoves = (o.from && moving.has(o.from)) || (o.to && moving.has(o.to));
        o.pts = g.orig.map(p => ({ x: p.x + dx, y: p.y + dy }));
        // Only detach when dragging the arrow alone (not its connected nodes).
        if (!endpointMoves && drag.moved){ o.from = null; o.to = null; }
      }
      if (drag.arrowOrigins){
        for (const [o, orig] of drag.arrowOrigins){
          o.pts = orig.map(p => ({ x: p.x + dx, y: p.y + dy }));
        }
      }
      if (drag.moved){
        F.syncAllGroups();
        if (F.syncAllWorkflows) F.syncAllWorkflows();
      }
    }
  });

  function endDrag(){
    if (S.panning){ S.panning = null; updateCursor(); return; }
    const drag = S.drag;
    if (!drag || !drag.active){ S.drag = null; return; }

    if (drag.mode === 'arrow'){
      const arrow = F.finishArrow(drag.pts);
      if (arrow){
        F.bindArrow(arrow);
        F.pushHistory();
        S.objects.push(arrow);
        if (F.syncAllWorkflows) F.syncAllWorkflows();
      }
    } else if (drag.mode === 'panel'){
      const p = drag.preview;
      if (Math.abs(p.w) > 6 && Math.abs(p.h) > 6){
        // Real drag → drop a filled color panel behind everything else.
        F.pushHistory();
        const s = G.normBox(p);
        const panel = { type:'panel', id: F.uid(), x: s.x, y: s.y, w: s.w, h: s.h, color: p.color, t0: F.now() };
        S.objects.unshift(panel);
        S.selected = panel; S.selection = [panel];
      } else if (drag.hit){
        // Plain click → fill the object under the cursor.
        F.pushHistory();
        if (drag.hit.type === 'shape'){
          const grps = F.groupsForShapeId(drag.hit.id);
          const fill = S.transparent ? null : S.color;
          if (grps.length) F.applyGroupColor(grps[0], fill);
          else drag.hit.fill = fill;
        } else drag.hit.color = S.color;
        S.selected = drag.hit; S.selection = [drag.hit];
      }
    } else if (drag.mode === 'shape'){
      let p = drag.preview;
      // A plain click (no real drag) drops a default-size shape at the point.
      if (!drag.preset && Math.abs(p.w) <= 6 && Math.abs(p.h) <= 6){
        const d = F.SHAPE_SIZES[2]; // M
        p = { type:'shape', shape: p.shape, x: drag.start.x - d.w/2, y: drag.start.y - d.h/2, w: d.w, h: d.h };
      }
      if (Math.abs(p.w) > 6 && Math.abs(p.h) > 6){
        const s = G.normBox(p);
        // Don't drop a shape whose center lands inside an existing shape.
        if (shapeAt({ x: s.x + s.w/2, y: s.y + s.h/2 })){ S.drag = null; return; }
        F.pushHistory();
        const shapeObj = { type:'shape', id: F.uid(), shape: p.shape, x: s.x, y: s.y, w: s.w, h: s.h,
                           stroke:'#e8edf5', fill: null, text:'', t0: F.now() };
        S.objects.push(shapeObj);
        S.selected = shapeObj; S.selection = [shapeObj];
        F.reconnectArrows();   // latch any dangling arrow ends onto the new shape
        if (F.syncAllWorkflows) F.syncAllWorkflows();
        F.updateHUD();
      }
    } else if (drag.mode === 'endpoint'){
      if (!drag.moved){ F.history.pop(); }
      else {
        const o = drag.obj;
        const pt = drag.end === 'start' ? o.pts[0] : o.pts[o.pts.length - 1];
        const sh = F.bindShapeForPoint(pt, F.CONNECT_SNAP);
        if (sh){
          if (drag.end === 'start' && sh.id !== o.to) o.from = sh.id;
          if (drag.end === 'end' && sh.id !== o.from) o.to = sh.id;
        }
        if (F.syncAllWorkflows) F.syncAllWorkflows();
      }
    } else if (drag.mode === 'move'){
      if (!drag.moved) F.history.pop(); // nothing changed, drop snapshot
      else {
        if (drag.group.some(g => g.obj.type === 'shape')) F.reconnectArrows();
        F.syncAllGroups();
        if (F.syncAllWorkflows) F.syncAllWorkflows();
      }
    } else if (drag.mode === 'resize'){
      if (!drag.moved) F.history.pop();
      else {
        if (drag.obj.type === 'shape') F.reconnectArrows();
        F.syncAllGroups();
        if (F.syncAllWorkflows) F.syncAllWorkflows();
      }
    } else if (drag.mode === 'marquee'){
      const r = G.normBox(S.marquee || { x: 0, y: 0, w: 0, h: 0 });
      if (r.w < 3 && r.h < 3){ S.selection = []; S.selected = null; }
      else {
        const sel = F.filterSelectable
          ? F.filterSelectable(S.objects.filter(o => rectsIntersect(objBBox(o), r)))
          : S.objects.filter(o => rectsIntersect(objBBox(o), r) && o.type !== 'workflow');
        S.selection = sel;
        S.selected = sel.length ? sel[sel.length - 1] : null;
      }
      S.marquee = null;
    }
    S.snapGuides = null; S.spaceMarks = null;
    S.drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { S.hoveredShape = null; });

  // double-click: edit a shape/text label, or drop new text on empty canvas
  canvas.addEventListener('dblclick', (e) => {
    const wp = F.screenToWorld(e.clientX, e.clientY);
    const hit = hitTest(wp);
    if (hit && hit.type === 'panel') return; // panels are fills — no text
    if (hit && hit.type === 'group'){ F.editGroupLabel(hit); return; }
    if (hit && hit.type === 'workflow' && F.pointInWorkflowLabel(wp, hit)){ F.editWorkflowName(hit); return; }
    if (hit && (hit.type === 'shape' || hit.type === 'text')) F.startEdit(hit);
    else F.createTextAt(wp);
  });

  // ---- Wheel (pan + zoom) --------------------------------------------------
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cam = F.cam;
    if (e.ctrlKey || e.metaKey){
      const factor = Math.exp(-e.deltaY * 0.01);
      const before = F.screenToWorld(e.clientX, e.clientY);
      cam.scale = Math.min(4, Math.max(0.25, cam.scale * factor));
      const after = F.screenToWorld(e.clientX, e.clientY);
      cam.x += (after.x - before.x) * cam.scale;
      cam.y += (after.y - before.y) * cam.scale;
    } else {
      cam.x -= e.deltaX; cam.y -= e.deltaY;
    }
  }, { passive: false });

  // ---- Copy / cut / paste --------------------------------------------------
  let clipboard = [];
  function currentSelection(){
    return (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
  }
  function copySelection(){
    const sel = F.filterSelectable ? F.filterSelectable(currentSelection()) : currentSelection();
    if (sel.length) clipboard = sel.map(o => JSON.parse(JSON.stringify(o)));
  }
  function deleteSelection(){
    const sel = currentSelection();
    if (!sel.length) return;
    F.pushHistory();
    const set = new Set(sel);
    S.objects = S.objects.filter(o => !set.has(o));
    S.selected = null; S.selection = [];
    F.syncAllGroups();
    if (F.syncAllWorkflows) F.syncAllWorkflows();
  }
  function pasteClipboard(){
    if (!clipboard.length) return;
    F.pushHistory();
    const off = 24;
    const clones = clipboard.map(src => JSON.parse(JSON.stringify(src)));
    // Give copied shapes fresh ids so pasted arrows can re-link to them.
    const idMap = {};
    for (const o of clones){
      if (o.type === 'shape'){ const nid = F.uid(); idMap[o.id] = nid; o.id = nid; }
      else if (o.type === 'panel' || o.type === 'group' || o.type === 'workflow'){
        const nid = F.uid(); idMap[o.id] = nid; o.id = nid;
      }
    }
    const newSel = [];
    const groupClones = [];
    const workflowClones = [];
    for (const o of clones){
      o.t0 = F.now();
      if (o.type === 'group'){
        o.memberIds = (o.memberIds || []).map(id => idMap[id]).filter(Boolean);
        o.x += off; o.y += off;
        groupClones.push(o);
      } else if (o.type === 'workflow'){
        o.shapeIds = (o.shapeIds || []).map(id => idMap[id]).filter(Boolean);
        o.groupIds = (o.groupIds || []).map(id => idMap[id]).filter(Boolean);
        if (o.entryShapeId && idMap[o.entryShapeId]) o.entryShapeId = idMap[o.entryShapeId];
        else o.entryShapeId = null;
        workflowClones.push(o);
      } else if (o.type === 'arrow'){
        if (Array.isArray(o.pts)) o.pts = o.pts.map(p => ({ x: p.x + off, y: p.y + off }));
        if (o.from != null && idMap[o.from] != null) o.from = idMap[o.from];
        if (o.to != null && idMap[o.to] != null) o.to = idMap[o.to];
        S.objects.push(o);
        newSel.push(o);
      } else if (o.type === 'panel'){
        o.x += off; o.y += off; S.objects.unshift(o);
        newSel.push(o);
      } else {
        o.x += off; o.y += off; S.objects.push(o);
        newSel.push(o);
      }
    }
    for (const o of groupClones){
      if (o.memberIds.length){
        F.recomputeGroupBounds(o);
        S.objects.splice(F.insertIndexForGroup(o.memberIds), 0, o);
        newSel.push(o);
      }
    }
    for (const o of workflowClones){
      if (F.recomputeWorkflowBounds(o)){
        S.objects.splice(0, 0, o);
        newSel.push(o);
      }
    }
    if (F.syncAllWorkflows) F.syncAllWorkflows();
    if (F.applySelection) F.applySelection(newSel);
    else { S.selection = newSel; S.selected = newSel[newSel.length - 1] || null; }
    F.updateHUD();
  }

  // ---- Keyboard ------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (S.editingObj) return; // editor handles its own keys
    if (isFormField(e.target)) return; // let join-code / name fields copy, paste, type
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z'){ e.preventDefault(); e.shiftKey ? F.redo() : F.undo(); return; }
    if (meta && e.key.toLowerCase() === 's'){ e.preventDefault(); F.saveFlow(); return; }
    if (meta && e.key.toLowerCase() === 'c'){ e.preventDefault(); copySelection(); return; }
    if (meta && e.key.toLowerCase() === 'x'){ e.preventDefault(); copySelection(); deleteSelection(); return; }
    if (meta && e.key.toLowerCase() === 'v'){ e.preventDefault(); pasteClipboard(); return; }
    if (meta && e.key.toLowerCase() === 'd'){ e.preventDefault(); copySelection(); pasteClipboard(); return; }
    if (meta && e.key.toLowerCase() === 'g'){
      e.preventDefault();
      if (e.shiftKey) F.ungroupSelection();
      else F.createGroupFromSelection();
      return;
    }
    if (meta && e.key.toLowerCase() === 'w' && e.shiftKey){
      e.preventDefault();
      F.setWorkflowEntryFromSelection();
      return;
    }
    if (meta) return;

    if (e.key === 'w' || e.key === 'W'){
      e.preventDefault();
      const drag = S.drag;
      if (drag && drag.active && drag.mode === 'shape'){
        if (!e.repeat){
          S.shapeIndex = (S.shapeIndex + 1) % F.SHAPES.length;
          drag.preview.shape = F.SHAPES[S.shapeIndex];
          F.updateHUD();
        }
      } else if (!S.wHeld){
        S.wHeld = true; S.shapeIndex = 0; F.updateHUD();
      }
      return;
    }
    if (e.code === 'Space'){ S.spaceHeld = true; updateCursor(); e.preventDefault(); return; }
    if (e.key === 'q' || e.key === 'Q' || e.key === '0'){
      // cycle preset shape sizes while in shape mode (updates a live drag too)
      if ((S.wHeld || S.tool === 'shape') && !e.repeat) cycleSize();
      return;
    }
    const numTool = { '1':'select', '2':'draw', '3':'shape', '4':'text', '5':'fill', '6':'hand' }[e.key];
    if (numTool){ F.setTool(numTool); return; }
    if (e.key === 'f' || e.key === 'F'){ F.setTool('fill'); return; }
    if (e.key === 't' || e.key === 'T'){ F.setTool('text'); return; }
    if (e.key === 'h' || e.key === 'H'){ F.setTool('hand'); return; }
    if (e.key === 'v' || e.key === 'V'){ F.setTool('select'); return; }
    if (e.key === 'Escape'){ F.setTool('select'); S.selected = null; S.selection = []; return; }
    if (e.key === 'Backspace' || e.key === 'Delete'){
      const sel = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
      if (sel.length){
        F.pushHistory();
        const set = new Set(sel);
        S.objects = S.objects.filter(o => !set.has(o));
        S.selected = null; S.selection = [];
        F.syncAllGroups();
        if (F.syncAllWorkflows) F.syncAllWorkflows();
      }
      return;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W'){ S.wHeld = false; F.updateHUD(); }
    if (e.code === 'Space'){ S.spaceHeld = false; updateCursor(); }
  });

  function cycleSize(){
    S.sizeIndex = (S.sizeIndex + 1) % F.SHAPE_SIZES.length;
    const drag = S.drag;
    if (drag && drag.active && drag.mode === 'shape'){
      const preset = F.SHAPE_SIZES[S.sizeIndex];
      if (preset.w > 0){
        drag.preset = true;
        drag.preview.w = preset.w; drag.preview.h = preset.h;
        drag.preview.x = S.pointer.x - preset.w/2;
        drag.preview.y = S.pointer.y - preset.h/2;
      } else {
        drag.preset = false;
        drag.preview.x = drag.start.x; drag.preview.y = drag.start.y;
        drag.preview.w = S.pointer.x - drag.start.x;
        drag.preview.h = S.pointer.y - drag.start.y;
      }
    }
    F.updateHUD();
  }

  function updateCursor(){
    canvas.style.cursor = (S.spaceHeld || S.tool === 'hand') ? 'grab'
      : S.tool === 'fill' ? 'cell'
      : S.tool === 'text' ? 'text'
      : S.tool === 'select' ? 'default'
      : 'crosshair';
  }
  F.updateCursor = updateCursor;
})();
