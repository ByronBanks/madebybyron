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
    markDraggable();
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
    markDraggable();
    clearHover();
    current = { section: null, part: null };
    markCurrent();
    signInBtn.textContent = "Sign in";
  }

  /* ---------- Undo bar: deletes happen straight away, with a few seconds to undo ---------- */
  const toast = h("div", { class: "cms-toast", role: "status", hidden: true });
  document.body.append(toast);
  let undoSnapshot = null;
  let toastTimer = 0;
  function deleted(label, snapshot) {
    undoSnapshot = snapshot;
    toast.replaceChildren(h("span", {}, `Deleted ${label}`), h("button", { type: "button", onclick: undoDelete }, "Undo"));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; undoSnapshot = null; }, 7000);
  }
  function undoDelete() {
    if (!undoSnapshot) return;
    draft = undoSnapshot;
    undoSnapshot = null;
    toast.hidden = true;
    setDirty(true);
    renderPage();
    rebuildView();
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
    if (partId) openOnly(partId);
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
    markDraggable();
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

  /* ---------- Drag project cards and services around on the page ---------- */
  let pageDrag = null; // { kind: "project" | "item", id, list, el }

  // Which list a dragged page item belongs to, and how to find its entry in the draft
  function pageListOf(el) {
    if (el.matches(".card")) return { kind: "project", id: el.dataset.project, list: draft.projects };
    if (el.matches(".service")) {
      const found = findPart(el.closest("[data-pid]")?.dataset.pid);
      return found ? { kind: "item", id: el.dataset.iid, list: found.part.items } : null;
    }
    return null;
  }
  function markDraggable() {
    const on = editing();
    document.querySelectorAll("main .card, main .service").forEach((el) => (el.draggable = on));
  }
  const clearDrop = () => document.querySelectorAll(".page-drop-before, .page-drop-after").forEach((x) => x.classList.remove("page-drop-before", "page-drop-after"));
  // Cards sit in rows, so compare left/right; fall back to above/below for stacked layouts
  function dropSide(target, e) {
    const r = target.getBoundingClientRect();
    const sameRow = Math.abs(e.clientY - (r.top + r.height / 2)) < r.height / 2;
    return sameRow ? (e.clientX < r.left + r.width / 2 ? "before" : "after") : (e.clientY < r.top + r.height / 2 ? "before" : "after");
  }

  document.addEventListener("dragstart", (e) => {
    if (!editing()) return;
    const el = e.target.closest?.("main .card, main .service");
    if (!el) return;
    const info = pageListOf(el);
    if (!info) return;
    pageDrag = { ...info, el };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", info.id);
    el.classList.add("page-dragging");
    clearHover();
  });
  document.addEventListener("dragover", (e) => {
    if (!pageDrag) return;
    const target = e.target.closest?.(pageDrag.kind === "project" ? "main .card" : "main .service");
    if (!target || target === pageDrag.el || pageListOf(target)?.list !== pageDrag.list) return;
    e.preventDefault();
    clearDrop();
    target.classList.add(dropSide(target, e) === "before" ? "page-drop-before" : "page-drop-after");
  });
  document.addEventListener("drop", (e) => {
    if (!pageDrag) return;
    const target = e.target.closest?.(pageDrag.kind === "project" ? "main .card" : "main .service");
    if (!target || target === pageDrag.el) return;
    e.preventDefault();
    const list = pageDrag.list;
    const key = pageDrag.kind === "project" ? "project" : "iid";
    const from = list.findIndex((x) => x.id === pageDrag.id);
    if (from < 0) return;
    const [moved] = list.splice(from, 1);
    let to = list.findIndex((x) => x.id === target.dataset[key]);
    if (to < 0) { list.splice(from, 0, moved); return; }
    if (dropSide(target, e) === "after") to++;
    list.splice(to, 0, moved);
    changed();
    // Show the section it lives in, with the moved item's part open
    const attr = key === "project" ? "data-project" : "data-iid";
    setTimeout(() => {
      const el = document.querySelector(`[${attr}="${moved.id}"]`);
      const sec = el?.closest("main > section");
      if (sec) showSection(sec.id, el.closest(".part")?.dataset.pid || null, { scrollPage: false });
    }, 80);
  });
  document.addEventListener("dragend", () => {
    pageDrag?.el.classList.remove("page-dragging");
    pageDrag = null;
    clearDrop();
  });

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
    selectedItem = card ? { project: card.dataset.project }
      : service ? { pid: service.closest("[data-pid]")?.dataset.pid, iid: service.dataset.iid }
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

  // A list of small items (services, social links). Each item collapses to its title,
  // can be dragged (⠿) or moved with ↑↓, and can have its own style.
  const openListItem = {}; // list path → index of the expanded item
  function listEditor(path, fields, addLabel, blank, styleFor = null) {
    const wrap = h("div", { class: "cms-list" });
    const titleOf = (it) => plain(it?.[fields[0][0]]) || "New item";
    let dragFrom = null;

    function move(from, to) {
      const items = getPath(draft, path);
      if (to < 0 || to >= items.length) return;
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      if (openListItem[path] === from) openListItem[path] = to;
      rebuild(); changed();
    }

    function rebuild() {
      const items = getPath(draft, path) || [];
      wrap.replaceChildren(...items.map((it, i) => {
        const title = h("span", { class: "cms-li-title" }, titleOf(it));
        const handle = h("span", { class: "cms-handle", title: "Drag to move", "aria-hidden": "true" }, "⠿");
        const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
        const item = h("details", { class: "cms-item cms-list-item", "data-item": i, open: openListItem[path] === i },
          h("summary", {}, handle, title,
            h("button", { type: "button", class: "cms-icon", title: "Move up", "aria-label": "Move up", disabled: i === 0, onclick: stop(() => move(i, i - 1)) }, "↑"),
            h("button", { type: "button", class: "cms-icon", title: "Move down", "aria-label": "Move down", disabled: i === items.length - 1, onclick: stop(() => move(i, i + 1)) }, "↓"),
            h("button", { type: "button", class: "cms-icon danger", title: "Remove", "aria-label": "Remove", onclick: stop(() => {
              const snap = clone(draft);
              setTimeout(() => deleted(`“${titleOf(it)}”`, snap));
              getPath(draft, path).splice(i, 1);
              if (openListItem[path] === i) delete openListItem[path];
              rebuild(); changed();
            }) }, "✕")),
          h("div", { class: "cms-section-body" },
            fields.map(([key, label, opts]) => field(`${path}.${i}.${key}`, label, opts)),
            styleFor ? styleEditor(`${path}.${i}.css`, styleFor(it)) : null));
        item.addEventListener("input", () => (title.textContent = titleOf(getPath(draft, path)[i])));
        item.addEventListener("toggle", () => { if (item.open) openListItem[path] = i; else if (openListItem[path] === i) delete openListItem[path]; });

        // Drag by the handle to reorder
        handle.addEventListener("pointerdown", () => (item.draggable = true));
        item.addEventListener("dragstart", (e) => { e.stopPropagation(); dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "item"); item.classList.add("dragging"); });
        item.addEventListener("dragend", () => {
          item.draggable = false; dragFrom = null; item.classList.remove("dragging");
          wrap.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
        });
        return item;
      }));
    }
    const dropIndex = (e) => {
      const rows = [...wrap.children];
      for (const [k, r] of rows.entries()) {
        const b = r.getBoundingClientRect();
        if (e.clientY < b.top + b.height / 2) return { index: k, row: r, where: "before" };
      }
      return { index: rows.length, row: rows.at(-1), where: "after" };
    };
    wrap.addEventListener("dragover", (e) => {
      if (dragFrom == null) return;
      e.preventDefault(); e.stopPropagation();
      wrap.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const t = dropIndex(e);
      t.row?.classList.add(t.where === "before" ? "drop-before" : "drop-after");
    });
    wrap.addEventListener("drop", (e) => {
      if (dragFrom == null) return;
      e.preventDefault(); e.stopPropagation();
      const to = dropIndex(e).index;
      move(dragFrom, to > dragFrom ? to - 1 : to);
    });

    rebuild();
    return [wrap, h("button", { type: "button", class: "cms-btn small", onclick: () => {
      if (!getPath(draft, path)) setPath(draft, path, []);
      getPath(draft, path).push({ id: Site.newItemId(), ...structuredClone(blank) });
      openListItem[path] = getPath(draft, path).length - 1;
      rebuild(); changed();
    } }, addLabel)];
  }

  /* ---------- Style controls: spacing, text, fill and border ---------- */
  const toHex = (c) => {
    const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    return m ? "#" + [m[1], m[2], m[3]].map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("") : "#000000";
  };
  const pageEl = (sel) => { try { return document.querySelector(sel); } catch (e) { return null; } };
  const cssOf = (sel, prop) => { const el = pageEl(sel); return el ? getComputedStyle(el)[prop] : ""; };
  const round = (v) => String(Math.round(parseFloat(v) || 0));
  const clear = (c) => /^rgba\(.*,\s*0\)$|^transparent$/.test(c);
  // The colour you actually see behind an element (see-through boxes show what's behind them)
  function bgSample(sel) {
    for (let el = pageEl(sel); el; el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (!clear(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  }

  // Each setting lives at e.g. sections.2.parts.1.css.padT; empty = use the design's default
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
  const isSet = (path) => { const v = getPath(draft, path); return v !== undefined && v !== null && v !== ""; };

  function control(label, path, input, reset) {
    const wrap = h("label", { class: "cms-quick" + (isSet(path) ? " set" : "") }, h("span", {}, label), h("span", { class: "cms-quick-row" }, input, reset));
    return wrap;
  }
  function resetBtn(path, onReset) {
    const b = h("button", { type: "button", class: "insp-reset", title: "Back to default", hidden: !isSet(path), onclick: (e) => {
      e.preventDefault(); setQuick(path, ""); b.hidden = true; b.closest(".cms-quick")?.classList.remove("set"); onReset();
    } }, "↺");
    return b;
  }
  const markSet = (el, on) => { el.closest(".cms-quick")?.classList.toggle("set", on); el.closest(".cms-quick")?.querySelector(".insp-reset")?.toggleAttribute("hidden", !on); };

  function colorControl(path, label, sample) {
    const picker = h("input", { type: "color", class: "insp-color", value: getPath(draft, path) || toHex(sample()),
      oninput: () => { setQuick(path, picker.value); markSet(picker, true); } });
    return control(label, path, picker, resetBtn(path, () => (picker.value = toHex(sample()))));
  }
  function numberControl(path, label, sample, { unit = "px", min = 0 } = {}) {
    const input = h("input", { type: "number", min, step: 1, value: getPath(draft, path) ?? "", placeholder: sample(),
      oninput: () => { setQuick(path, input.value); markSet(input, input.value !== ""); } });
    return control(label, path, [input, h("small", {}, unit)], resetBtn(path, () => (input.value = "")));
  }
  function fontControl(path) {
    const names = { sans: "Inter Tight", serif: "Instrument Serif", system: "System", georgia: "Georgia", mono: "Monospace" };
    const sel = h("select", { onchange: () => { setQuick(path, sel.value); markSet(sel, sel.value !== ""); } },
      h("option", { value: "" }, "Default"),
      Object.keys(Site.fonts).map((k) => h("option", { value: k, selected: getPath(draft, path) === k }, names[k] || k)));
    return control("Font", path, sel, resetBtn(path, () => (sel.value = "")));
  }
  function opacityControl(path, sample) {
    const now = getPath(draft, path);
    const shown = h("small", {}, `${now ?? sample()}%`);
    const range = h("input", { type: "range", min: 0, max: 100, step: 1, value: now ?? sample(),
      oninput: () => { setQuick(path, range.value); shown.textContent = `${range.value}%`; markSet(range, true); } });
    return control("Opacity", path, [range, shown], resetBtn(path, () => { range.value = sample(); shown.textContent = `${sample()}%`; }));
  }

  // Margin (outside) and padding (inside) for all four sides, drawn as a box
  function spacingControl(base, boxSel) {
    const cs = () => { const el = pageEl(boxSel); return el ? getComputedStyle(el) : null; };
    const side = (key, prop, min) => {
      const path = `${base}.${key}`;
      const input = h("input", { class: "sp-input" + (isSet(path) ? " set" : ""), type: "number", min, step: 1, title: prop,
        value: getPath(draft, path) ?? "", placeholder: round(cs()?.[prop]),
        oninput: () => { setQuick(path, input.value); input.classList.toggle("set", input.value !== ""); } });
      return input;
    };
    const all = (prefix, label, min) => {
      const input = h("input", { type: "number", min, step: 1, placeholder: "all",
        oninput: () => {
          for (const s of ["T", "R", "B", "L"]) setQuick(`${base}.${prefix}${s}`, input.value);
          box.querySelectorAll(`[data-group="${prefix}"] .sp-input`).forEach((x) => { x.value = input.value; x.classList.toggle("set", input.value !== ""); });
        } });
      return h("label", { class: "sp-all" }, h("span", {}, label), input, h("small", {}, "px"));
    };
    const ring = (prefix, name, props, inner, min) => h("div", { class: `sp-ring sp-${name}`, "data-group": prefix },
      h("span", { class: "sp-name" }, name),
      h("span", { class: "sp-t" }, side(prefix + "T", props[0], min)),
      h("span", { class: "sp-l" }, side(prefix + "L", props[3], min)),
      inner,
      h("span", { class: "sp-r" }, side(prefix + "R", props[1], min)),
      h("span", { class: "sp-b" }, side(prefix + "B", props[2], min)));
    const box = ring("mar", "margin", ["marginTop", "marginRight", "marginBottom", "marginLeft"],
      ring("pad", "padding", ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"], h("div", { class: "sp-content" }), 0), undefined);
    return h("div", { class: "cms-spacing" },
      h("div", { class: "sp-alls" }, all("pad", "Padding", 0), all("mar", "Margin")),
      box,
      h("small", { class: "cms-note" }, "Empty boxes use the design's spacing (shown faintly)."));
  }

  let styleOpen = true; // keep the Style group open or closed as you move between items
  function styleEditor(base, o) {
    const sampleText = o.textSel || o.box;
    const d = h("details", { class: "cms-more-opts cms-style", open: styleOpen },
      h("summary", {}, "Style"),
      h("div", { class: "cms-section-body" },
        h("div", { class: "cms-style-sub" }, h("span", { class: "cms-label" }, "Spacing"), spacingControl(base, o.box)),
        o.text ? h("div", { class: "cms-style-sub" }, h("span", { class: "cms-label" }, "Text"),
          h("div", { class: "cms-quick-grid" },
            fontControl(`${base}.font`),
            o.size ? numberControl(`${base}.size`, "Size", () => round(cssOf(o.sizeSel || sampleText, "fontSize"))) : null,
            (o.sizes || []).map(([key, label, sel]) => numberControl(`${base}.${key}`, label, () => round(cssOf(`${o.box} ${sel}`, "fontSize")))),
            colorControl(`${base}.color`, "Colour", () => cssOf(sampleText, "color")))) : null,
        h("div", { class: "cms-style-sub" }, h("span", { class: "cms-label" }, "Fill & border"),
          h("div", { class: "cms-quick-grid" },
            colorControl(`${base}.bg`, "Background", () => bgSample(o.box)),
            opacityControl(`${base}.opacity`, () => String(Math.round((parseFloat(cssOf(o.box, "opacity")) || 1) * 100))),
            numberControl(`${base}.borderW`, "Border width", () => round(cssOf(o.box, "borderTopWidth"))),
            colorControl(`${base}.borderColor`, "Border colour", () => cssOf(o.box, "borderTopColor")),
            numberControl(`${base}.radius`, "Corner radius", () => round(cssOf(o.box, "borderTopLeftRadius"))))),
        h("button", { type: "button", class: "cms-link cms-reset-style", onclick: () => {
          setQuick(base, "");
          const wrapper = d.parentElement;
          const fresh = styleEditor(base, o);
          fresh.open = true;
          wrapper.replaceChild(fresh, d);
        } }, "Reset style")));
    d.addEventListener("toggle", () => (styleOpen = d.open));
    return d;
  }

  const NO_TEXT = new Set(["image", "spacer", "projects", "services"]);
  const partStyle = (part) => ({
    box: `[data-pid="${part.id}"]`,
    textSel: `[data-pid="${part.id}"] > *`,
    sizeSel: part.type === "quote" ? `[data-pid="${part.id}"] .quote-text` : part.type === "biglink" ? `[data-pid="${part.id}"] .big-link` : null,
    text: !NO_TEXT.has(part.type),
    size: !NO_TEXT.has(part.type) && part.type !== "box",
  });
  const sectionStyle = (s) => ({ box: `#${s.id}`, textSel: `#${s.id}`, text: true, size: false });
  const serviceStyle = (it) => ({ box: `[data-iid="${it.id}"]`, textSel: `[data-iid="${it.id}"] h3`, text: true,
    sizes: [["titleSize", "Title size", "h3"], ["textSize", "Text size", "p"]] });
  const linkStyle = (it) => ({ box: `[data-iid="${it.id}"]`, text: true, size: true });

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
    links: (p) => [listEditor(p + "items", [["label", "Label"], ["url", "Link", { type: "url" }]], "+ Add link", { label: "", url: "" }, linkStyle)],
    biglink: (p) => [
      field(p + "text", "Text", { type: "textarea", rows: 2, hint: RICH_HINT }),
      field(p + "link", "Link", { hint: "mailto:you@example.com, a URL or #section-id" }),
    ],
    projects: (p) => [
      field(p + "filters", "Category filter buttons", { type: "select", options: [[true, "Show"], [false, "Hide"]], parse: (v) => v === "true" }),
      h("span", { class: "cms-label" }, "Projects"),
      projectsEditor(),
    ],
    services: (p) => [listEditor(p + "items", [["title", "Service"], ["text", "Description", { type: "textarea", rows: 2 }]], "+ Add service", { title: "New service", text: "" }, serviceStyle)],
    spacer: (p) => [field(p + "size", "Height", { type: "select", options: [["s", "Small"], ["m", "Medium"], ["l", "Large"]] })],
    box: (p, part, path) => [
      h("div", { class: "cms-grid2" },
        field(p + "dir", "Arrange contents", { type: "select", options: [["down", "Down (stacked)"], ["across", "Across (columns)"]] }),
        field(p + "align", "Align", { type: "select", options: [["", "Like the section"], ["left", "Left"], ["center", "Centre"], ["right", "Right"]] })),
      field(p + "gap", "Gap between items (px)", { parse: (v) => v.replace(/[^0-9]/g, ""), hint: "Empty = 20" }),
      partsList(part, path),
    ],
    table: (p) => [
      field(p + "header", "First row", { type: "select", options: [[true, "Is a header"], [false, "Is normal text"]], parse: (v) => v === "true",
        onInput: () => setTimeout(() => buildSectionView(), 50) }),
      tableEditor(p),
    ],
  };

  const plain = (t) => String(t ?? "").replace(/\*/g, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  function partPreview(p) {
    if (p.type === "links" || p.type === "services") return `${(p.items || []).length} item${(p.items || []).length === 1 ? "" : "s"}`;
    if (p.type === "image") return p.caption || (p.image ? "Image" : "No image yet");
    if (p.type === "spacer") return { s: "Small", m: "Medium", l: "Large" }[p.size] || "";
    if (p.type === "projects") return "From the Projects list";
    if (p.type === "box") return `${(p.parts || []).length} inside · ${p.dir === "across" ? "across" : "down"}`;
    if (p.type === "table") return `${(p.rows || []).length} rows × ${Math.max(0, ...(p.rows || []).map((r) => r.length))} columns`;
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
  // Find a part anywhere (including inside boxes): its list, position, path and the boxes around it
  function findPart(pid) {
    if (!pid || !draft) return null;
    const search = (list, base, chain) => {
      for (const [j, p] of (list || []).entries()) {
        const path = `${base}.parts.${j}`;
        if (p.id === pid) return { j, part: p, list, path, chain };
        if (Array.isArray(p.parts)) { const r = search(p.parts, path, [...chain, p.id]); if (r) return r; }
      }
      return null;
    };
    for (const [si, s] of draft.sections.entries()) {
      const r = search(s.parts, `sections.${si}`, []);
      if (r) return { si, section: s, ...r };
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
      h("p", { class: "cms-tip" }, "Tip: click anything on the page to edit it, press Delete to remove it, or right-click for more."),
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
    const wrap = h("div", { class: "cms-list cms-projects" });
    // A project clicked on the page opens in the list
    if (focusItem?.project) openProject = focusItem.project;
    let dragFrom = null;
    const catName = (p) => CATEGORIES.find((c) => c[0] === p.category)?.[1] || "";

    function move(from, to) {
      const list = draft.projects;
      if (to < 0 || to >= list.length || from === to) return;
      const [it] = list.splice(from, 1);
      list.splice(to, 0, it);
      rebuild(); changed();
    }

    function rebuild() {
      wrap.replaceChildren(...draft.projects.map((p, i) => {
        const title = h("b", {}, p.title || "Untitled");
        const cat = h("span", { class: "cms-proj-cat" }, catName(p));
        const handle = h("span", { class: "cms-handle", title: "Drag to move", "aria-hidden": "true" }, "⠿");
        const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
        const refreshSummary = () => { title.textContent = draft.projects[i].title || "Untitled"; cat.textContent = catName(draft.projects[i]); };
        const item = h("details", { class: "cms-item cms-list-item cms-project-item", open: p.id === openProject, "data-project": p.id },
          h("summary", {},
            handle,
            h("span", { class: "cms-li-title cms-proj-name" }, title, cat),
            h("button", { type: "button", class: "cms-icon", title: "Move up", "aria-label": "Move project up", disabled: i === 0, onclick: stop(() => move(i, i - 1)) }, "↑"),
            h("button", { type: "button", class: "cms-icon", title: "Move down", "aria-label": "Move project down", disabled: i === draft.projects.length - 1, onclick: stop(() => move(i, i + 1)) }, "↓"),
            h("button", { type: "button", class: "cms-icon danger", title: "Delete project", "aria-label": "Delete project", onclick: stop(() => {
              const snap = clone(draft);
              draft.projects.splice(i, 1); rebuild(); changed();
              deleted(`“${p.title || "Untitled"}”`, snap);
            }) }, "✕")),
          h("div", { class: "cms-section-body" },
            imageField(`projects.${i}.image`, "Image"),
            field(`projects.${i}.title`, "Title", { onInput: refreshSummary }),
            h("div", { class: "cms-grid2" },
              field(`projects.${i}.category`, "Category", { type: "select", options: CATEGORIES, onInput: refreshSummary }),
              field(`projects.${i}.year`, "Year", { type: "number" })),
            field(`projects.${i}.summary`, "Short line"),
            field(`projects.${i}.description`, "Description", { type: "textarea", rows: 4 }),
            field(`projects.${i}.size`, "Card size", { type: "select", options: SIZES })));
        item.addEventListener("toggle", () => { if (item.open) openProject = p.id; else if (openProject === p.id) openProject = null; });

        handle.addEventListener("pointerdown", () => (item.draggable = true));
        item.addEventListener("dragstart", (e) => { e.stopPropagation(); dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "project"); item.classList.add("dragging"); });
        item.addEventListener("dragend", () => {
          item.draggable = false; dragFrom = null; item.classList.remove("dragging");
          wrap.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
        });
        return item;
      }));
    }
    const dropIndex = (e) => {
      const rows = [...wrap.children];
      for (const [k, r] of rows.entries()) {
        const b = r.getBoundingClientRect();
        if (e.clientY < b.top + b.height / 2) return { index: k, row: r, where: "before" };
      }
      return { index: rows.length, row: rows.at(-1), where: "after" };
    };
    wrap.addEventListener("dragover", (e) => {
      if (dragFrom == null) return;
      e.preventDefault(); e.stopPropagation();
      wrap.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const t = dropIndex(e);
      t.row?.classList.add(t.where === "before" ? "drop-before" : "drop-after");
    });
    wrap.addEventListener("drop", (e) => {
      if (dragFrom == null) return;
      e.preventDefault(); e.stopPropagation();
      const to = dropIndex(e).index;
      move(dragFrom, to > dragFrom ? to - 1 : to);
    });

    rebuild();
    const add = h("button", { type: "button", class: "cms-btn primary block", onclick: () => {
      const p = { id: "p" + Date.now(), title: "New project", category: "design", year: new Date().getFullYear(), summary: "", description: "", size: "", image: "" };
      openProject = p.id;
      draft.projects.unshift(p);
      rebuild(); changed();
    } }, "+ Add project");
    return [h("p", { class: "cms-note" }, "Drag ⠿ here, or drag the cards on the page, to change the order."), add, wrap];
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

  /* ---------- Section view: one section and its parts (parts can hold parts) ---------- */
  const openSet = new Set();  // ids of expanded parts (an open part inside a box keeps the box open)
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

  // Open a part (and the boxes it sits in), closing everything else
  function openOnly(pid) {
    openSet.clear();
    if (!pid) return;
    const f = findPart(pid);
    if (f) for (const id of [...f.chain, pid]) openSet.add(id);
  }

  function buildSectionView() {
    const si = draft.sections.findIndex((s) => s.id === current.section);
    const s = draft.sections[si];
    if (openSet.size && settingsOpen && current.part) settingsOpen = false;
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
        styleEditor(`sections.${si}.css`, sectionStyle(s)),
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
        isBanner ? null : partsList(s, `sections.${si}`, { top: true }),
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
  function closeCard(c) {
    c.classList.remove("open");
    c.querySelector(":scope > .cms-part-body").hidden = true;
    c.querySelector(":scope > .cms-part-head .cms-part-title").setAttribute("aria-expanded", "false");
    openSet.delete(c.dataset.card);
    c.querySelectorAll(".cms-part[data-card]").forEach((x) => openSet.delete(x.dataset.card));
  }
  function collapseParts() {
    sectionView.querySelectorAll(".cms-part.open").forEach(closeCard);
    openSet.clear();
  }
  function closeSettings() {
    sectionView.querySelectorAll(".cms-settings[open], .cms-menu-opts[open]").forEach((d) => (d.open = false));
    settingsOpen = false;
  }

  // A deep copy with fresh ids (and copies of any CSS edits made for the original)
  function freshCopy(part) {
    const copy = structuredClone(part);
    const map = {};
    Site.eachPart([copy], (p) => {
      const id = Site.newPartId();
      map[p.id] = id;
      p.id = id;
      if (Array.isArray(p.items)) for (const it of p.items) if (it && typeof it === "object") it.id = Site.newItemId();
    });
    for (const [sel, props] of Object.entries(draft.styles || {})) {
      for (const [from, to] of Object.entries(map)) {
        if (sel.includes(`[data-pid="${from}"]`)) draft.styles[sel.replaceAll(`[data-pid="${from}"]`, `[data-pid="${to}"]`)] = structuredClone(props);
      }
    }
    return copy;
  }
  // Remove CSS edits that only applied to these parts
  function dropStylesFor(part) {
    const ids = [];
    Site.eachPart([part], (p) => ids.push(p.id));
    for (const sel of Object.keys(draft.styles || {})) if (ids.some((id) => sel.startsWith(`[data-pid="${id}"]`))) delete draft.styles[sel];
  }

  function duplicateSection(i) {
    const copy = structuredClone(draft.sections[i]);
    copy.id = Site.newSectionId(copy.kind || "section");
    copy.menu = "";
    copy.parts = (draft.sections[i].parts || []).map(freshCopy);
    draft.sections.splice(i + 1, 0, copy);
    changed();
    setTimeout(() => showSection(copy.id), 60);
  }
  function removeSection(i) {
    const s = draft.sections[i];
    const snap = clone(draft);
    draft.sections.splice(i, 1);
    for (const sel of Object.keys(draft.styles || {})) if (sel === `#${s.id}` || sel.startsWith(`#${s.id} `)) delete draft.styles[sel];
    for (const p of s.parts || []) dropStylesFor(p);
    changed();
    showOverview();
    deleted(`the ${sectionKind(s)} section`, snap);
  }

  // Simple table editor: a grid of cells plus add/remove rows and columns
  function tableEditor(prefix) {
    const path = prefix + "rows";
    const wrap = h("div", { class: "cms-table-edit" });
    function rebuild() {
      if (!Array.isArray(getPath(draft, path))) setPath(draft, path, [[""]]);
      const rows = getPath(draft, path);
      const cols = Math.max(1, ...rows.map((r) => r.length));
      for (const r of rows) while (r.length < cols) r.push("");
      const header = getPath(draft, prefix + "header") !== false;
      wrap.replaceChildren(
        h("div", { class: "cms-table-grid", style: `grid-template-columns: repeat(${cols}, minmax(64px, 1fr)) 24px` },
          rows.map((r, ri) => [
            r.map((t, ci) => {
              const input = h("input", { value: t, class: ri === 0 && header ? "th" : "", "aria-label": `Row ${ri + 1}, column ${ci + 1}`,
                oninput: () => { getPath(draft, path)[ri][ci] = input.value; changed(); } });
              return input;
            }),
            h("button", { type: "button", class: "cms-icon danger", title: "Remove row", "aria-label": `Remove row ${ri + 1}`, disabled: rows.length < 2,
              onclick: () => { rows.splice(ri, 1); rebuild(); changed(); } }, "✕"),
          ]),
          Array.from({ length: cols }, (_, ci) => h("button", { type: "button", class: "cms-icon danger cms-col-x", title: "Remove column", "aria-label": `Remove column ${ci + 1}`, disabled: cols < 2,
            onclick: () => { rows.forEach((r) => r.splice(ci, 1)); rebuild(); changed(); } }, "✕"))),
        h("div", { class: "cms-row cms-table-add" },
          h("button", { type: "button", class: "cms-btn small", onclick: () => { rows.push(Array(cols).fill("")); rebuild(); changed(); } }, "+ Row"),
          h("button", { type: "button", class: "cms-btn small", onclick: () => { rows.forEach((r) => r.push("")); rebuild(); changed(); } }, "+ Column")));
    }
    rebuild();
    return wrap;
  }

  // The list of parts inside a section or a box: open, reorder (drag or arrows), add, delete
  function partsList(container, basePath, { top = false } = {}) {
    const list = (container.parts ??= []);
    const box = h("div", { class: "cms-parts" + (top ? "" : " cms-parts-nested") });
    const typeSelect = h("select", {}, Object.entries(Site.parts).map(([k, t]) => h("option", { value: k }, t.label)));
    const refresh = () => { changed(); buildSectionView(); };
    let dragFrom = null;

    function movePart(from, to) {
      const [moved] = list.splice(from, 1);
      list.splice(to > from ? to - 1 : to, 0, moved);
      refresh();
    }
    function moveToSection(j, targetId) {
      const dest = draft.sections.find((x) => x.id === targetId);
      if (!dest) return;
      const [moved] = list.splice(j, 1);
      (dest.parts ??= []).push(moved);
      changed();
      setTimeout(() => showSection(dest.id, moved.id), 60);
    }

    list.forEach((part, j) => {
      const path = `${basePath}.parts.${j}`;
      const isOpen = openSet.has(part.id);
      const label = h("span", { class: "cms-part-preview" }, partPreview(part));
      const handle = h("span", { class: "cms-handle", title: "Drag to move", "aria-hidden": "true" }, "⠿");
      const others = draft.sections.filter((x) => x.id !== current.section && x.layout !== "banner");
      const body = h("div", { class: "cms-part-body", hidden: !isOpen },
        PART_FIELDS[part.type]?.(path + ".", part, path) || [],
        styleEditor(`${path}.css`, partStyle(part)),
        others.length ? h("label", { class: "cms-field cms-move-to" }, h("span", {}, "Move to another section"),
          h("select", { onchange: (e) => e.target.value && moveToSection(j, e.target.value) },
            h("option", { value: "" }, "Choose…"),
            others.map((x) => h("option", { value: x.id }, sectionLabel(x))))) : null);
      const card = h("div", { class: "cms-part" + (isOpen ? " open" : "") + (current.part === part.id ? " current" : ""), "data-card": part.id },
        h("div", { class: "cms-part-head" },
          handle,
          h("button", { type: "button", class: "cms-part-title", "aria-expanded": String(isOpen), onclick: (e) => {
            const open = body.hidden;
            if (open) {
              // Accordion: close the other parts in this same list (and the section settings)
              for (const sib of box.querySelectorAll(":scope > .cms-part.open")) if (sib !== card) closeCard(sib);
              closeSettings();
              openSet.add(part.id);
            } else closeCard(card);
            body.hidden = !open;
            card.classList.toggle("open", open);
            e.currentTarget.setAttribute("aria-expanded", String(open));
            current.part = open ? part.id : current.part === part.id ? null : current.part;
            selectedItem = null;
            markCurrent();
            if (open) document.querySelector(`[data-pid="${part.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          } }, h("b", {}, Site.parts[part.type]?.label || part.type), label),
          h("button", { type: "button", class: "cms-css-btn", title: "Edit this part's CSS", onclick: () => {
            const el = document.querySelector(`[data-pid="${part.id}"]`);
            if (el) { current.part = part.id; inspect(el.firstElementChild || el, "section"); }
          } }, "CSS"),
          h("button", { type: "button", class: "cms-icon", title: "Move up", "aria-label": "Move part up", disabled: j === 0, onclick: () => movePart(j, j - 1) }, "↑"),
          h("button", { type: "button", class: "cms-icon", title: "Move down", "aria-label": "Move part down", disabled: j === list.length - 1, onclick: () => movePart(j, j + 2) }, "↓"),
          h("button", { type: "button", class: "cms-icon danger", title: "Delete part", "aria-label": "Delete part", onclick: () => {
            const snap = clone(draft);
            list.splice(j, 1);
            dropStylesFor(part);
            if (current.part === part.id) current.part = null;
            refresh();
            deleted(Site.parts[part.type]?.label || "part", snap);
          } }, "✕")),
        body);
      card.addEventListener("input", (e) => { if (e.target.closest(".cms-part") === card) label.textContent = partPreview(part); });

      // Drag by the handle only, so text in the fields can still be selected
      handle.addEventListener("pointerdown", (e) => { e.stopPropagation(); card.draggable = true; });
      card.addEventListener("dragstart", (e) => {
        if (e.target !== card) return;
        e.stopPropagation();
        dragFrom = j;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "part");
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", (e) => {
        if (e.target !== card) return;
        card.draggable = false;
        dragFrom = null;
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
      if (dragFrom == null) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      box.querySelectorAll(":scope > .drop-before, :scope > .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const t = dropIndex(e);
      t.card?.classList.add(t.where === "before" ? "drop-before" : "drop-after");
    });
    box.addEventListener("drop", (e) => {
      if (dragFrom == null) return;
      e.preventDefault(); e.stopPropagation();
      movePart(dragFrom, dropIndex(e).index);
    });

    if (!list.length) box.append(h("p", { class: "cms-note cms-parts-empty" }, top ? "This section is empty. Add a part below, or right-click it on the page." : "This box is empty. Add something below."));

    return [
      h("span", { class: "cms-label cms-parts-label" }, top ? "In this section — drag ⠿ to reorder" : "Inside this box"),
      box,
      h("div", { class: "cms-add-part" }, typeSelect,
        h("button", { type: "button", class: "cms-btn small primary", onclick: () => {
          const part = Site.makePart(typeSelect.value);
          list.push(part);
          settingsOpen = false;
          current.part = part.id;
          openOnly(part.id);
          refresh();
        } }, top ? "+ Add part" : "+ Add inside")),
    ];
  }

  /* ---------- Deleting (menu, ✕ buttons and the Delete key) ---------- */
  function deletePart(pid) {
    const f = findPart(pid);
    if (!f) return;
    const snap = clone(draft);
    f.list.splice(f.j, 1);
    dropStylesFor(f.part);
    if (current.part === pid) current.part = null;
    selectedItem = null;
    afterMenu(f.section.id);
    deleted(Site.parts[f.part.type]?.label || "part", snap);
  }
  function deleteProject(id) {
    const i = draft.projects.findIndex((p) => p.id === id);
    if (i < 0) return;
    const snap = clone(draft);
    const [gone] = draft.projects.splice(i, 1);
    selectedItem = null;
    afterMenu(current.section || draft.sections[0].id, current.part);
    deleted(`“${gone.title || "Untitled"}”`, snap);
  }
  function deleteListItem(pid, iid) {
    const f = findPart(pid);
    const items = f?.part.items;
    const i = items?.findIndex((it) => it.id === iid) ?? -1;
    if (i < 0) return;
    const snap = clone(draft);
    const [gone] = items.splice(i, 1);
    selectedItem = null;
    afterMenu(f.section.id, pid);
    deleted(`“${gone.title || gone.label || "item"}”`, snap);
  }

  // Click something on the page, then press Delete (or Backspace) to remove it
  let selectedItem = null; // { project } or { pid, iid } when a card or service was clicked
  document.addEventListener("keydown", (e) => {
    if (!editing() || view !== "section" || !(e.key === "Delete" || e.key === "Backspace")) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]") || !menu.hidden || signInDialog.open) return;
    if (selectedItem?.project) deleteProject(selectedItem.project);
    else if (selectedItem?.iid) deleteListItem(selectedItem.pid, selectedItem.iid);
    else if (current.part) deletePart(current.part);
    else return;
    e.preventDefault();
  });

  /* ---------- Right-click menu on the page ---------- */
  const menu = h("div", { class: "cms-menu", role: "menu", hidden: true });
  document.body.append(menu);
  const closeMenu = () => { menu.hidden = true; menu.replaceChildren(); };

  document.addEventListener("contextmenu", (e) => {
    if (!editing() || !inPage(e.target)) return;
    const sec = e.target.closest("main > section");
    if (!sec) return;
    e.preventDefault();
    clearHover();
    openMenu(e.target, e.clientX, e.clientY);
  });
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) closeMenu(); });
  window.addEventListener("scroll", () => { if (!menu.hidden) closeMenu(); });

  // After a change made from the menu: redraw and open the right thing in the panel
  function afterMenu(sectionId, partId = null) {
    closeMenu();
    changed();
    settingsOpen = !partId;
    setTimeout(() => showSection(sectionId, partId, { scrollPage: false }), 60);
  }

  function openMenu(target, x, y) {
    const secEl = target.closest("main > section");
    const s = draft.sections.find((v) => v.id === secEl.id);
    if (!s) return;
    const si = draft.sections.indexOf(s);
    const entries = [];
    const head = (t) => entries.push({ head: t });
    const item = (label, run, opts = {}) => entries.push({ label, run, ...opts });
    const sub = (label, choices, pick) => entries.push({ label: label + " ▸", sub: { title: label, choices, pick } });
    const sep = () => entries.push({ sep: true });
    const partTypes = Object.entries(Site.parts).map(([k, t]) => [k, t.label]);

    // A project card or a service
    const card = target.closest(".card");
    const service = target.closest(".service");
    if (card) {
      const i = draft.projects.findIndex((p) => p.id === card.dataset.project);
      const proj = draft.projects[i];
      head(`Project · ${proj?.title || ""}`);
      item("Edit project", () => { closeMenu(); focusItem = { project: proj.id }; showSection(s.id, card.closest(".part")?.dataset.pid, { scrollPage: false }); });
      item("Duplicate project", () => {
        const copy = { ...structuredClone(proj), id: "p" + Date.now(), title: `${proj.title} (copy)` };
        draft.projects.splice(i + 1, 0, copy);
        focusItem = { project: copy.id };
        afterMenu(s.id, card.closest(".part")?.dataset.pid);
      });
      item("Delete project", () => deleteProject(proj.id), { danger: true });
      sep();
    } else if (service) {
      const f = findPart(service.closest("[data-pid]")?.dataset.pid);
      const items = f?.part.items || [];
      const i = items.findIndex((it) => it.id === service.dataset.iid);
      head(`Service · ${items[i]?.title || ""}`);
      item("Edit service", () => { closeMenu(); focusItem = { item: i }; showSection(s.id, f.part.id, { scrollPage: false }); });
      item("Duplicate service", () => {
        const copy = { ...structuredClone(items[i]), id: Site.newItemId() };
        items.splice(i + 1, 0, copy);
        focusItem = { item: i + 1 };
        afterMenu(s.id, f.part.id);
      });
      item("Add service after", () => { items.splice(i + 1, 0, { id: Site.newItemId(), title: "New service", text: "" }); focusItem = { item: i + 1 }; afterMenu(s.id, f.part.id); });
      item("Delete service", () => deleteListItem(f.part.id, items[i].id), { danger: true });
      sep();
    }

    // A part (the innermost one under the pointer)
    const partEl = target.closest(".part");
    const f = partEl ? findPart(partEl.dataset.pid) : null;
    if (f) {
      const { part, list, j } = f;
      const name = Site.parts[part.type]?.label || "Part";
      head(name);
      item("Edit", () => { closeMenu(); settingsOpen = false; showSection(s.id, part.id, { scrollPage: false }); });
      if (part.type === "box") sub("Add inside", partTypes, (type) => { const p = Site.makePart(type); part.parts.push(p); afterMenu(s.id, p.id); });
      sub("Add after", partTypes, (type) => { const p = Site.makePart(type); list.splice(j + 1, 0, p); afterMenu(s.id, p.id); });
      item("Wrap in a box", () => {
        const wrapper = Site.makePart("box");
        wrapper.parts = [part];
        list.splice(j, 1, wrapper);
        afterMenu(s.id, wrapper.id);
      });
      item("Duplicate", () => { const copy = freshCopy(part); list.splice(j + 1, 0, copy); afterMenu(s.id, copy.id); });
      item("Move up", () => { list.splice(j - 1, 0, list.splice(j, 1)[0]); afterMenu(s.id, part.id); }, { disabled: j === 0 });
      item("Move down", () => { list.splice(j + 1, 0, list.splice(j, 1)[0]); afterMenu(s.id, part.id); }, { disabled: j === list.length - 1 });
      if (f.chain.length) item("Select the box it's in", () => { closeMenu(); settingsOpen = false; showSection(s.id, f.chain.at(-1), { scrollPage: false }); });
      item("Edit CSS", () => { closeMenu(); current = { section: s.id, part: part.id }; inspect(partEl.firstElementChild || partEl, "section"); });
      item(part.parts?.length ? "Delete (and what's inside)" : "Delete", () => deletePart(part.id), { danger: true });
      sep();
    }

    // The section
    head(`Section · ${sectionKind(s)}`);
    item("Section settings", () => { closeMenu(); settingsOpen = true; current.part = null; openSet.clear(); showSection(s.id, null, { scrollPage: false }); });
    if (s.layout !== "banner") sub("Add to this section", partTypes, (type) => { const p = Site.makePart(type); s.parts.push(p); afterMenu(s.id, p.id); });
    sub("Add section below", Object.entries(Site.presets).map(([k, t]) => [k, t.label]), (kind) => {
      const ns = Site.makeSection(kind);
      draft.sections.splice(si + 1, 0, ns);
      closeMenu();
      changed();
      setTimeout(() => showSection(ns.id), 60);
    });
    item("Duplicate section", () => { closeMenu(); duplicateSection(si); });
    item("Delete section", () => { closeMenu(); removeSection(si); }, { danger: true });

    drawMenu(entries, x, y);
  }

  function drawMenu(entries, x, y) {
    const rows = entries.map((e) => {
      if (e.head) return h("div", { class: "cms-menu-head" }, e.head);
      if (e.sep) return h("div", { class: "cms-menu-sep", role: "separator" });
      return h("button", { type: "button", role: "menuitem", class: "cms-menu-item" + (e.danger ? " danger" : ""), disabled: e.disabled,
        onclick: () => e.sub
          ? drawMenu([
            { label: "← Back", run: () => drawMenu(entries, x, y) },
            { head: e.sub.title },
            ...e.sub.choices.map(([k, l]) => ({ label: l, run: () => e.sub.pick(k) })),
          ], x, y)
          : e.run() }, e.label);
    });
    menu.replaceChildren(...rows);
    menu.hidden = false;
    // Keep the menu on screen
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  // Stay in the editor across reloads in the same tab
  if (Store.isSignedIn()) openEditor();
})();
