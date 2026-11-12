const $ = s => document.querySelector(s);
let page = 1, lastQ = "", seen = new Set();

const sources = {
  async gutenberg(q, p) {
    const r = await (await fetch("https://gutendex.com/books/?page=" + p + "&search=" + encodeURIComponent(q))).json();
    return r.results.map(b => ({
      title: b.title, author: (b.authors[0] || {}).name || "Unknown", year: "",
      cover: b.formats["image/jpeg"], src: "Project Gutenberg", free: true,
      links: [
        b.formats["application/pdf"] && { t: "PDF", u: b.formats["application/pdf"], pdf: 1 },
        b.formats["application/epub+zip"] && { t: "EPUB", u: b.formats["application/epub+zip"] },
        b.formats["text/html"] && { t: "Read online", u: b.formats["text/html"] }
      ].filter(Boolean)
    }));
  },
  async openlibrary(q, p) {
    const r = await (await fetch("https://openlibrary.org/search.json?limit=15&page=" + p + "&fields=key,title,author_name,first_publish_year,cover_i,ia,ebook_access&q=" + encodeURIComponent(q))).json();
    return r.docs.map(d => {
      const free = d.ebook_access === "public";
      const links = [{ t: free ? "Read free" : "View / borrow", u: "https://openlibrary.org" + d.key }];
      if (d.ia && d.ia[0] && free) links.push({ t: "PDF", u: "https://archive.org/download/" + d.ia[0] + "/" + d.ia[0] + ".pdf", pdf: 1 });
      return { title: d.title, author: (d.author_name || [])[0] || "Unknown", year: d.first_publish_year || "",
        cover: d.cover_i ? "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg" : "", src: "Open Library", free, links };
    });
  },
  async archive(q, p) {
    const query = encodeURIComponent("(" + q + ") AND mediatype:texts AND access-restricted-item:false");
    const r = await (await fetch("https://archive.org/advancedsearch.php?q=" + query + "&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=15&page=" + p + "&output=json")).json();
    return r.response.docs.map(d => ({
      title: d.title, author: [].concat(d.creator || [])[0] || "Unknown", year: d.year || "",
      cover: "https://archive.org/services/img/" + d.identifier, src: "Internet Archive", free: true,
      links: [{ t: "Read online", u: "https://archive.org/details/" + d.identifier },
              { t: "PDF", u: "https://archive.org/download/" + d.identifier + "/" + d.identifier + ".pdf", pdf: 1 }]
    }));
  },
  async google(q, p) {
    const r = await (await fetch("https://www.googleapis.com/books/v1/volumes?maxResults=15&startIndex=" + ((p - 1) * 15) + "&q=" + encodeURIComponent(q))).json();
    return (r.items || []).map(i => {
      const v = i.volumeInfo, a = i.accessInfo, free = a.viewability === "ALL_PAGES";
      const links = [{ t: free ? "Read free" : "Preview / buy", u: v.infoLink }];
      if (a.pdf && a.pdf.downloadLink) links.push({ t: "PDF", u: a.pdf.downloadLink, pdf: 1 });
      return { title: v.title, author: (v.authors || [])[0] || "Unknown", year: (v.publishedDate || "").slice(0, 4),
        cover: v.imageLinks ? v.imageLinks.thumbnail.replace("http:", "https:") : "", src: "Google Books", free, links };
    });
  }
};

function card(b) {
  const el = document.createElement("article"); el.className = "book";
  const noCover = () => Object.assign(document.createElement("div"), { className: "cover", textContent: "No cover" });
  const cover = b.cover ? Object.assign(document.createElement("img"), { src: b.cover, alt: "", loading: "lazy", className: "cover" }) : noCover();
  cover.onerror = () => cover.replaceWith(noCover());
  const body = document.createElement("div");
  const h = document.createElement("h3"); h.textContent = b.title || "Untitled";
  const m = document.createElement("p"); m.className = "meta"; m.textContent = [b.author, b.year].filter(Boolean).join(", ");
  const l = document.createElement("div"); l.className = "links";
  b.links.forEach(x => {
    const a = document.createElement("a");
    a.href = x.u; a.target = "_blank"; a.rel = "noopener"; a.textContent = x.t;
    if (x.pdf) a.className = "pdf";
    l.append(a);
  });
  const s = document.createElement("div"); s.className = "src";
  s.textContent = b.src + (b.free ? " · free to read" : " · borrow or buy");
  body.append(h, m, l, s); el.append(cover, body); return el;
}

async function run(q, p) {
  const active = [...document.querySelectorAll(".filters input[value]:checked")].map(i => i.value);
  if (!active.length) { $("#status").textContent = "Select at least one source."; return; }
  $("#status").textContent = "Searching " + active.length + " sources…";
  const out = await Promise.allSettled(active.map(k => sources[k](q, p)));
  const failed = []; let n = 0;
  out.forEach((o, i) => {
    if (o.status === "rejected") { failed.push(active[i]); return; }
    o.value.forEach(b => {
      if ($("#freeOnly").checked && !b.free) return;
      const key = (b.title + "|" + b.author).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key); $("#results").append(card(b)); n++;
    });
  });
  $("#status").textContent = n + " new results for “" + q + "”" + (failed.length ? ". Could not reach: " + failed.join(", ") + "." : ".");
  $("#more").hidden = n === 0;
}

$("#f").addEventListener("submit", e => {
  e.preventDefault(); lastQ = $("#q").value.trim(); page = 1; seen = new Set();
  $("#results").innerHTML = ""; run(lastQ, page);
});
$("#more").addEventListener("click", () => run(lastQ, ++page));
