/* Live visitor count.
   Joins a Supabase Realtime presence channel so the number next to the
   smiley pill tracks everyone currently on the site. index.html paints
   #online-count; player/flash load the same file just to be counted. */
(function () {
	"use strict";

	var url = window.SUPABASE_URL;
	var key = window.SUPABASE_ANON_KEY;
	if (!url || !key || !window.supabase || !window.supabase.createClient) return;

	/* The number is rendered as one odometer column per digit: a strip holding
	   0-9 that slides to the current digit, so changes scroll instead of
	   swapping instantly. Non-digits (a "+", a comma) stay as plain text. */
	var el = null;
	var lastText = "";

	function digitStrip() {
		var strip = document.createElement("span");
		strip.className = "oc-strip";
		for (var i = 0; i < 10; i++) {
			var n = document.createElement("span");
			n.textContent = String(i);
			strip.appendChild(n);
		}
		return strip;
	}

	function buildRoll(target, text) {
		var roll = document.createElement("span");
		roll.className = "oc-roll";
		roll.setAttribute("aria-hidden", "true");
		for (var i = 0; i < text.length; i++) {
			var ch = text.charAt(i);
			if (!/[0-9]/.test(ch)) {
				var plain = document.createElement("span");
				plain.className = "oc-char";
				plain.textContent = ch;
				roll.appendChild(plain);
				continue;
			}
			var col = document.createElement("span");
			col.className = "oc-col";
			col.appendChild(digitStrip());
			roll.appendChild(col);
		}
		target.textContent = "";
		target.appendChild(roll);
		return roll;
	}

	function paint(n) {
		if (!el) el = document.getElementById("online-count");
		if (!el) return;
		var text = String(Math.max(1, n | 0));
		if (text === lastText) return;
		var roll = el.querySelector(".oc-roll");
		if (!roll || roll.childElementCount !== text.length) {
			roll = buildRoll(el, text);
			roll.classList.add("oc-noanim");
		}
		var cols = roll.querySelectorAll(".oc-col");
		var c = 0;
		for (var i = 0; i < text.length; i++) {
			var d = Number(text.charAt(i));
			if (isNaN(d)) continue;
			var col = cols[c++];
			if (!col || !col.firstChild) continue;
			col.firstChild.style.transform = "translateY(-" + d + "0%)";
		}
		el.setAttribute("aria-label", text + (text === "1" ? " person online" : " people online"));
		lastText = text;
		if (roll.classList.contains("oc-noanim")) {
			/* skip the transition for the first paint, then allow it again */
			void roll.offsetWidth;
			setTimeout(function () { roll.classList.remove("oc-noanim"); }, 40);
		}
	}
	paint(1);

	var sb;
	try { sb = window.supabase.createClient(url, key); } catch (e) { return; }

	/* One presence entry per browser, not per tab. A brand-new key on every
	   page load left the previous entry behind until Realtime timed it out,
	   and every presence sync then carried the whole accumulated state to
	   every client — so the more people reloaded, the bigger each sync got.
	   A key kept in localStorage collapses all tabs and reloads onto one
	   entry. */
	var PRESENCE_KEY_STORE = "rcdn-online-key";
	function presenceKey() {
		try {
			var k = localStorage.getItem(PRESENCE_KEY_STORE);
			if (!k) {
				k = "b-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
				localStorage.setItem(PRESENCE_KEY_STORE, k);
			}
			return k;
		} catch (e) {
			return "b-" + Math.random().toString(36).slice(2, 9);
		}
	}

	var chan;
	try {
		chan = sb.channel("rcdn-online", {
			config: { presence: { key: presenceKey() } }
		});
	} catch (e) { return; }

	chan.on("presence", { event: "sync" }, function () {
		try {
			var state = chan.presenceState() || {};
			paint(Object.keys(state).length);
		} catch (e) {}
	});

	function trackSelf() { try { chan.track({}); } catch (e) {} }
	function untrackSelf() { try { chan.untrack(); } catch (e) {} }

	chan.subscribe(function (status) {
		if (status !== "SUBSCRIBED") return;
		if (document.visibilityState === "visible") trackSelf();
	});

	/* Background tabs stop counting. Their entry is part of the state every
	   other client syncs, and the number means "people here", not "tabs
	   left open overnight". */
	document.addEventListener("visibilitychange", function () {
		if (document.visibilityState === "visible") trackSelf();
		else untrackSelf();
	});

	window.addEventListener("pagehide", function () {
		try { sb.removeChannel(chan); } catch (e) {}
	});
})();
