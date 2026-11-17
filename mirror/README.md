# Single-file loader (mirror hosts)

The mirror hosts (`phantom.gt.tc`, `phantom.fwh.is`, `phantom.66ghz.com`,
`phantom.nfy.fyi`) no longer need the whole site uploaded to each of them.
Each one holds **one file** — `index.html`, a copy of `mirror/index.html` — and
that file fetches the requested page from the frontend repo every time.

## One-time setup per host

1. Push this folder to the frontend repo (for example
   `https://github.com/<owner>/<repo>`, branch `main`).
2. Open `mirror/index.html` and set `REPO` near the top to the repo's CDN base:

   ```
   https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/
   ```

   (jsDelivr caches a branch for up to about 12 hours; if you need a push to be
   live immediately, use `https://raw.githubusercontent.com/<owner>/<repo>/main/`
   instead.)
3. Upload **`mirror/index.html`** to the host as `index.html`.
4. Upload **`.htaccess`** (already in this repo). Its *single-file loader* block
   sends every page the host does not hold to `index.html`; real files still
   take precedence, so an existing upload keeps working until it is removed.

After that, nothing is uploaded to the hosts again — push to the repo and every
mirror serves the new code.

## Why the pages stay on the mirror's domain

The loader writes the fetched page into its own document, so the address bar
keeps the mirror's domain. That matters:

- `localStorage` is per domain. Local accounts, bookmarks and playtime stay on
  the domain the player is on, so **no existing data moves or is lost**.
- Cookies, the Supabase redirect URL and the `#phantom-sso` handoff keep
  working, because the origin never changes.
- Resource URLs (`<script>`, `<link>`, images) are rewritten to the repo, while
  `<a href>` and script redirects stay relative — so the next page comes back
  through this loader and is served here too.

## Adding or removing a mirror

Edit `sites.json` in the repo and push. The Sites tab reads it on every open and
probes each host, so the list is never a hardcoded claim about the network. The
four hosts currently in the file are also the loader's built-in fallback, used
when `sites.json` cannot be fetched.

## Testing locally

Serve the repo on one port (the loader's "repo"), then a folder holding only the
loader on another, mapping every unknown path to it:

```
node .freebuff/preview-server.js 5510
node .freebuff/loader-test-server.js 5511
```

Open `http://127.0.0.1:5511/` and `http://127.0.0.1:5511/login.html`.
