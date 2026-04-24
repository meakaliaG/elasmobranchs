/**
 * viewer.jsx — Elasmobranch Atlas
 *
 * Three.js underwater scene + React info panel.
 * - AnimationMixer drives GLTF swim-cycle clips independently of the swim path
 * - Multi-layer: any combination of OBJ layers can be visible simultaneously
 * - Canonical transform: all layers share the scale/offset computed from the
 *   skin bounding box, keeping every layer perfectly aligned in 3D space
 */

const React      = require('react');
const { useState, useEffect, useCallback } = React;
const { createRoot } = require('react-dom/client');

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader }     from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader }     from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// ─── Specimen Catalog ─────────────────────────────────────────────────────────

const SPECIMEN_CATALOG = {
    'Sharkswim2.glb': {
        tag:   'Apex Predator · Juvenile',
        name:  'Great White Shark',
        latin: 'Carcharodon carcharias',
        stats: [
            { label: 'Est. Length',  value: '1.5',            unit: 'm'  },
            { label: 'Depth Range',  value: '0 – 250',        unit: 'm'  },
            { label: 'Order',        value: 'Lamniformes',    unit: ''   },
            { label: 'Class',        value: 'Chondrichthyes', unit: ''   },
        ],
        description: 'Born fully formed and immediately independent, juvenile great whites hunt bony fish and rays in coastal shallows before transitioning to marine mammal prey as adults. Their dermal denticles — microscopic tooth-like scales — streamline flow and nearly silence passage through water.',
        anatomy: 'The cartilaginous skeleton is lighter and more flexible than bone, enabling the tight-radius turns juveniles rely on for reef hunting. Slow-twitch red muscle fibers sustain continuous cruising; dense fast-twitch white fibers power explosive acceleration.',
        layers: {
            skin: {
                label: 'Dermal · Skin',
                obj: '/assets/models/greatWhite/gwSkin.obj',
                mtl: null,
            },
            muscle: {
                label: 'Muscular · Tissue',
                obj: '/assets/models/greatWhite/gwMuscles.obj',
                mtl: '/assets/models/greatWhite/gwMuscles.mtl',
            },
            organs: {
                label: 'Organs',
                obj: '/assets/models/greatWhite/gwOrgans.obj',
                mtl: '/assets/models/greatWhite/gwOrgans.mtl',
            },
            circulatory: {
                label: 'Circulatory',
                obj: '/assets/models/greatWhite/gwCirculatory.obj',
                mtl: '/assets/models/greatWhite/gwCirculatory.mtl',
            },
            skeleton: {
                label: 'Osseous · Cartilage',
                obj: '/assets/models/greatWhite/gwCartilage.obj',
                mtl: '/assets/models/greatWhite/gwCartilage.mtl',
            },
        },
    },

    // GLTF animated specimen — add entry here when file is ready:
    // 'gwAnimated.glb': { tag: '...', name: '...', latin: '...', stats: [], layers: {} }
    'Sharkswim1.glb': {tag: '...', name: 'shark', latin: '...', stats: [], layers: {}}
};

// ─── React <-> Three.js Bridge ────────────────────────────────────────────────

let _setPanelOpen    = null;  // (bool) => void
let _setPanelData    = null;  // (catalogEntry) => void
let _setActiveLayers = null;  // (Set<string>) => void

// ─── React Components ─────────────────────────────────────────────────────────

const StatCell = ({ label, value, unit }) => (
    <div className='stat-cell'>
        <div className='stat-label'>{label}</div>
        <div className='stat-value'>
            {value}<span className='stat-unit'>{unit}</span>
        </div>
    </div>
);

const LayerButton = ({ layerKey, label, active, onClick }) => (
    <button
        className={`layer-btn${active ? ' active' : ''}`}
        data-layer={layerKey}
        onClick={() => onClick(layerKey)}
    >
        <span className='layer-dot' />
        <span className='layer-label'>{label}</span>
    </button>
);

const InfoPanel = ({ isOpen, data, activeLayers, onClose, onLayerToggle }) => {
    if (!data) return null;
    const LAYER_KEYS = ['skin', 'muscle', 'organs', 'circulatory', 'skeleton'];

    return (
        <aside className={`info-panel${isOpen ? ' open' : ''}`} id='infoPanel'>
            <div className='panel-header'>
                <button className='panel-close' onClick={onClose} aria-label='Close'>✕</button>
                <div className='species-tag'>{data.tag}</div>
                <div className='species-name'>{data.name}</div>
                <div className='species-latin'>{data.latin}</div>
            </div>
            <div className='panel-body'>
                <div className='stats-grid'>
                    {data.stats.map(s => (
                        <StatCell key={s.label} label={s.label} value={s.value} unit={s.unit} />
                    ))}
                </div>
                <div className='section-label'>Overview</div>
                <div className='description'>{data.description}</div>
                <div className='layer-section'>
                    <div className='section-label'>Anatomical Layers</div>
                    <div className='layer-subtitle'>Toggle layers independently to examine tissue depths</div>
                    <div className='layer-buttons'>
                        {LAYER_KEYS.map(key => (
                            <LayerButton
                                key={key}
                                layerKey={key}
                                label={data.layers?.[key]?.label ?? key}
                                active={activeLayers.has(key)}
                                onClick={onLayerToggle}
                            />
                        ))}
                    </div>
                </div>
                <div className='section-label'>Anatomy Note</div>
                <div className='anatomy-note'>{data.anatomy}</div>
            </div>
        </aside>
    );
};

const App = () => {
    const [isOpen,       setIsOpen]       = useState(false);
    const [panelData,    setPanelData]    = useState(null);
    // Use a Set to track which layers are currently visible
    const [activeLayers, setActiveLayers] = useState(new Set(['skin']));

    useEffect(() => {
        _setPanelOpen    = setIsOpen;
        _setPanelData    = setPanelData;
        // Always spread into a new Set so React detects the change
        _setActiveLayers = (nextSet) => setActiveLayers(new Set(nextSet));
    }, []);

    // Reset to skin-only each time the panel opens fresh
    useEffect(() => {
        if (isOpen) setActiveLayers(new Set(['skin']));
    }, [isOpen]);

    const handleLayerToggle = useCallback((layerKey) => {
        setActiveLayers(prev => {
            const next = new Set(prev);
            if (next.has(layerKey)) {
                if (next.size === 1) return prev; // keep at least one visible
                next.delete(layerKey);
                toggleLayer(layerKey, false);     // hide in Three.js
            } else {
                next.add(layerKey);
                toggleLayer(layerKey, true);      // show/load in Three.js
            }
            return next;
        });
    }, []);

    const handleClose = useCallback(() => deselectSpecimen(), []);

    return (
        <InfoPanel
            isOpen={isOpen}
            data={panelData}
            activeLayers={activeLayers}
            onClose={handleClose}
            onLayerToggle={handleLayerToggle}
        />
    );
};

// ─── Three.js Scene ───────────────────────────────────────────────────────────

const canvas = document.getElementById('modelCanvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace    = THREE.SRGBColorSpace;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x00060f);
// scene.fog = new THREE.FogExp2(0x000a15, 0.014);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.5, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance   = 3;
controls.maxDistance   = 35;
controls.maxPolarAngle = Math.PI * 0.88;
controls.autoRotate    = false;

// ── Lights ────────────────────────────────────────────────────────────────────

scene.add(new THREE.AmbientLight(0x4488cc, 12));

const sunLight = new THREE.DirectionalLight(0x4488bb, 5);
sunLight.position.set(3, 18, 6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { near: 0.5, far: 50, left: -20, right: 20, top: 20, bottom: -20 });
sunLight.shadow.bias = -0.001;
scene.add(sunLight);

const specimenSpot = new THREE.SpotLight(0x99ddff, 5, 60, Math.PI * 0.14, 0.4, 1.0);
specimenSpot.position.set(-4, 16, 6);
specimenSpot.target.position.set(-4, 0, 0);
scene.add(specimenSpot);
scene.add(specimenSpot.target);

const sideFill = new THREE.PointLight(0x224466, 5, 30);
sideFill.position.set(-10, 2, 4);
scene.add(sideFill);

const CAUSTIC_DEFS = [
    { color: 0x0055bb, base: 6.0, radius: 28 },
    { color: 0x007acc, base: 5.0, radius: 22 },
    { color: 0x00aadd, base: 4.0, radius: 18 },
    { color: 0x004488, base: 7.0, radius: 26 },
];
const causticLights = CAUSTIC_DEFS.map((def, i) => {
    const light = new THREE.PointLight(def.color, def.base, def.radius);
    const phase = (i / CAUSTIC_DEFS.length) * Math.PI * 2;
    light.position.set(Math.cos(phase) * 7, 4 + i * 0.6, Math.sin(phase) * 7);
    scene.add(light);
    return { light, phase, base: def.base, speed: 0.28 + i * 0.04 };
});

// ── God Rays ──────────────────────────────────────────────────────────────────

for (let i = 0; i < 7; i++) {
    const h   = 22 + Math.random() * 8;
    const geo = new THREE.ConeGeometry(2 + Math.random() * 2.5, h, 5, 1, true);
    geo.translate(0, -h / 2, 0);
    const ray = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x003366, transparent: true, opacity: 0.03 + Math.random() * 0.05,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ray.position.set((Math.random() - 0.5) * 20, 14, (Math.random() - 0.5) * 20);
    ray.rotation.z = Math.PI;
    scene.add(ray);
}

// ── Water Surface ─────────────────────────────────────────────────────────────

const surfaceGeo = new THREE.PlaneGeometry(80, 80, 32, 32);
const surfaceMesh = new THREE.Mesh(surfaceGeo, new THREE.MeshStandardMaterial({
    color: 0x003d55, transparent: true, opacity: 0.55,
    side: THREE.BackSide, roughness: 0.0, metalness: 0.2,
}));
surfaceMesh.rotation.x = Math.PI / 2;
surfaceMesh.position.y = 14;
scene.add(surfaceMesh);

const surfacePositions = surfaceGeo.attributes.position;
const surfaceOrigY = new Float32Array(surfacePositions.count);
for (let i = 0; i < surfacePositions.count; i++) surfaceOrigY[i] = surfacePositions.getY(i);

// ── Particles ─────────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 1400;
const pArr   = new Float32Array(PARTICLE_COUNT * 3);
const pSpeed = new Float32Array(PARTICLE_COUNT);
for (let i = 0; i < PARTICLE_COUNT; i++) {
    pArr[i * 3]     = (Math.random() - 0.5) * 60;
    pArr[i * 3 + 1] = (Math.random() - 0.5) * 35;
    pArr[i * 3 + 2] = (Math.random() - 0.5) * 60;
    pSpeed[i]       = 0.0045 + Math.random() * 0.008;
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0x55aacc, size: 0.065, transparent: true, opacity: 0.28,
    sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending,
})));

// ── Stage Rings ───────────────────────────────────────────────────────────────

const SHOWCASE_POS = new THREE.Vector3(-4.0, 0.0, 4.0);

const ringMats = [
    new THREE.MeshBasicMaterial({ color: 0x2a8ab8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
    new THREE.MeshBasicMaterial({ color: 0x55c5f0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
    new THREE.MeshBasicMaterial({ color: 0x0d4466, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
];
const stageRings = [
    new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.025, 4, 80), ringMats[0]),
    new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.018, 4, 60), ringMats[1]),
    new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.012, 4, 80), ringMats[2]),
];
stageRings.forEach(r => {
    r.rotation.x = Math.PI / 2;
    r.position.copy(SHOWCASE_POS);
    r.position.y = -2.5;
    scene.add(r);
});

// ── Procedural Shark Placeholder ──────────────────────────────────────────────

let sharkRoot  = null;
let sharkPivot = null;
let tailGroup  = null;

const buildPlaceholderShark = () => {
    const root  = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI / 2;
    root.add(pivot);

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3d5f74, roughness: 0.35, metalness: 0.45 });
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x8aaabb, roughness: 0.4,  metalness: 0.2  });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.30, 1.85, 24), darkMat);
    body.rotation.z = Math.PI / 2; body.castShadow = true; pivot.add(body);

    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.24, 1.5, 16), bellMat);
    belly.rotation.z = Math.PI / 2; belly.position.set(0.1, -0.08, 0); belly.scale.z = 0.55; pivot.add(belly);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.5, 10), darkMat);
    snout.rotation.z = -Math.PI / 2; snout.position.x = 1.15; pivot.add(snout);

    const dShape = new THREE.Shape();
    dShape.moveTo(0, 0); dShape.quadraticCurveTo(-0.06, 0.38, 0.08, 0.68); dShape.lineTo(0.52, 0); dShape.closePath();
    const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dShape), darkMat);
    dorsal.position.set(0.1, 0.38, 0); dorsal.rotation.y = Math.PI / 2; pivot.add(dorsal);

    const pShape = new THREE.Shape();
    pShape.moveTo(0, 0); pShape.quadraticCurveTo(0.08, -0.28, -0.06, -0.62); pShape.lineTo(0.52, -0.18); pShape.closePath();
    [1, -1].forEach(side => {
        const fin = new THREE.Mesh(new THREE.ShapeGeometry(pShape), darkMat);
        fin.position.set(0.22, -0.1, side * 0.4);
        fin.rotation.x = -side * 0.32; fin.rotation.y = side > 0 ? 0 : Math.PI; pivot.add(fin);
    });

    const tg = new THREE.Group();
    tg.position.x = -1.0; pivot.add(tg);
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0); tailShape.quadraticCurveTo(-0.15, 0.28, -0.44, 0.45);
    tailShape.lineTo(-0.18, 0); tailShape.quadraticCurveTo(-0.15, -0.28, -0.44, -0.45); tailShape.closePath();
    const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), darkMat);
    tailMesh.rotation.y = Math.PI / 2; tg.add(tailMesh);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000008, roughness: 0.05, metalness: 0.6 });
    [0.33, -0.33].forEach(side => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), eyeMat);
        eye.position.set(0.85, 0.14, side); pivot.add(eye);
    });

    scene.add(root);
    return { root, pivot, tg };
};

({ root: sharkRoot, pivot: sharkPivot, tg: tailGroup } = buildPlaceholderShark());

// ── Swim Path ─────────────────────────────────────────────────────────────────

const SWIM_A     = 6.5;
const SWIM_SPEED = 0.26;

const swimPos = (t) => {
    const s     = Math.sin(t);
    const denom = 1 + s * s;
    return new THREE.Vector3(
        SWIM_A * Math.cos(t) / denom,
        Math.sin(t * 0.6) * 0.9,
        SWIM_A * s * Math.cos(t) / denom,
    );
};

// ─── Canonical Transform ──────────────────────────────────────────────────────
//
// Computed once from the skin OBJ bounding box when it loads. Every subsequent
// layer OBJ gets the exact same scale and position offset, so they all overlap
// correctly in 3D space (they all share the same Blender world origin).
//
// How it works:
//   1. Measure the skin's bounding box → compute scale to fit in 3 units
//   2. Store: canonicalScale, canonicalNegCenter (= -center * scale)
//   3. Apply to skin:    obj.scale = canonicalScale, obj.position = canonicalNegCenter
//   4. Apply to layers:  same values → identical offset → perfect alignment

let canonicalScale     = 1;
let canonicalNegCenter = new THREE.Vector3(); // negated scaled center

const computeCanonical = (object) => {
    const box    = new THREE.Box3().setFromObject(object);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    canonicalScale = 3 / Math.max(size.x, size.y, size.z);
    // Store -(center * scale) so we can add it to any world position directly
    canonicalNegCenter.copy(center).multiplyScalar(-canonicalScale);
};

const applyCanonical = (object) => {
    object.scale.setScalar(canonicalScale);
    object.position.copy(canonicalNegCenter);
};

// ─── Model State ──────────────────────────────────────────────────────────────
//
// skinModel   — base OBJ (or GLTF pivot); always in scene; drives swim path.
// layerModels — { [layerKey]: Object3D } — all loaded non-skin layers.
//               Loaded lazily on first toggle; kept in memory for instant re-toggle.
// mixer       — AnimationMixer for GLTF bone clips; null for OBJ specimens.

let skinModel       = null;
let layerModels     = {};
let currentFileName = null;
let mixer           = null;

// ─── Layer Toggle (called from React) ────────────────────────────────────────

/**
 * toggleLayer — show or hide a single anatomical layer.
 * On first show, the OBJ is fetched and aligned to the skin via canonical transform.
 * On subsequent toggles, it's instant — just a .visible flip.
 */
const toggleLayer = (layerKey, visible) => {
    if (layerKey === 'skin') {
        if (skinModel) skinModel.visible = visible;
        return;
    }

    if (!visible) {
        if (layerModels[layerKey]) layerModels[layerKey].visible = false;
        return;
    }

    // Already loaded — show immediately
    if (layerModels[layerKey]) {
        layerModels[layerKey].visible = true;
        return;
    }

    // First time — fetch the OBJ
    const entry    = SPECIMEN_CATALOG[currentFileName];
    console.log("filename: " + currentFileName);

    const layerDef = entry?.layers?.[layerKey];
    if (!layerDef?.obj) return;

    setStatus(`Loading ${layerDef.label}…`);

    const doLoad = (materials) => {
        const loader = new OBJLoader();
        if (materials) loader.setMaterials(materials);

        loader.load(
            layerDef.obj,
            (obj) => {
                obj.traverse(child => {
                    if (!child.isMesh) return;
                    child.castShadow    = true;
                    child.receiveShadow = true;
                    if (!materials) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x8aaabb, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide,
                        });
                    }
                });

                // Apply the same scale + center offset as the skin.
                // Because all OBJs share the same Blender world origin,
                // this single step is enough to align them.
                applyCanonical(obj);

                layerModels[layerKey] = obj;
                obj.visible = true;
                skinModel.add(obj)
                setStatus('');
            },
            xhr => setStatus(`${layerDef.label} ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
            err => { console.error(err); setStatus(`Failed to load ${layerDef.label}.`, true); },
        );
    };

    if (layerDef.mtl) {
        new MTLLoader().load(layerDef.mtl, mats => { mats.preload(); doLoad(mats); });
    } else {
        doLoad(null);
    }
};

// ─── Selection State ──────────────────────────────────────────────────────────

let isSelected    = false;
let showcaseBlend = 0;
let frozenSwimT   = 0;
let showcaseRotY  = 0;

const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

const selectSpecimen = () => {
    if (isSelected) return;
    isSelected   = true;
    frozenSwimT  = swimT;
    showcaseRotY = (skinModel ?? sharkRoot)?.rotation.y ?? 0;

    const entry = SPECIMEN_CATALOG[currentFileName] ?? {
        tag: 'Marine Specimen', name: 'Unknown Species', latin: '—',
        stats: [], description: '—', anatomy: '—',
        layers: {
            skin:        { label: 'Dermal · Skin',      obj: null, mtl: null },
            muscle:      { label: 'Muscular · Tissue',  obj: null, mtl: null },
            organs:      { label: 'Organs',             obj: null, mtl: null },
            circulatory: { label: 'Circulatory',        obj: null, mtl: null },
            skeleton:    { label: 'Osseous · Skeleton', obj: null, mtl: null },
        },
    };

    const badge = document.getElementById('specimenBadge');
    if (badge) badge.querySelector('.sb-latin').textContent = entry.latin;

    _setPanelData?.(entry);
    _setPanelOpen?.(true);
    _setActiveLayers?.(new Set(['skin']));

    // Reset: hide all layers, show only skin when panel opens
    Object.values(layerModels).forEach(m => { m.visible = false; });
    if (skinModel) skinModel.visible = true;

    document.getElementById('sceneDim')?.classList.add('active');
    badge?.classList.add('visible');
    document.getElementById('hint')?.classList.add('gone');
    document.querySelector('.hud-title')?.style.setProperty('opacity', '0.15');
};

const deselectSpecimen = () => {
    if (!isSelected) return;
    isSelected = false;

    Object.values(layerModels).forEach(m => { m.visible = false; });
    if (skinModel) skinModel.visible = true;

    _setPanelOpen?.(false);
    _setActiveLayers?.(new Set(['skin']));

    document.getElementById('sceneDim')?.classList.remove('active');
    document.getElementById('specimenBadge')?.classList.remove('visible');
    document.getElementById('hint')?.classList.remove('gone');
    document.querySelector('.hud-title')?.style.setProperty('opacity', '1');
};

// ─── Raycasting ───────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let   ptrDown   = { x: 0, y: 0 };
let   didDrag   = false;

canvas.addEventListener('pointerdown', e => { ptrDown.x = e.clientX; ptrDown.y = e.clientY; didDrag = false; });
canvas.addEventListener('pointermove', e => {
    const dx = e.clientX - ptrDown.x, dy = e.clientY - ptrDown.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) didDrag = true;
});
canvas.addEventListener('pointerup', e => {
    if (didDrag) return;
    mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const target = skinModel ?? sharkRoot;
    if (!target) return;

    const meshes = [];
    target.traverse(child => { if (child.isMesh) meshes.push(child); });

    if (raycaster.intersectObjects(meshes, false).length > 0) {
        selectSpecimen();
    } else if (!document.getElementById('panelMount')?.contains(e.target)) {
        deselectSpecimen();
    }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const setStatus = (msg, isError = false) => {
    const el = document.getElementById('viewerStatus');
    if (!el) return;
    el.textContent   = msg;
    el.style.color   = isError ? '#ff6b6b' : '#00d4ff';
    el.style.display = msg ? 'block' : 'none';
};

// ─── Model Loaders ────────────────────────────────────────────────────────────

/**
 * loadOBJ — loads the base skin specimen OBJ.
 * Computes the canonical transform so all subsequent layer loads align to it.
 */
export const loadOBJ = (objUrl, mtlUrl = null) => {
    setStatus('Loading model…');

    if (sharkRoot)   sharkRoot.visible = false;
    if (skinModel)  { scene.remove(skinModel); skinModel = null; }
    Object.values(layerModels).forEach(m => scene.remove(m));
    layerModels     = {};
    currentFileName = null;
    if (mixer) { mixer.stopAllAction(); mixer = null; }

    const doLoad = (materials) => {
        const loader = new OBJLoader();
        if (materials) loader.setMaterials(materials);

        loader.load(
            objUrl,
            (obj) => {
                obj.traverse(child => {
                    if (!child.isMesh) return;
                    child.castShadow    = true;
                    child.receiveShadow = true;
                    if (!materials) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x3f6a88, roughness: 0.55, metalness: 0.12,
                        });
                    }
                });

                // Compute canonical from skin bounding box, then apply to skin
                computeCanonical(obj);
                applyCanonical(obj);

                skinModel       = obj;
                currentFileName = objUrl.split('/').pop();
                scene.add(skinModel);
                setStatus('');
            },
            xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
            err => {
                console.error(err);
                setStatus('Failed to load model.', true);
                if (sharkRoot) sharkRoot.visible = true;
            },
        );
    };

    if (mtlUrl) {
        new MTLLoader().load(mtlUrl, mats => { mats.preload(); doLoad(mats); });
    } else {
        doLoad(null);
    }
};

export const loadFBX = (url) => {
    setStatus('Loading model…');

    if (sharkRoot)   sharkRoot.visible = false;
    if (skinModel)  { scene.remove(skinModel); skinModel = null; }
    Object.values(layerModels).forEach(m => scene.remove(m));
    layerModels     = {};
    currentFileName = null;
    if (mixer) { mixer.stopAllAction(); mixer = null; }

    new FBXLoader().load(
        url,
        (fbx) => {
            // FBXLoader returns the group directly (not wrapped in .scene like GLTF)
            fbx.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }

            if (child.isSkinnedMesh) {
                child.frustumCulled = false;
            }
            });

            // Same pivot pattern as GLTF — swim path drives pivot,
            // mixer drives bones inside fbx
            const pivot = new THREE.Group();
            computeCanonical(fbx);
            applyCanonical(fbx);
            fbx.scale.setScalar(.004);
            pivot.add(fbx);
            scene.add(pivot);

            skinModel       = pivot;
            currentFileName = url.split('/').pop();

            // fbx.animations is the array — same shape as gltf.animations
            if (fbx.animations.length > 0) {
                mixer = new THREE.AnimationMixer(fbx);
                console.log(fbx.animations);

                const action = mixer.clipAction(fbx.animations[0]);
                action.play();
                action.timeScale = 3;
                // let animRoot = null;

                // fbx.traverse(child => {
                //     if (child.isSkinnedMesh && !animRoot) {
                //         animRoot = child;
                //     }
                // });

                // // fallback if not found
                // if (!animRoot) animRoot = fbx;

                // mixer = new THREE.AnimationMixer(animRoot);

                // const action = mixer.clipAction(fbx.animations[0]);
                // action.setLoop(THREE.LoopRepeat);
                // action.play();
                // action.setLoop(THREE.LoopRepeat);
                // action.play();
                console.log(
                    `[FBXLoader] Playing "${fbx.animations[0].name}" — ` +
                    `${fbx.animations[0].duration.toFixed(2)}s, ` +
                    `${fbx.animations.length} clip(s) total`
                );
                console.log(fbx);
            } else {
                console.warn('[FBXLoader] No animation clips found in', url);
            }

            setStatus('');
        },
        xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
        err => {
            console.error(err);
            setStatus('Failed to load model.', true);
            if (sharkRoot) sharkRoot.visible = true;
        },
    );
};

/**
 * loadGLTF — loads a rigged/animated GLB specimen.
 *
 * Architecture: the swim path drives a `pivot` Group; the AnimationMixer drives
 * bones inside `gltf.scene` which is a child of that pivot. They never conflict
 * because they operate at different levels of the hierarchy.
 *
 *   pivot (swim path drives this)
 *     └─ gltf.scene (mixer drives bones inside here)
 *
 * For an 80-frame clip at 24fps, the total duration is ~3.33s.
 * The clip will loop seamlessly via THREE.LoopRepeat.
 */
export const loadGLTF = (url) => {
    setStatus('Loading model…');

    if (sharkRoot)   sharkRoot.visible = false;
    if (skinModel)  { scene.remove(skinModel); skinModel = null; }
    Object.values(layerModels).forEach(m => scene.remove(m));
    layerModels     = {};
    currentFileName = null;
    if (mixer) { mixer.stopAllAction(); mixer = null; }

    new GLTFLoader().load(
        url,
        (gltf) => {
            // Pivot: swim loop drives this group's position + rotation
            const pivot = new THREE.Group();

            // gltf.scene.traverse(child => {
            //     if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
            // });
            gltf.scene.traverse(child => {
            if (child.isMesh && child.material.map) {
                console.log('texture colorSpace:', child.material.map.colorSpace);
            }       
            if (child.isMesh) { 
                child.castShadow = true; 
                child.receiveShadow = true; 
            }
            if (child.isSkinnedMesh) {
                child.frustumCulled = false; 
            }
            });

            // Center gltf.scene inside the pivot using canonical transform
            computeCanonical(gltf.scene);
            applyCanonical(gltf.scene);
            pivot.add(gltf.scene);
            scene.add(pivot);

            skinModel       = pivot;
            currentFileName = url.split('/').pop();
            console.log("filename: " + currentFileName);

            // AnimationMixer operates on gltf.scene where the armature lives
            if (gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(gltf.scene);
                console.log("Available animations:", gltf.animations.map(a => a.name));
                const swimClip = gltf.animations[0];
                const action   = mixer.clipAction(swimClip);
                action.setLoop(THREE.LoopRepeat);
                action.timeScale = 3;
                action.play();
                console.log(
                    `[AnimationMixer] Playing "${swimClip.name}" — ` +
                    `${Math.round(swimClip.duration * 24)} frames at 24fps, ` +
                    `${gltf.animations.length} clip(s) total in file`
                );
            } else {
                console.warn('[AnimationMixer] No animation clips found in', url);
            }

            setStatus('');
        },
        xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
        err => {
            console.error(err);
            setStatus('Failed to load model.', true);
            if (sharkRoot) sharkRoot.visible = true;
        },
    );
};

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render Loop ───────────────────────────────────────────────────────────────

const clock = new THREE.Timer();
let swimT = 0;

const _dir       = new THREE.Vector3();
const _lerpVec   = new THREE.Vector3();
const _frozenPos = new THREE.Vector3();

const animate = () => {
    requestAnimationFrame(animate);
    const delta   = clock.getDelta();
    const elapsed = clock.getElapsed();

    // ── AnimationMixer tick ───────────────────────────────────────────────
    // Deforms bones inside gltf.scene every frame.
    // Completely independent of swim path — operates at a different hierarchy level.
    if (mixer) mixer.update(delta);

    // ── Swim path ─────────────────────────────────────────────────────────
    if (!isSelected) {
        swimT += delta * SWIM_SPEED;
    } else {
        _frozenPos.copy(swimPos(frozenSwimT));
    }

    const blendTarget = isSelected ? 1 : 0;
    showcaseBlend += (blendTarget - showcaseBlend) * (delta * 2.2);
    showcaseBlend  = THREE.MathUtils.clamp(showcaseBlend, 0, 1);
    const eased    = easeInOut(showcaseBlend);

    // skinModel is always the reference — all layers follow it
    const refModel = skinModel ?? sharkRoot;

    if (refModel?.position) {
        const sp = isSelected ? _frozenPos : swimPos(swimT);
        _lerpVec.lerpVectors(sp, SHOWCASE_POS, eased);
        refModel.position.copy(_lerpVec);

        if (!isSelected) {
            const look = swimPos(swimT + 0.025);
            _dir.copy(look).sub(sp).normalize();
            // refModel.rotation.set(
            //     Math.asin(THREE.MathUtils.clamp(-_dir.y, -1, 1)),
            //     Math.atan2(_dir.x, _dir.z),
            //     Math.sin(swimT * 1.8) * 0.09,
            //     'YXZ',
            // );
        } else {
            showcaseRotY += delta * 0.38;
            refModel.rotation.x = THREE.MathUtils.lerp(refModel.rotation.x, 0, delta * 2);
            refModel.rotation.y = showcaseRotY;
            refModel.rotation.z = THREE.MathUtils.lerp(refModel.rotation.z, 0, delta * 2);
        }

        // ── Sync all visible layer OBJs to the skin's world transform ─────
        //
        // Each layer had applyCanonical() called on load, so its local
        // position is already canonicalNegCenter. The world offset is just
        // the skin's current position. Adding them gives the correct world
        // position for every layer — keeping all meshes exactly overlaid.
        // Object.values(layerModels).forEach(layerObj => {
        //     if (!layerObj.visible) return;
        //     layerObj.position.set(
        //         canonicalNegCenter.x + refModel.position.x,
        //         canonicalNegCenter.y + refModel.position.y,
        //         canonicalNegCenter.z + refModel.position.z,
        //     );
        //     layerObj.rotation.copy(refModel.rotation);
        //     layerObj.scale.setScalar(canonicalScale);
        // });
    }

    // ── Placeholder tail wag ──────────────────────────────────────────────
    if (sharkRoot?.visible && tailGroup && sharkPivot) {
        tailGroup.rotation.y  = Math.sin(elapsed * 2.7) * 0.44;
        sharkPivot.rotation.y = Math.sin(elapsed * 2.7 - 0.7) * 0.06;
    }

    // ── Caustic lights ────────────────────────────────────────────────────
    causticLights.forEach(({ light, phase, base, speed }) => {
        light.position.x = Math.sin(elapsed * speed + phase) * 9;
        light.position.z = Math.cos(elapsed * speed * 0.75 + phase) * 9;
        light.intensity  = base + Math.sin(elapsed * 1.8 + phase) * 0.55;
    });

    specimenSpot.intensity = THREE.MathUtils.lerp(specimenSpot.intensity, isSelected ? 5.5 : 0, delta * 2.5);
    sideFill.intensity     = THREE.MathUtils.lerp(sideFill.intensity,     isSelected ? 3.0 : 0, delta * 2.5);

    const fade = Math.max(0, (eased - 0.15) / 0.85);
    ringMats[0].opacity = fade * (0.38 + Math.sin(elapsed * 1.3) * 0.06);
    ringMats[1].opacity = fade * (0.26 + Math.sin(elapsed * 2.1) * 0.10);
    ringMats[2].opacity = fade * 0.16;
    stageRings[0].rotation.y = elapsed * -0.22;
    stageRings[1].rotation.y = elapsed *  0.55;
    stageRings[2].rotation.y = elapsed * -0.10;

    for (let i = 0; i < surfacePositions.count; i++) {
        const x = surfacePositions.getX(i), z = surfacePositions.getZ(i);
        surfacePositions.setY(i,
            surfaceOrigY[i]
            + Math.sin(x * 0.45 + elapsed * 0.9)  * 0.28
            + Math.cos(z * 0.35 + elapsed * 0.65) * 0.18,
        );
    }
    surfacePositions.needsUpdate = true;
    surfaceGeo.computeVertexNormals();

    const pos3 = pGeo.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        pos3[i * 3 + 1] += pSpeed[i];
        if (pos3[i * 3 + 1] > 18) pos3[i * 3 + 1] = -18;
    }
    pGeo.attributes.position.needsUpdate = true;

    camera.position.x += Math.sin(elapsed * 0.12) * 0.0012;
    camera.position.y += Math.sin(elapsed * 0.17) * 0.0008;

    controls.update();
    renderer.render(scene, camera);
};

// ─── Init ─────────────────────────────────────────────────────────────────────

const init = () => {
    const mountEl = document.getElementById('panelMount');
    if (mountEl) createRoot(mountEl).render(<App />);

    // OBJ specimen (current):
    //loadOBJ('/assets/models/greatWhite/gwSkin.obj');

    // GLTF animated specimen (swap in when ready — comment out loadOBJ above):
    loadGLTF('/assets/models/greatWhite/Sharkswim2.glb');

    //loadFBX('/assets/models/greatWhite/Sharkswim.fbx');

    animate();
};

window.onload = init;