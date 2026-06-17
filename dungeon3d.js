/* =====================================================================
   Martin Sosa — real-3D mini-dungeon (WebGL via Three.js).
   Progressive enhancement: index.js only loads this when WebGL is
   available and the visitor isn't on reduced-motion / save-data — and
   falls back to the hand-rolled 2.5D corridor otherwise.

   Vendored Three.js (r160), imported by relative path — no CDN, no
   importmap, works offline. Reuses hero-rogue.png as a billboard sprite
   so the rogue keeps its pixel-art identity.
   ===================================================================== */
import * as THREE from "./vendor/three.module.min.js";

export function initDungeon3D(opts) {
	var dungeon = opts.dungeon;
	var canvas = opts.canvas;
	var xpEl = opts.xpEl;
	if (!dungeon || !canvas) throw new Error("dungeon3d: missing canvas/host");

	/* ---- world constants (units ≈ metres) ---- */
	var HALF_W = 2.4;          /* corridor half-width: walls at x = ±HALF_W   */
	var WALL_H = 3.4;          /* floor at y=0, ceiling at y=WALL_H           */
	var LEN = 120;             /* length of the static corridor planes        */
	var ROGUE_Z = 1.6;         /* rogue stands here; camera sits just behind  */
	var CAM = { x: 0, y: 1.62, z: 4.3 };
	var MAX_X = HALF_W - 0.6;  /* how far the rogue may strafe                */
	var SPAN = 56;             /* recycle distance for moving decor           */
	var NEAR = CAM.z + 4;      /* recycle once decor passes this z            */
	var BASE_SPD = 6.2;        /* units/sec walking; ×DASH_MUL while dashing  */
	var DASH_MUL = 3.2;

	/* ---- renderer ---- */
	var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "low-power" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	var scene = new THREE.Scene();
	scene.background = new THREE.Color(0x07060c);
	scene.fog = new THREE.FogExp2(0x07060c, 0.055);   /* hides the far recycle seam + sells depth */

	var camera = new THREE.PerspectiveCamera(64, 1, 0.1, 200);
	camera.position.set(CAM.x, CAM.y, CAM.z);
	camera.lookAt(0, 1.15, -12);

	/* ---- lighting: dim warm base + flickering torch pools ---- */
	scene.add(new THREE.AmbientLight(0x3a2a30, 1.6));
	scene.add(new THREE.HemisphereLight(0x2a2230, 0x05040a, 0.5));

	/* ======================= procedural textures ======================= */
	function px2(draw) {
		var c = document.createElement("canvas"); c.width = c.height = 256;
		draw(c.getContext("2d"), 256);
		var t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.magFilter = THREE.NearestFilter;
		return t;
	}
	function rnd() { return Math.random(); }
	function brickTex(base, mortar, hi, cols, rows) {
		return px2(function (g, S) {
			g.fillStyle = mortar; g.fillRect(0, 0, S, S);
			var bw = S / cols, bh = S / rows, m = Math.max(1, S / 128);
			for (var r = 0; r < rows; r++) {
				var off = (r % 2) ? bw / 2 : 0;
				for (var i = -1; i < cols; i++) {
					var x = i * bw + off + m, y = r * bh + m, w = bw - m * 2, h = bh - m * 2;
					var v = 0.82 + rnd() * 0.36;
					g.fillStyle = shade(base, v); g.fillRect(x, y, w, h);
					g.fillStyle = shade(hi, 1);   g.fillRect(x, y, w, Math.max(1, m)); /* top highlight */
				}
			}
		});
	}
	function flagTex(base, mortar) {
		return px2(function (g, S) {
			g.fillStyle = mortar; g.fillRect(0, 0, S, S);
			var n = 4, t = S / n, m = S / 96;
			for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) {
				var v = 0.8 + rnd() * 0.4;
				g.fillStyle = shade(base, v);
				g.fillRect(a * t + m, b * t + m, t - m * 2, t - m * 2);
			}
		});
	}
	function radialTex(inner, outer) {
		var c = document.createElement("canvas"); c.width = c.height = 128;
		var g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
		gr.addColorStop(0, inner); gr.addColorStop(1, outer);
		g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
		var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
	}
	function shade(hex, f) {
		var r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
		var cl = function (n) { return Math.max(0, Math.min(255, Math.round(n))); };
		return "rgb(" + cl(r * f) + "," + cl(g * f) + "," + cl(b * f) + ")";
	}

	/* ======================= corridor shell ======================= */
	var wallTex = brickTex(0x1d1a28, 0x0c0a12, 0x322c44, 6, 10);
	wallTex.repeat.set(LEN / 5, 2);
	var floorTex = flagTex(0x17141f, 0x09080e); floorTex.repeat.set(2, LEN / 5);
	var ceilTex = brickTex(0x141019, 0x07060b, 0x241f30, 5, 10); ceilTex.repeat.set(LEN / 6, 2);

	var lambo = function (tex) { return new THREE.MeshLambertMaterial({ map: tex }); };

	var floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, LEN), lambo(floorTex));
	floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0); scene.add(floor);

	var ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, LEN), lambo(ceilTex));
	ceil.rotation.x = Math.PI / 2; ceil.position.set(0, WALL_H, 0); scene.add(ceil);

	var wallL = new THREE.Mesh(new THREE.PlaneGeometry(LEN, WALL_H), lambo(wallTex.clone()));
	wallL.material.map.repeat.copy(wallTex.repeat); wallL.material.map.needsUpdate = true;
	wallL.rotation.y = Math.PI / 2; wallL.position.set(-HALF_W, WALL_H / 2, 0); scene.add(wallL);

	var wallR = new THREE.Mesh(new THREE.PlaneGeometry(LEN, WALL_H), lambo(wallTex.clone()));
	wallR.material.map.repeat.copy(wallTex.repeat); wallR.material.map.needsUpdate = true;
	wallR.rotation.y = -Math.PI / 2; wallR.position.set(HALF_W, WALL_H / 2, 0); scene.add(wallR);

	/* ======================= passing arches (parallax) ======================= */
	var archMat = new THREE.MeshLambertMaterial({ color: 0x100d18 });
	var arches = [];
	var ARCH_GAP = 8, ARCH_N = Math.ceil(SPAN / ARCH_GAP);
	for (var ai = 0; ai < ARCH_N; ai++) {
		var grp = new THREE.Group();
		var lintel = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.3, 0.5, 0.4), archMat);
		lintel.position.y = WALL_H - 0.25; grp.add(lintel);
		var pL = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_H, 0.5), archMat);
		pL.position.set(-HALF_W - 0.05, WALL_H / 2, 0); grp.add(pL);
		var pR = pL.clone(); pR.position.x = HALF_W + 0.05; grp.add(pR);
		grp.position.z = NEAR - (ai + 1) * ARCH_GAP;
		scene.add(grp); arches.push(grp);
	}

	/* ======================= torches w/ live point-lights ======================= */
	var flameTex = radialTex("rgba(255,228,150,1)", "rgba(214,90,31,0)");
	var torches = [];
	var TORCH_GAP = 14, TORCH_N = Math.ceil(SPAN / TORCH_GAP);
	for (var ti = 0; ti < TORCH_N; ti++) {
		var side = (ti % 2) ? 1 : -1;
		var t = new THREE.Group();
		var bracket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), new THREE.MeshLambertMaterial({ color: 0x2a2030 }));
		bracket.position.set(side * (HALF_W - 0.12), 2.0, 0); t.add(bracket);
		var flame = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
		flame.position.set(side * (HALF_W - 0.12), 2.5, 0.02); t.add(flame);
		var light = new THREE.PointLight(0xff8a3d, 14, 16, 2);
		light.position.set(side * (HALF_W - 0.3), 2.45, 0); t.add(light);
		t.position.z = NEAR - (ti + 1) * TORCH_GAP;
		t.userData = { flame: flame, light: light, seed: rnd() * 6.28 };
		scene.add(t); torches.push(t);
	}

	/* ======================= the rogue (billboard sprite) ======================= */
	var ROGUE_H = 1.7, ROGUE_W = ROGUE_H * (24 / 32);
	var rogue = new THREE.Group(); rogue.position.set(0, 0, ROGUE_Z); scene.add(rogue);
	var rogueMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide });
	var rogueSprite = new THREE.Mesh(new THREE.PlaneGeometry(ROGUE_W, ROGUE_H), rogueMat);
	rogueSprite.position.y = ROGUE_H / 2; rogue.add(rogueSprite);
	/* soft contact shadow under the rogue */
	var shadowTex = radialTex("rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
	var shadow = new THREE.Mesh(new THREE.PlaneGeometry(ROGUE_W * 1.3, ROGUE_W * 1.3), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
	shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; rogue.add(shadow);
	/* dash aura (fades in while dashing) */
	var aura = new THREE.Mesh(new THREE.PlaneGeometry(ROGUE_W * 2.4, ROGUE_H * 1.4), new THREE.MeshBasicMaterial({ map: radialTex("rgba(255,138,61,0.8)", "rgba(255,138,61,0)"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
	aura.position.set(0, ROGUE_H / 2, -0.05); rogue.add(aura);

	var FRAME = { front: 0, side: 1 / 3, back: 2 / 3 };   /* hero-rogue.png order: front | side | back */
	new THREE.TextureLoader().load("hero-rogue.png", function (tex) {
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.x = 1 / 3; tex.offset.x = FRAME.front;
		rogueMat.map = tex; rogueMat.needsUpdate = true;
		markDirty();   /* repaint once the sprite has loaded (matters if the loop has parked) */
	});

	/* ======================= slimes (real 3D meshes) ======================= */
	var slimeBody = new THREE.MeshPhongMaterial({ color: 0x6ab04c, emissive: 0x12300d, shininess: 40, specular: 0x9fe07f });
	var eyeW = new THREE.MeshBasicMaterial({ color: 0xeef2fb });
	var eyeB = new THREE.MeshBasicMaterial({ color: 0x0b0a10 });
	var slimes = [];
	function spawnSlime(s) {
		s.group.position.x = (rnd() * 2 - 1) * MAX_X;
		s.group.position.z = NEAR - SPAN * (0.25 + rnd() * 0.7);
		s.alive = true; s.group.visible = true; s.group.scale.setScalar(1); s.dyingT = 0;
		s.seed = rnd() * 6.28;
	}
	for (var si = 0; si < 5; si++) {
		var sg = new THREE.Group();
		var body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), slimeBody);
		body.scale.y = 0.66; body.position.y = 0.3; sg.add(body);
		var e1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), eyeB); e1.position.set(-0.13, 0.34, 0.34); sg.add(e1);
		var e2 = e1.clone(); e2.position.x = 0.13; sg.add(e2);
		var g1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeW); g1.position.set(-0.15, 0.37, 0.41); sg.add(g1);
		var g2 = g1.clone(); g2.position.x = 0.11; sg.add(g2);
		var slime = { group: sg, body: body, alive: true, dyingT: 0, seed: 0 };
		spawnSlime(slime);
		sg.position.z = NEAR - (si + 1) * (SPAN / 6);   /* spread the first few into view */
		scene.add(sg); slimes.push(slime);
	}

	/* ======================= floating dust motes ======================= */
	var DUST = 60, dpos = new Float32Array(DUST * 3);
	for (var di = 0; di < DUST; di++) {
		dpos[di * 3] = (rnd() * 2 - 1) * HALF_W;
		dpos[di * 3 + 1] = rnd() * WALL_H;
		dpos[di * 3 + 2] = NEAR - rnd() * SPAN;
	}
	var dustGeo = new THREE.BufferGeometry();
	dustGeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
	var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: radialTex("rgba(255,210,150,0.9)", "rgba(255,210,150,0)"), color: 0xffcaa0, size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
	scene.add(dust);

	/* ======================= input (mirrors the 2D dungeon) ======================= */
	var WATCH = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1 };
	var keys = {}, pointerDir = 0, heroX = 0, stepPhase = 0, dashT = 0, dashCd = 0, xp = 0;

	function anyKey() { for (var k in keys) if (keys[k]) return true; return false; }
	dungeon.addEventListener("keydown", function (e) {
		if (e.code === "ShiftLeft" || e.code === "ShiftRight") { if (dashT <= 0 && dashCd <= 0) { dashT = 0.16; dashCd = 0.5; } kick(); return; }
		if (!WATCH[e.code]) return;
		e.preventDefault(); keys[e.code] = true; kick();
	});
	function onKeyUp(e) { if (WATCH[e.code]) keys[e.code] = false; }
	window.addEventListener("keyup", onKeyUp);
	dungeon.addEventListener("blur", function () { keys = {}; pointerDir = 0; });
	function pdir(e) {
		var r = dungeon.getBoundingClientRect();
		var cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
		return cy < r.height / 2 ? -1 : 1;
	}
	dungeon.addEventListener("pointerdown", function (e) { dungeon.focus({ preventScroll: true }); pointerDir = pdir(e); kick(); });
	dungeon.addEventListener("pointermove", function (e) { if (pointerDir !== 0) { pointerDir = pdir(e); kick(); } });
	function onPointerUp() { pointerDir = 0; }
	window.addEventListener("pointerup", onPointerUp);
	dungeon.addEventListener("pointercancel", function () { pointerDir = 0; });

	/* ======================= XP popups (reuse the 2D CSS) ======================= */
	var _v = new THREE.Vector3();
	function popXP(worldVec) {
		xp++; if (xpEl) xpEl.textContent = "✦ " + xp;
		var r = dungeon.getBoundingClientRect();
		_v.copy(worldVec).project(camera);
		var p = document.createElement("div");
		p.className = "xp-pop"; p.textContent = "+1 XP";
		p.style.left = ((_v.x * 0.5 + 0.5) * r.width) + "px";
		p.style.top = ((-_v.y * 0.5 + 0.5) * r.height) + "px";
		dungeon.appendChild(p);
		p.addEventListener("animationend", function () { p.remove(); });
	}

	/* ======================= recycle helpers ======================= */
	function wrap(obj, dz) {
		obj.position.z += dz;
		if (obj.position.z > NEAR) obj.position.z -= SPAN;
		else if (obj.position.z < NEAR - SPAN) obj.position.z += SPAN;
	}

	/* ======================= main loop ======================= */
	/* honor reduced-motion live: this module is normally gated out for those users,
	   but respect a mid-session OS toggle too (the gate only checks once, at load) */
	var reduceMotion = !!opts.reduceMotion;
	var rmq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
	if (rmq) {
		reduceMotion = reduceMotion || rmq.matches;
		if (rmq.addEventListener) rmq.addEventListener("change", function (e) { reduceMotion = e.matches; markDirty(); });
	}
	var IDLE_FRAME = 1 / 24;     /* when idle, cap the ambient (torch flicker) render rate */

	var clock = new THREE.Clock();
	var running = false, raf = 0, disposed = false, dirty = true, idleAccum = 0, slimeEye = new THREE.Vector3();

	/* re-arm the loop after it parks (used on input + when something needs a redraw) */
	function kick() { if (running && !raf && !disposed) { clock.getDelta(); raf = requestAnimationFrame(frame); } }
	function markDirty() { dirty = true; kick(); }

	function frame() {
		var dt = Math.min(clock.getDelta(), 0.05);
		var time = clock.elapsedTime;
		if (dashT > 0) dashT = Math.max(0, dashT - dt);
		if (dashCd > 0) dashCd = Math.max(0, dashCd - dt);
		var dashing = dashT > 0;

		var up = keys.ArrowUp || keys.KeyW || pointerDir === -1;
		var dn = keys.ArrowDown || keys.KeyS || pointerDir === 1;
		var lf = keys.ArrowLeft || keys.KeyA;
		var rt = keys.ArrowRight || keys.KeyD;
		if (dashing && !(up || dn || lf || rt)) up = true;   /* dash forward if nothing held */
		var moving = up || dn || lf || rt;
		var spd = BASE_SPD * (dashing ? DASH_MUL : 1) * dt;

		/* forward/back → scroll the world toward/past the camera */
		var dz = 0;
		if (up) dz = spd; else if (dn) dz = -spd;
		if (rt) heroX = Math.min(MAX_X, heroX + spd);
		if (lf) heroX = Math.max(-MAX_X, heroX - spd);

		/* rogue facing: forward shows the back, back shows the face, strafing shows the side */
		if (rogueMat.map) {
			if (up) rogueMat.map.offset.x = FRAME.back;
			else if (dn) rogueMat.map.offset.x = FRAME.front;
			else if (lf || rt) rogueMat.map.offset.x = FRAME.side;
			else rogueMat.map.offset.x = FRAME.front;
		}
		rogueSprite.scale.x = (lf && !rt) ? -1 : 1;

		/* glide the rogue + a hint of camera follow (user-driven, always runs);
		   the step bob is autonomous, so reduced-motion pins it flat */
		if (moving && !reduceMotion) stepPhase = (stepPhase + dt * (dashing ? 22 : 12)) % (Math.PI * 2);
		rogue.position.x += (heroX - rogue.position.x) * Math.min(1, dt * 14);
		rogue.position.y = (moving && !reduceMotion) ? Math.abs(Math.sin(stepPhase)) * 0.07 : 0;
		camera.position.x += (heroX * 0.22 - camera.position.x) * Math.min(1, dt * 6);
		aura.material.opacity += ((dashing ? 0.85 : 0) - aura.material.opacity) * Math.min(1, dt * 12);

		/* scroll the shell textures so the stone surfaces move with you */
		if (dz !== 0) {
			floorTex.offset.y -= dz * 0.18; ceilTex.offset.x += dz * 0.12;
			wallL.material.map.offset.x -= dz * 0.16; wallR.material.map.offset.x += dz * 0.16;
		}

		/* is anything still in motion? idle frames are throttled (and frozen under reduced-motion)
		   so an on-screen-but-idle visitor isn't paying full 60fps GPU cost for nothing */
		var i, dying = false;
		for (i = 0; i < slimes.length; i++) if (slimes[i].dyingT > 0) { dying = true; break; }
		var settling = Math.abs(heroX - rogue.position.x) > 0.001 ||
			Math.abs(heroX * 0.22 - camera.position.x) > 0.001 || aura.material.opacity > 0.003;
		var activeNow = moving || dashing || settling || dying;

		var doRender = activeNow || dirty;
		if (activeNow || dirty) idleAccum = 0;
		else if (!reduceMotion) { idleAccum += dt; if (idleAccum >= IDLE_FRAME) { idleAccum = 0; doRender = true; } }

		if (doRender) {
			for (i = 0; i < arches.length; i++) wrap(arches[i], dz);
			for (i = 0; i < torches.length; i++) {
				var T = torches[i]; wrap(T, dz);
				var fl = reduceMotion ? 0.85 : 0.72 + Math.sin(time * 11 + T.userData.seed) * 0.12 + Math.sin(time * 23 + T.userData.seed) * 0.08;
				T.userData.light.intensity = 14 * fl;
				T.userData.flame.scale.set(0.85 + fl * 0.3, 0.8 + fl * 0.4, 1);
				T.userData.flame.material.opacity = 0.7 + fl * 0.3;
			}

			var arr = dustGeo.attributes.position.array;
			for (i = 0; i < DUST; i++) {
				arr[i * 3 + 2] += dz + (reduceMotion ? 0 : dt * 0.2);
				if (!reduceMotion) arr[i * 3 + 1] += Math.sin(time + i) * dt * 0.05;
				if (arr[i * 3 + 2] > NEAR) arr[i * 3 + 2] -= SPAN;
				else if (arr[i * 3 + 2] < NEAR - SPAN) arr[i * 3 + 2] += SPAN;
			}
			dustGeo.attributes.position.needsUpdate = true;

			/* slimes: world-locked — they scroll with the corridor via wrap(), like the arches/torches —
			   idle-bob, and die on a dash-overlap (a standstill dash forces forward motion, so kills still land) */
			for (i = 0; i < slimes.length; i++) {
				var s = slimes[i];
				if (s.dyingT > 0) {
					s.dyingT -= dt;
					var k = Math.max(0, s.dyingT / 0.32);
					s.group.scale.set(1 + (1 - k) * 0.3, k, 1 + (1 - k) * 0.3);
					if (s.dyingT <= 0) spawnSlime(s);
					continue;
				}
				wrap(s.group, dz);
				s.body.position.y = 0.3 + (reduceMotion ? 0 : Math.abs(Math.sin(time * 3 + s.seed)) * 0.06);
				if (dashing && s.alive &&
					Math.abs(s.group.position.z - ROGUE_Z) < 1.3 &&
					Math.abs(s.group.position.x - rogue.position.x) < 0.8) {
					s.alive = false; s.dyingT = 0.32;
					slimeEye.set(s.group.position.x, 0.5, s.group.position.z);
					popXP(slimeEye);
				}
			}

			renderer.render(scene, camera);
			dirty = false;
		}

		dungeon.classList.toggle("is-playing", moving);
		/* keep looping while active or for ambient flicker; park (raf=0) when reduced-motion + idle */
		if (running && (activeNow || dirty || !reduceMotion)) raf = requestAnimationFrame(frame);
		else raf = 0;
	}

	/* start()/stop() are the on-screen lifecycle gate. NOTE: a reduced-motion-idle park leaves
	   running=true with raf=0 — only kick()/markDirty() wakes it, not start() (which no-ops while running). */
	function start() { if (disposed || running) return; running = true; clock.getDelta(); raf = requestAnimationFrame(frame); }
	function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

	/* ---- size to the host element, keep it crisp on resize ---- */
	function resize() {
		var w = dungeon.clientWidth || 300, h = dungeon.clientHeight || 380;
		renderer.setSize(w, h, false);
		camera.aspect = w / h; camera.updateProjectionMatrix();
		markDirty();
	}
	resize();
	var ro = null;
	if ("ResizeObserver" in window) { ro = new ResizeObserver(resize); ro.observe(dungeon); }
	else window.addEventListener("resize", resize);

	/* ---- only animate while on-screen + tab visible (battery friendly) ---- */
	var onScreen = true, io = null;
	function sync() { if (onScreen && !document.hidden) start(); else stop(); }
	if ("IntersectionObserver" in window) {
		io = new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }, { threshold: 0.01 });
		io.observe(dungeon);
	}
	document.addEventListener("visibilitychange", sync);

	/* ---- flip the host into 3D mode (CSS hides the 2D layers, shows canvas) ---- */
	dungeon.classList.add("dungeon--gl");
	sync();   /* start only if actually on-screen + tab-visible */

	return {
		dispose: function () {
			disposed = true; stop();
			if (io) io.disconnect();
			if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
			document.removeEventListener("visibilitychange", sync);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("pointerup", onPointerUp);
			renderer.dispose();
		}
	};
}
