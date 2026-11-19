const $ = id => document.getElementById(id);
let chars = [], current = null, armTimer = null;

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method, headers: {"Content-Type": "application/json"},
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { location.href = "/"; throw new Error("auth"); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

function say(text, ok) {
  $("msg").textContent = text;
  $("msg").className = ok ? "ok" : "error";
}

function renderGrid() {
  const q = $("search").value.trim().toLowerCase();
  const shown = chars.filter(c => !q || [c.hanzi, c.pinyin, c.meaning].some(s => s.toLowerCase().includes(q)));
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
    t.onclick = () => openDetail(c).catch(e => { say(e.message); });
    return t;
  }));
}

function disarm() {
  clearTimeout(armTimer);
  $("remove").classList.remove("armed");
  $("remove").textContent = "Delete mine";
}

async function openDetail(c) {
  current = c;
  disarm();
  renderGrid();
  $("detail").classList.remove("hidden");
  $("detail-hint").classList.add("hidden");
  $("d-hanzi").textContent = c.hanzi;
  $("d-info").textContent = c.pinyin + " - " + c.meaning;
  $("d-text").placeholder = "Describe how " + c.hanzi + " is written. Write its parts, its strokes, or a memory trick.";
  say("");
  const list = await api("GET", "/characters/" + c.id + "/descriptions");
  if (current !== c) return;  // the user clicked another character
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
  } catch (e) { say(e.message); }
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
  } catch (e) { say(e.message); }
};
$("logout").onclick = async () => { await api("POST", "/logout"); location.href = "/"; };

api("GET", "/me").then(m => { $("who").textContent = m.username; return reload(); });
