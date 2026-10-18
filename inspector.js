/* Builds the "inspect this element" panel shown in the editor sidebar. Read-only. */
const Inspector = (() => {
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
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

  // Value text with a colour swatch next to every colour in it
  function valueNode(v) {
    const shown = v.length > 160 ? v.slice(0, 157) + "…" : v;
    const out = h("span", { class: "insp-val", title: v.length > 160 ? "" : v });
    let last = 0;
    shown.replace(COLOR_RE, (match, _c, idx) => {
      out.append(shown.slice(last, idx));
      const hex = toHex(match);
      out.append(h("span", { class: "insp-swatch", style: `background:${match}` }), hex || match);
      last = idx + match.length;
      return match;
    });
    out.append(shown.slice(last));
    return out;
  }

  const font = (v) => v.split(",")[0].replace(/["']/g, "").trim() + (v.includes(",") ? " (+ fallbacks)" : "");
  const num = (v) => { const n = parseFloat(v); return n ? String(Math.round(n * 10) / 10) : "–"; };

  function describe(el) {
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      [...el.classList].filter((c) => !c.startsWith("cms-")).slice(0, 3).map((c) => "." + c).join("");
  }

  /* ---------- Box model diagram ---------- */
  function boxModel(el, cs) {
    const side = (p) => ["top", "right", "bottom", "left"].map((s) => num(cs.getPropertyValue(p.replace("*", s))));
    const layer = (name, vals, inner) => h("div", { class: `insp-bm insp-bm-${name}` },
      h("span", { class: "insp-bm-name" }, name),
      h("span", { class: "insp-bm-t" }, vals[0]),
      h("span", { class: "insp-bm-l" }, vals[3]),
      inner,
      h("span", { class: "insp-bm-r" }, vals[1]),
      h("span", { class: "insp-bm-b" }, vals[2]));
    const r = el.getBoundingClientRect();
    const pad = side("padding-*"), bor = side("border-*-width");
    const pf = (a) => a.map((x) => (x === "–" ? 0 : +x));
    const [pt, pr, pb, pl] = pf(pad), [bt, br, bb, bl] = pf(bor);
    const cw = Math.round((r.width - pl - pr - bl - br) * 10) / 10;
    const ch = Math.round((r.height - pt - pb - bt - bb) * 10) / 10;
    return layer("margin", side("margin-*"),
      layer("border", bor,
        layer("padding", pad,
          h("div", { class: "insp-bm-content" }, `${cw} × ${ch}`))));
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
  function render(el, { onSelect, onBack, showAll, onToggleAll }) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const copied = [];

    const crumbs = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      crumbs.unshift(n);
      if (n.matches("main, .nav, .footer")) break;
    }

    const groups = GROUPS.filter((g) => !g.when || g.when(cs, el)).map((g) => {
      const rows = g.props.map((p) => {
        let v = cs.getPropertyValue(p).trim();
        if (/^border-(top|right|bottom|left)$/.test(p) && parseFloat(v) === 0 && !showAll) return null;
        if (!showAll && isDefault(p, v)) return null;
        // Offsets only matter on positioned boxes, and 0 on a relative box does nothing
        if (!showAll && /^(top|right|bottom|left)$/.test(p) && (cs.position === "static" || (cs.position === "relative" && v === "0px"))) return null;
        if (p === "font-family") v = font(v);
        copied.push(`  ${p}: ${cs.getPropertyValue(p).trim()};`);
        return h("div", { class: "insp-row" }, h("span", { class: "insp-prop" }, p), valueNode(v));
      }).filter(Boolean);
      if (!rows.length) return null;
      return h("details", { class: "insp-group", open: true }, h("summary", {}, g.title), rows);
    });

    const rules = matchingRules(el);
    const inline = el.getAttribute("style");

    const copyBtn = h("button", { type: "button", class: "cms-btn small", onclick: async () => {
      const text = `${describe(el)} {\n${copied.join("\n")}\n}`;
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
        h("span", {}, `x ${Math.round(r.left + scrollX)}, y ${Math.round(r.top + scrollY)}`),
        el.children.length ? h("span", {}, `${el.children.length} inside`) : null),
      el.children.length ? h("div", { class: "insp-children" },
        [...el.children].slice(0, 12).map((c) => h("button", { type: "button", class: "insp-crumb", onclick: () => onSelect(c) }, describe(c)))) : null,
      h("details", { class: "insp-group", open: true }, h("summary", {}, "Box model"), boxModel(el, cs)),
      h("label", { class: "cms-toggle insp-all" },
        h("span", {}, "Show all properties"),
        h("input", { type: "checkbox", role: "switch", checked: showAll, onchange: (e) => onToggleAll(e.target.checked) }),
        h("i", { "aria-hidden": "true" })),
      groups,
      h("details", { class: "insp-group", open: true },
        h("summary", {}, `CSS rules (${rules.length + (inline ? 1 : 0)})`),
        h("p", { class: "insp-hint" }, "From styles.css. Top rules win when two set the same thing."),
        inline ? h("div", { class: "insp-rule" }, h("div", { class: "insp-sel" }, "style attribute (set by script)"),
          declList(el.style)) : null,
        rules.map((rule) => h("div", { class: "insp-rule" },
          rule.media ? h("div", { class: "insp-media" }, rule.media) : null,
          h("div", { class: "insp-sel" }, rule.selector + " {"),
          declList(rule.style),
          h("div", { class: "insp-sel" }, "}"))),
        !rules.length && !inline ? h("p", { class: "insp-hint" }, "No rules target this element directly; it uses inherited and default styles.") : null));
  }

  return { render, describe };
})();
