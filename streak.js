/* ============================================================
   Daily streak.

   A day counts once the visitor sends a message, joins a call, or
   plays at least a minute of a game. Everything is per browser, like
   playtime and XP: rcdn-streak holds { days, last: "YYYY-MM-DD" },
   rcdn-streak-play holds the seconds played today.

   Pages call RCDNStreak.credit("message" | "call") or feed playtime
   through RCDNStreak.play(seconds). Listen for rcdn-streak-change to
   repaint any streak UI.
   ============================================================ */
(function (global) {
	"use strict";

	var KEY = "rcdn-streak";
	var PLAY_KEY = "rcdn-streak-play";
	var PLAY_MIN_SECONDS = 60;

	function dayKey(d) {
		var x = d || new Date();
		return x.getFullYear() + "-" +
			String(x.getMonth() + 1).padStart(2, "0") + "-" +
			String(x.getDate()).padStart(2, "0");
	}

	function yesterdayKey() {
		var d = new Date();
		d.setDate(d.getDate() - 1);
		return dayKey(d);
	}

	function load() {
		try {
			var v = JSON.parse(localStorage.getItem(KEY) || "null");
			if (v && typeof v.days === "number" && typeof v.last === "string") return v;
		} catch (e) {}
		return { days: 0, last: "" };
	}

	function save(s) {
		try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
	}

	/* Alive while the last counted day is today or yesterday. */
	function currentDays(s) {
		if (!s.last) return 0;
		if (s.last === dayKey() || s.last === yesterdayKey()) return Math.max(1, s.days);
		return 0;
	}

	function announce(days, reason) {
		try {
			global.dispatchEvent(new CustomEvent("rcdn-streak-change", {
				detail: { days: days, reason: reason || "" }
			}));
		} catch (e) {}
	}

	function credit(reason) {
		var s = load();
		var today = dayKey();
		if (s.last === today) {
			/* Already counted once today; nothing to extend. */
			if (s.days < 1) { s.days = 1; save(s); }
			return currentDays(s);
		}
		s.days = s.last === yesterdayKey() ? Math.max(1, s.days) + 1 : 1;
		s.last = today;
		save(s);
		announce(s.days, reason);
		return s.days;
	}

	/* Playtime arrives in small increments; the 60 seconds accumulate
	   across sessions so two short visits still count as a minute. */
	function play(seconds) {
		var n = Math.max(0, Math.round(seconds || 0));
		if (!n) return currentDays(load());
		var today = dayKey();
		var store = null;
		try { store = JSON.parse(localStorage.getItem(PLAY_KEY) || "null"); } catch (e) {}
		if (!store || store.day !== today || typeof store.secs !== "number") {
			store = { day: today, secs: 0 };
		}
		store.secs += n;
		try { localStorage.setItem(PLAY_KEY, JSON.stringify(store)); } catch (e) {}
		if (store.secs >= PLAY_MIN_SECONDS) return credit("play");
		return currentDays(load());
	}

	global.RCDNStreak = {
		days: function () { return currentDays(load()); },
		credit: credit,
		play: play,
		dayKey: dayKey
	};
})(window);
