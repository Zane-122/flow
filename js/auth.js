// auth.js — login / register.
(function(){
  "use strict";
  const F = window.Flow;

  const authEl = () => document.getElementById("authGate");
  const errEl = () => document.getElementById("authError");
  const titleEl = () => document.getElementById("authTitle");
  const subEl = () => document.getElementById("authSub");
  const submitBtn = () => document.getElementById("authSubmit");
  const toggleBtn = () => document.getElementById("authToggle");
  const nameWrap = () => document.getElementById("authNameWrap");

  let mode = "login";
  F.user = null;

  async function api(path, opts){
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = {}; }
    if (!res.ok) throw new Error(body.error || ("Request failed (" + res.status + ")"));
    return body;
  }
  F.api = api;

  function showError(msg){
    const el = errEl();
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function paintForm(){
    const register = mode === "register";
    titleEl().textContent = register ? "Create an account" : "Sign in to Flow";
    subEl().textContent = register
      ? "Anyone can sign up. Use an invite code later to join someone else's flow."
      : "Sign in with your email, or create a free account.";
    submitBtn().textContent = register ? "Create account" : "Sign in";
    toggleBtn().textContent = register ? "Already have an account? Sign in" : "Create an account";
    nameWrap().hidden = !register;
    showError("");
  }

  function setSignedIn(user){
    F.user = user;
    authEl().classList.remove("show");
    document.body.classList.add("signed-in");
    const chip = document.getElementById("accountName");
    if (chip) chip.textContent = user.name || user.email;
    const emailEl = document.getElementById("accountEmail");
    if (emailEl) emailEl.textContent = user.email;
  }

  function setSignedOut(){
    F.user = null;
    document.body.classList.remove("signed-in");
    authEl().classList.add("show");
    paintForm();
  }

  async function submit(e){
    if (e) e.preventDefault();
    showError("");
    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    const name = document.getElementById("authName").value;
    try{
      const path = mode === "register" ? "/api/register" : "/api/login";
      const body = await api(path, {
        method: "POST",
        body: JSON.stringify({ email, password, name })
      });
      setSignedIn(body.user);
      try{
        if (F.cloud && F.cloud.start) await F.cloud.start();
      } catch (bootErr){
        if (F.toast) F.toast(bootErr.message || "Signed in, but the flow failed to load");
      }
    } catch (err){
      showError(err.message);
    }
  }

  F.logout = async function(){
    try { await api("/api/logout", { method: "POST", body: "{}" }); } catch (e) {}
    if (F.collab && F.collab.disconnect) F.collab.disconnect();
    F.user = null;
    location.reload();
  };

  F.auth = {
    api,
    start: async function(){
      try{
        const me = await api("/api/me");
        setSignedIn(me.user);
        return true;
      } catch (e){
        setSignedOut();
        try { await api("/api/status"); } catch (err){
          showError("Can't reach the server. Is Flow running?");
        }
        return false;
      }
    }
  };

  paintForm();
  document.getElementById("authForm").addEventListener("submit", submit);
  document.getElementById("authToggle").addEventListener("click", () => {
    mode = mode === "login" ? "register" : "login";
    paintForm();
  });
  document.getElementById("logoutBtn").addEventListener("click", F.logout);
  const accountBtn = document.getElementById("accountBtn");
  const accountMenu = document.getElementById("accountMenu");
  accountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    accountMenu.classList.toggle("show");
  });
  accountMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => accountMenu.classList.remove("show"));
})();
