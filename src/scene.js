import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COMPONENTS, DEFAULT_VIEW, GEOMETRY as G, tubeLayout, particlePosition, probePosition, pressureColor, hollowTubeMesh } from './geometry.js';
import { sleeveGeometry, boredBlockGeometry, supportBodyGeometry, probeBodyGeometry, collarSaddleGeometry, capGeometry, capSealGeometry, turnedGeometry } from './geometry-meshes.js';
import './scene.css';

const V = value => new THREE.Vector3(...value);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const clean = value => Object.is(value, -0) ? 0 : value;
const TAU = Math.PI * 2;
const MARKER_COUNT = 33;
const TRACER_OFFSETS = [[-.006, -.008], [0, 0], [.006, .008]];
const FIELD_COLORS = { pressure: '#88d9f4', displacement: '#ffc17a', particle: '#fff3d6' };
const STAGE_COLOR = '#202e36';

export class SoundScene {
  constructor(container, { onSelect = () => {}, onCameraChange = () => {} } = {}) {
    this.container = container; this.onSelect = onSelect; this.onCameraChange = onCameraChange;
    this.components = new Map(); this.geometries = new Set(); this.materials = new Set(); this.textures = new Set();
    this.view = structuredClone(DEFAULT_VIEW); this.updating = true; this.layout = tubeLayout(.6, 'open-open'); this.inspection = null;
    container.classList.add('sound-scene');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.03;
    this.renderer.transmissionResolutionScale = .85;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '속이 빈 관과 끝마개, 가상 탐침, 종방향 공기 운동의 3D 실험대');
    this.renderer.domElement.setAttribute('aria-description', '방향키로 시점 이동, Shift와 방향키로 회전');
    this.renderer.domElement.tabIndex = 0; container.append(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(STAGE_COLOR); this.scene.fog = new THREE.Fog(this.scene.background, 1.6, 7);
    this.camera = new THREE.PerspectiveCamera(35, 1, .002, 40);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = false;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.minDistance = .05; this.controls.maxDistance = 10; this.controls.maxPolarAngle = Math.PI;
    this.controls.zoomSpeed = .7; this.controls.panSpeed = .6;
    this.controlsChanged = () => { if (!this.updating && !this.disposed) { this.render(); this.onCameraChange(this.getProjectCameraState()); } };
    this.controls.addEventListener('change', this.controlsChanged);
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .04); room.dispose(); pmrem.dispose();
    this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .9;
    this.scene.add(new THREE.HemisphereLight('#dcefff', '#26323a', 1.55));
    const key = new THREE.DirectionalLight('#fff1d9', 3); key.position.set(-.6, 1.2, .72); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -.95, right: .95, top: .65, bottom: -.65, near: .1, far: 5 }); key.shadow.normalBias = .00035; this.scene.add(key);
    const rim = new THREE.DirectionalLight('#a4d6ff', 2.7); rim.position.set(.8, .6, -1.2); this.scene.add(rim);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.makeMaterials(); for (const part of COMPONENTS) this.part(part.id);
    this.buildStage(); this.buildBench(); this.buildTube(); this.buildSupports(); this.buildCap(); this.buildProbe(); this.buildReadout(); this.buildField(); this.buildOverlay();
    this.applyLayout(this.layout); this.identifyMeshes(); this.buildPointer();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.updating = false; this.resetCamera();
  }
  material(values) { const material = new THREE.MeshStandardMaterial({ metalness: .72, roughness: .33, ...values }); this.materials.add(material); return material; }
  makeMaterials() {
    const glass = new THREE.MeshPhysicalMaterial({ color: '#e1f1f3', metalness: 0, roughness: .035, transmission: 1, thickness: G.tube.outerRadiusM - G.tube.innerRadiusM, ior: 1.43, attenuationColor: '#c7e7ed', attenuationDistance: .036, clearcoat: .7, clearcoatRoughness: .06 });
    this.materials.add(glass);
    const toolMarks = this.canvasTexture(16, 256, THREE.NoColorSpace);
    for (let y = 0; y < 256; y++) {
      const value = Math.round(125 + 35 * Math.cos(y * 1.7) + 19 * Math.cos(y * .61));
      toolMarks.context.fillStyle = `rgb(${value} ${value} ${value})`;
      toolMarks.context.fillRect(0, y, 16, 1);
    }
    this.mat = {
      glass, steel: this.material({ color: '#bccbd2', metalness: .96, roughness: .22 }),
      machined: this.material({ color: '#c4cdd1', metalness: .85, roughness: .32, bumpMap: toolMarks.texture, bumpScale: .00012 }),
      dark: this.material({ color: '#28424e', metalness: .5, roughness: .49 }), base: this.material({ color: '#263c48', metalness: .35, roughness: .48 }),
      black: this.material({ color: '#1c272c', metalness: .26, roughness: .49 }), rubber: this.material({ color: '#161d21', metalness: .02, roughness: .92 }),
      seal: this.material({ color: '#874936', metalness: .05, roughness: .74 }), brass: this.material({ color: '#bd9961', metalness: .73, roughness: .35 }),
    };
  }
  part(id) { const node = new THREE.Group(); node.name = id; node.userData.partId = id; this.root.add(node); this.components.set(id, { ...COMPONENTS.find(part => part.id === id), node, anchor: new THREE.Vector3() }); return node; }
  node(id) { return this.components.get(id).node; }
  anchor(id, point) { this.components.get(id).anchor.set(...point); }
  mesh(geometry, material, parent, position, cloneMaterial = true) {
    this.geometries.add(geometry); const own = cloneMaterial ? material.clone() : material; this.materials.add(own);
    const mesh = new THREE.Mesh(geometry, own); mesh.castShadow = true; mesh.receiveShadow = true; if (position) mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  box(size, material, parent, position, radius = .001) { return this.mesh(new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(v => v / 3))), material, parent, position); }
  cylinder(radius, height, material, parent, position, axis = 'y', segments = 48) {
    const mesh = this.mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material, parent, position);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2; else if (axis === 'z') mesh.rotation.x = Math.PI / 2; return mesh;
  }
  ring(radius, wire, material, parent, position, axis = 'x') {
    const geometry = new THREE.TorusGeometry(radius, wire, 8, 64); if (axis === 'x') geometry.rotateY(Math.PI / 2); else if (axis === 'y') geometry.rotateX(Math.PI / 2);
    return this.mesh(geometry, material, parent, position);
  }
  grip(radius, length, material, parent, position, axis) {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 96);
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i);
      const groove = 1 - .045 * (1 + Math.cos(24 * Math.atan2(x, z)));
      vertices.setX(i, groove * x); vertices.setZ(i, groove * z);
    }
    geometry.computeVertexNormals();
    if (axis === 'x') geometry.rotateZ(-Math.PI / 2); else geometry.rotateX(Math.PI / 2);
    return this.mesh(geometry, material, parent, position);
  }
  wire(points, radius, material, parent) { return this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)), 48, radius, 8, false), material, parent); }
  bolt(parent, position) { this.cylinder(.0035, .003, this.mat.steel, parent, position, 'y', 6); this.cylinder(.0015, .0031, this.mat.black, parent, position, 'y', 6); }
  surface(data) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); geometry.computeBoundingBox(); return geometry; }
  collarGeometry(cutaway) {
    const data = hollowTubeMesh(.3, cutaway, 64);
    for (let i = 0; i < data.positions.length; i += 3) {
      data.positions[i] *= G.collar.widthM / .3;
      const r = Math.hypot(data.positions[i + 1], data.positions[i + 2]), next = Math.abs(r - G.tube.innerRadiusM) < 1e-8 ? G.collar.innerRadiusM : G.collar.outerRadiusM;
      data.positions[i + 1] *= next / r; data.positions[i + 2] *= next / r;
    }
    return this.surface(data);
  }
  canvasTexture(width, height, colorSpace = THREE.SRGBColorSpace) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = colorSpace; this.textures.add(texture);
    return { canvas, context: canvas.getContext('2d'), texture };
  }
  buildStage() {
    this.ground = new THREE.Group(); this.scene.add(this.ground);
    const floor = this.canvasTexture(512, 512);
    const falloff = floor.context.createRadialGradient(256, 256, 0, 256, 256, 35);
    falloff.addColorStop(0, '#283b45');
    falloff.addColorStop(.45, '#21333d');
    falloff.addColorStop(1, '#16262f');
    floor.context.fillStyle = falloff; floor.context.fillRect(0, 0, 512, 512);
    const plane = this.mesh(new THREE.PlaneGeometry(40, 30), this.material({ map: floor.texture, roughness: .94, metalness: .02 }), this.ground, [0, -.001, 0], false);
    plane.rotation.x = -Math.PI / 2;
    plane.castShadow = false;

    const shadow = this.canvasTexture(128, 128);
    const penumbra = shadow.context.createRadialGradient(64, 64, 0, 64, 64, 64);
    penumbra.addColorStop(0, 'rgba(10, 21, 27, .50)');
    penumbra.addColorStop(.58, 'rgba(10, 21, 27, .32)');
    penumbra.addColorStop(1, 'rgba(10, 21, 27, 0)');
    shadow.context.fillStyle = penumbra; shadow.context.fillRect(0, 0, 128, 128);
    const material = new THREE.MeshBasicMaterial({ map: shadow.texture, transparent: true, depthWrite: false, toneMapped: false });
    this.contactShadow = this.mesh(new THREE.PlaneGeometry(1, 1), material, this.ground, [0, -.0008, G.bench.center[2]], false);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.castShadow = this.contactShadow.receiveShadow = false;
  }
  buildBench() {
    const bench = this.node('bench-base');
    this.bench = this.box([1, G.bench.size[1], G.bench.size[2]], this.mat.base, bench, G.bench.center, .005);
    this.benchTrim = [-1, 1].map(side => this.box([.985, .0026, .002], this.mat.machined, bench, [0, .017, G.bench.center[2] + side * G.bench.size[2] / 2], .0006));
    this.feet = [];
    for (const side of [-1, 1]) for (const z of [-.13, .18]) {
      const group = new THREE.Group(); group.userData.side = side; bench.add(group);
      this.mesh(turnedGeometry([[-.004, 0], [-.004, .019], [-.0025, .023], [0, .023], [.004, .018], [.004, 0]], 48).rotateZ(Math.PI / 2), this.mat.rubber, group, [0, .0045, z]);
      this.cylinder(.017, .002, this.mat.dark, group, [0, .0085, z]);
      this.cylinder(.007, .0012, this.mat.black, group, [0, G.bench.topY, z]); this.bolt(group, [0, .035, z]); this.feet.push(group);
    }
    this.anchor('bench-base', [0, .035, .208]);
    this.rails = []; const rail = this.node('rail');
    for (const z of G.rails.z) { const mesh = this.cylinder(G.rails.radiusM, 1, this.mat.steel, rail, [0, G.rails.centerY, z], 'x', 64); this.rails.push(mesh); }
    this.guideRail = this.cylinder(G.guide.radiusM, 1, this.mat.steel, rail, [0, G.guide.centerY, G.guide.centerZ], 'x', 64);
    this.railBrackets = []; this.railBores = [];
    for (const side of [-1, 1]) {
      const group = new THREE.Group(); group.userData.side = side; rail.add(group);
      for (const spec of [...G.rails.z.map(z => ({ z, y: G.rails.centerY, radius: G.rails.radiusM })), { z: G.guide.centerZ, y: G.guide.centerY, radius: G.guide.radiusM }]) {
        const housing = this.mesh(boredBlockGeometry({ length: G.guide.bracketWidthM, bottom: G.bench.topY, top: spec.y + spec.radius + .006, halfWidth: spec.radius + .007, bores: [{ y: spec.y, radius: spec.radius }] }), this.mat.dark, group, [0, 0, spec.z]);
        this.railBores.push({ mesh: housing, radius: spec.radius, y: spec.y, z: spec.z });
        for (const x of [-.0105, .0105]) this.mesh(sleeveGeometry(spec.radius, spec.radius + .003, .001, .00015), this.mat.steel, group, [x, spec.y, spec.z]);
      }
      this.railBrackets.push(group);
    }
    this.anchor('rail', [0, G.rails.centerY, .075]);
    const scale = this.node('scale'); this.scaleBacking = this.box([1, .025, .004], this.mat.machined, scale, [0, .086, .098], .0005);
    const image = this.canvasTexture(1536, 96); Object.assign(this, { scaleContext: image.context, scaleTexture: image.texture });
    this.scaleFace = this.mesh(new THREE.PlaneGeometry(1, .023), new THREE.MeshBasicMaterial({ map: image.texture, toneMapped: false }), scale, [0, .086, .1001], false);
    this.scaleFace.castShadow = false;
    this.scaleMounts = [-1, 1].map(() => this.box([.011, .014, .015], this.mat.dark, scale, [0, .076, .091], .001));
    this.anchor('scale', [0, .086, .10]);
  }
  buildTube() {
    const node = this.node('tube-wall'); this.tubeFull = this.mesh(this.surface(hollowTubeMesh(1, false)), this.mat.glass, node);
    this.tubeCut = this.mesh(this.surface(hollowTubeMesh(1, true)), this.mat.glass, node); this.tubeFull.visible = false;
    for (const shell of [this.tubeFull, this.tubeCut]) { shell.castShadow = false; shell.receiveShadow = false; }
    this.tubeLips = [];
    for (const cutaway of [false, true]) {
      const data = hollowTubeMesh(1, cutaway), endFaces = { positions: [], normals: [] };
      for (let i = 0; i < data.normals.length; i += 9) {
        if (Math.abs(data.normals[i]) !== 1) continue;
        endFaces.positions.push(...data.positions.slice(i, i + 9)); endFaces.normals.push(...data.normals.slice(i, i + 9));
      }
      const lip = this.mesh(this.surface(endFaces), this.material({ color: '#a3c7cf', metalness: .48, roughness: .23, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), node);
      lip.castShadow = false; lip.userData.nonPickable = true; this.tubeLips.push(lip);
    }
    this.anchor('tube-wall', [0, G.tube.innerRadiusM * .5, -G.tube.innerRadiusM * .84]);
    const collars = this.node('tube-collars'); this.collars = [];
    for (let i = 0; i < 2; i++) {
      const group = new THREE.Group(); collars.add(group); const full = this.mesh(this.collarGeometry(false), this.mat.steel, group), cut = this.mesh(this.collarGeometry(true), this.mat.steel, group);
      for (const z of [-.028, .028]) { this.box([.030, .010, .011], this.mat.dark, group, [0, -.013, z]); this.bolt(group, [0, -.007, z]); }
      this.collars.push({ group, full, cut });
    }
  }
  buildSupports() {
    this.supportDetails = [];
    for (const id of ['left-support', 'right-support']) {
      const node = this.node(id), body = this.mesh(supportBodyGeometry(), this.mat.dark, node), bushes = [];
      for (const z of G.rails.z) bushes.push(this.mesh(sleeveGeometry(G.support.bushInnerRadiusM, G.support.bushOuterRadiusM, G.support.bushLengthM), this.mat.brass, node, [0, G.rails.centerY, z]));
      this.box([.037, G.support.saddleBottomY - G.support.topY, .037], this.mat.dark, node, [0, (G.support.saddleBottomY + G.support.topY) / 2, 0], .0015);
      const saddle = this.mesh(collarSaddleGeometry(), this.mat.black, node);
      this.box([.031, .004, .039], this.mat.machined, node, [0, .1, 0], .0007);
      this.box([.060, .002, .055], this.mat.rubber, node, [0, G.support.bottomY - .001, 0], .0004);
      for (const z of [-.064, .064]) this.bolt(node, [0, G.support.topY + .0015, z]);
      this.supportDetails.push({ id, body, bushes, saddle });
      this.anchor(id, [0, .100, .021]);
    }
  }
  buildCap() {
    const cap = this.node('end-cap'), disk = capGeometry();
    const face = this.canvasTexture(256, 256), { context } = face;
    context.fillStyle = '#e2e2e2'; context.fillRect(0, 0, 256, 256);
    for (let radius = 1; radius < 129; radius += .81) {
      const shade = Math.round(215 + 11 * Math.sin(radius * 3.37) + 9 * Math.cos(radius * .49));
      context.strokeStyle = `rgb(${shade} ${shade} ${shade})`;
      context.lineWidth = radius % 9 < .6 ? .54 : .27;
      context.beginPath(); context.arc(128, 128, radius, 0, TAU); context.stroke();
    }
    const uv = disk.getAttribute('uv'), position = disk.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, .5 + position.getY(i) / (2 * G.cap.radiusM), .5 + position.getZ(i) / (2 * G.cap.radiusM));
    this.capDisk = this.mesh(disk, this.material({ color: '#cbd3d9', metalness: .83, roughness: .36, map: face.texture, bumpMap: face.texture, bumpScale: .00016 }), cap, null, false);
    this.capSeal = this.mesh(capSealGeometry(), this.mat.seal, cap);
    this.cylinder(.011, .004, this.mat.steel, cap, [-.007, 0, 0], 'x');
    this.cylinder(.008, .014, this.mat.machined, cap, [-.0125, 0, 0], 'x');
    this.grip(.015, .010, this.mat.black, cap, [-.0245, 0, 0], 'x');
    this.cylinder(.012, .001, this.mat.machined, cap, [-.030, 0, 0], 'x');
    this.anchor('end-cap', [-.030, .004, .009]);
    const stand = this.node('cap-stand'), [width, height, depth] = G.capStand.size, [, y, z] = G.capStand.center;
    this.box([width, height - .002, depth], this.mat.dark, stand, [0, y - .001, z], .002);
    this.box([.055, .002, .041], this.mat.rubber, stand, [0, G.bench.topY + height - .001, z], .0004);
    for (const x of [-.038, .038]) this.bolt(stand, [x, .0445, z]);
    this.anchor('cap-stand', [0, .045, .18]);
  }
  buildProbe() {
    const carriage = this.node('probe-carriage');
    this.probeBody = this.mesh(probeBodyGeometry(), this.mat.dark, carriage, [0, 0, G.guide.centerZ]);
    this.probeBush = this.mesh(sleeveGeometry(G.guide.bushInnerRadiusM, G.guide.bushOuterRadiusM, G.guide.bushLengthM), this.mat.steel, carriage, [0, G.guide.centerY, G.guide.centerZ]);
    this.probePost = this.cylinder(.0037, 1, this.mat.steel, carriage, [0, .129, G.guide.centerZ]);
    this.probeArm = new THREE.Group(); carriage.add(this.probeArm);
    this.probeBoom = this.box([.010, .007, -G.guide.centerZ + .010], this.mat.dark, this.probeArm, [0, 0, G.guide.centerZ / 2], .001);
    this.cylinder(.0055, .008, this.mat.machined, this.probeArm, [0, -.007, 0]);
    this.cylinder(.0038, .002, this.mat.brass, this.probeArm, [0, -.012, 0]);
    this.cylinder(.004, .005, this.mat.steel, carriage, [0, .076, G.guide.centerZ - .015], 'z');
    this.grip(.009, .011, this.mat.brass, carriage, [0, .076, G.guide.centerZ - .021], 'z');
    this.cylinder(.004, .010, this.mat.rubber, carriage, [0, .063, G.guide.centerZ - .017], 'z');
    this.anchor('probe-carriage', [0, .062, G.guide.centerZ - .017]);
    const tip = this.node('probe-tip'), reticle = new THREE.MeshBasicMaterial({ color: '#fdd6a1', toneMapped: false });
    this.probeMarker = this.mesh(new THREE.OctahedronGeometry(.0032), reticle, tip, null, false);
    this.probeCircle = this.ring(.006, .00045, reticle, tip, [0, 0, 0], 'z');
    for (const item of [this.probeMarker, this.probeCircle]) { item.castShadow = false; item.receiveShadow = false; }
    this.probeCircle.userData.nonPickable = true;
    const leaderGeometry = new THREE.BufferGeometry().setFromPoints([V([0, .006, 0]), V([0, .028, 0])]);
    const leaderMaterial = new THREE.LineDashedMaterial({ color: '#fdd6a1', dashSize: .002, gapSize: .0016, toneMapped: false });
    this.geometries.add(leaderGeometry); this.materials.add(leaderMaterial);
    const leader = new THREE.Line(leaderGeometry, leaderMaterial).computeLineDistances(); leader.userData.nonPickable = true; tip.add(leader);
    this.anchor('probe-tip', [0, 0, 0]);
    this.anchor('probe-cable', [0, .045, -.133]);
  }
  buildReadout() {
    const readout = this.node('readout'); this.box(G.readout.size, this.mat.dark, readout, [0, 0, 0], .005);
    this.box([.160, .053, .002], this.mat.black, readout, [0, .006, G.readout.size[2] / 2 + .0005], .002);
    const image = this.canvasTexture(768, 256); this.displayContext = image.context; this.displayTexture = image.texture;
    this.displayFace = this.mesh(new THREE.PlaneGeometry(.149, .047), new THREE.MeshBasicMaterial({ map: image.texture, toneMapped: false }), readout, [0, .006, .056], false);
    this.displayFace.castShadow = false;
    for (const x of [-.080, .080]) { this.cylinder(.003, .002, this.mat.steel, readout, [x, -.024, .055], 'z', 6); }
    this.cylinder(.005, .007, this.mat.brass, readout, [-.078, .002, -.058], 'z');
    for (let i = 0; i < 6; i++) this.box([.001, .018, .002], this.mat.black, readout, [.0945, -.008, -.019 + i * .006], .0001);
    this.anchor('readout', [0, .012, .056]);
  }
  buildField() {
    const parent = this.node('particles');
    const particleMaterial = this.material({ color: FIELD_COLORS.particle, metalness: .12, roughness: .36, emissive: '#8f6331', emissiveIntensity: .38 });
    this.particleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(G.particleRadiusM, 10, 8), particleMaterial, MARKER_COUNT * TRACER_OFFSETS.length);
    const displacementMaterial = new THREE.MeshBasicMaterial({ color: FIELD_COLORS.displacement, toneMapped: false });
    this.displacementMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .0011, .0011), displacementMaterial, MARKER_COUNT);
    this.displacementMesh.frustumCulled = false; this.displacementMesh.userData.nonPickable = true;
    for (const item of [this.particleMesh, this.displacementMesh]) {
      this.geometries.add(item.geometry); this.materials.add(item.material); parent.add(item);
      item.instanceMatrix.setUsage(THREE.DynamicDrawUsage); item.count = 0;
    }
    const pressureMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    this.pressureRibbon = this.mesh(new THREE.BufferGeometry(), pressureMaterial, parent, null, false);
    this.pressureRibbon.userData.nonPickable = true; this.pressureRibbon.castShadow = false; this.pressureRibbon.receiveShadow = false;
    const pressureRing = new THREE.TorusGeometry(.019, .00085, 8, 64).rotateY(Math.PI / 2);
    const arcs = Array.from({ length: 8 }, (_, i) => new THREE.TorusGeometry(.0145, .0008, 8, 6, TAU / 14).rotateZ(i * TAU / 8).rotateY(Math.PI / 2));
    const displacementRing = mergeGeometries(arcs);
    for (const arc of arcs) arc.dispose();
    this.nodeRings = [];
    for (const [kind, geometry] of [['pressure', pressureRing], ['displacement', displacementRing]]) {
      const material = new THREE.MeshBasicMaterial({ color: FIELD_COLORS[kind], toneMapped: false });
      for (let i = 0; i < 4; i++) {
        const mesh = this.mesh(geometry, material, parent, null, false);
        mesh.userData.nonPickable = true; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
        this.nodeRings.push({ kind, mesh });
      }
    }
    this.anchor('particles', [0, .008, .006]);
  }
  applyLayout(layout) {
    this.layout = layout; this.bench.scale.x = layout.benchLengthM;
    this.contactShadow.scale.set(layout.benchLengthM + .24, G.bench.size[2] + .24, 1);
    for (const trim of this.benchTrim) trim.scale.x = layout.benchLengthM;
    for (const foot of this.feet) foot.position.x = foot.userData.side * (layout.benchLengthM / 2 - .038);
    for (const rail of [...this.rails, this.guideRail]) rail.scale.y = layout.railLengthM;
    for (const bracket of this.railBrackets) bracket.position.x = bracket.userData.side * (layout.railLengthM / 2 - .012);
    this.node('tube-wall').position.set(...layout.center); this.tubeFull.scale.x = this.tubeCut.scale.x = layout.lengthM;
    for (const lip of this.tubeLips) lip.scale.x = layout.lengthM;
    this.node('left-support').position.x = layout.supportXs[0]; this.node('right-support').position.x = layout.supportXs[1];
    for (const [i, collar] of this.collars.entries()) collar.group.position.set(layout.supportXs[i], layout.collarY, 0);
    this.anchor('tube-collars', [layout.supportXs[0], layout.collarY + .024, -.010]);
    this.node('end-cap').position.set(...layout.capCenter); this.node('cap-stand').position.x = layout.storedCapCenter[0]; this.node('readout').position.set(...layout.readoutCenter);
    this.scaleBacking.scale.x = this.scaleFace.scale.x = layout.lengthM;
    for (const [i, mount] of this.scaleMounts.entries()) mount.position.x = layout.supportXs[i];
    this.node('particles').position.set(...layout.center);
    const c = this.scaleContext, lengthMM = layout.lengthM * 1000;
    c.fillStyle = '#252f34'; c.fillRect(0, 0, 1536, 96); c.strokeStyle = '#baccce'; c.fillStyle = '#e5eeee'; c.lineWidth = 3; c.font = '31px monospace'; c.textBaseline = 'top';
    for (let mm = 0; mm <= lengthMM + 1e-7; mm += 10) {
      const x = 3 + mm / lengthMM * 1530, major = mm % 100 === 0;
      c.beginPath(); c.moveTo(x, 5); c.lineTo(x, major ? 43 : mm % 50 === 0 ? 33 : 23); c.stroke();
      if (major && lengthMM - mm > 60) { c.textAlign = mm === 0 ? 'left' : 'center'; c.fillText((mm / 1000).toFixed(1), mm === 0 ? 10 : x, 52); }
    }
    c.textAlign = 'right'; c.fillText(`${Number(layout.lengthM.toFixed(3))} m`, 1526, 52); this.scaleTexture.needsUpdate = true;
  }
  updateProbe(snapshot) {
    const [x, y, z] = probePosition(snapshot.config.lengthM, snapshot.probeRatio, this.view.exploded);
    this.node('probe-carriage').position.x = x; this.node('probe-tip').position.set(x, y, z);
    const top = y + .042, bottom = G.guide.bodyTopY; this.probePost.position.y = (top + bottom) / 2; this.probePost.scale.y = top - bottom; this.probeArm.position.y = top;
    const key = `${x}|${this.layout.readoutCenter[0]}`;
    if (key !== this.wireKey) {
      if (this.probeWire) { this.probeWire.geometry.dispose(); this.geometries.delete(this.probeWire.geometry); this.probeWire.material.dispose(); this.materials.delete(this.probeWire.material); this.probeWire.removeFromParent(); }
      const end = this.layout.readoutCenter, points = [[x, .063, G.guide.centerZ - .016], [x, .041, -.166], [x * .6 + end[0] * .4, .037, -.167], [end[0] - .10, .036, -.115], [end[0] - .107, .039, .035], [end[0] - .078, end[1] + .002, end[2] - .058]];
      this.probeWire = this.wire(points, .0014, this.mat.black, this.node('probe-cable')); this.probeWire.userData.partId = 'probe-cable'; this.anchor('probe-cable', points[2]); this.wireKey = key;
    }
  }
  updateField(snapshot) {
    const { samples, config: { lengthM } } = snapshot, count = Math.min(MARKER_COUNT, samples.length);
    const matrix = new THREE.Matrix4(), color = new THREE.Color(); this.particleEvidence = [];
    let index = 0, strokeCount = 0;
    for (let i = 0; i < count; i++) {
      const sampleIndex = Math.round(i * (samples.length - 1) / (count - 1)), sample = samples[sampleIndex];
      const [x] = particlePosition(lengthM, sample.positionRatio, sample.displacementRelative, this.view.exploded);
      for (const [dy, dz] of TRACER_OFFSETS) {
        matrix.makeTranslation(x, dy, dz); this.particleMesh.setMatrixAt(index, matrix);
        this.particleEvidence.push({ instance: index, sampleIndex, positionRatio: sample.positionRatio, equilibriumXM: sample.xM, pressureRelative: sample.pressureRelative, displacementRelative: sample.displacementRelative, velocityRelative: sample.velocityRelative }); index++;
      }
      const rest = (sample.positionRatio - .5) * lengthM, travel = Math.abs(x - rest);
      if (i % 2 === 0 && travel > 0) {
        matrix.makeScale(travel, 1, 1); matrix.setPosition((x + rest) / 2, 0, 0);
        this.displacementMesh.setMatrixAt(strokeCount++, matrix);
      }
    }
    this.particleMesh.count = index; this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.computeBoundingBox(); this.particleMesh.computeBoundingSphere(); this.particleMesh.visible = this.view.particles;
    this.displacementMesh.count = strokeCount; this.displacementMesh.instanceMatrix.needsUpdate = true; this.displacementMesh.visible = this.view.particles;
    const positions = [], colors = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1];
      // The strip stays the same size as its pressure color changes with phase.
      for (const [sample, far] of [[a, true], [b, true], [b, false], [a, true], [b, false], [a, false]]) {
        positions.push(sample.xM - lengthM / 2, far ? -.007 : -.017, far ? -.011 : .008); color.set(pressureColor(sample.pressureRelative)); colors.push(color.r, color.g, color.b);
      }
    }
    const geometry = this.pressureRibbon.geometry;
    if (geometry.getAttribute('position')?.count !== positions.length / 3) { geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); }
    else { geometry.getAttribute('position').array.set(positions); geometry.getAttribute('color').array.set(colors); geometry.getAttribute('position').needsUpdate = true; geometry.getAttribute('color').needsUpdate = true; }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); this.pressureRibbon.visible = this.view.pressure;
    for (const kind of ['pressure', 'displacement']) {
      const ratios = snapshot.nodes[kind === 'pressure' ? 'pressureRatios' : 'displacementRatios'];
      for (const [i, item] of this.nodeRings.filter(item => item.kind === kind).entries()) { item.mesh.visible = i < ratios.length && (kind === 'pressure' ? this.view.pressure : this.view.particles); if (i < ratios.length) item.mesh.position.x = (ratios[i] - .5) * lengthM; }
    }
  }
  drawDisplay(snapshot) {
    const text = `${snapshot.frequencyHz.toFixed(1)}|${snapshot.probeRatio.toFixed(3)}|${snapshot.probe.pressureRelative.toFixed(2)}`; if (text === this.displayKey) return; this.displayKey = text;
    const c = this.displayContext; c.fillStyle = '#071b20'; c.fillRect(0, 0, 768, 256); c.textAlign = 'left'; c.fillStyle = '#e5cc9f'; c.font = '600 72px monospace'; c.fillText(`${snapshot.frequencyHz.toFixed(1)} Hz`, 25, 91);
    c.fillStyle = '#8fcfdb'; c.font = '35px monospace'; c.fillText(`x/L ${(snapshot.probeRatio * 100).toFixed(1)}%`, 27, 158); c.fillStyle = '#d5e3e4'; c.fillText(`REL p ${snapshot.probe.pressureRelative >= 0 ? '+' : ''}${snapshot.probe.pressureRelative.toFixed(2)}`, 27, 221); this.displayTexture.needsUpdate = true;
  }
  update(snapshot, view) {
    if (this.disposed) return; this.updating = true; this.snapshot = snapshot; this.view = { ...DEFAULT_VIEW, ...view };
    const layoutKey = `${snapshot.config.lengthM}|${snapshot.config.boundary}|${this.view.exploded}`;
    if (layoutKey !== this.layoutKey) { this.applyLayout(tubeLayout(snapshot.config.lengthM, snapshot.config.boundary, this.view.exploded)); this.layoutKey = layoutKey; }
    this.updateProbe(snapshot); this.updateField(snapshot); this.drawDisplay(snapshot); this.highlight();
    this.applyInspectionVisibility(); this.trackInspection();
    this.noteText.textContent = this.view.exploded ? '분해 간격은 관찰용' : this.view.cutaway ? '관찰용 절개' : '관벽 투과는 관찰용';
    this.pressureLegend.hidden = !this.view.pressure; this.displacementLegend.hidden = !this.view.particles; this.tracerLegend.hidden = !this.view.particles;
    this.readout.textContent = `가상 탐침 ${(snapshot.probeRatio * 100).toFixed(1)}% · 상대 압력 ${snapshot.probe.pressureRelative >= 0 ? '+' : ''}${snapshot.probe.pressureRelative.toFixed(2)}`;
    this.updating = false; this.render();
  }
  inspectionDefinition(id) {
    const definitions = {
      rail: { kind: 'rail', parts: ['rail'], direction: [.9, .5, 1], note: '두 하중 레일과 뒤쪽 독립 탐침 가이드 · 받침은 관통 보어로 축을 감쌉니다.' },
      'tube-wall': { kind: 'tube', parts: ['tube-wall'], direction: [.34, .44, 1], note: '관 벽 두께 3 mm · 관벽 투과와 앞쪽 120° 절개는 관찰용입니다. 음향 계산은 균일한 이상관을 기준으로 합니다.' },
      'tube-collars': { kind: 'collar', parts: ['tube-collars', 'left-support'], direction: [.85, .5, 1], note: '왼쪽 고정 링과 오목 안장의 맞닿음 · 링 절개와 분해 간격은 구조 관찰용입니다.' },
      'left-support': { kind: 'support', parts: ['left-support'], direction: [1, .5, .85], note: '관통 보어와 중공 슬리브 · 레일과 슬리브의 대표 반지름 여유 0.2 mm, 실제 공차 해석은 아닙니다.' },
      'right-support': { kind: 'support', parts: ['right-support'], direction: [1, .5, .85], note: '관통 보어와 중공 슬리브 · 레일과 슬리브의 대표 반지름 여유 0.2 mm, 실제 공차 해석은 아닙니다.' },
      'end-cap': { kind: 'cap', parts: ['end-cap'], direction: [.68, .32, 1], note: '씰 홈 관찰을 위해 밀봉 링만 축 방향 3 mm 인출 · 조립 시 링은 닫힘 평면과 같은 면에 놓입니다.' },
      'probe-carriage': { kind: 'probe', parts: ['probe-carriage'], direction: [1, .38, -.72], note: '뒤쪽 독립 가이드용 중공 슬리브 · 가상 탐침 X는 그대로이며 마이크 부하를 계산하지 않습니다.' },
    };
    return definitions[id] ?? null;
  }
  applyInspectionVisibility() {
    const definition = this.inspection && this.inspectionDefinition(this.inspection.id), allowed = definition && new Set(definition.parts);
    for (const [id, part] of this.components) part.node.visible = !allowed || allowed.has(id);
    this.ground.visible = !this.inspection;
    const cut = this.view.cutaway || definition?.kind === 'tube' || definition?.kind === 'collar'; this.tubeCut.visible = cut; this.tubeFull.visible = !cut;
    this.tubeLips[0].visible = !cut; this.tubeLips[1].visible = cut;
    for (const [i, collar] of this.collars.entries()) { collar.group.visible = definition?.kind !== 'collar' || i === 0; collar.cut.visible = cut; collar.full.visible = !cut; }
    this.capSeal.position.x = definition?.kind === 'cap' ? .003 : 0;
    this.note.hidden = Boolean(this.inspection); this.readout.hidden = Boolean(this.inspection);
  }
  currentInspectionCenter() {
    if (!this.inspection) return null;
    const id = this.inspection.id;
    if (id === 'rail') return V([0, G.rails.centerY, G.guide.centerZ / 3]);
    if (id === 'tube-collars') return V([this.layout.supportXs[0], this.layout.collarY, 0]);
    if (id === 'probe-carriage') return V([this.node(id).position.x, (G.guide.bodyTopY + this.probeArm.position.y) / 2, G.guide.centerZ / 2]);
    return this.node(id).position.clone();
  }
  trackInspection() {
    if (!this.inspection) return;
    const center = this.currentInspectionCenter();
    if (this.inspection.center) { const delta = center.clone().sub(this.inspection.center); this.camera.position.add(delta); this.controls.target.add(delta); this.camera.lookAt(this.controls.target); }
    this.inspection.center = center;
  }
  beginInspection(id) {
    const definition = this.inspectionDefinition(id); if (!definition || this.disposed) return false;
    const original = this.inspection?.original ?? { camera: this.getCameraState(), focusContext: this.focusContext ? [...this.focusContext] : null };
    this.inspection = { id, original, center: null }; this.focusContext = [id]; this.applyInspectionVisibility();
    this.fit(definition.parts, definition.direction, .78); this.inspection.center = this.currentInspectionCenter(); this.render(); return true;
  }
  endInspection() {
    if (!this.inspection) return false;
    const original = this.inspection.original; this.inspection = null; this.applyInspectionVisibility();
    this.setCameraState(original.camera); this.focusContext = original.focusContext; this.render(); return true;
  }
  getInspection() { if (!this.inspection) return null; const { kind, note } = this.inspectionDefinition(this.inspection.id); return { id: this.inspection.id, kind, note }; }
  getProjectCameraState() { return this.inspection ? structuredClone(this.inspection.original.camera) : this.getCameraState(); }
  identifyMeshes() { this.root.traverse(object => { let ancestor = object; while (ancestor && !ancestor.userData.partId) ancestor = ancestor.parent; if (ancestor) object.userData.partId = ancestor.userData.partId; }); }
  highlight() { this.root.traverse(object => { if (object.isMesh && !object.isInstancedMesh && object.material?.emissive) { const selected = object.userData.partId === this.view.selectedPart; object.material.emissive.set(selected ? '#304e5a' : '#000000'); object.material.emissiveIntensity = selected ? .19 : 0; } }); }
  select(id) { if (!this.components.has(id)) return; this.view.selectedPart = id; this.highlight(); this.render(); this.onSelect(id); }
  actuallyVisible(object) { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; }
  buildPointer() {
    this.pointer = new THREE.Vector2(); this.raycaster = new THREE.Raycaster();
    this.pointerDown = event => { if (event.button === 0) this.down = [event.clientX, event.clientY]; };
    this.pointerUp = event => {
      if (event.button !== 0 || !this.down || Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) > 4) { this.down = null; return; }
      this.down = null; const rect = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.root, true).find(item => item.object.userData.partId && !item.object.userData.nonPickable && this.actuallyVisible(item.object)); if (hit) this.select(hit.object.userData.partId);
    };
    this.pointerCancel = () => { this.down = null; };
    for (const [type, listener] of [['pointerdown', this.pointerDown], ['pointerup', this.pointerUp], ['pointercancel', this.pointerCancel]]) this.renderer.domElement.addEventListener(type, listener);
  }
  buildOverlay() {
    this.overlay = document.createElement('div'); this.overlay.className = 'sound-overlay'; this.container.append(this.overlay);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.classList.add('sound-label-lines'); this.overlay.append(this.svg); this.labels = new Map();
    for (const part of COMPONENTS) {
      const button = document.createElement('button'); button.className = 'sound-part-label'; button.dataset.partId = part.id; button.type = 'button'; button.textContent = part.name; button.hidden = true; button.addEventListener('click', () => this.select(part.id)); this.overlay.append(button);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'g'); this.svg.append(line);
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path'); halo.classList.add('sound-leader-halo'); line.append(halo);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.classList.add('sound-leader'); line.append(path);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '3'); line.append(dot); this.labels.set(part.id, { button, line, halo, path, dot });
    }
    const footer = document.createElement('div'); footer.className = 'sound-scene-footer'; this.container.after(footer); this.footer = footer;
    this.note = document.createElement('div'); this.note.className = 'sound-scene-note'; footer.append(this.note);
    this.noteText = document.createElement('span'); this.note.append(this.noteText);
    const legend = (name, text) => {
      const item = document.createElement('span'); item.className = `sound-legend-${name}`; item.textContent = text; this.note.append(item); return item;
    };
    this.pressureLegend = legend('pressure', '압력 마디');
    this.displacementLegend = legend('displacement', '변위 마디');
    this.tracerLegend = legend('tracer', '축 방향 변위 · 확대 표시');
    this.readout = document.createElement('div'); this.readout.className = 'sound-probe-readout'; footer.append(this.readout);
  }
  layoutLabels() {
    if (!this.width) return; this.root.updateMatrixWorld(true);
    for (const [id, label] of this.labels) {
      const selected = id === this.view.selectedPart;
      label.button.classList.toggle('is-selected', selected);
      label.button.setAttribute('aria-pressed', String(selected));
    }
    const compact = this.width <= 520;
    const ids = this.view.labels && this.height >= 180
      ? [...new Set([this.view.selectedPart, ...(this.focusContext || ['tube-wall', 'end-cap', 'probe-tip', 'readout'])])].slice(0, compact ? 1 : 5)
      : [];
    const points = [], shown = new Set();
    for (const id of ids) {
      if (id === 'particles' && !this.view.particles && !this.view.pressure) continue;
      const part = this.components.get(id); if (!part || !this.actuallyVisible(part.node)) continue; const p = part.node.localToWorld(part.anchor.clone()).project(this.camera);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < -1 || p.z > 1) continue; points.push({ id, x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2 });
    }
    const width = compact ? Math.min(112, this.width * .38) : this.width < 620 ? 130 : 158;
    const height = compact ? 28 : 32, placed = [];
    const top = compact ? 10 : 36;
    const bottom = Math.max(top, this.height - (compact ? 38 : this.width < 620 ? 122 : 88));
    for (const p of points) {
      const candidates = [];
      if (this.inspection) {
        const box = { x: 12, y: 12, w: width, h: height }, end = { x: clamp(p.x, 18, 12 + width - 6), y: clamp(p.y, 12, 12 + height) };
        candidates.push({ box, end, score: -1e9 });
      }
      for (const dy of [-60, -99, 39, 78, -138, 117]) for (const dx of [0, -width * .7, width * .7, -width, width]) {
        const box = { x: clamp(p.x - width / 2 + dx, 9, this.width - width - 9), y: clamp(p.y + dy, top, bottom), w: width, h: height };
        if (placed.some(b => box.x < b.x + b.w + 7 && box.x + box.w + 7 > b.x && box.y < b.y + b.h + 7 && box.y + box.h + 7 > b.y)) continue;
        const end = { x: clamp(p.x, box.x + 6, box.x + width - 6), y: clamp(p.y, box.y, box.y + height) };
        const covered = points.filter(q => q.x > box.x - 7 && q.x < box.x + width + 7 && q.y > box.y - 7 && q.y < box.y + height + 7).length;
        candidates.push({ box, end, score: Math.hypot(end.x - p.x, end.y - p.y) + Math.abs(dx) * .16 + (dy > 0 ? 12 : 0) + covered * 10000 });
      }
      candidates.sort((a, b) => a.score - b.score); if (!candidates.length) continue; const { box, end } = candidates[0], label = this.labels.get(p.id); placed.push(box);
      let title = this.components.get(p.id).name; if (p.id === 'end-cap') title += this.layout.capClosed ? ' · 닫힘' : ' · 보관';
      if (label.button.textContent !== title) label.button.textContent = label.button.title = title;
      Object.assign(label.button.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${width}px` });
      const d = `M ${p.x} ${p.y} L ${end.x} ${end.y}`; label.halo.setAttribute('d', d); label.path.setAttribute('d', d); label.dot.setAttribute('cx', p.x); label.dot.setAttribute('cy', p.y);
      shown.add(p.id);
    }
    for (const [id, label] of this.labels) { label.button.hidden = !shown.has(id); label.line.style.display = shown.has(id) ? '' : 'none'; }
  }
  visiblePoints(node) {
    this.root.updateMatrixWorld(true); const result = [];
    node.traverseVisible(object => {
      if (!object.isMesh || object.userData.nonPickable) return;
      if (object.isInstancedMesh) object.computeBoundingBox(); else object.geometry.computeBoundingBox();
      const b = object.isInstancedMesh ? object.boundingBox : object.geometry.boundingBox; if (!b || b.isEmpty()) return;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) result.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld));
    }); return result;
  }
  fit(ids, direction, margin = .73) {
    const points = ids.flatMap(id => this.visiblePoints(this.node(id))); if (!points.length) return false;
    const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()), dir = V(direction).normalize(), right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan(this.camera.fov * Math.PI / 360), tanH = tanV * this.camera.aspect; let distance = .05;
    for (let iteration = 0; iteration < 4; iteration++) {
      const relative = points.map(point => point.clone().sub(target)); distance = .05;
      for (const point of relative) distance = Math.max(distance, point.dot(dir) + Math.abs(point.dot(right)) / (tanH * .80), point.dot(dir) + Math.abs(point.dot(up)) / (tanV * margin));
      if (iteration === 3) break;
      let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
      for (const point of relative) { const depth = Math.max(.001, distance - point.dot(dir)), x = point.dot(right) / depth, y = point.dot(up) / depth; l = Math.min(l, x); r = Math.max(r, x); b = Math.min(b, y); t = Math.max(t, y); }
      target.addScaledVector(right, (l + r) * distance / 2).addScaledVector(up, (b + t) * distance / 2);
    }
    this.updating = true; this.camera.zoom = 1; this.camera.updateProjectionMatrix(); this.controls.target.copy(target); this.camera.position.copy(target.clone().addScaledVector(dir, Math.min(10, distance))); this.controls.update(); this.updating = false; this.render(); this.onCameraChange(this.getProjectCameraState()); return true;
  }
  resetCamera(preset = 'iso') {
    if (this.inspection) this.endInspection();
    this.focusContext = null; if (preset === 'cap') return this.focusPart('end-cap'); if (!['iso', 'side'].includes(preset)) return false;
    return this.fit(COMPONENTS.filter(part => part.id !== 'probe-cable').map(part => part.id), preset === 'side' ? [.04, .13, 1] : [.42, .53, 1], .77);
  }
  focusPart(id) {
    if (this.inspection) this.endInspection();
    if (!this.components.has(id)) return false; let ids = [id], direction = [.25, .42, 1];
    if (id === 'end-cap') { ids = this.layout.capClosed ? ['end-cap', 'left-support'] : ['end-cap', 'cap-stand']; direction = [-1, .35, .65]; }
    else if (['probe-carriage', 'probe-tip'].includes(id)) { ids = ['probe-carriage', 'probe-tip']; direction = [.35, .6, 1]; }
    else if (['tube-wall', 'tube-collars', 'particles', 'scale'].includes(id)) { ids = ['tube-wall', 'tube-collars', 'particles', 'scale']; direction = [.12, .3, 1]; }
    else if (id === 'readout') direction = [.1, .13, 1];
    else if (id === 'probe-cable') ids = ['probe-cable', 'readout', 'probe-carriage'];
    else if (['bench-base', 'rail'].includes(id)) return this.resetCamera();
    this.focusContext = [...new Set([id, ...ids])].slice(0, 5); return this.fit(ids, direction, .65);
  }
  getCameraState() { return { position: this.camera.position.toArray().map(clean), target: this.controls.target.toArray().map(clean), zoom: clean(this.camera.zoom) }; }
  setCameraState(value) {
    if (!value || ![value.position, value.target].every(point => Array.isArray(point) && point.length === 3 && point.every(number => Number.isFinite(number) && Math.abs(number) <= 100))) return false;
    const position = V(value.position), target = V(value.target), distance = position.distanceTo(target), zoom = value.zoom ?? 1;
    if (distance < .05 - 1e-10 || distance > 10 + 1e-10 || !Number.isFinite(zoom) || zoom < .25 || zoom > 4) return false;
    this.updating = true; this.focusContext = null; this.camera.position.copy(position); this.controls.target.copy(target); this.camera.zoom = zoom; this.camera.updateProjectionMatrix(); this.controls.update(); this.camera.position.copy(position); this.controls.target.copy(target); this.camera.lookAt(target); this.updating = false; this.render(); return true;
  }
  getComponents() { return COMPONENTS.map(part => ({ ...part })); }
  getDebug() {
    this.root.updateMatrixWorld(true); const world = (object, position = [0, 0, 0]) => object.localToWorld(V(position)).toArray().map(clean);
    const tube = this.view.cutaway ? this.tubeCut : this.tubeFull, data = tube.geometry.getAttribute('position'); let xmin = Infinity, xmax = -Infinity, rmin = Infinity, rmax = -Infinity;
    for (let i = 0; i < data.count; i++) { const x = data.getX(i) * tube.scale.x, r = Math.hypot(data.getY(i), data.getZ(i)); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    const particlePositions = (this.particleEvidence || []).map(item => { this.particleMesh.getMatrixAt(item.instance, matrix); point.setFromMatrixPosition(matrix).applyMatrix4(this.particleMesh.matrixWorld); return { ...item, world: point.toArray().map(clean) }; });
    const probe = world(this.probeMarker), capPosition = this.capDisk.geometry.getAttribute('position'); let localFaceX = -Infinity;
    for (let i = 0; i < capPosition.count; i++) localFaceX = Math.max(localFaceX, capPosition.getX(i));
    const capFace = world(this.capDisk, [localFaceX, 0, 0]);
    const ringPositions = this.nodeRings.filter(item => this.actuallyVisible(item.mesh)).map(item => ({ kind: item.kind, world: world(item.mesh) }));
    const ribbonPosition = this.pressureRibbon.geometry.getAttribute('position'), ribbonColor = this.pressureRibbon.geometry.getAttribute('color'), actualColors = [], pressureSamples = [];
    if (ribbonPosition && ribbonColor) for (let i = 0; i < (this.snapshot?.samples.length ?? 0); i++) {
      const vertex = i < this.snapshot.samples.length - 1 ? i * 6 : (i - 1) * 6 + 1;
      const color = new THREE.Color().fromBufferAttribute(ribbonColor, vertex), position = world(this.pressureRibbon, [ribbonPosition.getX(vertex), ribbonPosition.getY(vertex), ribbonPosition.getZ(vertex)]);
      actualColors.push('#' + color.getHexString()); pressureSamples.push({ world: position, color: actualColors.at(-1) });
    }
    return { ready: !!this.snapshot, componentCount: this.components.size, lengthM: xmax - xmin, innerRadiusM: rmin, outerRadiusM: rmax,
      tube: { lengthM: xmax - xmin, innerRadiusM: rmin, outerRadiusM: rmax, left: world(tube, [-.5, 0, 0]), right: world(tube, [.5, 0, 0]), center: world(this.node('tube-wall')) },
      capClosed: this.layout.capClosed, capFaceWorld: capFace, probeWorld: probe, probePositionM: this.snapshot ? probe[0] + this.snapshot.config.lengthM / 2 : null,
      particlePositions, nodeMarkers: ringPositions, cutaway: this.tubeCut.visible, exploded: this.view.exploded, tubeOffsetY: this.node('tube-wall').position.y - G.tube.centerY,
      pressureVisible: this.pressureRibbon.visible, particlesVisible: this.particleMesh.visible,
      pressureColors: actualColors, pressureSamples,
      labels: [...this.labels].filter(([, label]) => !label.button.hidden).map(([id, label]) => ({ id, left: parseFloat(label.button.style.left), top: parseFloat(label.button.style.top), width: label.button.offsetWidth, height: label.button.offsetHeight, anchor: [Number(label.dot.getAttribute('cx')), Number(label.dot.getAttribute('cy'))] })),
      camera: this.getCameraState(), projectCamera: this.getProjectCameraState(), inspection: this.getInspection(), mechanical: this.mechanicalDebug(),
      visibleParts: [...this.components].filter(([, part]) => this.actuallyVisible(part.node)).map(([id]) => id), groundVisible: this.ground.visible,
      resources: { geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures },
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, renderFrame: this.renderer.info.render.frame };
  }
  mechanicalDebug() {
    this.root.updateMatrixWorld(true);
    const point = (mesh, p = [0, 0, 0]) => mesh.localToWorld(V(p)).toArray();
    const radii = mesh => { const p = mesh.geometry.getAttribute('position'); let min = Infinity, max = -Infinity; for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getY(i), p.getZ(i)); min = Math.min(min, r); max = Math.max(max, r); } return { min, max }; };
    const bounds = mesh => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld); };
    const bush = radii(this.probeBush), body = bounds(this.probeBody), guide = point(this.guideRail), seal = bounds(this.capSeal), cap = bounds(this.capDisk);
    const supports = this.supportDetails.map(detail => ({ id: detail.id, bodyMin: bounds(detail.body).min.toArray(), bodyMax: bounds(detail.body).max.toArray(), bushes: detail.bushes.map((mesh, i) => ({ center: point(mesh), innerRadiusM: radii(mesh).min, outerRadiusM: radii(mesh).max, railRadiusM: G.rails.radiusM, radialClearanceM: radii(mesh).min - G.rails.radiusM, boreAxisOffsetM: Math.hypot(point(mesh)[1] - point(this.rails[i])[1], point(mesh)[2] - point(this.rails[i])[2]) })) }));
    const x = this.node('probe-carriage').position.x, bracketInnerX = this.layout.railLengthM / 2 - .012 - G.guide.bracketWidthM / 2;
    const seatHit = new THREE.Raycaster(V([this.layout.supportXs[0], G.tube.centerY, 0]), V([0, -1, 0])).intersectObject(this.supportDetails[0].saddle)[0];
    const collarBottom = bounds(this.collars[0].full).min.y - (this.layout.collarY - G.tube.centerY), assembledSealFace = seal.max.x - this.capSeal.position.x;
    return {
      guide: { center: guide, radiusM: G.guide.radiusM, carriageCenter: point(this.probeBush), innerRadiusM: bush.min, outerRadiusM: bush.max, radialClearanceM: bush.min - G.guide.radiusM,
        boreAxisOffsetM: Math.hypot(point(this.probeBush)[1] - guide[1], point(this.probeBush)[2] - guide[2]),
        supportSideClearanceM: Math.min(...supports.map(s => s.bodyMin[2] - body.max.z)), endStopClearanceM: bracketInnerX - Math.abs(x) - G.guide.bushLengthM / 2,
        boomTubeClearanceM: bounds(this.probeBoom).min.y - (this.layout.center[1] + G.tube.outerRadiusM) },
      supports,
      saddle: { radiusM: G.collar.outerRadiusM, centerY: G.tube.centerY, assembledContactGapM: seatHit ? collarBottom - seatHit.point.y : null, collarDisplayLiftM: this.layout.collarY - G.tube.centerY },
      cap: { closurePlaneX: point(this.capDisk, [G.cap.thicknessM / 2, 0, 0])[0], sealFaceX: seal.max.x, sealDisplayWithdrawalM: this.capSeal.position.x,
        sealInnerRadiusM: radii(this.capSeal).min, sealOuterRadiusM: radii(this.capSeal).max, grooveInnerRadiusM: G.cap.grooveInnerRadiusM, grooveOuterRadiusM: G.cap.grooveOuterRadiusM,
        grooveDepthM: G.cap.grooveDepthM, assembledSealFaceX: assembledSealFace, assembledSealGapM: cap.max.x - assembledSealFace, representativeCompressedSeal: true },
    };
  }
  resize() { if (this.disposed) return; this.width = Math.max(1, this.container.clientWidth); this.height = Math.max(1, this.container.clientHeight); this.renderer.setSize(this.width, this.height, false); this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix(); this.render(); }
  render() { if (this.disposed) return; this.camera.updateMatrixWorld(); this.layoutLabels(); this.renderer.render(this.scene, this.camera); }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.resizeObserver.disconnect(); this.controls.removeEventListener('change', this.controlsChanged); this.controls.dispose();
    for (const [type, listener] of [['pointerdown', this.pointerDown], ['pointerup', this.pointerUp], ['pointercancel', this.pointerCancel]]) this.renderer.domElement.removeEventListener(type, listener);
    this.particleMesh.dispose(); this.displacementMesh.dispose(); for (const geometry of this.geometries) geometry.dispose(); for (const material of this.materials) material.dispose(); for (const texture of this.textures) texture.dispose(); this.environment.dispose(); this.renderer.dispose(); this.overlay.remove(); this.footer.remove(); this.renderer.domElement.remove(); this.container.classList.remove('sound-scene');
  }
}
