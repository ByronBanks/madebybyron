/* Sign-in button + left-hand site editor. Talks to the page via Site.render and to storage via Store. */
(() => {
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid);
    return el;
  };
  const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
  const setPath = (o, p, v) => {
    const keys = p.split(".");
    const last = keys.pop();
    keys.reduce((x, k) => x[k], o)[last] = v;
  };
  const clone = (x) => structuredClone(x);

  let saved = null;   // last saved content
  let draft = null;   // content being edited
  let dirty = false;
  const openSections = new Set(["Page sections"]);
  const openItems = new Set(); // which sections/projects are expanded

  /* ---------- Sign-in ---------- */
  const signInBtn = document.getElementById("signInBtn");

  const GITHUB = Store.mode === "github";
  const tokenInput = h("input", { type: "password", autocomplete: "off", placeholder: "github_pat_…", required: true });
  const signInError = h("p", { class: "cms-error", role: "alert" });
  const submitBtn = h("button", { type: "submit", class: "cms-btn primary" }, GITHUB ? "Sign in" : "Continue as Byron");

  const signInDialog = h("dialog", { class: "cms-dialog" },
    h("form", { onsubmit: submitSignIn },
      h("h3", {}, "Sign in to edit"),
      GITHUB
        ? [h("p", { class: "cms-dialog-note" },
            `Paste your GitHub access token for ${Store.repo}. It's remembered on this device until you sign out, and only ever sent to GitHub.`),
           h("label", { class: "cms-field" }, h("span", {}, "GitHub token"), tokenInput)]
        : h("p", { class: "cms-dialog-note" },
            "Preview mode: no GitHub repository is connected yet, so edits are kept in this browser only."),
      signInError,
      h("div", { class: "cms-dialog-actions" },
        h("button", { type: "button", class: "cms-btn", onclick: () => signInDialog.close() }, "Cancel"),
        submitBtn)));
  document.body.append(signInDialog);

  async function submitSignIn(e) {
    e.preventDefault();
    signInError.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    try {
      await Store.signIn(tokenInput.value);
      tokenInput.value = "";
      signInDialog.close();
      saved = null; // load the latest version from GitHub
      openEditor();
    } catch (err) {
      signInError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = GITHUB ? "Sign in" : "Continue as Byron";
    }
  }

  signInBtn.addEventListener("click", () => {
    if (Store.isSignedIn()) openEditor();
    else { signInError.textContent = ""; signInDialog.showModal(); }
  });

  /* ---------- Sidebar shell ---------- */
  const status = h("span", { class: "cms-status" }, "All changes saved");
  const body = h("div", { class: "cms-body" });
  const importInput = h("input", { type: "file", accept: "application/json", hidden: true, onchange: importJSON });
  const saveBtn = h("button", { class: "cms-btn primary", onclick: save }, GITHUB ? "Publish" : "Save");

  /* ---------- Outline view: draws the edge of every box on the page ---------- */
  const OUTLINE_KEY = "cms-outlines";
  const outlineSwitch = h("input", { type: "checkbox", role: "switch", onchange: () => setOutlines(outlineSwitch.checked) });
  const outlineLabel = h("div", { class: "cms-outline-label", hidden: true });
  document.body.append(outlineLabel);

  function setOutlines(on) {
    outlineSwitch.checked = on;
    document.body.classList.toggle("cms-outlines", on && document.body.classList.contains("cms-open"));
    if (!on) { outlineLabel.hidden = true; closeInspector(); }
    try { localStorage.setItem(OUTLINE_KEY, on ? "1" : "0"); } catch (e) {}
  }
  const outlinesOn = () => document.body.classList.contains("cms-outlines");

  // The page element under the pointer (never the editor itself)
  function pageTarget(e) {
    const el = e.target.closest?.("main *, .nav *, .footer *, .nav, .footer, main");
    return el && !el.closest(".cms, .cms-fab, dialog, .cms-outline-label") ? el : null;
  }

  // Name the box under the pointer, e.g. "div.card-info"
  document.addEventListener("mouseover", (e) => {
    if (!outlinesOn()) return;
    const el = pageTarget(e);
    if (!el) { outlineLabel.hidden = true; return; }
    outlineLabel.textContent = Inspector.describe(el);
    const r = el.getBoundingClientRect();
    outlineLabel.style.left = Math.max(4, r.left) + "px";
    outlineLabel.style.top = Math.max(4, r.top - 22) + "px";
    outlineLabel.hidden = false;
  });

  /* ---------- Inspector: click a box to see all its styles ---------- */
  let selected = null;
  let showAllProps = false;
  const inspectorView = h("div", { class: "cms-body cms-inspector", hidden: true });

  // While outlines are on, a click selects instead of following links or pressing buttons
  document.addEventListener("click", (e) => {
    if (!outlinesOn()) return;
    const el = pageTarget(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    inspect(el);
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected) closeInspector(); });

  let target = null; // CSS selector that style edits apply to

  function inspect(el) {
    selected?.classList.remove("cms-selected");
    selected = el;
    el.classList.add("cms-selected");
    target = Inspector.targets(el)[0]?.sel || null;
    renderInspector();
    body.hidden = true;
    inspectorView.hidden = false;
    inspectorView.scrollTop = 0;
    setCollapsed(false);
  }

  function renderInspector() {
    if (!selected?.isConnected) return closeInspector();
    const top = inspectorView.scrollTop;
    draft.styles ??= {};
    inspectorView.replaceChildren(Inspector.render(selected, {
      onSelect: inspect,
      onBack: closeInspector,
      showAll: showAllProps,
      onToggleAll: (on) => { showAllProps = on; renderInspector(); },
      styles: draft.styles,
      target,
      onTarget: (sel) => { target = sel; renderInspector(); },
      onSet: (prop, value, { live } = {}) => {
        if (!target) return;
        (draft.styles[target] ??= {})[prop] = value;
        stylesChanged(!live);
      },
      onReset: (prop, sel = target) => {
        if (!draft.styles[sel]) return;
        delete draft.styles[sel][prop];
        if (!Object.keys(draft.styles[sel]).length) delete draft.styles[sel];
        stylesChanged(true);
      },
    }));
    inspectorView.scrollTop = top;
  }

  // Style edits only restyle the page; they don't rebuild it, so the selection survives
  function stylesChanged(rerender) {
    setDirty(true);
    Site.applyStyles(draft.styles);
    if (rerender) renderInspector();
  }

  function closeInspector() {
    selected?.classList.remove("cms-selected");
    selected = null;
    inspectorView.hidden = true;
    inspectorView.replaceChildren();
    body.hidden = false;
    if (draft) buildForm(); // refresh the Style changes list
  }

  const sidebar = h("aside", { class: "cms", "aria-label": "Site editor" },
    h("div", { class: "cms-head" },
      h("div", {},
        h("strong", {}, "Site editor"),
        h("span", { class: "cms-pill" }, GITHUB ? "Connected to GitHub" : "Preview mode")),
      h("button", { class: "cms-icon", title: "Hide editor", "aria-label": "Hide editor", onclick: () => setCollapsed(true) }, "⟨")),
    h("label", { class: "cms-toggle" },
      h("span", {}, "Show outlines"),
      outlineSwitch,
      h("i", { "aria-hidden": "true" })),
    body,
    inspectorView,
    h("div", { class: "cms-foot" },
      h("div", { class: "cms-row" },
        status,
        h("div", { class: "cms-actions" },
          h("button", { class: "cms-btn", onclick: discard }, "Discard"),
          saveBtn)),
      h("div", { class: "cms-row cms-more" },
        h("button", { class: "cms-link", onclick: exportJSON }, "Export"),
        h("button", { class: "cms-link", onclick: () => importInput.click() }, "Import"),
        h("button", { class: "cms-link", onclick: signOut }, "Sign out")),
      h("p", { class: "cms-note" }, GITHUB
        ? "Save publishes to GitHub. The live site updates about a minute later."
        : "Preview mode: saved in this browser only."),
      importInput));

  const fab = h("button", { class: "cms-fab", onclick: () => setCollapsed(false) }, "✎ Edit site");
  document.body.append(sidebar, fab);

  function setCollapsed(c) { document.body.classList.toggle("cms-collapsed", c); }

  async function openEditor() {
    if (!saved) {
      const current = Site.upgradeContent(await Store.loadContent());
      saved = clone(current);
      draft = clone(current);
      Site.render(draft);
    }
    buildForm();
    document.body.classList.add("cms-open");
    setCollapsed(false);
    let outlines = false;
    try { outlines = localStorage.getItem(OUTLINE_KEY) === "1"; } catch (e) {}
    setOutlines(outlines);
    signInBtn.textContent = "Editor";
  }

  function closeEditor() {
    document.body.classList.remove("cms-open", "cms-collapsed", "cms-outlines");
    outlineLabel.hidden = true;
    closeInspector();
    signInBtn.textContent = "Sign in";
  }

  /* ---------- Change tracking ---------- */
  let timer = 0;
  function changed() {
    setDirty(true);
    clearTimeout(timer);
    timer = setTimeout(() => Site.render(draft), 40);
  }
  function setDirty(d, msg) {
    dirty = d;
    status.textContent = msg || (d ? "Unsaved changes" : "All changes saved");
    status.classList.toggle("dirty", d);
  }

  async function save() {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    status.textContent = GITHUB ? "Publishing…" : "Saving…";
    try {
      const snapshot = clone(draft);
      await Store.saveContent(snapshot);
      saved = snapshot;
      setDirty(JSON.stringify(draft) !== JSON.stringify(saved), GITHUB ? "Published ✓ — live in about a minute" : "Saved ✓");
    } catch (e) {
      setDirty(true, "Couldn't save — " + (e?.message || "unknown error"));
    } finally {
      saveBtn.disabled = false;
    }
  }
  function discard() {
    if (!dirty) return;
    draft = clone(saved);
    Site.render(draft);
    buildForm();
    setDirty(false);
    if (selected) renderInspector();
  }
  async function signOut() {
    if (dirty && !confirm("Sign out and lose unsaved changes?")) return;
    draft = clone(saved);
    Site.render(saved);
    setDirty(false);
    await Store.signOut();
    saved = draft = null;
    closeEditor();
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "content.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importJSON() {
    const file = importInput.files[0];
    importInput.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(data?.sections || data?.hero) || !Array.isArray(data.projects)) throw new Error("bad file");
      draft = Site.upgradeContent(data);
      buildForm();
      changed();
    } catch (e) { alert("That file isn't valid site content."); }
  }

  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- Field builders ---------- */
  function field(path, label, opts = {}) {
    const { type = "text", hint, rows = 3, options } = opts;
    const value = opts.value ? opts.value(getPath(draft, path) ?? "") : getPath(draft, path) ?? "";
    let input;
    if (type === "textarea") input = h("textarea", { rows }, value);
    else if (type === "select") input = h("select", {}, options.map(([v, l]) => h("option", { value: String(v), selected: String(v) === String(value) }, l)));
    else input = h("input", { type, value });
    if (type === "textarea") input.value = value;
    input.addEventListener("input", () => {
      setPath(draft, path, opts.parse ? opts.parse(input.value) : type === "number" ? Number(input.value) : input.value);
      opts.onInput?.();
      changed();
    });
    return h("label", { class: "cms-field" }, h("span", {}, label), input, hint && h("small", {}, hint));
  }

  function imageField(path, label) {
    const thumb = h("div", { class: "cms-thumb" });
    const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
    const removeBtn = h("button", { type: "button", class: "cms-btn small", onclick: () => update("") }, "Remove");
    const uploadBtn = h("button", { type: "button", class: "cms-btn small primary", onclick: () => fileInput.click() });
    const note = h("small", {});

    function show() {
      const url = getPath(draft, path);
      thumb.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "";
      thumb.textContent = url ? "" : "No image — drop one here";
      uploadBtn.textContent = url ? "Replace" : "Upload";
      removeBtn.hidden = !url;
    }
    function update(url) { setPath(draft, path, url); show(); changed(); }
    async function handle(file) {
      if (!file || !file.type.startsWith("image/")) return;
      note.textContent = "Processing…";
      try { update(await Store.uploadImage(file)); note.textContent = ""; }
      catch (e) { note.textContent = "Couldn't read that image."; }
    }
    fileInput.addEventListener("change", () => { handle(fileInput.files[0]); fileInput.value = ""; });
    thumb.addEventListener("dragover", (e) => { e.preventDefault(); thumb.classList.add("over"); });
    thumb.addEventListener("dragleave", () => thumb.classList.remove("over"));
    thumb.addEventListener("drop", (e) => { e.preventDefault(); thumb.classList.remove("over"); handle(e.dataTransfer.files[0]); });
    show();

    return h("div", { class: "cms-field" },
      h("span", {}, label), thumb,
      h("div", { class: "cms-row" }, uploadBtn, removeBtn), note, fileInput);
  }

  function section(title, ...kids) {
    const d = h("details", { class: "cms-section", open: openSections.has(title) },
      h("summary", {}, title), h("div", { class: "cms-section-body" }, kids));
    d.addEventListener("toggle", () => d.open ? openSections.add(title) : openSections.delete(title));
    return d;
  }

  const RICH_HINT = "Wrap words in *asterisks* for italic. New line = line break.";
  const CATEGORIES = [["design", "Design"], ["photo", "Photo & Film"], ["dev", "Development"], ["studio", "Studio"]];
  const SIZES = [["", "Normal"], ["wide", "Wide"], ["tall", "Tall"]];

  function projectsEditor() {
    const wrap = h("div", { class: "cms-list" });
    const move = (i, d) => {
      const p = draft.projects;
      [p[i], p[i + d]] = [p[i + d], p[i]];
      rebuild(); changed();
    };
    function rebuild() {
      wrap.replaceChildren(...draft.projects.map((p, i) => {
        const summary = h("summary", {}, h("b", {}, p.title || "Untitled"), h("span", {}, CATEGORIES.find((c) => c[0] === p.category)?.[1]));
        const refreshSummary = () => { summary.firstChild.textContent = draft.projects[i].title || "Untitled"; summary.lastChild.textContent = CATEGORIES.find((c) => c[0] === draft.projects[i].category)?.[1]; };
        const item = h("details", { class: "cms-item", open: p._open },
          summary,
          h("div", { class: "cms-section-body" },
            imageField(`projects.${i}.image`, "Image"),
            field(`projects.${i}.title`, "Title", { onInput: refreshSummary }),
            h("div", { class: "cms-grid2" },
              field(`projects.${i}.category`, "Category", { type: "select", options: CATEGORIES, onInput: refreshSummary }),
              field(`projects.${i}.year`, "Year", { type: "number" })),
            field(`projects.${i}.summary`, "Short line"),
            field(`projects.${i}.description`, "Description", { type: "textarea", rows: 4 }),
            field(`projects.${i}.size`, "Card size", { type: "select", options: SIZES }),
            h("div", { class: "cms-row" },
              h("button", { type: "button", class: "cms-btn small", disabled: i === 0, onclick: () => move(i, -1) }, "↑ Up"),
              h("button", { type: "button", class: "cms-btn small", disabled: i === draft.projects.length - 1, onclick: () => move(i, 1) }, "↓ Down"),
              h("button", { type: "button", class: "cms-btn small danger", onclick: () => {
                if (!confirm(`Delete "${p.title || "Untitled"}"?`)) return;
                draft.projects.splice(i, 1); rebuild(); changed();
              } }, "Delete"))));
        item.addEventListener("toggle", () => { Object.defineProperty(p, "_open", { value: item.open, enumerable: false, writable: true, configurable: true }); });
        return item;
      }));
    }
    rebuild();
    const add = h("button", { type: "button", class: "cms-btn primary block", onclick: () => {
      const p = { id: "p" + Date.now(), title: "New project", category: "design", year: new Date().getFullYear(), summary: "", description: "", size: "", image: "" };
      Object.defineProperty(p, "_open", { value: true, enumerable: false, writable: true, configurable: true });
      draft.projects.unshift(p);
      rebuild(); changed();
    } }, "+ Add project");
    return [add, wrap];
  }

  // A list of small items (services, social links): each item is a few fields
  function listEditor(path, fields, addLabel, blank) {
    const wrap = h("div", { class: "cms-list" });
    function rebuild() {
      const items = getPath(draft, path) || [];
      wrap.replaceChildren(...items.map((_, i) =>
        h("div", { class: "cms-subgroup cms-list-item" },
          fields.map(([key, label, opts]) => field(`${path}.${i}.${key}`, label, opts)),
          h("button", { type: "button", class: "cms-icon", title: "Remove", "aria-label": "Remove", onclick: () => {
            getPath(draft, path).splice(i, 1); rebuild(); changed();
          } }, "✕"))));
    }
    rebuild();
    return [wrap, h("button", { type: "button", class: "cms-btn small", onclick: () => {
      if (!getPath(draft, path)) setPath(draft, path, []);
      getPath(draft, path).push(structuredClone(blank)); rebuild(); changed();
    } }, addLabel)];
  }

  /* ---------- Page sections and the parts inside them ---------- */
  const PART_FIELDS = {
    eyebrow: (p) => [field(p + "text", "Text")],
    heading: (p) => [
      field(p + "text", "Heading", { type: "textarea", rows: 2, hint: RICH_HINT }),
      field(p + "size", "Size", { type: "select", options: [["xl", "Extra large"], ["l", "Large"], ["m", "Medium"]] }),
      h("div", { class: "cms-grid2" },
        field(p + "rotatorPrefix", "Rotating line starts with"),
        field(p + "rotator", "Rotating words", { hint: "Comma-separated. Empty = no rotating line." })),
    ],
    text: (p) => [
      field(p + "text", "Text", { type: "textarea", rows: 5, hint: "Blank line = new paragraph. *asterisks* = italic." }),
      field(p + "style", "Style", { type: "select", options: [["normal", "Normal"], ["large", "Large (lead)"], ["small", "Small"]] }),
    ],
    button: (p) => [
      h("div", { class: "cms-grid2" }, field(p + "text", "Button text"), field(p + "link", "Link", { hint: "#section-id or a URL" })),
      field(p + "style", "Style", { type: "select", options: [["solid", "Solid"], ["outline", "Outline"]] }),
    ],
    image: (p) => [
      imageField(p + "image", "Image"),
      field(p + "caption", "Caption"),
      field(p + "size", "Size", { type: "select", options: [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["page", "Page width"], ["full", "Edge to edge"]] }),
    ],
    quote: (p) => [
      field(p + "text", "Quote", { type: "textarea", rows: 3 }),
      h("div", { class: "cms-grid2" }, field(p + "name", "Name"), field(p + "role", "Role / company")),
    ],
    tags: (p) => [field(p + "items", "Tags", { type: "textarea", rows: 2, hint: "Comma-separated." })],
    links: (p) => [listEditor(p + "items", [["label", "Label"], ["url", "Link", { type: "url" }]], "+ Add link", { label: "", url: "" })],
    biglink: (p) => [
      field(p + "text", "Text", { type: "textarea", rows: 2, hint: RICH_HINT }),
      field(p + "link", "Link", { hint: "mailto:you@example.com, a URL or #section-id" }),
    ],
    projects: (p) => [
      field(p + "filters", "Category filter buttons", { type: "select", options: [[true, "Show"], [false, "Hide"]], parse: (v) => v === "true" }),
      h("p", { class: "cms-note" }, "Shows the projects from the Projects list."),
    ],
    services: (p) => [listEditor(p + "items", [["title", "Service"], ["text", "Description", { type: "textarea", rows: 2 }]], "+ Add service", { title: "New service", text: "" })],
    spacer: (p) => [field(p + "size", "Height", { type: "select", options: [["s", "Small"], ["m", "Medium"], ["l", "Large"]] })],
  };

  const plain = (t) => String(t ?? "").replace(/\*/g, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  function partPreview(p) {
    if (p.type === "links" || p.type === "services") return `${(p.items || []).length} item${(p.items || []).length === 1 ? "" : "s"}`;
    if (p.type === "image") return p.caption || (p.image ? "Image" : "No image yet");
    if (p.type === "spacer") return { s: "Small", m: "Medium", l: "Large" }[p.size] || "";
    if (p.type === "projects") return "From the Projects list";
    return plain(p.text ?? p.items);
  }
  const sectionTitle = (s) => {
    if (s.layout === "banner") return plain(s.items);
    const first = (s.parts || []).find((p) => p.type === "heading") || (s.parts || [])[0];
    return first ? partPreview(first) : "Empty";
  };
  const showOnPage = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Left / Centre / Right buttons for a section
  function alignControl(s) {
    const group = h("div", { class: "cms-seg", role: "radiogroup", "aria-label": "Alignment" });
    const now = () => (["left", "center", "right"].includes(s.align) ? s.align : "left");
    const draw = () => group.replaceChildren(...[["left", "Left", "⇤"], ["center", "Centre", "↔"], ["right", "Right", "⇥"]].map(([v, l, icon]) =>
      h("button", { type: "button", role: "radio", "aria-checked": String(now() === v), class: now() === v ? "on" : "",
        onclick: () => { s.align = v; draw(); changed(); } }, h("span", { "aria-hidden": "true" }, icon), " ", l)));
    draw();
    return h("div", { class: "cms-field" }, h("span", {}, "Alignment"), group);
  }

  const openParts = new WeakSet();
  let dragging = null; // { si, pj } of the part being dragged

  function sectionsEditor() {
    const wrap = h("div", { class: "cms-list" });
    const presetSelect = h("select", {}, Object.entries(Site.presets).map(([k, t]) => h("option", { value: k }, t.label)));

    function moveSection(i, d) {
      const list = draft.sections;
      [list[i], list[i + d]] = [list[i + d], list[i]];
      rebuild(); changed();
      setTimeout(() => showOnPage(list[i + d].id), 60);
    }
    function removeSection(i) {
      const s = draft.sections[i];
      if (!confirm(`Delete this section${sectionTitle(s) ? ` (“${sectionTitle(s)}”)` : ""}?\n\nYou can still press Discard before publishing.`)) return;
      draft.sections.splice(i, 1);
      for (const sel of Object.keys(draft.styles || {})) if (sel === `#${s.id}` || sel.startsWith(`#${s.id} `)) delete draft.styles[sel];
      rebuild(); changed();
    }
    function duplicateSection(i) {
      const copy = structuredClone(draft.sections[i]);
      copy.id = Site.newSectionId(copy.kind || "section");
      copy.menu = "";
      draft.sections.splice(i + 1, 0, copy);
      openItems.add(copy.id);
      rebuild(); changed();
      setTimeout(() => showOnPage(copy.id), 60);
    }
    function addSection() {
      const s = Site.makeSection(presetSelect.value);
      draft.sections.push(s);
      openItems.add(s.id);
      rebuild(); changed();
      setTimeout(() => { showOnPage(s.id); wrap.lastElementChild?.scrollIntoView({ block: "nearest" }); }, 60);
    }

    // Move a part within a section, or into another section
    function movePart(fromS, fromP, toS, toP) {
      const [moved] = draft.sections[fromS].parts.splice(fromP, 1);
      if (fromS === toS && toP > fromP) toP--;
      draft.sections[toS].parts.splice(toP, 0, moved);
      rebuild(); changed();
    }

    function partsEditor(s, si) {
      const box = h("div", { class: "cms-parts" });
      const typeSelect = h("select", {}, Object.entries(Site.parts).map(([k, t]) => h("option", { value: k }, t.label)));

      s.parts.forEach((p, j) => {
        const path = `sections.${si}.parts.${j}.`;
        const label = h("span", { class: "cms-part-preview" }, partPreview(p));
        const handle = h("span", { class: "cms-handle", title: "Drag to move", "aria-hidden": "true" }, "⠿");
        const body = h("div", { class: "cms-part-body", hidden: !openParts.has(p) }, PART_FIELDS[p.type]?.(path) || []);
        const card = h("div", { class: "cms-part" + (openParts.has(p) ? " open" : "") },
          h("div", { class: "cms-part-head" },
            handle,
            h("button", { type: "button", class: "cms-part-title", "aria-expanded": String(openParts.has(p)), onclick: () => {
              const open = body.hidden;
              body.hidden = !open;
              card.classList.toggle("open", open);
              open ? openParts.add(p) : openParts.delete(p);
            } }, h("b", {}, Site.parts[p.type]?.label || p.type), label),
            h("button", { type: "button", class: "cms-icon", title: "Move up", "aria-label": "Move part up", disabled: j === 0, onclick: () => movePart(si, j, si, j - 1) }, "↑"),
            h("button", { type: "button", class: "cms-icon", title: "Move down", "aria-label": "Move part down", disabled: j === s.parts.length - 1, onclick: () => movePart(si, j, si, j + 2) }, "↓"),
            h("button", { type: "button", class: "cms-icon danger", title: "Remove part", "aria-label": "Remove part", onclick: () => {
              if (!confirm(`Remove this ${Site.parts[p.type]?.label || "part"}?`)) return;
              s.parts.splice(j, 1); rebuild(); changed();
            } }, "✕")),
          body);
        card.addEventListener("input", () => (label.textContent = partPreview(p)));

        // Drag by the handle only, so text in the fields can still be selected
        handle.addEventListener("pointerdown", () => (card.draggable = true));
        card.addEventListener("dragstart", (e) => {
          dragging = { si, pj: j };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", "part");
          card.classList.add("dragging");
          document.body.classList.add("cms-dragging");
        });
        card.addEventListener("dragend", () => {
          card.draggable = false;
          dragging = null;
          card.classList.remove("dragging");
          document.body.classList.remove("cms-dragging");
          document.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
        });
        card.dataset.index = j;
        box.append(card);
      });

      // Drop zone: works for the whole list, including empty sections
      const dropIndex = (e) => {
        const cards = [...box.querySelectorAll(":scope > .cms-part")];
        for (const c of cards) {
          const r = c.getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) return { index: +c.dataset.index, card: c, where: "before" };
        }
        const last = cards.at(-1);
        return { index: cards.length, card: last, where: "after" };
      };
      box.addEventListener("dragover", (e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
        const t = dropIndex(e);
        if (t.card) t.card.classList.add(t.where === "before" ? "drop-before" : "drop-after");
        else box.classList.add("drop-before");
      });
      box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("drop-before"); });
      box.addEventListener("drop", (e) => {
        if (!dragging) return;
        e.preventDefault();
        const { si: fromS, pj: fromP } = dragging;
        movePart(fromS, fromP, si, dropIndex(e).index);
      });

      if (!s.parts.length) box.append(h("p", { class: "cms-note cms-parts-empty" }, "No parts yet. Add one below, or drag one here from another section."));

      return [
        h("span", { class: "cms-label" }, "Parts — drag ⠿ to reorder"),
        box,
        h("div", { class: "cms-add-part" }, typeSelect,
          h("button", { type: "button", class: "cms-btn small primary", onclick: () => {
            const p = Site.makePart(typeSelect.value);
            s.parts.push(p);
            openParts.add(p);
            rebuild(); changed();
          } }, "+ Add part")),
      ];
    }

    function sectionSettings(s, si) {
      const p = `sections.${si}.`;
      if (s.layout === "banner") return [field(p + "items", "Banner words", { type: "textarea", rows: 2, hint: "Comma-separated." })];
      return [
        alignControl(s),
        h("div", { class: "cms-grid2" },
          field(p + "look", "Look", { type: "select", options: [["plain", "Plain"], ["hero", "Hero (extra space)"], ["dark", "Dark"], ["card", "Card"]] }),
          field(p + "layout", "Layout", { type: "select", options: [["stack", "One column"], ["split", "Image beside"]],
            onInput: () => { s.side ??= "right"; s.ratio ??= "half"; s.valign ??= "middle"; s.shape ??= "landscape"; s.media ??= ""; rebuild(); } })),
        s.layout === "split" ? h("div", { class: "cms-subgroup" },
          imageField(p + "media", "Side image"),
          h("div", { class: "cms-grid2" },
            field(p + "side", "Image side", { type: "select", options: [["right", "Right"], ["left", "Left"]] }),
            field(p + "shape", "Image shape", { type: "select", options: [["landscape", "Landscape"], ["portrait", "Portrait"], ["square", "Square"], ["wide", "Wide"]] })),
          h("div", { class: "cms-grid2" },
            field(p + "ratio", "Image size", { type: "select", options: [["third", "1/3"], ["two-fifths", "2/5"], ["half", "1/2"], ["three-fifths", "3/5"], ["two-thirds", "2/3"]] }),
            field(p + "valign", "Line up", { type: "select", options: [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]] }))) : null,
        partsEditor(s, si),
      ];
    }

    function rebuild() {
      const n = draft.sections.length;
      const scroll = body.scrollTop;
      wrap.replaceChildren(...draft.sections.map((s, i) => {
        s.parts ??= [];
        const titleEl = h("span", {}, sectionTitle(s));
        const kind = Site.presets[s.kind]?.label || (s.layout === "banner" ? "Scrolling banner" : "Section");
        const item = h("details", { class: "cms-item cms-sec", open: openItems.has(s.id) },
          h("summary", {},
            h("span", { class: "cms-sec-num" }, String(i + 1)),
            h("span", { class: "cms-sec-name" }, h("b", {}, kind), titleEl),
            s.menu ? h("span", { class: "cms-sec-menu", title: "In the top menu" }, s.menu) : null,
            h("span", { class: "cms-sec-moves" },
              h("button", { type: "button", class: "cms-icon", title: "Move section up", "aria-label": "Move section up", disabled: i === 0,
                onclick: (e) => { e.preventDefault(); moveSection(i, -1); } }, "↑"),
              h("button", { type: "button", class: "cms-icon", title: "Move section down", "aria-label": "Move section down", disabled: i === n - 1,
                onclick: (e) => { e.preventDefault(); moveSection(i, 1); } }, "↓"))),
          h("div", { class: "cms-section-body" },
            sectionSettings(s, i),
            h("div", { class: "cms-subgroup" },
              field(`sections.${i}.menu`, "Top menu label", { hint: "Leave empty to keep this section out of the menu." }),
              h("small", { class: "cms-note" }, "Link to this section with ", h("code", {}, "#" + s.id))),
            h("div", { class: "cms-row" },
              h("button", { type: "button", class: "cms-btn small", onclick: () => duplicateSection(i) }, "Duplicate section"),
              h("button", { type: "button", class: "cms-btn small danger", onclick: () => removeSection(i) }, "Delete section"))));
        item.addEventListener("input", () => (titleEl.textContent = sectionTitle(draft.sections[i])));
        item.addEventListener("toggle", (e) => {
          if (e.target !== item) return;
          if (item.open) { openItems.add(s.id); showOnPage(s.id); } else openItems.delete(s.id);
        });
        // Dragging a part over a closed section opens it so it can be dropped there
        item.addEventListener("dragenter", () => { if (dragging && !item.open) { item.open = true; openItems.add(s.id); } });
        return item;
      }));
      body.scrollTop = scroll;
    }
    rebuild();

    return [
      wrap,
      h("div", { class: "cms-add-section" },
        h("label", { class: "cms-field" }, h("span", {}, "Add a section"), presetSelect),
        h("button", { type: "button", class: "cms-btn primary", onclick: addSection }, "+ Add")),
    ];
  }

  // Every style edit made in the inspector, with undo
  function styleChangesList() {
    const entries = Object.entries(draft.styles || {}).filter(([, p]) => Object.keys(p).length);
    if (!entries.length) {
      return h("p", { class: "cms-note" }, "None yet. Turn on Show outlines, click any part of the page, and change its values.");
    }
    const undo = (sel, prop) => {
      if (prop) delete draft.styles[sel][prop];
      if (!prop || !Object.keys(draft.styles[sel]).length) delete draft.styles[sel];
      setDirty(true);
      Site.applyStyles(draft.styles);
      buildForm();
    };
    return [
      entries.map(([sel, props]) => h("div", { class: "insp-change" },
        h("div", { class: "cms-row" },
          h("code", {}, sel),
          h("button", { type: "button", class: "cms-link", onclick: () => undo(sel) }, "Undo all")),
        Object.entries(props).map(([p, v]) => h("div", { class: "insp-change-row" },
          h("span", {}, `${p}: ${v}`),
          h("button", { type: "button", class: "insp-reset", title: "Undo", onclick: () => undo(sel, p) }, "↺"))))),
      h("button", { type: "button", class: "cms-btn small danger", onclick: () => {
        if (!confirm("Undo every style change?")) return;
        draft.styles = {};
        setDirty(true);
        Site.applyStyles(draft.styles);
        buildForm();
      } }, "Undo all style changes"),
    ];
  }

  function buildForm() {
    const scroll = body.scrollTop;
    body.replaceChildren(
      section("Page sections", sectionsEditor()),
      section("Projects", projectsEditor()),
      section("Style changes", styleChangesList()));
    body.scrollTop = scroll;
  }

  // Stay in the editor across reloads in the same tab
  if (Store.isSignedIn()) openEditor();
})();
