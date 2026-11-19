/* ============================================================
   Grainient loader — shared loader for the game players.
   Ported from the react-bits component (DavidHDev/react-bits,
   MIT + Commons Clause) as a dependency-free WebGL2 port of the
   exact shader + uniforms (same source as loader.html).

   Usage:
     grainient.setup({ label: "Game Name", total: 2300 });
     grainient.ready();   // fades the loader out
   ============================================================ */
(function (global) {
	"use strict";

	var canvas = null;
	var gl = null;
	var overlay = null;
	var fill = null;
	var rafId = 0;
	var barRaf = 0;
	var t0 = 0;
	var total = 1000;
	var done = false;
	var barStarted = false;
	var barFinished = false;
	var wantDone = false;

	var VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

	var FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uLightMode;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);} 
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);} 
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));

  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);} 
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;

  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);
  if(uLightMode>0.5){
    float energy=max(max(col.r,col.g),col.b);
    vec3 hue=col/max(energy,0.001);
    float chroma=length(col-vec3(dot(col,vec3(0.333333))));
    float coverage=clamp(0.12+chroma*1.15+energy*0.18,0.0,0.88);
    col=mix(vec3(1.0),clamp(hue*0.58+col*0.18,0.0,1.0),coverage);
  }

  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`;

	function compile(type, src) {
		var sh = gl.createShader(type);
		gl.shaderSource(sh, src);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
			throw new Error(gl.getShaderInfoLog(sh));
		}
		return sh;
	}

	function hexToRgb(hex) {
		var r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		if (!r) return [1, 1, 1];
		return [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255];
	}

	/* --- The exact props from the component usage --- */
	var FRAG = {
		uTimeSpeed: 1.55,
		uColorBalance: 0.0,
		uWarpStrength: 1.0,
		uWarpFrequency: 5.0,
		uWarpSpeed: 2.5,
		uWarpAmplitude: 50.0,
		uBlendAngle: 0.0,
		uBlendSoftness: 0.05,
		uRotationAmount: 500.0,
		uNoiseScale: 2.0,
		uGrainAmount: 0.1,
		uGrainScale: 2.0,
		uGrainAnimated: 0.0,
		uContrast: 1.5,
		uGamma: 1.0,
		uSaturation: 1.0,
		uZoom: 0.9,
		uLightMode: 0.0,
		uColor1: [255 / 255, 159 / 255, 252 / 255], /* #FF9FFC */
		uColor2: [82 / 255, 39 / 255, 255 / 255],   /* #5227FF */
		uColor3: [180 / 255, 151 / 255, 207 / 255], /* #B497CF */
		uCenterOffset: [0, 0]
	};

	/* --- One palette per site accent (accent-picker values) --- */
	var PALETTES = {
		greenyellow: { colors: ["#7EFF5E", "#16A34A", "#0E7A34"], bar: ["#ffffff", "#CFFFBF"] },
		"#4fc3f7":    { colors: ["#BDEBFF", "#2F9DF7", "#8FCAE8"], bar: ["#ffffff", "#D6F3FF"] },
		"#ffe066":    { colors: ["#FFDE2E", "#FFB300", "#C77C00"], bar: ["#ffffff", "#FFF0A8"] },
		"#ff6fb5":    { colors: ["#FFB8DC", "#F45CB0", "#E49CC0"], bar: ["#ffffff", "#FFE3F0"] },
		"#b388ff":    { colors: ["#FF9FFC", "#5227FF", "#B497CF"], bar: ["#ffffff", "#FFE9FF"] },
		"#ff5555":    { colors: ["#FFA0A0", "#E63946", "#DB7A7A"], bar: ["#ffffff", "#FFD0D0"] },
		"#ffa040":    { colors: ["#FFD28A", "#FF9F3C", "#E09A5E"], bar: ["#ffffff", "#FFE4BD"] }
	};

	/* --- Theme colours only ---
	   The shader, its grain and its timing are untouched; the three colours
	   it mixes come from the preset the visitor picked. Light and dark keep
	   the profile palette below, because those two modes use the profile
	   colour as the site accent. Mirrors THEME_AURORA in index.html. */
	var THEME_GLOW = {
		"og-shine": ["#7CFFE4", "#12B39B", "#0A5E52"],
		alpine: ["#B7E39A", "#3E8A5C", "#123A26"],
		dune: ["#FFD9A0", "#D9853B", "#7A3E14"],
		tide: ["#5FA8F0", "#22C58B", "#0B5E4E"],
		blossom: ["#FFD1E3", "#E0559A", "#8E2154"],
		orbit: ["#C9B4FF", "#6D3CE0", "#2B1266"],
		"after-rain": ["#D6E8DE", "#6FA98C", "#2F5B45"],
		ember: ["#FFC98F", "#F07A2A", "#7A2F0B"],
		kanagawa: ["#A9C6FF", "#3E6FD1", "#12305E"],
		aurora: ["#CFF7D8", "#5FD08A", "#1E5C3A"],
		"violet-hour": ["#E0CFFF", "#8E6BFF", "#3B1E9E"],
		phosphor: ["#CFFFC2", "#4BFF7A", "#0E5E2A"],
		mirage: ["#FFE2B8", "#E09A55", "#7A3E14"],
		nebula: ["#FFC9A0", "#F0803C", "#3A2A7A"],
		frost: ["#DDEBFF", "#7FB0F0", "#2B4F8F"],
		paper: ["#FBF2DD", "#C9A27A", "#6B4630"],
		carbon: ["#BFD2FF", "#5C86F0", "#1E2C52"],
		peach: ["#FFD6BF", "#F0805A", "#8A2E1A"],
		midnight: ["#C9D2FF", "#6D82F5", "#1A2460"],
		lilac: ["#E0D2FF", "#8B6CF0", "#3A1E8A"],
		dusk: ["#FFC2D8", "#C64A8E", "#5A1A3A"],
		seafoam: ["#D3FBEE", "#4FBFA6", "#1E5E4E"],
		graphite: ["#F0F0F3", "#B9BAC2", "#4A4C52"],
		daybreak: ["#D6E6FF", "#5A8AF0", "#1E3C7A"],
		sherbet: ["#FFD3E2", "#F0709A", "#8A2050"]
	};

	/* Presets whose page is light: white ink would vanish on the pale wash,
	   so the bar and wordmark flip to black there. */
	var THEME_DAY = {
		dune: 1, blossom: 1, "after-rain": 1, kanagawa: 1, "violet-hour": 1,
		mirage: 1, frost: 1, paper: 1, peach: 1, lilac: 1, seafoam: 1,
		daybreak: 1, sherbet: 1
	};

	function contrastText(hex) {
		var c = hexToRgb(hex);
		return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 0.6 ? "#111" : "#fff";
	}

	var accent = "greenyellow";
	try { accent = (JSON.parse(localStorage.getItem("accent") || "{}").accent) || "greenyellow"; } catch (e) {}
	var pal = PALETTES[accent] || PALETTES.greenyellow;

	var preset = "";
	try { preset = localStorage.getItem("theme-preset") || ""; } catch (e) {}
	var glow = THEME_GLOW[preset] || pal.colors;
	var lightTheme = !!THEME_DAY[preset];

	FRAG.uColor1 = hexToRgb(glow[0]);
	FRAG.uColor2 = hexToRgb(glow[1]);
	FRAG.uColor3 = hexToRgb(glow[2]);
	var inkColor = lightTheme ? "#0b0b0d" : "#fff";
	var trackColor = lightTheme ? "rgba(11,11,13,.18)" : "rgba(255,255,255,.28)";
	var fallbackGrad = "linear-gradient(135deg," + glow[0] + "," + glow[1] + " 45%," + glow[2] + ")";
	/* Same colours, but drifting: this only paints when WebGL2 is missing. */
	var fallbackLayers = [
		"radial-gradient(70% 80% at 18% 12%, " + glow[0] + " 0%, rgba(255,255,255,0) 62%)",
		"radial-gradient(80% 90% at 86% 78%, " + glow[1] + " 0%, rgba(255,255,255,0) 64%)",
		"radial-gradient(120% 100% at 50% 118%, " + glow[2] + " 0%, rgba(255,255,255,0) 72%)",
		fallbackGrad
	].join(",");
	/* Solid fill: white on dark backdrops, black on light ones. */
	var barGrad = lightTheme ? "#0b0b0d" : "#ffffff";

	function build() {
		if (overlay) return;

		var lvColor = accent === "greenyellow" ? "#0b0b0d" : "#0b0b0d";
		var style = document.createElement("style");
		style.textContent = [
			/* The gradient is painted under the canvas, so a refused or lost WebGL
			   context can never leave a blank page behind the wordmark. */
			"#grainient{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:150;pointer-events:none;background:" + fallbackLayers + ";background-size:170% 170%;}",
			"#grainient.is-fallback{animation:grain-drift 18s ease-in-out infinite alternate;}",
			"@keyframes grain-drift{0%{background-position:0% 0%,100% 100%,50% 60%,0% 0%;}100%{background-position:35% 25%,65% 60%,40% 30%,0% 0%;}}",
			".grainient-content{position:fixed;inset:0;z-index:151;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;pointer-events:none;opacity:0;transition:opacity .5s ease;}",
			".grainient-content.is-on{opacity:1;}",
			".grainient-title{font-size:3rem;font-weight:600;color:" + inkColor + ";}",
			".grainient-bar{width:220px;height:5px;border-radius:999px;background:" + trackColor + ";overflow:hidden;}",
			".grainient-fill{height:100%;width:0%;border-radius:999px;background:" + barGrad + ";transition:width .12s linear;}",

			/* --- Profile card: drops in with the loader, frost like #controls,
			   shows the avatar alone first, then the level display slides out
			   from behind it. Exits shortly after the loader does. --- */
			".gcard{position:fixed;top:14px;left:50%;z-index:152;box-sizing:border-box;display:flex;align-items:center;gap:12px;max-width:60px;padding:8px;overflow:hidden;background:rgba(0,0,0,.7);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);border-radius:999px;color:#fff;box-shadow:0 14px 34px -16px rgba(0,0,0,.7);font-family:inherit;pointer-events:none;opacity:0;transform:translateX(-50%) translateY(-170%);transition:transform .5s cubic-bezier(.22,1,.36,1),opacity .35s ease,max-width .55s cubic-bezier(.22,1,.36,1);}",
			".gcard.gcard-in{opacity:1;transform:translateX(-50%) translateY(0);}",
			".gcard.gcard-open{max-width:340px;}",
			".gcard.gcard-out{opacity:0;transform:translateX(-50%) translateY(-170%);transition:transform .45s cubic-bezier(.4,0,.2,1),opacity .35s ease;}",
			".gcard.gcard-above{z-index:310;}",
			".gcard-av{flex:none;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;overflow:hidden;background:" + (pal.colors[1] || "#22c55e") + ";color:#fff;}",
			".gcard-av img{width:100%;height:100%;object-fit:cover;display:block;}",
			".gcard-meta{display:flex;flex-direction:column;min-width:158px;opacity:0;transform:translateX(-44px);transition:opacity .38s ease .1s,transform .5s cubic-bezier(.22,1,.36,1) .06s;}",
			".gcard.gcard-open .gcard-meta{opacity:1;transform:none;}",
			".gcard-line{display:flex;align-items:center;justify-content:space-between;gap:10px;line-height:1.15;}",
			".gcard-name{font-size:14px;font-weight:700;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".gcard-lv{flex:none;margin-right:6px;font-size:10px;font-weight:800;letter-spacing:.04em;padding:2px 7px;border-radius:999px;background:" + accent + ";color:" + lvColor + ";}",
			".gcard-xp{display:block;width:calc(100% - 6px);height:6px;margin-top:5px;border-radius:999px;background:rgba(255,255,255,.26);overflow:hidden;}",
			".gcard-xp-fill{display:block;height:100%;width:0%;border-radius:999px;background:" + accent + ";transition:width .7s cubic-bezier(.22,1,.36,1) .32s;}",
			"@media (prefers-reduced-motion:reduce){.gcard{transition:opacity .2s ease;transform:translateX(-50%);}.gcard.gcard-in{transform:translateX(-50%);}.gcard.gcard-out{transform:translateX(-50%);}.gcard.gcard-open .gcard-meta{transform:none;}}"
		].join("\n");
		document.head.appendChild(style);

		canvas = document.createElement("canvas");
		canvas.id = "grainient";
		document.body.appendChild(canvas);

		overlay = document.createElement("div");
		overlay.className = "grainient-content";
		overlay.innerHTML =
			'<div class="grainient-title">phantom</div>' +
			'<div class="grainient-bar"><div class="grainient-fill" id="grainient-fill"></div></div>';
		document.body.appendChild(overlay);
		fill = overlay.querySelector(".grainient-fill");

		gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
		if (!gl) {
			canvas.classList.add("is-fallback");
			console.warn("[loader] WebGL2 unavailable (check chrome://gpu) - using the CSS gradient");
			return;
		}

		var dpr = Math.min(window.devicePixelRatio || 1, 2);

		var program = gl.createProgram();
		try {
			gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
			gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				throw new Error(gl.getProgramInfoLog(program) || "program link failed");
			}
		} catch (err) {
			/* Some drivers refuse the shader outright; keep the CSS gradient
			   instead of returning into a blank page. */
			console.error("Grainient: " + (err && err.message ? err.message : err));
			gl = null;
			canvas.classList.add("is-fallback");
			return;
		}
		gl.useProgram(program);

		var buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		var posLoc = gl.getAttribLocation(program, "position");
		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

		var loc = {};
		function u(name) { loc[name] = gl.getUniformLocation(program, name); return loc[name]; }

		Object.keys(FRAG).forEach(function (key) {
			var v = FRAG[key], l = u(key);
			if (Array.isArray(v)) {
				if (v.length === 2) gl.uniform2fv(l, new Float32Array(v));
				else if (v.length === 3) gl.uniform3fv(l, new Float32Array(v));
			} else {
				gl.uniform1f(l, v);
			}
		});
		u("iResolution");
		u("iTime");

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			var w = Math.max(1, Math.floor(window.innerWidth * dpr));
			var h = Math.max(1, Math.floor(window.innerHeight * dpr));
			canvas.width = w;
			canvas.height = h;
			gl.viewport(0, 0, w, h);
			gl.uniform2f(loc.iResolution, w, h);
			gl.render();
		}

		gl.render = function () {
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		};

		window.addEventListener("resize", resize);
		resize();

		t0 = performance.now();
		function frame(now) {
			gl.uniform1f(loc.iTime, (now - t0) * 0.001);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			rafId = requestAnimationFrame(frame);
		}
		rafId = requestAnimationFrame(frame);
	}

	function fadeNow() {
		overlay.classList.remove("is-on");
		cancelAnimationFrame(rafId);
		cancelAnimationFrame(barRaf);
		/* Release the WebGL context immediately. Removing the canvas alone
		   leaves the context alive until GC, and a dev session with many
		   reloads exhausts the browser's WebGL context pool (FEATURE_FAILURE_
		   EGL_POT / EXHAUSTED_GL_DRIVERS) which kills every other effect. */
		if (gl) {
			var lose = gl.getExtension("WEBGL_lose_context");
			if (lose) lose.loseContext();
			gl = null;
		}
		setTimeout(function () {
			var c = document.getElementById("grainient");
			if (c && c.parentNode) c.parentNode.removeChild(c);
			if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
		}, 550);
		/* Let the profile card out a beat after the loader is gone. */
		clearTimeout(gcardExitTimer);
		gcardExitTimer = setTimeout(exitGCard, 950);
	}

	function startBar() {
		barStarted = true;
		var start = performance.now();
		function tick(now) {
			var p = Math.min(1, (now - start) / total);
			var eased = 1 - Math.pow(1 - p, 3);
			fill.style.width = (eased * 100).toFixed(1) + "%";
			if (p >= 1) {
				barFinished = true;
				if (wantDone) fadeNow();
				return;
			}
			barRaf = requestAnimationFrame(tick);
		}
		barRaf = requestAnimationFrame(tick);
	}

	/* --- Profile card that rides in with the loader ------------------ *
	   Drops from the top as a frost pill holding only the avatar, then
	   the name / level badge / XP bar slide out from behind it. It leaves
	   a moment after the loader so the game is revealed underneath.     */
	var gcard = null;
	var gcardFill = null;
	var gcardOpenTimer = 0;
	var gcardExitTimer = 0;

	function gcardProfile() {
		try {
			var store = JSON.parse(localStorage.getItem("social.v1") || "null");
			return (store && store.profile) || null;
		} catch (e) { return null; }
	}

	/* Same curve as index.html: XP = seconds + 60 per game tried. */
	function gcardStats() {
		var map = {}, seconds = 0, played = 0;
		try { map = JSON.parse(localStorage.getItem("rcdn-playtime") || "{}") || {}; } catch (e) {}
		for (var k in map) {
			var v = +map[k] || 0;
			if (v > 0) { seconds += v; played++; }
		}
		var xp = Math.round(seconds) + played * 60;
		var level = Math.floor(Math.sqrt(xp / 60)) + 1;
		var from = 60 * (level - 1) * (level - 1);
		var to = 60 * level * level;
		var pct = to > from ? Math.max(0, Math.min(100, ((xp - from) / (to - from)) * 100)) : 0;
		return { xp: xp, level: level, pct: pct };
	}

	function gcardAvatarSrc(p) {
		if (!p) return null;
		if (p.avatar && p.avatar.type === "image") return p.avatar.data || p.avatar.url || null;
		if (p.avatarPath && window.SUPABASE_URL) {
			if (/^(https?:|data:|blob:)/i.test(p.avatarPath)) return p.avatarPath;
			return String(window.SUPABASE_URL).replace(/\/+$/, "") +
				"/storage/v1/object/public/avatars/" + p.avatarPath;
		}
		return null;
	}

	function showGCard() {
		if (gcard) return;
		var p = gcardProfile();
		var s = gcardStats();

		var el = document.createElement("div");
		el.className = "gcard";
		el.setAttribute("aria-hidden", "true");
		el.innerHTML =
			'<span class="gcard-av">' +
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
			"</span>" +
			'<span class="gcard-meta">' +
				'<span class="gcard-line">' +
					'<span class="gcard-name"></span>' +
					'<span class="gcard-lv">Lv ' + s.level + "</span>" +
				"</span>" +
				'<span class="gcard-xp"><span class="gcard-xp-fill"></span></span>' +
			"</span>";
		document.body.appendChild(el);
		gcard = el;
		gcardFill = el.querySelector(".gcard-xp-fill");
		el.querySelector(".gcard-name").textContent = (p && p.username) || "Guest";

		var src = gcardAvatarSrc(p);
		if (src) {
			var img = new Image();
			img.alt = "";
			img.onload = function () {
				if (gcard !== el) return;
				var box = el.querySelector(".gcard-av");
				if (box) { box.innerHTML = ""; box.appendChild(img); }
			};
			img.onerror = function () {};
			img.src = src;
		}

		requestAnimationFrame(function () {
			requestAnimationFrame(function () { if (gcard === el) el.classList.add("gcard-in"); });
		});
		/* Beat with the avatar alone, then slide the level display out. */
		gcardOpenTimer = setTimeout(function () {
			if (gcard !== el) return;
			el.classList.add("gcard-open");
			if (gcardFill) gcardFill.style.width = s.pct.toFixed(1) + "%";
		}, 620);
	}

	function exitGCard() {
		clearTimeout(gcardOpenTimer);
		if (!gcard) return;
		var el = gcard;
		gcard = null;
		gcardFill = null;
		el.classList.add("gcard-out");
		setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
	}

	build();

	/* A reload or navigation before the loader finishes would otherwise leave
	   this context to GC. Firefox keeps those alive across a soft reload and
	   eventually refuses every new context (EXHAUSTED_GL_DRIVERS), which
	   switches the loader and the home aurora to their CSS fallbacks. */
	function releaseContext() {
		cancelAnimationFrame(rafId);
		cancelAnimationFrame(barRaf);
		if (gl) {
			var lose = gl.getExtension("WEBGL_lose_context");
			if (lose) lose.loseContext();
			gl = null;
		}
	}
	window.addEventListener("pagehide", releaseContext);
	window.addEventListener("beforeunload", releaseContext);

	global.grainient = {
		/* Resolved accent so the players can paint their controls from the
		   same colour the loader is using. */
		theme: { accent: glow[1], onAccent: contrastText(glow[1]), stops: glow.slice() },
		setup: function (opts) {
			if (!overlay || done) return;
			opts = opts || {};
			if (opts.total) total = opts.total;
			overlay.classList.add("is-on");
			showGCard();
			startBar();
		},
		ready: function () {
			if (!overlay || done) return;
			done = true;
			wantDone = true;
			if (!barStarted || barFinished) fadeNow();
		},
		/* Re-show the profile card (staying open) for the toolbox, and send
		   it back up when the toolbox closes. */
		showProfileCard: function () {
			clearTimeout(gcardExitTimer);
			showGCard();
			if (!gcard) return;
			gcard.classList.add("gcard-above");
			clearTimeout(gcardOpenTimer);
			var el = gcard;
			requestAnimationFrame(function () {
				requestAnimationFrame(function () {
					if (gcard !== el) return;
					el.classList.add("gcard-open");
					var s = gcardStats();
					if (gcardFill) gcardFill.style.width = s.pct.toFixed(1) + "%";
				});
			});
		},
		hideProfileCard: function () {
			exitGCard();
		}
	};
})(window);