/* Builds the "inspect this element" panel shown in the editor sidebar.
   Values are editable; edits are reported through callbacks and saved by cms.js. */
const Inspector = (() => {
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k === "value") el.value = v;
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
    return el;
  };

  // Values that just mean "not set" — hidden unless "Show all" is on
  const DEFAULTS = {
    position: "static", top: "auto", right: "auto", bottom: "auto", left: "auto", "z-index": "auto",
    float: "none", overflow: "visible", "overflow-x": "visible", "overflow-y": "visible",
    "min-width": ["auto", "0px"], "max-width": "none", "min-height": ["auto", "0px"], "max-height": "none",
    "aspect-ratio": "auto", "align-self": "auto", "justify-self": "auto", order: "0",
    "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto",
    "grid-column": "auto", "grid-row": "auto",
    "font-style": "normal", "letter-spacing": "normal", "text-transform": "none",
    "text-decoration-line": "none", "text-align": "start", "white-space": "normal", "word-spacing": "0px",
    "background-color": "rgba(0, 0, 0, 0)", "background-image": "none",
    "background-size": "auto", "background-position": "0% 0%", "background-repeat": "repeat",
    "border-radius": "0px", opacity: "1", "box-shadow": "none", transform: "none", filter: "none",
    "backdrop-filter": "none", "mix-blend-mode": "normal", cursor: "auto",
    "transition-duration": "0s", "animation-name": "none", visibility: "visible", "pointer-events": "auto",
    "text-shadow": "none", "column-gap": "normal", "row-gap": "normal",
  };
  const isDefault = (p, v) => [].concat(DEFAULTS[p] ?? []).includes(v);

  const GROUPS = [
    { title: "Layout", props: ["display", "position", "top", "right", "bottom", "left", "z-index", "width", "height",
      "min-width", "max-width", "min-height", "max-height", "aspect-ratio", "box-sizing", "overflow-x", "overflow-y", "float"] },
    { title: "Flexbox", when: (cs) => cs.display.includes("flex"),
      props: ["flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "row-gap", "column-gap"] },
    { title: "Grid", when: (cs) => cs.display.includes("grid"),
      props: ["grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-auto-rows", "justify-items", "align-items", "row-gap", "column-gap"] },
    { title: "As a child of its parent", when: (cs, el) => /flex|grid/.test(getComputedStyle(el.parentElement).display),
      props: ["order", "flex-grow", "flex-shrink", "flex-basis", "align-self", "justify-self", "grid-column", "grid-row"] },
    { title: "Text", props: ["color", "font-family", "font-size", "font-weight", "font-style", "line-height",
      "letter-spacing", "word-spacing", "text-align", "text-transform", "text-decoration-line", "white-space", "text-shadow"] },
    { title: "Background", props: ["background-color", "background-image", "background-size", "background-position", "background-repeat"] },
    { title: "Border", props: ["border-top", "border-right", "border-bottom", "border-left", "border-radius"] },
    { title: "Effects", props: ["opacity", "box-shadow", "transform", "filter", "backdrop-filter", "mix-blend-mode",
      "visibility", "cursor", "pointer-events", "transition-duration", "animation-name"] },
  ];

  // Properties edited with a dropdown
  const CHOICES = {
    display: ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"],
    position: ["static", "relative", "absolute", "fixed", "sticky"],
    "box-sizing": ["border-box", "content-box"],
    "overflow-x": ["visible", "hidden", "auto", "scroll"], "overflow-y": ["visible", "hidden", "auto", "scroll"],
    "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
    "flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
    "justify-content": ["normal", "flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"],
    "align-items": ["normal", "stretch", "flex-start", "center", "flex-end", "baseline"],
    "align-self": ["auto", "stretch", "flex-start", "center", "flex-end", "baseline"],
    "grid-auto-flow": ["row", "column", "dense", "row dense", "column dense"],
    "font-family": ['"Inter Tight", system-ui, sans-serif', '"Instrument Serif", Georgia, serif', "system-ui, sans-serif", "Georgia, serif", "ui-monospace, Menlo, monospace"],
    "font-weight": ["300", "400", "500", "600", "700", "800", "900"],
    "font-style": ["normal", "italic"],
    "text-align": ["start", "left", "center", "right", "justify"],
    "text-transform": ["none", "uppercase", "lowercase", "capitalize"],
    "text-decoration-line": ["none", "underline", "line-through", "overline"],
    "white-space": ["normal", "nowrap", "pre-line", "pre-wrap"],
    "background-size": ["auto", "cover", "contain"],
    "background-repeat": ["repeat", "no-repeat", "repeat-x", "repeat-y"],
    visibility: ["visible", "hidden"],
    "mix-blend-mode": ["normal", "multiply", "screen", "overlay", "difference"],
    cursor: ["auto", "default", "pointer", "text", "crosshair"],
    "pointer-events": ["auto", "none"],
  };
  const COLOR_PROPS = new Set(["color", "background-color"]);
  const LENGTH_RE = /(width|height|size|margin|padding|gap|radius|^top$|^right$|^bottom$|^left$|spacing|basis)/;

  // "12" → "12px" for size properties; leave everything else as typed
  function normalise(prop, value) {
    const v = value.trim();
    return LENGTH_RE.test(prop) && /^-?\d*\.?\d+$/.test(v) && v !== "0" ? v + "px" : v;
  }
  const valid = (prop, value) => value === "" || (CSS.supports(prop, value) && !/[{}<;]/.test(value));

  /* ---------- Formatting ---------- */
  const COLOR_RE = /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;

  function toHex(c) {
    const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!m) return null;
    const hex = "#" + [m[1], m[2], m[3]].map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("");
    if (m[4] === undefined) return hex;
    const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
    return a >= 1 ? hex : `${hex} · ${Math.round(a * 100)}%`;
  }
  const hexOnly = (c) => (toHex(c) || "#000000").slice(0, 7);

  // Value text with a colour swatch next to every colour in it
  function valueNode(v) {
    const shown = v.length > 160 ? v.slice(0, 157) + "…" : v;
    const out = h("span", { class: "insp-val" });
    let last = 0;
    shown.replace(COLOR_RE, (match, _c, idx) => {
      out.append(shown.slice(last, idx));
      out.append(h("span", { class: "insp-swatch", style: `background:${match}` }), toHex(match) || match);
      last = idx + match.length;
      return match;
    });
    out.append(shown.slice(last));
    return out;
  }

  const num = (v) => { const n = parseFloat(v); return n ? String(Math.round(n * 10) / 10) : "0"; };

  function describe(el) {
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      [...el.classList].filter((c) => !c.startsWith("cms-")).slice(0, 3).map((c) => "." + c).join("");
  }

  /* ---------- Which elements a change applies to ---------- */
  const pageEls = (sel) => {
    try { return [...document.querySelectorAll(sel)].filter((e) => !e.closest(".cms, .cms-fab, dialog")); }
    catch (e) { return []; }
  };
  const ownClasses = (el) => [...el.classList].filter((c) => !c.startsWith("cms-") && c !== "active" && c !== "out");

  function targets(el) {
    const idParent = (() => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (n.id) return n; })();
    const own = el.id ? "#" + el.id : el.tagName.toLowerCase() + ownClasses(el).map((c) => "." + c).join("");
    const list = [];
    const add = (sel, label) => {
      if (!sel || list.some((t) => t.sel === sel)) return;
      const n = pageEls(sel).length;
      if (n && pageEls(sel).includes(el)) list.push({ sel, label: `${label} — ${n} item${n === 1 ? "" : "s"}` });
    };

    // e.g. "#work .card-info h3": this kind of item in this part of the page
    let kind = own;
    if (!el.id && !ownClasses(el).length) {
      for (let n = el.parentElement; n && n !== idParent; n = n.parentElement) {
        const c = ownClasses(n)[0];
        if (c) { kind = `.${c} ${own}`; break; }
      }
    }
    add(!el.id && idParent ? `#${idParent.id} ${kind}` : kind, "All like this");

    // Rules from styles.css that style it
    for (const r of matchingRules(el)) {
      if (/^(\*|html|body|:root|a|button|[a-z0-9]+)$/i.test(r.selector.trim())) continue;
      for (const part of r.selector.split(",").map((s) => s.trim())) {
        try { if (el.matches(part)) add(part, "Everything using " + part); } catch (e) {}
      }
    }

    // Just this one, by its position on the page
    if (!el.id) {
      const steps = [];
      let n = el;
      for (; n && n !== document.body && !n.id; n = n.parentElement) {
        steps.unshift(`${n.tagName.toLowerCase()}:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`);
      }
      if (n?.id) add(`#${n.id} > ${steps.join(" > ")}`, "Only this one");
    }
    return list;
  }

  /* ---------- Matching CSS rules from the site's stylesheets ---------- */
  function matchingRules(el) {
    const found = [];
    const walk = (rules, media) => {
      for (const rule of rules) {
        if (rule.selectorText !== undefined && rule.style) {
          let hit = false;
          try { hit = el.matches(rule.selectorText); } catch (e) {}
          if (hit) found.push({ selector: rule.selectorText, media, style: rule.style });
        } else if (rule.cssRules) {
          const cond = rule.conditionText || rule.media?.mediaText;
          if (rule.media && !matchMedia(rule.media.mediaText).matches) continue;
          walk(rule.cssRules, cond ? `@media ${cond}` : media);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      if (!sheet.href || /cms\.css|fonts\.googleapis/.test(sheet.href)) continue; // site styles only
      try { walk(sheet.cssRules, null); } catch (e) {}
    }
    return found.reverse(); // later rules win, so show them first
  }

  function declList(style) {
    const rows = [];
    for (let i = 0; i < style.length; i++) {
      const p = style[i];
      rows.push(h("div", { class: "insp-decl" },
        h("span", { class: "insp-prop" }, p), ": ", valueNode(style.getPropertyValue(p).trim()), ";"));
    }
    return rows;
  }

  /* ---------- Panel ---------- */
  function render(el, opts) {
    const { onSelect, onBack, showAll, onToggleAll, styles, target, onTarget, onSet, onReset } = opts;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const mine = styles[target] || {};
    const copied = [];

    // An editor for one property: dropdown, colour picker or text box
    function editor(prop, value) {
      const set = (v, live) => {
        v = normalise(prop, v);
        if (!valid(prop, v)) { input.classList.add("bad"); return; }
        input.classList.remove("bad");
        onSet(prop, v, { live });
      };
      let input;
      if (CHOICES[prop]) {
        const opts = CHOICES[prop].includes(value) ? CHOICES[prop] : [value, ...CHOICES[prop]];
        input = h("select", { class: "insp-input", onchange: () => set(input.value) },
          opts.map((o) => h("option", { value: o, selected: o === value }, prop === "font-family" ? o.split(",")[0].replace(/"/g, "") : o)));
        return input;
      }
      input = h("input", { class: "insp-input", value, spellcheck: "false",
        onchange: () => set(input.value), onkeydown: (e) => { if (e.key === "Enter") input.blur(); } });
      if (!COLOR_PROPS.has(prop)) return input;
      const picker = h("input", { type: "color", class: "insp-color", value: hexOnly(value),
        oninput: () => { input.value = picker.value; set(picker.value, true); },
        onchange: () => set(picker.value) });
      return h("span", { class: "insp-color-row" }, picker, input);
    }

    function row(prop, value) {
      const changed = prop in mine;
      return h("div", { class: "insp-row" + (changed ? " changed" : "") },
        h("span", { class: "insp-prop" }, prop),
        h("span", { class: "insp-edit" }, editor(prop, value),
          changed ? h("button", { type: "button", class: "insp-reset", title: "Undo this change", onclick: () => onReset(prop) }, "↺") : null));
    }

    const crumbs = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      crumbs.unshift(n);
      if (n.matches("main, .nav, .footer")) break;
    }

    const groups = GROUPS.filter((g) => !g.when || g.when(cs, el)).map((g) => {
      const rows = g.props.map((p) => {
        const v = cs.getPropertyValue(p).trim();
        if (!(p in mine) && !showAll) {
          if (/^border-(top|right|bottom|left)$/.test(p) && parseFloat(v) === 0) return null;
          if (isDefault(p, v)) return null;
          // Offsets only matter on positioned boxes, and 0 on a relative box does nothing
          if (/^(top|right|bottom|left)$/.test(p) && (cs.position === "static" || (cs.position === "relative" && v === "0px"))) return null;
        }
        copied.push(`  ${p}: ${v};`);
        return row(p, v);
      }).filter(Boolean);
      if (!rows.length) return null;
      return h("details", { class: "insp-group", open: true }, h("summary", {}, g.title), rows);
    });

    /* Box model with editable numbers */
    function boxModel() {
      const sideInput = (prop) => {
        const v = cs.getPropertyValue(prop);
        const input = h("input", { class: "insp-bm-input" + (prop in mine ? " changed" : ""), value: num(v), title: prop, spellcheck: "false",
          onchange: () => {
            const val = normalise(prop, input.value || "0");
            if (!valid(prop, val)) { input.classList.add("bad"); return; }
            onSet(prop, val, {});
          },
          onkeydown: (e) => { if (e.key === "Enter") input.blur(); } });
        return input;
      };
      const layer = (name, prop, inner) => h("div", { class: `insp-bm insp-bm-${name}` },
        h("span", { class: "insp-bm-name" }, name),
        h("span", { class: "insp-bm-t" }, sideInput(prop.replace("*", "top"))),
        h("span", { class: "insp-bm-l" }, sideInput(prop.replace("*", "left"))),
        inner,
        h("span", { class: "insp-bm-r" }, sideInput(prop.replace("*", "right"))),
        h("span", { class: "insp-bm-b" }, sideInput(prop.replace("*", "bottom"))));
      const px = (p) => parseFloat(cs.getPropertyValue(p)) || 0;
      const cw = Math.round((r.width - px("padding-left") - px("padding-right") - px("border-left-width") - px("border-right-width")) * 10) / 10;
      const ch = Math.round((r.height - px("padding-top") - px("padding-bottom") - px("border-top-width") - px("border-bottom-width")) * 10) / 10;
      return layer("margin", "margin-*",
        layer("border", "border-*-width",
          layer("padding", "padding-*",
            h("div", { class: "insp-bm-content" }, `${cw} × ${ch}`))));
    }

    /* Add any other property */
    const newProp = h("input", { class: "insp-input", placeholder: "property, e.g. gap", spellcheck: "false", list: "insp-props" });
    const newVal = h("input", { class: "insp-input", placeholder: "value", spellcheck: "false" });
    const addProp = () => {
      const p = newProp.value.trim().toLowerCase();
      const v = normalise(p, newVal.value);
      if (!/^[a-z-]+$/.test(p) || !v || !valid(p, v)) { newVal.classList.add("bad"); return; }
      onSet(p, v, {});
    };
    newVal.addEventListener("keydown", (e) => { if (e.key === "Enter") addProp(); });

    const rules = matchingRules(el);
    const inline = el.getAttribute("style");
    const tlist = targets(el);
    const changedHere = Object.entries(styles).filter(([sel, props]) => Object.keys(props).length && pageEls(sel).includes(el));

    const copyBtn = h("button", { type: "button", class: "cms-btn small", onclick: async () => {
      const text = `${target || describe(el)} {\n${copied.join("\n")}\n}`;
      try { await navigator.clipboard.writeText(text); copyBtn.textContent = "Copied ✓"; }
      catch (e) { copyBtn.textContent = "Couldn't copy"; }
      setTimeout(() => (copyBtn.textContent = "Copy CSS"), 1500);
    } }, "Copy CSS");

    return h("div", { class: "insp" },
      h("div", { class: "insp-top" },
        h("button", { type: "button", class: "cms-btn small", onclick: onBack }, "← Back to content"),
        copyBtn),
      h("div", { class: "insp-crumbs" },
        crumbs.map((n, i) => [
          i ? h("span", { class: "insp-sep" }, "›") : null,
          h("button", { type: "button", class: "insp-crumb" + (n === el ? " current" : ""), onclick: () => onSelect(n) }, describe(n)),
        ])),
      h("div", { class: "insp-meta" },
        h("span", {}, `${Math.round(r.width)} × ${Math.round(r.height)} px`),
        h("span", {}, `x ${Math.round(r.left + scrollX)}, y ${Math.round(r.top + scrollY)}`)),
      el.children.length ? h("div", { class: "insp-children" },
        [...el.children].slice(0, 12).map((c) => h("button", { type: "button", class: "insp-crumb", onclick: () => onSelect(c) }, describe(c)))) : null,

      h("label", { class: "insp-target" },
        h("span", {}, "Apply changes to"),
        h("select", { class: "insp-input", onchange: (e) => onTarget(e.target.value) },
          tlist.map((t) => h("option", { value: t.sel, selected: t.sel === target }, t.label))),
        h("code", {}, target)),

      changedHere.length ? h("div", { class: "insp-changes" },
        h("strong", {}, "Your changes affecting this"),
        changedHere.map(([sel, props]) => h("div", { class: "insp-change" },
          h("code", {}, sel),
          Object.entries(props).map(([p, v]) => h("div", { class: "insp-change-row" },
            h("span", {}, `${p}: ${v}`),
            h("button", { type: "button", class: "insp-reset", title: "Undo", onclick: () => onReset(p, sel) }, "↺")))))) : null,

      h("details", { class: "insp-group", open: true }, h("summary", {}, "Box model"),
        h("p", { class: "insp-hint" }, "Click a number to change it (px)."), boxModel()),
      h("label", { class: "cms-toggle insp-all" },
        h("span", {}, "Show all properties"),
        h("input", { type: "checkbox", role: "switch", checked: showAll, onchange: (e) => onToggleAll(e.target.checked) }),
        h("i", { "aria-hidden": "true" })),
      groups,
      h("details", { class: "insp-group" }, h("summary", {}, "Add another property"),
        h("div", { class: "insp-add" }, newProp, newVal,
          h("button", { type: "button", class: "cms-btn small primary", onclick: addProp }, "Add")),
        h("datalist", { id: "insp-props" }, [...new Set(GROUPS.flatMap((g) => g.props).concat(["gap", "margin", "padding", "border", "inset", "outline"]))].map((p) => h("option", { value: p })))),
      h("details", { class: "insp-group" },
        h("summary", {}, `CSS rules (${rules.length + (inline ? 1 : 0)})`),
        h("p", { class: "insp-hint" }, "From styles.css. Top rules win when two set the same thing. Your changes override all of these."),
        inline ? h("div", { class: "insp-rule" }, h("div", { class: "insp-sel" }, "style attribute (set by script)"),
          declList(el.style)) : null,
        rules.map((rule) => h("div", { class: "insp-rule" },
          rule.media ? h("div", { class: "insp-media" }, rule.media) : null,
          h("div", { class: "insp-sel" }, rule.selector + " {"),
          declList(rule.style),
          h("div", { class: "insp-sel" }, "}")))));
  }

  return { render, describe, targets };
})();
