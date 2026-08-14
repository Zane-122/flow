// text.js — the inline editor used for shape labels and free-standing text.
(function(){
  "use strict";
  const F = window.Flow, S = F.state, G = F.geo, R = F;

  const editor = document.createElement('textarea');
  editor.id = 'labelEditor';
  document.body.appendChild(editor);

  F.positionEditor = function(o){
    const cam = F.cam;
    if (o.type === 'text'){
      const b = F.textBox(o);
      const fit = F.fitTextInBox(o);
      const w = b.w * cam.scale, h = b.h * cam.scale;
      const cx = o.x * cam.scale + cam.x;
      const cy = o.y * cam.scale + cam.y;
      editor.style.textAlign = 'center';
      editor.style.left = (cx - w/2) + 'px';
      editor.style.top  = (cy - h/2) + 'px';
      editor.style.width = w + 'px';
      editor.style.height = h + 'px';
      editor.style.fontSize = (fit.size * cam.scale) + 'px';
      editor.style.lineHeight = (fit.lh * cam.scale) + 'px';
      editor.style.fontWeight = o.bold ? 800 : 600;
      editor.style.color = o.color || '#e8edf5';
    } else {
      const s = G.normBox(o);
      const fit = F.fitLabelSize(s, editor.value || o.text || ' ');
      const lines = (fit.lines ? fit.lines.length : 1) || 1;
      const contentH = lines * fit.lh;               // world units
      const cx = (s.x + s.w/2) * cam.scale + cam.x;
      const cy = (s.y + s.h/2) * cam.scale + cam.y;
      const wS = Math.max(20, s.w * cam.scale);
      const hS = Math.max(fit.lh, contentH) * cam.scale;
      editor.style.textAlign = 'center';
      editor.style.left = (cx - wS/2) + 'px';
      editor.style.top  = (cy - hS/2) + 'px';         // vertically centered
      editor.style.width = wS + 'px';
      editor.style.height = hS + 'px';
      editor.style.fontSize = (fit.size * cam.scale) + 'px';
      editor.style.lineHeight = (fit.lh * cam.scale) + 'px';
      editor.style.fontWeight = 600;
      editor.style.color = G.readableText(o.fill);
    }
    editor.style.display = 'block';
  };

  F.startEdit = function(o){
    S.editingObj = o;
    S.selected = o; S.selection = [o];
    editor.value = o.text || '';
    F.positionEditor(o);
    requestAnimationFrame(() => { editor.focus(); editor.select(); });
  };

  F.commitEdit = function(){
    const o = S.editingObj;
    if (!o) return;
    S.editingObj = null;
    editor.style.display = 'none';
    const val = editor.value.replace(/\s+$/,'');
    if (o.type === 'text' && val === ''){
      // discard an empty new text object
      S.objects = S.objects.filter(x => x !== o);
      if (S.selected === o) S.selected = null;
      S.selection = S.selection.filter(x => x !== o);
      return;
    }
    if (val !== (o.text || '')){ F.pushHistory(); o.text = val; }
    if (o.type === 'text' && val && (!o.w || !o.h)){
      const s = F.autoTextBoxSize(o);
      o.w = Math.max(s.w, 80); o.h = Math.max(s.h, 32);
    }
  };

  // create a free-standing text object at a world point and edit it immediately
  F.createTextAt = function(wp){
    F.pushHistory();
    const o = { type:'text', x: wp.x, y: wp.y, text:'', w: 120, h: 40,
                color: S.color, size: S.textSize, bold: S.textBold,
                border: S.textBorder, t0: F.now() };
    S.objects.push(o);
    F.startEdit(o);
  };

  editor.addEventListener('input', () => {
    if (!S.editingObj) return;
    S.editingObj.text = editor.value;
    if (S.editingObj.type === 'text') F.positionEditor(S.editingObj);
  });
  editor.addEventListener('blur', F.commitEdit);
  editor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); F.commitEdit(); }
    if (e.key === 'Escape'){ e.preventDefault(); F.commitEdit(); }
  });
})();
