// core.js — shared namespace, state, camera, history, small utilities.
// Everything hangs off the global `Flow` object so the separate classic
// scripts can share state while still running from a local file (no server).
(function(){
  "use strict";

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const Flow = window.Flow = {
    canvas, ctx,
    DPR: Math.max(1, window.devicePixelRatio || 1),
    W: 0, H: 0,

    cam: { x: 0, y: 0, scale: 1 },

    SHAPES: ['box', 'ellipse', 'triangle', 'diamond'],
    SHAPE_LABEL: { box:'Box', ellipse:'Ellipse', triangle:'Triangle', diamond:'Diamond' },
    PALETTE: ['#6ea8ff','#5ce1a6','#ffd166','#ff8f6b','#ff6b9d','#b18cff','#e8edf5','#8b97a8'],

    // preset shape sizes cycled with the 0 key (null = free-draw by dragging)
    SHAPE_SIZES: [
      { label: 'Free', w: 0, h: 0 },
      { label: 'S',  w: 90,  h: 60 },
      { label: 'M',  w: 150, h: 96 },
      { label: 'L',  w: 220, h: 140 },
    ],

    // animation timing (ms)
    ANIM: { shape: 200, arrow: 340, text: 200 },

    state: {
      objects: [],
      selected: null,
      selection: [],       // multi-select set (marquee); selected is the primary
      marquee: null,       // live rubber-band rect while dragging in select mode
      snapGuides: null,    // active alignment guide lines while dragging a box
      spaceMarks: null,    // equal-distance markers while dragging a box
      tool: 'draw',        // select | draw | shape | fill | text | hand
      color: '#6ea8ff',
      transparent: false,  // "no fill" palette option is active
      shapeIndex: 0,
      sizeIndex: 0,        // index into SHAPE_SIZES
      pointer: { x: 0, y: 0 }, // last known cursor position (world coords)
      hoveredShape: null,  // shape under cursor (for hover-only node labels)

      // default arrow style (also applied live to a selected arrow)
      arrowWidth: 3,
      arrowDashed: false,
      arrowHead: true,
      arrowFlow: false,

      // default text style (also applied live to a selected text object)
      textSize: 22,
      textBold: false,
      textBorder: false,
      wHeld: false,
      spaceHeld: false,
      editingObj: null,
      drag: null,
      panning: null,
      fileHandle: null,
      projectName: 'Untitled',
    },

    history: [],
    future: [],
  };

  // ---- Canvas sizing -------------------------------------------------------
  Flow.resize = function(){
    Flow.DPR = Math.max(1, window.devicePixelRatio || 1);
    Flow.W = window.innerWidth;
    Flow.H = window.innerHeight;
    canvas.width = Math.floor(Flow.W * Flow.DPR);
    canvas.height = Math.floor(Flow.H * Flow.DPR);
    canvas.style.width = Flow.W + 'px';
    canvas.style.height = Flow.H + 'px';
  };

  // ---- Coordinate transform ------------------------------------------------
  Flow.screenToWorld = function(sx, sy){
    const c = Flow.cam;
    return { x: (sx - c.x) / c.scale, y: (sy - c.y) / c.scale };
  };

  // ---- History (undo / redo) ----------------------------------------------
  Flow.snapshot = () => JSON.stringify(Flow.state.objects);
  Flow.pushHistory = function(){
    Flow.history.push(Flow.snapshot());
    if (Flow.history.length > 100) Flow.history.shift();
    Flow.future.length = 0;
  };
  function restore(json){
    Flow.state.objects = JSON.parse(json);
    Flow.state.selected = null;
    Flow.state.selection = [];
    Flow.state.editingObj = null;
    if (Flow.syncAllGroups) Flow.syncAllGroups();
    if (Flow.syncAllWorkflows) Flow.syncAllWorkflows();
  }
  Flow.undo = function(){
    if (!Flow.history.length) return;
    Flow.future.push(Flow.snapshot());
    restore(Flow.history.pop());
  };
  Flow.redo = function(){
    if (!Flow.future.length) return;
    Flow.history.push(Flow.snapshot());
    restore(Flow.future.pop());
  };

  // ---- Toast ---------------------------------------------------------------
  let toastTimer = null;
  Flow.toast = function(msg){
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  };

  Flow.now = () => performance.now();
  Flow.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Stable N1, N2, … labels for shapes (top-left reading order).
  Flow.nodeLabelMap = function(){
    const shapes = Flow.state.objects.filter(o => o.type === 'shape').slice().sort((a, b) => {
      const ca = Flow.geo.normBox(a), cb = Flow.geo.normBox(b);
      const ay = ca.y + ca.h / 2, ax = ca.x + ca.w / 2;
      const by = cb.y + cb.h / 2, bx = cb.x + cb.w / 2;
      if (Math.abs(ay - by) > 20) return ay - by;
      return ax - bx;
    });
    const map = new Map();
    shapes.forEach((o, i) => map.set(o.id, 'N' + (i + 1)));
    return map;
  };

  // gap kept between an arrow tip/tail and the shape it connects to
  Flow.CONNECT_MARGIN = 22;   // considerable padding from arrow end to shape edge
  Flow.CONNECT_SNAP = 34;     // how close an endpoint must be to bind to a shape
})();
