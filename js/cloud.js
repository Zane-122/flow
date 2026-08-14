// cloud.js — list / open / save flows on the server volume.
(function(){
  "use strict";
  const F = window.Flow, S = F.state;
  const LAST_KEY = "flow.lastId";

  F.flowId = null;
  F.flowShare = { isOwner: false, isPublic: false, code: null };

  function paintShareUI(){
    const chip = document.getElementById("shareChip");
    const codeBtn = document.getElementById("shareCodeBtn");
    const publicBtn = document.getElementById("publicBtn");
    const share = F.flowShare || {};
    if (publicBtn){
      publicBtn.hidden = !share.isOwner;
      publicBtn.textContent = share.isPublic ? "Make private" : "Open to public";
      publicBtn.classList.toggle("public-on", !!share.isPublic);
    }
    if (chip && codeBtn){
      if (share.isPublic && share.code){
        chip.hidden = false;
        codeBtn.textContent = share.code;
      } else {
        chip.hidden = true;
      }
    }
  }

  function applyShareState(body){
    F.flowShare = {
      isOwner: !!(body && body.is_owner),
      isPublic: !!(body && body.is_public),
      code: (body && body.join_code) || null
    };
    paintShareUI();
  }

  function snapshotData(){
    return { version: 2, name: S.projectName, cam: F.cam, objects: S.objects };
  }

  function applyDoc(d, name){
    S.objects = (d.objects || []).map(o => {
      o.t0 = null;
      if (o.type === "shape" && o.id == null) o.id = F.uid();
      if (o.type === "group" && o.id == null) o.id = F.uid();
      if (o.type === "workflow" && o.id == null) o.id = F.uid();
      return o;
    });
    if (F.syncAllGroups) F.syncAllGroups();
    if (F.syncAllWorkflows) F.syncAllWorkflows();
    if (d.cam){ F.cam.x = d.cam.x; F.cam.y = d.cam.y; F.cam.scale = d.cam.scale; }
    S.projectName = name || d.name || "Untitled";
    S.selected = null; S.selection = []; S.editingObj = null;
    F.history.length = 0; F.future.length = 0;
    if (F.updateProjectUI) F.updateProjectUI();
  }

  function remember(id){
    F.flowId = id;
    try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
  }

  async function createFlow(name, data){
    const body = await F.api("/api/flows", {
      method: "POST",
      body: JSON.stringify({ name: name || "Untitled", data: data || snapshotData() })
    });
    remember(body.id);
    applyDoc(body.data, body.name);
    applyShareState(body);
    if (F.collab && F.collab.join) F.collab.join(body.id);
    return body;
  }

  async function openFlow(id, opts){
    const body = await F.api("/api/flows/" + id);
    remember(body.id);
    applyDoc(body.data, body.name);
    applyShareState(body);
    if (F.collab && F.collab.join) F.collab.join(body.id);
    if (opts && opts.toast) F.toast("Opened ✓");
    return body;
  }

  function fmtTime(iso){
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function renderList(){
    const list = document.getElementById("flowsList");
    if (!list) return;
    list.innerHTML = "<div class='flows-empty'>Loading…</div>";
    try{
      const body = await F.api("/api/flows");
      const flows = body.flows || [];
      if (!flows.length){
        list.innerHTML = "<div class='flows-empty'>No saved flows yet.</div>";
        return;
      }
      list.innerHTML = "";
      flows.forEach(f => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "flow-row" + (f.id === F.flowId ? " current" : "");
        row.innerHTML = "<span class='flow-row-name'></span><span class='flow-row-meta'></span>";
        row.querySelector(".flow-row-name").textContent = f.name || "Untitled";
        row.querySelector(".flow-row-meta").textContent =
          (F.user && f.owner_id === F.user.id ? "Yours" : ("Shared by " + (f.owner_name || f.owner_email || "someone"))) +
          " · " + fmtTime(f.updated_at);
        row.addEventListener("click", async () => {
          await openFlow(f.id, { toast: true });
          hideFlows();
        });
        list.appendChild(row);
      });
    } catch (err){
      list.innerHTML = "<div class='flows-empty'>" + err.message + "</div>";
    }
  }

  function showFlows(){
    document.getElementById("flowsModal").classList.add("show");
    renderList();
  }
  function hideFlows(){
    document.getElementById("flowsModal").classList.remove("show");
  }

  async function saveNow(){
    if (!F.flowId){
      await createFlow(S.projectName, snapshotData());
      F.toast("Saved ✓");
      return true;
    }
    await F.api("/api/flows/" + F.flowId, {
      method: "PUT",
      body: JSON.stringify({ name: S.projectName, data: snapshotData() })
    });
    F.toast("Saved ✓");
    return true;
  }

  async function redeemInvite(code){
    const body = await F.api("/api/invites/redeem", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    if (body.flow && body.flow.id){
      await openFlow(body.flow.id);
      F.toast("Joined " + (body.flow.name || "flow") + " ✓");
    }
    return body;
  }

  F.cloud = {
    snapshotData,
    applyRemoteDoc: function(d){
      if (S.drag && S.drag.active) return;
      if (S.editingObj) return;
      applyDoc(d, d.name);
    },
    start: async function(){
      if (F.collab && F.collab.connect) F.collab.connect();
      const params = new URLSearchParams(location.search);
      const invite = (params.get("invite") || "").trim();
      if (invite){
        try{
          await redeemInvite(invite);
          history.replaceState({}, "", location.pathname);
          return;
        } catch (err){
          F.toast(err.message || "Could not join with that invite");
        }
      }
      let last = null;
      try { last = localStorage.getItem(LAST_KEY); } catch (e) {}
      try{
        if (last){
          await openFlow(last);
          return;
        }
        const listed = await F.api("/api/flows");
        if (listed.flows && listed.flows[0]){
          await openFlow(listed.flows[0].id);
          return;
        }
        await createFlow("Untitled");
      } catch (err){
        F.toast(err.message || "Could not load flows");
        await createFlow("Untitled");
      }
    },
    save: saveNow,
    showList: showFlows
  };

  const origNew = F.newProject;
  F.newProject = async function(){
    if (S.objects.length && !confirm("Start a new project? The current flow stays saved.")) return;
    try{
      await createFlow("Untitled", { version: 2, name: "Untitled", cam: { x: 0, y: 0, scale: 1 }, objects: [] });
      F.cam.x = 0; F.cam.y = 0; F.cam.scale = 1;
      F.toast("New project");
    } catch (err){
      F.toast(err.message);
      if (origNew) origNew();
    }
  };

  const origSave = F.saveFlow;
  F.saveFlow = async function(){
    try{
      await saveNow();
    } catch (err){
      F.toast(err.message || "Save failed");
      if (origSave) return origSave();
    }
  };

  const origOpen = F.openFlow;
  F.openFlow = function(){
    showFlows();
  };

  const origSetName = F.setProjectName;
  F.setProjectName = function(name){
    origSetName(name);
    if (F.collab && F.collab.notifyDoc) F.collab.notifyDoc();
  };

  document.getElementById("flowsClose").addEventListener("click", hideFlows);
  document.getElementById("flowsNew").addEventListener("click", async () => {
    hideFlows();
    await F.newProject();
  });
  document.getElementById("flowsImport").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("flowsModal").addEventListener("click", (e) => {
    if (e.target.id === "flowsModal") hideFlows();
  });

  const origLoad = F.loadFromText;
  F.loadFromText = function(text, fileName){
    try { JSON.parse(text); } catch (e) { origLoad(text, fileName); return; }
    origLoad(text, fileName);
    createFlow(S.projectName, snapshotData()).then(() => hideFlows()).catch(err => F.toast(err.message));
  };

  document.getElementById("publicBtn").addEventListener("click", async () => {
    if (!F.flowId){
      F.toast("Open a flow first");
      return;
    }
    if (!(F.flowShare && F.flowShare.isOwner)){
      F.toast("Only the owner can open this flow to the public");
      return;
    }
    const next = !(F.flowShare && F.flowShare.isPublic);
    try{
      const body = await F.api("/api/flows/" + F.flowId + "/share", {
        method: "POST",
        body: JSON.stringify({ public: next })
      });
      applyShareState(body);
      if (next){
        try { await navigator.clipboard.writeText(body.join_code); } catch (e) {}
        F.toast("Flow is public — code shown at the top");
      } else {
        F.toast("Flow is private again");
      }
    } catch (err){
      F.toast(err.message);
    }
  });

  document.getElementById("shareCodeBtn").addEventListener("click", async () => {
    const code = F.flowShare && F.flowShare.code;
    if (!code) return;
    try { await navigator.clipboard.writeText(code); } catch (e) {}
    F.toast("Copied " + code);
  });

  document.getElementById("flowsJoin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("joinCode");
    const code = (input.value || "").trim();
    if (!code) return;
    try{
      await redeemInvite(code);
      input.value = "";
      hideFlows();
    } catch (err){
      F.toast(err.message);
    }
  });
})();
