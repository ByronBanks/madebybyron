# made by byron

Portfolio site, live at https://bmbc-digital.co.uk/MadeByByron/Website/

## How it works

- Plain HTML/CSS/JS, no build step.
- All words and images live in `content.json`; uploaded images go in `images/uploads/`.
- Every change to `main` is uploaded to the server by `.github/workflows/deploy.yml`.

## Editing

- **On the site:** click **Sign in**, paste your GitHub token, edit in the left sidebar, then **Publish**.
  The editor commits to this repo and the site updates about a minute later.
- **On GitHub:** edit any file here (e.g. `content.json`) and commit to `main`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Site design |
| `script.js` | Draws the page from `content.json` |
| `content.json` | All text, projects and image paths |
| `cms.js`, `cms.css` | Sign-in and sidebar editor |
| `inspector.js` | Click-to-inspect panel (Show outlines → click any box) |
| `store.js` | Loads/saves content (GitHub API) |
| `cms-config.js` | Which GitHub repo the editor saves to |
