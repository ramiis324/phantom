/**
 * RCDN Proxy — Node.js reverse proxy server
 * Same logic as the Cloudflare Worker, runs on any VPS / Oracle free tier / local machine.
 *
 * Usage:
 *   PORT=3000 node server.js
 *   node server.js --port 3000 --target https://www.youtube.com
 *
 * URL scheme (identical to the worker):
 *   <server>/proxy/https://<host>/<path>
 */

import express from "express";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ================================================================
 * CONFIG
 * ================================================================ */

const DEFAULT_TARGET =
  process.argv.includes("--target")
    ? process.argv[process.argv.indexOf("--target") + 1]
    : process.env.DEFAULT_TARGET || "https://www.youtube.com";

const PORT = (() => {
  const pi = process.argv.indexOf("--port");
  return pi >= 0 ? Number(process.argv[pi + 1]) : Number(process.env.PORT || 3000);
})();

const BASE_URL = process.env.BASE_URL || ""; // e.g. "https://proxy.example.com"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const ALLOWED_HOSTS = [
  "tiktok.com",
  "www.tiktok.com",
  "api.tiktok.com",
  "m.tiktok.com",
  "im-api.tiktok.com",
  "im-ws.tiktok.com",
  "v16-web.tiktok.com",
  "v19-web.tiktok.com",
  "v29-web.tiktok.com",
  "webcast.tiktok.com",
  "www.tiktok.co",
  "tiktokcdn.com",
  "www.tiktokcdn.com",
  "tiktokcdn-eu.com",
  "tiktokcdn-us.com",
  "tiktokcdn-in.com",
  "tiktokcdn-tw.com",
  "tiktokcdn-ap.com",
  "tiktokcdn-jp.com",
  "ibyteimg.com",
  "byteimg.com",
  "douyinpic.com",
  "bytecdntp.com",
  "snssdk.net",
  "sf16-website-login.neutral.ttwstatic.com",
  "sf16-website-login.neutral.tiktokcdn-eu.com",
  "sf16-scmcdn-sg.ibytedos.com",
  "sf-i18n-resources.tiktokcdn.com",
  "p16-sign-va.tiktokcdn.com",
  "p16-common-sign.tiktokcdn-eu.com",
  "dm-event-log-service.byteoversea.com",
  "byteoversea.com",
  "tiktokw.eu",
  "tiktokv.eu",
  "tiktokv.com",
  "tiktok.us",
  "ttwstatic.com",
  "ibytedos.com",
  "ibytedtos.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  "gstatic.com",
  "youtu.be",
  "google.com",
  "www.google.com",
  "accounts.google.com",
  "reddit.com",
  "redditstatic.com",
  "redditmedia.com",
  "redd.it",
  "instagram.com",
  "www.instagram.com",
  "cdninstagram.com",
  "fbcdn.net",
  "facebook.com",
  "facebook.net",
  "snapchat.com",
  "www.snapchat.com",
  "accounts.snapchat.com",
  "story.snapchat.com",
  "gcp.api.snapchat.com",
  "sc-corp.net",
  "mesh.sc-corp.net",
  "sc-static.net",
  "sc-cdn.net",
  "cf-st.sc-cdn.net",
  "discord.com",
  "discordapp.com",
  "discord.gg",
  "x.com",
  "twitter.com",
  "twimg.com",
  "t.co",
  // .io multiplayer games (routed through the proxy so they work at school)
  "hexanaut.io",
  "krunker.io",
  "play.krunker.io",
  "powerline.io",
  "shellshock.io",
  "www.shellshock.io",
  "skribbl.io",
  "zombsroyale.io",
  "territorial.io",
  "paper-io.com",
];

const SKIP_ATTRS = ["#", "data:", "mailto:", "tel:", "javascript:", "about:", "blob:", "ws://", "wss://"];

const STRIP_REQ_HEADERS = [
  "host", "origin", "referer", "cf-connecting-ip", "cf-ipcountry", "cf-ray",
  "cf-visitor", "cf-worker", "cf-cache-status", "x-forwarded-proto",
  "x-forwarded-for", "x-real-ip", "accept-encoding", "content-length",
];

const STRIP_RES_HEADERS = [
  "content-security-policy", "content-security-policy-report-only",
  "x-frame-options", "strict-transport-security", "report-to", "nel", "content-length",
];

const COOKIE_PREFIX = "__rcdn_";

/* ================================================================
 * HELPERS
 * ================================================================ */

function isAllowedHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  for (const allowed of ALLOWED_HOSTS) {
    if (h === allowed || h.endsWith("." + allowed)) return true;
  }
  return false;
}

function proxyUrl(proxyOrigin, targetUrl) {
  let t = targetUrl.toString();
  if (!/^https?:/.test(t)) t = "https://" + t;
  return proxyOrigin + "/proxy/" + t;
}

function rewriteAttr(u, base, proxyOrigin) {
  if (!u) return u;
  const t = u.trim();
  for (const s of SKIP_ATTRS) if (t.startsWith(s)) return u;
  if (t.startsWith(proxyOrigin)) return u;
  try {
    const abs = new URL(t, base).toString();
    return proxyUrl(proxyOrigin, abs);
  } catch (e) {
    return u;
  }
}

function rewriteHostRefs(text, proxyOrigin) {
  const proxyPrefix = proxyOrigin + "/proxy/";
  const escPrefix = proxyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hosts = ALLOWED_HOSTS.slice().sort((a, b) => b.length - a.length);
  for (const host of hosts) {
    const esc = host.replace(/\./g, "\\.");
    text = text.replace(
      new RegExp(`(?<!${escPrefix})https?:\\/\\/${esc}(?![\\w.-])`, "g"),
      proxyOrigin + "/proxy/https://" + host
    );
    text = text.replace(
      new RegExp(`(?<!${escPrefix})(?<!:)\\/\\/${esc}(?![\\w.-])`, "g"),
      proxyOrigin + "/proxy/https://" + host
    );
  }
  return text;
}

function interceptorScript(proxyOrigin, targetOrigin) {
  const hosts = JSON.stringify(ALLOWED_HOSTS);
  return `<script data-rcdn-probe>/* rcdn interceptor v4 */
(function(){
  if (window.__rcdnP) return;
  window.__rcdnP = true;
  var PROXY = ${JSON.stringify(proxyOrigin)};
  var TARGET = ${JSON.stringify(targetOrigin)};
  var HOSTS = ${hosts};
  var WS_PROXY = PROXY.replace(/^http/, 'ws');
  // Capture the real page protocol/host NOW, because we later redefine
  // window.location to expose the target-relative URL to the SPA. The
  // interceptor's own rewriting must keep using the real proxy values.
  var REAL_PROTO = location.protocol;
  var REAL_HOST = location.host;
  function isAllowed(h){
    if (!h) return false;
    h = h.toLowerCase();
    for (var i = 0; i < HOSTS.length; i++) {
      if (h === HOSTS[i] || h.slice(-HOSTS[i].length - 1) === '.' + HOSTS[i]) return true;
    }
    return false;
  }
  function isSkip(u){ return !u || u.indexOf('#')===0 || u.indexOf('data:')===0 || u.indexOf('blob:')===0 || u.indexOf('javascript:')===0 || u.indexOf('about:')===0; }
  // Neutralize TikTok's Slardar telemetry singleton. When TikTok can't fully
  // init its SDK behind a proxy, it leaves an internal "_instance" undefined,
  // then D.context()/D.config()/D.mountBeforeSendEvent() throw
  // "this._instance is not a function" and crash the React root. Providing a
  // safe global stub early lets those calls become no-ops.
  function slardarStub(){ return slardarStub; }
  ['config','context','start','stop','send','report','event','error','log','info','warn','debug','setUser','setAid','register','mountBeforeSendEvent','useCustomPageId','useOffscreenPageId','pageShow','pageHide','reportCustomEvent','on','off','addErrorListener','removeErrorListener','addStartListener','setConfig','withSuffix'].forEach(function(m){
    slardarStub[m] = function(){ return slardarStub; };
  });
  try {
    var _sd = window.Slardar;
    var defined = false;
    Object.defineProperty(window, 'Slardar', {
      configurable: true,
      get: function(){ return _sd && _sd._instance ? _sd : slardarStub; },
      set: function(v){ _sd = (v && typeof v === 'object') ? v : slardarStub; }
    });
    if (window.__rcdn_slardar) window.__rcdn_slardar = slardarStub;
  } catch(e){}
  if (window.addEventListener) {
    window.addEventListener('error', function(ev){
      if (ev && ev.error && /_instance is not a function/.test(String(ev.error && ev.error.message || ''))) {
        ev.preventDefault(); ev.stopPropagation();
      }
    }, true);
  }
  function toAbs(u){
    if (u.indexOf('//')===0) u = REAL_PROTO + u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    return new URL(u, TARGET).toString();
  }
  function rewrite(u){
    if (isSkip(u)) return u;
    try {
      var abs = toAbs(u);
      // Already pointing at our proxy origin directly. Return unchanged so we
      // never double-prefix /proxy/.
      if (abs.indexOf(PROXY) === 0) {
        return abs;
      }
      // Already pointing at our proxy origin (same host). Our server is plain
      // http, but apps often build absolute https:// URLs to the same host,
      // which would hit https://<proxy>:3000 and fail with an SSL error.
      // Coerce the scheme to match the page so same-origin SPA fetches work.
      if (abs.indexOf('//' + REAL_HOST) >= 0) {
        if (REAL_PROTO === 'http:' && /^https:/.test(abs)) {
          abs = abs.replace(/^https:/, 'http:');
        }
        return abs;
      }
      var cut = abs.indexOf('://');
      var rest = cut >= 0 ? abs.slice(cut + 3) : abs;
      var host = rest.split('/')[0].split(':')[0];
      if (!isAllowed(host)) return u;
      return PROXY + '/proxy/' + abs;
    } catch(e){ return u; }
  }
  // ---- WebSocket tunneling ----
  // Games (Krunker, Zombs Royale, Powerline, Hexanaut, Skribbl, Shell
  // Shockers) open sockets to their publisher's host, which a school network
  // blocks. Rewrite new WebSocket(...) calls so the socket starts at our
  // proxy instead; the server tunnels the Upgrade to the real target.
  function rewriteWs(u){
    try {
      var abs;
      if (typeof u !== 'string' || !u) return u;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) {
        abs = new URL(u, location.href).toString();
      } else {
        abs = u;
      }
      if (abs.indexOf('http:') === 0) abs = 'ws:' + abs.slice(5);
      if (abs.indexOf('https:') === 0) abs = 'wss:' + abs.slice(6);
      // Already on our proxy / same origin: leave alone.
      if (abs.indexOf(WS_PROXY) === 0) return abs;
      if (abs.indexOf(location.origin) === 0) return abs;
      var cut = abs.indexOf('://');
      var rest = cut >= 0 ? abs.slice(cut + 3) : abs;
      var host = rest.split('/')[0].split(':')[0];
      if (!isAllowed(host)) return u;
      return WS_PROXY + '/proxy/' + abs;
    } catch(e){ return u; }
  }
  var OWS = window.WebSocket;
  if (OWS) {
    window.WebSocket = function(url, protocols){
      url = rewriteWs(url);
      return protocols ? new OWS(url, protocols) : new OWS(url);
    };
    window.WebSocket.prototype = OWS.prototype;
    window.WebSocket.CONNECTING = OWS.CONNECTING;
    window.WebSocket.OPEN = OWS.OPEN;
    window.WebSocket.CLOSING = OWS.CLOSING;
    window.WebSocket.CLOSED = OWS.CLOSED;
  }
  var of = window.fetch;
  if (of) window.fetch = function(input, init){
    if (typeof input === 'string') input = rewrite(input);
    else if (input instanceof Request){ var r = rewrite(input.url); if (r !== input.url) input = new Request(r, input); }
    return of.call(this, input, init);
  };
  var ox = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(){
    if (typeof arguments[1] === 'string') arguments[1] = rewrite(arguments[1]);
    return ox.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    var sb = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data){ return sb(rewrite(url), data); };
  }
  var assign = location.assign, repl = location.replace;
  if (assign) location.assign = function(u){ return assign.call(location, rewrite(u)); };
  if (repl) location.replace = function(u){ return repl.call(location, rewrite(u)); };
  try { Object.defineProperty(window, 'location', { get: function(){ return document.location; }, configurable:true }); } catch(e){}

  ['pushState','replaceState'].forEach(function(k){
    var o = history[k];
    if (o) history[k] = function(state, title, url){
      if (typeof url === 'string') url = rewrite(url);
      var r = o.apply(this, arguments);
      notifyNav();
      return r;
    };
  });
  var ow = window.open;
  if (ow) window.open = function(u){ if (typeof u === 'string') u = rewrite(u); return ow.apply(this, arguments); };
  function notifyNav(){
    try { window.parent.postMessage({ type:'rcdn-nav', url: location.href }, '*'); } catch(e){}
  }
  window.addEventListener('DOMContentLoaded', notifyNav);
  window.addEventListener('load', notifyNav);
  window.addEventListener('popstate', notifyNav);
  setTimeout(notifyNav, 1500);
  var lastUrl = location.href;
  setInterval(function(){ if (location.href !== lastUrl){ lastUrl = location.href; notifyNav(); } }, 500);
})();
</script>`;
}

function parseCookie(req) {
  return (req.headers.cookie || "").split(";").map((c) => c.trim());
}

function sessionTarget(req) {
  const ck = parseCookie(req).find((c) => c.startsWith(COOKIE_PREFIX + "target="));
  if (ck) {
    try {
      const v = decodeURIComponent(ck.slice((COOKIE_PREFIX + "target=").length));
      if (/^https?:\/\//.test(v)) return v;
    } catch (e) { /* fall through */ }
  }
  return DEFAULT_TARGET;
}

function proxyOrigin(req) {
  return (BASE_URL || `${req.protocol}://${req.get("host")}`);
}

/* ================================================================
 * PROXY HANDLER
 * ================================================================ */

async function handleProxy(req, res, targetUrl) {
  const origin = proxyOrigin(req);

  const reqHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQ_HEADERS.includes(k) && !k.startsWith("cf-")) {
      reqHeaders[k] = v;
    }
  }
  reqHeaders["user-agent"] = UA;
  reqHeaders["accept-encoding"] = "identity"; // force uncompressed to avoid decoding issues

  // Synthesize an origin / referer that MATCHES the target so the site's
  // CSRF and bot checks see a legitimate same-site request. The browser's real
  // origin is our proxy (`http://<proxy>`), which upstream would reject.
  const targetOrigin = targetUrl.origin;
  const isPost = !["GET", "HEAD"].includes(req.method);
  if (isPost || /^\/(api|ajax|graphql|v1|sdk)/.test(targetUrl.pathname)) {
    reqHeaders["origin"] = targetOrigin;
  }
  const refererPath = targetUrl.pathname || "/";
  reqHeaders["referer"] = targetOrigin + (refererPath.startsWith("/") ? refererPath : "/" + refererPath);
  // Mark proxied navigation as same-origin relative to the target so
  // fetch-metadata policies (Sec-Fetch-*) don't treat it as cross-site.
  reqHeaders["sec-fetch-site"] = reqHeaders["sec-fetch-site"] ?? "same-origin";
  reqHeaders["sec-fetch-mode"] = reqHeaders["sec-fetch-mode"] ?? (isPost ? "cors" : "navigate");
  reqHeaders["x-requested-with"] = reqHeaders["x-requested-with"] ?? "XMLHttpRequest";

  const filteredCookie = parseCookie(req)
    .filter((c) => c.startsWith(COOKIE_PREFIX))
    .map((c) => c.slice(COOKIE_PREFIX.length))
    .join("; ");
  if (filteredCookie) reqHeaders["cookie"] = filteredCookie;
  else delete reqHeaders["cookie"];

  let upstream;
  try {
    const hasBody = !["GET", "HEAD"].includes(req.method);
    upstream = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: reqHeaders,
      redirect: "manual",
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
    });
  } catch (e) {
    res.status(502).send("Upstream fetch failed: " + e.message);
    return;
  }

  const resHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RES_HEADERS.includes(k) && !k.startsWith("cf-")) {
      resHeaders[k] = v;
    }
  });
  resHeaders["access-control-allow-origin"] = "*";
  resHeaders["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  resHeaders["access-control-allow-headers"] = "*";
  resHeaders["cache-control"] = "no-store, no-cache, must-revalidate, max-age=0";
  delete resHeaders["expires"];
  delete resHeaders["age"];
  delete resHeaders["etag"];
  delete resHeaders["last-modified"];
  delete resHeaders["content-encoding"]; // we serve uncompressed

  // Rewrite Set-Cookie into proxy namespace
  const setCookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
  const rewrittenCookies = setCookies.map((sc) =>
    sc.replace(/;\s*Domain=[^;]*/gi, "")
      .replace(/;\s*Path=[^;]*/gi, "")
      .replace(/^\s*([^=;]+)=/, COOKIE_PREFIX + "$1=") + "; Path=/"
  );
  // Add session target cookie
  rewrittenCookies.push(
    COOKIE_PREFIX + "target=" + encodeURIComponent(targetUrl.origin) + "; Path=/; SameSite=Lax; Max-Age=21600"
  );
  res.setHeader("Set-Cookie", rewrittenCookies);
  // Remove from resHeaders so .set(resHeaders) doesn't overwrite our rewrite
  delete resHeaders["set-cookie"];

  // Rewrite redirect Location
  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const loc = upstream.headers.get("location");
    let newLoc = origin + "/";
    if (loc) {
      try {
        let absLoc = new URL(loc, targetUrl.toString()).toString();
        // If the upstream already points us at our own proxy (double-proxy),
        // strip nesting and keep a single layer.
        if (absLoc.indexOf(origin) === 0) {
          const inner = absLoc.replace(/^https?:\/\/[^/]+\/proxy\//i, "");
          try { absLoc = new URL(inner).toString(); } catch (e) { absLoc = inner; }
        }
        newLoc = proxyUrl(origin, absLoc);
      } catch (e) { newLoc = origin + "/"; }
    }
    resHeaders["location"] = newLoc;
    res.status(upstream.status).set(resHeaders).end();
    return;
  }

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  const base = targetUrl.origin;

  const isHtml = ct.includes("text/html");
  const isCss = ct.includes("text/css") || ct.includes("css");
  const isText =
    !isHtml && !isCss &&
    (ct.includes("javascript") || ct.includes("text/") ||
     ct.includes("application/json") || ct.includes("application/xml") ||
     ct.includes("application/javascript"));

  res.status(upstream.status).set(resHeaders);

  // Stream everything we do NOT need to rewrite (JS, JSON, API, images,
  // video, binary) straight through. Buffering whole bodies on the 945MB
  // free-tier box is what caused OOM hangs. The interceptor rewrites URLs at
  // runtime in the browser, so we only rewrite HTML (inject + host refs) and
  // CSS (url() refs) here.
  if (!isHtml && !isCss) {
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
    return;
  }

  let text = await upstream.text();

  if (isHtml) {
    text = rewriteHostRefs(text, origin);
    text = text.replace(/<base\b[^>]*>/gi, "");
    // We rewrite resource URLs and buffer CSS, so Subresource Integrity hashes
    // never match what we serve. Strip integrity + crossorigin so the browser
    // doesn't reject proxied scripts/styles.
    text = text.replace(/\s+integrity="[^"]*"/gi, "");
    text = text.replace(/\s+crossorigin="[^"]*"/gi, "");
    text = text.replace(
      /<head([^>]*)>/i,
      (m, attrs) => `<head${attrs}>${interceptorScript(origin, targetUrl.origin)}`
    );
    res.send(text);
    return;
  }

  // CSS
  text = text
    .replace(/url\((['"]?)([^)'"]+)\1\)/gi, (m, q, u) => `url('${rewriteAttr(u, base, origin)}')`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${rewriteAttr(u, base, origin)}${q}`);
  res.send(text);
}

/* ================================================================
 * EXPRESS APP
 * ================================================================ */

const app = express();
app.disable("x-powered-by");

// CORS preflight
app.options("*", (_req, res) => {
  res.status(204).set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
  }).end();
});

// robots.txt
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

// Serve the proxy browser UI
const appsDir = resolve(__dirname, "..", "apps");
app.use("/apps", express.static(appsDir));

// Root: serve the proxy browser UI directly
app.get("/", (_req, res) => {
  res.sendFile(resolve(appsDir, "index.html"));
});

// Simple in-flight concurrency guard. The free-tier box has ~945MB RAM; a flood
// of parallel buffered upstream fetches is what previously OOM-hung it. Cap
// concurrent proxied requests and shed excess load with 503 + Retry-After.
const MAX_IN_FLIGHT = 24;
let inFlight = 0;
const waiters = [];
function acquire() {
  return new Promise((resolve) => {
    if (inFlight < MAX_IN_FLIGHT) { inFlight++; resolve(); }
    else waiters.push(resolve);
  });
}
function release() { inFlight--; const w = waiters.shift(); if (w) w(); }

async function gatedProxy(req, res, targetUrl) {
  try {
    await Promise.race([
      acquire(),
      new Promise((_, rej) => {
        res.on("close", () => rej(new Error("client closed")));
      }),
    ]);
  } catch (e) {
    if (!res.headersSent) res.status(503).set({ "Retry-After": "1" }).send("Server busy, retry shortly");
    return;
  }
  try {
    await handleProxy(req, res, targetUrl);
  } finally {
    release();
  }
}

// Proxy catch-all
app.all("/proxy/*", async (req, res) => {
  const origin = proxyOrigin(req);
  const raw = req.params[0] + (req.originalUrl.includes("?") ? "?" + req.originalUrl.split("?")[1] : "");

  // Path-only delegation (no host in the URL)
  if (!/^https?:\/\//.test(raw) && !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) {
    const base = new URL(sessionTarget(req));
    const delegated = new URL("/" + raw, base.origin);
    if (!isAllowedHost(delegated.hostname)) {
      return res.status(403).send("Host not allowed: " + delegated.hostname);
    }
    return gatedProxy(req, res, delegated);
  }

  let targetUrl;
  // Detect a double-proxied URL (e.g. .../snapchat.com/proxy/https://snapchat.com/...)
  // which some SPAs build from the current proxied path. Normalize to the real
  // inner target so we don't forward nonsense to the upstream.
  {
    const m2 = raw.match(/^https?:\/\/[^/]+\/proxy\/https?:\/\/.*/i);
    if (m2) {
      const inner = raw.replace(/^https?:\/\/[^/]+\/proxy\//i, "");
      try {
        targetUrl = new URL(inner);
      } catch (e2) {
        targetUrl = null;
      }
    }
  }
  if (!targetUrl) {
    try {
      targetUrl = new URL(/^https?:\/\//.test(raw) ? raw : "https://" + raw);
    } catch (e) {
      return res.status(400).send("Invalid proxy URL");
    }
  }
  if (!isAllowedHost(targetUrl.hostname)) {
    return res.status(403).send("This host is not allowed through the proxy: " + targetUrl.hostname);
  }
  if (targetUrl.hostname === new URL(origin).hostname) {
    return res.status(403).send("Proxy loop detected");
  }
  return gatedProxy(req, res, targetUrl);
});

// Bare path delegation (SPA routes like /watch, /404, /@user)
app.all("*", async (req, res) => {
  const origin = proxyOrigin(req);
  const path = req.originalUrl; // keep query string intact
  // Never re-delegate an already-proxied URL prefix. Some SPAs (e.g. X) build
  // URLs that start with "/proxy/..." relative to the page, which would land
  // here after a client-side nav and get wrongly double-proxied.
  if (/^\/proxy\//.test(path)) {
    const sub = path.replace(/^\/proxy\//, "");
    if (/^https?:/i.test(sub)) {
      try {
        const t = new URL(sub);
        if (isAllowedHost(t.hostname) && t.hostname !== new URL(origin).hostname) {
          return gatedProxy(req, res, t);
        }
      } catch (e) { /* fall through to normal delegation */ }
    }
    return res.status(400).send("Invalid proxy path");
  }
  const base = new URL(sessionTarget(req));
  const delegated = new URL(path, base.origin);
  if (!isAllowedHost(delegated.hostname)) {
    return res.status(403).send("Host not allowed: " + delegated.hostname);
  }
  return gatedProxy(req, res, delegated);
});

/* ================================================================
 * WEBSOCKET TUNNEL
 * Schemes handled on the Upgrade request:
 *   /proxy/wss://<host>/<path>       (absolute, from the interceptor)
 *   /proxy/ws://<host>/<path>
 *   /<path>                          (bare/relative, e.g. /socket.io/?EIO=…
 *      -> delegated to the session target host)
 * ================================================================ */

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket, status, msg) {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
  } catch (e) { /* socket already dead */ }
  socket.destroy();
}

httpServer.on("upgrade", (req, socket, head) => {
  const raw = req.url || "";
  let targetUrl = null;
  console.error("[ws] upgrade", raw, "from", req.headers.host);

  if (raw.startsWith("/proxy/")) {
    const sub = raw.slice("/proxy/".length);
    if (/^wss?:\/\//i.test(sub)) {
      try { targetUrl = new URL(sub); } catch (e) { /* fall through */ }
    }
  }

  if (!targetUrl) {
    // Bare-path upgrade: treat as relative to the session target, e.g.
    // ws://<proxy>/socket.io/?EIO=4&transport=websocket -> wss://<game>/
    const st = sessionTarget(req);
    try {
      const s = new URL(st);
      const proto = /^https:/.test(st) ? "wss" : "ws";
      targetUrl = new URL(raw.replace(/^\/+/, ""), `${proto}://${s.host}/`);
    } catch (e) { /* fall through */ }
  }

  if (!targetUrl) return rejectUpgrade(socket, 400, "Bad Request");
  if (!isAllowedHost(targetUrl.hostname)) return rejectUpgrade(socket, 403, "Forbidden");
  if (targetUrl.hostname === (req.headers.host || "").toLowerCase()) {
    return rejectUpgrade(socket, 403, "Forbidden");
  }

  const upScheme = /^wss:/.test(targetUrl.protocol) ? "wss:" : "ws:";
  const upUrl = upScheme + "//" + targetUrl.host + targetUrl.pathname + (targetUrl.search || "");

  const reqProtocols = (req.headers["sec-websocket-protocol"] || "")
    .split(",").map((p) => p.trim()).filter(Boolean);

  const upHeaders = {
    "user-agent": UA,
    origin: upScheme + "//" + targetUrl.host,
  };
  const upCookies = (req.headers.cookie || "").split(";").map((c) => c.trim())
    .filter((c) => c.startsWith(COOKIE_PREFIX))
    .map((c) => c.slice(COOKIE_PREFIX.length)).join("; ");
  if (upCookies) upHeaders.cookie = upCookies;

  const upOpts = {
    headers: upHeaders,
    handshakeTimeout: 12000,
    maxPayload: 64 * 1024 * 1024,
  };
  if (reqProtocols.length) upOpts.protocols = reqProtocols;

  const up = new WebSocket(upUrl, upOpts);

  up.on("open", () => {
    console.error("[ws] upstream OPEN", upUrl);
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const toUp = (d, isBin) => { try { if (up.readyState === WebSocket.OPEN) up.send(d, { binary: isBin }); } catch (e) {} };
        const toWs = (d, isBin) => { try { if (ws.readyState === WebSocket.OPEN) ws.send(d, { binary: isBin }); } catch (e) {} };
        ws.on("message", toUp);
        ws.on("close", () => { try { up.close(); } catch (e) {} });
        ws.on("error", () => { try { up.close(); } catch (e) {} });
        up.on("message", toWs);
        up.on("close", () => { try { ws.close(); } catch (e) {} });
        up.on("error", () => { try { ws.close(); } catch (e) {} });
      });
    } catch (e) {
      rejectUpgrade(socket, 502, "Bad Gateway");
    }
  });

  up.on("error", (err) => {
    console.error("[ws] upstream ERROR", upUrl, err.message);
    rejectUpgrade(socket, 502, "Upstream websocket failed");
  });
  up.on("unexpected-response", (_upReq, upRes) => {
    console.error("[ws] upstream unexpected-response", upUrl, upRes.statusCode, upRes.statusMessage);
    rejectUpgrade(socket, upRes.statusCode || 502, upRes.statusMessage || "Bad Gateway");
    upRes.resume();
  });
});

/* ================================================================
 * START
 * ================================================================ */

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`RCDN proxy running on http://0.0.0.0:${PORT}`);
  console.log(`Default target: ${DEFAULT_TARGET}`);
  console.log(`UI: http://localhost:${PORT}/`);
  console.log(`Proxy: http://localhost:${PORT}/proxy/https://www.youtube.com/`);
  console.log(`WebSocket tunnel: ws://localhost:${PORT}/proxy/wss://<host>/`);
});
