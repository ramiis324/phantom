/* --- Incognito: keep every page dressed as another site ---
   Settings -> Incognito saves the switch and the picked disguise in
   "rcdn-incognito". Every Phantom page loads this file, so the disguise
   carries over when the games list opens player.html, flash.html, the
   movie page and the rest, and the tab goes back to Phantom when the
   switch is turned off. */
(function () {
	var KEY = "rcdn-incognito";
	var LOOKS = {
		gmail:  { title: "Inbox (1) - Gmail",       icon: "incognito/gmail.png" },
		drive:  { title: "My Drive - Google Drive", icon: "incognito/drive.png" },
		canvas: { title: "Dashboard | Canvas",      icon: "incognito/canvas.png" }
	};
	/* Pages live at different depths (apps/index.html is a folder down), so
	   resolve the icons against this file instead of the page. */
	var SELF = document.currentScript;
	var BASE = SELF && SELF.src ? SELF.src.replace(/[^\/]*$/, "") : "";
	var homeTitle = document.title;
	var homeIcon = null;   /* the page's own icon href, once we have seen it */
	var madeIcon = null;   /* icon link we created on a page that had none */
	var applied = false;

	function read() {
		var state = { on: false, disguise: "gmail" };
		try {
			var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
			if (saved && saved.on) state.on = true;
			if (saved && LOOKS[saved.disguise]) state.disguise = saved.disguise;
		} catch (e) {}
		return state;
	}

	function iconLink() {
		return document.querySelector('link[rel~="icon"]');
	}

	function apply() {
		var state = read();

		if (!state.on) {
			if (!applied) return;
			applied = false;
			if (document.title !== homeTitle) document.title = homeTitle;
			if (madeIcon && madeIcon.parentNode) {
				madeIcon.parentNode.removeChild(madeIcon);
				madeIcon = null;
			} else if (homeIcon !== null) {
				var own = iconLink();
				if (own && own.getAttribute("href") !== homeIcon) own.setAttribute("href", homeIcon);
			}
			return;
		}

		var look = LOOKS[state.disguise];
		var link = iconLink();
		if (link) {
			if (homeIcon === null) homeIcon = link.getAttribute("href") || "";
		} else {
			link = document.createElement("link");
			link.rel = "icon";
			link.type = "image/png";
			document.head.appendChild(link);
			madeIcon = link;
		}
		if (link.getAttribute("href") !== BASE + look.icon) link.setAttribute("href", BASE + look.icon);
		if (document.title !== look.title) document.title = look.title;
		applied = true;
	}

	function save(state) {
		try {
			localStorage.setItem(KEY, JSON.stringify({
				on: !!state.on,
				disguise: LOOKS[state.disguise] ? state.disguise : "gmail"
			}));
		} catch (e) {}
		apply();
	}

	window.IncognitoTab = { KEY: KEY, LOOKS: LOOKS, read: read, save: save, apply: apply };

	apply();

	/* Pages set their own title while parsing, so reassert once the DOM is
	   settled and keep watching in case one renames itself afterwards. */
	document.addEventListener("DOMContentLoaded", apply);
	window.addEventListener("load", function () {
		apply();
		if (window.MutationObserver) {
			new MutationObserver(apply).observe(document.head, {
				childList: true,
				subtree: true,
				characterData: true
			});
		}
	});
	/* Flipping the switch in one tab updates the others. */
	window.addEventListener("storage", function (e) {
		if (!e.key || e.key === KEY) apply();
	});
})();
