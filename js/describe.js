// describe.js — lossless graph analysis: flowchart → structured text.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;

  const COLOR_NAMES = {
    '#6ea8ff':'Blue', '#5ce1a6':'Green', '#ffd166':'Yellow', '#ff8f6b':'Orange',
    '#ff6b9d':'Pink', '#b18cff':'Purple', '#e8edf5':'Light Gray', '#8b97a8':'Gray'
  };

  const SHAPE_NAMES = { box:'Rectangle', ellipse:'Ellipse', triangle:'Triangle', diamond:'Diamond' };

  function centerOf(o){
    const s = G.normBox(o);
    return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  }

  function sortByPos(a, b){
    const ca = centerOf(a), cb = centerOf(b);
    if (Math.abs(ca.y - cb.y) > 20) return ca.y - cb.y;
    return ca.x - cb.x;
  }

  function colorLabel(hex){
    if (!hex) return 'Default (Dark)';
    return COLOR_NAMES[hex.toLowerCase()] || hex;
  }

  function nodeLabel(o){
    const t = (o.text || '').trim();
    if (t) return t;
    if (o.type === 'text') return '(Text annotation)';
    return '(Unlabeled step)';
  }

  function inferRole(o, indegree, outdegree, entryExcluded){
    const label = (o.text || '').toLowerCase();
    const shape = o.shape || 'box';
    if (o.type === 'text') return 'Reference';
    if (indegree === 0 && outdegree > 0 && !entryExcluded) return 'Start';
    if (outdegree === 0 && indegree > 0) return 'End';
    if (shape === 'diamond' || outdegree > 1) return 'Decision';
    if (/\breject|\bdenied|\bfail|\bdecline/.test(label)) return 'Rejection';
    if (/\bapprov|\baccept|\bconfirm|\bpass/.test(label)) return 'Approval';
    if (/\bai\b|artificial intelligence|generated|gpt/.test(label)) return 'AI Action';
    if (/database|\bdb\b|\bstore\b|\bstorage\b|\bsave\b/.test(label)) return 'Database Action';
    if (/\badmin\b|\bmanual\b|\buser\b|\brevision\b/.test(label)) return 'Manual Task';
    if (/\bsystem\b|\bautomated\b|\bauto\b|\bprocess\b/.test(label)) return 'System Action';
    if (/\bstatus\b|\bupdate\b|\bnotify\b/.test(label)) return 'Status Update';
    if (indegree === 0 && outdegree === 0) return 'Unknown';
    return 'Workflow State';
  }

  // Collect unique workflow nodes (shapes + standalone text annotations).
  function collectNodes(allowedShapeIds, scopedWorkflow){
    let shapes = S.objects.filter(o => o.type === 'shape');
    if (allowedShapeIds) shapes = shapes.filter(s => allowedShapeIds.has(s.id));
    shapes = shapes.sort(sortByPos);
    let texts = S.objects.filter(o => o.type === 'text' && (o.text || '').trim());
    if (allowedShapeIds){
      if (scopedWorkflow){
        texts = texts.filter(t => {
          const c = centerOf(t);
          return c.x >= scopedWorkflow.x && c.x <= scopedWorkflow.x + scopedWorkflow.w &&
            c.y >= scopedWorkflow.y && c.y <= scopedWorkflow.y + scopedWorkflow.h;
        });
      } else {
        texts = [];
      }
    }
    texts = texts.sort(sortByPos);
    const nodes = shapes.concat(texts);
    const shapeLabels = F.nodeLabelMap();
    const idToN = {};
    const nToNode = {};
    const nidOf = new Map();
    nodes.forEach((o, i) => {
      const nid = o.type === 'shape' && o.id && shapeLabels.has(o.id)
        ? shapeLabels.get(o.id)
        : 'N' + (i + 1);
      nidOf.set(o, nid);
      if (o.id) idToN[o.id] = nid;
      nToNode[nid] = o;
    });
    return { nodes, idToN, nToNode, nidOf, shapeIds: new Set(shapes.map(s => s.id)) };
  }

  // Build directed edge list between shape nodes only.
  function collectEdges(shapeIds){
    const edges = [];
    const loose = [];
    const seen = new Set();

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
      if (from && to && shapeIds.has(from) && shapeIds.has(to)){
        const key = from + '->' + to;
        if (!seen.has(key)){ seen.add(key); edges.push({ from, to }); }
      } else {
        loose.push(o);
      }
    }
    return { edges, loose };
  }

  function mapEdge(e, idToN){
    return { from: idToN[e.from], to: idToN[e.to], fromId: e.from, toId: e.to };
  }

  function buildAdj(mappedEdges){
    const out = {}, inn = {};
    for (const e of mappedEdges){
      if (!out[e.from]) out[e.from] = [];
      out[e.from].push(e.to);
      if (!inn[e.to]) inn[e.to] = [];
      inn[e.to].push(e.from);
    }
    return { out, inn };
  }

  function canReach(start, target, out){
    if (start === target) return true;
    const q = [start], seen = new Set([start]);
    while (q.length){
      const cur = q.shift();
      for (const n of (out[cur] || [])){
        if (n === target) return true;
        if (!seen.has(n)){ seen.add(n); q.push(n); }
      }
    }
    return false;
  }

  function findLoops(mappedEdges, out){
    const loops = [];
    const seen = new Set();
    mappedEdges.forEach(e => {
      const key = e.from + '->' + e.to;
      if (seen.has(key)) return;
      if (canReach(e.to, e.from, out)){
        seen.add(key);
        loops.push(e);
      }
    });
    return loops;
  }

  // Undirected connected components among shape nodes.
  function findComponents(shapeNodes, mappedEdges, idToN){
    const shapeNids = shapeNodes.map(s => idToN[s.id]);
    const parent = {};
    shapeNids.forEach(n => { parent[n] = n; });
    function find(x){ return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function unite(a, b){ parent[find(a)] = find(b); }

    for (const e of mappedEdges) unite(e.from, e.to);

    const groups = {};
    shapeNids.forEach(n => {
      const r = find(n);
      if (!groups[r]) groups[r] = [];
      groups[r].push(n);
    });

    // Text nodes are their own singleton components.
    return Object.values(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }

  function listOrNone(arr){ return arr.length ? arr.join('\n') : 'None'; }

  // Groups that receive at least one arrow from outside the group.
  function groupsWithExternalIncoming(nodeGroups, rawEdges){
    const incoming = new Set();
    for (const g of nodeGroups){
      const members = new Set(g.memberIds || []);
      for (const e of rawEdges){
        if (members.has(e.to) && !members.has(e.from)){ incoming.add(g.id); break; }
      }
    }
    return incoming;
  }

  // Detailed external arrows leading into each node group.
  function collectGroupEntries(nodeGroups, rawEdges, idToN){
    const byGroupId = new Map();
    for (const g of nodeGroups){
      byGroupId.set(g.id, { group: g, entries: [], entryTargets: new Set() });
    }
    for (const e of rawEdges){
      for (const g of nodeGroups){
        const members = new Set(g.memberIds || []);
        if (!members.has(e.to) || members.has(e.from)) continue;
        const rec = byGroupId.get(g.id);
        if (!rec) continue;
        rec.entries.push({
          from: idToN[e.from],
          to: idToN[e.to],
          fromId: e.from,
          toId: e.to
        });
        rec.entryTargets.add(idToN[e.to]);
      }
    }
    return byGroupId;
  }

  function isEntryExcluded(shapeId, nodeGroups, incomingGroupIds){
    if (!shapeId) return false;
    for (const g of nodeGroups){
      if (!incomingGroupIds.has(g.id)) continue;
      if ((g.memberIds || []).indexOf(shapeId) !== -1) return true;
    }
    return false;
  }

  function isWorkflowStart(o, inn, out, nid, nodeGroups, incomingGroupIds, workflowEntryShapeId){
    if (o.type !== 'shape') return false;
    if (workflowEntryShapeId){
      return o.id === workflowEntryShapeId;
    }
    if ((inn[nid] || []).length || !(out[nid] || []).length) return false;
    return !isEntryExcluded(o.id, nodeGroups, incomingGroupIds);
  }

  function graphDescription(nodes, out, inn, loops, nToNode, nidOf, idToN, nodeGroups, incomingGroupIds, groupEntries, gidOf, workflowEntryShapeId){
    const lines = [];
    const starts = nodes.filter(o => isWorkflowStart(o, inn, out, nidOf.get(o), nodeGroups, incomingGroupIds, workflowEntryShapeId));
    const ends = nodes.filter(o => o.type === 'shape' && !(out[nidOf.get(o)] || []).length && (inn[nidOf.get(o)] || []).length);

    if (starts.length){
      lines.push('The workflow begins at ' + starts.map(s => nidOf.get(s) + ' ("' + nodeLabel(s) + '")').join(', ') + '.');
    }

    for (const g of nodeGroups){
      const rec = groupEntries.get(g.id);
      if (!rec || !rec.entries.length) continue;
      const gid = gidOf.get(g);
      const gLabel = (g.label || '').trim() || '(Unlabeled group)';
      const memberNids = (g.memberIds || []).map(sid => idToN[sid]).filter(Boolean);
      const edgeLines = rec.entries.map(e => {
        const target = nToNode[e.to];
        return e.from + ' -> ' + e.to + (target ? ' ("' + nodeLabel(target) + '")' : '');
      });
      lines.push(
        gid + ' ("' + gLabel + '") is a group entry point: ' + edgeLines.join('; ') +
        '. External flow enters the group here (members ' + memberNids.join(', ') + ' are reached via this group, not as separate workflow starts).'
      );
    }
    const branchSources = Object.keys(out).filter(n => out[n].length > 1);
    if (branchSources.length){
      branchSources.forEach(nid => {
        const o = nToNode[nid];
        lines.push(nid + ' ("' + nodeLabel(o) + '") branches to ' + out[nid].join(', ') + '.');
      });
    }
    const mergeTargets = Object.keys(inn).filter(n => inn[n].length > 1);
    if (mergeTargets.length){
      mergeTargets.forEach(nid => {
        const o = nToNode[nid];
        lines.push(nid + ' ("' + nodeLabel(o) + '") is reached from ' + inn[nid].join(', ') + '.');
      });
    }
    if (loops.length){
      lines.push(loops.length + ' loop(s) return to earlier step(s) without re-expanding those subgraphs.');
    }
    if (ends.length){
      lines.push('Terminal step(s): ' + ends.map(s => nidOf.get(s) + ' ("' + nodeLabel(s) + '")').join(', ') + '.');
    }
    if (!lines.length) lines.push('No connected workflow path detected. See NODE and EDGE sections for the full graph.');
    return lines.join('\n');
  }

  F.describeFlow = function(options){
    options = options || {};
    const workflowId = options.workflowId || null;
    const scopedWorkflow = workflowId && F.workflowById ? F.workflowById(workflowId) : null;
    const allowedShapeIds = scopedWorkflow && F.resolveWorkflowShapeIds
      ? F.resolveWorkflowShapeIds(scopedWorkflow)
      : null;

    const { nodes, idToN, nToNode, nidOf, shapeIds } = collectNodes(allowedShapeIds, scopedWorkflow);
    let groups = S.objects.filter(o => o.type === 'group');
    if (scopedWorkflow){
      const wfGroupIds = new Set(scopedWorkflow.groupIds || []);
      groups = groups.filter(g =>
        wfGroupIds.has(g.id) ||
        (g.memberIds || []).some(sid => shapeIds.has(sid))
      );
    }
    groups = groups.sort((a, b) => {
      const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
      const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      if (Math.abs(ca.y - cb.y) > 20) return ca.y - cb.y;
      return ca.x - cb.x;
    });
    const gidOf = new Map();
    groups.forEach((g, i) => gidOf.set(g, 'G' + (i + 1)));
    const shapeToGids = {};
    groups.forEach(g => {
      const gid = gidOf.get(g);
      (g.memberIds || []).forEach(sid => {
        if (idToN[sid]) (shapeToGids[idToN[sid]] = shapeToGids[idToN[sid]] || []).push(gid);
      });
    });
    const shapeNodes = nodes.filter(o => o.type === 'shape');
    const { edges, loose } = collectEdges(shapeIds);
    const incomingGroupIds = groupsWithExternalIncoming(groups, edges);
    const groupEntries = collectGroupEntries(groups, edges, idToN);
    const groupEntryCount = [...groupEntries.values()].filter(r => r.entries.length).length;
    const mappedEdges = edges.map(e => mapEdge(e, idToN));
    const { out, inn } = buildAdj(mappedEdges);
    const loops = findLoops(mappedEdges, out);
    const branches = Object.keys(out).filter(n => out[n].length > 1);
    const merges = Object.keys(inn).filter(n => inn[n].length > 1);
    const components = findComponents(shapeNodes, mappedEdges, idToN);

    const workflowEntryShapeId = scopedWorkflow ? scopedWorkflow.entryShapeId : null;

    if (!nodes.length) return scopedWorkflow
      ? 'This workflow has no nodes.'
      : 'This diagram is empty.';

    const L = [];
    const hr = '=====================================';
    L.push(hr);
    L.push('');
    if (scopedWorkflow){
      L.push('WORKFLOW SCOPE');
      L.push('');
      L.push('Name: ' + (scopedWorkflow.name || '(Unnamed workflow)'));
      L.push('Shapes: ' + shapeIds.size);
      L.push('Node groups: ' + (scopedWorkflow.groupIds || []).length);
      if (workflowEntryShapeId && idToN[workflowEntryShapeId]){
        const entryNode = nToNode[idToN[workflowEntryShapeId]];
        L.push('Entry: ' + idToN[workflowEntryShapeId] + ' ("' + nodeLabel(entryNode) + '")');
      } else {
        L.push('Entry: (auto-detect from graph)');
      }
      L.push('');
      L.push(hr);
      L.push('');
    }
    L.push('GRAPH SUMMARY');
    L.push('');
    L.push('Number of Nodes: ' + nodes.length);
    L.push('Number of Edges: ' + mappedEdges.length);
    L.push('Number of Loops: ' + loops.length);
    L.push('Number of Branches: ' + branches.length);
    L.push('Number of Merge Points: ' + merges.length);
    L.push('Number of Groups: ' + groups.length);
    L.push('Number of Group Entry Points: ' + groupEntryCount);
    // Count disconnected subgraphs: connected shape components + isolated text nodes.
    const textOnly = nodes.filter(o => o.type === 'text').map(o => nidOf.get(o));
    const disconnectedCount = components.length + textOnly.length;

    L.push('Number of Disconnected Graphs: ' + (disconnectedCount || (shapeNodes.length ? 1 : 0)));
    if (S.projectName) L.push('Project: ' + S.projectName);
    L.push('');
    L.push(hr);
    L.push('');
    L.push('NODES');
    L.push('');

    nodes.forEach(o => {
      const nid = nidOf.get(o);
      const outList = o.type === 'shape' ? (out[nid] || []) : [];
      const inList = o.type === 'shape' ? (inn[nid] || []) : [];
      const role = (workflowEntryShapeId && o.id === workflowEntryShapeId)
        ? 'Start'
        : inferRole(o, inList.length, outList.length,
          o.type === 'shape' && (
            isEntryExcluded(o.id, groups, incomingGroupIds) ||
            (workflowEntryShapeId && inList.length === 0 && outList.length > 0)
          ));

      L.push('[' + nid + ']');
      L.push('');
      L.push('Label:');
      L.push(nodeLabel(o));
      L.push('');
      L.push('Role:');
      L.push(role);
      L.push('');
      L.push('Color:');
      L.push(o.type === 'shape' ? colorLabel(o.fill) : (o.color ? colorLabel(o.color) : 'N/A'));
      L.push('');
      L.push('Shape:');
      L.push(o.type === 'shape' ? (SHAPE_NAMES[o.shape] || 'Rectangle') : 'Text');
      L.push('');
      if (o.type === 'shape'){
        const gids = shapeToGids[nid];
        L.push('Group:');
        L.push(gids && gids.length ? gids.join(', ') : 'None');
        L.push('');
      }
      L.push('Outgoing:');
      L.push(listOrNone(outList));
      L.push('');
      L.push('Incoming:');
      L.push(listOrNone(inList));
      L.push('');
      L.push('-------------------------------------');
      L.push('');
    });

    L.push(hr);
    L.push('');
    L.push('GROUPS');
    L.push('');
    if (groups.length){
      groups.forEach(g => {
        const gid = gidOf.get(g);
        const members = (g.memberIds || []).map(sid => idToN[sid]).filter(Boolean);
        L.push('[' + gid + ']');
        L.push('');
        L.push('Label:');
        L.push((g.label || '').trim() || '(Unlabeled group)');
        L.push('');
        L.push('Color:');
        L.push(colorLabel(g.color));
        L.push('');
        L.push('Members:');
        L.push(members.length ? members.join('\n') : 'None');
        L.push('');
        const rec = groupEntries.get(g.id);
        if (rec && rec.entries.length){
          L.push('Group Entry Point:');
          L.push('Yes');
          L.push('');
          L.push('External Incoming:');
          rec.entries.forEach(e => {
            const target = nToNode[e.to];
            L.push(e.from + ' -> ' + e.to + (target ? ' ("' + nodeLabel(target) + '")' : ''));
          });
          L.push('');
          L.push('Entry Targets:');
          L.push([...rec.entryTargets].join('\n'));
          L.push('');
          L.push('Accessible Members:');
          L.push(members.length ? members.join('\n') : 'None');
        } else {
          L.push('Group Entry Point:');
          L.push('No');
        }
        L.push('');
        L.push('-------------------------------------');
        L.push('');
      });
    } else {
      L.push('(none)');
      L.push('');
    }

    L.push(hr);
    L.push('');
    L.push('GROUP ENTRY POINTS');
    L.push('');
    const entryGroups = groups.filter(g => (groupEntries.get(g.id)?.entries.length || 0) > 0);
    if (entryGroups.length){
      entryGroups.forEach((g, i) => {
        const gid = gidOf.get(g);
        const rec = groupEntries.get(g.id);
        L.push('Entry ' + (i + 1));
        L.push('');
        L.push('Group:');
        L.push(gid);
        L.push('');
        L.push('Label:');
        L.push((g.label || '').trim() || '(Unlabeled group)');
        L.push('');
        L.push('External Incoming:');
        L.push('');
        rec.entries.forEach(e => {
          const fromNode = nToNode[e.from], toNode = nToNode[e.to];
          L.push(e.from + ' -> ' + e.to +
            (fromNode && toNode ? ' ("' + nodeLabel(fromNode) + '" enters at "' + nodeLabel(toNode) + '")' : ''));
        });
        L.push('');
        L.push('Entry Targets:');
        L.push('');
        [...rec.entryTargets].forEach(t => L.push(t));
        L.push('');
        L.push('Provides Access To Members:');
        L.push('');
        (g.memberIds || []).map(sid => idToN[sid]).filter(Boolean).forEach(m => L.push(m));
        L.push('');
      });
    } else {
      L.push('(none)');
      L.push('');
    }

    L.push(hr);
    L.push('');
    L.push('EDGE LIST');
    L.push('');
    if (mappedEdges.length){
      mappedEdges.forEach(e => L.push(e.from + ' -> ' + e.to));
    } else {
      L.push('(none)');
    }
    L.push('');
    L.push(hr);
    L.push('');
    L.push('LOOPS');
    L.push('');
    if (loops.length){
      loops.forEach((e, i) => {
        L.push('Loop ' + (i + 1));
        L.push('');
        L.push('From:');
        L.push(e.from);
        L.push('');
        L.push('Returns To:');
        L.push(e.to);
        const fromNode = nToNode[e.from], toNode = nToNode[e.to];
        if (fromNode && toNode){
          L.push('');
          L.push('Reason:');
          L.push('Edge from "' + nodeLabel(fromNode) + '" returns to "' + nodeLabel(toNode) + '".');
        }
        L.push('');
      });
    } else {
      L.push('(none)');
    }
    L.push(hr);
    L.push('');
    L.push('BRANCHES');
    L.push('');
    if (branches.length){
      branches.forEach((nid, i) => {
        L.push('Branch ' + (i + 1));
        L.push('');
        L.push('Source:');
        L.push(nid);
        L.push('');
        L.push('Targets:');
        L.push('');
        out[nid].forEach(t => L.push(t));
        L.push('');
      });
    } else {
      L.push('(none)');
    }
    L.push(hr);
    L.push('');
    L.push('MERGE POINTS');
    L.push('');
    if (merges.length){
      merges.forEach((nid, i) => {
        L.push('Merge ' + (i + 1));
        L.push('');
        L.push('Target:');
        L.push(nid);
        L.push('');
        L.push('Incoming:');
        L.push('');
        inn[nid].forEach(s => L.push(s));
        L.push('');
      });
    } else {
      L.push('(none)');
    }
    L.push(hr);
    L.push('');
    L.push('DISCONNECTED GRAPHS');
    L.push('');
    if (components.length > 1){
      components.forEach((comp, i) => {
        L.push('Graph ' + (i + 1));
        L.push('Nodes: ' + comp.join(', '));
        L.push('');
      });
    } else if (components.length === 1){
      L.push('Graph 1');
      L.push('Nodes: ' + components[0].join(', '));
      L.push('');
    } else {
      L.push('(no connected shape subgraphs)');
      L.push('');
    }
    if (textOnly.length){
      textOnly.forEach((nid, i) => {
        L.push('Graph ' + (components.length + i + 1) + ' (text annotation)');
        L.push('Nodes: ' + nid);
        L.push('');
      });
    }

    // Isolated shape nodes (no edges at all).
    const connected = new Set();
    mappedEdges.forEach(e => { connected.add(e.from); connected.add(e.to); });
    const isolated = shapeNodes
      .map(s => idToN[s.id])
      .filter(nid => !connected.has(nid));
    if (isolated.length){
      L.push('Isolated nodes (no edges): ' + isolated.join(', '));
      L.push('');
    }

    if (loose.length){
      L.push('Unattached arrows: ' + loose.length);
      L.push('');
    }

    L.push(hr);
    L.push('');
    L.push('GRAPH DESCRIPTION');
    L.push('');
    let desc = graphDescription(nodes, out, inn, loops, nToNode, nidOf, idToN, groups, incomingGroupIds, groupEntries, gidOf, workflowEntryShapeId);
    if (groups.length && !groupEntryCount) desc += '\n' + groups.length + ' node group(s) organize related steps (see GROUPS).';
    L.push(desc);

    return L.join('\n');
  };

  // ---- Describe modal UI ---------------------------------------------------
  const modal = document.getElementById('describeModal');
  const output = document.getElementById('describeOutput');
  const closeBtn = document.getElementById('describeClose');
  const copyBtn = document.getElementById('describeCopy');
  const runBtn = document.getElementById('describeRun');
  const scopeWrap = document.getElementById('describeScopeWrap');
  const workflowSelect = document.getElementById('describeWorkflow');

  function populateWorkflowPicker(){
    const workflows = F.listWorkflows ? F.listWorkflows() : [];
    workflowSelect.innerHTML = '';
    if (!workflows.length){
      scopeWrap.hidden = true;
      return null;
    }
    scopeWrap.hidden = false;
    const entire = document.createElement('option');
    entire.value = '';
    entire.textContent = 'Entire diagram';
    workflowSelect.appendChild(entire);
    workflows.forEach(wf => {
      const opt = document.createElement('option');
      opt.value = wf.id;
      opt.textContent = wf.name || 'Workflow';
      workflowSelect.appendChild(opt);
    });
    if (workflows.length) workflowSelect.value = workflows[0].id;
    return workflows;
  }

  function selectedWorkflowId(){
    return workflowSelect.value || null;
  }

  function runDescribe(){
    output.value = F.describeFlow({ workflowId: selectedWorkflowId() });
  }

  F.showDescribe = function(){
    populateWorkflowPicker();
    runDescribe();
    modal.classList.add('show');
  };

  F.hideDescribe = function(){
    modal.classList.remove('show');
  };

  document.getElementById('describeBtn').addEventListener('click', F.showDescribe);
  closeBtn.addEventListener('click', F.hideDescribe);
  modal.addEventListener('click', (e) => { if (e.target === modal) F.hideDescribe(); });
  if (runBtn) runBtn.addEventListener('click', runDescribe);
  if (workflowSelect) workflowSelect.addEventListener('change', runDescribe);
  copyBtn.addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(output.value);
      F.toast('Copied ✓');
    } catch (e){
      output.select();
      document.execCommand('copy');
      F.toast('Copied ✓');
    }
  });
})();
