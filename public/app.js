const $ = id => document.getElementById(id);
let chars = [], current = null, armTimer = null;

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method, headers: {"Content-Type": "application/json"},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(res.status === 401 ? "Your session ended." : data.error || "Error");
    err.status = res.status;
    throw err;
  }
  return data;
}

// Keep the unsaved text if the session ends, so the user does not lose it.
function keepDraft() {
  try {
    sessionStorage.setItem("draft", JSON.stringify({ user: $("who").textContent, id: current.id, text: $("d-text").value }));
  } catch (_) { /* storage is not available */ }
}
function takeDraft() {
  try {
    const raw = sessionStorage.getItem("draft");
    sessionStorage.removeItem("draft");
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function sessionEnded() {
  if (current) keepDraft();
  say("Your session ended. Your text is kept. Log in again to save it.");
  $("relogin").classList.remove("hidden");
}
function fail(e) {
  if (e.status === 401) sessionEnded();
  else say(e.message);
}

// Search ignores tone marks, so "hao" finds hǎo.
const plain = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function say(text, ok) {
  $("msg").textContent = text;
  $("msg").className = ok ? "ok" : "error";
}

function renderGrid() {
  const q = plain($("search").value.trim());
  const shown = chars.filter(c => !q || [c.hanzi, c.pinyin, c.meaning].some(s => plain(s).includes(q)));
  $("empty").classList.toggle("hidden", shown.length > 0);
  $("grid").replaceChildren(...shown.map(c => {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "tile" + (current && current.id === c.id ? " selected" : "");
    t.setAttribute("aria-pressed", current && current.id === c.id ? "true" : "false");
    t.setAttribute("aria-label", c.hanzi + ", " + c.pinyin + ", " + c.meaning + ". " + c.count + " descriptions." + (c.mine ? " You wrote one." : ""));
    const h = document.createElement("div"); h.className = "hanzi"; h.lang = "zh"; h.textContent = c.hanzi;
    const p = document.createElement("small"); p.textContent = c.pinyin;
    t.append(h, p);
    if (c.count) { const b = document.createElement("span"); b.className = "badge"; b.textContent = c.count; t.append(b); }
    if (c.mine) { const m = document.createElement("span"); m.className = "mine-mark"; m.textContent = "✓"; t.append(m); }
    t.onclick = () => openDetail(c).catch(fail);
    return t;
  }));
}

function disarm() {
  clearTimeout(armTimer);
  $("remove").classList.remove("armed");
  $("remove").textContent = "Delete mine";
}

let openSeq = 0;
async function openDetail(c) {
  const seq = ++openSeq;
  // Load first. If the load fails, the page keeps showing the word the user is working on.
  const list = await api("GET", "/characters/" + c.id + "/descriptions");
  if (seq !== openSeq) return;  // the user clicked another character
  current = c;
  disarm();
  renderGrid();
  $("detail").classList.remove("hidden");
  $("detail-hint").classList.add("hidden");
  $("d-hanzi").textContent = c.hanzi;
  $("d-info").textContent = c.pinyin + " - " + c.meaning;
  $("d-text").placeholder = "Describe how " + c.hanzi + " is written. Write its parts, its strokes, or a memory trick.";
  say("");
  $("relogin").classList.add("hidden");
  $("d-text").value = (list.find(d => d.mine) || {}).text || "";
  const others = list.filter(d => !d.mine);
  $("d-list").replaceChildren(...(others.length ? others : [{username: "", text: "No other descriptions yet."}]).map(d => {
    const div = document.createElement("div");
    div.className = "desc";
    if (d.username) { const b = document.createElement("b"); b.textContent = d.username; div.append(b, ": "); }
    div.append(d.text);
    return div;
  }));
}

async function reload() {
  chars = await api("GET", "/characters");
  if (current) current = chars.find(c => c.id === current.id) || null;
  renderGrid();
}

function closeDetail() {
  current = null;
  $("detail").classList.add("hidden");
  $("detail-hint").classList.remove("hidden");
  renderGrid();
}

$("search").oninput = renderGrid;
$("close").onclick = closeDetail;
document.addEventListener("keydown", e => { if (e.key === "Escape" && current) closeDetail(); });
$("save").onclick = async () => {
  try {
    await api("PUT", "/characters/" + current.id + "/description", {text: $("d-text").value});
    await reload();
    say("Saved.", true);
    setTimeout(() => { if ($("msg").textContent === "Saved.") say(""); }, 3000);
  } catch (e) { fail(e); }
};
$("remove").onclick = async () => {
  if (!$("remove").classList.contains("armed")) {
    $("remove").classList.add("armed");
    $("remove").textContent = "Confirm delete?";
    armTimer = setTimeout(disarm, 4000);
    return;
  }
  disarm();
  try {
    await api("DELETE", "/characters/" + current.id + "/description");
    $("d-text").value = "";
    await reload();
    say("Deleted.", true);
  } catch (e) { fail(e); }
};
$("logout").onclick = async () => { await api("POST", "/logout"); location.href = "/"; };

async function init() {
  try {
    const m = await api("GET", "/me");
    $("who").textContent = m.username;
    await reload();
    const draft = takeDraft();
    const word = draft && draft.user === m.username && chars.find(c => c.id === draft.id);
    if (word) {
      await openDetail(word);
      $("d-text").value = draft.text;
      say("Your unsaved description is back. Click Save.", true);
    }
  } catch (e) {
    if (e.status === 401) location.href = "/";
    else document.body.prepend(Object.assign(document.createElement("p"), { className: "error", textContent: "Could not load the app: " + e.message }));
  }
}
init();
