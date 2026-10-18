/*
  Where content, sign-in and images are kept. The rest of the site talks only to `Store`.

  SERVER MODE (CMS_CONFIG.api set and the server is set up): sign in with your own
  password. The GitHub token stays on the server (api/cms.php), which loads content
  and publishes for you.

  GITHUB MODE (fallback while the server isn't set up): sign in with a GitHub access
  token kept in this browser. Save commits straight to the repo.

  PREVIEW MODE (no repo set): edits are kept in this browser only (IndexedDB).
*/
const Store = (() => {
  const cfg = window.CMS_CONFIG || {};
  const repo = (cfg.repo || "").trim();
  const branch = cfg.branch || "main";
  let mode = repo ? "github" : "preview";
  let session = { configured: false, hasPassword: false, signedIn: false, email: null };

  /* ---------- Server (api/cms.php) ---------- */
  async function call(action, body) {
    let r;
    try {
      r = await fetch(`${cfg.api}?action=${action}`, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json", "X-CMS": "1" } : { "X-CMS": "1" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error("Couldn't reach the editor server. Check your connection."); }
    let data;
    try { data = await r.json(); } catch (e) { throw Object.assign(new Error("The editor server didn't answer properly."), { status: r.status }); }
    if (!r.ok || data?.error) throw Object.assign(new Error(data?.error || `Error ${r.status}`), { status: r.status });
    return data;
  }

  // Find out (once) whether the server is set up; until then the GitHub-token mode stays available
  let initPromise = null;
  function init() {
    return (initPromise ??= (async () => {
      if (!cfg.api) return;
      try {
        session = await call("session");
        if (session.configured) {
          mode = "server";
          token = null;
          try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} // the old browser-stored token is no longer needed
        }
      } catch (e) { /* no PHP here (e.g. a local preview) */ }
    })());
  }
  const TOKEN_KEY = "mbb-github-token";
  const SESSION_KEY = "cms-signed-in";

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}

  /* ---------- Shared helpers ---------- */
  async function fetchPublished() {
    const r = await fetch("content.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Couldn't load content.json");
    return r.json();
  }

  // Shrink uploads so they're quick to load and light in the repo
  // SVGs are kept as vector files, with anything that could run code removed
  // (scripts, event handlers, javascript: links, embedded HTML)
  async function cleanSvg(file) {
    const doc = new DOMParser().parseFromString(await file.text(), "image/svg+xml");
    if (doc.querySelector("parsererror") || doc.documentElement.nodeName.toLowerCase() !== "svg") throw new Error("That SVG file couldn't be read.");
    doc.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((el) => el.remove());
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && !value.startsWith("#") && !value.startsWith("data:image/"))) el.removeAttribute(attr.name);
      }
    }
    const text = new XMLSerializer().serializeToString(doc);
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(text)));
  }

  async function resizeImage(file, max = 1800, quality = 0.85) {
    if (file.type === "image/svg+xml") return cleanSvg(file);
    if (file.type === "image/gif") {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
    }
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    // PNG and WebP keep their transparency (logos); photos become JPEG
    const out = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
    return canvas.toDataURL(out, quality);
  }

  /* ---------- GitHub ---------- */
  async function gh(path, { method = "GET", body, raw = false } = {}) {
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const e = new Error(err.message || `GitHub error ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return raw ? r.text() : r.json();
  }

  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

  // Swap embedded (newly uploaded) images for files in images/uploads/
  async function extractImages(content) {
    const files = new Map();
    async function walk(node) {
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === "object") await walk(v);
        else if (typeof v === "string" && v.startsWith("data:image/")) {
          const m = v.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/);
          if (!m || !EXT[m[1]]) throw new Error("Unsupported image type — use JPG, PNG, GIF or WebP.");
          const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
          const path = `images/uploads/${hash}.${EXT[m[1]]}`;
          files.set(path, m[2]);
          node[k] = path;
        }
      }
    }
    await walk(content);
    return files;
  }

  async function commitToGitHub(content) {
    const copy = structuredClone(content);
    const images = await extractImages(copy);

    const ref = await gh(`/git/ref/heads/${branch}`);
    const parent = await gh(`/git/commits/${ref.object.sha}`);

    const tree = [];
    for (const [path, base64] of images) {
      const blob = await gh("/git/blobs", { method: "POST", body: { content: base64, encoding: "base64" } });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const json = await gh("/git/blobs", { method: "POST", body: { content: JSON.stringify(copy, null, 2) + "\n", encoding: "utf-8" } });
    tree.push({ path: "content.json", mode: "100644", type: "blob", sha: json.sha });

    const newTree = await gh("/git/trees", { method: "POST", body: { base_tree: parent.tree.sha, tree } });
    const commit = await gh("/git/commits", {
      method: "POST",
      body: { message: "Update site content (via editor)", tree: newTree.sha, parents: [ref.object.sha] },
    });
    try {
      await gh(`/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha } });
    } catch (e) {
      if (e.status === 422) throw new Error("The site was changed on GitHub since you opened the editor. Reload the page and try again.");
      throw e;
    }
  }

  /* ---------- Preview (browser-only) ---------- */
  function idb(modeRW, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("made-by-byron-cms", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const t = req.result.transaction("kv", modeRW);
        const op = fn(t.objectStore("kv"));
        t.oncomplete = () => resolve(op && op.result);
        t.onerror = t.onabort = () => reject(t.error);
      };
    });
  }

  /* ---------- Public API ---------- */
  return {
    get mode() { return mode; },
    repo,
    branch,
    init,

    // Visitors get the published file; a signed-in editor gets the latest version from GitHub
    async loadContent() {
      await init();
      if (mode === "server" && session.signedIn) {
        try { return await call("content"); }
        catch (e) { console.warn("Couldn't load from the server, using published content", e); }
      }
      if (mode === "github" && token) {
        try { return JSON.parse(await gh(`/contents/content.json?ref=${branch}`, { raw: true })); }
        catch (e) { console.warn("Couldn't load from GitHub, using published content", e); }
      }
      if (mode === "preview") {
        try { const saved = await idb("readonly", (s) => s.get("content")); if (saved) return saved; }
        catch (e) { console.warn("Couldn't read browser-saved content", e); }
      }
      return fetchPublished();
    },

    async saveContent(content) {
      if (mode === "server") return call("publish", content);
      if (mode === "github") return commitToGitHub(content);
      return idb("readwrite", (s) => s.put(structuredClone(content), "content"));
    },

    isSignedIn() {
      if (mode === "server") return !!session.signedIn;
      if (mode === "github") return !!token;
      try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; }
    },

    async signIn(secret) {
      if (mode === "server") {
        await call("login", { password: secret || "" });
        session.signedIn = true;
        return;
      }
      const newToken = secret;
      if (mode === "github") {
        token = (newToken || "").trim();
        try {
          const info = await gh("");
          if (!info.permissions?.push) throw new Error("That token can't save to this repository.");
        } catch (e) {
          token = null;
          throw e.status === 401 ? new Error("GitHub didn't accept that token.") : e.status === 404 ? new Error(`Can't find the repository “${repo}” with that token.`) : e;
        }
        try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
        return;
      }
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
    },

    async signOut() {
      if (mode === "server") { try { await call("logout", {}); } catch (e) {} session.signedIn = false; return; }
      token = null;
      try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    },

    uploadImage: (file) => resizeImage(file),

    // Password set-up and reset (server mode)
    hasPassword: () => !!session.hasPassword,
    resetEmail: () => session.email,
    requestReset: () => call("requestReset", {}),
    async resetPassword({ resetToken, githubToken, password }) {
      await call("reset", { resetToken, githubToken, password });
      session.signedIn = true;
      session.hasPassword = true;
    },
    changePassword: (current, password) => call("changePassword", { current, password }),
  };
})();
