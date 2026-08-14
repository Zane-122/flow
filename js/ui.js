// ui.js — toolbar, palette, HUD, help wiring.
(function(){
  "use strict";
  const F = window.Flow, S = F.state;

  const hudTool = document.getElementById('hudTool');
  const hudNext = document.getElementById('hudNext');
  const hudDot  = document.getElementById('hudDot');

  F.updateHUD = function(){
    const shapeActive = S.wHeld || S.tool === 'shape';
    if (S.tool === 'select'){
      hudTool.textContent = 'Select';
      hudNext.innerHTML = 'Click to select · drag to move · <b>⌘G</b> group · <b>⌘⇧W</b> entry · <b>⌫</b> delete';
    } else if (S.tool === 'fill'){
      hudTool.textContent = 'Fill';
      hudNext.innerHTML = 'Click a shape to color it';
    } else if (S.tool === 'text'){
      hudTool.textContent = 'Text';
      hudNext.innerHTML = 'Click to place · type · <b>Enter</b> to finish';
    } else if (S.tool === 'hand'){
      hudTool.textContent = 'Pan';
      hudNext.innerHTML = 'Drag to move around the canvas';
    } else if (shapeActive){
      const drag = S.drag;
      const cur = (drag && drag.active && drag.mode === 'shape') ? drag.preview.shape : F.SHAPES[S.shapeIndex % F.SHAPES.length];
      const sz = F.SHAPE_SIZES[S.sizeIndex].label;
      hudTool.textContent = 'Shapes';
      hudNext.innerHTML = `<b>${F.SHAPE_LABEL[cur]}</b> · size <b>${sz}</b> · <b>W</b> shape · <b>Q</b> size`;
    } else {
      hudTool.textContent = 'Arrows';
      hudNext.innerHTML = 'Hold <b>W</b> + drag to make shapes';
    }
    hudDot.style.background = S.color;
    hudDot.style.boxShadow = `0 0 10px ${S.color}`;
    if (F.updateShapeBar) F.updateShapeBar();
    if (F.updateArrowBar) F.updateArrowBar();
    if (F.updateTextBar) F.updateTextBar();
  };

  F.setTool = function(t){
    S.tool = t;
    document.querySelectorAll('.bar .btn[data-tool]').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === t));
    F.updateCursor();
    F.updateHUD();
  };

  // ---- Project name --------------------------------------------------------
  const projectInput = document.getElementById('projectName');

  F.updateProjectUI = function(){
    if (projectInput && document.activeElement !== projectInput){
      projectInput.value = S.projectName || 'Untitled';
    }
    document.title = 'Flow — ' + (S.projectName || 'Untitled');
  };

  function commitProjectName(){
    const val = projectInput.value.trim() || 'Untitled';
    if (val !== S.projectName) F.setProjectName(val);
    else projectInput.value = S.projectName;
  }

  // ---- Shape sub-toolbar (visible when the Shape tool is active) -----------
  const SHAPE_ICON = {
    box: '<rect x="4" y="7" width="16" height="10" rx="2"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    triangle: '<path d="M12 5 L20 18 L4 18 Z"/>',
    diamond: '<path d="M12 4 L20 12 L12 20 L4 12 Z"/>'
  };
  const shapeBar = document.getElementById('shapeBar');

  function buildShapeBar(){
    const shapeSeg = document.getElementById('shapeSeg');
    F.SHAPES.forEach((sh, i) => {
      const b = document.createElement('button');
      b.title = F.SHAPE_LABEL[sh];
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${SHAPE_ICON[sh]}</svg>`;
      b.addEventListener('click', () => { S.shapeIndex = i; F.setTool('shape'); });
      shapeSeg.appendChild(b);
    });
    const sizeSeg = document.getElementById('sizeSeg');
    F.SHAPE_SIZES.forEach((sz, i) => {
      const b = document.createElement('button');
      b.textContent = sz.label;
      b.title = sz.w ? `${sz.w}×${sz.h}` : 'Drag to size';
      b.addEventListener('click', () => { S.sizeIndex = i; F.setTool('shape'); });
      sizeSeg.appendChild(b);
    });
  }

  F.updateShapeBar = function(){
    const active = S.tool === 'shape' || S.wHeld;
    shapeBar.classList.toggle('show', active);
    const shapeBtns = document.querySelectorAll('#shapeSeg button');
    shapeBtns.forEach((b, i) => b.classList.toggle('active', i === S.shapeIndex % F.SHAPES.length));
    const sizeBtns = document.querySelectorAll('#sizeSeg button');
    sizeBtns.forEach((b, i) => b.classList.toggle('active', i === S.sizeIndex));
  };

  // ---- Line (arrow) sub-toolbar -------------------------------------------
  const arrowBar = document.getElementById('arrowBar');
  const WIDTHS = [{ label: 'Thin', w: 2 }, { label: 'Med', w: 3.5 }, { label: 'Thick', w: 6 }];

  function selArrow(){ return (S.selected && S.selected.type === 'arrow') ? S.selected : null; }
  function applyArrow(setDefault, setObj){
    setDefault();
    const a = selArrow();
    if (a){ F.pushHistory(); setObj(a); }
    F.updateHUD();
  }

  function buildArrowBar(){
    const widthSeg = document.getElementById('widthSeg');
    WIDTHS.forEach(x => {
      const b = document.createElement('button');
      b.dataset.w = x.w; b.title = x.label;
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${x.w}" stroke-linecap="round"><path d="M4 12 h16"/></svg>`;
      b.addEventListener('click', () => applyArrow(() => S.arrowWidth = x.w, a => a.width = x.w));
      widthSeg.appendChild(b);
    });

    const dashSeg = document.getElementById('dashSeg');
    [['Solid', false], ['Dashed', true]].forEach(([label, val]) => {
      const b = document.createElement('button');
      b.dataset.dash = val; b.textContent = label;
      b.addEventListener('click', () => applyArrow(() => S.arrowDashed = val, a => a.dashed = val));
      dashSeg.appendChild(b);
    });

    const optSeg = document.getElementById('arrowOptSeg');
    const headBtn = document.createElement('button');
    headBtn.id = 'headBtn'; headBtn.textContent = 'Arrowhead';
    headBtn.title = 'Toggle the arrow end';
    headBtn.addEventListener('click', () => applyArrow(() => S.arrowHead = !S.arrowHead, a => a.head = S.arrowHead));
    optSeg.appendChild(headBtn);
    const flowBtn = document.createElement('button');
    flowBtn.id = 'flowBtn'; flowBtn.textContent = 'Flow dots';
    flowBtn.title = 'Animated dots travelling along the line';
    flowBtn.addEventListener('click', () => applyArrow(() => S.arrowFlow = !S.arrowFlow, a => a.flow = S.arrowFlow));
    optSeg.appendChild(flowBtn);
  }

  F.updateArrowBar = function(){
    const a = selArrow();
    const cur = a || { width: S.arrowWidth, dashed: S.arrowDashed, head: S.arrowHead, flow: S.arrowFlow };
    // show for the Draw tool, or when editing a selected arrow in Select mode
    const active = (S.tool === 'draw' && !S.wHeld) || (S.tool === 'select' && !!a);
    arrowBar.classList.toggle('show', active);
    document.querySelectorAll('#widthSeg button').forEach(b =>
      b.classList.toggle('active', parseFloat(b.dataset.w) === (cur.width || 3)));
    document.querySelectorAll('#dashSeg button').forEach(b =>
      b.classList.toggle('active', (b.dataset.dash === 'true') === !!cur.dashed));
    const headBtn = document.getElementById('headBtn');
    if (headBtn) headBtn.classList.toggle('active', cur.head !== false);
    const flowBtn = document.getElementById('flowBtn');
    if (flowBtn) flowBtn.classList.toggle('active', !!cur.flow);
  };

  const colorPicker = document.getElementById('colorPicker');
  F.setColor = function(c, chip){
    S.color = c;
    S.transparent = false;
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('sel'));
    if (chip) chip.classList.add('sel');
    if (/^#([0-9a-f]{6})$/i.test(c)) colorPicker.value = c;
    const targets = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
    if (targets.length){
      F.pushHistory();
      for (const o of targets){
        if (o.type === 'group') F.applyGroupColor(o, c);
        else if (o.type === 'shape'){
          const grps = F.groupsForShapeId(o.id);
          if (grps.length) F.applyGroupColor(grps[0], c);
          else o.fill = c;
        } else o.color = c;
      }
    }
    F.updateHUD();
  };

  // Transparent option: clears the fill on shapes (and future fills use none).
  F.setNoFill = function(chip){
    S.transparent = true;
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('sel'));
    if (chip) chip.classList.add('sel');
    const targets = (S.selection && S.selection.length) ? S.selection : (S.selected ? [S.selected] : []);
    const shapes = targets.filter(o => o.type === 'shape');
    const groups = targets.filter(o => o.type === 'group');
    if (shapes.length || groups.length){
      F.pushHistory();
      const touched = new Set();
      for (const g of groups){ F.applyGroupColor(g, null); touched.add(g); }
      for (const o of shapes){
        const grps = F.groupsForShapeId(o.id);
        if (grps.length && !touched.has(grps[0])){ F.applyGroupColor(grps[0], null); touched.add(grps[0]); }
        else if (!grps.length) o.fill = null;
      }
    }
    F.updateHUD();
  };

  // ---- Text sub-toolbar ---------------------------------------------------
  const textBar = document.getElementById('textBar');
  const TEXT_SIZES = [{ label: 'S', size: 16 }, { label: 'M', size: 22 }, { label: 'L', size: 32 }, { label: 'XL', size: 48 }];

  function selText(){ return (S.selected && S.selected.type === 'text') ? S.selected : null; }
  function applyText(setDefault, setObj){
    setDefault();
    const t = selText();
    if (t){ F.pushHistory(); setObj(t); }
    F.updateHUD();
  }

  function buildTextBar(){
    const sizeSeg = document.getElementById('textSizeSeg');
    TEXT_SIZES.forEach(x => {
      const b = document.createElement('button');
      b.dataset.size = x.size; b.textContent = x.label; b.title = x.size + 'px';
      b.addEventListener('click', () => applyText(() => S.textSize = x.size, t => t.size = x.size));
      sizeSeg.appendChild(b);
    });
    const optSeg = document.getElementById('textOptSeg');
    const boldBtn = document.createElement('button');
    boldBtn.id = 'boldBtn'; boldBtn.title = 'Bold';
    boldBtn.innerHTML = '<b style="font-weight:800">B</b>';
    boldBtn.addEventListener('click', () => applyText(() => S.textBold = !S.textBold, t => t.bold = S.textBold));
    optSeg.appendChild(boldBtn);

    const borderBtn = document.createElement('button');
    borderBtn.id = 'borderBtn'; borderBtn.textContent = 'Border';
    borderBtn.title = 'Outline around the text (uses the text color)';
    borderBtn.addEventListener('click', () => applyText(() => S.textBorder = !S.textBorder, t => t.border = S.textBorder));
    optSeg.appendChild(borderBtn);
  }

  F.updateTextBar = function(){
    const t = selText();
    const cur = t || { size: S.textSize, bold: S.textBold };
    // show for the Text tool, or when editing a selected text object in Select mode
    const active = (S.tool === 'text' && !S.wHeld) || (S.tool === 'select' && !!t);
    textBar.classList.toggle('show', active);
    document.querySelectorAll('#textSizeSeg button').forEach(b =>
      b.classList.toggle('active', parseFloat(b.dataset.size) === (cur.size || 18)));
    const boldBtn = document.getElementById('boldBtn');
    if (boldBtn) boldBtn.classList.toggle('active', !!cur.bold);
    const borderBtn = document.getElementById('borderBtn');
    if (borderBtn) borderBtn.classList.toggle('active', !!cur.border);
  };

  F.buildUI = function(){
    buildShapeBar();
    buildArrowBar();
    buildTextBar();

    // palette
    const paletteEl = document.getElementById('palette');
    F.PALETTE.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'chip' + (i === 0 ? ' sel' : '');
      d.style.background = c; d.dataset.color = c;
      d.addEventListener('click', () => F.setColor(c, d));
      paletteEl.appendChild(d);
    });
    // "No fill" (transparent) chip — removes a shape's fill.
    const noFill = document.createElement('div');
    noFill.className = 'chip no-fill';
    noFill.title = 'No fill (transparent)';
    noFill.addEventListener('click', () => F.setNoFill(noFill));
    paletteEl.appendChild(noFill);
    colorPicker.addEventListener('input', () => F.setColor(colorPicker.value, null));

    // tool buttons
    document.querySelectorAll('.bar .btn[data-tool]').forEach(b =>
      b.addEventListener('click', () => F.setTool(b.dataset.tool)));

    // actions
    document.getElementById('undoBtn').addEventListener('click', F.undo);
    document.getElementById('redoBtn').addEventListener('click', F.redo);
    document.getElementById('newBtn').addEventListener('click', F.newProject);
    document.getElementById('saveBtn').addEventListener('click', F.saveFlow);
    document.getElementById('openBtn').addEventListener('click', F.openFlow);
    document.getElementById('pngBtn').addEventListener('click', F.exportPNG);
    document.getElementById('workflowEntryBtn').addEventListener('click', F.setWorkflowEntryFromSelection);
    document.getElementById('workflowDeleteBtn').addEventListener('click', F.deleteWorkflowSelection);
    document.getElementById('groupBtn').addEventListener('click', F.createGroupFromSelection);
    document.getElementById('ungroupBtn').addEventListener('click', F.ungroupSelection);

    projectInput.addEventListener('change', commitProjectName);
    projectInput.addEventListener('blur', commitProjectName);
    projectInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter'){ e.preventDefault(); projectInput.blur(); }
      if (e.key === 'Escape'){ e.preventDefault(); projectInput.value = S.projectName; projectInput.blur(); }
    });

    // file input fallback
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0]; if (!f) return;
      F.loadFromText(await f.text(), f.name); fileInput.value = '';
    });

    // help / tutorial dismiss (stays closed across sessions)
    const help = document.getElementById('help');
    let helpClosed = false;
    try { helpClosed = localStorage.getItem('flow_help_closed') === '1'; } catch (e) {}
    if (helpClosed) help.classList.add('hidden');
    document.getElementById('helpClose').addEventListener('click', () => {
      help.classList.add('hidden');
      try { localStorage.setItem('flow_help_closed', '1'); } catch (e) {}
    });
  };
})();
