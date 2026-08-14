// app.js — bootstrap: size the canvas, wire the UI, and start the render loop.
(function(){
  "use strict";
  const F = window.Flow;

  F.resize();
  window.addEventListener('resize', F.resize);

  F.buildUI();
  F.updateHUD();
  requestAnimationFrame(F.render);

  (async function boot(){
    const signedIn = F.auth && F.auth.start ? await F.auth.start() : false;
    if (signedIn && F.cloud && F.cloud.start) await F.cloud.start();
    if (F.updateProjectUI) F.updateProjectUI();
  })();
})();
