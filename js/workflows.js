// workflows.js — superficial workflow regions, auto-grown from an entry node.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;

  F.WORKFLOW_PADDING = 32;
  F.WORKFLOW_TAB_H = 22;

  function shapeById(id){
    return S.objects.find(o => o.type === 'shape' && o.id === id) || null;
  }

  function groupById(id){
    return S.objects.find(o => o.type === 'group' && o.id === id) || null;
  }

  function buildOutAdj(){
    const out = {};
    for (const o of S.objects){
      if (o.type !== 'arrow') continue;
      let from = o.from, to = o.to;
      if (from == null){
        const sh = F.bindShapeForPoint(o.pts[0], F.CONNECT_SNAP);
        if (sh) from = sh.id;
      }
      if (to == null){
        const sh = F.bindShapeForPoint(o.pts[o.pts.length - 1], F.CONNECT_SNAP);
        if (sh) to = sh.id;
      }
      if (from && to){
        if (!out[from]) out[from] = [];
        if (out[from].indexOf(to) === -1) out[from].push(to);
      }
    }
    return out;
  }

  function buildUndirectedAdj(){
    const adj = {};
    function link(a, b){
      if (!a || !b || a === b) return;
      if (!adj[a]) adj[a] = [];
      if (!adj[b]) adj[b] = [];
      if (adj[a].indexOf(b) === -1) adj[a].push(b);
      if (adj[b].indexOf(a) === -1) adj[b].push(a);
    }
    for (const o of S.objects){
      if (o.type !== 'arrow') continue;
      let from = o.from, to = o.to;
      if (from == null){
        const sh = F.bindShapeForPoint(o.pts[0], F.CONNECT_SNAP);
        if (sh) from = sh.id;
      }
      if (to == null){
        const sh = F.bindShapeForPoint(o.pts[o.pts.length - 1], F.CONNECT_SNAP);
        if (sh) to = sh.id;
      }
      link(from, to);
    }
    return adj;
  }

  // All shapes connected to the entry by any arrow path (both directions).
  F.workflowMemberIds = function(entryId){
    if (!entryId || !shapeById(entryId)) return [];
    const adj = buildUndirectedAdj();
    const seen = new Set();
    const q = [entryId];
    while (q.length){
      const cur = q.shift();
      if (seen.has(cur) || !shapeById(cur)) continue;
      seen.add(cur);
      for (const next of (adj[cur] || [])) q.push(next);
    }
    return [...seen];
  };

  F.reachableFromEntry = function(entryId){
    if (!entryId || !shapeById(entryId)) return [];
    const out = buildOutAdj();
    const seen = new Set();
    const q = [entryId];
    while (q.length){
      const cur = q.shift();
      if (seen.has(cur)) continue;
      if (!shapeById(cur)) continue;
      seen.add(cur);
      for (const next of (out[cur] || [])) q.push(next);
    }
    return [...seen];
  };

  function computeGroupIds(shapeIds){
    const set = new Set(shapeIds);
    return S.objects.filter(o =>
      o.type === 'group' &&
      (o.memberIds || []).length &&
      (o.memberIds || []).every(id => set.has(id))
    ).map(g => g.id);
  }

  F.recomputeWorkflowMembers = function(workflow){
    if (!workflow || workflow.type !== 'workflow' || !workflow.entryShapeId) return false;
    workflow.shapeIds = F.workflowMemberIds(workflow.entryShapeId);
    workflow.groupIds = computeGroupIds(workflow.shapeIds);
    return workflow.shapeIds.length > 0;
  };

  F.resolveWorkflowShapeIds = function(workflow){
    const ids = new Set(workflow.shapeIds || []);
    for (const gid of (workflow.groupIds || [])){
      const g = groupById(gid);
      if (g) (g.memberIds || []).forEach(id => ids.add(id));
    }
    return ids;
  };

  F.workflowContainsShape = function(workflow, shapeId){
    if (!workflow || workflow.type !== 'workflow' || !shapeId) return false;
    return (workflow.shapeIds || []).indexOf(shapeId) !== -1;
  };

  F.workflowsForShapeId = function(shapeId){
    return S.objects.filter(o => o.type === 'workflow' && F.workflowContainsShape(o, shapeId));
  };

  F.workflowForEntryShapeId = function(shapeId){
    return S.objects.find(o => o.type === 'workflow' && o.entryShapeId === shapeId) || null;
  };

  F.listWorkflows = function(){
    return S.objects.filter(o => o.type === 'workflow');
  };

  F.workflowById = function(id){
    return S.objects.find(o => o.type === 'workflow' && o.id === id) || null;
  };

  function memberBounds(workflow){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    for (const id of F.resolveWorkflowShapeIds(workflow)){
      const sh = shapeById(id);
      if (!sh) continue;
      const b = G.normBox(sh);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      any = true;
    }
    if (!any) return null;
    return { minX, minY, maxX, maxY };
  }

  F.recomputeWorkflowBounds = function(workflow){
    const b = memberBounds(workflow);
    if (!b){
      workflow.x = workflow.y = workflow.w = workflow.h = 0;
      return false;
    }
    const pad = workflow.padding != null ? workflow.padding : F.WORKFLOW_PADDING;
    workflow.x = b.minX - pad;
    workflow.y = b.minY - pad;
    workflow.w = b.maxX - b.minX + pad * 2;
    workflow.h = b.maxY - b.minY + pad * 2;
    return true;
  };

  function insertIndexForWorkflow(){
    let idx = 0;
    for (let i = 0; i < S.objects.length; i++){
      if (S.objects[i].type === 'workflow') idx = i + 1;
    }
    return idx;
  }

  F.syncAllWorkflows = function(){
    const toRemove = [];
    for (const o of S.objects){
      if (o.type !== 'workflow') continue;
      if (!o.entryShapeId || !shapeById(o.entryShapeId)){
        toRemove.push(o);
        continue;
      }
      if (!F.recomputeWorkflowMembers(o) || !F.recomputeWorkflowBounds(o)) toRemove.push(o);
    }
    if (toRemove.length){
      const drop = new Set(toRemove);
      S.objects = S.objects.filter(o => !drop.has(o));
    }
  };

  F.filterSelectable = function(objects){
    return (objects || []).filter(o => o && o.type !== 'workflow');
  };

  F.applySelection = function(objects){
    const sel = F.filterSelectable(objects);
    S.selection = sel;
    S.selected = sel.length ? sel[sel.length - 1] : null;
    return sel;
  };

  F.setWorkflowEntryFromSelection = function(){
    const sel = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
    const shape = sel.find(o => o.type === 'shape' && o.id);
    if (!shape){
      F.toast('Select a shape to use as the workflow entry');
      return null;
    }

    let workflow = F.workflowForEntryShapeId(shape.id);
    const creating = !workflow;

    if (creating){
      const defaultName = 'Workflow ' + (F.listWorkflows().length + 1);
      const label = (shape.text || '').trim();
      const suggested = label ? label.slice(0, 40) : defaultName;
      const name = window.prompt('Workflow name:', suggested);
      if (name == null) return null;
      F.pushHistory();
      workflow = {
        type: 'workflow',
        id: F.uid(),
        name: name.trim() || suggested || defaultName,
        entryShapeId: shape.id,
        shapeIds: [],
        groupIds: [],
        padding: F.WORKFLOW_PADDING,
        color: '#8b97a8',
        x: 0, y: 0, w: 0, h: 0,
        t0: F.now()
      };
      S.objects.splice(insertIndexForWorkflow(), 0, workflow);
    } else {
      F.pushHistory();
    }

    F.recomputeWorkflowMembers(workflow);
    F.recomputeWorkflowBounds(workflow);
    F.syncAllWorkflows();
    F.applySelection([shape]);
    F.toast(creating
      ? 'Workflow created from entry ✓'
      : 'Workflow updated from entry ✓');
    return workflow;
  };

  F.deleteWorkflowSelection = function(){
    const sel = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
    let workflows = sel.filter(o => o.type === 'workflow');
    if (!workflows.length){
      const shape = sel.find(o => o.type === 'shape' && o.id);
      if (shape){
        const wf = F.workflowForEntryShapeId(shape.id);
        if (wf) workflows = [wf];
      }
    }
    if (!workflows.length){
      F.toast('Select a workflow (or its entry shape) to remove');
      return;
    }
    F.pushHistory();
    const drop = new Set(workflows);
    S.objects = S.objects.filter(o => !drop.has(o));
    S.selected = null;
    S.selection = [];
    F.toast('Workflow removed ✓');
  };

  F.editWorkflowName = function(workflow){
    const next = window.prompt('Workflow name:', workflow.name || '');
    if (next == null) return;
    F.pushHistory();
    workflow.name = next.trim() || workflow.name || 'Workflow';
  };

  F.workflowTabMetrics = function(workflow, camScale){
    camScale = camScale || F.cam.scale;
    const s = G.normBox(workflow);
    const tabH = F.WORKFLOW_TAB_H / camScale;
    const padX = 10 / camScale;
    const label = workflow.name || 'Workflow';
    const ctx = F.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '600 12px system-ui, sans-serif';
    const textW = ctx.measureText(label).width / camScale;
    ctx.restore();
    const w = textW + padX * 2;
    return {
      x: s.x,
      y: s.y - tabH,
      w,
      h: tabH,
      padX,
      label,
      fontSize: 12 / camScale
    };
  };

  F.pointInWorkflowLabel = function(p, workflow){
    const tab = F.workflowTabMetrics(workflow);
    return p.x >= tab.x && p.x <= tab.x + tab.w && p.y >= tab.y && p.y <= tab.y + tab.h;
  };

  // Topmost workflow title tab under the point (drag handle).
  F.workflowTitleAt = function(p){
    for (let i = S.objects.length - 1; i >= 0; i--){
      const o = S.objects[i];
      if (o.type === 'workflow' && F.pointInWorkflowLabel(p, o)) return o;
    }
    return null;
  };

  F.buildWorkflowMoveGroup = function(workflow){
    const shapeIds = F.resolveWorkflowShapeIds(workflow);
    const seen = new Set();
    const group = [];
    function add(o){
      if (!o || seen.has(o)) return;
      seen.add(o);
      group.push({
        obj: o,
        orig: o.type === 'arrow'
          ? o.pts.map(pt => ({ x: pt.x, y: pt.y }))
          : { x: o.x, y: o.y }
      });
    }
    add(workflow);
    for (const id of shapeIds) add(shapeById(id));
    for (const gid of (workflow.groupIds || [])) add(groupById(gid));
    return group;
  };

  F.groupInWorkflow = function(group){
    if (!group || group.type !== 'group') return false;
    return S.objects.some(o =>
      o.type === 'workflow' && (o.groupIds || []).indexOf(group.id) !== -1
    );
  };

  F.pointInWorkflow = function(p, workflow){
    if (F.pointInWorkflowLabel(p, workflow)) return true;
    const s = G.normBox(workflow);
    if (p.x < s.x || p.x > s.x + s.w || p.y < s.y || p.y > s.y + s.h) return false;
    if (F.shapeAt(p)) return false;
    for (const o of S.objects){
      if (o.type === 'group' && F.pointInGroup && F.pointInGroup(p, o)) return false;
    }
    return true;
  };
})();
