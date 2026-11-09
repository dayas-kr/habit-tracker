# Habit tracker: static site for GitHub Pages

No build step, no server, no database. Tailwind, Alpine (+ persist, focus, sort), dayjs and the font load from jsDelivr CDN (versions pinned in `index.html`). Data lives in the visitor's browser (localStorage).

## Files
```
index.html        page + CSS "components" (.btn, .input, .card, .dialog-*) + icon sprite
js/config.js      debug flag, service worker path
js/store.js       toasts + tracker store (Alpine $persist)
js/components.js  page, progress chart, reusable dialog
sw.js             service worker (shows notifications on mobile)
.nojekyll         tells GitHub Pages to serve files as-is
```

## Deploy
1. Push these files to a GitHub repo (root of `main`).
2. Repo -> Settings -> Pages -> Source: "Deploy from a branch" -> `main` / `(root)`.
3. Open `https://<user>.github.io/<repo>/`.

## Testing dates (debug panel)
Open `js/config.js`, set `debug: true`, serve locally (`python3 -m http.server`, then http://localhost:8000). Set it back to `false` before you push. A static site cannot truly hide the panel's code, but with `debug: false` it is never rendered and simulated dates are ignored.

## Notes
- Notifications need https (GitHub Pages has it) or localhost, and only fire while the page is open in a tab.
- Data is per browser/device and is not synced.
