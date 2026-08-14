// collab.js — live remote cursors + shared document over WebSocket.
(function(){
  "use strict";
  const F = window.Flow, S = F.state;

  const peers = new Map();
  let ws = null;
  let wantedFlow = null;
  let lastSent = "";
  let cursorTimer = 0;
  let lastCursor = null;
  let ignoreDoc = false;

  function proto(){
    return location.protocol === "https:" ? "wss:" : "ws:";
  }

  function paintPresence(){
    const el = document.getElementById("presenceList");
    if (!el) return;
    el.innerHTML = "";
    const mine = F.user;
    if (mine){
      const me = document.createElement("span");
      me.className = "presence-dot me";
      me.title = (mine.name || mine.email) + " (you)";
      me.textContent = (mine.name || mine.email || "?").slice(0, 1).toUpperCase();
      el.appendChild(me);
    }
    for (const p of peers.values()){
      if (mine && p.id === mine.id) continue;
      const d = document.createElement("span");
      d.className = "presence-dot";
      d.style.background = p.color || "#6ea8ff";
      d.title = p.name || "Guest";
      d.textContent = (p.name || "?").slice(0, 1).toUpperCase();
      el.appendChild(d);
    }
  }

  function setPeers(list){
    const keep = new Set();
    (list || []).forEach(p => {
      if (!p || !p.id) return;
      keep.add(p.id);
      const prev = peers.get(p.id) || {};
      peers.set(p.id, {
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x != null ? p.x : prev.x,
        y: p.y != null ? p.y : prev.y,
        t: Date.now()
      });
    });
    for (const id of [...peers.keys()]){
      if (!keep.has(id) && (!F.user || id !== F.user.id)) peers.delete(id);
    }
    paintPresence();
  }

  function send(msg){
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function snapshotKey(){
    return JSON.stringify({ name: S.projectName, objects: S.objects, cam: F.cam });
  }

  function notifyDoc(){
    if (!F.flowId || ignoreDoc) return;
    if (F.isReadOnly && F.isReadOnly()) return;
    if (S.drag && S.drag.active) return;
    if (S.editingObj) return;
    const key = snapshotKey();
    if (key === lastSent) return;
    lastSent = key;
    send({ type: "doc", name: S.projectName, cam: F.cam, objects: S.objects });
  }

  function connect(){
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    ws = new WebSocket(proto() + "//" + location.host + "/ws");
    ws.onopen = () => {
      if (wantedFlow) send({ type: "join", flowId: wantedFlow });
    };
    ws.onclose = () => {
      ws = null;
      setTimeout(() => { if (F.user) connect(); }, 1200);
    };
    ws.onerror = () => { /* close handler reconnects */ };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === "joined"){
        wantedFlow = msg.flowId;
        F.flowId = msg.flowId;
        if (msg.doc && F.cloud && F.cloud.applyRemoteDoc){
          ignoreDoc = true;
          F.cloud.applyRemoteDoc(msg.doc);
          lastSent = snapshotKey();
          ignoreDoc = false;
        }
        setPeers(msg.peers);
        return;
      }
      if (msg.type === "presence"){
        setPeers(msg.peers);
        return;
      }
      if (msg.type === "cursor"){
        if (F.user && msg.id === F.user.id) return;
        peers.set(msg.id, { id: msg.id, name: msg.name, color: msg.color, x: msg.x, y: msg.y, t: Date.now() });
        paintPresence();
        return;
      }
      if (msg.type === "doc"){
        if (F.user && msg.from === F.user.id) return;
        if (S.drag && S.drag.active) return;
        if (S.editingObj) return;
        ignoreDoc = true;
        F.cloud.applyRemoteDoc({ name: msg.name, cam: msg.cam, objects: msg.objects });
        lastSent = snapshotKey();
        ignoreDoc = false;
      }
    };
  }

  function join(flowId){
    wantedFlow = flowId;
    peers.clear();
    lastSent = "";
    paintPresence();
    if (!ws || ws.readyState !== 1){ connect(); return; }
    send({ type: "join", flowId });
  }

  function sendCursor(wp){
    if (!wp) return;
    lastCursor = wp;
    if (cursorTimer) return;
    cursorTimer = setTimeout(() => {
      cursorTimer = 0;
      if (!lastCursor) return;
      send({ type: "cursor", x: lastCursor.x, y: lastCursor.y });
    }, 40);
  }

  F.drawRemoteCursors = function(ctx, cam, DPR){
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const now = Date.now();
    for (const p of peers.values()){
      if (F.user && p.id === F.user.id) continue;
      if (p.x == null || p.y == null) continue;
      if (now - (p.t || 0) > 8000) continue;
      const sx = cam.x + p.x * cam.scale;
      const sy = cam.y + p.y * cam.scale;
      const col = p.color || "#6ea8ff";
      ctx.save();
      ctx.translate(sx, sy);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(5, 12);
      ctx.lineTo(12, 12);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = "#0b1220";
      ctx.lineWidth = 1.25;
      ctx.fill();
      ctx.stroke();
      const label = p.name || "Guest";
      ctx.font = "600 11px system-ui, sans-serif";
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = col;
      ctx.fillRect(10, 14, w, 18);
      ctx.fillStyle = "#0b1220";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 15, 23);
      ctx.restore();
    }
    ctx.restore();
  };

  F.collab = {
    connect,
    join,
    notifyDoc,
    sendCursor,
    disconnect: function(){
      wantedFlow = null;
      if (ws){ try { ws.close(); } catch (e) {} ws = null; }
      peers.clear();
      paintPresence();
    }
  };

  setInterval(() => { if (!ignoreDoc) notifyDoc(); }, 450);

  const origUndo = F.undo;
  F.undo = function(){ origUndo(); notifyDoc(); };
  const origRedo = F.redo;
  F.redo = function(){ origRedo(); notifyDoc(); };
})();
