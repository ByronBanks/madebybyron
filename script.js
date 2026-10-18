const LABELS = { design: "Design", photo: "Photo & Film", dev: "Development", studio: "Studio" };
const SERVICE_COLORS = ["design", "photo", "dev", "studio"];
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// *word* → italic serif, new line → <br>
const rich = (s) => esc(s).replace(/\*(.+?)\*/g, '<span class="serif">$1</span>').replace(/\n/g, "<br>");
const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

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

let content = null;
let filter = "all";
let words = [];

function renderGrid() {
  const grid = $("grid");
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
  content = c;
  const { hero, about, contact, services } = c;
  applyStyles(c.styles);

  $("heroEyebrow").textContent = hero.eyebrow;
  $("heroHeadline").innerHTML = rich(hero.headline);
  $("heroIntro").textContent = hero.intro;
  $("heroCta").textContent = hero.cta;
  words = list(hero.rotator);
  if (!words.includes($("rotator").textContent)) $("rotator").textContent = words[0] || "";

  const items = list(c.marquee).map((m) => `<span>${esc(m)}</span><i>✦</i>`).join("");
  $("marqueeTrack").innerHTML = items + items;

  $("workHeading").innerHTML = rich(c.work.heading);
  renderGrid();

  $("servicesHeading").innerHTML = rich(services.heading);
  $("servicesList").innerHTML = services.items.map((s, i) => `
    <article class="service" style="--c: var(--c-${SERVICE_COLORS[i % 4]})">
      <span class="num">${String(i + 1).padStart(2, "0")}</span>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.text)}</p>
    </article>`).join("");

  $("aboutHeading").innerHTML = rich(about.heading);
  $("aboutLead").textContent = about.lead;
  $("aboutBio").textContent = about.bio;
  const portrait = $("aboutPortrait");
  if (about.portrait) { setImage(portrait, about.portrait); portrait.classList.add("has-image"); }
  else { portrait.removeAttribute("style"); portrait.classList.remove("has-image"); }
  $("clients").innerHTML = list(about.clients).map((x) => `<li>${esc(x)}</li>`).join("");

  $("contactEyebrow").textContent = contact.eyebrow;
  $("contactLink").innerHTML = rich(contact.heading);
  $("contactLink").href = `mailto:${contact.email}`;
  $("socials").innerHTML = contact.socials
    .filter((s) => s.label)
    .map((s) => `<a href="${esc(s.url || "#")}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join("");
}

$("filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === btn));
  filter = btn.dataset.filter;
  renderGrid();
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

// Rotating word in the hero
const rotator = $("rotator");
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  setInterval(() => {
    if (words.length < 2) return;
    const next = words[(words.indexOf(rotator.textContent) + 1) % words.length];
    rotator.classList.add("out");
    setTimeout(() => { rotator.textContent = next; rotator.classList.remove("out"); }, 250);
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
  ready: Store.loadContent().then((c) => { render(c); return c; }),
};
