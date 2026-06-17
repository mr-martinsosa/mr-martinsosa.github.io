/* =====================================================================
   Martin Sosa — dungeon portfolio behaviour. Vanilla JS, no deps.
   ===================================================================== */
(function () {
	"use strict";

	var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	var world = null;   /* the 3D dungeon controller, once (and if) the WebGL world boots */

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
				if (entry.target.closest(".world-panel")) return;   /* ignore a section lifted into the panel (stale highlight) */
				navLinks.forEach(function (a) {
					var on = a.getAttribute("href") === "#" + entry.target.id;
					a.style.color = on ? "var(--gold)" : "";
					a.style.borderBottomColor = on ? "var(--gold-deep)" : "";
				});
			});
		}, { rootMargin: "-45% 0px -50% 0px" });
		sections.forEach(function (s) { spy.observe(s); });
	}

	/* ---- RPG pause menu: the accessible way into everything ---- */
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
			closeMenu(false);
			/* world-on: fly the guided camera, then open the section as a panel over the dungeon (2b).
			   invoker is null (the menu item is now hidden) so focus returns to the MENU button on close. */
			if (world && worldNavigate(sel, null)) return;
			/* fallback / non-world page: jump to the section in the scrolling document */
			var dest = sel && document.querySelector(sel);
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

	/* ---- 2b: in-world hotspots (landmarks down the hall) + content panels over the world ----
	   In world-on mode, MENU items and in-scene landmark pills fly the guided camera, then open
	   the matching <section> as an overlay panel. About stays the always-on hero card (it just
	   flies home). The same sections still scroll normally in the fallback / non-world page. */
	/* x/z are world coords down the hall. All sit centre-to-RIGHT so their pills clear the lower-left
	   content card, and the depths are spread so corridor perspective fans them into a clean
	   receding line rather than a cluster at the vanishing point. */
	/* placed around the CHAMBER (right + centre + the grand portal on the back wall); kept clear of the
	   lower-left content card, with placeHotspots()'s card-aware clamp as backup */
	var HOTSPOTS = [
		{ id: "skills",   sel: "#skills",    label: "Skills",     sprite: "spr-potion", kind: "altar",   x: 3.0, z: -3.5  },
		{ id: "projects", sel: "#quests",    label: "Projects",   sprite: "spr-chest",  kind: "chest",   x: 4.3, z: -7.5  },
		{ id: "exp",      sel: "#chronicle", label: "Experience", sprite: "spr-scroll", kind: "lectern", x: 2.4, z: -11   },
		{ id: "contact",  sel: "#contact",   label: "Contact",    sprite: "spr-heart",  kind: "portal",  x: 0,   z: -14.3 }
	];
	var TARGET_TO_HOTSPOT = { "#skills": "skills", "#quests": "projects", "#chronicle": "exp", "#contact": "contact" };

	var worldPanel = document.getElementById("world-panel");
	var panelSlot = worldPanel && worldPanel.querySelector(".world-panel__slot");
	var canPanel = !!(worldPanel && panelSlot && typeof worldPanel.showModal === "function");
	var panelSection = null, panelHome = null, panelInvoker = null;

	function clearNavSpy() { navLinks.forEach(function (a) { a.style.color = ""; a.style.borderBottomColor = ""; }); }

	/* keep keyboard/SR focus off <body> during the camera fly, and announce the move */
	function announceTransit(label) {
		var s = document.getElementById("world-status");
		if (!s) return;
		s.textContent = label ? ("Traveling to " + label + "…") : "";
		try { s.focus({ preventScroll: true }); } catch (e) { /* non-focusable in old engines — ignore */ }
	}

	/* MOVE (not clone) the section into the dialog so ids / headings / aria survive and there's a
	   single source of truth; crawlers still get the full page on load since this only runs on click. */
	function openPanel(sel, invoker) {
		var section = document.querySelector(sel);
		if (!section) return;
		if (!canPanel) { section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); return; }
		if (panelSection) return;   /* one panel at a time */
		panelInvoker = invoker || null;
		panelHome = document.createComment("panel-anchor");
		section.parentNode.insertBefore(panelHome, section);
		panelSlot.appendChild(section);
		section.classList.add("is-paneled");
		panelSection = section;
		/* label the native <dialog> by the lifted section's heading (no nested dialog roles) */
		var heading = section.querySelector("h2, h3, h1");
		if (heading && heading.id) worldPanel.setAttribute("aria-labelledby", heading.id);
		document.body.classList.add("panel-open");
		worldPanel.showModal();
		panelSlot.scrollTop = 0;
		if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
	}

	if (canPanel) {
		/* close on the ✕ button, on a click in the dialog margin (outside the frame), and on Esc (native) */
		worldPanel.addEventListener("click", function (e) {
			if (e.target.closest("[data-close]") || e.target === worldPanel) worldPanel.close();
		});
		worldPanel.addEventListener("close", function () {
			var section = panelSection;
			if (section) {
				if (panelHome && panelHome.parentNode) { panelHome.parentNode.insertBefore(section, panelHome); panelHome.parentNode.removeChild(panelHome); }
				section.classList.remove("is-paneled");
			}
			worldPanel.removeAttribute("aria-labelledby");
			panelSection = null; panelHome = null;
			document.body.classList.remove("panel-open");
			clearNavSpy();   /* drop any stale highlight the lifted section left on the HUD nav */
			var statusEl = document.getElementById("world-status"); if (statusEl) statusEl.textContent = "";
			if (world && world.flyHome) world.flyHome();
			/* return focus to the opener if it's a still-visible control (a HUD/CTA anchor), else the MENU
			   button — a hotspot pill is hidden during the return fly (offsetParent stays set under
			   visibility:hidden, so also reject anything inside the hidden hotspot layer) */
			var inv = panelInvoker; panelInvoker = null;
			function focusable(el) { return el && el.isConnected && el.offsetParent !== null && !(el.closest && el.closest(".world-hotspots--hidden")); }
			var mb = document.getElementById("menu-btn");
			if (focusable(inv)) inv.focus(); else if (mb) mb.focus();
		});
	}

	/* world-on routing shared by the MENU, the HUD nav, the hero CTAs and the DESCEND hint: fly the
	   guided camera + open the section as a panel. Returns true when it handled the navigation. */
	function worldNavigate(sel, invoker) {
		if (!world) return false;
		if (sel === "#top") {   /* About == the always-on hero card; just glide home + focus it */
			if (world.flyHome) world.flyHome();
			var card = document.querySelector(".char-sheet__name");
			if (card) { card.setAttribute("tabindex", "-1"); card.focus({ preventScroll: true }); }
			return true;
		}
		if (!canPanel) return false;   /* panels unusable → let the anchor scroll natively (avoids a fly lockup) */
		var hid = TARGET_TO_HOTSPOT[sel];
		if (hid && world.focusHotspot) { world.focusHotspot(hid); return true; }   /* fly → onArrive opens the panel */
		openPanel(sel, invoker);
		return true;
	}

	/* the HUD nav links, the hero CTAs and the DESCEND hint are plain in-document anchors; in world-on
	   route them through the same fly + panel flow as the MENU instead of scrolling into the raw sections
	   below the immersive hero. The fallback / non-world page (world === null) keeps native anchor scrolling. */
	document.addEventListener("click", function (e) {
		if (!world) return;
		var a = e.target.closest(".hud__nav a, .hero__cta a.btn, a.scroll-hint");
		if (!a) return;
		var href = a.getAttribute("href");
		if (!href || href.charAt(0) !== "#") return;
		if (href === "#top" || TARGET_TO_HOTSPOT[href]) { e.preventDefault(); worldNavigate(href, a); }
	});

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
	/* skip the 670 KB 3D download for reduced-motion, data-saver, or no-WebGL visitors — and reserve the
	   full-viewport world for desktop-width screens (mobile/narrow get the boxed page + menu, by design;
	   the lower-left card + framed rogue + hotspot pills need the room) */
	var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
	var wideEnough = !window.matchMedia || window.matchMedia("(min-width: 960px)").matches;
	var prefer3D = !reduceMotion && !conn.saveData && wideEnough && webglSupported();
	/* optional CC0 .glb character, chosen via ?char=<name> (sanitised); null ⇒ the procedural rogue */
	var charParam = null;
	try { charParam = (new URLSearchParams(location.search).get("char") || "").replace(/[^a-z0-9_-]/gi, ""); } catch (e) { charParam = ""; }
	/* the dungeon character is a CC0 Quaternius low-poly "Adventurer" (.glb), flat-shaded to match the
	   scene; overridable via ?char=<name> for swapping/auditing models */
	var characterUrl = "models/" + (charParam || "adventurer") + ".glb";
	var characterScale = 1;

	if (dungeon && heroEl && scene) {
		var glCanvas = dungeon.querySelector(".dungeon__gl");
		if (prefer3D && glCanvas) {
			import("./dungeon3d.js")
				.then(function (m) {
					return m.initDungeon3D({
						dungeon: dungeon, canvas: glCanvas, xpEl: xpEl, reduceMotion: reduceMotion,
						characterUrl: characterUrl, characterScale: characterScale,
						/* no usable <dialog> ⇒ no panels ⇒ build no hotspots/fly path (avoids a focused-camera lockup) */
						hotspots: canPanel ? HOTSPOTS : [],
						onFlyStart: function (h) { announceTransit(h && h.label); },   /* keep focus off <body> during the fly */
						onArrive: function (h, btn) { openPanel(h.sel, btn); }          /* fly completes → open that section's panel */
					});
				})
				.then(function (ctrl) {
					world = ctrl; document.body.classList.add("world-on");   /* promote the hero to a full-viewport world */
					/* the boxed-dungeon label promised click-to-walk + dash; in world-on clicking is inert and walking
					   is suspended during flights, so describe the actual controls (Tab + arrows, MENU/landmarks) */
					dungeon.setAttribute("aria-label", "Mini-dungeon — press Tab to focus, then arrow keys (or W A S D) to walk the rogue down the hall; or use the MENU or the glowing landmarks to travel to a section.");
				})
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
