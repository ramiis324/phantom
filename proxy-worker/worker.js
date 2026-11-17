/**
 * CF-REVERSE-PROXY — Cloudflare Worker reverse proxy
 * Proxies TikTok (and other allowed targets) through a Cloudflare Worker so
 * users can access content without leaving the host site.
 *
 * URL scheme (plain-path so relative appends compose correctly):
 *   <proxy>/proxy/https://<host>/<path>
 *   e.g. https://rcdn-proxy.xxx.workers.dev/proxy/https://www.tiktok.com/@user
 * Sub-resources built from a base publicPath keep appending onto the plain URL
 * and are resolved naturally by the worker (no base64 round-trip).
 *
 * WebSockets: the multiplayer .io games open sockets to their publisher hosts
 * (which a school network blocks). The injected interceptor rewrites
 * `new WebSocket(...)` calls to start at this proxy:
 *   wss://<proxy>/proxy/wss://<host>/<path>
 * and this worker tunnels the Upgrade through to the real target (Cloudflare
 * Workers support WebSocket proxying via a WebSocketPair + subrequest fetch).
 */
const DEFAULT_TARGET = "https://www.youtube.com";
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
  /* YouTube / Google */
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
  /* Reddit */
  "reddit.com",
  "redditstatic.com",
  "redditmedia.com",
  "redd.it",
  /* Facebook / Instagram */
  "instagram.com",
  "www.instagram.com",
  "cdninstagram.com",
  "fbcdn.net",
  "facebook.com",
  "facebook.net",
  /* Snapchat */
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
  /* Discord */
  "discord.com",
  "discordapp.com",
  "discord.gg",
  /* X */
  "x.com",
  "twitter.com",
  "twimg.com",
  "t.co",
  /* .io multiplayer games (routed through the proxy so they work at school) */
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

const SKIP_ATTRS = new Set([
  "#",
  "data:",
  "mailto:",
  "tel:",
  "javascript:",
  "about:",
  "blob:",
  "ws://",
  "wss://",
]);

const STRIP_REQ_HEADERS = [
  "host",
  "origin",
  "referer",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "cf-cache-status",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-real-ip",
  "accept-encoding",
  "content-length",
];

const STRIP_RES_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "strict-transport-security",
  "report-to",
  "nel",
  "content-length",
];

const COOKIE_PREFIX = "__rcdn_";

/**
 * Determine the base host for path-only / root-relative navigations ("/watch",
 * "/404", "/") that SPA apps issue against the proxy origin. Uses the target
 * established by the session cookie so a TikTok session doesn't get handed to
 * YouTube's default target (which surfaced as YouTube's "This page isn't
 * available" page). Falls back to DEFAULT_TARGET.
 */
function sessionTargetFrom(request, env) {
  const ck = (request.headers.get("Cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE_PREFIX + "target="));
  if (ck) {
    try {
      const v = decodeURIComponent(ck.slice((COOKIE_PREFIX + "target=").length));
      if (/^https?:\/\//.test(v)) return v;
    } catch (e) { /* fall through */ }
  }
  return env.DEFAULT_TARGET || DEFAULT_TARGET;
}

/* ---------- host allowlist ---------- */

function isAllowedHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  for (const allowed of ALLOWED_HOSTS) {
    if (h === allowed || h.endsWith("." + allowed)) return true;
  }
  return false;
}

/* ---------- URL construction ---------- */

/**
 * Build a proxy URL for a given absolute target URL.
 * Returns <proxyOrigin>/proxy/https://HOST/PATH keeping the full path so
 * relative appends and sub-resource resolution compose naturally.
 */
function proxyUrl(proxyOrigin, targetUrl) {
  let t = targetUrl.toString();
  // normalize scheme-hosting
  if (!/^https?:/.test(t)) t = "https://" + t;
  return proxyOrigin + "/proxy/" + t;
}

/**
 * Rewrite a single URL reference from an HTML attribute, preserving the path.
 * Skips non-navigable schemes and already-proxied URLs.
 */
function rewriteAttr(u, base, proxyOrigin) {
  if (!u) return u;
  const t = u.trim();
  for (const s of SKIP_ATTRS) if (t.startsWith(s)) return u;
  if (t.startsWith(proxyOrigin)) return u; // already proxied
  try {
    const abs = new URL(t, base).toString();
    return proxyUrl(proxyOrigin, abs);
  } catch (e) {
    return u;
  }
}

/**
 * Rewrite every reference to an allowed host in raw text (HTML, inline
 * <script>, inline JSON, attributes) to a proxy URL. Protocol-relative
 * (//HOST) and absolute (https://HOST) forms are both handled. Already-proxied
 * URLs are skipped via negative lookbehind so double-encoding never happens,
 * even when a rewritten base publicPath causes TikTok to append child chunks.
 */
function rewriteHostRefs(text, proxyOrigin) {
  const proxyPrefix = proxyOrigin + "/proxy/";
  const escPrefix = proxyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Longest hosts first so e.g. tiktokcdn-eu.com is matched before .com-style
  // shorter domains and subdomains are consumed before their roots.
  const hosts = ALLOWED_HOSTS.slice().sort((a, b) => b.length - a.length);
  for (const host of hosts) {
    const esc = host.replace(/\./g, "\\.");
    // absolute: https://HOST  (skip if already proxied)
    text = text.replace(
      new RegExp(`(?<!${escPrefix})https?:\\/\\/${esc}(?![\\w.-])`, "g"),
      proxyOrigin + "/proxy/https://" + host
    );
    // protocol-relative: //HOST
    text = text.replace(
      new RegExp(`(?<!${escPrefix})` + `(?<!:)` + `\\/\\/${esc}(?![\\w.-])`, "g"),
      proxyOrigin + "/proxy/https://" + host
    );
  }
  return text;
}

/* ---------- client interceptor ---------- */

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

/* ---------- request handling ---------- */

function isWebSocketRequest(request) {
  return /^websocket$/i.test(request.headers.get("Upgrade") || "");
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const proxyOrigin = url.origin;
  const isWs = isWebSocketRequest(request);

  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (url.pathname === "/" || url.pathname === "") {
    if (isWs) {
      // Socket to the bare origin: delegate to the session target.
      return proxyWebSocket(request, new URL(sessionTargetFrom(request, env)), proxyOrigin);
    }
    const target = sessionTargetFrom(request, env);
    return Response.redirect(proxyUrl(proxyOrigin, new URL(target)), 302, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (url.pathname.startsWith("/proxy/")) {
    // Everything after "/proxy/" is a plain target URL: /proxy/https://HOST/path
    const raw = url.pathname.slice("/proxy/".length) + url.search + url.hash;
    if (!/^(https?|wss?):\/\//i.test(raw) && !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) {
      // If raw is just a path (no host), delegate to the session/base host
      const base = new URL(sessionTargetFrom(request, env));
      const delegated = new URL(raw, base.origin);
      if (!isAllowedHost(delegated.hostname)) {
        return new Response("Host not allowed: " + delegated.hostname, { status: 403 });
      }
      return isWs
        ? proxyWebSocket(request, delegated, proxyOrigin)
        : proxyRequest(request, delegated, proxyOrigin);
    }
    let targetUrl;
    try {
      targetUrl = new URL(/^(https?|wss?):\/\//i.test(raw) ? raw : "https://" + raw);
    } catch (e) {
      return new Response("Invalid proxy URL", { status: 400 });
    }
    if (!isAllowedHost(targetUrl.hostname)) {
      return new Response(
        "This host is not allowed through the proxy: " + targetUrl.hostname,
        { status: 403 }
      );
    }
    if (targetUrl.hostname === new URL(proxyOrigin).hostname) {
      return new Response("Proxy loop detected", { status: 403 });
    }
    return isWs
      ? proxyWebSocket(request, targetUrl, proxyOrigin)
      : proxyRequest(request, targetUrl, proxyOrigin);
  }

  // Relative/non-encoded path -> delegate to the session's target host.
  const base = new URL(sessionTargetFrom(request, env));
  const delegated = new URL(url.pathname + url.search, base.origin);
  if (!isAllowedHost(delegated.hostname)) {
    return new Response("Host not allowed: " + delegated.hostname, { status: 403 });
  }
  return isWs
    ? proxyWebSocket(request, delegated, proxyOrigin)
    : proxyRequest(request, delegated, proxyOrigin);
}

async function proxyRequest(request, targetUrl, proxyOrigin) {
  const reqHeaders = new Headers(request.headers);
  STRIP_REQ_HEADERS.forEach((h) => reqHeaders.delete(h));
  reqHeaders.set("User-Agent", UA);

  // Synthesize an origin / referer that MATCHES the target so the site's CSRF
  // and bot checks see a legitimate same-site request. The browser's real
  // origin is our proxy, which upstream would reject (this is why the game
  // login/API endpoints 403'd before).
  const isPost = !["GET", "HEAD"].includes(request.method);
  if (isPost || /^\/(api|ajax|graphql|v1|sdk|socket\.io)/.test(targetUrl.pathname)) {
    reqHeaders.set("Origin", targetUrl.origin);
  }
  const refererPath = targetUrl.pathname || "/";
  reqHeaders.set("Referer", targetUrl.origin + (refererPath.startsWith("/") ? refererPath : "/" + refererPath));
  reqHeaders.set("Sec-Fetch-Site", reqHeaders.get("Sec-Fetch-Site") || "same-origin");
  reqHeaders.set("Sec-Fetch-Mode", reqHeaders.get("Sec-Fetch-Mode") || (isPost ? "cors" : "navigate"));
  reqHeaders.set("X-Requested-With", reqHeaders.get("X-Requested-With") || "XMLHttpRequest");

  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const out = cookie
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.startsWith(COOKIE_PREFIX))
      .map((c) => c.slice(COOKIE_PREFIX.length))
      .join("; ");
    if (out) reqHeaders.set("Cookie", out);
    else reqHeaders.delete("Cookie");
  }

  const method = request.method;
  const init = { method, headers: reqHeaders, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") init.body = request.body;

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), init);
  } catch (e) {
    return new Response("Upstream fetch failed: " + e.message, { status: 502 });
  }

  const resHeaders = new Headers(upstream.headers);
  STRIP_RES_HEADERS.forEach((h) => resHeaders.delete(h));
  resHeaders.set("Access-Control-Allow-Origin", "*");
  resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  resHeaders.set("Access-Control-Allow-Headers", "*");
  // Never cache proxy responses: content is rewritten per-request and chunk
  // URLs/versions change frequently. Edge caching served stale (old worker)
  // HTML to users before.
  resHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  resHeaders.delete("expires");
  resHeaders.delete("age");
  resHeaders.delete("etag");
  resHeaders.delete("last-modified");

  /* rewrite Set-Cookie into proxy namespace */
  if (resHeaders.has("set-cookie")) {
    const sc = resHeaders.get("set-cookie");
    resHeaders.set(
      "set-cookie",
      sc
        .replace(/;\s*Domain=[^;]*/gi, "")
        .replace(/;\s*Path=[^;]*/gi, "")
        .replace(/^\s*([^=;]+)=/, COOKIE_PREFIX + "$1=") + "; Path=/"
    );
  }
  /* remember which app this session is browsing so bare /foo paths delegate
     to it instead of the global default */
  resHeaders.append(
    "Set-Cookie",
    COOKIE_PREFIX + "target=" + encodeURIComponent(targetUrl.origin) + "; Path=/; SameSite=Lax; Max-Age=21600"
  );

  /* rewrite redirect Location into proxy */
  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const loc = upstream.headers.get("Location");
    let newLoc = proxyOrigin + "/";
    if (loc) {
      try {
        const absLoc = new URL(loc, targetUrl.toString()).toString();
        newLoc = proxyUrl(proxyOrigin, absLoc);
      } catch (e) { newLoc = proxyOrigin + "/"; }
    }
    resHeaders.set("Location", newLoc);
    return new Response(null, { status: upstream.status, headers: resHeaders });
  }

  const ct = (upstream.headers.get("Content-Type") || "").toLowerCase();
  const base = targetUrl.origin;
  let body;

  if (ct.includes("text/html")) {
    let text = await upstream.text();
    // Rewrite allowed-host references everywhere: element attributes AND
    // inline <script type="application/json"> content like the chunk-manifest
    // publicPath. Buffered rewrite (not just HTMLRewriter attrs) is required —
    // the raw publicPath is exactly what broke chunk-loading before.
    text = rewriteHostRefs(text, proxyOrigin);
    // Remove <base> so the page cannot torpedo relative sub-resource
    // resolution back onto foreign origins.
    text = text.replace(/<base\b[^>]*>/gi, "");
    // Drop integrity/crossorigin so the browser doesn't reject proxied
    // scripts/styles because we rewritten their URLs (hashes no longer match).
    text = text.replace(/\s+integrity="[^"]*"/gi, "");
    text = text.replace(/\s+crossorigin="[^"]*"/gi, "");
    // Inject the client interceptor right after <head>.
    text = text.replace(
      /<head([^>]*)>/i,
      (m, attrs) => `<head${attrs}>${interceptorScript(proxyOrigin, targetUrl.origin)}`
    );
    body = text;
  } else if (ct.includes("text/css") || ct.includes("css")) {
    const text = await upstream.text();
    body = text
      .replace(/url\((['"]?)([^)'"]+)\1\)/gi, (m, q, u) => `url('${rewriteAttr(u, base, proxyOrigin)}')`)
      .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${rewriteAttr(u, base, proxyOrigin)}${q}`);
  } else if (
    ct.includes("javascript") ||
    ct.includes("text/") ||
    ct.includes("application/json") ||
    ct.includes("application/xml") ||
    ct.includes("application/javascript")
  ) {
    let text = await upstream.text();
    // Rewrite absolute domain references (publicPath / CDN URLs) in JSON & JS
    // so runtime chunk loading goes through the proxy. rewriteHostRefs uses a
    // negative lookbehind so references inside already-proxied URLs are never
    // double-encoded (this exact bug broke oEmbed JSON previously).
    body = rewriteHostRefs(text, proxyOrigin);
  } else {
    body = upstream.body;
  }

  return new Response(body, { status: upstream.status, headers: resHeaders });
}

/* ---------- WebSocket tunnel ---------- */

/** Turn an http(s) target URL into its ws(s) equivalent for the Upgrade. */
function wsUpstreamUrl(target) {
  const up = new URL(target.toString());
  if (up.protocol === "https:") up.protocol = "wss:";
  else if (up.protocol === "http:") up.protocol = "ws:";
  return up.toString();
}

/**
 * Tunnel a WebSocket Upgrade through to the real target host so the multiplayer
 * games can keep their sockets. Uses a WebSocketPair: the client gets the
 * browser-facing end, a subrequest fetch (Upgrade: websocket) hands us the
 * origin-facing end, then we relay messages/closes in both directions.
 */
async function proxyWebSocket(request, targetUrl, proxyOrigin) {
  const upstream = wsUpstreamUrl(targetUrl);

  const reqHeaders = new Headers();
  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const out = cookie
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.startsWith(COOKIE_PREFIX))
      .map((c) => c.slice(COOKIE_PREFIX.length))
      .join("; ");
    if (out) reqHeaders.set("Cookie", out);
  }
  reqHeaders.set("User-Agent", UA);
  // Synthesize a matching origin so the game server accepts the handshake.
  reqHeaders.set("Origin", targetUrl.origin);
  reqHeaders.set("Sec-Fetch-Site", "same-origin");
  reqHeaders.set("Sec-Fetch-Mode", "websocket");
  reqHeaders.set("Upgrade", "websocket");
  reqHeaders.set("Connection", "Upgrade");
  const proto = request.headers.get("Sec-WebSocket-Protocol");
  if (proto) reqHeaders.set("Sec-WebSocket-Protocol", proto);

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  try {
    const upstreamRes = await fetch(upstream, { headers: reqHeaders });
    const upstreamSocket = upstreamRes.webSocket;
    if (!upstreamSocket) {
      server.close();
      return new Response("WebSocket upgrade rejected by upstream", { status: 502 });
    }
    upstreamSocket.accept();
    server.accept();

    upstreamSocket.addEventListener("message", (ev) => {
      try { server.send(ev.data); } catch (e) {}
    });
    server.addEventListener("message", (ev) => {
      try { upstreamSocket.send(ev.data); } catch (e) {}
    });

    const closeDown = () => { try { server.close(); } catch (e) {} };
    const closeUp = () => { try { upstreamSocket.close(); } catch (e) {} };
    upstreamSocket.addEventListener("close", closeDown);
    upstreamSocket.addEventListener("error", closeDown);
    server.addEventListener("close", closeUp);
    server.addEventListener("error", closeUp);
  } catch (e) {
    try { server.close(); } catch (_) {}
    return new Response("WebSocket tunnel failed: " + e.message, { status: 502 });
  }

  const resHeaders = new Headers({
    "Access-Control-Allow-Origin": "*",
  });
  // Persist the session target on the socket too so follow-up bare-path
  // upgrades (e.g. skribbl's /socket.io/?) resolve to the same game host.
  resHeaders.append(
    "Set-Cookie",
    COOKIE_PREFIX + "target=" + encodeURIComponent(targetUrl.origin) + "; Path=/; SameSite=Lax; Max-Age=21600"
  );
  return new Response(null, { status: 101, headers: resHeaders, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    return handleRequest(request, env);
  },
};