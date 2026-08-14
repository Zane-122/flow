// groups.js — semantic node groups (padded halo around related shapes).
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo;

  F.GROUP_PADDING = 14;

  function shapeById(id){
    return S.objects.find(o => o.type === 'shape' && o.id === id) || null;
  }

  function memberObjects(group){
    return (group.memberIds || []).map(shapeById).filter(Boolean);
  }

  function dominantMemberColor(members){
    const counts = {};
    for (const m of members){
      const key = m.fill || '__default__';
      counts[key] = (counts[key] || 0) + 1;
    }
    let best = '__default__', bestN = 0;
    for (const k in counts){
      if (counts[k] > bestN){ bestN = counts[k]; best = k; }
    }
    if (best === '__default__') return S.color || '#6ea8ff';
    return best;
  }

  F.applyGroupColor = function(group, color){
    if (!group || group.type !== 'group') return;
    group.color = color;
    for (const id of (group.memberIds || [])){
      const sh = shapeById(id);
      if (sh) sh.fill = color;
    }
  };

  F.syncGroupColor = function(group){
    const members = memberObjects(group);
    if (!members.length) return;
    F.applyGroupColor(group, dominantMemberColor(members));
  };

  F.recomputeGroupBounds = function(group){
    const members = memberObjects(group);
    if (!members.length){
      group.x = group.y = group.w = group.h = 0;
      return false;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members){
      const b = G.normBox(m);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = group.padding != null ? group.padding : F.GROUP_PADDING;
    group.x = minX - pad;
    group.y = minY - pad;
    group.w = maxX - minX + pad * 2;
    group.h = maxY - minY + pad * 2;
    return true;
  };

  function insertIndexForGroup(memberIds){
    let idx = S.objects.length;
    for (let i = 0; i < S.objects.length; i++){
      const o = S.objects[i];
      if (o.type === 'shape' && memberIds.indexOf(o.id) !== -1) idx = Math.min(idx, i);
    }
    return idx;
  }
  F.insertIndexForGroup = insertIndexForGroup;

  function removeIdsFromOtherGroups(ids, except){
    for (const o of S.objects){
      if (o.type !== 'group' || o === except) continue;
      o.memberIds = (o.memberIds || []).filter(id => ids.indexOf(id) === -1);
    }
  }

  F.syncAllGroups = function(){
    const toRemove = [];
    for (const o of S.objects){
      if (o.type !== 'group') continue;
      o.memberIds = (o.memberIds || []).filter(id => shapeById(id));
      if (!o.memberIds.length || !F.recomputeGroupBounds(o)) toRemove.push(o);
    }
    if (toRemove.length){
      const drop = new Set(toRemove);
      S.objects = S.objects.filter(o => !drop.has(o));
    }
  };

  F.createGroupFromSelection = function(){
    const sel = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
    const shapeIds = sel.filter(o => o.type === 'shape' && o.id).map(o => o.id);
    const unique = [...new Set(shapeIds)];
    if (unique.length < 2){
      F.toast('Select 2+ shapes to group');
      return null;
    }
    F.pushHistory();
    removeIdsFromOtherGroups(unique, null);
    const members = unique.map(shapeById).filter(Boolean);
    const color = dominantMemberColor(members);
    const group = {
      type: 'group',
      id: F.uid(),
      memberIds: unique,
      label: '',
      color,
      padding: F.GROUP_PADDING,
      x: 0, y: 0, w: 0, h: 0,
      t0: F.now()
    };
    F.recomputeGroupBounds(group);
    members.forEach(m => { m.fill = color; });
    const idx = insertIndexForGroup(unique);
    S.objects.splice(idx, 0, group);
    F.syncAllGroups();
    S.selected = group;
    S.selection = [group];
    F.toast('Group created ✓');
    return group;
  };

  F.ungroupSelection = function(){
    const sel = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
    const groups = sel.filter(o => o.type === 'group');
    if (!groups.length){
      F.toast('Select a group to ungroup');
      return;
    }
    F.pushHistory();
    const drop = new Set(groups);
    S.objects = S.objects.filter(o => !drop.has(o));
    S.selected = null;
    S.selection = [];
    F.toast('Ungrouped ✓');
  };

  F.editGroupLabel = function(group){
    const next = window.prompt('Group label (optional):', group.label || '');
    if (next == null) return;
    F.pushHistory();
    group.label = next.trim();
  };

  F.groupsForShapeId = function(shapeId){
    return S.objects.filter(o => o.type === 'group' && (o.memberIds || []).indexOf(shapeId) !== -1);
  };

  // Arrow routing target: group envelope when external, individual shape when internal.
  F.arrowTargetForShape = function(shape, otherShape){
    if (!shape) return null;
    const group = F.groupsForShapeId(shape.id)[0] || null;
    if (!group) return shape;
    if (otherShape){
      const otherGroup = F.groupsForShapeId(otherShape.id)[0] || null;
      if (otherGroup === group) return shape;
    }
    return group;
  };

  F.pointInGroup = function(p, group){
    const s = G.normBox(group);
    return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
  };
})();
