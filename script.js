const LABELS = { design: "Design", photo: "Photo & Film", dev: "Development", studio: "Studio" };
const SERVICE_COLORS = ["design", "photo", "dev", "studio"];
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// *word* → italic serif, new line → <br>
const rich = (s) => esc(s).replace(/\*(.+?)\*/g, '<span class="serif">$1</span>').replace(/\n/g, "<br>");
// Blank line → new paragraph
const paras = (s) => String(s || "").split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${rich(p.trim())}</p>`).join("");
const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const safeUrl = (u) => (/^\s*javascript:/i.test(u || "") ? "#" : u || "#");
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

// Deterministic generative art for projects without an image
function placeholderArt(project, i) {
  const palettes = {
    design: ["#ff5a36", "#ffb199", "#1d1d1b"],
    photo: ["#2f6bff", "#9fd3ff", "#0f1a33"],
    dev: ["#13b77c", "#c6f7d9", "#0c2a20"],
    studio: ["#ffcc00", "#ff7ac6", "#24124a"],
  };
  const [a, b, c] = palettes[project.category] || palettes.design;
  const shapes = [
    `radial-gradient(circle at 30% 35%, ${a} 0 22%, transparent 23%), radial-gradient(circle at 70% 70%, ${b} 0 30%, transparent 31%), ${c}`,
    `linear-gradient(135deg, ${a} 0 40%, transparent 40%), linear-gradient(315deg, ${b} 0 35%, transparent 35%), ${c}`,
    `repeating-linear-gradient(90deg, ${a} 0 14px, transparent 14px 28px), linear-gradient(${b}, ${c})`,
    `conic-gradient(from 45deg at 50% 50%, ${a}, ${b}, ${c}, ${a})`,
  ];
  return shapes[i % shapes.length];
}

function setImage(el, url) {
  el.removeAttribute("style");
  el.style.backgroundImage = `url("${String(url).replace(/"/g, "%22")}")`;
  el.style.backgroundSize = "cover";
  el.style.backgroundPosition = "center";
}

function setArt(el, p, i) {
  if (p.image) setImage(el, p.image);
  else { el.removeAttribute("style"); el.style.background = placeholderArt(p, i); }
}

// Style changes made in the editor's inspector: { "selector": { "property": "value" } }
const SAFE = (s) => typeof s === "string" && !/[{}<;]/.test(s);
function stylesToCSS(styles = {}) {
  return Object.entries(styles).map(([sel, props]) => {
    if (!SAFE(sel)) return "";
    const decls = Object.entries(props || {})
      .filter(([p, v]) => /^-{0,2}[a-z][a-z-]*$/.test(p) && SAFE(v) && v.trim())
      .map(([p, v]) => `  ${p}: ${v} !important;`);
    return decls.length ? `${sel} {\n${decls.join("\n")}\n}` : "";
  }).filter(Boolean).join("\n");
}
// Simple style settings stored on sections and parts (colour, size, padding, background)
const px = (v) => (/^-?\d*\.?\d+$/.test(String(v).trim()) ? `${String(v).trim()}px` : String(v).trim());
function quickCSS(c) {
  const out = [];
  const rule = (sel, decls) => {
    const d = decls.filter(([, v]) => v !== undefined && v !== "" && SAFE(String(v))).map(([p, v]) => `  ${p}: ${v} !important;`);
    if (d.length) out.push(`${sel} {\n${d.join("\n")}\n}`);
  };
  for (const s of c.sections || []) {
    const q = s.css || {};
    rule(`#${s.id}`, [["background", q.background], ["padding-top", q.padY && px(q.padY)], ["padding-bottom", q.padY && px(q.padY)]]);
    for (const p of s.parts || []) {
      const k = p.css || {};
      const sel = `[data-pid="${p.id}"]`;
      rule(sel, [["padding", k.padding && px(k.padding)]]);
      rule(`${sel} > *`, [["color", k.color], ["font-size", k.size && px(k.size)]]);
      if (k.size) rule(`${sel} .quote-text, ${sel} .big-link`, [["font-size", px(k.size)]]);
    }
  }
  return out.join("\n");
}

// Accepts the whole content (simple settings + CSS edits)
function applyStyles(c) {
  let tag = document.getElementById("site-style-changes");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "site-style-changes";
    document.head.append(tag);
  }
  tag.textContent = quickCSS(c) + "\n" + stylesToCSS(c.styles);
}

/* ---------- Parts: the building blocks inside a section ---------- */
const PART_TYPES = {
  eyebrow: {
    label: "Small line", defaults: { text: "Small line above" },
    html: (p) => `<p class="eyebrow">${esc(p.text)}</p>`,
  },
  heading: {
    label: "Heading", defaults: { text: "A new *heading*", size: "l", rotator: "", rotatorPrefix: "made by" },
    html: (p) => {
      const size = pick(p.size, ["xl", "l", "m"], "l");
      const tag = { xl: "h1", l: "h2", m: "h3" }[size];
      const words = list(p.rotator);
      const rot = words.length ? `<br><span class="serif">${esc(p.rotatorPrefix)}</span> <span class="rotator" data-words="${esc(words.join(","))}">${esc(words[0])}</span>.` : "";
      return `<${tag} class="h-${size}">${rich(p.text)}${rot}</${tag}>`;
    },
  },
  text: {
    label: "Text", defaults: { text: "Write something here.\n\nLeave a blank line to start a new paragraph.", style: "normal" },
    html: (p) => `<div class="prose t-${pick(p.style, ["normal", "large", "small"], "normal")}">${paras(p.text)}</div>`,
  },
  button: {
    label: "Button", defaults: { text: "Get in touch", link: "#contact", style: "solid" },
    html: (p) => `<a href="${esc(safeUrl(p.link))}" class="btn btn-${pick(p.style, ["solid", "outline"], "solid")}">${esc(p.text)}</a>`,
  },
  image: {
    label: "Image", defaults: { image: "", caption: "", size: "large" },
    html: (p) => `
      <figure class="img-${pick(p.size, ["small", "medium", "large", "page", "full"], "large")}">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.caption)}" loading="lazy">` : `<div class="image-placeholder">Add an image in the editor</div>`}
        ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}
      </figure>`,
  },
  quote: {
    label: "Quote", defaults: { text: "A kind word from a client.", name: "Client name", role: "Role, Company" },
    html: (p) => `
      <blockquote>
        <p class="quote-text">${rich(p.text)}</p>
        <footer><strong>${esc(p.name)}</strong>${p.role ? ` · ${esc(p.role)}` : ""}</footer>
      </blockquote>`,
  },
  tags: {
    label: "Tags", defaults: { items: "One, Two, Three" },
    html: (p) => `<ul class="clients">${list(p.items).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`,
  },
  links: {
    label: "Links", defaults: { items: [{ label: "Instagram", url: "#" }] },
    html: (p) => `<div class="socials">${(p.items || []).filter((x) => x.label)
      .map((x) => `<a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join("")}</div>`,
  },
  biglink: {
    label: "Big link", defaults: { text: "Let's make\nsomething *good* →", link: "mailto:hello@example.com" },
    html: (p) => `<a href="${esc(safeUrl(p.link))}" class="big-link">${rich(p.text)}</a>`,
  },
  projects: {
    label: "Projects grid", defaults: { filters: true },
    html: (p) => `
      ${p.filters !== false ? `<div class="filters" role="tablist">
        ${[["all", "All"], ...Object.entries(LABELS)].map(([k, l]) => `<button class="chip" data-filter="${k}">${esc(l)}</button>`).join("")}
      </div>` : ""}
      <div class="grid"></div>`,
  },
  services: {
    label: "Services list", defaults: { items: [{ title: "Service one", text: "What it is and who it's for." }] },
    html: (p) => `<div class="services">${(p.items || []).map((it, i) => `
      <article class="service" style="--c: var(--c-${SERVICE_COLORS[i % 4]})">
        <span class="num">${String(i + 1).padStart(2, "0")}</span>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.text)}</p>
      </article>`).join("")}</div>`,
  },
  spacer: {
    label: "Space", defaults: { size: "m" },
    html: (p) => `<div class="spacer spacer-${pick(p.size, ["s", "m", "l"], "m")}" aria-hidden="true"></div>`,
  },
};

const newPartId = () => "p" + Math.random().toString(36).slice(2, 8);
const part = (type, fields = {}) => ({ id: newPartId(), type, ...structuredClone(PART_TYPES[type].defaults), ...fields });

/* ---------- Section presets (what "Add a section" offers) ---------- */
const SECTION_PRESETS = {
  hero: { label: "Hero", make: () => ({ look: "hero", parts: [part("eyebrow"), part("heading", { size: "xl", text: "A big *headline*" }), part("text", { text: "A sentence or two of introduction." }), part("button", { text: "See the work ↓", link: "#work" })] }) },
  text: { label: "Text", make: () => ({ parts: [part("heading"), part("text")] }) },
  split: { label: "Text + image", make: () => ({ layout: "split", parts: [part("heading", { text: "Text beside an *image*" }), part("text", { text: "Tell the story behind a project, a process or a client." })] }) },
  image: { label: "Image", make: () => ({ parts: [part("image")] }) },
  quote: { label: "Quote", make: () => ({ parts: [part("quote")] }) },
  cta: { label: "Call to action", make: () => ({ look: "card", align: "center", parts: [part("heading", { text: "Ready to *start*?" }), part("text", { text: "Tell me about your project." }), part("button")] }) },
  work: { label: "Projects grid", make: () => ({ parts: [part("heading", { text: "Selected *work*" }), part("projects")] }) },
  services: { label: "Services", make: () => ({ parts: [part("heading", { text: "What I *do*" }), part("services")] }) },
  about: { label: "About", make: () => ({ layout: "split", side: "left", ratio: "two-fifths", shape: "portrait", parts: [part("heading", { text: "Hello, I'm *Byron*." }), part("text", { style: "large", text: "A short lead line." }), part("text", { text: "A few sentences about you." })] }) },
  contact: { label: "Contact", make: () => ({ look: "dark", parts: [part("eyebrow", { text: "Got a project in mind?" }), part("biglink"), part("links")] }) },
  banner: { label: "Scrolling banner", make: () => ({ layout: "banner", items: "First thing, Second thing, Third thing", parts: [] }) },
  blank: { label: "Blank", make: () => ({ parts: [] }) },
};

const newSectionId = (kind) => `${kind}-${Math.random().toString(36).slice(2, 6)}`;
function makeSection(kind) {
  return { id: newSectionId(kind), kind, menu: "", look: "plain", layout: "stack", align: "left", ...SECTION_PRESETS[kind].make() };
}

/* ---------- Upgrading older content ---------- */
function upgradeContent(c) {
  // v1: one fixed set of sections at the top level
  if (!Array.isArray(c.sections)) {
    c.sections = [
      { id: "hero", type: "hero", menu: "", ...c.hero, ctaLink: "#work" },
      { id: "banner", type: "marquee", menu: "", items: c.marquee },
      { id: "work", type: "work", menu: "Work", ...c.work, filters: true },
      { id: "services", type: "services", menu: "Services", ...c.services },
      { id: "about", type: "about", menu: "About", ...c.about },
      { id: "contact", type: "contact", menu: "Contact", ...c.contact },
    ];
    for (const k of ["hero", "marquee", "work", "services", "about", "contact"]) delete c[k];
  }
  // v2: each section type had fixed fields → v3: every section is a list of parts
  c.sections = c.sections.map((s) => (Array.isArray(s.parts) ? s : partsFromV2(s)));
  // Every part needs a stable id so its styles follow it when it moves
  for (const s of c.sections) for (const p of s.parts) p.id ??= newPartId();
  return c;
}

function partsFromV2(s) {
  const base = { id: s.id, kind: s.type, menu: s.menu || "", look: "plain", layout: "stack", align: s.align || "left" };
  const P = [];
  const add = (type, fields, when = true) => when && P.push(part(type, fields));
  switch (s.type) {
    case "hero":
      add("eyebrow", { text: s.eyebrow }, !!s.eyebrow);
      add("heading", { size: "xl", text: s.headline, rotator: s.rotator || "", rotatorPrefix: "made by" });
      add("text", { text: s.intro }, !!s.intro);
      add("button", { text: s.cta, link: s.ctaLink || "#work" }, !!s.cta);
      return { ...base, look: "hero", parts: P };
    case "marquee":
      return { ...base, kind: "banner", layout: "banner", items: s.items, parts: [] };
    case "work":
      add("heading", { text: s.heading });
      add("projects", { filters: s.filters !== false });
      return { ...base, parts: P };
    case "services":
      add("heading", { text: s.heading });
      add("services", { items: s.items || [] });
      return { ...base, parts: P };
    case "about":
      add("heading", { text: s.heading });
      add("text", { text: s.lead, style: "large" }, !!s.lead);
      add("text", { text: s.bio }, !!s.bio);
      add("tags", { items: s.clients }, !!s.clients);
      return { ...base, layout: "split", media: s.portrait || "", shape: "portrait", side: "left", ratio: "two-fifths", valign: "middle", parts: P };
    case "contact":
      add("eyebrow", { text: s.eyebrow }, !!s.eyebrow);
      add("biglink", { text: s.heading, link: `mailto:${s.email || ""}` });
      add("links", { items: s.socials || [] });
      return { ...base, look: "dark", parts: P };
    case "text":
      add("eyebrow", { text: s.eyebrow }, !!s.eyebrow);
      add("heading", { text: s.heading }, !!s.heading);
      add("text", { text: s.body });
      return { ...base, parts: P };
    case "image":
      add("image", { image: s.image, caption: s.caption, size: { contained: "page", narrow: "medium" }[s.width] || s.width || "large" });
      return { ...base, parts: P };
    case "split":
      add("heading", { text: s.heading }, !!s.heading);
      add("text", { text: s.body });
      add("button", { text: s.cta, link: s.ctaLink }, !!s.cta);
      return { ...base, layout: "split", media: s.image || "", shape: "landscape", side: s.side || "right", ratio: s.ratio || "half", valign: s.valign || "middle", parts: P };
    case "quote":
      add("quote", { text: s.quote, name: s.name, role: s.role });
      return { ...base, parts: P };
    case "cta":
      add("heading", { text: s.heading });
      add("text", { text: s.text }, !!s.text);
      add("button", { text: s.cta, link: s.ctaLink }, !!s.cta);
      return { ...base, look: "card", align: s.align || "center", parts: P };
    default:
      return { ...base, parts: P };
  }
}

/* ---------- Rendering ---------- */
let content = null;
const filters = {}; // projects-grid filter per section id

function renderGrid(holder) {
  const grid = holder.querySelector(".grid");
  const key = holder.closest("section").id;
  const filter = filters[key] || "all";
  holder.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === filter));
  grid.innerHTML = "";
  content.projects.forEach((p, i) => {
    if (filter !== "all" && p.category !== filter) return;
    const card = document.createElement("button");
    card.className = `card ${p.size || ""}`;
    card.dataset.project = p.id;
    card.style.setProperty("--c", `var(--c-${p.category})`);
    card.innerHTML = `
      <div class="card-art"></div>
      <div class="card-info">
        <div>
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.summary)}</p>
        </div>
        <span class="tag">${esc(LABELS[p.category])} · ${esc(p.year)}</span>
      </div>`;
    setArt(card.querySelector(".card-art"), p, i);
    card.addEventListener("click", () => openModal(p, i));
    grid.appendChild(card);
  });
}

const ALIGNS = ["left", "center", "right"];

function sectionHTML(s) {
  const layout = pick(s.layout, ["stack", "split", "banner"], "stack");
  const look = pick(s.look, ["plain", "hero", "dark", "card"], "plain");
  if (layout === "banner") {
    const items = list(s.items).map((m) => `<span>${esc(m)}</span><i>✦</i>`).join("");
    return `<section class="marquee" aria-hidden="true"><div class="marquee-track">${items + items}</div></section>`;
  }
  const parts = (s.parts || []).map((p, i) => PART_TYPES[p.type]
    ? `<div class="part part-${p.type}" data-pid="${esc(p.id)}">${PART_TYPES[p.type].html(p)}</div>` : "").join("");
  const cls = `sec look-${look} layout-${layout} align-${pick(s.align, ALIGNS, "left")}`;
  if (layout === "split") {
    return `<section class="${cls} media-${pick(s.side, ["left", "right"], "right")} ratio-${pick(s.ratio, ["third", "two-fifths", "half", "three-fifths", "two-thirds"], "half")} valign-${pick(s.valign, ["top", "middle", "bottom"], "middle")}">
      <div class="split-media shape-${pick(s.shape, ["landscape", "portrait", "square", "wide"], "landscape")}" data-bg="${esc(s.media)}">${s.media ? "" : "<span>Add an image in the editor</span>"}</div>
      <div class="parts">${parts}</div>
    </section>`;
  }
  return `<section class="${cls}"><div class="parts">${parts}</div></section>`;
}

function render(c) {
  content = upgradeContent(c);
  applyStyles(c);

  const main = $("top");
  const rotating = {};
  main.querySelectorAll(".rotator").forEach((r) => (rotating[r.closest("section").id] = r.textContent));
  main.innerHTML = "";

  for (const s of c.sections) {
    const tpl = document.createElement("template");
    tpl.innerHTML = sectionHTML(s).trim();
    const el = tpl.content.firstElementChild;
    el.id = s.id;
    el.dataset.section = s.kind || s.layout || "section";
    main.append(el);
    el.querySelectorAll("[data-bg]").forEach((b) => b.dataset.bg && setImage(b, b.dataset.bg));
    const r = el.querySelector(".rotator");
    if (r && r.dataset.words.split(",").includes(rotating[s.id])) r.textContent = rotating[s.id];
    el.querySelectorAll(".part-projects").forEach(renderGrid);
  }

  // Top menu, from sections that have a menu label
  $("navMenu").innerHTML = c.sections.filter((s) => s.menu)
    .map((s) => `<a href="#${esc(s.id)}">${esc(s.menu)}</a>`).join("");
}

// Project filters (any projects grid)
$("top").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const holder = btn.closest(".part-projects");
  filters[holder.closest("section").id] = btn.dataset.filter;
  renderGrid(holder);
});

// Modal
const modal = $("modal");
function openModal(p, i) {
  setArt($("modalArt"), p, i);
  $("modalMeta").textContent = `${LABELS[p.category]} · ${p.year}`;
  $("modalTitle").textContent = p.title;
  $("modalDesc").textContent = p.description;
  modal.showModal();
}
$("modalClose").addEventListener("click", () => modal.close());
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

// Rotating word in any heading
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  setInterval(() => {
    document.querySelectorAll(".rotator").forEach((r) => {
      const words = r.dataset.words.split(",");
      if (words.length < 2) return;
      const next = words[(words.indexOf(r.textContent) + 1) % words.length];
      r.classList.add("out");
      setTimeout(() => { r.textContent = next; r.classList.remove("out"); }, 250);
    });
  }, 2200);
}

// Theme toggle
$("themeToggle").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
});

$("year").textContent = new Date().getFullYear();

const Site = {
  render,
  applyStyles,
  upgradeContent,
  parts: PART_TYPES,
  presets: SECTION_PRESETS,
  makeSection,
  makePart: part,
  newPartId,
  newSectionId,
  ready: Store.loadContent().then((c) => { render(c); return c; }),
};
