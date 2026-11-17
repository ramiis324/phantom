# Cloudflare Worker proxy (`rcdn-proxy`)

HTTPS reverse proxy used by the site. The site (and its GitHub Pages CDNs) are
served over HTTPS, so anything the games load through a plain-HTTP proxy is
blocked by the browser as **mixed content** (that's why the games went blank
when routed through `138.2.220.41:3000`). This Worker serves the games and
tunnels their WebSockets over HTTPS instead, so the `.io` multiplayer games
load and connect even on a network that blocks the game publishers.

- **HTML/CSS/JS/JSON** are rewritten on the fly so sub-resources on the
  allowlisted hosts also resolve through the proxy.
- **WebSockets** (`/proxy/wss://...` and bare-path upgrades like
  `/socket.io/?...`) are tunneled to the real game host so the sockets work.
- Requests get a synthesized `Origin`/`Referer`/`Sec-Fetch-*` matching the
  target so game servers don't 403 the proxy's cross-origin calls.
- Allowed hosts are the `ALLOWED_HOSTS` list at the top of `worker.js`.

## Deploy

Requires Node.js and a Cloudflare account (the free plan is fine).

1. Install wrangler (once): `npm i -g wrangler`
2. Log in (once): `wrangler login`
3. Deploy from this folder:

   ```
   wrangler deploy
   ```

4. You'll get a URL like `https://rcdn-proxy.<your-subdomain>.workers.dev`.
   **Copy it** — it must be the base URL in `cdn.js`:

   `cdn.js` in the repo root currently has:

   ```js
   const GAME_PROXY = "https://rcdn-proxy.<ACCOUNT>.workers.dev";
   ```

   Replace `<ACCOUNT>` with the real subdomain and commit. The multiplayer
   game launchers read `GAME_PROXY` from `../../cdn.js`, so they start routing
   through the Worker as soon as the new `cdn.js` is live on GitHub Pages.

## Test

After deploying, these should load in a browser:

```
https://<URL>/proxy/https://krunker.io/
https://<URL>/proxy/https://skribbl.io/
https://<URL>/proxy/https://territorial.io/
```

The game page (e.g. `https://<URL>/proxy/https://skribbl.io/`) should show the
game and its socket (`wss://<URL>/proxy/wss://skribbl.io/...`) should connect.