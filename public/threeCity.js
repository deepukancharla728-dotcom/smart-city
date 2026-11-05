import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let scene, camera, renderer, controls, pmremGenerator;
let animationFrameId = null;
let cityGroup = null;
let contactShadowGroup = null;
let analysisLayerGroup = null;
let dirLight, hemiLight;
let isDisposed = false;
let currentEnvMode = 'day';
let currentAnalysisMode = 'none';

// Detect software WebGL as mandated by threejs skill
const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch (e) {
    return true;
  }
})();

// Helper to create procedural canvas textures (Zero 404 external asset rule)
function createFacadeTexture(windowColor, frameColor, cols = 8, rows = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = frameColor;
  ctx.fillRect(0, 0, 256, 512);

  const cellW = 256 / cols;
  const cellH = 512 / rows;
  const padX = cellW * 0.15;
  const padY = cellH * 0.18;

  ctx.fillStyle = windowColor;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect(c * cellW + padX, r * cellH + padY, cellW - padX * 2, cellH - padY * 2);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createSolarTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f2038';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createRadialShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// 1. Composite 3-12 Part Hero Commercial Skyscraper (7 parts)
function createCommercialSkyscraper(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const facadeTex = createFacadeTexture('#60a5fa', '#1e293b', 8, 20);
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.85, metalness: 0.1 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#38bdf8',
    roughness: 0.15,
    metalness: 0.85,
    map: facadeTex,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1
  });
  const metalTrimMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.9 });
  const solarMat = new THREE.MeshStandardMaterial({ map: createSolarTexture(), roughness: 0.25, metalness: 0.8 });

  // Part 1: Ground podium base (flush with ground)
  const podiumGeo = new THREE.BoxGeometry(24, 6, 24);
  const podium = new THREE.Mesh(podiumGeo, concreteMat);
  podium.position.y = 3;
  podium.castShadow = true;
  podium.receiveShadow = true;
  group.add(podium);

  // Part 2: Main tower lower shaft
  const lowerGeo = new THREE.BoxGeometry(18, 38, 18);
  const lower = new THREE.Mesh(lowerGeo, glassMat);
  lower.position.y = 6 + 19;
  lower.castShadow = true;
  lower.receiveShadow = true;
  group.add(lower);

  // Part 3: Intermediate architectural setback collar
  const collarGeo = new THREE.BoxGeometry(20, 2, 20);
  const collar = new THREE.Mesh(collarGeo, metalTrimMat);
  collar.position.y = 44 + 1;
  collar.castShadow = true;
  group.add(collar);

  // Part 4: Upper tower slender crown
  const upperGeo = new THREE.BoxGeometry(14, 28, 14);
  const upper = new THREE.Mesh(upperGeo, glassMat);
  upper.position.y = 46 + 14;
  upper.castShadow = true;
  upper.receiveShadow = true;
  group.add(upper);

  // Part 5: Rooftop mechanical penthouse & helipad
  const heliBaseGeo = new THREE.CylinderGeometry(6, 6, 2, 16);
  const helipad = new THREE.Mesh(heliBaseGeo, concreteMat);
  helipad.position.y = 74 + 1;
  helipad.castShadow = true;
  group.add(helipad);

  // Part 6: Solar panel array on roof
  const solarGeo = new THREE.BoxGeometry(8, 0.4, 4);
  const solar = new THREE.Mesh(solarGeo, solarMat);
  solar.position.set(-2, 75.5, -2);
  solar.rotation.x = 0.2;
  group.add(solar);

  // Part 7: Telecommunications spire with beacon
  const spireGeo = new THREE.CylinderGeometry(0.2, 0.8, 16, 8);
  const spire = new THREE.Mesh(spireGeo, metalTrimMat);
  spire.position.y = 76 + 8;
  spire.castShadow = true;
  group.add(spire);

  const beaconGeo = new THREE.SphereGeometry(0.5, 8, 8);
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ff3344' });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.y = 76 + 16;
  group.add(beacon);

  return group;
}

// 2. Composite Eco Mixed-Use Tower with Terraces (6 parts)
function createEcoTower(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const facadeTex = createFacadeTexture('#34d399', '#0f172a', 6, 14);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#2dd4bf',
    roughness: 0.2,
    metalness: 0.75,
    map: facadeTex
  });
  const foliageMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.9, metalness: 0.05 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.6, metalness: 0.2 });

  // Part 1: Base concourse
  const baseGeo = new THREE.CylinderGeometry(12, 14, 5, 20);
  const base = new THREE.Mesh(baseGeo, concreteMat);
  base.position.y = 2.5;
  base.castShadow = true;
  group.add(base);

  // Part 2: Terraced spiral tower
  const towerGeo = new THREE.CylinderGeometry(8, 10, 45, 20);
  const tower = new THREE.Mesh(towerGeo, glassMat);
  tower.position.y = 5 + 22.5;
  tower.castShadow = true;
  group.add(tower);

  // Part 3: Cantilevered Sky Gardens / Balconies (3 tiers)
  [15, 28, 40].forEach((h, i) => {
    const ringGeo = new THREE.TorusGeometry(9 - i * 0.5, 0.8, 8, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, foliageMat);
    ring.position.y = h;
    ring.castShadow = true;
    group.add(ring);
  });

  // Part 4: Rooftop wind turbine frame & crown
  const crownGeo = new THREE.TorusGeometry(6, 0.6, 8, 16);
  crownGeo.rotateX(Math.PI / 2);
  const crown = new THREE.Mesh(crownGeo, concreteMat);
  crown.position.y = 51;
  group.add(crown);

  return group;
}

// 3. Composite Residential Urban Block (5 parts)
function createResidentialBlock(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const facadeTex = createFacadeTexture('#fbbf24', '#334155', 6, 10);
  const wallMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', map: facadeTex, roughness: 0.6, metalness: 0.1 });
  const brickMat = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.9, metalness: 0.05 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.6 });

  // Part 1: Street retail podium
  const retailGeo = new THREE.BoxGeometry(22, 5, 14);
  const retail = new THREE.Mesh(retailGeo, brickMat);
  retail.position.y = 2.5;
  retail.castShadow = true;
  group.add(retail);

  // Part 2: Residential block
  const blockGeo = new THREE.BoxGeometry(18, 22, 12);
  const block = new THREE.Mesh(blockGeo, wallMat);
  block.position.y = 5 + 11;
  block.castShadow = true;
  group.add(block);

  // Part 3: Balcony extensions
  const balcGeo = new THREE.BoxGeometry(19, 1.2, 13);
  [10, 16, 22].forEach(h => {
    const b = new THREE.Mesh(balcGeo, roofMat);
    b.position.y = h;
    group.add(b);
  });

  // Part 4: Rooftop garden pergolas
  const pergolaGeo = new THREE.BoxGeometry(8, 2.5, 6);
  const pergola = new THREE.Mesh(pergolaGeo, roofMat);
  pergola.position.set(2, 28, 0);
  group.add(pergola);

  return group;
}

// 4. Composite Procedural Tree (3 parts with fluted trunk & multi-layer foliage)
function createProceduralTree(x, z, scale = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.set(scale, scale, scale);

  const trunkMat = new THREE.MeshStandardMaterial({ color: '#573d26', roughness: 0.95, metalness: 0.05 });
  const foliageMat = new THREE.MeshStandardMaterial({
    color: scale > 1 ? '#15803d' : '#16a34a',
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true
  });

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.6, 3.5, 6);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.75;
  trunk.castShadow = true;
  group.add(trunk);

  // Tier 1 foliage
  const f1Geo = new THREE.ConeGeometry(2.8, 3.5, 6);
  const f1 = new THREE.Mesh(f1Geo, foliageMat);
  f1.position.y = 4.2;
  f1.castShadow = true;
  group.add(f1);

  // Tier 2 foliage
  const f2Geo = new THREE.ConeGeometry(2.1, 3.0, 6);
  const f2 = new THREE.Mesh(f2Geo, foliageMat);
  f2.position.y = 6.0;
  f2.castShadow = true;
  group.add(f2);

  // Tier 3 crown
  const f3Geo = new THREE.ConeGeometry(1.4, 2.2, 6);
  const f3 = new THREE.Mesh(f3Geo, foliageMat);
  f3.position.y = 7.5;
  f3.castShadow = true;
  group.add(f3);

  return group;
}

// 5. Composite Elevated Light Rail / Transit Way with Modern Vehicle
function createTransitSystem() {
  const group = new THREE.Group();
  const trackMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.5, metalness: 0.7 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.8, metalness: 0.2 });
  const trainMat = new THREE.MeshPhysicalMaterial({ color: '#38bdf8', roughness: 0.2, metalness: 0.85 });
  const windowMat = new THREE.MeshBasicMaterial({ color: '#0f172a' });

  // Elevated track span
  const trackGeo = new THREE.BoxGeometry(6, 1.2, 140);
  const track = new THREE.Mesh(trackGeo, trackMat);
  track.position.set(-25, 10, 0);
  track.castShadow = true;
  group.add(track);

  // Support pillars along track
  for (let z = -60; z <= 60; z += 25) {
    const pillarGeo = new THREE.CylinderGeometry(1.2, 1.5, 10, 8);
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(-25, 5, z);
    pillar.castShadow = true;
    group.add(pillar);
  }

  // Futuristic Aerodynamic Transit Train
  const trainGroup = new THREE.Group();
  trainGroup.position.set(-25, 12, 10);

  const carGeo = new THREE.BoxGeometry(4.2, 3.0, 24);
  const car = new THREE.Mesh(carGeo, trainMat);
  car.castShadow = true;
  trainGroup.add(car);

  // Cab glass
  const cabGeo = new THREE.BoxGeometry(4.22, 1.2, 20);
  const cab = new THREE.Mesh(cabGeo, windowMat);
  cab.position.y = 0.5;
  trainGroup.add(cab);

  group.add(trainGroup);
  return group;
}

// Contact shadow ground plane
function createContactShadows() {
  const group = new THREE.Group();
  const shadowTex = createRadialShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.45,
    depthWrite: false
  });

  const shadowGeo = new THREE.PlaneGeometry(36, 36);
  shadowGeo.rotateX(-Math.PI / 2);

  // Shadows beneath key buildings
  const positions = [
    [-30, -25], [10, -25], [45, -25],
    [10, 25], [45, 25], [-25, 0]
  ];

  positions.forEach(([x, z]) => {
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(x, 0.03, z);
    group.add(shadow);
  });

  return group;
}

// Analysis Heatmap Overlay (Visualizing Autodesk Forma style solar/wind metrics in 3D)
function createAnalysisLayer() {
  const group = new THREE.Group();
  group.visible = false;

  const solarOverlayMat = new THREE.MeshBasicMaterial({
    color: '#f59e0b',
    transparent: true,
    opacity: 0.65,
    wireframe: true
  });

  // Highlight key roofs with solar insolation overlay
  const roofOverlay1 = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), solarOverlayMat);
  roofOverlay1.rotation.x = -Math.PI / 2;
  roofOverlay1.position.set(10, 75, -25);
  group.add(roofOverlay1);

  const roofOverlay2 = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), solarOverlayMat);
  roofOverlay2.rotation.x = -Math.PI / 2;
  roofOverlay2.position.set(-30, 28, 25);
  group.add(roofOverlay2);

  return group;
}

export function initThreeCityScene(containerEl) {
  if (!containerEl) return;
  isDisposed = false;

  // Setup Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#07111f');
  scene.fog = new THREE.FogExp2('#07111f', 0.007);

  // Setup Camera
  const aspect = containerEl.clientWidth / containerEl.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 400);
  camera.position.set(90, 65, 95);

  // Modern Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance'
  });
  renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  containerEl.innerHTML = '';
  containerEl.appendChild(renderer.domElement);

  // OrbitControls with exponential damping
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !isSoftwareGl;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 20;
  controls.maxDistance = 220;
  controls.target.set(10, 15, 0);
  controls.update();

  // Studio Reflection Environment
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  // Balanced Lighting Rig
  hemiLight = new THREE.HemisphereLight('#93c5fd', '#1e293b', 0.85);
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight('#fff1e6', 1.8);
  dirLight.position.set(80, 100, 60);
  dirLight.castShadow = !isSoftwareGl;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 250;
  dirLight.shadow.camera.left = -80;
  dirLight.shadow.camera.right = 80;
  dirLight.shadow.camera.top = 80;
  dirLight.shadow.camera.bottom = -80;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.02;
  scene.add(dirLight);

  // Ground plane & Road Network
  const groundGeo = new THREE.PlaneGeometry(240, 240);
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#0e1e30',
    roughness: 0.9,
    metalness: 0.1
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Main Boulevard Road
  const roadGeo = new THREE.PlaneGeometry(16, 200);
  const roadMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 0);
  road.receiveShadow = true;
  scene.add(road);

  // Cross Avenue Road
  const crossGeo = new THREE.PlaneGeometry(200, 14);
  const crossRoad = new THREE.Mesh(crossGeo, roadMat);
  crossRoad.rotation.x = -Math.PI / 2;
  crossRoad.position.set(0, 0.022, 0);
  crossRoad.receiveShadow = true;
  scene.add(crossRoad);

  // Contact Shadows
  contactShadowGroup = createContactShadows();
  scene.add(contactShadowGroup);

  // City Group
  cityGroup = new THREE.Group();

  // Assemble distinct composite buildings
  cityGroup.add(createCommercialSkyscraper(10, -25));
  cityGroup.add(createCommercialSkyscraper(45, -25));
  cityGroup.add(createEcoTower(-30, -25));
  cityGroup.add(createResidentialBlock(10, 25));
  cityGroup.add(createResidentialBlock(45, 25));
  cityGroup.add(createResidentialBlock(-30, 25));

  // Add Elevated Transit
  cityGroup.add(createTransitSystem());

  // Landscaping & Green Buffer zones
  for (let z = -70; z <= 70; z += 14) {
    cityGroup.add(createProceduralTree(9, z, 0.9 + Math.random() * 0.3));
    cityGroup.add(createProceduralTree(-9, z, 0.9 + Math.random() * 0.3));
  }
  for (let x = 20; x <= 65; x += 15) {
    cityGroup.add(createProceduralTree(x, 8, 1.1));
    cityGroup.add(createProceduralTree(x, -8, 1.1));
  }

  scene.add(cityGroup);

  // Analysis Layer
  analysisLayerGroup = createAnalysisLayer();
  scene.add(analysisLayerGroup);

  // Resize handler
  const handleResize = () => {
    if (isDisposed || !containerEl || !renderer) return;
    camera.aspect = containerEl.clientWidth / containerEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  };
  window.addEventListener('resize', handleResize);

  // Render loop
  function animate() {
    if (isDisposed) return;
    animationFrameId = requestAnimationFrame(animate);

    if (controls) controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    setLightingPreset: (preset) => {
      currentEnvMode = preset;
      if (preset === 'day') {
        scene.background.set('#07111f');
        scene.fog.color.set('#07111f');
        hemiLight.intensity = 0.85;
        hemiLight.color.set('#93c5fd');
        dirLight.intensity = 1.8;
        dirLight.color.set('#fff1e6');
        dirLight.position.set(80, 100, 60);
      } else if (preset === 'sunset') {
        scene.background.set('#1c1324');
        scene.fog.color.set('#1c1324');
        hemiLight.intensity = 0.6;
        hemiLight.color.set('#fdba74');
        dirLight.intensity = 1.4;
        dirLight.color.set('#f97316');
        dirLight.position.set(110, 40, 20);
      } else if (preset === 'night') {
        scene.background.set('#030712');
        scene.fog.color.set('#030712');
        hemiLight.intensity = 0.3;
        hemiLight.color.set('#38bdf8');
        dirLight.intensity = 0.5;
        dirLight.color.set('#818cf8');
        dirLight.position.set(-60, 80, -40);
      }
    },
    setCameraView: (view) => {
      if (!controls) return;
      if (view === 'aerial') {
        camera.position.set(0, 110, 110);
        controls.target.set(0, 10, 0);
      } else if (view === 'street') {
        camera.position.set(0, 8, 55);
        controls.target.set(0, 15, -20);
      } else if (view === 'tower') {
        camera.position.set(30, 60, -5);
        controls.target.set(10, 45, -25);
      } else if (view === 'masterplan') {
        camera.position.set(90, 65, 95);
        controls.target.set(10, 15, 0);
      }
      controls.update();
    },
    toggleAnalysisLayer: (mode) => {
      currentAnalysisMode = mode;
      if (analysisLayerGroup) {
        analysisLayerGroup.visible = (mode !== 'none');
      }
    }
  };
}

export function destroyThreeCityScene() {
  isDisposed = true;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (controls) {
    controls.dispose();
    controls = null;
  }
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }
  scene = null;
  camera = null;
}
