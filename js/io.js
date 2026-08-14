// io.js — save / open / export PNG / clear.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;

  // ---- Remembered save directory (the "saved" folder) ---------------------
  // Browsers can't be pointed at an arbitrary path, so we let the user pick the
  // "saved" folder once and stash the directory handle in IndexedDB. Every save
  // after that drops straight into it with no dialog.
  const IDB_NAME = 'flowFS', IDB_STORE = 'handles', DIR_KEY = 'saveDir';
  function idb(){
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key){
    const db = await idb();
    return new Promise((res, rej) => {
      const q = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  }
  async function idbSet(key, val){
    const db = await idb();
    return new Promise((res, rej) => {
      const q = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key);
      q.onsuccess = () => res();
      q.onerror = () => rej(q.error);
    });
  }
  async function ensurePerm(handle, mode){
    if (!handle) return false;
    const opts = { mode: mode || 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }
  // Returns the remembered save directory, prompting the user to pick it once.
  async function getSaveDir(promptIfMissing){
    let dir = null;
    try { dir = await idbGet(DIR_KEY); } catch (e){ dir = null; }
    if (dir && await ensurePerm(dir)) return dir;
    if (!promptIfMissing || !window.showDirectoryPicker) return null;
    F.toast('Pick your "saved" folder once');
    try{
      dir = await window.showDirectoryPicker({ id: 'flowSaveDir', mode: 'readwrite', startIn: 'documents' });
      await idbSet(DIR_KEY, dir);
      return dir;
    } catch (err){ return null; }
  }

  function sanitizeFileName(name){
    const raw = String(name || 'Untitled').trim() || 'Untitled';
    return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }

  function projectFileName(){
    return sanitizeFileName(S.projectName) + '.json';
  }

  function nameFromFile(fileName){
    if (!fileName) return 'Untitled';
    return sanitizeFileName(fileName.replace(/\.json$/i, '').replace(/\.flow\.json$/i, ''));
  }

  function snapshotData(){
    return JSON.stringify({ version: 2, name: S.projectName, cam: F.cam, objects: S.objects }, null, 2);
  }

  F.saveFlow = async function(){
    const data = snapshotData();
    const name = projectFileName();
    // Preferred path: write straight into the remembered "saved" directory.
    if (window.showDirectoryPicker){
      const dir = await getSaveDir(true);
      if (dir){
        try{
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(data); await w.close();
          S.fileHandle = fh;
          F.toast('Saved ✓ (' + name + ')');
          return;
        } catch (err){ if (err.name === 'AbortError') return; }
      }
    }
    // Fallback: single-file picker (defaulting into the saved dir if we have it).
    if (window.showSaveFilePicker){
      try{
        const dir = await getSaveDir(false);
        S.fileHandle = await window.showSaveFilePicker({
          suggestedName: name,
          id: 'flowSaveDir',
          startIn: dir || undefined,
          types: [{ description: 'Flow file', accept: { 'application/json': ['.json'] } }]
        });
        const w = await S.fileHandle.createWritable();
        await w.write(data); await w.close();
        F.toast('Saved ✓ (' + S.fileHandle.name + ')');
        return;
      } catch (err){ if (err.name === 'AbortError') return; }
    }
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    F.toast('Saved to Downloads ✓');
  };

  function loadData(text, fileName){
    try{
      const d = JSON.parse(text);
      F.pushHistory();
      S.objects = d.objects || [];
      S.objects.forEach(o => {
        o.t0 = null; // show instantly, no entrance anim
        if (o.type === 'shape' && o.id == null) o.id = F.uid();
        if (o.type === 'group' && o.id == null) o.id = F.uid();
        if (o.type === 'workflow' && o.id == null) o.id = F.uid();
      });
      if (F.syncAllGroups) F.syncAllGroups();
      if (F.syncAllWorkflows) F.syncAllWorkflows();
      if (d.cam){ F.cam.x = d.cam.x; F.cam.y = d.cam.y; F.cam.scale = d.cam.scale; }
      S.projectName = fileName ? nameFromFile(fileName) : (d.name ? sanitizeFileName(d.name) : S.projectName);
      S.selected = null; S.selection = []; S.editingObj = null;
      if (F.updateProjectUI) F.updateProjectUI();
      F.autoSaveLocal();
      F.toast('Opened ✓');
    } catch (err){ F.toast('Could not open that file'); }
  }

  F.openFlow = async function(){
    if (window.showOpenFilePicker){
      // No type filter: Chrome greys out compound extensions like ".flow.json"
      // when a filter is set, so we accept any file and validate on load.
      const opts = { excludeAcceptAllOption: false };
      // Start in the remembered folder if we can, but never let that break open.
      try { const dir = await getSaveDir(false); if (dir) opts.startIn = dir; } catch (e){ /* ignore */ }
      try{
        const [h] = await window.showOpenFilePicker(opts);
        S.fileHandle = h;
        const f = await h.getFile();
        loadData(await f.text(), h.name);
        return;
      } catch (err){
        if (err.name === 'AbortError') return;
        // Fall through to the classic file input on any other failure.
      }
    }
    document.getElementById('fileInput').click();
  };
  F.loadFromText = function(text, fileName){ loadData(text, fileName); };

  F.newProject = function(){
    if (S.objects.length && !confirm('Start a new project? Your current work stays in auto-save until you replace it.')) return;
    S.objects = [];
    S.selected = null; S.selection = []; S.editingObj = null;
    S.fileHandle = null;
    S.projectName = 'Untitled';
    F.cam.x = 0; F.cam.y = 0; F.cam.scale = 1;
    F.history.length = 0; F.future.length = 0;
    if (F.updateProjectUI) F.updateProjectUI();
    F.autoSaveLocal();
    F.updateHUD();
    F.toast('New project');
  };

  F.setProjectName = function(name){
    S.projectName = sanitizeFileName(name);
    if (F.updateProjectUI) F.updateProjectUI();
    F.autoSaveLocal();
  };

  F.exportPNG = function(){
    if (!S.objects.length){ F.toast('Nothing to export'); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const o of S.objects){
      if (o.type === 'shape' || o.type === 'panel' || o.type === 'group'){ const s = G.normBox(o); grow(s.x, s.y); grow(s.x + s.w, s.y + s.h); }
      else if (o.type === 'text'){ const b = F.textBounds(o); grow(b.x, b.y); grow(b.x + b.w, b.y + b.h); }
      else for (const p of o.pts) grow(p.x, p.y);
    }
    const pad = 40, scale = 2;
    const cw = (maxX - minX + pad*2), ch = (maxY - minY + pad*2);
    const c = document.createElement('canvas');
    c.width = cw * scale; c.height = ch * scale;
    const x = c.getContext('2d');
    x.scale(scale, scale);
    x.fillStyle = '#0e1116'; x.fillRect(0, 0, cw, ch);
    x.translate(-minX + pad, -minY + pad);
    x.lineJoin = 'round'; x.lineCap = 'round';
    for (const o of S.objects){
      if (o.type === 'panel'){ const s = G.normBox(o);
        x.fillStyle = o.color || '#6ea8ff'; x.fillRect(s.x, s.y, s.w, s.h);
      } else if (o.type === 'group'){ const s = G.normBox(o);
        x.fillStyle = G.hexToRgba(o.color || '#6ea8ff', 0.12);
        x.fillRect(s.x, s.y, s.w, s.h);
        x.lineWidth = 2; x.strokeStyle = o.color || '#6ea8ff'; x.strokeRect(s.x, s.y, s.w, s.h);
      } else if (o.type === 'shape'){ const s = G.normBox(o);
        x.beginPath(); F.shapePath(x, s);
        x.fillStyle = o.fill || 'rgba(20,26,35,0.62)'; x.fill();
        x.lineWidth = 2.5; x.strokeStyle = o.stroke || '#e8edf5'; x.stroke();
        if (o.text) F.drawLabel(x, s, o.text, o.fill);
      } else if (o.type === 'text'){
        F.drawTextDecor(x, o, 1);
        F.drawText(x, o, 1, 0);
      } else {
        const w = o.width || 3;
        x.lineWidth = w; x.strokeStyle = o.color || '#e8edf5';
        const rpts = F.routeArrow(o);
        const hasHead = o.head !== false;
        const hs = 10 + w * 3.4;
        const a = rpts[0], b = rpts[rpts.length - 1];
        const connected = o.from != null && o.to != null;
        if (hasHead && connected && G.dist(a, b) < hs * 1.2){
          const fs = F.shapeById(o.from), ts = F.shapeById(o.to);
          const ctr = s => { const n = G.normBox(s); return { x: n.x + n.w/2, y: n.y + n.h/2 }; };
          let dx = b.x - a.x, dy = b.y - a.y;
          if (fs && ts){ const c0 = ctr(fs), c1 = ctr(ts); dx = c1.x - c0.x; dy = c1.y - c0.y; }
          const L = Math.hypot(dx, dy) || 1;
          const mid = { x: (a.x + b.x)/2, y: (a.y + b.y)/2 };
          const tip = { x: mid.x + dx/L*hs/2, y: mid.y + dy/L*hs/2 };
          F.drawArrowhead(x, tip, mid, o.color || '#e8edf5', hs, 1);
        } else {
          const body = hasHead ? G.trimEnd(rpts, hs * 0.82) : rpts;
          if (o.dashed) x.setLineDash([w * 3.2, w * 2.6]);
          x.beginPath(); F.catmull(x, body); x.stroke();
          x.setLineDash([]);
          if (hasHead){
            const tip = rpts[rpts.length - 1];
            F.drawArrowhead(x, tip, G.pointBack(rpts, 14), o.color || '#e8edf5', hs, 1);
          }
        }
      }
    }
    c.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = sanitizeFileName(S.projectName) + '.png';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      F.toast('PNG exported ✓');
    });
  };

  // ---- Auto-save to localStorage (survives reloads / tab close) -----------
  const AUTOSAVE_KEY = 'flow.autosave.v2';
  F.autoSaveLocal = function(){
    try{
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ version: 2, name: S.projectName, cam: F.cam, objects: S.objects }));
    } catch (e){ /* storage unavailable — ignore */ }
  };
  F.restoreLocal = function(){
    try{
      const t = localStorage.getItem(AUTOSAVE_KEY);
      if (!t) return false;
      const d = JSON.parse(t);
      S.objects = (d.objects || []).map(o => {
        o.t0 = null;
        if (o.type === 'shape' && o.id == null) o.id = F.uid();
        if (o.type === 'group' && o.id == null) o.id = F.uid();
        if (o.type === 'workflow' && o.id == null) o.id = F.uid();
        return o;
      });
      if (F.syncAllGroups) F.syncAllGroups();
      if (F.syncAllWorkflows) F.syncAllWorkflows();
      if (d.cam){ F.cam.x = d.cam.x; F.cam.y = d.cam.y; F.cam.scale = d.cam.scale; }
      if (d.name) S.projectName = sanitizeFileName(d.name);
      S.selected = null; S.selection = []; S.editingObj = null;
      if (F.updateProjectUI) F.updateProjectUI();
      return true;
    } catch (e){ return false; }
  };

  F.clearCanvas = function(){
    if (S.objects.length){ F.pushHistory(); S.objects = []; S.selected = null; S.selection = []; F.autoSaveLocal(); F.toast('Canvas cleared'); }
  };
})();
