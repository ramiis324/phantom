/* db.js — messenger data layer.
 *
 * Talks to Supabase when credentials are set in supabase-config.js,
 * otherwise falls back to a localStorage store so the site works before
 * the backend is live. Every method returns a Promise.
 *
 * Identity: there is NO password auth. Each browser generates a uuid when
 * the profile is created and stores it in localStorage; that uuid is the
 * row key in `profiles`. The database must be open to the anon key (see
 * supabase-schema.sql) — RLS is intentionally disabled there.
 *
 * Jerry (the pinned BOT) is always stored in localStorage, per spec —
 * his conversation survives even in Supabase mode.
 */

(function () {
  const READY = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase);
  let MODE = READY ? "supabase" : "local";

  let sb = null;
  if (READY) {
    try {
      sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn("[db] Supabase init failed, using local mode.", e);
      MODE = "local";
    }
  }
  if (MODE === "local" && READY) console.warn("[db] Running in LOCAL mode until Supabase credentials are configured.");
  if (MODE === "supabase") console.info("[db] supabase mode active");

  /* ------------------------------------------------------------------ *
   *  Shared helpers
   * ------------------------------------------------------------------ */
  const LS_KEY = "social.v1";
  const JERRY_ID = "jerry";

  /* login.html stores a Storage object path in profiles.avatar_path (e.g.
     "<uuid>-1790816720652-images.jpg"), not a URL. Anything rendering that
     field has to ask Storage for the public URL first, or <img> gets a 404. */
  function avatarUrl(path) {
    if (!path || typeof path !== "string") return null;
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    if (!sb) return null;
    try {
      const { data } = sb.storage.from("avatars").getPublicUrl(path);
      return (data && data.publicUrl) || null;
    } catch (e) {
      console.warn("[db] avatarUrl", e);
      return null;
    }
  }

  /* Settings > Account pushes a new picture to the avatars bucket and
     stores the returned object path on the profile. Returns null when
     there is no client, the file isn't an image, or Storage refused it. */
  async function uploadAvatar(file) {
    if (!sb || MODE !== "supabase") return null;
    if (!file || !/^image\//i.test(file.type || "")) return null;
    const name = uid() + "-" + Date.now() + "-" +
      String(file.name || "picture").replace(/[^\w.-]/g, "_");
    const { data, error } = await sb.storage
      .from("avatars")
      .upload(name, file, { cacheControl: "3600" });
    if (error) {
      console.warn("[db] uploadAvatar", error);
      return null;
    }
    return (data && data.path) || null;
  }

  /* Chat pictures share the public avatars bucket but live under chat/ so they
     never collide with profile pictures. Returns a public URL, not a path. */
  async function uploadChatImage(file) {
    if (!sb || MODE !== "supabase") return null;
    if (!file || !/^image\//i.test(file.type || "")) return null;
    const name = "chat/" + uid() + "-" + Date.now() + "-" +
      String(file.name || "image").replace(/[^\w.-]/g, "_");
    const { data, error } = await sb.storage
      .from("avatars")
      .upload(name, file, { cacheControl: "31536000", upsert: false });
    if (error) {
      console.warn("[db] uploadChatImage", error);
      return null;
    }
    return avatarUrl((data && data.path) || name);
  }

  /* ------------------------------------------------------------------ *
   *  Playtime <-> account
   *
   *  index.html/player.html already track per-game seconds in
   *  localStorage under "rcdn-playtime" as { cleanGameName: seconds }.
   *  That map is the source of truth for the *lifetime* total; this
   *  module keeps a copy of the total in localStorage and pushes only the
   *  part that hasn't reached the server yet (the "delta") up to the
   *  add_playtime RPC, which folds it into profiles.total_playtime.
   *
   *  Why deltas rather than posting the total: posting a total would let
   *  a lost or replayed sync overwrite the server value, and two open
   *  tabs would clobber each other. Sending increments and letting
   *  postgres add them is safe in both cases.
   * ------------------------------------------------------------------ */
  const PT_MAP_KEY = "rcdn-playtime";
  const PT_SYNC_KEY = "rcdn-playtime-synced";

  function localPtMap() {
    try { return JSON.parse(localStorage.getItem(PT_MAP_KEY) || "{}"); } catch (e) { return {}; }
  }
  /* Lifetime seconds across every game. The map is keyed by cleaned game
     name, so summing the values covers the whole catalogue. */
  function localPlaytimeTotal() {
    let total = 0;
    for (const k in localPtMap()) {
      const v = Number(localPtMap()[k]);
      if (isFinite(v) && v > 0) total += v;
    }
    return Math.floor(total);
  }
  function ptSynced() {
    return Number(localStorage.getItem(PT_SYNC_KEY) || 0) || 0;
  }
  function ptSetSynced(v) {
    try { localStorage.setItem(PT_SYNC_KEY, String(Math.max(0, Math.floor(v)))); } catch (e) {}
  }

  async function ptFlush() {
    const p = me();
    if (!p || MODE !== "supabase") return null;
    const total = localPlaytimeTotal();
    const delta = total - ptSynced();
    if (delta <= 0) return total;

    const { data, error } = await sb.rpc("add_playtime", { p_id: p.id, p_delta: delta });
    if (error) {
      /* Missing RPC means the schema wasn't re-run. Drop the pending delta
         so we don't retry forever, but keep the local total. */
      console.warn("[db] add_playtime", error);
      if (error.code === "42883" || /function .* does not exist/i.test(error.message || "")) {
        ptSetSynced(total);
      }
      return total;
    }

    const serverTotal = typeof data === "number" ? data : total + delta;
    ptSetSynced(total);
    if (p) {
      local.data.profile = { ...p, totalPlaytime: serverTotal };
      local.save();
    }
    return serverTotal;
  }

  let ptTimer = null;
  function ptStartAutoSync() {
    if (MODE !== "supabase") return;
    ptStopAutoSync();
    /* A background tab is throttled, so also flush on visibilitychange
       and pagehide — those are the moments most likely to lose seconds. */
    const kick = () => { if (document.visibilityState === "visible") ptFlush(); };
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("pagehide", () => { ptFlush(); });
    ptTimer = setInterval(ptFlush, 60_000);
    /* Game pages only ever sync playtime, so hook the map/quests/bookmarks
       push here too — otherwise hours played on player.html would stay in
       that origin's localStorage and never reach the account. */
    watchProgress();
  }
  function ptStopAutoSync() {
    if (ptTimer) { clearInterval(ptTimer); ptTimer = null; }
  }

  /* ------------------------------------------------------------------ *
   *  Sign-in (Supabase Auth)
   *
   *  The identity is the authenticated user id, not a uuid invented in
   *  localStorage, so the account is the same whichever link the site is
   *  served from. Sign-in is passwordless: Google OAuth, or a 6-digit code
   *  Supabase emails (via signInWithOtp, which needs {{ .Token }} in the
   *  Magic Link template). profiles.id mirrors auth.users.id; the profile
   *  row keeps the site-side parts (username, avatar, playtime).
   *
   *  profiles rows are created exactly once per auth user. Linking a second
   *  identity later never rewrites username or avatar, which is what keeps
   *  a name/picture chosen here from being replaced by a Google one.
   * ------------------------------------------------------------------ */
  function authReady() { return MODE === "supabase" && sb && !!sb.auth; }

  async function authUser() {
    if (!authReady()) return null;
    try {
      const { data } = await sb.auth.getSession();
      return (data && data.session && data.session.user) || null;
    } catch (e) {
      console.warn("[db] getSession", e);
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   *  Cross-mirror session handoff
   *
   *  The mirrors (phantom.gt.tc, phantom.fwh.is, phantom.66ghz.com,
   *  phantom.nfy.fyi) are four unrelated registrable domains, so the
   *  browser gives each one its own localStorage and a Supabase session
   *  never follows you across. What can travel is the token pair itself:
   *  a link between mirrors carries it in the URL fragment (fragments are
   *  never sent to the server and never show up in a Referer), and the
   *  destination adopts it on load.
   *
   *  Refresh tokens are single-use and rotate, so the newest pair lives on
   *  the mirror you are actually looking at. Coming back hands it over
   *  again; a mirror you have left goes stale the next time it refreshes.
   * ------------------------------------------------------------------ */

  const SSO_HASH = "phantom-sso";

  function base64UrlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlDecode(str) {
    const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    return decodeURIComponent(escape(atob(b64 + pad)));
  }

  /* The token pair for this browser's session, ready for a link. Null when
     there is nothing to hand over (signed out, or local mode). */
  async function handoffPayload() {
    if (!authReady()) return null;
    try {
      const { data } = await sb.auth.getSession();
      const s = data && data.session;
      if (!s || !s.access_token || !s.refresh_token) return null;
      return base64UrlEncode(JSON.stringify({
        a: s.access_token,
        r: s.refresh_token,
        u: (s.user && s.user.id) || null,
      }));
    } catch (e) {
      console.warn("[db] handoffPayload", e);
      return null;
    }
  }

  /* Take over a handed-off session. Never swaps the account under someone:
     a signed-out mirror fills in, a signed-in one only renews its own. */
  async function adoptHandoff(raw) {
    if (!authReady() || !raw) return { ok: false };
    let tokens = null;
    try { tokens = JSON.parse(base64UrlDecode(raw)); } catch (e) { return { ok: false }; }
    if (!tokens || !tokens.a || !tokens.r) return { ok: false };
    try {
      const current = await authUser();
      if (current && tokens.u && current.id !== tokens.u) {
        return { ok: false, reason: "a different account is signed in here" };
      }
      const { error } = await sb.auth.setSession({
        access_token: tokens.a,
        refresh_token: tokens.r,
      });
      if (error) { console.warn("[db] adoptHandoff", error); return { ok: false, reason: error.message }; }
      const profile = await syncAuthSession();
      return { ok: true, profile: profile || null };
    } catch (e) {
      console.warn("[db] adoptHandoff", e);
      return { ok: false, reason: String((e && e.message) || e) };
    }
  }

  /* Runs on every page that loads db.js. The fragment is cleared before
     the exchange completes, so a reload can never re-send tokens that
     have already rotated. */
  function adoptHandoffFromUrl() {
    if (!authReady()) return;
    const hash = String(location.hash || "");
    const at = hash.indexOf(SSO_HASH + "=");
    if (at === -1) return;
    const raw = hash.slice(at + SSO_HASH.length + 1).split("&")[0];
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    adoptHandoff(raw).then((r) => {
      if (!r || !r.ok) return;
      try {
        window.dispatchEvent(new CustomEvent("phantom:session-adopted", { detail: r }));
      } catch (e) {}
      console.info("[db] session handed over from another mirror");
    });
  }

  adoptHandoffFromUrl();

  /* Supabase's own messages are accurate but cryptic ("Email not
     confirmed", "redirect_uri_mismatch"), so the common setup ones get a
     sentence saying what to change in the dashboard. */
  function authHint(error) {
    const msg = String((error && (error.message || error.error_description)) || "").trim();
    if (/error sending .*(confirmation|magic link|recovery|email) email/i.test(msg)) {
      return "The mail server was reached but rejected the message. Usually the sender address isn't on a domain verified with your mail provider (look under Domains there), or the SMTP password is wrong. Supabase > Logs > Auth shows the exact error.";
    }
    if (/timed out|timeout|took too long/i.test(msg)) {
      return "Supabase took too long to send the email, which means it couldn't reach the mail server. Check the custom SMTP host, port, username and API key in Authentication > Emails > SMTP Settings.";
    }
    if (/provider is not enabled|unsupported provider/i.test(msg)) {
      return "Google sign-in is off in Supabase. Turn it on in Authentication > Sign In / Providers > Google.";
    }
    if (/redirect|not allowed|invalid url/i.test(msg)) {
      return "This link is not in Supabase's redirect list. Add " + location.origin + " under Authentication > URL Configuration.";
    }
    /* Two different limits share one error code, and only the message
       tells them apart. The 60-second one clears on its own; the hourly
       one is the project-wide cap on Supabase's built-in sender and will
       not clear by waiting a minute. */
    if (/only request this after|for security purposes/i.test(msg)) {
      const secs = (msg.match(/(\d+)\s*(?:seconds?|s)\b/i) || [])[1];
      return "A code was just sent to this address. Check your inbox" +
        (secs && Number(secs) > 1 ? ", or wait " + secs + "s" : ", or wait a moment") +
        " before asking for another.";
    }
    if (/email rate limit exceeded|over_email_send_rate_limit/i.test(msg)) {
      return "Supabase's built-in sender allows 2 emails an hour for the whole project, and that allowance is used up. Enter a code you already received, or try again later (a custom SMTP server lifts the cap).";
    }
    if (/single_identity_not_deletable|at least 1 identity/i.test(msg)) {
      return "That's the only way to sign in. Link the other one first, then unlink this one.";
    }
    if (/manual linking/i.test(msg)) {
      return "Unlinking needs 'Enable Manual Linking' turned on in Supabase (Authentication > Sign In / Providers).";
    }
    if (/row-level security|permission denied for table/i.test(msg)) {
      return "The database is refusing writes for signed-in users. Run the updated supabase-schema.sql - it adds the policies for signed-in requests.";
    }
    if (/email address not authorized/i.test(msg)) {
      return "Supabase only emails addresses on your Supabase team while its built-in sender is in use. Add this address to the team, or set up custom SMTP.";
    }
    if (/rate limit|too many/i.test(msg)) {
      return "Too many codes requested. Wait a minute, then try again.";
    }
    if (/email address not authorized|smtp/i.test(msg)) {
      return "Supabase could not send that email (check the email/SMTP settings).";
    }
    return msg || "Something went wrong. Try again.";
  }

  /* True for either kind of send throttle, so callers can offer the code
     entry anyway in case an earlier code is still valid. */
  function rateLimited(error) {
    const msg = String((error && (error.message || error.error_description)) || "");
    return /rate limit|too many|only request this after|for security purposes|over_email_send_rate_limit/i.test(msg);
  }

  function hereUrl() { return location.origin + location.pathname; }

  /* Supabase's Auth endpoints wait on its mail server. When the custom SMTP
     host is unreachable or misconfigured that wait runs for about half a
     minute and then answers 504, so the button sits disabled with no sign
     of life. Give up earlier with a message that names the real cause. */
  function withTimeout(promise, ms, reason) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(reason || "timeout")), ms || 20000);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  /* Public (unauthenticated) provider list. Supabase answers an
     unconfigured provider by rendering a JSON error page instead of
     redirecting, so auth flows check this first and keep the user on the
     site with a usable message. */
  async function authProviders() {
    if (!authReady()) return null;
    try {
      const base = String(window.SUPABASE_URL || "").replace(/\/+$/, "");
      if (!base) return null;
      const r = await fetch(base + "/auth/v1/settings", {
        headers: window.SUPABASE_ANON_KEY ? { apikey: window.SUPABASE_ANON_KEY } : {},
      });
      if (!r.ok) return null;
      const j = await r.json();
      return { google: !!(j && j.external && j.external.google) };
    } catch (e) {
      return null;
    }
  }

  async function signInWithGoogle(redirectTo) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const providers = await authProviders();
    if (providers && providers.google === false) {
      return { ok: false, reason: "Google sign-in isn't enabled in Supabase yet. Turn it on in Authentication > Providers > Google, or use email." };
    }
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo || hereUrl() },
      });
      if (error) return { ok: false, reason: authHint(error) };
      return { ok: true };
    } catch (e) {
      console.warn("[db] signInWithGoogle", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  async function sendEmailCode(email, redirectTo, shouldCreateUser) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const address = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return { ok: false, reason: "That email doesn't look right." };
    try {
      const { error } = await withTimeout(sb.auth.signInWithOtp({
        email: address,
        options: {
          shouldCreateUser: shouldCreateUser !== false,
          emailRedirectTo: redirectTo || hereUrl(),
        },
      }), 15000, "timeout");
      if (error) return { ok: false, reason: authHint(error), rateLimited: rateLimited(error) };
      return { ok: true, email: address };
    } catch (e) {
      console.warn("[db] sendEmailCode", e);
      return { ok: false, reason: authHint(e), rateLimited: rateLimited(e) };
    }
  }

  async function verifyEmailCode(email, token) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const digits = String(token || "").replace(/\D/g, "");
    /* Supabase's OTP length is configurable (6-10), so accept whatever the
       email shows instead of assuming six. */
    if (digits.length < 6 || digits.length > 10) return { ok: false, reason: "Enter the code from the email." };
    try {
      const { data, error } = await withTimeout(
        sb.auth.verifyOtp({ email: email, token: digits, type: "email" }), 15000, "timeout"
      );
      if (error) return { ok: false, reason: authHint(error) };
      return { ok: true, user: data && data.user, session: data && data.session };
    } catch (e) {
      console.warn("[db] verifyEmailCode", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  /* Settings > unlink a way in. Supabase keeps at least one identity on an
     account and refuses the last one, so the UI only offers this while
     another method is linked. Unlinking needs the same "Manual linking"
     setting that linking does. */
  async function unlinkProvider(provider) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const user = await authUser();
    if (!user) return { ok: false, reason: "Sign in first." };
    let identities = user.identities || [];
    /* The session copy can lag behind a link made moments ago. */
    try {
      const fresh = await sb.auth.getUserIdentities();
      if (fresh && !fresh.error && fresh.data && fresh.data.identities) {
        identities = fresh.data.identities;
      }
    } catch (e) {}
    const label = provider === "google" ? "Google" : "That email";
    const target = identities.find((i) => i.provider === provider);
    if (!target) return { ok: false, reason: "That sign-in method isn't linked." };
    if (identities.length <= 1) {
      return { ok: false, reason: label + " is your only way to sign in. Link the other method first, then unlink it." };
    }
    try {
      const { error } = await withTimeout(sb.auth.unlinkIdentity(target), 15000, "timeout");
      if (error) return { ok: false, reason: authHint(error) };
    } catch (e) {
      console.warn("[db] unlinkProvider", e);
      return { ok: false, reason: authHint(e) };
    }
    await syncAuthSession();
    return { ok: true };
  }

  /* --- carrying an older browser account into the signed-in one ---
     Signing in on a browser that still holds a pre-sign-in account used to
     leave that history behind and start a fresh row, so the same person
     appeared twice on the board. This moves the older row's progress onto
     the signed-in row: one account, old playtime kept. It is explicit (a
     button) rather than automatic, because a shared browser may hold
     somebody else's account. */
  /* The pre-sign-in account this browser held, kept aside when signing in
     switched the cache over to the auth row, so its progress can still be
     carried over afterwards. */
  const LEGACY_KEY = "rcdn-legacy-account";

  function rememberLegacy(p) {
    if (!p || !p.id) return;
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify({
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        avatarPath: p.avatarPath || null,
        totalPlaytime: Number(p.totalPlaytime || 0),
        createdAt: p.createdAt || 0,
      }));
    } catch (e) {}
  }

  function rememberedLegacy() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      const p = raw ? JSON.parse(raw) : null;
      return (p && p.id) ? p : null;
    } catch (e) { return null; }
  }

  function clearRememberedLegacy() {
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
  }

  function legacyCandidate() {
    const ids = authIdentities || [];
    if (ids.indexOf("email") === -1 && ids.indexOf("google") === -1) return null;
    const p = rememberedLegacy();
    if (!p) return null;
    const cur = me();
    if (cur && cur.id === p.id && cur.authId) return null;
    return p;
  }

  async function readProfileData(id) {
    try {
      const r = await sb.from("profile_data").select("playtime, bookmarks, quests").eq("user_id", id).maybeSingle();
      return (r && r.data) || null;
    } catch (e) { return null; }
  }

  function mergeProfileData(a, b) {
    const playtime = {};
    [a, b].forEach((d) => {
      const m = (d && d.playtime) || {};
      Object.keys(m).forEach((k) => {
        playtime[k] = Math.max(Number(playtime[k] || 0), Number(m[k] || 0));
      });
    });
    const bookmarks = [];
    [a, b].forEach((d) => ((d && d.bookmarks) || []).forEach((x) => {
      if (bookmarks.indexOf(x) === -1) bookmarks.push(x);
    }));
    const quests = [];
    [a, b].forEach((d) => ((d && d.quests) || []).forEach((q) => {
      if (q && !quests.some((y) => y && y.clean === q.clean)) quests.push(q);
    }));
    return { playtime: playtime, bookmarks: bookmarks, quests: quests };
  }

  async function carryOverLegacy() {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const user = await authUser();
    if (!user) return { ok: false, reason: "Sign in first." };
    const legacy = rememberedLegacy();
    if (!legacy) return { ok: false, reason: "There is no older account on this browser." };
    const cur = me();
    if (cur && cur.id === legacy.id && cur.authId === user.id) return { ok: true, already: true, profile: cur };

    /* The row this sign-in is using right now (usually a fresh one made at
       sign-in, which is why the board showed two of the same person). */
    let shell = null;
    try {
      const byAuth = await sb.from("profiles").select("*").eq("auth_id", user.id).maybeSingle();
      shell = byAuth.data || null;
      if (!shell) {
        const byId = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
        shell = byId.data || null;
      }
    } catch (e) { console.warn("[db] carryOverLegacy", e); }

    try {
      if (!shell || shell.id === legacy.id) {
        const up = await sb.from("profiles").update({ auth_id: user.id, total_playtime: Number(legacy.totalPlaytime || 0) }).eq("id", legacy.id);
        if (up.error) return { ok: false, reason: authHint(up.error) };
        clearRememberedLegacy();
        local.data.profile = { ...legacy, authId: user.id };
        local.save();
        return { ok: true, profile: local.data.profile };
      }

      /* Highest value wins per game, so neither side loses time when the
         same minutes were counted in both places. */
      const mine = await readProfileData(legacy.id);
      const theirs = await readProfileData(shell.id);
      const merged = mergeProfileData(mine, theirs);
      const total = Math.max(
        Number(legacy.totalPlaytime || 0),
        Number(shell.total_playtime || 0)
      );

      /* Progress first: the merged totals belong to the older row, which
         keeps its id because friendships, messages and history point at
         it. Its own name and picture stay as they were. */
      if (mine || theirs) {
        const pdata = await sb.from("profile_data").upsert(
          { user_id: legacy.id, ...merged, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
        if (pdata.error) console.warn("[db] carryOverLegacy data", pdata.error);
      }

      /* The signed-in row has to release the sign-in (auth_id is unique)
         before the older row can take it. Drop it when it holds no
         messages of its own, so the board stops showing the same person
         twice; otherwise step aside and leave it as an orphan row. */
      let removed = false;
      let shellHasMessages = false;
      try {
        const mres = await sb.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", shell.id);
        shellHasMessages = Number(mres && mres.count) > 0;
      } catch (e) {}
      if (!shellHasMessages) {
        const del = await sb.from("profiles").delete().eq("id", shell.id);
        removed = !del.error;
        if (del.error) console.warn("[db] carryOverLegacy delete", del.error);
      }
      if (!removed) {
        await sb.from("profiles").update({ auth_id: null }).eq("id", shell.id);
      }

      const up = await sb.from("profiles").update({ auth_id: user.id, total_playtime: total }).eq("id", legacy.id);
      if (up.error) return { ok: false, reason: authHint(up.error) };

      clearRememberedLegacy();
      local.data.profile = { ...legacy, authId: user.id, totalPlaytime: total };
      local.save();
      return { ok: true, profile: local.data.profile, moved: true, removed: removed };
    } catch (e) {
      console.warn("[db] carryOverLegacy", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  /* Settings > link another way in. linkIdentity needs "Manual linking"
     enabled in Supabase (Authentication > Sign In / Providers). */
  async function linkGoogle(redirectTo) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    if (!(await authUser())) return { ok: false, reason: "Sign in first." };
    const providers = await authProviders();
    if (providers && providers.google === false) {
      return { ok: false, reason: "Google sign-in isn't enabled in Supabase yet. Turn it on in Authentication > Providers > Google first." };
    }
    try {
      const { error } = await sb.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: redirectTo || hereUrl() },
      });
      if (error) {
        const msg = String(error.message || "");
        if (/manual linking/i.test(msg)) return { ok: false, reason: "Enable \"Manual linking\" in Supabase (Authentication > Sign In / Providers) first." };
        return { ok: false, reason: authHint(error) };
      }
      return { ok: true };
    } catch (e) {
      console.warn("[db] linkGoogle", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  async function linkEmail(email) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const address = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return { ok: false, reason: "That email doesn't look right." };
    try {
      const { error } = await withTimeout(sb.auth.updateUser({ email: address }), 15000, "timeout");
      if (error) return { ok: false, reason: authHint(error) };
      return { ok: true, email: address };
    } catch (e) {
      console.warn("[db] linkEmail", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  async function verifyLinkEmail(email, token) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database; this copy is offline." };
    const digits = String(token || "").replace(/\D/g, "");
    /* Supabase's OTP length is configurable (6-10), so accept whatever the
       email shows instead of assuming six. */
    if (digits.length < 6 || digits.length > 10) return { ok: false, reason: "Enter the code from the email." };
    try {
      const { data, error } = await withTimeout(
        sb.auth.verifyOtp({ email: email, token: digits, type: "email_change" }), 15000, "timeout"
      );
      if (error) return { ok: false, reason: authHint(error) };
      return { ok: true, user: data && data.user };
    } catch (e) {
      console.warn("[db] verifyLinkEmail", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  async function signOutNow() {
    if (authReady()) {
      try { await sb.auth.signOut(); } catch (e) { console.warn("[db] signOut", e); }
    }
    /* Only a session-backed profile can be signed out of. Dropping a legacy
       (unlinked) account here would delete it from this browser for good. */
    if (local.data.profile && local.data.profile.authId) {
      local.data.profile = null;
      local.save();
    }
  }

  async function authState() {
    const user = await authUser();
    if (!user) return { signedIn: false, google: false, email: null, providers: [] };
    const providers = (user.identities || []).map((i) => i.provider);
    return {
      signedIn: true,
      google: providers.indexOf("google") !== -1,
      email: providers.indexOf("email") !== -1 ? user.email : null,
      providers: providers,
    };
  }

  /* Google hands over a display name and picture, so those accounts never
     see the name/picture steps. Email accounts keep the steps. */
  function nameFromAuth(user) {
    const m = (user && user.user_metadata) || {};
    const raw = m.full_name || m.name || m.user_name ||
      (user && user.email ? String(user.email).split("@")[0] : "") || "player";
    let s = String(raw).replace(/[^\x20-\x7E]/g, "").trim();
    s = s.replace(/[^A-Za-z0-9._ -]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
    return (s || "player").slice(0, 20);
  }
  function avatarFromAuth(user) {
    const m = (user && user.user_metadata) || {};
    const url = m.avatar_url || m.picture;
    /* profilePictureSrc reads .data/.url; the schema comment says .value,
       so all three point at the same URL. */
    if (url) return { type: "image", data: url, url: url, value: url };
    return { type: "icon", name: "user", color: "#22c55e" };
  }
  async function uniqueUsername(base) {
    const root = String(base || "player").slice(0, 20) || "player";
    for (let i = 0; i < 30; i++) {
      const suffix = i ? String(i + 1) : "";
      const cand = (root.slice(0, 20 - suffix.length) + suffix) || "player";
      const { data, error } = await sb.from("profiles").select("id").eq("username", cand.toLowerCase()).limit(1);
      if (error) return cand;
      if (!data || !data.length) return cand;
    }
    return root.slice(0, 12) + Math.floor(1000 + Math.random() * 9000);
  }

  /* Swap the cached identity, dropping conversation caches when it is a
     different person (Jerry's local thread stays). */
  function useLocalProfile(p) {
    const prev = local.data.profile;
    const changed = !prev || prev.id !== p.id;
    local.data.profile = { ...p, online: true };
    if (changed) {
      local.data.friends = [];
      local.data.dms = {};
      local.data.dmOrder = [];
      local.data.msgs = {};
      local.data.groups = [];
    }
    local.ensure();
    local.save();
    return local.data.profile;
  }

  /* Accounts created before sign-in existed are still valid: their profile
     row has no auth_id. They must not be logged out — they keep playing and
     get a prompt to attach an email (which sets auth_id on the same row, so
     friends, messages and progress are untouched). */
  /* Only an account with no way to sign in at all gets asked. Once an
     email or Google is attached, the other one is optional and never
     prompted for. */
  function needsLink() {
    /* authIdentities is filled by syncAuthSession (authUser is async). */
    const ids = authIdentities || [];
    if (ids.indexOf("email") !== -1 || ids.indexOf("google") !== -1) return false;
    const p = me();
    return !!(MODE === "supabase" && p && p.id !== JERRY_ID && !p.authId);
  }

  /* Attach the account cached in this browser to the signed-in auth user.
     One UPDATE on the existing row: no re-keying, so every conversation,
     friendship and message keeps pointing at the same profile id. */
  /* Providers of the signed-in user, cached for the sync needsLink(). */
  let authIdentities = null;

  async function linkCurrentAccount(user) {
    if (!authReady()) return { ok: false, reason: "Sign-in needs the database." };
    if (!user) return { ok: false, reason: "Sign in first." };
    const p = me();
    if (!p) return { ok: false, reason: "There is no account on this browser to link." };
    if (p.authId === user.id) return { ok: true, profile: p, already: true };
    try {
      const owned = await sb.from("profiles").select("id, username").eq("auth_id", user.id).limit(1);
      if (owned.error) return { ok: false, reason: authHint(owned.error) };
      const other = (owned.data || [])[0];
      if (other && other.id !== p.id) {
        return { ok: false, reason: "That sign-in already has its own account (" + (other.username || "another one") + "). Sign in with it instead." };
      }
      const up = await sb.from("profiles").update({ auth_id: user.id }).eq("id", p.id);
      if (up.error) return { ok: false, reason: authHint(up.error) };
    } catch (e) {
      console.warn("[db] linkCurrentAccount", e);
      return { ok: false, reason: authHint(e) };
    }
    local.data.profile = { ...p, authId: user.id };
    local.save();
    return { ok: true, profile: local.data.profile };
  }

  /* Runs on every getProfile(): a session wins over the cache, but only for
     accounts that are actually tied to one. A legacy profile with no
     auth_id is left alone (still signed in) and shows the link prompt. */
  async function syncAuthSession() {
    if (!authReady()) return me();
    const user = await authUser();
    authIdentities = user ? (user.identities || []).map((i) => i.provider) : null;
    const cached = me();

    if (!user) {
      /* Genuine sign-out: the profile was tied to a session, so drop it.
         An unlinked legacy profile is not a session and stays. */
      if (cached && cached.authId) { local.data.profile = null; local.save(); }
      return me();
    }

    if (cached && (cached.id === user.id || cached.authId === user.id)) return cached;

    try {
      const byAuth = await sb.from("profiles").select("*").eq("auth_id", user.id).maybeSingle();
      if (byAuth.error && byAuth.error.code !== "42703") console.warn("[db] syncAuthSession", byAuth.error);
      /* Switching away from a pre-sign-in account: keep it so its progress
         can be carried over from Settings instead of being forgotten. */
      if (byAuth.data) {
        if (cached && !cached.authId && cached.id !== byAuth.data.id) rememberLegacy(cached);
        return useLocalProfile(rowToProfile(byAuth.data));
      }

      const byId = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (byId.data) {
        if (cached && !cached.authId && cached.id !== byId.data.id) rememberLegacy(cached);
        return useLocalProfile(rowToProfile(byId.data));
      }
    } catch (e) {
      console.warn("[db] syncAuthSession", e);
    }

    /* Signed in, but no profile row: first sign-in on a browser that still
       holds an unlinked account. Adopt that account rather than starting a
       second one (and without borrowing the Google name/picture). */
    if (cached && !cached.authId) {
      const claimed = await linkCurrentAccount(user);
      if (claimed.ok) { clearRememberedLegacy(); return claimed.profile; }
      return cached;
    }
    return me();
  }

  /* Called right after a successful sign-in. autoCreate is the Google path
     (name/avatar come from the account); email sign-ups go through the
     name and picture steps instead. */
  async function ensureProfileForUser(user, opts) {
    if (!authReady() || !user) return { ok: false, reason: "Not signed in." };
    try {
      const byAuth = await sb.from("profiles").select("*").eq("auth_id", user.id).maybeSingle();
      if (byAuth.data) return { ok: true, created: false, profile: useLocalProfile(rowToProfile(byAuth.data)) };
      const byId = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (byId.error) return { ok: false, reason: authHint(byId.error) };
      if (byId.data) return { ok: true, created: false, profile: useLocalProfile(rowToProfile(byId.data)) };

      /* An existing local account is claimed instead of duplicated: the
         name, picture and all its data stay exactly as they were. */
      if (needsLink()) {
        const claimed = await linkCurrentAccount(user);
        if (claimed.ok) return { ok: true, created: false, claimed: true, profile: claimed.profile };
      }

      if (!(opts && opts.autoCreate)) return { ok: true, created: false, needsProfile: true, user: user };

      const username = await uniqueUsername(nameFromAuth(user));
      const ins = await sb.from("profiles")
        .insert({ id: user.id, auth_id: user.id, username: username, avatar: avatarFromAuth(user) })
        .select()
        .single();
      if (ins.error) return { ok: false, reason: authHint(ins.error) };
      return { ok: true, created: true, profile: useLocalProfile(rowToProfile(ins.data)) };
    } catch (e) {
      console.warn("[db] ensureProfileForUser", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  /* The email flow's name + picture steps finish here: the row is created
     against the auth user id, so it is the account itself. */
  async function createProfileForUser(user, fields) {
    if (!authReady() || !user) return { ok: false, reason: "Not signed in." };
    const row = {
      id: user.id,
      auth_id: user.id,
      username: String(fields && fields.username || "").trim().toLowerCase(),
      avatar: (fields && fields.avatar) || avatarFromAuth(user),
    };
    if (fields && fields.avatarPath) row.avatar_path = fields.avatarPath;
    try {
      const ins = await sb.from("profiles").insert(row).select().single();
      if (ins.error) {
        if (ins.error.code === "23505") return { ok: false, reason: "That name is already taken." };
        return { ok: false, reason: authHint(ins.error) };
      }
      return { ok: true, profile: useLocalProfile(rowToProfile(ins.data)) };
    } catch (e) {
      console.warn("[db] createProfileForUser", e);
      return { ok: false, reason: authHint(e) };
    }
  }

  /* ------------------------------------------------------------------ *
   *  Progress that used to be browser-only
   *
   *  Levels/XP (the per-game playtime map), bookmarks and the active quest
   *  set live in localStorage and are keyed by nothing. That is fine on
   *  one origin and fatal on a mirror, so a copy of each goes to
   *  profile_data and is merged back in on load:
   *    playtime  — larger value wins per game
   *    bookmarks — union
   *    quests    — union, capped at the 3 the UI shows
   *  Pulls only ever add to the local copy, so a stale tab cannot wipe a
   *  newer link's progress. Writes are debounced and piggyback on any
   *  localStorage write of those keys (including toolbox.js and the game
   *  pages), so no caller has to remember to sync.
   * ------------------------------------------------------------------ */
  const PROGRESS_KEYS = { playtime: "rcdn-playtime", bookmarks: "bookmarks", quests: "rcdn-quests" };
  const PROGRESS_MS = 1500;
  let progressWatching = false;
  let progressTimer = null;
  let progressBusy = false;
  let progressAgain = false;
  let progressApplying = false;
  let progressMissing = false;

  /* PostgREST reports a missing table as a 404 in the schema cache
     (PGRST205), not as Postgres' 42P01, so both have to count as "this
     install hasn't run the migration yet" — otherwise every write retries
     and logs forever. */
  function progressMissingError(error) {
    if (!error) return false;
    const code = String(error.code || "");
    if (code === "42P01" || code === "42703" || code === "PGRST205") return true;
    return /does not exist|could not find the table|schema cache/i.test(error.message || "");
  }

  function readJSONish(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      return v === null || typeof v !== "object" ? fallback : v;
    } catch (e) { return fallback; }
  }
  function readList(key) {
    const v = readJSONish(key, []);
    return Array.isArray(v) ? v : [];
  }
  /* Writing the merged copy must not look like user activity, or the pull
     would immediately schedule the push that writes it straight back. */
  function writeJSON(key, value) {
    let raw = "";
    try { raw = JSON.stringify(value); } catch (e) { return; }
    try { if (localStorage.getItem(key) === raw) return; } catch (e) {}
    progressApplying = true;
    try { localStorage.setItem(key, raw); } catch (e) {}
    progressApplying = false;
  }
  function listKeyOfBookmark(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function listKeyOfQuest(v) { return v && typeof v === "object" ? String(v.clean || "").trim().toLowerCase() : ""; }
  function mergeUnique(localList, remoteList, keyOf) {
    const out = [];
    const seen = new Set();
    [...localList, ...remoteList].forEach((v) => {
      const k = keyOf(v);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(v);
    });
    return out;
  }

  function scheduleProgressPush(ms) {
    if (MODE !== "supabase" || !me()) return;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(pushProgress, Number.isFinite(ms) ? ms : PROGRESS_MS);
  }

  async function pushProgress() {
    const p = me();
    if (!p || MODE !== "supabase" || progressMissing) return null;
    if (progressBusy) { progressAgain = true; return null; }
    progressBusy = true;
    try {
      const { error } = await sb.from("profile_data").upsert({
        user_id: p.id,
        playtime: readJSONish(PROGRESS_KEYS.playtime, {}),
        bookmarks: readList(PROGRESS_KEYS.bookmarks),
        quests: readList(PROGRESS_KEYS.quests),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) {
        if (progressMissingError(error)) {
          progressMissing = true;
          console.warn("[db] profile_data is missing — run the updated supabase-schema.sql");
        } else {
          console.warn("[db] pushProgress", error);
        }
      }
    } catch (e) {
      console.warn("[db] pushProgress", e);
    } finally {
      progressBusy = false;
      if (progressAgain) { progressAgain = false; scheduleProgressPush(600); }
    }
    return null;
  }

  /* Returns true when the server copy added something locally, so the UI
     knows to repaint levels, quests and bookmarks. */
  async function pullProgress() {
    const p = me();
    if (!p || MODE !== "supabase" || progressMissing) return false;
    let row = null;
    try {
      const { data, error } = await sb
        .from("profile_data")
        .select("playtime, bookmarks, quests")
        .eq("user_id", p.id)
        .maybeSingle();
      if (error) {
        if (progressMissingError(error)) {
          progressMissing = true;
          console.warn("[db] profile_data is missing — run the updated supabase-schema.sql");
        } else {
          console.warn("[db] pullProgress", error);
        }
        return false;
      }
      row = data || null;
    } catch (e) {
      console.warn("[db] pullProgress", e);
      return false;
    }

    let changed = false;

    /* Playtime: seconds this browser has played but not credited to the
       server must survive the merge. ptSetSynced stays "local total already
       credited", so it is shifted by exactly the merged-in amount. */
    const localPt = readJSONish(PROGRESS_KEYS.playtime, {});
    const remotePt = row && row.playtime && typeof row.playtime === "object" ? row.playtime : {};
    const mergedPt = { ...localPt };
    let ptChanged = false;
    for (const k in remotePt) {
      const v = Number(remotePt[k]);
      if (!isFinite(v) || v <= 0) continue;
      if (v > (Number(mergedPt[k]) || 0)) { mergedPt[k] = v; ptChanged = true; }
    }
    if (ptChanged) {
      const pending = Math.max(0, localPlaytimeTotal() - ptSynced());
      writeJSON(PROGRESS_KEYS.playtime, mergedPt);
      ptSetSynced(Math.max(0, localPlaytimeTotal() - pending));
      changed = true;
    }

    const localBm = readList(PROGRESS_KEYS.bookmarks);
    const remoteBm = row && Array.isArray(row.bookmarks) ? row.bookmarks : [];
    const mergedBm = mergeUnique(localBm, remoteBm, listKeyOfBookmark);
    if (mergedBm.length !== localBm.length) {
      writeJSON(PROGRESS_KEYS.bookmarks, mergedBm);
      changed = true;
    }

    const localQ = readList(PROGRESS_KEYS.quests);
    const remoteQ = row && Array.isArray(row.quests) ? row.quests : [];
    const mergedQ = mergeUnique(localQ, remoteQ, listKeyOfQuest).slice(0, 3);
    if (mergedQ.length !== localQ.length) {
      writeJSON(PROGRESS_KEYS.quests, mergedQ);
      changed = true;
    }

    /* First run for this account: create the row with what we already have. */
    if (!row) scheduleProgressPush(300);
    else if (changed) scheduleProgressPush(300);
    return changed;
  }

  function watchProgress() {
    if (progressWatching || MODE !== "supabase") return;
    progressWatching = true;
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      nativeSet.call(this, key, value);
      if (progressApplying) return;
      if (key === PROGRESS_KEYS.playtime || key === PROGRESS_KEYS.bookmarks || key === PROGRESS_KEYS.quests) {
        scheduleProgressPush();
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") pushProgress();
    });
    window.addEventListener("pagehide", () => { pushProgress(); });
  }

  async function startProgressSync() {
    if (MODE !== "supabase" || !me()) return false;
    const changed = await pullProgress();
    watchProgress();
    scheduleProgressPush(800);
    return changed;
  }

  const JERRY_PROFILE = {
    id: JERRY_ID,
    username: "Jerry",
    bot: true,
    tag: "BOT",
    online: true,
    avatar: { type: "icon", name: "bot", color: "#8b5cf6" },
    createdAt: 0,
  };

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2, 10);
  }
  function now() {
    return Date.now();
  }
  function convIdFor(otherId) {
    return "dm_" + otherId;
  }
  function gidFromConv(convId) {
    return convId && convId.startsWith("g_") ? convId.slice(2) : null;
  }
  // Conversation id as stored in the `conversations` table.
  function dbConvId(convId) {
    return gidFromConv(convId) || convId;
  }

  /* ------------------------------------------------------------------ *
   *  Local store (Jerry + session profile cache + offline fallback)
   * ------------------------------------------------------------------ */
  const local = {
    data: null,
    load() {
      try {
        this.data = JSON.parse(localStorage.getItem(LS_KEY) || "null") || {};
      } catch (e) {
        this.data = {};
      }
      this.ensure();
      return this.data;
    },
    save() {
      localStorage.setItem(LS_KEY, JSON.stringify(this.data));
    },
    ensure() {
      const d = this.data;
      if (!d.profile) d.profile = null;
      if (!d.friends) d.friends = [];
      if (!d.dms) d.dms = {}; // otherId -> { id, otherId, updatedAt }
      if (!d.dmOrder) d.dmOrder = [JERRY_ID];
      if (!d.msgs) d.msgs = {}; // convId -> [msg]
      if (!d.jerryMsgs) d.jerryMsgs = [];
      if (!d.groups) d.groups = [];
      if (d.dmOrder.indexOf(JERRY_ID) === -1) d.dmOrder.unshift(JERRY_ID);
    },
  };
  local.load();

  function me() {
    return local.data.profile;
  }
  function myId() {
    return me() ? me().id : null;
  }
  function profileById(id) {
    if (id === JERRY_ID) return JERRY_PROFILE;
    if (me() && me().id === id) return me();
    return null;
  }

  function localCreateProfile(profile) {
    local.data.profile = profile;
    local.save();
  }

  function localSendMsg(convId, msg) {
    const d = local.data;
    if (!d.msgs[convId]) d.msgs[convId] = [];
    d.msgs[convId].push(msg);
    if (convId === convIdFor(JERRY_ID)) d.jerryMsgs = d.msgs[convId];
    Object.keys(d.dms).forEach((oid) => {
      if (d.dms[oid].id === convId) {
        d.dms[oid].updatedAt = msg.ts;
        d.dmOrder = d.dmOrder.filter((x) => x !== oid);
        d.dmOrder.push(oid);
        if (oid !== JERRY_ID) d.dmOrder = [JERRY_ID].concat(d.dmOrder.filter((x) => x !== JERRY_ID));
      }
    });
    local.save();
    return msg;
  }

  function seedJerry() {
    const d = local.data;
    const cid = convIdFor(JERRY_ID);
    if (!d.dms[JERRY_ID]) {
      d.dms[JERRY_ID] = { id: cid, otherId: JERRY_ID, updatedAt: now() };
    }
    if (!d.jerryMsgs.length) {
      d.jerryMsgs.push({
        id: uid(),
        convId: cid,
        senderId: JERRY_ID,
        content:
          "Hey! I'm Jerry, the news bot \u2014 I'll post site news and updates here. Try sending me a message!",
        type: "text",
        ts: now() - 2000,
      });
      d.msgs[cid] = d.jerryMsgs;
    }
    d.msgs[cid] = d.jerryMsgs;
    d.dmOrder = [JERRY_ID].concat(d.dmOrder.filter((x) => x !== JERRY_ID));
    local.save();
  }
  seedJerry();

  function isFriendLocal(id) {
    return id === JERRY_ID || local.data.friends.indexOf(id) !== -1;
  }
  function localAddFriend(otherId) {
    const d = local.data;
    if (d.friends.indexOf(otherId) === -1) d.friends.push(otherId);
    if (!d.dms[otherId]) {
      d.dms[otherId] = { id: convIdFor(otherId), otherId, updatedAt: now() };
      d.dmOrder = d.dmOrder.filter((x) => x !== otherId);
      d.dmOrder.push(otherId);
    }
    local.save();
  }
  function localDirProfiles() {
    const out = [JERRY_PROFILE];
    local.data.friends.forEach((id) => {
      if (id !== JERRY_ID && id !== myId()) {
        const p = profileById(id);
        if (p) out.push(p);
      }
    });
    return out;
  }
  function localGroupById(id) {
    return local.data.groups.find((g) => g.id === id) || null;
  }
  function decorateGroup(g) {
    return {
      ...g,
      memberCount: g.members.length,
      isMember: !!me() && g.members.indexOf(me().id) !== -1,
      members: g.members.map(profileById).filter(Boolean),
    };
  }

  /* ------------------------------------------------------------------ *
   *  Presence (online / away / offline)
   *  A profile is "online" while its `last_seen` heartbeat is fresh.
   *  The client flips its own `status` to "away" after inactivity.
   * ------------------------------------------------------------------ */
  const PRESENCE_ONLINE_MS = 90 * 1000;
  let presenceStatus = "online";
  let presenceInterval = null;
  let lastPresenceBeat = 0;
  let presenceStatusCb = null;

  function setPresenceStatus(s) {
    presenceStatus = s;
    if (presenceStatusCb) { try { presenceStatusCb(s); } catch (e) {} }
  }

  function presenceBeat(force) {
    if (MODE !== "supabase") return;
    const meId = myId();
    if (!meId) return;
    const t = Date.now();
    if (!force && t - lastPresenceBeat < 20 * 1000) return;
    lastPresenceBeat = t;
    sb.from("profiles")
      .update({ last_seen: new Date().toISOString(), status: presenceStatus })
      .eq("id", meId)
      .then(null, (e) => console.warn("[db] presence", e));
  }

  function startPresence() {
    if (MODE !== "supabase" || presenceInterval) return;
    presenceBeat(true);
    presenceInterval = setInterval(() => presenceBeat(true), 30 * 1000);
  }

  function profileStatus(r) {
    if (!r) return "offline";
    if (r.bot) return "online";
    // No heartbeat column at all, or a row whose heartbeat was never written
    // (last_seen present but null/empty) -> presence is unknown, so keep the
    // old always-online behavior. Treating null as a timestamp here is what
    // made every account look offline: Date.parse(null) is NaN, which failed
    // the freshness check below.
    if (r.last_seen === undefined || r.last_seen === null || r.last_seen === "") return "online";
    if (r.status === "offline") return "offline";
    const lastSeen = Date.parse(r.last_seen);
    if (!lastSeen || Date.now() - lastSeen > PRESENCE_ONLINE_MS) return "offline";
    return r.status === "away" ? "away" : "online";
  }

  /* ------------------------------------------------------------------ *
   *  Supabase row <-> app shape helpers
   * ------------------------------------------------------------------ */
  function rowToProfile(r) {
    if (!r) return null;
    const st = profileStatus(r);
    return {
      id: r.id,
      username: r.username,
      bot: !!r.bot,
      online: st !== "offline",
      status: st,
      avatar: r.avatar || { type: "icon", name: "user", color: "#22c55e" },
      avatarPath: r.avatar_path || null,
      authId: r.auth_id || null,
      totalPlaytime: Number(r.total_playtime || 0),
      createdAt: r.created_at ? Date.parse(r.created_at) : 0,
    };
  }
  /* Marker stored in answered_at for invite rows on databases that don't have
     calls.room_id yet: it tells the invitee this row is "join the host's
     call", not a normal 1:1 ring (see findCallRoomFor). */
  const INVITE_MARK = "1970-01-01T00:00:00.000Z";

  function callRowToCall(r) {
    return {
      id: r.id,
      roomId: r.room_id || r.id,
      callerId: r.caller_id,
      calleeId: r.callee_id,
      kind: r.kind || "video",
      status: r.status,
      isInvite: !!(r.answered_at && Date.parse(r.answered_at) === 0),
      createdAt: r.created_at ? Date.parse(r.created_at) : now(),
    };
  }

  function msgRowToMsg(r) {
    return {
      id: r.id,
      convId: r.conversation_id,
      senderId: r.sender_id,
      content: r.content || "",
      type: r.type || "text",
      meta: r.meta || null,
      ts: r.created_at ? Date.parse(r.created_at) : Date.now(),
    };
  }
  function groupFromRow(c, members) {
    return {
      id: c.id,
      name: c.name || "Untitled",
      avatar: c.avatar || { type: "icon", name: "users", color: c.banner_color || "#22c55e" },
      bannerColor: c.banner_color || "#22c55e",
      members,
      memberCount: members.length,
      isMember: !!members.find((m) => m.id === myId()),
      createdAt: c.created_at ? Date.parse(c.created_at) : 0,
    };
  }
  // Select all profile columns so queries still work before/after the
  // presence migration (status, last_seen). Missing columns fall back to
  // "online" in profileStatus().
  const PROFILE_SELECT = "*";

  /* ------------------------------------------------------------------ *
   *  Supabase remote helpers
   * ------------------------------------------------------------------ */
  async function membersOfRemote(convDbId) {
    const { data } = await sb
      .from("conversation_members")
      .select(`conversation_id, profiles(${PROFILE_SELECT})`)
      .eq("conversation_id", convDbId);
    return (data || []).map((r) => rowToProfile(r.profiles)).filter(Boolean);
  }

  let friendIdCache = new Set();
  async function refreshFriendCacheRemote() {
    const meId = myId();
    const ids = new Set();
    const { data: out } = await sb.from("friendships").select("friend_id").eq("user_id", meId);
    (out || []).forEach((r) => ids.add(r.friend_id));
    const { data: inn } = await sb.from("friendships").select("user_id").eq("friend_id", meId);
    (inn || []).forEach((r) => ids.add(r.user_id));
    ids.delete(meId);
    friendIdCache = ids;
    return [...ids];
  }

  async function ensureDmRemote(otherId) {
    if (otherId === JERRY_ID) return { id: convIdFor(JERRY_ID), otherId };
    const meId = myId();
    const { data: myRows } = await sb.from("conversation_members").select("conversation_id").eq("user_id", meId);
    const myConvs = (myRows || []).map((r) => r.conversation_id);
    if (myConvs.length) {
      const { data: otherRows } = await sb
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", otherId)
        .in("conversation_id", myConvs);
      const shared = (otherRows || []).map((r) => r.conversation_id);
      if (shared.length) {
        const { data: convs } = await sb.from("conversations").select("id").in("id", shared).eq("type", "dm");
        if (convs && convs.length) return { id: convs[0].id, otherId };
      }
    }
    const { data: conv, error } = await sb.from("conversations").insert({ type: "dm" }).select().single();
    if (error) throw error;
    await sb.from("conversation_members").insert([
      { conversation_id: conv.id, user_id: meId },
      { conversation_id: conv.id, user_id: otherId },
    ]);
    return { id: conv.id, otherId };
  }

  async function getFriendsRemote() {
    const ids = await refreshFriendCacheRemote();
    if (!ids.length) return [];
    const { data } = await sb.from("profiles").select(PROFILE_SELECT).in("id", ids);
    return (data || []).map(rowToProfile);
  }

  async function getDirectoryRemote(query) {
    const q = (query || "").toLowerCase().trim();
    const meId = myId();
    let b = sb.from("profiles").select(PROFILE_SELECT).neq("id", meId);
    if (q) b = b.ilike("username", `%${q}%`);
    b = b.limit(50);
    const { data } = await b;
    if (!friendIdCache.size) await refreshFriendCacheRemote();
    return (data || []).map((p) => ({ profile: rowToProfile(p), isFriend: friendIdCache.has(p.id) }));
  }

  async function addFriendRemote(otherId) {
    if (otherId === JERRY_ID) return { id: convIdFor(JERRY_ID), otherId };
    try {
      await sb.from("friendships").insert({ user_id: myId(), friend_id: otherId });
    } catch (e) {
      console.warn("[db] addFriend", e);
    }
    await ensureDmRemote(otherId);
    await refreshFriendCacheRemote();
    return { id: convIdFor(otherId), otherId };
  }

  /* Remove a friend: clears both directions of the friendship row. The DM
     conversation itself is kept so old messages stay viewable. */
  async function removeFriendRemote(otherId) {
    if (!otherId || otherId === JERRY_ID) return;
    try {
      await sb.from("friendships").delete().match({ user_id: myId(), friend_id: otherId });
      await sb.from("friendships").delete().match({ user_id: otherId, friend_id: myId() });
      await refreshFriendCacheRemote();
    } catch (e) {
      console.warn("[db] removeFriend", e);
    }
  }
  function removeFriendLocal(otherId) {
    const d = local.data;
    d.friends = (d.friends || []).filter((id) => id !== otherId);
    local.save();
  }

  async function getDmListRemote() {
    const meId = myId();
    const { data: myRows } = await sb.from("conversation_members").select("conversation_id").eq("user_id", meId);
    const myConvs = (myRows || []).map((r) => r.conversation_id);
    if (!myConvs.length) return [];
    const { data: convs } = await sb.from("conversations").select("*").in("id", myConvs).eq("type", "dm");
    if (!convs || !convs.length) return [];
    const convIds = convs.map((c) => c.id);

    const { data: mems } = await sb
      .from("conversation_members")
      .select(`conversation_id, user_id, profiles(${PROFILE_SELECT})`)
      .in("conversation_id", convIds);
    const otherOf = {};
    (mems || []).forEach((r) => {
      if (r.user_id !== meId && r.profiles) otherOf[r.conversation_id] = rowToProfile(r.profiles);
    });

    const { data: msgs } = await sb
      .from("messages")
      .select("id, conversation_id, sender_id, content, type, meta, created_at")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false })
      .limit(400);
    const lastOf = {};
    (msgs || []).forEach((m) => {
      if (!lastOf[m.conversation_id]) lastOf[m.conversation_id] = msgRowToMsg(m);
    });

    return convs
      .filter((c) => otherOf[c.id])
      .map((c) => ({
        convId: c.id,
        other: otherOf[c.id],
        last: lastOf[c.id] || null,
        updatedAt: (lastOf[c.id] && lastOf[c.id].ts) || (c.created_at ? Date.parse(c.created_at) : 0),
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function getConversationRemote(convId) {
    const dbCid = dbConvId(convId);
    const { data: conv, error } = await sb.from("conversations").select("*").eq("id", dbCid).maybeSingle();
    if (error || !conv) return null;
    const { data: msgs } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", dbCid)
      .order("created_at", { ascending: true })
      .limit(500);
    const msgsArr = (msgs || []).map(msgRowToMsg);
    if (conv.type === "group") {
      const members = await membersOfRemote(dbCid);
      return { id: convId, type: "group", group: groupFromRow(conv, members), msgs: msgsArr };
    }
    const meId = myId();
    const { data: mems } = await sb
      .from("conversation_members")
      .select(`user_id, profiles(${PROFILE_SELECT})`)
      .eq("conversation_id", dbCid);
    const other = (mems || []).find((r) => r.user_id !== meId && r.profiles);
    return { id: convId, type: "dm", other: other ? rowToProfile(other.profiles) : null, msgs: msgsArr };
  }

  async function getMessagesRemote(convId) {
    const dbCid = dbConvId(convId);
    const { data } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", dbCid)
      .order("created_at", { ascending: true })
      .limit(500);
    return (data || []).map(msgRowToMsg);
  }

  async function sendMessageRemote(convId, text, msgId, extra) {
    const meta = (extra && extra.meta) || null;
    const msg = { id: msgId || uid(), convId, senderId: myId(), content: text, type: "text", meta, ts: now() };
    const row = {
      id: msg.id,
      conversation_id: dbConvId(convId),
      sender_id: myId(),
      content: text,
      type: "text",
    };
    if (meta) row.meta = meta;
    const { error } = await sb.from("messages").insert(row);
    if (error) console.warn("[db] sendMessage", error);
    return msg;
  }

  async function getGroupsRemote() {
    const meId = myId();
    const { data: myRows } = await sb.from("conversation_members").select("conversation_id").eq("user_id", meId);
    const myConvs = (myRows || []).map((r) => r.conversation_id);
    if (!myConvs.length) return [];
    const { data: convs } = await sb.from("conversations").select("*").in("id", myConvs).eq("type", "group");
    if (!convs || !convs.length) return [];
    const { data: mems } = await sb
      .from("conversation_members")
      .select(`conversation_id, user_id, profiles(${PROFILE_SELECT})`)
      .in("conversation_id", convs.map((c) => c.id));
    const byConv = {};
    (mems || []).forEach((r) => {
      if (r.profiles) (byConv[r.conversation_id] || (byConv[r.conversation_id] = [])).push(rowToProfile(r.profiles));
    });
    return convs.map((c) => groupFromRow(c, byConv[c.id] || []));
  }

  async function getGroupRemote(id) {
    const { data: conv } = await sb.from("conversations").select("*").eq("id", id).maybeSingle();
    if (!conv || conv.type !== "group") return null;
    const members = await membersOfRemote(id);
    return groupFromRow(conv, members);
  }

  async function createGroupRemote({ name, avatar, bannerColor }) {
    const g = {
      id: uid(),
      name: name || "New group",
      avatar: avatar || { type: "icon", name: "users", color: "#22c55e" },
      bannerColor: bannerColor || "#22c55e",
    };
    const { data: conv, error } = await sb
      .from("conversations")
      .insert({ id: g.id, type: "group", name: g.name, avatar: g.avatar, banner_color: g.bannerColor })
      .select()
      .single();
    if (error) throw error;
    await sb.from("conversation_members").insert({ conversation_id: conv.id, user_id: myId() });
    return groupFromRow(conv, [me()].filter(Boolean));
  }

  async function updateGroupRemote(id, patch) {
    const up = {};
    if (patch.name !== undefined) up.name = patch.name;
    if (patch.avatar !== undefined) up.avatar = patch.avatar;
    if (patch.bannerColor !== undefined) up.banner_color = patch.bannerColor;
    const { data: conv, error } = await sb.from("conversations").update(up).eq("id", id).select().single();
    if (error) throw error;
    const members = await membersOfRemote(id);
    return groupFromRow(conv, members);
  }

  async function inviteToGroupRemote(groupId, friendId) {
    const g = await getGroupRemote(groupId);
    if (!g) return null;
    const conv = await ensureDmRemote(friendId);
    const msg = {
      id: uid(),
      convId: conv.id,
      senderId: myId(),
      content: "",
      type: "invite",
      meta: { groupId: g.id, groupName: g.name, groupAvatar: g.avatar, groupColor: g.bannerColor, status: "pending" },
      ts: now(),
    };
    await sb.from("messages").insert({
      id: msg.id,
      conversation_id: conv.id,
      sender_id: myId(),
      content: "",
      type: "invite",
      meta: msg.meta,
    });
    return msg;
  }

  async function respondInviteRemote(msgId, accept) {
    const meId = myId();
    const { data: rows } = await sb.from("messages").select("*").eq("id", msgId).limit(1);
    const m = rows && rows[0];
    if (!m) return null;
    const meta = { ...(m.meta || {}), status: accept ? "accepted" : "declined" };
    await sb.from("messages").update({ meta }).eq("id", msgId);
    if (accept && meta.groupId) {
      try {
        await sb.from("conversation_members").insert({ conversation_id: meta.groupId, user_id: meId });
      } catch (e) {
        /* already a member */
      }
      await sb.from("messages").insert({
        id: uid(),
        conversation_id: meta.groupId,
        sender_id: meId,
        content: "",
        type: "system",
        meta: {
          groupId: meta.groupId,
          groupName: meta.groupName,
          system: `${(me() || {}).username || "Someone"} joined ${meta.groupName}`,
        },
      });
    }
    return msgRowToMsg({ ...m, meta });
  }

  /* ------------------------------------------------------------------ *
   *  Realtime
   * ------------------------------------------------------------------ */
  let realtimeCb = null;
  let messageCb = null;
  let rtTimer = null;
  let rtSetup = false;
  function notify() {
    if (!realtimeCb) return;
    clearTimeout(rtTimer);
    rtTimer = setTimeout(() => {
      try {
        realtimeCb();
      } catch (e) {
        console.warn(e);
      }
    }, 500);
  }

  function setupRealtime() {
    if (MODE !== "supabase") return;
    if (rtSetup) return;
    rtSetup = true;
    try {
      const ch = sb.channel("db-changes");
      ch.on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
        if (p.eventType === "INSERT") {
          if (messageCb) messageCb(msgRowToMsg(p.new));
          else notify();
        } else {
          notify();
        }
      });
      ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, notify);
      ch.on("postgres_changes", { event: "DELETE", schema: "public", table: "profiles" }, notify);
      ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (p) => {
        if (p.new && p.new.id === myId()) return; // own presence heartbeat — not interesting
        notify();
      });
      ch.on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, notify);
      ch.on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, notify);
      ch.on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, notify);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") console.info("[db] realtime subscribed");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") console.warn("[db] realtime status:", status);
      });
    } catch (e) {
      console.warn("[db] realtime setup failed", e);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Local-mode implementations (identical behavior to pre-Supabase)
   * ------------------------------------------------------------------ */
  async function localGetDirectory(query) {
    const q = (query || "").toLowerCase().trim();
    return localDirProfiles()
      .filter((p) => !q || p.username.toLowerCase().includes(q))
      .map((p) => ({ profile: p, isFriend: isFriendLocal(p.id) }));
  }
  async function localGetFriends() {
    return [JERRY_PROFILE].concat(
      local.data.friends.filter((id) => id !== JERRY_ID && id !== myId()).map(profileById).filter(Boolean)
    );
  }
  async function localEnsureDm(otherId) {
    const d = local.data;
    if (!d.dms[otherId]) {
      d.dms[otherId] = { id: convIdFor(otherId), otherId, updatedAt: now() };
      d.dmOrder = d.dmOrder.filter((x) => x !== otherId);
      d.dmOrder.push(otherId);
      local.save();
    }
    return { id: convIdFor(otherId), otherId };
  }
  async function localAddFriendFlow(otherId) {
    localAddFriend(otherId);
    return { id: convIdFor(otherId), otherId };
  }
  async function localGetDmList() {
    const d = local.data;
    const list = [];
    d.dmOrder.forEach((oid) => {
      const dm = d.dms[oid];
      if (!dm) return;
      const other = profileById(oid);
      if (!other) return;
      const msgs = d.msgs[dm.id] || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      list.push({ convId: dm.id, other, last, updatedAt: dm.updatedAt });
    });
    return list;
  }
  async function localGetConversation(convId) {
    const d = local.data;
    const oid = Object.keys(d.dms).find((k) => d.dms[k].id === convId);
    if (oid) return { id: convId, type: "dm", other: profileById(oid), msgs: d.msgs[convId] || [] };
    const gid = gidFromConv(convId);
    if (gid) {
      const g = localGroupById(gid);
      if (g) return { id: convId, type: "group", group: g, msgs: d.msgs[convId] || [] };
    }
    return null;
  }
  async function localGetMessages(convId) {
    const d = local.data;
    if (convId === convIdFor(JERRY_ID)) return d.jerryMsgs || [];
    return d.msgs[convId] || [];
  }
  /* Editing marks the row in meta rather than needing a new column, so the
     "edited" label works on the existing schema. */
  async function editMessageRemote(id, text) {
    if (!sb || MODE !== "supabase") return null;
    const meId = myId();
    if (!meId) return null;
    const { data: row, error: readErr } = await sb.from("messages")
      .select("meta")
      .eq("id", id)
      .maybeSingle();
    if (readErr) { console.warn("[db] editMessage read", readErr); return null; }
    const meta = { ...((row && row.meta) || {}), edited: true };
    const { data, error } = await sb.from("messages")
      .update({ content: text, meta })
      .eq("id", id)
      .eq("sender_id", meId)
      .select()
      .maybeSingle();
    if (error) { console.warn("[db] editMessage", error); return null; }
    return data ? msgRowToMsg(data) : null;
  }

  async function deleteMessageRemote(id) {
    if (!sb || MODE !== "supabase") return false;
    const meId = myId();
    if (!meId) return false;
    const { error } = await sb.from("messages").delete().eq("id", id).eq("sender_id", meId);
    if (error) { console.warn("[db] deleteMessage", error); return false; }
    return true;
  }

  async function editMessageLocal(id, text) {
    const d = local.data;
    for (const cid in d.msgs) {
      const m = (d.msgs[cid] || []).find((x) => String(x.id) === String(id));
      if (m) {
        m.content = text;
        m.meta = { ...(m.meta || {}), edited: true };
        local.save();
        return m;
      }
    }
    return null;
  }

  async function deleteMessageLocal(id) {
    const d = local.data;
    for (const cid in d.msgs) {
      const arr = d.msgs[cid] || [];
      const i = arr.findIndex((x) => String(x.id) === String(id));
      if (i >= 0) {
        arr.splice(i, 1);
        local.save();
        return true;
      }
    }
    return false;
  }

  async function localSendRemote(convId, text, msgId, extra) {
    const msg = { id: msgId || uid(), convId, senderId: myId(), content: text, type: "text", meta: (extra && extra.meta) || null, ts: now() };
    return localSendMsg(convId, msg);
  }
  async function localInviteToGroup(groupId, friendId) {
    const g = localGroupById(groupId);
    if (!g) return null;
    const cid = convIdFor(friendId);
    const msg = {
      id: uid(),
      convId: cid,
      senderId: myId(),
      content: "",
      type: "invite",
      meta: { groupId: g.id, groupName: g.name, groupAvatar: g.avatar, groupColor: g.bannerColor, status: "pending" },
      ts: now(),
    };
    return localSendMsg(cid, msg);
  }
  async function localRespondInvite(msgId, accept) {
    const d = local.data;
    for (const cid in d.msgs) {
      const m = d.msgs[cid].find((x) => x.id === msgId);
      if (m && m.type === "invite") {
        m.meta = { ...m.meta, status: accept ? "accepted" : "declined" };
        if (accept && m.meta.groupId) {
          const g = localGroupById(m.meta.groupId);
          if (g && g.members.indexOf(myId()) === -1) g.members.push(myId());
          if (g) {
            const myConv = convIdFor(m.senderId);
            localSendMsg(myConv, {
              id: uid(),
              convId: myConv,
              senderId: "system",
              content: "",
              type: "system",
              meta: { groupId: g.id, groupName: g.name, system: `${(me() || {}).username || "Someone"} joined ${g.name}` },
              ts: now(),
            });
          }
        }
        local.save();
        return m;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   *  Public API
   * ------------------------------------------------------------------ */
  const DB = {
    getMode: () => MODE,
    isJerry: (id) => id === JERRY_ID,
    avatarUrl: avatarUrl,
    uploadAvatar: uploadAvatar,
    uploadChatImage: uploadChatImage,

    /* --- playtime --- */
    /* --- sign-in (Google OAuth / emailed 6-digit code) --- */
    authState: authState,
    authUser: authUser,
    syncAuthSession: syncAuthSession,
    handoffPayload: handoffPayload,
    adoptHandoff: adoptHandoff,
    signInWithGoogle: signInWithGoogle,
    sendEmailCode: sendEmailCode,
    verifyEmailCode: verifyEmailCode,
    linkGoogle: linkGoogle,
    unlinkProvider: unlinkProvider,
    carryOverLegacy: carryOverLegacy,
    legacyCandidate: legacyCandidate,
    linkEmail: linkEmail,
    verifyLinkEmail: verifyLinkEmail,
    signOut: signOutNow,
    ensureProfileForUser: ensureProfileForUser,
    createProfileForUser: createProfileForUser,
    linkCurrentAccount: linkCurrentAccount,
    needsLink: needsLink,

    /* --- progress that used to be browser-only --- */
    pullProgress: pullProgress,
    pushProgress: pushProgress,
    startProgressSync: startProgressSync,

    getLocalPlaytimeTotal: localPlaytimeTotal,
    flushPlaytime: ptFlush,
    startPlaytimeSync: ptStartAutoSync,
    stopPlaytimeSync: ptStopAutoSync,

    /* --- leaderboard ---
       Reads the server-side total (the only value that counts) so the
       ranking is consistent across browsers. Every profile is shown —
       accounts that haven't played yet sit at the bottom with 0s rather
       than disappearing, so the board always matches the table.
       Pass a numeric limit to cap the rows returned (top N); omit it to
       fetch the whole table, which the paginated board does.
       Returns null when the query itself fails (missing schema, RLS,
       offline) so the UI can say "couldn't load" instead of "no users". */
    async getLeaderboard(limit) {
      if (MODE !== "supabase") return null;
      /* Ties need a tiebreaker: a dozen accounts sit at 0 seconds, and
         without a second sort Postgres may return them in a different
         order on every request, so the same account lands on a different
         row (and rank) each time the board is drawn. */
      let query = sb
        .from("profiles")
        .select("id, username, avatar, avatar_path, total_playtime, status, last_seen")
        .order("total_playtime", { ascending: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (Number.isFinite(limit)) query = query.limit(limit);
      let { data, error } = await query;
      if (error) {
        /* Presence migration not applied yet -> retry without the
           status columns (profileStatus falls back to always-online). */
        console.warn("[db] getLeaderboard", error);
        let retryQ = sb
          .from("profiles")
          .select("id, username, avatar, avatar_path, total_playtime")
          .order("total_playtime", { ascending: false })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
        if (Number.isFinite(limit)) retryQ = retryQ.limit(limit);
        const retry = await retryQ;
        if (retry.error) return null;
        data = retry.data;
      }
      return (data || [])
        .map((r) => ({
          id: r.id,
          username: r.username,
          avatar: r.avatar || { type: "icon", name: "user", color: "#22c55e" },
          avatarPath: r.avatar_path || null,
          totalPlaytime: Number(r.total_playtime || 0),
          status: profileStatus(r),
          isMe: !!(me() && r.id === me().id),
        }));
    },

    /* This browser's own global standing, used to pin a row at the bottom
       of the board when the account sits below the fetched top slice.
       Returns { rank, total, me } where me is the same shape as a
       getLeaderboard row, or null when unavailable / not signed in. */
    async getMyRank() {
      if (MODE !== "supabase") return null;
      const p = me();
      if (!p) return null;
      let { data, error } = await sb
        .from("profiles")
        .select("id, username, avatar, avatar_path, total_playtime, status, last_seen")
        .order("total_playtime", { ascending: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) {
        const retry = await sb
          .from("profiles")
          .select("id, username, avatar, avatar_path, total_playtime")
          .order("total_playtime", { ascending: false })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
        if (retry.error) return null;
        data = retry.data;
      }
      const all = data || [];
      const idx = all.findIndex((r) => r.id === p.id);
      if (idx < 0) return null;
      const r = all[idx];
      return {
        rank: idx + 1,
        total: all.length,
        me: {
          id: r.id,
          username: r.username,
          avatar: r.avatar || { type: "icon", name: "user", color: "#22c55e" },
          avatarPath: r.avatar_path || null,
          totalPlaytime: Number(r.total_playtime || 0),
          status: profileStatus(r),
          isMe: true,
        },
      };
    },

    async getProfile() {
      /* The auth session decides who this browser is; the cached profile
         follows it (and is dropped when signed out). */
      if (MODE === "supabase") {
        try { await syncAuthSession(); } catch (e) { console.warn("[db] syncAuthSession", e); }
      }
      const p = me();
      if (MODE === "supabase" && p) {
        try {
          const { data } = await sb.from("profiles").select("*").eq("id", p.id).maybeSingle();
          if (data) {
            const fresh = rowToProfile(data);
            local.data.profile = { ...p, username: fresh.username, avatar: fresh.avatar, avatarPath: fresh.avatarPath, status: fresh.status, totalPlaytime: fresh.totalPlaytime };
            local.save();
          } else {
            await sb.from("profiles").upsert({ id: p.id, username: p.username, avatar: p.avatar });
          }
        } catch (e) {
          console.warn("[db] getProfile remote", e);
        }
        /* Push whatever playtime this browser accumulated while signed
           out, then keep syncing on an interval. */
        ptFlush();
        ptStartAutoSync();
      }
      return me();
    },

    async createProfile({ username, avatar }) {
      /* A profile belongs to a sign-in now: id is the auth user id, so the
         onboarding form can only finish for an authenticated user. */
      const user = await authUser();
      if (!user) return null;
      const p = { id: user.id, username, avatar, online: true, createdAt: now() };
      if (MODE === "supabase") {
        let name = username;
        let stored = false;
        for (let i = 1; i < 100; i++) {
          const { error } = await sb.from("profiles").insert({ id: p.id, username: name, avatar });
          if (!error) { stored = true; break; }
          name = `${username}${i}`;
        }
        if (!stored) return null;
        p.username = name;
      }
      localCreateProfile(p);
      return p;
    },

    async updateProfile(patch) {
      const d = local.data;
      if (!d.profile) return null;
      const prev = d.profile;
      if (MODE === "supabase" && patch.username !== undefined && patch.username !== prev.username) {
        const { data } = await sb.from("profiles").select("id").eq("username", patch.username).limit(1);
        if (data && data.length) return null; // username already taken
      }
      /* The profile object uses camelCase (avatarPath) but the table
         column is snake_case, so map it back before writing the row. */
      const row = { ...patch };
      if (Object.prototype.hasOwnProperty.call(row, "avatarPath")) {
        row.avatar_path = row.avatarPath;
        delete row.avatarPath;
      }
      d.profile = { ...prev, ...patch };
      if (MODE === "supabase") {
        const { error } = await sb.from("profiles").update(row).eq("id", prev.id);
        if (error) {
          d.profile = prev;
          local.save();
          if (error.code === "23505") return null; // unique violation (race)
          console.warn("[db] updateProfile", error);
          return prev;
        }
      }
      local.save();
      return d.profile;
    },

    /* -- Jerry (always local) -- */
    async getJerryProfile() {
      return JERRY_PROFILE;
    },
    async jerrySend(text) {
      const d = local.data;
      const cid = convIdFor(JERRY_ID);
      const userMsg = { id: uid(), convId: cid, senderId: myId(), content: text, type: "text", ts: now() };
      localSendMsg(cid, userMsg);
      const reply = {
        id: uid(),
        convId: cid,
        senderId: JERRY_ID,
        content: text,
        type: "text",
        ts: now() + 1,
      };
      local.save();
      return { user: userMsg, reply };
    },
    async pushMessage(convId, msg) {
      return localSendMsg(convId, msg);
    },

    /* -- directory / friends -- */
    async getDirectory(query) {
      return MODE === "supabase" ? getDirectoryRemote(query) : localGetDirectory(query);
    },
    async getFriends() {
      return MODE === "supabase" ? getFriendsRemote() : localGetFriends();
    },
    isFriend: (id) => (MODE === "supabase" ? id === JERRY_ID || friendIdCache.has(id) : isFriendLocal(id)),

    async ensureDm(otherId) {
      return MODE === "supabase" ? ensureDmRemote(otherId) : localEnsureDm(otherId);
    },
    async addFriend(otherId) {
      return MODE === "supabase" ? addFriendRemote(otherId) : localAddFriendFlow(otherId);
    },
    async removeFriend(otherId) {
      return MODE === "supabase" ? removeFriendRemote(otherId) : removeFriendLocal(otherId);
    },

    /* -- DMs -- */
    async getDmList() {
      return MODE === "supabase" ? getDmListRemote() : localGetDmList();
    },
    async getConversation(convId) {
      return MODE === "supabase" ? getConversationRemote(convId) : localGetConversation(convId);
    },
    async getMessages(convId) {
      return MODE === "supabase" ? getMessagesRemote(convId) : localGetMessages(convId);
    },
    async sendMessage(convId, text, msgId, extra) {
      return MODE === "supabase"
        ? sendMessageRemote(convId, text, msgId, extra)
        : localSendRemote(convId, text, msgId, extra);
    },
    async editMessage(id, text) {
      return MODE === "supabase" ? editMessageRemote(id, text) : editMessageLocal(id, text);
    },
    async deleteMessage(id) {
      return MODE === "supabase" ? deleteMessageRemote(id) : deleteMessageLocal(id);
    },

    /* -- groups -- */
    async getGroups() {
      return MODE === "supabase" ? getGroupsRemote() : local.data.groups.map((g) => decorateGroup(g));
    },
    async getGroup(id) {
      if (MODE === "supabase") return getGroupRemote(id);
      const g = localGroupById(id);
      return g ? decorateGroup(g) : null;
    },
    async createGroup(o) {
      return MODE === "supabase" ? createGroupRemote(o) : createGroupLocal(o);
    },
    async updateGroup(id, patch) {
      if (MODE === "supabase") return updateGroupRemote(id, patch);
      const g = localGroupById(id);
      if (!g) return null;
      Object.assign(g, patch);
      local.save();
      return decorateGroup(g);
    },
    async inviteToGroup(groupId, friendId) {
      return MODE === "supabase" ? inviteToGroupRemote(groupId, friendId) : localInviteToGroup(groupId, friendId);
    },
    async respondInvite(msgId, accept) {
      return MODE === "supabase" ? respondInviteRemote(msgId, accept) : localRespondInvite(msgId, accept);
    },
    async getGroupMembers(groupId) {
      if (MODE === "supabase") return membersOfRemote(groupId);
      const g = localGroupById(groupId);
      if (!g) return [];
      return g.members.map(profileById).filter(Boolean);
    },

    /* -- calls (v1: 1-on-1 WebRTC, table is only the ring/handshake state) -- */
    /* Calls are signalling rows: once a call is over the row has no use, so
       they are swept from the table instead of piling up. Only rows this
       user took part in are removed (that is what row policies allow).
       Throttled to twice a day per browser. */
    async purgeOldCalls(days) {
      if (!sb || MODE !== "supabase") return 0;
      const meId = myId();
      if (!meId) return 0;
      const KEY = "rcdn-calls-purged";
      try {
        if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 12 * 3600 * 1000) return 0;
      } catch (e) {}
      const cutoff = new Date(Date.now() - (days || 1) * 86400000).toISOString();
      const { error } = await sb.from("calls")
        .delete()
        .or(`caller_id.eq.${meId},callee_id.eq.${meId}`)
        .lt("created_at", cutoff);
      if (error) { console.warn("[db] purgeOldCalls", error); return 0; }
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      return 1;
    },

    async startCall(otherId, kind, roomId) {
      if (MODE !== "supabase") throw new Error("calls unavailable (local mode)");
      const caller = myId();
      if (!caller) throw new Error("not signed in");
      if (!otherId) throw new Error("missing recipient");
      const row = { caller_id: caller, callee_id: otherId, kind: kind || "video", status: "ringing" };
      // room_id: for group calls, invite joins an existing room (same broadcast channel)
      if (roomId) row.room_id = roomId;
      const { data, error } = await sb.from("calls").insert(row).select().single();
      if (error) {
        // backward compat: if room_id column doesn't exist yet, retry without it
        if (roomId && /room_id/i.test(error.message || "")) {
          delete row.room_id;
          /* keep the invite recognisable without the column, so the invitee
             can look up the room of the call the inviter is already in */
          const r2 = await sb.from("calls").insert({ ...row, answered_at: INVITE_MARK }).select().single();
          if (r2.error) { console.warn("[db] startCall", r2.error); throw new Error(r2.error.message || "insert failed"); }
          return callRowToCall(r2.data);
        }
        console.warn("[db] startCall", error); throw new Error(error.message || "insert failed");
      }
      return callRowToCall(data);
    },
    async updateCall(callId, patch) {
      if (MODE !== "supabase") return null;
      const row = {};
      if (patch.status) row.status = patch.status;
      if (patch.answered) row.answered_at = new Date().toISOString();
      const { data, error } = await sb.from("calls").update(row).eq("id", callId).select().single();
      if (error) { console.warn("[db] updateCall", error); return null; }
      return callRowToCall(data);
    },
    async getCall(callId) {
      if (MODE !== "supabase") return null;
      const { data, error } = await sb.from("calls").select("*").eq("id", callId).maybeSingle();
      if (error) { console.warn("[db] getCall", error); return null; }
      return data ? callRowToCall(data) : null;
    },
    /* The player page needs to show who is ringing — the messenger's
       profile cache doesn't exist there. */
    async getProfileById(id) {
      if (MODE !== "supabase" || !id) return null;
      const { data, error } = await sb.from("profiles").select(PROFILE_SELECT).eq("id", id).maybeSingle();
      if (error) { console.warn("[db] getProfileById", error); return null; }
      return data ? rowToProfile(data) : null;
    },
    /* Fallback sweep for the realtime subscription: newest ringing call
       addressed to me from the last minute. */
    async getActiveIncomingCall() {
      if (MODE !== "supabase") return null;
      const meId = myId();
      if (!meId) return null;
      const since = new Date(Date.now() - 120 * 1000).toISOString();
      const { data, error } = await sb
        .from("calls")
        .select("*")
        .eq("callee_id", meId)
        .eq("status", "ringing")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) { console.warn("[db] activeIncoming", error); return null; }
      return data && data.length ? callRowToCall(data[0]) : null;
    },
    /* Fallback for databases created before calls-group-migration.sql. That
       migration adds calls.room_id, which is how an invite row normally
       carries the room of the call it is inviting people into. Without the
       column an invitee has no room to join (it would sit alone in a room
       named after its own row and hang at "connecting"), so look up the room
       of the call the person ringing them is already in. */
    async findCallRoomFor(userId, excludeId, opts) {
      if (MODE !== "supabase" || !userId) return null;
      let uid = String(userId);
      let skip = excludeId || null;
      let o = opts || {};
      /* Walk up invite rows: an invite carries no room on an old schema, but
         it points at whoever invited that person, whose own (accepted) call
         row does name the room. Bounded so a cycle can never spin. */
      for (let depth = 0; depth < 12 && uid; depth++) {
        let q = sb
          .from("calls")
          .select("*")
          .or("caller_id.eq." + uid + ",callee_id.eq." + uid)
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
          .limit(1);
        if (skip) q = q.neq("id", skip);
        /* the row we are joining is between the host and us, so ignore any
           other row that also has us on it (the host's other invites to us) */
        if (o.notWith) q = q.neq("caller_id", o.notWith).neq("callee_id", o.notWith);
        /* the host's call must have started before this invite */
        if (o.before) q = q.lt("created_at", o.before);
        const { data, error } = await q;
        if (error) { console.warn("[db] findCallRoomFor", error); return null; }
        const row = data && data[0];
        if (!row) return null;
        const stillInvite = !!(row.answered_at && Date.parse(row.answered_at) === 0);
        if (!stillInvite) return row.room_id || row.id;
        /* This row is an invite, not a room. Two cases:
           - uid was the one invited (callee): climb to whoever invited them
             and keep looking among that person's rows, avoiding rows with
             uid so the same pair is never picked twice.
           - uid ran the invite (caller): that row is only a door they opened
             for someone else, so skip it and look further back through
             uid's own rows. Treating it as a new host made the walk exclude
             every row the host is in and resolve no room at all, which is
             what left the 4th person stuck on "Connecting...". */
        if (String(row.callee_id) === uid) {
          o = { notWith: uid, before: row.created_at };
          uid = String(row.caller_id);
        } else {
          o = { notWith: o.notWith, before: row.created_at };
        }
        skip = row.id;
      }
      return null;
    },
    /* Live ring delivery. Every browser receives every call-row event
       (open anon policy, matching the rest of the schema) — the callback
       is only invoked for rows involving THIS user. */
    onIncomingCall(cb) {
      if (MODE !== "supabase") { DB._callsRt = "local"; return; }
      try {
        DB._callsRt = "connecting";
        const ch = sb.channel("calls-changes");
        ch.on("postgres_changes", { event: "*", schema: "public", table: "calls" }, (p) => {
          const row = p.new || p.old;
          if (!row || !cb) return;
          const meId = myId();
          if (row.caller_id !== meId && row.callee_id !== meId) return;
          cb(callRowToCall(row), p.eventType);
        });
        ch.subscribe((status) => {
          DB._callsRt = String(status || "").toLowerCase();
          if (status === "SUBSCRIBED") console.info("[db] calls realtime subscribed");
          else console.warn("[db] calls realtime status", status);
        });
      } catch (e) {
        DB._callsRt = "error";
        console.warn("[db] calls realtime setup failed", e);
      }
    },

    /* Realtime broadcast channel used for the WebRTC handshake
       (offer / answer / ICE candidates). Messages on it are transient —
       nothing is stored. Returns the channel; the caller subscribes it
       and sends { type: "broadcast", event: "sig", payload } frames. */
    callChannel(callId) {
      if (MODE !== "supabase") return null;
      return sb.channel("call:" + callId);
    },
    leaveCallChannel(ch) {
      if (MODE !== "supabase" || !ch) return;
      try { sb.removeChannel(ch); } catch (e) { console.warn("[db] leaveCallChannel", e); }
    },

    onRealtime(cb) {
      realtimeCb = cb;
      setupRealtime();
    },

    onMessage(cb) {
      messageCb = cb;
    },

    /* -- presence (heartbeat + own status) -- */
    startPresence,
    getPresenceStatus: () => presenceStatus,
    onStatusChange(cb) { presenceStatusCb = cb; },
    async markActive() {
      const wasAway = presenceStatus !== "online";
      setPresenceStatus("online");
      if (local.data.profile) local.data.profile.status = "online";
      presenceBeat(wasAway); // force a write when coming back from away/offline
    },
    async setAway() {
      setPresenceStatus("away");
      if (local.data.profile) {
        local.data.profile.status = "away";
        local.save();
      }
      presenceBeat(true);
    },
    async setOffline() {
      setPresenceStatus("offline");
      if (local.data.profile) {
        local.data.profile.status = "offline";
        local.save();
      }
      presenceBeat(true);
    },
  };

  async function createGroupLocal({ name, avatar, bannerColor }) {
    const g = {
      id: uid(),
      name: name || "New group",
      avatar: avatar || { type: "icon", name: "users", color: "#22c55e" },
      bannerColor: bannerColor || "#22c55e",
      members: myId() ? [myId()] : [],
      createdAt: now(),
    };
    local.data.groups.push(g);
    local.save();
    return decorateGroup(g);
  }

  window.DB = DB;
  if (MODE === "local") console.info("[db] local mode active");
})();
