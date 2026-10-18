/* Sign-in button + left-hand site editor. Talks to the page via Site.render and to storage via Store.

   The sidebar has three views:
     overview  – the list of page sections, projects and style changes
     section   – one section: its settings and its parts (opened by clicking the page)
     inspector – full CSS for one element (opened with the small "CSS" buttons)
*/
(() => {
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
  const setPath = (o, p, v) => {
    const keys = p.split(".");
    const last = keys.pop();
    keys.reduce((x, k) => (x[k] ??= {}), o)[last] = v;
  };
  const clone = (x) => structuredClone(x);

  let saved = null;   // last saved content
  let draft = null;   // content being edited
  let dirty = false;
  let openGroup = "Page sections"; // which overview group is open

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
  const overviewView = h("div", { class: "cms-body" });
  const sectionView = h("div", { class: "cms-body cms-section-view", hidden: true });
  const inspectorView = h("div", { class: "cms-body cms-inspector", hidden: true });
  const importInput = h("input", { type: "file", accept: "application/json", hidden: true, onchange: importJSON });
  const saveBtn = h("button", { class: "cms-btn primary", onclick: save }, GITHUB ? "Publish" : "Save");

  const OUTLINE_KEY = "cms-outlines";
  const outlineSwitch = h("input", { type: "checkbox", role: "switch", onchange: () => setOutlines(outlineSwitch.checked) });
  const hoverLabel = h("div", { class: "cms-outline-label", hidden: true });
  document.body.append(hoverLabel);

  const sidebar = h("aside", { class: "cms", "aria-label": "Site editor" },
    h("div", { class: "cms-head" },
      h("div", {},
        h("strong", {}, "Site editor"),
        h("span", { class: "cms-pill" }, GITHUB ? "Connected to GitHub" : "Preview mode")),
      h("button", { class: "cms-icon", title: "Hide editor (use the page normally)", "aria-label": "Hide editor", onclick: () => setCollapsed(true) }, "⟨")),
    h("label", { class: "cms-toggle", title: "Draw the edge of every box on the page (a visual guide only)." },
      h("span", {}, "Show outlines"),
      outlineSwitch,
      h("i", { "aria-hidden": "true" })),
    overviewView,
    sectionView,
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
        ? "Publish saves to GitHub. The live site updates about a minute later."
        : "Preview mode: saved in this browser only."),
      importInput));

  // Accordion: opening a collapsible closes the other open ones next to it, to save space
  sidebar.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open) return;
    for (const sib of d.parentElement?.children || []) if (sib !== d && sib.tagName === "DETAILS" && sib.open) sib.open = false;
  }, true);

  const fab = h("button", { class: "cms-fab", onclick: () => setCollapsed(false) }, "✎ Edit site");
  document.body.append(sidebar, fab);

  const editing = () => document.body.classList.contains("cms-open") && !document.body.classList.contains("cms-collapsed");
  function setCollapsed(c) {
    document.body.classList.toggle("cms-collapsed", c);
    if (c) clearHover();
  }

  function setOutlines(on) {
    outlineSwitch.checked = on;
    document.body.classList.toggle("cms-outlines", on && document.body.classList.contains("cms-open"));
    try { localStorage.setItem(OUTLINE_KEY, on ? "1" : "0"); } catch (e) {}
  }
  const outlinesOn = () => document.body.classList.contains("cms-outlines");

  async function openEditor() {
    if (!saved) {
      const current = Site.upgradeContent(await Store.loadContent());
      saved = clone(current);
      draft = clone(current);
      renderPage();
    }
    document.body.classList.add("cms-open");
    setCollapsed(false);
    let outlines = false;
    try { outlines = localStorage.getItem(OUTLINE_KEY) === "1"; } catch (e) {}
    setOutlines(outlines);
    showOverview();
    signInBtn.textContent = "Editor";
  }

  function closeEditor() {
    document.body.classList.remove("cms-open", "cms-collapsed", "cms-outlines");
    clearHover();
    current = { section: null, part: null };
    markCurrent();
    signInBtn.textContent = "Sign in";
  }

  /* ---------- Views ---------- */
  let view = "overview";
  let current = { section: null, part: null };  // ids of what the section view shows
  let inspectBack = "overview";

  function showView(v) {
    view = v;
    overviewView.hidden = v !== "overview";
    sectionView.hidden = v !== "section";
    inspectorView.hidden = v !== "inspector";
    if (v !== "inspector") { selected?.classList.remove("cms-selected"); selected = null; }
  }

  function showOverview() {
    current = { section: null, part: null };
    buildOverview();
    showView("overview");
    markCurrent();
  }

  function showSection(id, partId = null, { scrollPage = true } = {}) {
    if (!draft.sections.some((s) => s.id === id)) return showOverview();
    const changedSection = current.section !== id;
    if (changedSection || partId) settingsOpen = !partId; // clicked a part → show the part; clicked the section → its settings
    current = { section: id, part: partId };
    buildSectionView();
    showView("section");
    markCurrent();
    setCollapsed(false);
    if (changedSection) sectionView.scrollTop = 0;
    if (partId) sectionView.querySelector(`[data-card="${partId}"]`)?.scrollIntoView({ block: "nearest" });
    revealFocusItem();
    if (scrollPage && changedSection) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Highlight the open section and part on the page
  function markCurrent() {
    document.querySelectorAll(".cms-current, .cms-current-part").forEach((e) => e.classList.remove("cms-current", "cms-current-part"));
    if (!current.section) return;
    document.getElementById(current.section)?.classList.add("cms-current");
    if (current.part) document.querySelector(`[data-pid="${current.part}"]`)?.classList.add("cms-current-part");
  }

  function renderPage() {
    Site.render(draft);
    markCurrent();
    if (view === "inspector" && !selected?.isConnected) backFromInspector();
  }

  /* ---------- Clicking and hovering on the page ---------- */
  const inPage = (el) => el?.closest?.("main") && !el.closest(".cms, .cms-fab, dialog, .cms-outline-label");

  function describeHover(el) {
    const sec = el.closest("main > section");
    if (el.matches(".card")) return `Project · ${draft?.projects.find((p) => p.id === el.dataset.project)?.title || ""}`;
    if (el.matches(".service")) return `Service · ${el.querySelector("h3")?.textContent || ""}`;
    const part = el.closest(".part");
    const secLabel = sectionLabel(draft?.sections.find((s) => s.id === sec?.id));
    if (part) {
      const p = findPart(part.dataset.pid);
      return `${Site.parts[p?.part.type]?.label || "Part"} · ${secLabel}`;
    }
    return `Section · ${secLabel}`;
  }

  let hovered = null;
  function clearHover() {
    hovered?.classList.remove("cms-hover");
    hovered = null;
    hoverLabel.hidden = true;
  }
  document.addEventListener("mouseover", (e) => {
    if (!editing() || !inPage(e.target)) return clearHover();
    // Highlight what a click would open: a project, a service, a part or the section
    const el = e.target.closest(".card, .service") || e.target.closest(".part") || e.target.closest("main > section");
    if (!el || el === hovered) return;
    clearHover();
    hovered = el;
    el.classList.add("cms-hover");
    hoverLabel.textContent = describeHover(el);
    const r = el.getBoundingClientRect();
    hoverLabel.style.left = Math.max(4, r.left) + "px";
    hoverLabel.style.top = Math.max(4, r.top - 22) + "px";
    hoverLabel.hidden = false;
  });
  document.addEventListener("mouseleave", clearHover);

  // While editing, a click on the page selects instead of following links or pressing buttons
  document.addEventListener("click", (e) => {
    if (!editing() || !inPage(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const sec = e.target.closest("main > section");
    if (!sec) return;
    const card = e.target.closest(".card");
    const service = e.target.closest(".service");
    focusItem = card ? { project: card.dataset.project }
      : service ? { item: [...service.parentElement.children].indexOf(service) }
      : null;
    showSection(sec.id, e.target.closest(".part")?.dataset.pid || null, { scrollPage: false });
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !editing() || e.target.closest?.("input, textarea, select")) return;
    if (view === "inspector") backFromInspector();
    else if (view === "section") showOverview();
  });

  /* ---------- Inspector (full CSS) ---------- */
  let selected = null;
  let showAllProps = false;
  let target = null; // CSS selector that style edits apply to
  let inspGroup = "Box model"; // which inspector group is expanded

  function inspect(el, back = view === "inspector" ? inspectBack : view) {
    selected?.classList.remove("cms-selected");
    selected = el;
    el.classList.add("cms-selected");
    inspectBack = back;
    if (back === "section") {
      const sec = el.closest("main > section");
      if (sec) current = { section: sec.id, part: el.closest(".part")?.dataset.pid || current.part };
    }
    target = Inspector.targets(el)[0]?.sel || null;
    renderInspector();
    showView("inspector");
    inspectorView.scrollTop = 0;
    setCollapsed(false);
    markCurrent();
  }

  function backFromInspector() {
    if (inspectBack === "section" && current.section) showSection(current.section, current.part, { scrollPage: false });
    else showOverview();
  }

  function renderInspector() {
    if (!selected?.isConnected) return backFromInspector();
    const top = inspectorView.scrollTop;
    draft.styles ??= {};
    inspectorView.replaceChildren(Inspector.render(selected, {
      onSelect: (el) => inspect(el, inspectBack),
      onBack: backFromInspector,
      showAll: showAllProps,
      onToggleAll: (on) => { showAllProps = on; renderInspector(); },
      openGroup: inspGroup,
      onGroup: (title, open) => { if (open) inspGroup = title; else if (inspGroup === title) inspGroup = null; },
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

  // Style edits only restyle the page; they don't rebuild it, so selections survive
  function stylesChanged(rerender) {
    setDirty(true);
    Site.applyStyles(draft);
    if (rerender && view === "inspector") renderInspector();
  }

  /* ---------- Change tracking ---------- */
  let timer = 0;
  function changed() {
    setDirty(true);
    clearTimeout(timer);
    timer = setTimeout(renderPage, 40);
  }
  function setDirty(d, msg) {
    dirty = d;
    status.textContent = msg || (d ? "Unsaved changes" : "All changes saved");
    status.classList.toggle("dirty", d);
  }
  function rebuildView() {
    if (view === "section") showSection(current.section, current.part, { scrollPage: false });
    else if (view === "inspector") renderInspector();
    else buildOverview();
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
    renderPage();
    setDirty(false);
    rebuildView();
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
      changed();
      showOverview();
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

  // A list of small items (services, social links). Each item collapses to its title.
  const openListItem = {}; // list path → index of the expanded item
  function listEditor(path, fields, addLabel, blank) {
    const wrap = h("div", { class: "cms-list" });
    const titleOf = (it) => plain(it?.[fields[0][0]]) || "New item";
    function rebuild() {
      const items = getPath(draft, path) || [];
      wrap.replaceChildren(...items.map((it, i) => {
        const title = h("span", { class: "cms-li-title" }, titleOf(it));
        const item = h("details", { class: "cms-item cms-list-item", "data-item": i, open: openListItem[path] === i },
          h("summary", {}, title,
            h("button", { type: "button", class: "cms-icon danger", title: "Remove", "aria-label": "Remove", onclick: (e) => {
              e.preventDefault();
              getPath(draft, path).splice(i, 1);
              if (openListItem[path] === i) delete openListItem[path];
              rebuild(); changed();
            } }, "✕")),
          h("div", { class: "cms-section-body" }, fields.map(([key, label, opts]) => field(`${path}.${i}.${key}`, label, opts))));
        item.addEventListener("input", () => (title.textContent = titleOf(getPath(draft, path)[i])));
        item.addEventListener("toggle", () => { if (item.open) openListItem[path] = i; else if (openListItem[path] === i) delete openListItem[path]; });
        return item;
      }));
    }
    rebuild();
    return [wrap, h("button", { type: "button", class: "cms-btn small", onclick: () => {
      if (!getPath(draft, path)) setPath(draft, path, []);
      getPath(draft, path).push(structuredClone(blank));
      openListItem[path] = getPath(draft, path).length - 1;
      rebuild(); changed();
    } }, addLabel)];
  }

  /* ---------- Simple style controls (colour, size, padding, background) ---------- */
  const toHex = (c) => {
    const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    return m ? "#" + [m[1], m[2], m[3]].map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("") : "#000000";
  };

  // Each setting lives at e.g. sections.2.parts.1.css.color; empty = use the design's default
  function setQuick(path, value) {
    if (value === "" || value == null) {
      const keys = path.split(".");
      const prop = keys.pop();
      const obj = getPath(draft, keys.join("."));
      if (obj) { delete obj[prop]; if (!Object.keys(obj).length) setPath(draft, keys.join("."), undefined); }
    } else setPath(draft, path, value);
    setDirty(true);
    Site.applyStyles(draft);
  }

  function colorControl(path, label, sample) {
    const now = getPath(draft, path);
    const picker = h("input", { type: "color", class: "insp-color", value: now || toHex(sample()),
      oninput: () => { setQuick(path, picker.value); reset.hidden = false; wrap.classList.add("set"); } });
    const reset = h("button", { type: "button", class: "insp-reset", title: "Back to default", hidden: !now, onclick: () => {
      setQuick(path, ""); reset.hidden = true; wrap.classList.remove("set"); picker.value = toHex(sample());
    } }, "↺");
    const wrap = h("label", { class: "cms-quick" + (now ? " set" : "") }, h("span", {}, label), h("span", { class: "cms-quick-row" }, picker, reset));
    return wrap;
  }

  function numberControl(path, label, sample, unit = "px") {
    const now = getPath(draft, path);
    const input = h("input", { type: "number", min: 0, step: 1, value: now ?? "", placeholder: sample(),
      oninput: () => { setQuick(path, input.value); reset.hidden = input.value === ""; wrap.classList.toggle("set", input.value !== ""); } });
    const reset = h("button", { type: "button", class: "insp-reset", title: "Back to default", hidden: now == null || now === "", onclick: () => {
      input.value = ""; setQuick(path, ""); reset.hidden = true; wrap.classList.remove("set");
    } }, "↺");
    const wrap = h("label", { class: "cms-quick" + (now != null && now !== "" ? " set" : "") },
      h("span", {}, label), h("span", { class: "cms-quick-row" }, input, h("small", {}, unit), reset));
    return wrap;
  }

  const pageEl = (sel) => document.querySelector(sel);
  const cssOf = (sel, prop) => { const el = pageEl(sel); return el ? getComputedStyle(el)[prop] : ""; };
  const round = (v) => String(Math.round(parseFloat(v) || 0));

  const NO_TEXT = new Set(["image", "spacer", "projects", "services"]);
  function partQuickStyle(si, j, p) {
    const base = `sections.${si}.parts.${j}.css.`;
    const main = `[data-pid="${p.id}"] > *`;
    return h("div", { class: "cms-quick-grid" },
      NO_TEXT.has(p.type) ? null : colorControl(base + "color", "Colour", () => cssOf(main, "color")),
      NO_TEXT.has(p.type) ? null : numberControl(base + "size", "Size", () => round(cssOf(p.type === "quote" ? `[data-pid="${p.id}"] .quote-text` : main, "fontSize"))),
      numberControl(base + "padding", "Padding", () => round(cssOf(`[data-pid="${p.id}"]`, "paddingTop"))));
  }
  function sectionQuickStyle(si, s) {
    const base = `sections.${si}.css.`;
    return h("div", { class: "cms-quick-grid" },
      colorControl(base + "background", "Background", () => {
        // A see-through section shows the page colour behind it
        const c = cssOf(`#${s.id}`, "backgroundColor");
        return /^rgba\(.*,\s*0\)$|^transparent$/.test(c) ? getComputedStyle(document.body).backgroundColor : c;
      }),
      numberControl(base + "padY", "Padding top & bottom", () => round(cssOf(`#${s.id}`, "paddingTop"))));
  }

  /* ---------- Content fields for each kind of part ---------- */
  const RICH_HINT = "Wrap words in *asterisks* for italic. New line = line break.";
  const PART_FIELDS = {
    eyebrow: (p) => [field(p + "text", "Text")],
    heading: (p) => [
      field(p + "text", "Heading", { type: "textarea", rows: 2, hint: RICH_HINT }),
      field(p + "size", "Heading size", { type: "select", options: [["xl", "Extra large"], ["l", "Large"], ["m", "Medium"]] }),
      h("details", { class: "cms-more-opts" }, h("summary", {}, "Rotating words"),
        h("div", { class: "cms-grid2" },
          field(p + "rotatorPrefix", "Line starts with"),
          field(p + "rotator", "Words", { hint: "Comma-separated. Empty = off." }))),
    ],
    text: (p) => [
      field(p + "text", "Text", { type: "textarea", rows: 5, hint: "Blank line = new paragraph. *asterisks* = italic." }),
      field(p + "style", "Text style", { type: "select", options: [["normal", "Normal"], ["large", "Large (lead)"], ["small", "Small"]] }),
    ],
    button: (p) => [
      h("div", { class: "cms-grid2" }, field(p + "text", "Button text"), field(p + "link", "Link", { hint: "#section-id or a URL" })),
      field(p + "style", "Button style", { type: "select", options: [["solid", "Solid"], ["outline", "Outline"]] }),
    ],
    image: (p) => [
      imageField(p + "image", "Image"),
      field(p + "caption", "Caption"),
      field(p + "size", "Image size", { type: "select", options: [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["page", "Page width"], ["full", "Edge to edge"]] }),
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
      h("span", { class: "cms-label" }, "Projects"),
      projectsEditor(),
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
    if (!s) return "";
    if (s.layout === "banner") return plain(s.items);
    const first = (s.parts || []).find((p) => p.type === "heading") || (s.parts || [])[0];
    return first ? partPreview(first) : "Empty";
  };
  const sectionKind = (s) => Site.presets[s?.kind]?.label || (s?.layout === "banner" ? "Scrolling banner" : "Section");
  const sectionLabel = (s) => (s ? `${sectionKind(s)}${sectionTitle(s) ? ` “${sectionTitle(s)}”` : ""}` : "");
  function findPart(pid) {
    for (const [si, s] of draft.sections.entries()) {
      const j = (s.parts || []).findIndex((p) => p.id === pid);
      if (j >= 0) return { si, j, section: s, part: s.parts[j] };
    }
    return null;
  }

  /* ---------- Overview: all sections, projects, style changes ---------- */
  function overviewSection(title, ...kids) {
    const d = h("details", { class: "cms-section", open: openGroup === title },
      h("summary", {}, title), h("div", { class: "cms-section-body" }, kids));
    d.addEventListener("toggle", () => { if (d.open) openGroup = title; else if (openGroup === title) openGroup = null; });
    return d;
  }

  function buildOverview() {
    if (!draft) return;
    const scroll = overviewView.scrollTop;
    overviewView.replaceChildren(
      h("p", { class: "cms-tip" }, "Tip: click anything on the page to edit that section."),
      overviewSection("Page sections", sectionsList()),
      overviewSection("Projects", projectsEditor()),
      overviewSection("Style changes", styleChangesList()));
    overviewView.scrollTop = scroll;
  }

  function sectionsList() {
    const presetSelect = h("select", {}, Object.entries(Site.presets).map(([k, t]) => h("option", { value: k }, t.label)));
    const n = draft.sections.length;
    const move = (i, d) => {
      const list = draft.sections;
      [list[i], list[i + d]] = [list[i + d], list[i]];
      changed(); buildOverview();
      setTimeout(() => document.getElementById(list[i + d].id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };
    return [
      h("div", { class: "cms-list" }, draft.sections.map((s, i) =>
        h("div", { class: "cms-sec-row" },
          h("button", { type: "button", class: "cms-sec-open", onclick: () => showSection(s.id) },
            h("span", { class: "cms-sec-num" }, String(i + 1)),
            h("span", { class: "cms-sec-name" }, h("b", {}, sectionKind(s)), h("span", {}, sectionTitle(s))),
            s.menu ? h("span", { class: "cms-sec-menu", title: "In the top menu" }, s.menu) : null,
            h("span", { class: "cms-chev", "aria-hidden": "true" }, "›")),
          h("span", { class: "cms-sec-moves" },
            h("button", { type: "button", class: "cms-icon", title: "Move section up", "aria-label": "Move section up", disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
            h("button", { type: "button", class: "cms-icon", title: "Move section down", "aria-label": "Move section down", disabled: i === n - 1, onclick: () => move(i, 1) }, "↓"))))),
      h("div", { class: "cms-add-section" },
        h("label", { class: "cms-field" }, h("span", {}, "Add a section"), presetSelect),
        h("button", { type: "button", class: "cms-btn primary", onclick: () => {
          const s = Site.makeSection(presetSelect.value);
          draft.sections.push(s);
          changed();
          setTimeout(() => showSection(s.id), 60);
        } }, "+ Add")),
    ];
  }

  const CATEGORIES = [["design", "Design"], ["photo", "Photo & Film"], ["dev", "Development"], ["studio", "Studio"]];
  const SIZES = [["", "Normal"], ["wide", "Wide"], ["tall", "Tall"]];

  let openProject = null; // id of the expanded project

  function projectsEditor() {
    const wrap = h("div", { class: "cms-list" });
    // A project clicked on the page opens in the list
    if (focusItem?.project) openProject = focusItem.project;
    const move = (i, d) => {
      const p = draft.projects;
      [p[i], p[i + d]] = [p[i + d], p[i]];
      rebuild(); changed();
    };
    function rebuild() {
      wrap.replaceChildren(...draft.projects.map((p, i) => {
        const summary = h("summary", {}, h("b", {}, p.title || "Untitled"), h("span", {}, CATEGORIES.find((c) => c[0] === p.category)?.[1]));
        const refreshSummary = () => { summary.firstChild.textContent = draft.projects[i].title || "Untitled"; summary.lastChild.textContent = CATEGORIES.find((c) => c[0] === draft.projects[i].category)?.[1]; };
        const item = h("details", { class: "cms-item", open: p.id === openProject, "data-project": p.id },
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
        item.addEventListener("toggle", () => { if (item.open) openProject = p.id; else if (openProject === p.id) openProject = null; });
        return item;
      }));
    }
    rebuild();
    const add = h("button", { type: "button", class: "cms-btn primary block", onclick: () => {
      const p = { id: "p" + Date.now(), title: "New project", category: "design", year: new Date().getFullYear(), summary: "", description: "", size: "", image: "" };
      openProject = p.id;
      draft.projects.unshift(p);
      rebuild(); changed();
    } }, "+ Add project");
    return [add, wrap];
  }

  // Every CSS edit made in the inspector, with undo
  function styleChangesList() {
    const entries = Object.entries(draft.styles || {}).filter(([, p]) => Object.keys(p).length);
    if (!entries.length) {
      return h("p", { class: "cms-note" }, "No CSS edits yet. Open a section and use its CSS button to change anything in detail.");
    }
    const undo = (sel, prop) => {
      if (prop) delete draft.styles[sel][prop];
      if (!prop || !Object.keys(draft.styles[sel]).length) delete draft.styles[sel];
      setDirty(true);
      Site.applyStyles(draft);
      buildOverview();
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
        if (!confirm("Undo every CSS edit?")) return;
        draft.styles = {};
        setDirty(true);
        Site.applyStyles(draft);
        buildOverview();
      } }, "Undo all CSS edits"),
    ];
  }

  /* ---------- Section view: one section and its parts ---------- */
  let openPart = null;        // id of the expanded part
  let settingsOpen = true;    // is "Section settings" expanded

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

  let dragging = null; // index of the part being dragged
  let focusItem = null; // a project or list item clicked on the page

  function revealFocusItem() {
    if (!focusItem) return;
    const card = sectionView.querySelector(`[data-card="${current.part}"]`);
    const target = focusItem.project != null
      ? sectionView.querySelector(`[data-project="${focusItem.project}"]`)
      : card?.querySelector(`.cms-list-item[data-item="${focusItem.item}"]`);
    focusItem = null;
    if (!target) return;
    sectionView.querySelectorAll(".cms-focus").forEach((x) => x.classList.remove("cms-focus"));
    target.classList.add("cms-focus");
    if (target.tagName === "DETAILS") {
      // Close the previously open item first, so it can't close this one
      for (const sib of target.parentElement.children) if (sib !== target && sib.tagName === "DETAILS") sib.open = false;
      target.open = true;
    }
    target.scrollIntoView({ block: "center" });
    target.querySelector('input:not([type="file"]):not([type="color"]), textarea')?.focus({ preventScroll: true });
  }

  function buildSectionView() {
    const si = draft.sections.findIndex((s) => s.id === current.section);
    const s = draft.sections[si];
    if (current.part) openPart = current.part;
    if (openPart && settingsOpen && current.part) settingsOpen = false;
    const scroll = sectionView.scrollTop;
    const p = `sections.${si}.`;
    const isBanner = s.layout === "banner";

    const header = h("div", { class: "cms-sv-head" },
      h("button", { type: "button", class: "cms-btn small", onclick: showOverview }, "← All sections"),
      h("button", { type: "button", class: "cms-css-btn", title: "Edit this section's CSS",
        onclick: () => { const el = document.getElementById(s.id); if (el) inspect(el, "section"); } }, "CSS"));

    const title = h("div", { class: "cms-sv-title" },
      h("span", { class: "cms-sec-num" }, String(si + 1)),
      h("div", {}, h("b", {}, sectionKind(s)), h("span", {}, sectionTitle(s))));

    const settingsFields = isBanner
      ? [field(p + "items", "Banner words", { type: "textarea", rows: 2, hint: "Comma-separated." })]
      : [
        alignControl(s),
        h("div", { class: "cms-grid2" },
          field(p + "look", "Look", { type: "select", options: [["plain", "Plain"], ["hero", "Hero (extra space)"], ["dark", "Dark"], ["card", "Card"]] }),
          field(p + "layout", "Layout", { type: "select", options: [["stack", "One column"], ["split", "Image beside"]],
            onInput: () => { s.side ??= "right"; s.ratio ??= "half"; s.valign ??= "middle"; s.shape ??= "landscape"; s.media ??= ""; setTimeout(() => showSection(s.id, null, { scrollPage: false }), 50); } })),
        sectionQuickStyle(si, s),
        s.layout === "split" ? h("details", { class: "cms-more-opts", open: !s.media },
          h("summary", {}, "Side image"),
          h("div", { class: "cms-section-body" },
            imageField(p + "media", "Image"),
            h("div", { class: "cms-grid2" },
              field(p + "side", "Image side", { type: "select", options: [["right", "Right"], ["left", "Left"]] }),
              field(p + "shape", "Image shape", { type: "select", options: [["landscape", "Landscape"], ["portrait", "Portrait"], ["square", "Square"], ["wide", "Wide"]] })),
            h("div", { class: "cms-grid2" },
              field(p + "ratio", "Image size", { type: "select", options: [["third", "1/3"], ["two-fifths", "2/5"], ["half", "1/2"], ["three-fifths", "3/5"], ["two-thirds", "2/3"]] }),
              field(p + "valign", "Line up", { type: "select", options: [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]] })))) : null,
      ];
    const settings = h("details", { class: "cms-more-opts cms-settings", open: settingsOpen || isBanner },
      h("summary", {}, isBanner ? "Banner" : "Section settings"),
      h("div", { class: "cms-section-body" }, settingsFields));
    settings.addEventListener("toggle", () => {
      settingsOpen = settings.open;
      if (settings.open) collapseParts();
    });

    sectionView.replaceChildren(
      header,
      title,
      h("div", { class: "cms-section-body cms-sv-body" },
        settings,
        isBanner ? null : partsList(s, si),
        h("details", { class: "cms-more-opts cms-menu-opts", ontoggle: (e) => { if (e.target.open) { collapseParts(); closeSettings(); } } }, h("summary", {}, "Menu & link"),
          h("div", { class: "cms-section-body" },
            field(p + "menu", "Top menu label", { hint: "Leave empty to keep this section out of the menu." }),
            h("small", { class: "cms-note" }, "Link to this section with ", h("code", {}, "#" + s.id)))),
        h("div", { class: "cms-row" },
          h("button", { type: "button", class: "cms-btn small", onclick: () => duplicateSection(si) }, "Duplicate section"),
          h("button", { type: "button", class: "cms-btn small danger", onclick: () => removeSection(si) }, "Delete section"))));
    sectionView.scrollTop = scroll;
  }

  // Settings, parts and "Menu & link" behave as one accordion
  function collapseParts(except = null) {
    sectionView.querySelectorAll(".cms-part.open").forEach((c) => {
      if (c.dataset.card === except) return;
      c.classList.remove("open");
      c.querySelector(".cms-part-body").hidden = true;
      c.querySelector(".cms-part-title").setAttribute("aria-expanded", "false");
    });
    if (openPart !== except) openPart = except;
  }
  function closeSettings() {
    sectionView.querySelectorAll(".cms-settings[open], .cms-menu-opts[open]").forEach((d) => (d.open = false));
    settingsOpen = false;
  }

  function duplicateSection(i) {
    const copy = structuredClone(draft.sections[i]);
    copy.id = Site.newSectionId(copy.kind || "section");
    copy.menu = "";
    for (const part of copy.parts || []) part.id = Site.newPartId();
    draft.sections.splice(i + 1, 0, copy);
    changed();
    setTimeout(() => showSection(copy.id), 60);
  }
  function removeSection(i) {
    const s = draft.sections[i];
    if (!confirm(`Delete this ${sectionKind(s)} section?\n\nYou can still press Discard before publishing.`)) return;
    draft.sections.splice(i, 1);
    for (const sel of Object.keys(draft.styles || {})) {
      if (sel === `#${s.id}` || sel.startsWith(`#${s.id} `) || (s.parts || []).some((p) => sel.startsWith(`[data-pid="${p.id}"]`))) delete draft.styles[sel];
    }
    changed();
    showOverview();
  }

  function partsList(s, si) {
    const box = h("div", { class: "cms-parts" });
    const typeSelect = h("select", {}, Object.entries(Site.parts).map(([k, t]) => h("option", { value: k }, t.label)));
    const refresh = () => { changed(); buildSectionView(); };

    function movePart(from, to) {
      const [moved] = s.parts.splice(from, 1);
      s.parts.splice(to > from ? to - 1 : to, 0, moved);
      refresh();
    }
    function moveToSection(j, targetId) {
      const dest = draft.sections.find((x) => x.id === targetId);
      if (!dest) return;
      const [moved] = s.parts.splice(j, 1);
      (dest.parts ??= []).push(moved);
      changed();
      setTimeout(() => showSection(dest.id, moved.id), 60);
    }

    s.parts.forEach((part, j) => {
      const path = `sections.${si}.parts.${j}.`;
      const isOpen = openPart === part.id;
      const label = h("span", { class: "cms-part-preview" }, partPreview(part));
      const handle = h("span", { class: "cms-handle", title: "Drag to move", "aria-hidden": "true" }, "⠿");
      const others = draft.sections.filter((x) => x.id !== s.id && x.layout !== "banner");
      const body = h("div", { class: "cms-part-body", hidden: !isOpen },
        PART_FIELDS[part.type]?.(path) || [],
        h("div", { class: "cms-style-block" }, h("span", { class: "cms-label" }, "Style"), partQuickStyle(si, j, part)),
        others.length ? h("label", { class: "cms-field cms-move-to" }, h("span", {}, "Move to another section"),
          h("select", { onchange: (e) => e.target.value && moveToSection(j, e.target.value) },
            h("option", { value: "" }, "Choose…"),
            others.map((x) => h("option", { value: x.id }, sectionLabel(x))))) : null);
      const card = h("div", { class: "cms-part" + (isOpen ? " open" : "") + (current.part === part.id ? " current" : ""), "data-card": part.id },
        h("div", { class: "cms-part-head" },
          handle,
          h("button", { type: "button", class: "cms-part-title", "aria-expanded": String(isOpen), onclick: (e) => {
            const open = body.hidden;
            if (open) { collapseParts(part.id); closeSettings(); }
            body.hidden = !open;
            card.classList.toggle("open", open);
            e.currentTarget.setAttribute("aria-expanded", String(open));
            openPart = open ? part.id : null;
            current.part = open ? part.id : current.part === part.id ? null : current.part;
            markCurrent();
            if (open) document.querySelector(`[data-pid="${part.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          } }, h("b", {}, Site.parts[part.type]?.label || part.type), label),
          h("button", { type: "button", class: "cms-css-btn", title: "Edit this part's CSS", onclick: () => {
            const el = document.querySelector(`[data-pid="${part.id}"]`);
            if (el) { current.part = part.id; inspect(el.firstElementChild || el, "section"); }
          } }, "CSS"),
          h("button", { type: "button", class: "cms-icon", title: "Move up", "aria-label": "Move part up", disabled: j === 0, onclick: () => movePart(j, j - 1) }, "↑"),
          h("button", { type: "button", class: "cms-icon", title: "Move down", "aria-label": "Move part down", disabled: j === s.parts.length - 1, onclick: () => movePart(j, j + 2) }, "↓"),
          h("button", { type: "button", class: "cms-icon danger", title: "Delete part", "aria-label": "Delete part", onclick: () => {
            if (!confirm(`Delete this ${Site.parts[part.type]?.label || "part"}?`)) return;
            s.parts.splice(j, 1);
            for (const sel of Object.keys(draft.styles || {})) if (sel.startsWith(`[data-pid="${part.id}"]`)) delete draft.styles[sel];
            if (current.part === part.id) current.part = null;
            refresh();
          } }, "✕")),
        body);
      card.addEventListener("input", () => (label.textContent = partPreview(part)));

      // Drag by the handle only, so text in the fields can still be selected
      handle.addEventListener("pointerdown", () => (card.draggable = true));
      card.addEventListener("dragstart", (e) => {
        dragging = j;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "part");
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.draggable = false;
        dragging = null;
        card.classList.remove("dragging");
        box.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      });
      card.dataset.index = j;
      box.append(card);
    });

    const dropIndex = (e) => {
      const cards = [...box.querySelectorAll(":scope > .cms-part")];
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) return { index: +c.dataset.index, card: c, where: "before" };
      }
      return { index: cards.length, card: cards.at(-1), where: "after" };
    };
    box.addEventListener("dragover", (e) => {
      if (dragging == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      box.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const t = dropIndex(e);
      t.card?.classList.add(t.where === "before" ? "drop-before" : "drop-after");
    });
    box.addEventListener("drop", (e) => {
      if (dragging == null) return;
      e.preventDefault();
      movePart(dragging, dropIndex(e).index);
    });

    if (!s.parts.length) box.append(h("p", { class: "cms-note cms-parts-empty" }, "This section is empty. Add a part below."));

    return [
      h("span", { class: "cms-label cms-parts-label" }, "In this section — drag ⠿ to reorder"),
      box,
      h("div", { class: "cms-add-part" }, typeSelect,
        h("button", { type: "button", class: "cms-btn small primary", onclick: () => {
          const part = Site.makePart(typeSelect.value);
          s.parts.push(part);
          openPart = part.id;
          settingsOpen = false;
          current.part = part.id;
          refresh();
        } }, "+ Add part")),
    ];
  }

  // Stay in the editor across reloads in the same tab
  if (Store.isSignedIn()) openEditor();
})();
