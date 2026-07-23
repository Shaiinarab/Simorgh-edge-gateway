// ==========================================
// Simorgh · 30-Bird Mission Control
// A self-contained dashboard served from the Worker at GET /dashboard.
// Renders live Swarm-State (/api/v1/flock/status) and flies the agent
// (/api/v1/agent/execute) so you can WATCH the flock reroute.
// No build step, no external CDN — inline CSS/JS only.
// ==========================================

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Simorgh · Mission Control</title>
<style>
  :root {
    --bg: #0a0710;
    --bg2: #140b1c;
    --panel: rgba(255,255,255,0.045);
    --panel-brd: rgba(245,179,66,0.16);
    --ink: #f4ecdf;
    --muted: #9a8fa6;
    --gold: #f5b342;
    --fire: #ff5a36;
    --ok: #46d19e;
    --tired: #f5b342;
    --dormant: #5c5566;
    --shadow: 0 10px 40px rgba(0,0,0,0.5);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background:
      radial-gradient(1200px 700px at 80% -10%, rgba(255,90,54,0.12), transparent 60%),
      radial-gradient(900px 600px at 10% 10%, rgba(245,179,66,0.10), transparent 55%),
      linear-gradient(160deg, var(--bg), var(--bg2));
    min-height: 100vh;
    line-height: 1.5;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 22px 18px 60px; }

  header.top {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 14px 18px; border-radius: 16px;
    background: var(--panel); border: 1px solid var(--panel-brd);
    box-shadow: var(--shadow); backdrop-filter: blur(6px);
  }
  .brand { display: flex; align-items: center; gap: 12px; margin-right: auto; }
  .glyph {
    width: 42px; height: 42px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff2d0, var(--gold) 40%, var(--fire) 90%);
    box-shadow: 0 0 22px rgba(255,90,54,0.6); flex: none;
    animation: breathe 3.4s ease-in-out infinite;
  }
  @keyframes breathe { 0%,100%{ transform: scale(1); } 50%{ transform: scale(1.08); } }
  .brand h1 { font-size: 18px; margin: 0; letter-spacing: 0.3px; }
  .brand p { margin: 0; font-size: 12px; color: var(--muted); }

  .gauge { text-align: right; }
  .gauge .big { font-size: 22px; font-weight: 700; }
  .gauge .big b { color: var(--gold); }
  .gauge .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
  .pulse { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--dormant); margin-left: 6px; }
  .pulse.live { background: var(--ok); box-shadow: 0 0 0 0 rgba(70,209,158,0.7); animation: ring 1.8s infinite; }
  @keyframes ring { 0%{ box-shadow:0 0 0 0 rgba(70,209,158,0.55);} 70%{ box-shadow:0 0 0 8px rgba(70,209,158,0);} 100%{ box-shadow:0 0 0 0 rgba(70,209,158,0);} }

  .urlbar { display: flex; gap: 8px; align-items: center; width: 100%; margin-top: 4px; }
  .urlbar input { flex: 1; }
  input, textarea, select, button {
    font: inherit; color: var(--ink);
    background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px; padding: 9px 11px; outline: none;
  }
  input::placeholder, textarea::placeholder { color: #6f6678; }
  input:focus, textarea:focus, select:focus { border-color: var(--gold); }
  button {
    cursor: pointer; background: rgba(245,179,66,0.14); border-color: rgba(245,179,66,0.4);
    color: var(--gold); font-weight: 600; transition: transform .06s ease, background .2s;
  }
  button:hover { background: rgba(245,179,66,0.22); }
  button:active { transform: translateY(1px); }
  button.ghost { background: rgba(255,255,255,0.05); color: var(--muted); border-color: rgba(255,255,255,0.12); }
  button.fire { background: linear-gradient(120deg, var(--fire), var(--gold)); color: #241202; border: none; box-shadow: 0 8px 24px rgba(255,90,54,0.35); }
  button:disabled { opacity: .5; cursor: default; }

  .banner { margin-top: 14px; padding: 10px 14px; border-radius: 12px; font-size: 13px; display: none; }
  .banner.err { display: block; background: rgba(255,90,54,0.14); border: 1px solid rgba(255,90,54,0.4); color: #ffb9a8; }

  .section-title { margin: 26px 2px 12px; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); }

  /* The core */
  .core-row { display: flex; justify-content: center; margin: 8px 0 20px; }
  .core {
    position: relative; width: 108px; height: 108px; border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #fff6df, var(--gold) 38%, var(--fire) 92%);
    box-shadow: 0 0 46px rgba(255,90,54,0.55), inset 0 0 24px rgba(255,255,255,0.35);
    display: flex; align-items: center; justify-content: center; text-align: center;
    color: #2a1401; font-weight: 800; font-size: 13px; animation: breathe 4s ease-in-out infinite;
  }

  .flock { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 14px; }
  .bird {
    position: relative; border-radius: 16px; padding: 15px 16px;
    background: var(--panel); border: 1px solid var(--panel-brd);
    box-shadow: var(--shadow); overflow: hidden; transition: border-color .3s, transform .2s;
  }
  .bird::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--dormant);
  }
  .bird.s-healthy::before { background: linear-gradient(var(--ok), #2fae82); }
  .bird.s-tired::before { background: linear-gradient(var(--gold), var(--fire)); }
  .bird.s-dormant::before { background: var(--dormant); }
  .bird.answering { border-color: var(--gold); transform: translateY(-2px); box-shadow: 0 0 0 1px var(--gold), 0 14px 40px rgba(245,179,66,0.25); }
  .bird .row1 { display: flex; align-items: center; gap: 10px; }
  .bird .name { font-weight: 700; font-size: 15px; }
  .bird .prov { font-size: 12px; color: var(--muted); }
  .badge { margin-left: auto; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .5px; }
  .badge.healthy { background: rgba(70,209,158,0.16); color: var(--ok); }
  .badge.tired { background: rgba(245,179,66,0.16); color: var(--gold); }
  .badge.dormant { background: rgba(120,110,130,0.18); color: #b7aec2; }
  .bird .model { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #c9bdd6; margin: 9px 0 10px; word-break: break-all; opacity: .85; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stat { background: rgba(0,0,0,0.22); border-radius: 10px; padding: 7px 8px; text-align: center; }
  .stat .v { font-weight: 700; font-size: 14px; }
  .stat .k { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .cooldown { margin-top: 10px; font-size: 12px; color: var(--gold); }
  .cooldown .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,0.08); margin-top: 5px; overflow: hidden; }
  .cooldown .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--fire), var(--gold)); width: 100%; }

  /* Console */
  .console { display: grid; grid-template-columns: 1fr; gap: 12px; border-radius: 18px; padding: 18px; background: var(--panel); border: 1px solid var(--panel-brd); box-shadow: var(--shadow); }
  .console textarea { min-height: 76px; resize: vertical; width: 100%; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .controls .grp { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted); }
  .chk { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.12); cursor: pointer; font-size: 13px; }
  .chk input { width: auto; padding: 0; }
  .controls .grow { margin-left: auto; }

  .answer { display: none; margin-top: 4px; border-radius: 14px; padding: 15px 16px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.1); }
  .answer.show { display: block; animation: fade .3s ease; }
  @keyframes fade { from{ opacity: 0; transform: translateY(4px);} to{ opacity: 1; transform: none;} }
  .answer .who { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .answer .who b { color: var(--gold); }
  .answer .text { white-space: pre-wrap; }
  .path { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .hop { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); }
  .hop.ok { background: rgba(70,209,158,0.12); color: var(--ok); }
  .hop.fail { background: rgba(255,90,54,0.12); color: #ff9d86; }
  .hop .arrow { color: var(--muted); }

  .foot { margin-top: 30px; text-align: center; font-size: 12px; color: var(--muted); }
  .foot span { color: var(--gold); }
  a { color: var(--gold); }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="glyph"></div>
      <div>
        <h1>Simorgh · Mission Control</h1>
        <p>Thirty birds discover they are the Simorgh — watch the flock reroute.</p>
      </div>
    </div>
    <div class="gauge">
      <div class="big"><b id="awake">–</b> / <span id="total">–</span> awake<span id="pulse" class="pulse"></span></div>
      <div class="lbl">Swarm-State</div>
    </div>
    <div class="urlbar">
      <input id="baseUrl" placeholder="Gateway base URL (blank = same origin)" />
      <button class="ghost" id="refreshBtn" title="Refresh now">Refresh</button>
    </div>
  </header>

  <div id="banner" class="banner"></div>

  <div class="section-title">The Flock</div>
  <div class="core-row"><div class="core">SIMORGH<br/>the one</div></div>
  <div id="flock" class="flock"></div>

  <div class="section-title">Flight Console</div>
  <div class="console">
    <textarea id="prompt" placeholder="Ask the Simorgh something… (e.g. What time is it on the server?)">What time is it on the server right now?</textarea>
    <div class="controls">
      <div class="grp">tools:
        <label class="chk"><input type="checkbox" id="t_time" checked /> get_server_time</label>
        <label class="chk"><input type="checkbox" id="t_search" /> search_web</label>
      </div>
      <div class="grp">tier:
        <select id="tier">
          <option value="Free-Volunteer">Free-Volunteer</option>
          <option value="Pro-Paid">Pro-Paid</option>
          <option value="Pro-Data-Pact">Pro-Data-Pact</option>
        </select>
      </div>
      <div class="grp">user:
        <input id="userId" value="pilot-001" style="width:120px" />
      </div>
      <div class="grp grow">model:
        <select id="model" style="min-width:230px"><option value="">loading models…</option></select>
      </div>
      <button class="fire" id="flyBtn">Fly the agent ▸</button>
    </div>
    <div id="answer" class="answer">
      <div class="who" id="answerWho"></div>
      <div class="text" id="answerText"></div>
      <div class="path" id="answerPath"></div>
    </div>
  </div>

  <div class="foot">Zero-KYC · free-tier only · served from the edge — <span>Homā</span> always answers when the others tire.</div>
</div>

<script>
(function () {
  "use strict";
  var LS_KEY = "simorgh.baseUrl";
  var baseInput = document.getElementById("baseUrl");
  var banner = document.getElementById("banner");
  var flockEl = document.getElementById("flock");
  var lastStatus = null;      // last good status payload
  var lastAnswerBird = null;  // id of bird that answered most recent flight

  baseInput.value = localStorage.getItem(LS_KEY) || "";
  baseInput.addEventListener("change", function () {
    localStorage.setItem(LS_KEY, baseInput.value.trim());
    poll();
    populateModels();
  });

  function base() { return (baseInput.value || "").replace(/\\/+$/, ""); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function showErr(msg) { banner.className = "banner err"; banner.textContent = msg; }
  function clearErr() { banner.className = "banner"; banner.textContent = ""; }

  function relTime(ms) {
    if (!ms) return "never";
    var d = Date.now() - ms;
    if (d < 0) d = 0;
    var s = Math.floor(d / 1000);
    if (s < 60) return s + "s ago";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }
  function fmtCooldown(ms) {
    var s = Math.ceil(ms / 1000);
    return s + "s";
  }

  function birdCard(b) {
    var cls = "bird s-" + b.status + (b.id === lastAnswerBird ? " answering" : "");
    var badgeText = b.status === "dormant" ? "no key" : b.status;
    var cd = "";
    if (b.status === "tired" && b.cooldownRemainingMs > 0) {
      cd = '<div class="cooldown" data-until="' + (Date.now() + b.cooldownRemainingMs) +
           '">resting · <span class="t">' + fmtCooldown(b.cooldownRemainingMs) +
           '</span><span class="bar"><i></i></span></div>';
    }
    var parts = b.label.split(" (");
    var name = parts[0];
    var prov = parts[1] ? "(" + parts[1] : "";
    return '' +
      '<div class="' + cls + '" data-id="' + esc(b.id) + '">' +
        '<div class="row1">' +
          '<div><div class="name">' + esc(name) + '</div>' +
          '<div class="prov">' + esc(prov) + ' · priority ' + esc(b.priority) + '</div></div>' +
          '<span class="badge ' + b.status + '">' + esc(badgeText) + '</span>' +
        '</div>' +
        '<div class="model">' + esc(b.model) + '</div>' +
        '<div class="stats">' +
          '<div class="stat"><div class="v">' + esc(b.totalCalls) + '</div><div class="k">calls</div></div>' +
          '<div class="stat"><div class="v">' + esc(b.totalFailures) + '</div><div class="k">fails</div></div>' +
          '<div class="stat"><div class="v">' + relTime(b.lastOk) + '</div><div class="k">last ok</div></div>' +
        '</div>' + cd +
      '</div>';
  }

  function render(data) {
    lastStatus = data;
    document.getElementById("awake").textContent = data.awake;
    document.getElementById("total").textContent = data.total;
    var pulse = document.getElementById("pulse");
    pulse.className = "pulse" + (data.awake > 0 ? " live" : "");
    var html = "";
    for (var i = 0; i < data.birds.length; i++) html += birdCard(data.birds[i]);
    flockEl.innerHTML = html;
  }

  function tickCooldowns() {
    var nodes = document.querySelectorAll(".cooldown");
    for (var i = 0; i < nodes.length; i++) {
      var until = parseInt(nodes[i].getAttribute("data-until"), 10);
      var rem = until - Date.now();
      var t = nodes[i].querySelector(".t");
      var bar = nodes[i].querySelector(".bar i");
      if (rem <= 0) { if (t) t.textContent = "waking…"; if (bar) bar.style.width = "0%"; continue; }
      if (t) t.textContent = fmtCooldown(rem);
      if (bar) bar.style.width = Math.max(0, Math.min(100, (rem / 60000) * 100)) + "%";
    }
  }

  function poll() {
    fetch(base() + "/api/v1/flock/status", { headers: { "accept": "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .then(function (d) { clearErr(); render(d); })
      .catch(function (e) { showErr("Gateway unreachable: " + e.message + " — showing last known state."); });
  }

  // Auto-Wrapper: fetch the model registry and load it into the console select,
  // grouped by provider (Cloudflare first). No-key providers show greyed out.
  function populateModels() {
    var sel = document.getElementById("model");
    fetch(base() + "/api/v1/models", { headers: { "accept": "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .then(function (cat) {
        var providers = cat.providers || [];
        var html = "";
        for (var i = 0; i < providers.length; i++) {
          var p = providers[i];
          if (!p.models || !p.models.length) continue;
          var glabel = esc(p.label) + (p.available ? "" : " · no key");
          html += '<optgroup label="' + glabel + '"' + (p.available ? "" : " disabled") + '>';
          for (var k = 0; k < p.models.length; k++) {
            var m = p.models[k];
            var selected = m.id === cat.default ? " selected" : "";
            html += '<option value="' + esc(m.id) + '"' + selected + '>' + esc(m.name) + '</option>';
          }
          html += '</optgroup>';
        }
        sel.innerHTML = html || '<option value="">(no models)</option>';
      })
      .catch(function (e) { sel.innerHTML = '<option value="">models unavailable</option>'; });
  }

  function fly() {
    var btn = document.getElementById("flyBtn");
    var prompt = document.getElementById("prompt").value.trim();
    if (!prompt) return;
    var tools = [];
    if (document.getElementById("t_time").checked) tools.push("get_server_time");
    if (document.getElementById("t_search").checked) tools.push("search_web");
    var body = {
      prompt: prompt,
      tools: tools,
      userId: document.getElementById("userId").value || "pilot-001",
      tier: document.getElementById("tier").value
    };
    var modelSel = document.getElementById("model");
    if (modelSel && modelSel.value) body.model = modelSel.value;
    var ansBox = document.getElementById("answer");
    var who = document.getElementById("answerWho");
    var text = document.getElementById("answerText");
    var path = document.getElementById("answerPath");
    btn.disabled = true; btn.textContent = "Flying…";
    who.innerHTML = ""; path.innerHTML = ""; text.textContent = "The flock is taking flight…";
    ansBox.className = "answer show";

    fetch(base() + "/api/v1/agent/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var j = res.j;
        if (!res.ok) {
          who.innerHTML = "";
          text.textContent = "✖ " + (j.error || "Flight failed.");
          lastAnswerBird = null;
          poll();
          return;
        }
        var m = j.meta || {};
        lastAnswerBird = m.bird_id || null;
        who.innerHTML = "answered by <b>" + esc(m.answered_by || "unknown") +
          "</b> · model <code>" + esc(m.ai_model || "?") + "</code> · " +
          esc(m.tool_iterations) + " tool iteration(s)";
        text.textContent = j.agentResponse || "(no text response)";
        var hops = m.flock_attempts || [];
        var ph = "";
        for (var i = 0; i < hops.length; i++) {
          var h = hops[i];
          if (i > 0) ph += '<span class="arrow">→</span>';
          ph += '<span class="hop ' + (h.ok ? "ok" : "fail") + '">' +
                esc(h.birdId) + (h.ok ? " ✓" : " ✕") + '</span>';
        }
        path.innerHTML = ph;
        poll();
      })
      .catch(function (e) {
        text.textContent = "✖ " + e.message;
        lastAnswerBird = null;
      })
      .finally(function () { btn.disabled = false; btn.textContent = "Fly the agent ▸"; });
  }

  document.getElementById("refreshBtn").addEventListener("click", poll);
  document.getElementById("flyBtn").addEventListener("click", fly);

  poll();
  populateModels();
  setInterval(function () { if (!document.hidden) poll(); }, 3000);
  setInterval(tickCooldowns, 1000);
})();
</script>
</body>
</html>`;
