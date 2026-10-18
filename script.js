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
function applyStyles(styles) {
  let tag = document.getElementById("site-style-changes");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "site-style-changes";
    document.head.append(tag);
  }
  tag.textContent = stylesToCSS(styles);
}

/* ---------- Section types ---------- */
/*
  Each section in content.sections is { id, type, menu, ...fields }.
  `menu` is the label shown in the top navigation (empty = not in the menu).
  `defaults` is what a newly added section starts with.
*/
const SECTION_TYPES = {
  hero: {
    label: "Hero",
    defaults: { eyebrow: "Small line above", headline: "A big *headline*\nfor this section", rotator: "", intro: "A sentence or two of introduction.", cta: "See the work ↓", ctaLink: "#work" },
    html: (s) => `
      <section class="hero">
        <p class="eyebrow">${esc(s.eyebrow)}</p>
        <h1><span>${rich(s.headline)}</span>${list(s.rotator).length ? `<br>
          <span class="serif">made by</span> <span class="rotator" data-words="${esc(list(s.rotator).join(","))}">${esc(list(s.rotator)[0])}</span>.` : ""}
        </h1>
        <div class="hero-foot">
          <p>${esc(s.intro)}</p>
          ${s.cta ? `<a href="${esc(safeUrl(s.ctaLink))}" class="btn">${esc(s.cta)}</a>` : ""}
        </div>
      </section>`,
  },
  marquee: {
    label: "Scrolling banner",
    defaults: { items: "First thing, Second thing, Third thing" },
    html: (s) => {
      const items = list(s.items).map((m) => `<span>${esc(m)}</span><i>✦</i>`).join("");
      return `<section class="marquee" aria-hidden="true"><div class="marquee-track">${items + items}</div></section>`;
    },
  },
  work: {
    label: "Projects grid",
    defaults: { heading: "Selected *work*", filters: true },
    html: (s) => `
      <section class="section">
        <div class="section-head">
          <h2>${rich(s.heading)}</h2>
          ${s.filters !== false ? `<div class="filters" role="tablist">
            ${[["all", "All"], ...Object.entries(LABELS)].map(([k, l]) => `<button class="chip" data-filter="${k}">${esc(l)}</button>`).join("")}
          </div>` : ""}
        </div>
        <div class="grid"></div>
      </section>`,
    after: (el, s) => renderGrid(el),
  },
  services: {
    label: "Services",
    defaults: { heading: "What I *do*", items: [{ title: "Service one", text: "What it is and who it's for." }, { title: "Service two", text: "What it is and who it's for." }] },
    html: (s) => `
      <section class="section">
        <h2>${rich(s.heading)}</h2>
        <div class="services">${(s.items || []).map((it, i) => `
          <article class="service" style="--c: var(--c-${SERVICE_COLORS[i % 4]})">
            <span class="num">${String(i + 1).padStart(2, "0")}</span>
            <h3>${esc(it.title)}</h3>
            <p>${esc(it.text)}</p>
          </article>`).join("")}
        </div>
      </section>`,
  },
  about: {
    label: "About",
    defaults: { heading: "Hello, I'm *Byron*.", lead: "A short lead line.", bio: "A few sentences about you.", portrait: "", clients: "" },
    html: (s) => `
      <section class="section about">
        <div class="about-portrait${s.portrait ? " has-image" : ""}" data-bg="${esc(s.portrait)}"><span>Your photo here</span></div>
        <div>
          <h2>${rich(s.heading)}</h2>
          <p class="lead">${esc(s.lead)}</p>
          <p>${esc(s.bio)}</p>
          ${list(s.clients).length ? `<ul class="clients">${list(s.clients).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        </div>
      </section>`,
  },
  contact: {
    label: "Contact",
    defaults: { eyebrow: "Got a project in mind?", heading: "Let's make\nsomething *good* →", email: "hello@example.com", socials: [] },
    html: (s) => `
      <section class="contact">
        <p class="eyebrow">${esc(s.eyebrow)}</p>
        <a href="mailto:${esc(s.email)}" class="big-link">${rich(s.heading)}</a>
        <div class="socials">${(s.socials || []).filter((x) => x.label)
          .map((x) => `<a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join("")}</div>
      </section>`,
  },
  text: {
    label: "Text",
    defaults: { eyebrow: "", heading: "A new *section*", body: "Write a paragraph here.\n\nLeave a blank line to start a new paragraph.", align: "left" },
    html: (s) => `
      <section class="section text-block align-${esc(s.align || "left")}">
        ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
        ${s.heading ? `<h2>${rich(s.heading)}</h2>` : ""}
        <div class="prose">${paras(s.body)}</div>
      </section>`,
  },
  image: {
    label: "Image",
    defaults: { image: "", caption: "", width: "contained" },
    html: (s) => `
      <section class="image-block width-${esc(s.width || "contained")}">
        <figure>
          ${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.caption)}" loading="lazy">` : `<div class="image-placeholder">Add an image in the editor</div>`}
          ${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ""}
        </figure>
      </section>`,
  },
  split: {
    label: "Text + image",
    defaults: { image: "", heading: "Text beside an *image*", body: "Tell the story behind a project, a process or a client.", side: "right", cta: "", ctaLink: "" },
    html: (s) => `
      <section class="section split image-${esc(s.side || "right")}">
        <div class="split-media" data-bg="${esc(s.image)}"></div>
        <div class="split-text">
          ${s.heading ? `<h2>${rich(s.heading)}</h2>` : ""}
          <div class="prose">${paras(s.body)}</div>
          ${s.cta ? `<a href="${esc(safeUrl(s.ctaLink))}" class="btn">${esc(s.cta)}</a>` : ""}
        </div>
      </section>`,
  },
  quote: {
    label: "Quote",
    defaults: { quote: "Byron was a joy to work with — fast, thoughtful and full of ideas.", name: "Client name", role: "Role, Company" },
    html: (s) => `
      <section class="section quote-block">
        <blockquote>
          <p class="quote-text">${rich(s.quote)}</p>
          <footer><strong>${esc(s.name)}</strong>${s.role ? ` · ${esc(s.role)}` : ""}</footer>
        </blockquote>
      </section>`,
  },
  cta: {
    label: "Call to action",
    defaults: { heading: "Ready to *start*?", text: "Tell me about your project and I'll get back to you within a day.", cta: "Get in touch", ctaLink: "#contact" },
    html: (s) => `
      <section class="cta-block">
        <h2>${rich(s.heading)}</h2>
        ${s.text ? `<p>${esc(s.text)}</p>` : ""}
        ${s.cta ? `<a href="${esc(safeUrl(s.ctaLink))}" class="btn">${esc(s.cta)}</a>` : ""}
      </section>`,
  },
};

const newSectionId = (type) => `${type}-${Math.random().toString(36).slice(2, 6)}`;

// Older content had one fixed set of sections; turn that into the section list
function upgradeContent(c) {
  if (Array.isArray(c.sections)) return c;
  c.sections = [
    { id: "hero", type: "hero", menu: "", ...c.hero, ctaLink: "#work" },
    { id: "banner", type: "marquee", menu: "", items: c.marquee },
    { id: "work", type: "work", menu: "Work", ...c.work, filters: true },
    { id: "services", type: "services", menu: "Services", ...c.services },
    { id: "about", type: "about", menu: "About", ...c.about },
    { id: "contact", type: "contact", menu: "Contact", ...c.contact },
  ];
  for (const k of ["hero", "marquee", "work", "services", "about", "contact"]) delete c[k];
  return c;
}

/* ---------- Rendering ---------- */
let content = null;
const filters = {}; // projects-grid filter per section id

function renderGrid(section) {
  const grid = section.querySelector(".grid");
  const filter = filters[section.id] || "all";
  section.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === filter));
  grid.innerHTML = "";
  content.projects.forEach((p, i) => {
    if (filter !== "all" && p.category !== filter) return;
    const card = document.createElement("button");
    card.className = `card ${p.size || ""}`;
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

function render(c) {
  content = upgradeContent(c);
  applyStyles(c.styles);

  const main = $("top");
  const rotating = {};
  main.querySelectorAll(".rotator").forEach((r) => (rotating[r.closest("section").id] = r.textContent));
  main.innerHTML = "";

  for (const s of c.sections) {
    const type = SECTION_TYPES[s.type];
    if (!type) continue;
    const tpl = document.createElement("template");
    tpl.innerHTML = type.html(s).trim();
    const el = tpl.content.firstElementChild;
    el.id = s.id;
    el.dataset.section = s.type;
    main.append(el);
    el.querySelectorAll("[data-bg]").forEach((b) => b.dataset.bg && setImage(b, b.dataset.bg));
    const r = el.querySelector(".rotator");
    if (r && r.dataset.words.split(",").includes(rotating[s.id])) r.textContent = rotating[s.id];
    type.after?.(el, s);
  }

  // Top menu, from sections that have a menu label
  $("navMenu").innerHTML = c.sections.filter((s) => s.menu && SECTION_TYPES[s.type])
    .map((s) => `<a href="#${esc(s.id)}">${esc(s.menu)}</a>`).join("");
}

// Project filters (any projects grid)
$("top").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const section = btn.closest("section");
  filters[section.id] = btn.dataset.filter;
  renderGrid(section);
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

// Rotating word in any hero
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
  types: SECTION_TYPES,
  newSectionId,
  ready: Store.loadContent().then((c) => { render(c); return c; }),
};
