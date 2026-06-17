/* =====================================================================
   Martin Sosa — dungeon portfolio behaviour. Vanilla JS, no deps.
   ===================================================================== */
(function () {
	"use strict";

	var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	/* ---- current year ---- */
	var yearEl = document.getElementById("year");
	if (yearEl) yearEl.textContent = String(new Date().getFullYear());

	/* ---- dungeon ambience toggle (off by default, user-initiated) ---- */
	var audio = document.getElementById("ambience");
	var toggle = document.getElementById("audio-toggle");
	if (audio && toggle) {
		audio.volume = 0.18;
		var stateEl = toggle.querySelector(".hud__audio-state");
		toggle.addEventListener("click", function () {
			if (audio.paused) {
				var p = audio.play();
				if (p && p.catch) p.catch(function () { /* autoplay blocked until gesture — this IS the gesture, ignore */ });
				toggle.setAttribute("aria-pressed", "true");
				toggle.setAttribute("aria-label", "Toggle dungeon ambience (on)");
				if (stateEl) stateEl.textContent = "ON";
			} else {
				audio.pause();
				toggle.setAttribute("aria-pressed", "false");
				toggle.setAttribute("aria-label", "Toggle dungeon ambience (off)");
				if (stateEl) stateEl.textContent = "OFF";
			}
		});
	}

	/* ---- active section highlighting in the HUD ---- */
	var navLinks = Array.prototype.slice.call(document.querySelectorAll(".hud__nav a"));
	var sections = navLinks
		.map(function (a) { return document.querySelector(a.getAttribute("href")); })
		.filter(Boolean);

	if ("IntersectionObserver" in window && sections.length) {
		var spy = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!entry.isIntersecting) return;
				navLinks.forEach(function (a) {
					var on = a.getAttribute("href") === "#" + entry.target.id;
					a.style.color = on ? "var(--gold)" : "";
					a.style.borderBottomColor = on ? "var(--gold-deep)" : "";
				});
			});
		}, { rootMargin: "-45% 0px -50% 0px" });
		sections.forEach(function (s) { spy.observe(s); });
	}

	/* ---- RPG pause menu: the accessible, no-game-required way into everything ---- */
	var menuBtn = document.getElementById("menu-btn");
	var menu = document.getElementById("rpg-menu");
	if (menuBtn && menu) {
		var menuItems = Array.prototype.slice.call(menu.querySelectorAll(".rpg-menu__item, .rpg-menu__close"));
		var lastFocus = null;

		function openMenu() {
			lastFocus = document.activeElement;
			menu.hidden = false;
			menuBtn.setAttribute("aria-expanded", "true");
			document.body.style.overflow = "hidden";
			if (menuItems[0]) menuItems[0].focus();
		}
		function closeMenu(restore) {
			if (menu.hidden) return;
			menu.hidden = true;
			menuBtn.setAttribute("aria-expanded", "false");
			document.body.style.overflow = "";
			if (restore !== false && lastFocus && lastFocus.focus) lastFocus.focus();
		}

		menuBtn.addEventListener("click", openMenu);
		menu.addEventListener("click", function (e) {
			if (e.target.closest("[data-close]")) { closeMenu(); return; }
			var item = e.target.closest(".rpg-menu__item");
			if (!item) return;
			var sel = item.getAttribute("data-target");
			var dest = sel && document.querySelector(sel);
			closeMenu(false);
			if (!dest) return;
			dest.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
			/* hand focus to the destination heading so keyboard/screen-reader users land there */
			var focusTarget = (sel === "#top") ? document.querySelector(".char-sheet__name") : (dest.querySelector("h1, h2, h3") || dest);
			if (focusTarget) { focusTarget.setAttribute("tabindex", "-1"); focusTarget.focus({ preventScroll: true }); }
		});
		document.addEventListener("keydown", function (e) {
			if (menu.hidden) return;
			if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				var idx = menuItems.indexOf(document.activeElement);
				idx = (idx === -1) ? 0 : (idx + (e.key === "ArrowDown" ? 1 : menuItems.length - 1)) % menuItems.length;
				menuItems[idx].focus();
			} else if (e.key === "Tab") {     /* keep focus trapped inside the dialog */
				var first = menuItems[0], last = menuItems[menuItems.length - 1];
				if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		});
	}

	/* ---- mini-dungeon: real-3D (Three.js) when supported, hand-rolled 2.5D otherwise ---- */
	var dungeon = document.getElementById("dungeon");
	var heroEl = document.getElementById("hero-rogue");
	var scene = dungeon && dungeon.querySelector(".dungeon__scene");
	var xpEl = dungeon && dungeon.querySelector(".dungeon__xp");

	function webglSupported() {
		try {
			var c = document.createElement("canvas");
			return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
		} catch (e) { return false; }
	}
	/* skip the 670 KB 3D download for reduced-motion, data-saver, or no-WebGL visitors */
	var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
	var prefer3D = !reduceMotion && !conn.saveData && webglSupported();

	if (dungeon && heroEl && scene) {
		var glCanvas = dungeon.querySelector(".dungeon__gl");
		if (prefer3D && glCanvas) {
			import("./dungeon3d.js")
				.then(function (m) { return m.initDungeon3D({ dungeon: dungeon, canvas: glCanvas, xpEl: xpEl, reduceMotion: reduceMotion }); })
				.then(function () { document.body.classList.add("world-on"); })   /* promote the hero to a full-viewport world */
				.catch(function (err) { if (window.console && console.warn) { console.warn("3D dungeon unavailable — using 2.5D fallback.", err); } start2DDungeon(); });
		} else {
			start2DDungeon();
		}
	}

	function start2DDungeon() {
		var WATCH = { ArrowUp:1, ArrowDown:1, ArrowLeft:1, ArrowRight:1, KeyW:1, KeyA:1, KeyS:1, KeyD:1 };
		var keys = {}, pointerDir = 0;     /* pointerDir: -1 forward, 1 back, 0 idle */
		var offset = 0, heroX = 0, stepPhase = 0, raf = 0, dashT = 0, dashCd = 0;
		var SPEED = 1.7, MAXX = 64;
		var slimeLayer = dungeon.querySelector(".dungeon__slimes");
		var xpEl = dungeon.querySelector(".dungeon__xp");
		var SVGNS = "http://www.w3.org/2000/svg", slimes = [], xp = 0;

		function dim() { return { w: dungeon.clientWidth || 200, h: dungeon.clientHeight || 260 }; }
		function spawnAhead(s) {
			var d = dim();
			s.wy = offset + d.h * 0.6 + Math.random() * d.h * 1.2;   /* place it up the hall, ahead of you */
			s.wx = Math.round((Math.random() * 2 - 1) * MAXX);
			s.alive = true; s.el.classList.remove("dead");
		}
		function makeSlimes() {
			if (!slimeLayer || slimes.length) return;
			var d = dim();
			for (var i = 0; i < 5; i++) {
				var svg = document.createElementNS(SVGNS, "svg"), use = document.createElementNS(SVGNS, "use");
				svg.setAttribute("class", "dslime"); use.setAttribute("href", "#spr-slime");
				svg.appendChild(use); slimeLayer.appendChild(svg);
				var s = { el: svg, alive: true, wx: 0, wy: 0 };
				spawnAhead(s);
				s.wy = offset + (i + 1) * (d.h / 5) + Math.random() * 24;   /* spread the first few into view */
				slimes.push(s);
			}
		}
		function popXP(x, y) {
			var p = document.createElement("div");
			p.className = "xp-pop"; p.textContent = "+1 XP";
			p.style.left = x + "px"; p.style.top = y + "px";
			dungeon.appendChild(p);
			p.addEventListener("animationend", function () { p.remove(); });
			xp++; if (xpEl) xpEl.textContent = "✦ " + xp;
		}
		function updateSlimes(dashing) {
			if (!slimes.length) return;
			var d = dim(), cx = d.w / 2, cy = d.h * 0.52, i, s, sy;
			for (i = 0; i < slimes.length; i++) {
				s = slimes[i];
				if (!s.alive) continue;
				sy = cy + (offset - s.wy);
				if (sy > d.h + 30 || sy < -40) { spawnAhead(s); continue; }   /* off-screen -> recycle ahead */
				s.el.style.left = (cx + s.wx - 9) + "px";
				s.el.style.top = (sy - 9) + "px";
				if (dashing && Math.abs(s.wx - heroX) < 15 && Math.abs(offset - s.wy) < 17) {
					s.alive = false; s.el.classList.add("dead");
					popXP(cx + s.wx, sy);
					(function (sl) { setTimeout(function () { spawnAhead(sl); }, 380); })(s);
				}
			}
		}

		function anyKey() {
			for (var k in keys) if (keys[k]) return true;
			return false;
		}
		function running() {
			return dashT > 0 || (document.activeElement === dungeon && anyKey()) || pointerDir !== 0;
		}

		function frame() {
			var dashing = dashT > 0;
			if (dashT > 0) dashT--;
			if (dashCd > 0) dashCd--;
			var spd = SPEED * (dashing ? 3.2 : 1);

			var up = keys.ArrowUp || keys.KeyW || pointerDir === -1;
			var dn = keys.ArrowDown || keys.KeyS || pointerDir === 1;
			var lf = keys.ArrowLeft || keys.KeyA;
			var rt = keys.ArrowRight || keys.KeyD;
			if (dashing && !(up || dn || lf || rt)) up = true;     /* dash forward if no direction held */
			var moving = up || dn || lf || rt;
			var pos = "0% 0%", flip = false;   /* default: face front (resting) */

			if (up) { offset += spd; pos = "100% 0%"; }            /* forward -> back of head */
			else if (dn) { offset -= spd; pos = "0% 0%"; }         /* backward -> face viewer */
			if (rt) { heroX = Math.min(MAXX, heroX + spd); if (!up && !dn) pos = "50% 0%"; }
			if (lf) { heroX = Math.max(-MAXX, heroX - spd); if (!up && !dn) { pos = "50% 0%"; flip = true; } }

			if (moving) stepPhase = (stepPhase + (dashing ? 0.6 : 0.35)) % (Math.PI * 2);
			var bob = (moving && !reduceMotion && Math.sin(stepPhase) < 0) ? -2 : 0;

			scene.style.backgroundPositionY = offset.toFixed(1) + "px";
			heroEl.style.backgroundPosition = pos;
			heroEl.style.transform = "translate(" + heroX.toFixed(1) + "px," + bob + "px) scaleX(" + (flip ? -1 : 1) + ")";
			heroEl.style.filter = dashing ? "drop-shadow(0 3px 3px rgba(0,0,0,.7)) drop-shadow(0 0 7px rgba(255,138,61,.75))" : "";
			dungeon.classList.toggle("is-playing", moving);
			updateSlimes(dashing);

			if (running()) raf = requestAnimationFrame(frame);
			else { raf = 0; dashCd = 0; dungeon.classList.remove("is-playing"); }
		}
		function ensureLoop() { if (!raf) raf = requestAnimationFrame(frame); }

		dungeon.addEventListener("keydown", function (e) {
			if (e.code === "ShiftLeft" || e.code === "ShiftRight") {   /* small dash, with cooldown */
				if (dashT <= 0 && dashCd <= 0) { dashT = 9; dashCd = 28; }
				ensureLoop(); return;
			}
			if (!WATCH[e.code]) return;
			e.preventDefault();            /* keep arrows from scrolling the page while playing */
			keys[e.code] = true; ensureLoop();
		});
		window.addEventListener("keyup", function (e) { if (WATCH[e.code]) keys[e.code] = false; });
		dungeon.addEventListener("blur", function () { keys = {}; pointerDir = 0; });

		/* press-and-hold to walk (touch + mouse): top half = forward, bottom half = back */
		function pdir(e) {
			var r = dungeon.getBoundingClientRect();
			var cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
			return cy < r.height / 2 ? -1 : 1;
		}
		dungeon.addEventListener("pointerdown", function (e) { dungeon.focus({ preventScroll: true }); pointerDir = pdir(e); ensureLoop(); });
		dungeon.addEventListener("pointermove", function (e) { if (pointerDir !== 0) pointerDir = pdir(e); });
		window.addEventListener("pointerup", function () { pointerDir = 0; });
		dungeon.addEventListener("pointercancel", function () { pointerDir = 0; });

		makeSlimes(); updateSlimes(false);
	}

	/* (slimes now live inside the mini-dungeon — dash through them; see updateSlimes above) */

	/* ---- Konami code: ↑↑↓↓←→←→ B A → torchlight surges ---- */
	var KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
	var streak = 0;
	document.addEventListener("keydown", function (e) {
		streak = (e.keyCode === KONAMI[streak]) ? streak + 1 : (e.keyCode === KONAMI[0] ? 1 : 0);
		if (streak === KONAMI.length) {
			streak = 0;
			document.body.classList.add("konami");
			document.documentElement.style.setProperty("--torch", "#ff8fd6");
			document.documentElement.style.setProperty("--gold", "#ffa6e6");
			document.documentElement.style.setProperty("--gold-deep", "#c95fa8");
			document.documentElement.style.setProperty("--gold-soft", "#ffd0f1");
			console.log("%c  CHEAT ENABLED — the dungeon glows pink. ", "background:#ffa6e6;color:#0b0a10;font-weight:bold;padding:2px 6px;");
		}
	});

	/* ---- a friendly note for the curious ---- */
	console.log("%c@ Martin Sosa", "color:#e8c170;font-size:20px;font-weight:bold;");
	console.log("%cFull-Stack Software Engineer · poking around the source? Say hi: mr.martinsosa@gmail.com", "color:#9a92ac;");
})();
