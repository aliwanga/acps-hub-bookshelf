"use strict";

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const enc = encodeURIComponent;
const PAGE = 20;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; n.append(c.nodeType ? c : document.createTextNode(c)); }
  return n;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const https = (u) => (u ? String(u).replace(/^http:\/\//i, "https://") : "");
const stripHtml = (s) => { const d = new DOMParser().parseFromString(String(s || ""), "text/html"); return (d.body.textContent || "").trim(); };
const flipName = (n) => { const p = String(n || "").split(","); return p.length === 2 ? `${p[1].trim()} ${p[0].trim()}` : String(n || "").trim(); };
const LANG3 = { eng: "en", swa: "sw", fre: "fr", fra: "fr", spa: "es", ger: "de", deu: "de" };
const lang2 = (c) => LANG3[c] || String(c || "").slice(0, 2).toLowerCase();
const ACCESS_RANK = { free: 0, borrow: 1, preview: 2, info: 3 };
const ACCESS_LABEL = { free: "Free to read", borrow: "Borrow", preview: "Preview", info: "Info only" };

let toastTimer;
function toast(t) {
  const n = $("#toast"); n.textContent = t; n.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove("show"), 2200);
}

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Timed out");
    throw e;
  } finally { clearTimeout(timer); }
}

/* ---------- sources ---------- */
const SOURCES = {
  gutenberg: {
    label: "Project Gutenberg",
    async fetch(q, p) {
      const d = await fetchJSON(`https://gutendex.com/books/?search=${enc(q)}&page=${p + 1}`);
      return {
        hasMore: !!d.next,
        items: (d.results || []).map((b, i) => ({
          title: b.title, authors: (b.authors || []).map((a) => flipName(a.name)), year: null,
          cover: b.formats && b.formats["image/jpeg"], lang: (b.languages || []).map(lang2),
          subjects: (b.subjects || []).slice(0, 6), rank: p * PAGE + i,
          link: { source: "gutenberg", url: `https://www.gutenberg.org/ebooks/${b.id}`, access: "free" }
        }))
      };
    }
  },
  openlibrary: {
    label: "Open Library",
    async fetch(q, p) {
      const f = "key,title,author_name,first_publish_year,cover_i,ebook_access,subject,language";
      const d = await fetchJSON(`https://openlibrary.org/search.json?q=${enc(q)}&page=${p + 1}&limit=${PAGE}&fields=${f}`);
      return {
        hasMore: (p + 1) * PAGE < (d.numFound || 0),
        items: (d.docs || []).map((b, i) => ({
          title: b.title, authors: b.author_name || [], year: b.first_publish_year || null,
          cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : "",
          lang: (b.language || []).slice(0, 4).map(lang2), subjects: (b.subject || []).slice(0, 6), rank: p * PAGE + i,
          link: { source: "openlibrary", url: "https://openlibrary.org" + b.key,
            access: b.ebook_access === "public" ? "free" : b.ebook_access === "borrowable" ? "borrow" : "info" }
        }))
      };
    }
  },
  archive: {
    label: "Internet Archive",
    async fetch(q, p) {
      const query = `(${q}) AND mediatype:texts AND -access-restricted-item:true`;
      const d = await fetchJSON(`https://archive.org/advancedsearch.php?q=${enc(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=description&fl[]=language&rows=${PAGE}&page=${p + 1}&output=json`);
      const r = d.response || {};
      return {
        hasMore: (p + 1) * PAGE < (r.numFound || 0),
        items: (r.docs || []).map((b, i) => ({
          title: Array.isArray(b.title) ? b.title[0] : b.title,
          authors: b.creator ? [].concat(b.creator).slice(0, 3) : [],
          year: parseInt(b.year, 10) || null,
          cover: `https://archive.org/services/img/${b.identifier}`,
          lang: b.language ? [].concat(b.language).map(lang2) : [],
          desc: stripHtml([].concat(b.description || [""])[0]).slice(0, 600), subjects: [], rank: p * PAGE + i,
          link: { source: "archive", url: `https://archive.org/details/${b.identifier}`, access: "free" }
        }))
      };
    }
  },
  google: {
    label: "Google Books",
    async fetch(q, p) {
      const d = await fetchJSON(`https://www.googleapis.com/books/v1/volumes?q=${enc(q)}&startIndex=${p * PAGE}&maxResults=${PAGE}&printType=books`);
      return {
        hasMore: (p + 1) * PAGE < (d.totalItems || 0) && (d.items || []).length === PAGE,
        items: (d.items || []).map((b, i) => {
          const v = b.volumeInfo || {}, a = b.accessInfo || {};
          const access = a.viewability === "ALL_PAGES" ? "free" : a.viewability === "PARTIAL" ? "preview" : "info";
          return {
            title: v.title + (v.subtitle ? ": " + v.subtitle : ""), authors: v.authors || [],
            year: parseInt(v.publishedDate, 10) || null,
            cover: https(v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)),
            lang: v.language ? [lang2(v.language)] : [], desc: stripHtml(v.description).slice(0, 800),
            subjects: (v.categories || []).slice(0, 4), rank: p * PAGE + i,
            link: { source: "google", url: https(v.infoLink || (a && a.webReaderLink)), access }
          };
        })
      };
    }
  },
  wikibooks: {
    label: "Wikibooks",
    async fetch(q, p) { return wiki("en.wikibooks.org", "wikibooks", q, p); }
  },
  wikisource: {
    label: "Wikisource",
    async fetch(q, p) { return wiki("en.wikisource.org", "wikisource", q, p); }
  },
  crossref: {
    label: "Crossref (academic books)",
    async fetch(q, p) {
      const d = await fetchJSON(`https://api.crossref.org/works?query=${enc(q)}&filter=type:book&rows=${PAGE}&offset=${p * PAGE}`);
      const m = d.message || {};
      return {
        hasMore: (p + 1) * PAGE < (m.total_results || 0),
        items: (m.items || []).filter((b) => b.title && b.title[0]).map((b, i) => ({
          title: b.title[0], authors: (b.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).slice(0, 4),
          year: b.issued && b.issued["date-parts"] && b.issued["date-parts"][0] ? b.issued["date-parts"][0][0] : null,
          cover: "", lang: [], desc: b.publisher ? "Published by " + b.publisher : "", subjects: (b.subject || []).slice(0, 4), rank: p * PAGE + i,
          link: { source: "crossref", url: https(b.URL), access: "info" }
        }))
      };
    }
  }
};

async function wiki(host, id, q, p) {
  const d = await fetchJSON(`https://${host}/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=${PAGE}&sroffset=${p * PAGE}&format=json&origin=*`);
  const list = (d.query && d.query.search) || [];
  return {
    hasMore: !!d.continue,
    items: list.map((b, i) => ({
      title: b.title, authors: [], year: null, cover: "", lang: ["en"], desc: stripHtml(b.snippet), subjects: [], rank: p * PAGE + i,
      link: { source: id, url: `https://${host}/wiki/${enc(b.title.replace(/ /g, "_"))}`, access: "free" }
    }))
  };
}

const SOURCE_IDS = Object.keys(SOURCES);
const SUBJECTS = ["Fiction", "Science", "Computer Science", "Mathematics", "History", "Kenya", "Africa", "Poetry", "Biography", "Economics", "Chemistry", "Physics", "Biology", "Business", "Philosophy", "Children"];
const STATUSES = ["Want to read", "Reading", "Finished"];

/* ---------- state ---------- */
const state = {
  q: "", token: 0, results: [], map: new Map(), src: {},
  enabled: store.get("acps_sources", SOURCE_IDS).filter((s) => SOURCES[s]),
  shelf: store.get("acps_shelf", []),
  recent: store.get("acps_recent", [])
};
if (!state.enabled.length) state.enabled = SOURCE_IDS.slice();

const keyOf = (it) => norm(String(it.title).split(/[:;(]/)[0]) + "|" + norm((it.authors[0] || "").split(" ").pop());
const inShelf = (k) => state.shelf.some((s) => s.key === k);
const bestAccess = (links) => links.reduce((b, l) => (ACCESS_RANK[l.access] < ACCESS_RANK[b] ? l.access : b), "info");

/* ---------- search ---------- */
function resetSources() {
  state.src = {};
  state.enabled.forEach((id) => (state.src[id] = { page: 0, hasMore: true, status: "idle", count: 0, error: "" }));
}

async function runSource(id, token) {
  const s = state.src[id]; s.status = "loading"; renderStatusPills();
  try {
    const { items, hasMore } = await SOURCES[id].fetch(state.q, s.page);
    if (token !== state.token) return;
    s.page++; s.hasMore = hasMore; s.count += items.length; s.status = "ok"; merge(items);
  } catch (e) {
    if (token !== state.token) return;
    if (e.status === 404) { s.hasMore = false; s.status = "ok"; } else { s.status = "error"; s.error = e.message; }
  }
  renderStatusPills(); renderResults();
}

function merge(items) {
  for (const raw of items) {
    if (!raw.title) continue;
    raw.authors = (raw.authors || []).filter(Boolean);
    const k = keyOf(raw), link = raw.link; delete raw.link;
    if (!link.url) continue;
    const ex = state.map.get(k);
    if (ex) {
      if (!ex.links.some((l) => l.source === link.source)) ex.links.push(link);
      if (!ex.cover && raw.cover) ex.cover = raw.cover;
      if (!ex.year && raw.year) ex.year = raw.year;
      if (!ex.desc && raw.desc) ex.desc = raw.desc;
      ex.lang = [...new Set([...(ex.lang || []), ...(raw.lang || [])])];
      ex.subjects = [...new Set([...(ex.subjects || []), ...(raw.subjects || [])])].slice(0, 8);
      ex.rank = Math.min(ex.rank, raw.rank);
      if (!ex.authors.length) ex.authors = raw.authors;
    } else {
      const it = { ...raw, key: k, links: [link] };
      state.map.set(k, it); state.results.push(it);
    }
  }
}

function startSearch(q) {
  q = q.trim(); if (!q) return;
  state.q = q; state.token++; state.results = []; state.map = new Map(); resetSources();
  $("#q").value = q;
  state.recent = [q, ...state.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  store.set("acps_recent", state.recent); renderRecent();
  try { history.replaceState(null, "", "?q=" + enc(q)); } catch (e) {}
  const t = state.token;
  $("#status").textContent = "Searching " + state.enabled.length + " libraries...";
  $("#results").replaceChildren(...Array.from({ length: 6 }, () => el("div", { class: "skeleton" })));
  $("#more").hidden = true;
  Promise.allSettled(state.enabled.map((id) => runSource(id, t))).then(() => { if (t === state.token) renderResults(true); });
}

function loadMore() {
  const t = state.token;
  const ids = state.enabled.filter((id) => state.src[id] && state.src[id].hasMore && state.src[id].status !== "loading");
  $("#more").textContent = "Loading...";
  Promise.allSettled(ids.map((id) => runSource(id, t))).then(() => { $("#more").textContent = "Load more"; renderResults(true); });
}

/* ---------- rendering ---------- */
function visible() {
  const free = $("#freeOnly").checked, lang = $("#lang").value, sort = $("#sort").value;
  let list = state.results.filter((it) => {
    it.access = bestAccess(it.links);
    if (free && it.access !== "free") return false;
    if (lang && it.lang && it.lang.length && !it.lang.includes(lang)) return false;
    return true;
  });
  const score = (it) => it.rank - (it.links.length - 1) * 3 + ACCESS_RANK[it.access] * 0.5;
  if (sort === "newest") list.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (sort === "oldest") list.sort((a, b) => (a.year || 9999) - (b.year || 9999));
  else if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
  else list.sort((a, b) => score(a) - score(b));
  return list;
}

function coverEl(it, cls) {
  const wrap = el("div", { class: "cover" });
  const ph = () => {
    const h = [...norm(it.title)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    const ini = norm(it.title).split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
    const d = el("div", { class: "cover-ph", text: ini || "B" }); d.style.background = `hsl(${h},45%,34%)`; return d;
  };
  if (it.cover) {
    const img = el("img", { src: https(it.cover), alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(ph()));
    img.addEventListener("load", () => { if (img.naturalWidth <= 2) img.replaceWith(ph()); });
    wrap.append(img);
  } else wrap.append(ph());
  return wrap;
}

function cardFor(it) {
  const best = it.links.slice().sort((a, b) => ACCESS_RANK[a.access] - ACCESS_RANK[b.access])[0];
  const saved = inShelf(it.key);
  return el("article", { class: "card" },
    coverEl(it),
    el("div", { class: "info" },
      el("h3", { text: it.title, tabindex: "0", onclick: () => openModal(it), onkeydown: (e) => { if (e.key === "Enter") openModal(it); } }),
      el("div", { class: "author", text: it.authors.slice(0, 2).join(", ") || "Unknown author" }),
      el("div", { class: "meta", text: [it.year, (it.lang || []).slice(0, 2).join("/").toUpperCase()].filter(Boolean).join(" · ") }),
      el("div", { class: "badges" }, el("span", { class: "badge b-" + it.access, text: ACCESS_LABEL[it.access] })),
      el("div", { class: "srcs", text: "Found on " + it.links.map((l) => SOURCES[l.source].label.split(" (")[0]).join(", ") }),
      el("div", { class: "actions" },
        el("a", { class: "btn-sm primary", href: best.url, target: "_blank", rel: "noopener noreferrer", text: it.access === "free" ? "Read" : "Open" }),
        el("button", { class: "btn-sm", type: "button", text: "Details", onclick: () => openModal(it) }),
        el("button", { class: "btn-sm" + (saved ? " saved" : ""), type: "button", text: saved ? "Saved" : "Save", onclick: (e) => { toggleShelf(it); e.currentTarget.className = "btn-sm" + (inShelf(it.key) ? " saved" : ""); e.currentTarget.textContent = inShelf(it.key) ? "Saved" : "Save"; } })
      )
    )
  );
}

function renderResults(final) {
  const list = visible();
  const loading = Object.values(state.src).some((s) => s.status === "loading");
  if (!state.results.length && loading) return;
  $("#results").replaceChildren(...list.map(cardFor));
  const anyMore = state.enabled.some((id) => state.src[id] && state.src[id].hasMore);
  $("#more").hidden = !list.length || !anyMore || loading;
  const srcCount = new Set(state.results.flatMap((r) => r.links.map((l) => l.source))).size;
  if (!list.length) $("#status").textContent = loading ? "Searching..." : state.results.length ? "No books match your filters. Try turning off Free only or the language filter." : "No books found. Try another title, author or subject.";
  else $("#status").textContent = `Showing ${list.length} book${list.length === 1 ? "" : "s"} from ${srcCount} source${srcCount === 1 ? "" : "s"}${loading ? " (still searching...)" : ""}`;
}

function renderStatusPills() {
  $("#sourceStatus").replaceChildren(...state.enabled.map((id) => {
    const s = state.src[id]; if (!s) return "";
    const txt = s.status === "loading" ? "searching..." : s.status === "error" ? "failed, tap to retry" : s.count + " found";
    return el("span", { class: "src-pill " + s.status, title: s.error || "", onclick: () => { if (s.status === "error") runSource(id, state.token); } }, SOURCES[id].label.split(" (")[0] + ": " + txt);
  }));
}

function renderRecent() {
  const box = $("#recent"); box.hidden = !state.recent.length;
  box.replaceChildren(...state.recent.map((r) => el("button", { class: "chip", type: "button", text: r, onclick: () => startSearch(r) })));
}

/* ---------- modal ---------- */
function citation(it) {
  const a = it.authors.slice(0, 3).join(", ") || "Unknown author";
  return `${a}. (${it.year || "n.d."}). ${it.title}. Retrieved from ${it.links[0].url}`;
}

function openModal(it) {
  it.access = bestAccess(it.links);
  const dlg = $("#modal");
  const saveBtn = el("button", { class: "btn-sm", type: "button" });
  const sync = () => { const s = inShelf(it.key); saveBtn.textContent = s ? "Saved to My Shelf" : "Save to My Shelf"; saveBtn.className = "btn-sm" + (s ? " saved" : ""); };
  saveBtn.addEventListener("click", () => { toggleShelf(it); sync(); renderResults(); });
  sync();
  dlg.replaceChildren(
    el("div", { class: "m-head" },
      coverEl(it),
      el("div", {},
        el("h2", { text: it.title }),
        el("div", { class: "author", text: it.authors.join(", ") || "Unknown author" }),
        el("div", { class: "meta", text: [it.year, (it.lang || []).join("/").toUpperCase()].filter(Boolean).join(" · ") }),
        el("div", { class: "badges" }, el("span", { class: "badge b-" + it.access, text: ACCESS_LABEL[it.access] }))
      ),
      el("button", { class: "m-close", type: "button", "aria-label": "Close", text: "×", onclick: () => dlg.close() })
    ),
    it.desc ? el("p", { class: "m-desc", text: it.desc }) : el("p", { class: "m-desc muted", text: "No description available from these sources." }),
    it.subjects && it.subjects.length ? el("div", { class: "m-sub" }, it.subjects.map((s) => el("span", { class: "chip", text: s }))) : null,
    el("div", { class: "m-links" }, it.links.slice().sort((a, b) => ACCESS_RANK[a.access] - ACCESS_RANK[b.access]).map((l) =>
      el("a", { class: "m-link", href: l.url, target: "_blank", rel: "noopener noreferrer" },
        el("span", { text: SOURCES[l.source].label }),
        el("span", { class: "badge b-" + l.access, text: ACCESS_LABEL[l.access] })))),
    el("div", { class: "m-foot" },
      saveBtn,
      el("button", { class: "btn-sm", type: "button", text: "Copy citation", onclick: () => copy(citation(it), "Citation copied") }),
      el("button", { class: "btn-sm", type: "button", text: "Copy link", onclick: () => copy(it.links[0].url, "Link copied") })
    )
  );
  dlg.showModal();
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) { toast("Copy not available in this browser"); }
}
$("#modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

/* ---------- shelf ---------- */
function toggleShelf(it) {
  const i = state.shelf.findIndex((s) => s.key === it.key);
  if (i >= 0) { state.shelf.splice(i, 1); toast("Removed from My Shelf"); }
  else { state.shelf.unshift({ key: it.key, title: it.title, authors: it.authors, year: it.year, cover: it.cover, links: it.links, status: "Want to read", added: Date.now() }); toast("Saved to My Shelf"); }
  store.set("acps_shelf", state.shelf); renderShelf();
}

function renderShelf() {
  $("#shelfCount").textContent = state.shelf.length;
  const counts = STATUSES.map((s) => `${state.shelf.filter((b) => b.status === s).length} ${s.toLowerCase()}`).join(" · ");
  $("#shelfStats").textContent = state.shelf.length ? `${state.shelf.length} book${state.shelf.length === 1 ? "" : "s"}: ${counts}` : "Save books to build your reading list.";
  const list = $("#shelfList");
  if (!state.shelf.length) { list.replaceChildren(el("div", { class: "empty", text: "Your shelf is empty. Search for a book and press Save." })); return; }
  list.replaceChildren(...state.shelf.map((b) => {
    const best = b.links.slice().sort((x, y) => ACCESS_RANK[x.access] - ACCESS_RANK[y.access])[0];
    const sel = el("select", { "aria-label": "Reading status" }, STATUSES.map((s) => el("option", { value: s, text: s, selected: s === b.status })));
    sel.addEventListener("change", () => { b.status = sel.value; store.set("acps_shelf", state.shelf); renderShelf(); });
    return el("div", { class: "shelf-item" }, coverEl(b),
      el("div", { class: "info" },
        el("h3", { text: b.title }),
        el("div", { class: "author", text: b.authors.slice(0, 2).join(", ") || "Unknown author" }),
        el("div", { class: "actions" }, sel,
          el("a", { class: "btn-sm primary", href: best.url, target: "_blank", rel: "noopener noreferrer", text: "Open" }),
          el("button", { class: "btn-sm", type: "button", text: "Remove", onclick: () => { state.shelf = state.shelf.filter((s) => s.key !== b.key); store.set("acps_shelf", state.shelf); renderShelf(); renderResults(); } }))));
  }));
}

function download(name, text, type) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
$("#exportCsv").addEventListener("click", () => {
  if (!state.shelf.length) return toast("Nothing to export yet");
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const rows = [["Title", "Authors", "Year", "Status", "Link"], ...state.shelf.map((b) => [b.title, b.authors.join("; "), b.year, b.status, b.links[0].url])];
  download("ACPS_bookshelf.csv", rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv");
});
$("#exportJson").addEventListener("click", () => {
  if (!state.shelf.length) return toast("Nothing to export yet");
  download("ACPS_bookshelf.json", JSON.stringify(state.shelf, null, 2), "application/json");
});
$("#clearShelf").addEventListener("click", () => {
  if (state.shelf.length && confirm("Remove all books from My Shelf?")) { state.shelf = []; store.set("acps_shelf", state.shelf); renderShelf(); renderResults(); }
});

/* ---------- UI wiring ---------- */
$("#sources").replaceChildren(...SOURCE_IDS.map((id) => {
  const cb = el("input", { type: "checkbox", value: id, checked: state.enabled.includes(id) });
  cb.addEventListener("change", () => {
    state.enabled = $$("#sources input:checked").map((i) => i.value);
    if (!state.enabled.length) { cb.checked = true; state.enabled = [id]; toast("Keep at least one source on"); }
    store.set("acps_sources", state.enabled);
    if (state.q) startSearch(state.q);
  });
  return el("label", {}, cb, SOURCES[id].label);
}));

$("#subjects").replaceChildren(...SUBJECTS.map((s) => el("button", { class: "chip", type: "button", text: s, onclick: () => startSearch(s) })));
$("#f").addEventListener("submit", (e) => { e.preventDefault(); startSearch($("#q").value); });
$("#surprise").addEventListener("click", () => startSearch(SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)]));
$("#more").addEventListener("click", loadMore);
["#freeOnly", "#sort", "#lang"].forEach((s) => $(s).addEventListener("change", () => renderResults()));

$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => { x.classList.toggle("active", x === t); x.setAttribute("aria-selected", x === t); });
  $("#panel-search").hidden = t.dataset.tab !== "search";
  $("#panel-shelf").hidden = t.dataset.tab !== "shelf";
  if (t.dataset.tab === "shelf") renderShelf();
}));

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
});

function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); $("#theme").innerHTML = t === "dark" ? "&#9728;" : "&#9790;"; }
let theme = store.get("acps_theme", window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(theme);
$("#theme").addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; applyTheme(theme); store.set("acps_theme", theme); });

renderRecent(); renderShelf();
const initial = new URLSearchParams(location.search).get("q");
if (initial) startSearch(initial);
