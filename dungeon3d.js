/* =====================================================================
   Martin Sosa — real-3D mini-dungeon (WebGL via Three.js).
   Progressive enhancement: index.js only loads this when WebGL is
   available and the visitor isn't on reduced-motion / save-data — and
   falls back to the hand-rolled 2.5D corridor otherwise.

   Vendored Three.js (r160), imported by relative path — no CDN, no
   importmap, works offline. The rogue and slimes are procedural low-poly
   (flat-shaded primitives) — no external model assets yet; asset-pack models
   come in the full-world build phase.
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
	var FRAME_X = -0.7;        /* dolly the camera left so the rogue frames into the RIGHT-hand
	                              negative space, clear of the lower-left content card (2a) */
	var MAX_X = HALF_W - 1.2;  /* how far the rogue may strafe (keeps it inside the camera view) */
	var SPAN = 56;             /* recycle distance for moving decor           */
	var NEAR = CAM.z + 4;      /* recycle once decor passes this z            */
	var BASE_SPD = 6.2;        /* units/sec walking; ×DASH_MUL while dashing  */
	var DASH_MUL = 3.2;

	/* ---- renderer ---- */
	var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "low-power" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	var scene = new THREE.Scene();
	/* a richer, slightly-lit purple haze instead of near-black — the far hall glows rather than
	   crushing to black, which reads as more vivid + sells depth (2a polish) */
	scene.background = new THREE.Color(0x171026);
	scene.fog = new THREE.FogExp2(0x1b1330, 0.034);   /* hides the far recycle seam + sells depth */

	var camera = new THREE.PerspectiveCamera(64, 1, 0.1, 200);
	camera.position.set(CAM.x, CAM.y, CAM.z);
	camera.lookAt(0, 1.15, -12);     /* establish a parallel-in-x orientation while still centered... */
	camera.position.x = FRAME_X;     /* ...then dolly left WITHOUT re-aiming, framing the rogue right-of-centre */

	/* fixed forward vector for the "home" idle view: looking at (camera.pos + F0) every frame
	   reproduces that orientation exactly (so the 2a drift is preserved), while a fly tween instead
	   eases position + a separate look target toward a landmark and back (2b click-to-fly). */
	var F0 = new THREE.Vector3(0, 1.15, -12).sub(new THREE.Vector3(CAM.x, CAM.y, CAM.z)).normalize();
	var camMode = "home";            /* "home" | "flying" | "focused" | "returning" */
	var tweenT = 0, tweenDur = 0.85, pendingArrive = null;
	var homePos = new THREE.Vector3(), lookAt = new THREE.Vector3();
	var fromPos = new THREE.Vector3(), toPos = new THREE.Vector3();
	var fromLook = new THREE.Vector3(), toLook = new THREE.Vector3();

	/* ---- lighting: readable warm base + flickering torch pools ----
	   (light COLORS must be reasonably bright — a dark ambient color emits almost nothing) */
	scene.add(new THREE.AmbientLight(0x8a7f99, 3.0));
	scene.add(new THREE.HemisphereLight(0x9c8fb4, 0x2e2438, 1.85));
	/* a warm "hero" light that follows the rogue so the character always reads, wherever the torches are */
	var heroLight = new THREE.PointLight(0xffd9a8, 26, 12, 2);
	heroLight.position.set(0, 2.1, ROGUE_Z + 2.0); scene.add(heroLight);

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
	/* stone albedo lifted out of near-black into a saturated indigo/violet so torchlight has something
	   vivid to catch — dark albedo stays dark no matter how bright the lights (2a polish) */
	var wallTex = brickTex(0x2c2742, 0x16121f, 0x534873, 6, 10);
	wallTex.repeat.set(LEN / 5, 2);
	var floorTex = flagTex(0x221d30, 0x100c18); floorTex.repeat.set(2, LEN / 5);
	var ceilTex = brickTex(0x1f1a2c, 0x0c0a12, 0x3c3454, 5, 10); ceilTex.repeat.set(LEN / 6, 2);

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
		var light = new THREE.PointLight(0xff8a3d, 38, 20, 2);
		light.position.set(side * (HALF_W - 0.3), 2.45, 0); t.add(light);
		t.position.z = NEAR - (ti + 1) * TORCH_GAP;
		t.userData = { flame: flame, light: light, seed: rnd() * 6.28 };
		scene.add(t); torches.push(t);
	}

	/* ======================= the rogue (procedural low-poly, flat-shaded) ======================= */
	var ROGUE_H = 1.7;
	var rogue = new THREE.Group(); rogue.position.set(0, 0, ROGUE_Z); rogue.rotation.y = Math.PI; scene.add(rogue);
	function flat(color, o) {
		o = o || {};
		return new THREE.MeshPhongMaterial({ color: color, flatShading: true, shininess: o.shininess || 6, specular: o.specular || 0x14121a, emissive: o.emissive || 0x000000 });
	}
	var C_CLOAK = 0x241d36, C_HOOD = 0x14111e, C_TRIM = 0xe8c170, C_SKIN = 0x554862, C_STEEL = 0xcfd6e6, C_LEG = 0x161222;
	/* a pivoting limb: a Group at the joint, with the limb hanging below the origin so it swings from the top */
	function limb(len, w, color, jx, jy) {
		var g = new THREE.Group(); g.position.set(jx, jy, 0);
		var m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), flat(color));
		m.position.y = -len / 2; g.add(m); rogue.add(g); return g;
	}
	/* body: a 6-sided tapered cloak (narrow shoulders, flared hem) + a gold belt */
	var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.27, 0.82, 6), flat(C_CLOAK));
	torso.position.y = 0.92; rogue.add(torso);
	var belt = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 6), flat(C_TRIM, { shininess: 30 }));
	belt.position.y = 0.74; rogue.add(belt);
	/* head + pointed hood, with two faint gold eyes peering out */
	var head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), flat(C_SKIN));
	head.position.y = 1.4; rogue.add(head);
	/* a low, wide cowl that wraps the head — not a witch hat */
	var hood = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.28, 7), flat(C_HOOD));
	hood.position.set(0, 1.47, -0.03); rogue.add(hood);
	/* two glowing eyes with a gap (so it doesn't read as a single-eyed cyclops) */
	function eye(x) {
		var e = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.02), new THREE.MeshBasicMaterial({ color: C_TRIM }));
		e.position.set(x, 1.38, 0.14); rogue.add(e); return e;
	}
	eye(-0.07); eye(0.07);
	/* arms (pivot at shoulders) + legs (pivot at hips) */
	var armL = limb(0.42, 0.09, C_CLOAK, -0.22, 1.18);
	var armR = limb(0.42, 0.09, C_CLOAK, 0.22, 1.18);
	var legL = limb(0.5, 0.11, C_LEG, -0.1, 0.56);
	var legR = limb(0.5, 0.11, C_LEG, 0.1, 0.56);
	/* a little gold dagger in the right hand (on-brand with the sword motif) */
	var dagger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), flat(C_STEEL, { shininess: 60, specular: 0x9aa2b8 }));
	dagger.position.y = -0.42; dagger.rotation.x = -0.35; armR.add(dagger);
	var rogueFacing = Math.PI;   /* heading in radians; starts looking away, down the hall */

	/* soft contact shadow (stays flat under the rogue as it turns) */
	var shadowTex = radialTex("rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
	var shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
	shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; rogue.add(shadow);
	/* dash aura — a scene-space billboard so it always faces the camera (not parented to the turning rogue) */
	var aura = new THREE.Mesh(new THREE.PlaneGeometry(1.7, ROGUE_H * 1.25), new THREE.MeshBasicMaterial({ map: radialTex("rgba(255,138,61,0.8)", "rgba(255,138,61,0)"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
	aura.position.set(0, 0.9, ROGUE_Z); scene.add(aura);

	/* ======================= slimes (real 3D meshes) ======================= */
	var slimeBody = new THREE.MeshPhongMaterial({ color: 0x6ab04c, emissive: 0x12300d, shininess: 40, specular: 0x9fe07f, flatShading: true });
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
		var body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 1), slimeBody);
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

	/* ======================= 2b: landmarks + clickable hotspots ======================= */
	/* Each menu destination gets a low-poly landmark down the hall + a floating HTML pill button
	   positioned over the landmark's projected anchor every frame. The pills are real <button>s in
	   an overlay layer, so hotspots are keyboard-focusable and screen-reader-labelled for free —
	   the meshes are pure eye-candy. The pills bridge to index.js via opts.onArrive(). */
	function box(w, h, d, color, o) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(color, o)); }
	var landmarkGlowTex = radialTex("rgba(255,228,170,0.7)", "rgba(255,228,170,0)");
	function buildChest(g) {
		var base = box(0.7, 0.4, 0.5, 0x5b3a1e); base.position.y = 0.2; g.add(base);
		var lid = box(0.72, 0.22, 0.52, 0x6f4d28); lid.position.y = 0.5; g.add(lid);
		var trim = box(0.74, 0.05, 0.54, C_TRIM, { shininess: 30 }); trim.position.y = 0.4; g.add(trim);
		var lock = box(0.12, 0.14, 0.06, C_TRIM, { shininess: 40 }); lock.position.set(0, 0.42, 0.28); g.add(lock);
	}
	function buildAltar(g) {
		var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.72, 6), flat(0x3a3450)); ped.position.y = 0.36; g.add(ped);
		var top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 6), flat(0x4a4163)); top.position.y = 0.74; g.add(top);
		var pot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), flat(0x5db1e0, { emissive: 0x1f5573, shininess: 60 }));
		pot.position.y = 0.96; pot.scale.y = 1.2; g.add(pot);
	}
	function buildLectern(g) {
		var post = box(0.12, 0.9, 0.12, 0x4a4163); post.position.y = 0.45; g.add(post);
		var desk = box(0.5, 0.06, 0.34, 0x5b3a1e); desk.position.set(0, 0.92, 0); desk.rotation.x = -0.5; g.add(desk);
		var scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), flat(0xe8d5a8));
		scroll.rotation.z = Math.PI / 2; scroll.position.set(0, 1.03, 0.05); g.add(scroll);
	}
	function buildPortal(g) {
		var ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.12, 8, 7), flat(0x4a4163, { emissive: 0x2a1f44 }));
		ring.position.y = 1.15; g.add(ring);
		var inner = new THREE.Mesh(new THREE.CircleGeometry(0.7, 7), new THREE.MeshBasicMaterial({ color: 0x7a4fd0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
		inner.position.set(0, 1.15, 0.02); g.add(inner);
		g.userData.portalInner = inner;
	}

	var hsHost = (dungeon.closest && dungeon.closest(".hero")) || dungeon.parentNode;
	/* the lower-left content card shares this coordinate space (it & the layer are both laid out in .hero);
	   placeHotspots() keeps pills from landing behind it at narrow widths */
	var cardEl = (hsHost && hsHost.querySelector) ? hsHost.querySelector(".char-sheet__info") : null;
	var hsLayer = document.createElement("div");
	hsLayer.className = "world-hotspots world-hotspots--hidden";
	if (hsHost) hsHost.appendChild(hsLayer);
	var hotspots = opts.hotspots || [];
	hotspots.forEach(function (h) {
		var g = new THREE.Group();
		var lx = (typeof h.x === "number") ? h.x : 0;
		g.position.set(lx, 0, h.z);
		var labelY = 1.7;
		if (h.kind === "chest") buildChest(g);
		else if (h.kind === "altar") buildAltar(g);
		else if (h.kind === "lectern") buildLectern(g);
		else if (h.kind === "portal") { buildPortal(g); labelY = 2.55; }
		var glow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: landmarkGlowTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
		glow.position.set(0, 0.75, 0.06); g.add(glow);
		scene.add(g);
		h._group = g; h._anchor = new THREE.Vector3(lx, labelY, h.z);

		var b = document.createElement("button");
		b.type = "button"; b.className = "world-hotspot"; b.style.display = "none";
		b.setAttribute("aria-label", "Travel to " + h.label);
		b.innerHTML = '<svg class="sprite" aria-hidden="true" focusable="false"><use href="#' + h.sprite + '"/></svg><span>' + h.label + '</span>';
		b.addEventListener("click", function (e) { e.preventDefault(); startFly(h); });
		hsLayer.appendChild(b);
		h._btn = b;
	});

	var _pv = new THREE.Vector3();
	function placeHotspots() {
		var w = dungeon.clientWidth || 300, ht = dungeon.clientHeight || 380;
		var vis = [];
		for (var i = 0; i < hotspots.length; i++) {
			var hp = hotspots[i], b = hp._btn;
			_pv.copy(hp._anchor).project(camera);
			if (_pv.z > 1 || _pv.x < -1.1 || _pv.x > 1.1 || _pv.y < -1.1 || _pv.y > 1.1) { b.style.display = "none"; continue; }
			vis.push({ b: b, x: (_pv.x * 0.5 + 0.5) * w, y: (-_pv.y * 0.5 + 0.5) * ht });
		}
		/* corridor perspective bunches the deeper landmarks near the vanishing point; keep each pill
		   over its landmark's x but spread them vertically so the labels never overlap / occlude */
		vis.sort(function (a, b) { return a.y - b.y; });
		var MIN = 38;
		for (var j = 1; j < vis.length; j++) if (vis[j].y - vis[j - 1].y < MIN) vis[j].y = vis[j - 1].y + MIN;
		/* card box in the same coord space (read once, before any writes this frame, so layout stays clean) */
		var card = cardEl ? { l: cardEl.offsetLeft, t: cardEl.offsetTop, r: cardEl.offsetLeft + cardEl.offsetWidth, bo: cardEl.offsetTop + cardEl.offsetHeight } : null;
		var mm;
		for (mm = 0; mm < vis.length; mm++) vis[mm].b.style.display = "";   /* show first so widths can be measured */
		for (mm = 0; mm < vis.length; mm++) {
			var v = vis[mm], b = v.b;
			var pw = b._w || (b._w = b.offsetWidth) || 90;   /* fixed labels → measure + cache once */
			var ph = b._h || (b._h = b.offsetHeight) || 30;
			/* keep the pill off the lower-left card: if it would overlap, push it just past the card's
			   right edge; if it still can't fit on-screen, hide it rather than bury it behind the card */
			if (card && v.x + pw / 2 > card.l && v.x - pw / 2 < card.r && v.y > card.t && v.y - ph < card.bo) {
				var nx = card.r + 12 + pw / 2;
				if (nx + pw / 2 <= w) v.x = nx; else { b.style.display = "none"; continue; }
			}
			b.style.left = v.x.toFixed(1) + "px";
			b.style.top = v.y.toFixed(1) + "px";
		}
	}

	function easeIO(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
	function startFly(h) {
		if (!h) return;
		if (opts.onFlyStart) opts.onFlyStart(h);   /* let the host manage focus/announce before the pill hides */
		fromPos.copy(camera.position); fromLook.copy(lookAt);
		var lx = h._anchor.x;
		toPos.set(lx * 0.45, 1.5, h.z + 3.4);
		toLook.set(lx, h.kind === "portal" ? 1.3 : 0.85, h.z);
		tweenT = 0; tweenDur = reduceMotion ? 0.001 : 0.85; pendingArrive = h; camMode = "flying";
		hsLayer.classList.add("world-hotspots--hidden");
		kick();
	}
	function flyHome() {
		fromPos.copy(camera.position); fromLook.copy(lookAt);
		toPos.set(FRAME_X, CAM.y, CAM.z); toLook.copy(toPos).add(F0);
		tweenT = 0; tweenDur = reduceMotion ? 0.001 : 0.7; pendingArrive = null; camMode = "returning";
		kick();
	}
	function updateCamera(dt, time, hx) {
		var rm = reduceMotion;
		var sway = rm ? 0 : Math.sin(time * 0.32) * 0.22;
		homePos.set(FRAME_X + hx * 0.22 + sway, CAM.y + (rm ? 0 : Math.sin(time * 0.5) * 0.07), CAM.z);
		if (camMode === "home") {
			var k = Math.min(1, dt * 5);
			camera.position.x += (homePos.x - camera.position.x) * k;
			camera.position.y += (homePos.y - camera.position.y) * k;
			camera.position.z += (homePos.z - camera.position.z) * k;
			lookAt.copy(camera.position).add(F0);
		} else if (camMode === "flying" || camMode === "returning") {
			tweenT += dt;
			var e = easeIO(Math.min(1, tweenT / tweenDur));
			camera.position.lerpVectors(fromPos, toPos, e);
			lookAt.lerpVectors(fromLook, toLook, e);
			if (tweenT >= tweenDur) {
				if (camMode === "flying") {
					camMode = "focused";
					if (pendingArrive && opts.onArrive) { var ph = pendingArrive; pendingArrive = null; opts.onArrive(ph, ph._btn); }
				} else { camMode = "home"; }
			}
		} else {   /* focused: hold the framing with a whisper of drift */
			camera.position.copy(toPos);
			if (!rm) camera.position.x += Math.sin(time * 0.6) * 0.02;
			lookAt.copy(toLook);
		}
		camera.lookAt(lookAt);
	}

	/* ======================= input (mirrors the 2D dungeon) ======================= */
	var WATCH = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1 };
	var keys = {}, pointerDir = 0, heroX = 0, stepPhase = 0, dashT = 0, dashCd = 0, xp = 0;

	function anyKey() { for (var k in keys) if (keys[k]) return true; return false; }
	dungeon.addEventListener("keydown", function (e) {
		if (camMode !== "home") return;   /* the camera is flying/focused — walk + dash are suspended */
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
		if (camMode !== "home") { up = dn = lf = rt = false; dashing = false; }   /* suspend walk while flying/focused */
		if (dashing && !(up || dn || lf || rt)) up = true;   /* dash forward if nothing held */
		var moving = up || dn || lf || rt;
		var spd = BASE_SPD * (dashing ? DASH_MUL : 1) * dt;

		/* forward/back → scroll the world toward/past the camera */
		var dz = 0;
		if (up) dz = spd; else if (dn) dz = -spd;
		if (rt) heroX = Math.min(MAX_X, heroX + spd);
		if (lf) heroX = Math.max(-MAX_X, heroX - spd);

		/* turn the rogue to face the way it's heading (atan2 so diagonals work), lerped for a smooth pivot */
		if (moving) rogueFacing = Math.atan2((rt ? 1 : 0) - (lf ? 1 : 0), (dn ? 1 : 0) - (up ? 1 : 0));
		var dRot = Math.atan2(Math.sin(rogueFacing - rogue.rotation.y), Math.cos(rogueFacing - rogue.rotation.y));
		rogue.rotation.y += dRot * Math.min(1, dt * 10);

		/* walk cycle: swing the limbs from their joints; reduced-motion holds a still pose */
		if (moving && !reduceMotion) stepPhase = (stepPhase + dt * (dashing ? 22 : 12)) % (Math.PI * 2);
		var sw = (moving && !reduceMotion) ? Math.sin(stepPhase) * (dashing ? 0.95 : 0.6) : 0;
		armL.rotation.x = sw; armR.rotation.x = -sw;
		legL.rotation.x = -sw; legR.rotation.x = sw;
		torso.rotation.z = sw * 0.05;
		rogue.position.x += (heroX - rogue.position.x) * Math.min(1, dt * 14);
		rogue.position.y = (moving && !reduceMotion) ? Math.abs(Math.sin(stepPhase * 2)) * 0.05 : 0;
		/* camera: 2a floating-drift while "home"; 2b click-to-fly tween while flying/focused/returning */
		updateCamera(dt, time, heroX);
		aura.position.x = rogue.position.x;
		heroLight.position.x = rogue.position.x;   /* keep the hero light over the rogue as it strafes */
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
		var settling = Math.abs(heroX - rogue.position.x) > 0.001 || aura.material.opacity > 0.003;
		var camMoving = camMode === "flying" || camMode === "returning";
		var activeNow = moving || dashing || settling || dying || camMoving;

		var doRender = activeNow || dirty;
		if (activeNow || dirty) idleAccum = 0;
		else if (!reduceMotion) { idleAccum += dt; if (idleAccum >= IDLE_FRAME) { idleAccum = 0; doRender = true; } }

		if (doRender) {
			for (i = 0; i < arches.length; i++) wrap(arches[i], dz);
			for (i = 0; i < torches.length; i++) {
				var T = torches[i]; wrap(T, dz);
				var fl = reduceMotion ? 0.85 : 0.72 + Math.sin(time * 11 + T.userData.seed) * 0.12 + Math.sin(time * 23 + T.userData.seed) * 0.08;
				T.userData.light.intensity = 38 * fl;
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

			/* hotspots: shown only at rest in the home view (and while flying back) — never mid-walk
			   or mid-fly-out — and re-pinned over their projected landmarks each rendered frame */
			var showHs = (camMode === "home" || camMode === "returning") && !moving && onScreen;
			hsLayer.classList.toggle("world-hotspots--hidden", !showHs);
			if (showHs) placeHotspots();
			for (i = 0; i < hotspots.length; i++) {
				var pin = hotspots[i]._group.userData.portalInner;
				if (pin) pin.material.opacity = 0.42 + (reduceMotion ? 0 : Math.sin(time * 2) * 0.12);
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
		/* fly the guided camera to a named hotspot (e.g. from a MENU item); on arrival the
		   onArrive() bridge opens that section's panel. Returns the hotspot, or null. */
		focusHotspot: function (id) {
			for (var i = 0; i < hotspots.length; i++) if (hotspots[i].id === id) { startFly(hotspots[i]); return hotspots[i]; }
			return null;
		},
		/* glide back to the home framing (e.g. when a panel closes, or for the About item) */
		flyHome: flyHome,
		dispose: function () {
			disposed = true; stop();
			if (io) io.disconnect();
			if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
			document.removeEventListener("visibilitychange", sync);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("pointerup", onPointerUp);
			if (hsLayer && hsLayer.parentNode) hsLayer.parentNode.removeChild(hsLayer);
			renderer.dispose();
		}
	};
}
