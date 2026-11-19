/* messenger.js — the Discord-style messenger app.
 * Mounted inside #messenger-view (index.html). Three sidebars:
 *   site rail (index)  . groups bar (rail-b)  . context rail (rail-c)  . chat
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */
  const esc = (s) =>
    String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  const icons = (name) => `<i data-lucide="${name}"></i>`;
  const paintIcons = () => {
    if (window.lucide) lucide.createIcons();
  };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2, 10));

  function fmtTime(ts) {
    const d = new Date(ts);
    let h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function fmtDivider(ts) {
    const d = new Date(ts);
    const nowD = new Date();
    const yest = new Date(nowD.getTime() - 864e5);
    const day = sameDay(d, nowD) ? "Today" : sameDay(d, yest) ? "Yesterday" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${day} at ${fmtTime(ts)}`;
  }

  /* ------------------------------------------------------------------ *
   *  Constants
   * ------------------------------------------------------------------ */
  const DIVIDER_MS = 10 * 60 * 1000;
  const GROUP_MS = 5 * 60 * 1000;

  const PALETTE = [
    "#f43f5e", "#f97316", "#facc15", "#84cc16", "#22c55e", "#14b8a6",
    "#06b6d4", "#3b82f6", "#8b5cf6", "#a855f7", "#ec4899", "#64748b",
  ];
  const ANIMALS = [
    "cat", "dog", "bird", "fish", "rabbit", "turtle",
    "paw-print", "fox", "crow", "snake", "bee", "rat",
    "snail", "spider", "squirrel", "bug",
  ];

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */
  let profile = null;
  let view = "home"; // 'home' | 'group'
  let activeConv = null;
  let activeGroupId = null;
  let settingsOpen = false;
  let profileSettingsOpen = false;
  let onboardingStep = 1;
  let obUsername = "";
  let typingTimer = null;

  let picker = {
    icon: "cat",
    color: PALETTE[4],
    bannerColor: PALETTE[4],
    image: null,
  };

  /* ------------------------------------------------------------------ *
   *  Element helpers
   * ------------------------------------------------------------------ */
  const rootEl = document.getElementById("messenger-view");

  function avatarHtml(a, cls) {
    const c = cls || "avatar avatar-m";
    if (a && a.type === "image" && a.value) {
      return `<span class="${c}" style="background:#2a2a2a"><img src="${esc(a.value)}" alt=""/></span>`;
    }
    const color = a && a.color ? a.color : "#888";
    const icon = a && a.type === "icon" ? a.name : "user";
    return `<span class="${c}" style="background:${esc(color)}">${icons(icon)}</span>`;
  }

  function statusOf(p) {
    if (!p) return "offline";
    if (p.bot) return "online";
    if (profile && p.id === profile.id) return profile.status || "online";
    return p.status || (p.online ? "online" : "offline");
  }
  function statusText(st) {
    return st === "away" ? "Away" : st === "online" ? "Online" : "Offline";
  }

  function avatarWrapHtml(a, cls, st) {
    const s = st || "offline";
    return `<span class="avatar-wrap${s !== "offline" ? " " + s : ""}">${avatarHtml(a, cls)}<span class="status-dot"></span></span>`;
  }

  function botTag(tag) {
    return `<span class="bot-tag">${icons("bot")}${esc(tag)}</span>`;
  }

  function previewOf(m) {
    if (!m) return "No messages yet";
    if (m.type === "invite") return "Group invite";
    if (m.type === "system") return m.meta && m.meta.system;
    return m.content.length > 42 ? m.content.slice(0, 42) + "…" : m.content;
  }

  function senderProfile(id) {
    if (profile && id === profile.id) return profile;
    if (id === "system") return null;
    if (id === "jerry") return { username: "Jerry", bot: true, tag: "BOT", avatar: { type: "icon", name: "bot", color: "#8b5cf6" } };
    let p = null;
    cacheDms.forEach((d) => {
      if (d.other && d.other.id === id) p = d.other;
    });
    if (!p && activeGroupId) {
      const g = cacheGroups.find((x) => x.id === activeGroupId);
      const m = g && g.members.find((x) => x.id === id);
      if (m) p = m;
    }
    return p;
  }

  function senderName(id) {
    const p = senderProfile(id);
    return p ? p.username : "Unknown";
  }

  function avatarForSender(id) {
    const p = senderProfile(id);
    if (p && p.avatar) return p.avatar;
    return { type: "icon", name: "user", color: "#666" };
  }

  /* ------------------------------------------------------------------ *
   *  Local caches
   * ------------------------------------------------------------------ */
  let cacheDms = [];
  let cacheGroups = [];

  function stateDmOther(id) {
    if (id === "jerry") return { id: "jerry", username: "Jerry", bot: true, tag: "BOT", avatar: { type: "icon", name: "bot", color: "#8b5cf6" } };
    const d = cacheDms.find((x) => x.other && x.other.id === id);
    return d ? d.other : null;
  }

  /* ------------------------------------------------------------------ *
   *  Tab switching (site rail)
   * ------------------------------------------------------------------ */
  const tabGames = document.getElementById("tab-games");
  const tabMessages = document.getElementById("tab-messages");
  const tabMovies = document.getElementById("tab-movies");
  const tabCamera = document.getElementById("tab-camera");

  function setRail(which) {
    if (tabGames) tabGames.classList.toggle("active", which === "games");
    if (tabMessages) tabMessages.classList.toggle("active", which === "messages");
    if (tabMovies) tabMovies.classList.toggle("active", which === "movies");
    if (tabCamera) tabCamera.classList.toggle("active", which === "camera");
  }

  function hideCameraView() {
    const cv = document.getElementById("camera-view");
    if (cv) cv.hidden = true;
    if (window.stopCamera) window.stopCamera();
  }

  function hideMovies() {
    const mv = document.getElementById("movies-view");
    if (mv) mv.hidden = true;
    const pl = document.getElementById("movie-player");
    if (pl) pl.hidden = true;
    const vid = document.getElementById("movie-video");
    if (vid) {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
    }
    const fr = document.getElementById("movie-frame");
    if (fr) fr.src = "about:blank";
  }

  if (tabGames) tabGames.addEventListener("click", () => {
    rootEl.hidden = true;
    document.body.classList.remove("messenger-mode", "camera-mode", "movies-mode");
    hideCameraView();
    hideMovies();
    setRail("games");
  });

  if (tabMessages) tabMessages.addEventListener("click", openMessenger);

  if (tabMovies) tabMovies.addEventListener("click", () => {
    rootEl.hidden = true;
    document.body.classList.remove("messenger-mode", "camera-mode");
    hideCameraView();
    setRail("movies");
    if (window.openMovies) window.openMovies();
  });

  if (tabCamera) tabCamera.addEventListener("click", () => {
    rootEl.hidden = true;
    document.body.classList.remove("messenger-mode", "movies-mode");
    hideMovies();
    document.body.classList.add("camera-mode");
    setRail("camera");
    if (window.showCamera) window.showCamera();
    window.scrollTo(0, 0);
  });

  /* ------------------------------------------------------------------ *
   *  Open / render pipeline
   * ------------------------------------------------------------------ */
  async function openMessenger() {
    rootEl.hidden = false;
    document.body.classList.remove("camera-mode", "movies-mode");
    hideCameraView();
    hideMovies();
    document.body.classList.add("messenger-mode");
    setRail("messages");
    /* Presence dots and membership only need to stream while this panel is
       on screen; every other view stays on the messages-only channel. */
    if (DB.requestSocialRealtime) DB.requestSocialRealtime();
    // First load: show the loading bar while data is fetched from the backend.
    if (!rootEl.querySelector(".rail-b")) rootEl.innerHTML = loadingHtml();
    profile = await DB.getProfile();
    if (DB.startPresence) DB.startPresence();
    if (!profile) {
      showOnboarding();
      return;
    }
    view = "home";
    activeConv = null;
    activeGroupId = null;
    settingsOpen = false;
    profileSettingsOpen = false;
    try {
      await refresh();
    } catch (e) {
      console.error("[messenger] load failed", e);
      rootEl.innerHTML = `<div class="loading">Couldn't load messages.</div>`;
    }
  }

  function loadingHtml() {
    return `<div class="loading"><div class="bar"><div class="bar-fill"></div></div></div>`;
  }

  async function refresh() {
    [cacheDms, cacheGroups] = await Promise.all([DB.getDmList(), DB.getGroups()]);
    render();
  }

  function render() {
    rootEl.innerHTML = `
      <section class="rail-b" id="rail-b"></section>
      <section class="rail-c" id="rail-c"></section>
      <section class="chat" id="chat"></section>
      <input type="file" accept="image/*" id="msg-file-input" hidden />
      ${profile ? accountBarHtml() : ""}
    `;
    renderRailB();
    renderRailC();
    renderChat();
    paintIcons();
    lastSelfStatus = profile ? statusOf(profile) : "";
  }

  function accountBarHtml() {
    const self = profile;
    const st = statusOf(self);
    return `
      <div class="account-bar">
        <button class="account-self" title="${esc(self.username)}">
          ${avatarWrapHtml(self.avatar, "avatar avatar-m", st)}
          <span class="account-meta">
            <span class="account-name">${esc(self.username)}</span>
            <span class="account-sub${st === "away" ? " away" : ""}">${icons("circle")} ${st === "away" ? "Away" : "Online"}</span>
          </span>
        </button>
        <button class="account-settings" data-act="profile-settings" title="Edit profile">${icons("settings")}</button>
      </div>`;
  }

  let lastSelfStatus = "";

  function renderAccountBarOnly() {
    const old = $(".account-bar");
    if (!old || !profile) return;
    const st = statusOf(profile);
    if (st === lastSelfStatus) return;
    lastSelfStatus = st;
    const wrap = document.createElement("div");
    wrap.innerHTML = accountBarHtml();
    old.replaceWith(wrap.firstElementChild);
    paintIcons();
  }

  /* ------------------------------------------------------------------ *
   *  Rail B — groups bar
   * ------------------------------------------------------------------ */
  function renderRailB() {
    const b = $("#rail-b");
    const groups = cacheGroups;
    b.innerHTML = `
      <button class="gbar-btn ${view === "home" ? "active" : ""}" data-act="home" title="Messages">
        ${icons("messages-square")}
      </button>
      <button class="gbar-btn" data-act="newgroup" title="Create group">
        ${icons("plus")}
      </button>
      <div class="gbar-divider"></div>
      <div class="groups-scroll">
        ${groups
          .map(
            (g) => `
          <button class="gbar-avatar ${activeGroupId === g.id ? "active" : ""}" data-gid="${g.id}" title="${esc(g.name)}">
            ${avatarHtml(g.avatar, "avatar")}
            <span class="group-tooltip">${esc(g.name)}</span>
          </button>`
          )
          .join("")}
        ${groups.length ? "" : `<div class="empty-hint" style="font-size:11px;padding:4px 0;line-height:1.5">No groups yet.<br/>Press + to create one.</div>`}
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   *  Rail C — context bar
   * ------------------------------------------------------------------ */
  async function renderRailC() {
    const c = $("#rail-c");
    if (view === "group" && activeGroupId) {
      const g = cacheGroups.find((x) => x.id === activeGroupId) || (await DB.getGroup(activeGroupId));
      if (!g) {
        view = "home";
        activeGroupId = null;
        renderRailC();
        return;
      }
      const friendIds = new Set((await DB.getFriends()).map((f) => f.id));
      const members = [...g.members].sort((a, b) => {
        const selfRank = (x) => (profile && x.id === profile.id ? 0 : 1);
        return selfRank(a) - selfRank(b);
      });
      c.innerHTML = `
        <div class="group-card" style="--gcolor:${esc(g.bannerColor)}">
          ${avatarHtml(g.avatar, "avatar avatar-l")}
          <div class="gc-meta">
            <h3>${esc(g.name)}</h3>
            <p class="member-count">${icons("users")} ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <button class="rail-c-btn" data-act="settings">${icons("settings")} Group settings</button>
        <button class="rail-c-btn" data-act="invite-group">${icons("user-plus")} Invite people</button>
        <div class="member-list">
          ${members
            .map((m) => {
              const isSelf = profile && m.id === profile.id;
              const isFriend = friendIds.has(m.id);
              const st = statusOf(m);
              return `
            <div class="member-card">
              ${avatarWrapHtml(m.avatar, "avatar avatar-s", st)}
              <div class="member-meta">
                <div class="member-name">${esc(m.username)}${isSelf ? `<span class="member-me">(me)</span>` : ""}${m.bot ? botTag(m.tag) : ""}</div>
                <div class="member-sub${st === "away" ? " away" : ""}">${statusText(st)}</div>
              </div>
              ${isSelf ? "" : `
              <div class="member-actions">
                <button class="member-action" data-act="member-dm" data-user="${esc(m.id)}" title="Message ${esc(m.username)}">${icons("message-circle")}</button>
                ${isFriend
                  ? `<button class="member-action done" title="Already friends">${icons("check")}</button>`
                  : `<button class="member-action" data-act="member-addfriend" data-user="${esc(m.id)}" title="Add ${esc(m.username)} as friend">${icons("user-plus")}</button>`}
              </div>`}
            </div>`;
            })
            .join("")}
        </div>
      `;
      paintIcons();
      return;
    }

    const pinned = cacheDms.filter((d) => d.other && d.other.bot);
    const rest = cacheDms
      .filter((d) => !(d.other && d.other.bot))
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const dmItem = (dm) => `
      <div class="dm-item ${activeConv === dm.convId ? "active" : ""}" data-conv="${dm.convId}">
        ${avatarWrapHtml(dm.other.avatar, "avatar avatar-m", statusOf(dm.other))}
        <div class="dm-meta">
          <div class="dm-name">${esc(dm.other.username)}${dm.other.tag ? botTag(dm.other.tag) : ""}</div>
          <div class="dm-preview">${esc(previewOf(dm.last))}</div>
        </div>
        <div class="dm-time">${dm.last ? fmtTime(dm.last.ts) : ""}</div>
      </div>`;

    c.innerHTML = `
      <div class="rail-c-head">
        <div class="rail-c-title">Messages</div>
        <button class="add-friend-btn" data-act="addfriend">${icons("user-plus")} Add friends</button>
      </div>
      <div class="dm-list">
        ${pinned.length ? `<div class="section-label">Pinned</div>${pinned.map(dmItem).join("")}` : ""}
        ${rest.length ? `<div class="section-label">Messages</div>${rest.map(dmItem).join("")}` : ""}
        ${!cacheDms.length ? `<div class="empty-hint">No conversations yet. Add friends to start chatting.</div>` : ""}
      </div>
    `;
    paintIcons();
  }

  /* ------------------------------------------------------------------ *
   *  Chat panel
   * ------------------------------------------------------------------ */
  async function renderChat() {
    const chat = $("#chat");
    let title = "";
    let sub = "";
    let gcolor = "";
    let convMsgs = null;

    if (activeConv) {
      const conv = await DB.getConversation(activeConv);
      if (conv) {
        convMsgs = conv.msgs;
        if (conv.type === "dm" && conv.other) {
          title = `${conv.other.username}`;
          sub = conv.other.bot ? "News bot" : "Direct message";
        } else if (conv.group) {
          title = conv.group.name;
          sub = `${conv.group.memberCount} member${conv.group.memberCount === 1 ? "" : "s"}`;
          gcolor = conv.group.bannerColor;
        }
      }
    }

    chat.innerHTML = `
      <div class="chat-head">
        ${gcolor ? `<div class="gcolor-bar" style="--gcolor:${esc(gcolor)}"></div>` : ""}
        <div class="chat-title">
          ${activeConv && activeConv.startsWith("g_") ? icons("hash") : ""}
          <span>${esc(title)}</span>
        </div>
        ${sub ? `<div class="chat-sub">${esc(sub)}</div>` : ""}
      </div>
      <div class="chat-scroll" id="chat-scroll">${activeConv ? "" : emptyChatHtml()}</div>
      ${activeConv ? composerHtml() : ""}
      ${settingsOpen ? await settingsSheetHtml() : ""}
      ${profileSettingsOpen ? profileSettingsSheetHtml() : ""}
    `;
    if (activeConv) {
      const msgs = convMsgs !== null ? convMsgs : await DB.getMessages(activeConv);
      renderMessages(mergeMsgs(activeConv, msgs));
    } else {
      paintIcons();
    }
    const input = $("#composer-input");
    if (input) input.focus();
  }

  function emptyChatHtml() {
    return `
      <div class="chat-empty">
        ${icons("messages-square")}
        <h3>Select a conversation</h3>
        <p>Pick a friend or group from the sidebars to start messaging.</p>
      </div>`;
  }

  function composerHtml() {
    return `
      <div class="chat-composer">
        <div class="composer">
          <input class="composer-input" id="composer-input" placeholder="Message..." autocomplete="off" />
          <button class="send-btn" data-act="send" title="Send">${icons("send")}</button>
        </div>
      </div>`;
  }

  function renderMessages(msgs) {
    const scroll = $("#chat-scroll");
    if (!scroll) return;
    const wasPinned = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;

    let html = "";
    let prevTs = null;
    let prevSender = null;
    let prevType = null;

    msgs.forEach((m) => {
      const gap = prevTs ? m.ts - prevTs : Infinity;
      const dayChange = prevTs ? !sameDay(new Date(prevTs), new Date(m.ts)) : false;
      const newBlock = !prevTs || gap > DIVIDER_MS || dayChange;
      if (newBlock) {
        html += `<div class="msg-divider"><span>${fmtDivider(m.ts)}</span></div>`;
        prevSender = null;
        prevType = null;
      }
      if (m.type === "system") {
        html += `<div class="msg-system">${esc(m.meta && m.meta.system)}</div>`;
        prevSender = null;
        prevType = "system";
      } else if (m.type === "invite") {
        html += `<div class="msg">${avatarHtml(avatarForSender(m.senderId), "avatar avatar-m")}<div class="msg-body">${inviteCardHtml(m)}</div></div>`;
        prevSender = null;
        prevType = "invite";
      } else {
        const grouped = prevSender === m.senderId && prevType === "text" && gap <= GROUP_MS;
        const own = m.senderId === profile.id;
        html += `<div class="msg${grouped ? " grouped" : ""}${own ? " own" : ""}">${
          grouped
            ? ""
            : `${avatarHtml(avatarForSender(m.senderId), "avatar avatar-m")}`
        }<div class="msg-body">
          ${grouped ? "" : authorRowHtml(m)}
          <div class="msg-text">${esc(m.content)}</div>
        </div></div>`;
        prevSender = m.senderId;
        prevType = "text";
      }
      prevTs = m.ts;
    });

    html += typingHtml();
    scroll.innerHTML = html || `<div class="empty-hint">No messages yet. Say hi!</div>`;
    paintIcons();

    if (wasPinned || typingTimer) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  function authorRowHtml(m) {
    const p = senderProfile(m.senderId);
    const own = m.senderId === (profile && profile.id);
    return `<div class="msg-author">
      <span class="msg-username">${esc(senderName(m.senderId))}${own ? `<span class="msg-me">(me)</span>` : ""}${p && p.bot ? botTag(p.tag) : ""}</span>
      <span class="msg-time">${fmtTime(m.ts)}</span>
    </div>`;
  }

  function typingHtml() {
    return typingTimer
      ? `<div class="typing-row"><div class="typing-dots"><i></i><i></i><i></i></div> Jerry is typing…</div>`
      : "";
  }

  function inviteCardHtml(m) {
    const meta = m.meta || {};
    const isPending = meta.status === "pending";
    const mine = m.senderId === (profile && profile.id);
    const dm = cacheDms.find((x) => x.convId === activeConv);
    const recipientName = dm && dm.other ? dm.other.username : "";
    const line = mine
      ? `You invited <b>${esc(recipientName)}</b> to join <b>${esc(meta.groupName || "a group")}</b>.`
      : `<b>${esc(senderName(m.senderId))}</b> invited you to join <b>${esc(meta.groupName || "a group")}</b>.`;
    const grp = cacheGroups.find((g) => g.id === meta.groupId) || {};
    const gcolor = grp.bannerColor || meta.groupColor || "#333";
    const gAvatar = grp.avatar || meta.groupAvatar || { type: "icon", name: "users", color: gcolor };
    let status;
    if (isPending && mine) {
      status = `<div class="invite-actions"><button class="btn primary small" data-gid="${esc(meta.groupId)}">${icons("external-link")} View group</button></div>`;
    } else if (isPending) {
      status = `<div class="invite-actions"><button class="btn primary small" data-msg="${m.id}" data-act="accept-invite">Accept</button><button class="btn ghost small" data-msg="${m.id}" data-act="decline-invite">Decline</button></div>`;
    } else {
      status = `<span class="invite-status ${meta.status === "accepted" ? "ok" : "no"}">${meta.status === "accepted" ? "✓ Joined" : "Declined"}</span>`;
    }
    return `
      <div class="invite-card" style="--gcolor:${esc(gcolor)}">
        <div class="invite-top">${avatarHtml(gAvatar, "avatar")}</div>
        <div class="invite-body">
          <h4>Group invite</h4>
          <p>${line}</p>
          ${status}
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ *
   *  Profile settings sheet
   * ------------------------------------------------------------------ */
  function openProfileSettings() {
    const a = (profile && profile.avatar) || { type: "icon", name: "cat", color: PALETTE[4] };
    picker = {
      icon: a.type === "icon" ? a.name : "cat",
      color: a.color || PALETTE[4],
      bannerColor: PALETTE[4],
      image: a.type === "image" ? a.value : null,
    };
    profileSettingsOpen = true;
    render();
  }

  function profileSettingsSheetHtml() {
    return `
      <div class="settings-sheet">
        <div class="settings-pane">
          <h2>Edit profile</h2>
          <label class="field">Username</label>
          <input class="input" id="ps-username" value="${esc(profile.username)}" maxlength="24" autocomplete="off" />
          <span class="field-error" id="ps-error"></span>
          <label class="field">Avatar</label>
          <div class="avatar-preview">${avatarHtml(pickerValue(), "avatar avatar-l")}</div>
          <div class="onboard-avatar-options">
            ${uploadPaneHtml()}
            ${iconPaneHtml()}
          </div>
          <div class="modal-actions">
            <button class="btn ghost" data-act="close-profile-settings">Cancel</button>
            <button class="btn primary" data-act="save-profile-settings">Save changes</button>
          </div>
        </div>
      </div>`;
  }

  async function saveProfileSettings() {
    const nameInput = $("#ps-username");
    if (!nameInput) return;
    const errorEl = $("#ps-error");
    if (errorEl) errorEl.textContent = "";
    const uname = nameInput.value.trim();
    if (!uname) {
      nameInput.focus();
      nameInput.style.borderColor = "#ff4444";
      if (errorEl) errorEl.textContent = "Username can't be empty.";
      return;
    }
    const saved = await DB.updateProfile({ username: uname, avatar: pickerValue() });
    if (!saved) {
      nameInput.style.borderColor = "#ff4444";
      if (errorEl) errorEl.textContent = "That username is already taken.";
      return;
    }
    profile = saved;
    profileSettingsOpen = false;
    await refresh();
  }

  /* ------------------------------------------------------------------ *
   *  Group settings sheet
   * ------------------------------------------------------------------ */
  async function settingsSheetHtml() {
    const g = cacheGroups.find((x) => x.id === activeGroupId);
    if (!g) return "";
    return `
      <div class="settings-sheet">
        <div class="settings-pane">
          <h2>Group settings</h2>
          <label class="field">Group name</label>
          <input class="input" id="gs-name" value="${esc(g.name)}" maxlength="32" autocomplete="off" />
          <label class="field">Group icon</label>
          <div class="avatar-preview">${avatarHtml(pickerValue(), "avatar avatar-l")}</div>
          <div class="onboard-avatar-options">
            ${uploadPaneHtml()}
            ${iconPaneHtml()}
          </div>
          <label class="field">Banner / card color</label>
          <div class="color-row" data-colortarget="banner">${colorRowHtml("banner")}</div>
          <div class="modal-actions">
            <button class="btn ghost" data-act="close-settings">Cancel</button>
            <button class="btn primary" data-act="save-settings">Save changes</button>
          </div>
        </div>
      </div>`;
  }

  function uploadPaneHtml() {
    return `<div class="option-pane">
      <h4>${icons("upload")} Upload a photo</h4>
      <div class="upload-zone" data-act="upload">
        ${picker.image ? `<div class="upload-preview"><img src="${esc(picker.image)}" alt=""/></div>` : icons("image-up")}
        <p>${picker.image ? "Click to change" : "Click to upload an image"}</p>
      </div>
    </div>`;
  }

  function iconPaneHtml() {
    return `<div class="option-pane">
      <h4>${icons("paw-print")} Pick an icon</h4>
      <div class="icon-grid">
        ${ANIMALS.map((a) => `<button class="icon-cell ${picker.icon === a ? "selected" : ""}" style="--gcolor:${esc(picker.color)}" data-icon="${a}" title="${a}">${icons(a)}</button>`).join("")}
      </div>
      <div class="color-row" data-colortarget="avatar">${colorRowHtml("avatar")}</div>
    </div>`;
  }

  function colorRowHtml(target) {
    const sel = target === "banner" ? picker.bannerColor : picker.color;
    return PALETTE.map(
      (c) => `<button class="color-swatch ${sel === c ? "selected" : ""}" style="background:${c}" data-color="${c}" data-target="${target}" title="${c}"></button>`
    ).join("");
  }

  function pickerValue() {
    if (picker.image) return { type: "image", value: picker.image, color: picker.color };
    return { type: "icon", name: picker.icon, color: picker.color };
  }

  /* ------------------------------------------------------------------ *
   *  Sending
   * ------------------------------------------------------------------ */
  async function doSend() {
    const input = $("#composer-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text || !activeConv) return;
    input.value = "";

    if (activeConv === "dm_jerry") {
      const { reply } = await DB.jerrySend(text);
      await renderChatKeepBottom();
      typingTimer = setTimeout(() => {
        DB.pushMessage("dm_jerry", reply);
        typingTimer = null;
        renderChatKeepBottom();
      }, 650 + Math.random() * 450);
      await renderChatKeepBottom();
      return;
    }
    const msg = { id: uid(), convId: activeConv, senderId: profile.id, content: text, type: "text", ts: Date.now() };
    addPending(msg);
    await renderChatKeepBottom();
    try {
      await DB.sendMessage(activeConv, text, msg.id);
    } catch (e) {
      console.warn("[messenger] send failed", e);
    }
    removePending(msg.id);
    await renderChatKeepBottom();
    touchDm(activeConv, msg);
    reorderDmList();
  }

  async function renderChatKeepBottom() {
    const scroll = $("#chat-scroll");
    const pinned = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90 : true;
    await renderChat();
    const s2 = $("#chat-scroll");
    if (s2 && pinned) s2.scrollTop = s2.scrollHeight;
  }

  /* -- optimistic outbox: messages shown instantly while the INSERT is in flight -- */
  let pendingMsgs = new Map(); // convId -> Map(msgId -> msg)

  function addPending(m) {
    if (!pendingMsgs.has(m.convId)) pendingMsgs.set(m.convId, new Map());
    pendingMsgs.get(m.convId).set(m.id, m);
  }

  function removePending(id) {
    pendingMsgs.forEach((m) => m.delete(id));
  }

  function mergeMsgs(convId, fetched) {
    const pend = pendingMsgs.get(convId);
    if (!pend || !pend.size) return fetched;
    const byId = new Map();
    for (const m of fetched) byId.set(m.id, m);
    for (const [id, m] of pend) if (!byId.has(id)) byId.set(id, m);
    return [...byId.values()].sort((a, b) => a.ts - b.ts);
  }

  /* -- cheap in-memory DM list updates (no network) -- */
  function touchDm(convId, msg) {
    const dm = cacheDms.find((d) => d.convId === convId);
    if (!dm) return false;
    dm.last = msg;
    dm.updatedAt = msg.ts;
    return true;
  }

  function reorderDmList() {
    const c = $("#rail-c");
    if (c && view === "home") renderRailC();
  }

  /* -- live incoming messages (realtime), without a full re-render -- */
  async function renderActiveChat() {
    if (!activeConv) return;
    const scroll = $("#chat-scroll");
    const pinned = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90 : true;
    const msgs = mergeMsgs(activeConv, await DB.getMessages(activeConv));
    renderMessages(msgs);
    const s2 = $("#chat-scroll");
    if (s2 && pinned) s2.scrollTop = s2.scrollHeight;
  }

  function handleIncoming(m) {
    if (!m || !profile || m.senderId === profile.id) return;
    const isGroup = cacheGroups.some((g) => g.id === m.convId);
    const appConv = isGroup ? "g_" + m.convId : m.convId;
    if (appConv === activeConv) {
      renderActiveChat();
    } else if (!isGroup) {
      if (touchDm(m.convId, m)) reorderDmList();
    }
  }

  /* ------------------------------------------------------------------ *
   *  Onboarding
   * ------------------------------------------------------------------ */
  function showOnboarding() {
    onboardingStep = 1;
    obUsername = "";
    picker = { icon: "cat", color: PALETTE[4], bannerColor: PALETTE[4], image: null };
    renderOnboarding();
  }

  function renderOnboarding() {
    rootEl.innerHTML = `
      <section class="rail-b" id="rail-b"></section>
      <section class="rail-c" id="rail-c"></section>
      <section class="chat" id="chat"></section>
      <input type="file" accept="image/*" id="msg-file-input" hidden />
      <div class="onboarding"><div class="onboard-card">${onboardStepHtml()}</div></div>
    `;
    renderRailB();
    paintIcons();
    const uname = $("#ob-username");
    if (uname) uname.focus();
  }

  function onboardStepHtml() {
    const steps = `<div class="onboard-steps"><span class="step ${onboardingStep >= 1 ? "on" : ""}"></span><span class="step ${onboardingStep >= 2 ? "on" : ""}"></span></div>`;
    if (onboardingStep === 1) {
      return `
        ${steps}
        <div class="onboard-head"><h1>Welcome</h1><p>Set up your account to start using Messages.</p></div>
        <div class="onboard-field">
          <label>Choose a username</label>
          <input class="input" id="ob-username" maxlength="24" placeholder="e.g. coolkid99" autocomplete="off" value="${esc(obUsername)}" />
        </div>
        <div class="onboard-actions">
          <button class="btn primary" data-act="onboard-next">Continue</button>
        </div>`;
    }
    return `
      ${steps}
      <div class="onboard-head"><h1>Pick your avatar</h1><p>Upload a photo or choose an icon.</p></div>
      <div class="onboard-avatar-options">
        ${uploadPaneHtml()}
        ${iconPaneHtml()}
      </div>
      <div class="onboard-preview"><p>Preview</p>${avatarHtml(pickerValue(), "avatar avatar-xl")}</div>
      <div class="onboard-actions">
        <button class="btn ghost" data-act="onboard-back">Back</button>
        <button class="btn primary" data-act="onboard-create">Create account</button>
      </div>`;
  }

  async function finishOnboarding() {
    const uname = obUsername.trim() || "player";
    profile = await DB.createProfile({ username: uname, avatar: pickerValue() });
    /* No sign-in backing the profile: the account page owns creation. */
    if (!profile) { window.location.href = "login.html"; return; }
    view = "home";
    activeConv = null;
    activeGroupId = null;
    settingsOpen = false;
    await refresh();
    rootEl.querySelectorAll(".onboarding").forEach((n) => n.remove());
    paintIcons();
  }

  /* ------------------------------------------------------------------ *
   *  Modals
   * ------------------------------------------------------------------ */
  function openModal(html) {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="modal">${html}</div>`;
    rootEl.appendChild(ov);
    paintIcons();
    const input = ov.querySelector("input");
    if (input) input.focus();
    return ov;
  }

  function closeOverlay(el) {
    const ov = el.closest(".overlay");
    if (ov) {
      ov.remove();
      if (!$(".overlay") && $("#rail-b")) {
        renderRailB();
        paintIcons();
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Create group flow
   * ------------------------------------------------------------------ */
  function openCreateGroup() {
    const ov = openModal(`
      <h2>Create a group</h2>
      <p class="sub">Give your new group a name.</p>
      <input class="input" id="cg-name" maxlength="32" placeholder="Group name" autocomplete="off" />
      <div class="modal-actions">
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" data-act="create-group">Create</button>
      </div>
    `);
    ov.dataset.flow = "create-group";
  }

  async function createGroup() {
    const nameInput = $("#cg-name");
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.style.borderColor = "#ff4444";
      return;
    }
    const g = await DB.createGroup({ name });
    cacheGroups = await DB.getGroups();
    closeOverlay(nameInput);
    openInviteModal(g);
  }

  async function openInviteModal(group) {
    const friends = await DB.getFriends();
    const ov = openModal(`
      <h2>Invite friends</h2>
      <p class="sub">Send invites to "<b>${esc(group.name)}</b>". You can close this — you'll be the only member for now.</p>
      ${
        friends.length
          ? `<div class="search-results">${friends
              .map(
                (f) => `
            <div class="friend-row">
              ${avatarWrapHtml(f.avatar, "avatar avatar-s", statusOf(f))}
              <div class="name"><b>${esc(f.username)}${f.tag ? botTag(f.tag) : ""}</b><small>${esc(f.username)}</small></div>
              <button class="btn primary small" data-act="invite" data-friend="${f.id}" data-gid="${group.id}">${icons("plus")} Invite</button>
            </div>`
              )
              .join("")}</div>`
          : `<div class="empty-hint">No friends yet. Add some friends first to invite them.</div>`
      }
      <div class="modal-actions"><button class="btn primary" data-close data-gid="${group.id}">Done</button></div>
    `);
    ov.dataset.group = group.id;
  }

  /* ------------------------------------------------------------------ *
   *  Add-friends modal
   * ------------------------------------------------------------------ */
  function openAddFriend() {
    const ov = openModal(`
      <h2>Add friends</h2>
      <p class="sub">Search by username to find people and start chatting.</p>
      <input class="input" id="af-search" placeholder="Search usernames..." autocomplete="off" />
      <div class="search-results" id="af-results"></div>
    `);
    doSearch(ov, "");
  }

  async function doSearch(ov, q) {
    const results = ov.querySelector("#af-results");
    if (!results) return;
    const list = await DB.getDirectory(q);
    if (!list.length) {
      results.innerHTML = `<div class="empty-hint">No users found. Try a different name.</div>`;
      return;
    }
    results.innerHTML = list
      .map(({ profile: u, isFriend }) => {
        const btn = isFriend
          ? `<button class="btn small" disabled>${icons("check")} Added</button>`
          : `<button class="btn primary small" data-act="friend-add" data-user="${u.id}">${icons("user-plus")} Add</button>`;
        return `
        <div class="friend-row">
          ${avatarWrapHtml(u.avatar, "avatar avatar-s", statusOf(u))}
          <div class="name"><b>${esc(u.username)}${u.tag ? botTag(u.tag) : ""}</b><small>@${esc(u.username)}</small></div>
          ${btn}
        </div>`;
      })
      .join("");
    paintIcons();
  }

  async function addFriend(userId) {
    await DB.addFriend(userId);
    await refresh();
    const input = $("#af-search");
    const ov = input ? input.closest(".overlay") : null;
    if (ov) doSearch(ov, input.value.trim());
  }

  /* ------------------------------------------------------------------ *
   *  Navigation
   * ------------------------------------------------------------------ */
  function openDm(convId) {
    view = "home";
    activeConv = convId;
    activeGroupId = null;
    settingsOpen = false;
    render();
  }

  function openGroup(gid) {
    view = "group";
    activeGroupId = gid;
    activeConv = "g_" + gid;
    settingsOpen = false;
    render();
  }

  function openHome() {
    view = "home";
    activeConv = null;
    activeGroupId = null;
    settingsOpen = false;
    render();
  }

  /* ------------------------------------------------------------------ *
   *  Group settings open/save
   * ------------------------------------------------------------------ */
  async function openGroupSettings() {
    const g = cacheGroups.find((x) => x.id === activeGroupId);
    if (!g) return;
    picker = {
      icon: g.avatar && g.avatar.type === "icon" ? g.avatar.name : "cat",
      color: g.avatar && g.avatar.color ? g.avatar.color : PALETTE[4],
      bannerColor: g.bannerColor || PALETTE[4],
      image: g.avatar && g.avatar.type === "image" ? g.avatar.value : null,
    };
    settingsOpen = true;
    render();
  }

  async function saveGroupSettings() {
    const nameInput = $("#gs-name");
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.style.borderColor = "#ff4444";
      return;
    }
    await DB.updateGroup(activeGroupId, { name, avatar: pickerValue(), bannerColor: picker.bannerColor });
    settingsOpen = false;
    await refresh();
  }

  /* ------------------------------------------------------------------ *
   *  Invite responses
   * ------------------------------------------------------------------ */
  async function respondInvite(msgId, accept) {
    await DB.respondInvite(msgId, accept);
    await refresh();
  }

  /* ------------------------------------------------------------------ *
   *  Global event delegation
   * ------------------------------------------------------------------ */
  rootEl.addEventListener("click", async (e) => {
    const actEl = e.target.closest("[data-act]");
    const act = actEl && actEl.getAttribute("data-act");
    if (act) {
      e.preventDefault();
      switch (act) {
        case "home": openHome(); break;
        case "newgroup": openCreateGroup(); break;
        case "addfriend": openAddFriend(); break;
        case "settings": openGroupSettings(); break;
        case "invite-group": {
          const g = cacheGroups.find((x) => x.id === activeGroupId);
          if (g) openInviteModal(g);
          break;
        }
        case "close-settings": settingsOpen = false; render(); break;
        case "save-settings": saveGroupSettings(); break;
        case "profile-settings": openProfileSettings(); break;
        case "close-profile-settings": profileSettingsOpen = false; render(); break;
        case "save-profile-settings": saveProfileSettings(); break;
        case "send": doSend(); break;
        case "upload": {
          const fi = $("#msg-file-input");
          if (fi) fi.click();
          break;
        }
        case "create-group": createGroup(); break;
        case "invite": {
          const b = actEl;
          const fid = b.getAttribute("data-friend");
          const gid = b.getAttribute("data-gid");
          await DB.inviteToGroup(gid, fid);
          b.disabled = true;
          b.innerHTML = `${icons("check")} Invited`;
          paintIcons();
          break;
        }
        case "accept-invite": {
          const b = actEl;
          await respondInvite(b.getAttribute("data-msg"), true);
          break;
        }
        case "decline-invite": {
          const b = actEl;
          await respondInvite(b.getAttribute("data-msg"), false);
          break;
        }
        case "friend-add": {
          const b = actEl;
          await addFriend(b.getAttribute("data-user"));
          break;
        }
        case "member-dm": {
          const b = actEl;
          const uid = b.getAttribute("data-user");
          const conv = await DB.ensureDm(uid);
          openDm(conv.id);
          break;
        }
        case "member-addfriend": {
          const b = actEl;
          await addFriend(b.getAttribute("data-user"));
          break;
        }
        case "onboard-next": {
          const u = $("#ob-username");
          const name = u ? u.value.trim() : "";
          if (!name) {
            if (u) {
              u.focus();
              u.style.borderColor = "#ff4444";
            }
            return;
          }
          obUsername = name;
          onboardingStep = 2;
          renderOnboarding();
          break;
        }
        case "onboard-back":
          onboardingStep = 1;
          renderOnboarding();
          break;
        case "onboard-create":
          finishOnboarding();
          break;
      }
    }

    // close buttons
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) closeOverlay(closeBtn);

    // open DM
    const dmEl = e.target.closest("[data-conv]");
    if (dmEl) openDm(dmEl.getAttribute("data-conv"));

    // open group (skip elements already handled by a data-act action)
    const grpEl = e.target.closest("[data-gid]");
    if (grpEl && !actEl) openGroup(grpEl.getAttribute("data-gid"));

    // overlay dismiss on backdrop click
    if (e.target.classList.contains("overlay")) e.target.remove();
  });

  // color swatches (uses data-color/data-target on the button itself)
  rootEl.addEventListener("click", (e) => {
    const sw = e.target.closest(".color-swatch");
    if (!sw) return;
    const color = sw.getAttribute("data-color");
    const target = sw.getAttribute("data-target");
    if (target === "banner") picker.bannerColor = color;
    else picker.color = color;
    reRenderPickerUi();
  });

  // icon cells
  rootEl.addEventListener("click", (e) => {
    const cell = e.target.closest(".icon-cell");
    if (!cell) return;
    picker.icon = cell.getAttribute("data-icon");
    reRenderPickerUi();
  });

  // search input
  rootEl.addEventListener("input", (e) => {
    if (e.target.id === "af-search") {
      const ov = e.target.closest(".overlay");
      doSearch(ov, e.target.value);
    }
  });

  // composer enter / modal enter
  rootEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "composer-input") {
      e.preventDefault();
      doSend();
    } else if (e.target.id === "ob-username") {
      e.preventDefault();
      const name = e.target.value.trim();
      if (name) {
        obUsername = name;
        onboardingStep = 2;
        renderOnboarding();
      }
    } else if (e.target.id === "cg-name") {
      e.preventDefault();
      createGroup();
    } else if (e.target.id === "gs-name") {
      e.preventDefault();
      saveGroupSettings();
    } else if (e.target.id === "ps-username") {
      e.preventDefault();
      saveProfileSettings();
    }
  });

  // file upload
  rootEl.addEventListener("change", (e) => {
    if (e.target.id !== "msg-file-input") return;
    const file = e.target.files && e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      picker.image = reader.result;
      reRenderPickerUi();
    };
    reader.readAsDataURL(file);
  });

  function reRenderPickerUi() {
    const preview = $(".avatar-preview");
    if (preview) preview.innerHTML = avatarHtml(pickerValue(), "avatar avatar-l");
    const opts = $(".onboard-avatar-options");
    if (opts) opts.innerHTML = `${uploadPaneHtml()}${iconPaneHtml()}`;
    const bannerRow = $('.color-row[data-colortarget="banner"]');
    if (bannerRow) bannerRow.innerHTML = colorRowHtml("banner");
    const obPreview = $(".onboard-preview");
    if (obPreview) obPreview.innerHTML = `<p>Preview</p>${avatarHtml(pickerValue(), "avatar avatar-xl")}`;
    paintIcons();
  }

  /* ------------------------------------------------------------------ *
   *  Presence: online while active, away after 10 min of inactivity
   * ------------------------------------------------------------------ */
  function setupPresence() {
    const AWAY_MS = 10 * 60 * 1000;
    let awayTimer = null;
    function poke() {
      if (DB.markActive) DB.markActive();
      renderAccountBarOnly();
      if (window.setAccountStatusDot) window.setAccountStatusDot("online");
      clearTimeout(awayTimer);
      awayTimer = setTimeout(() => {
        if (DB.setAway) DB.setAway();
        renderAccountBarOnly();
        if (window.setAccountStatusDot) window.setAccountStatusDot("away");
      }, AWAY_MS);
    }
    ["pointerdown", "pointermove", "keydown", "keyup", "touchstart", "touchmove", "wheel"].forEach((ev) =>
      window.addEventListener(ev, poke, { passive: true, capture: true })
    );
    document.addEventListener("visibilitychange", () => {
      // Backgrounding a tab must NOT mark you away — away only happens after
      // AWAY_MS of real inactivity (the timer still runs in background tabs).
      if (!document.hidden) poke();
    });
    window.addEventListener("pagehide", () => {
      if (DB.setOffline) DB.setOffline();
      if (window.setAccountStatusDot) window.setAccountStatusDot("inactive");
    });
    poke();
  }
  setupPresence();

  /* ------------------------------------------------------------------ *
   *  Init
   * ------------------------------------------------------------------ */
  if (DB.onMessage) {
    DB.onMessage((m) => {
      if (!profile || rootEl.hidden) return;
      if (rootEl.querySelector(".onboarding") || rootEl.querySelector(".overlay")) return;
      handleIncoming(m);
    });
  }
  if (DB.onRealtime) {
    DB.onRealtime(() => {
      if (!profile || rootEl.hidden) return;
      if (rootEl.querySelector(".onboarding") || rootEl.querySelector(".overlay")) return;
      const input = $("#composer-input");
      if (input && document.activeElement === input && input.value.trim()) return;
      refresh();
    });
  }
  console.info("[messenger] loaded");
})();
