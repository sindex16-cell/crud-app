const $ = id => document.getElementById(id);
let chars = [], current = null;

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

function renderGrid() {
  const q = $("search").value.trim().toLowerCase();
  $("grid").replaceChildren(...chars
    .filter(c => !q || [c.hanzi, c.pinyin, c.meaning].some(s => s.toLowerCase().includes(q)))
    .map(c => {
      const t = document.createElement("div");
      t.className = "tile" + (c.mine ? " mine" : "");
      const h = document.createElement("div"); h.className = "hanzi"; h.textContent = c.hanzi;
      const p = document.createElement("small"); p.textContent = c.pinyin + " (" + c.count + ")";
      t.append(h, p);
      t.onclick = () => openDetail(c).catch(e => { $("msg").textContent = e.message; });
      return t;
    }));
}

async function openDetail(c) {
  current = c;
  $("detail").classList.remove("hidden");
  $("d-hanzi").textContent = c.hanzi;
  $("d-info").textContent = c.pinyin + " - " + c.meaning;
  $("d-text").placeholder = "Describe how " + c.hanzi + " is written. Write its parts, its strokes, or a memory trick.";
  $("msg").textContent = "";
  const list = await api("GET", "/characters/" + c.id + "/descriptions");
  if (current !== c) return;  // the user clicked another character
  $("d-text").value = (list.find(d => d.mine) || {}).text || "";
  $("d-list").replaceChildren(...(list.length ? list : [{username: "", text: "No descriptions yet."}]).map(d => {
    const div = document.createElement("div");
    div.className = "desc" + (d.mine ? " mine" : "");
    if (d.username) { const b = document.createElement("b"); b.textContent = d.username + (d.mine ? " (you)" : ""); div.append(b, ": "); }
    div.append(d.text);
    return div;
  }));
  $("detail").scrollIntoView({behavior: "smooth"});
}

async function reload() {
  chars = await api("GET", "/characters");
  renderGrid();
  if (current) { current = chars.find(c => c.id === current.id); if (current) await openDetail(current); }
}

$("search").oninput = renderGrid;
$("save").onclick = async () => {
  try { await api("PUT", "/characters/" + current.id + "/description", {text: $("d-text").value}); await reload(); }
  catch (e) { $("msg").textContent = e.message; }
};
$("remove").onclick = async () => {
  try { await api("DELETE", "/characters/" + current.id + "/description"); await reload(); }
  catch (e) { $("msg").textContent = e.message; }
};
$("logout").onclick = async () => { await api("POST", "/logout"); location.href = "/"; };

api("GET", "/me").then(m => { $("who").textContent = m.username; return reload(); });
