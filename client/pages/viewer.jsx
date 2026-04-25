/**
 * viewer.jsx — Elasmobranch Atlas
 *
 * Three.js underwater scene + React info panel.
 * - AnimationMixer drives GLTF swim-cycle clips independently of the swim path
 * - Multi-layer: any combination of OBJ layers can be visible simultaneously
 * - Canonical transform: all layers share the scale/offset computed from the
 *   skin bounding box, keeping every layer perfectly aligned in 3D space
 * - CSS2DRenderer organ labels: click any sub-mesh to highlight and label it
 * - ORGAN_DATA and SPECIMEN_CATALOG loaded from JSON at startup
 *
 * ── KEY FIX ──────────────────────────────────────────────────────────────────
 * THREE.Timer requires clock.update() at the TOP of each animate() frame,
 * before getDelta() / getElapsed() are called. Without it both always return
 * 0: showcaseBlend never advances, the model never lerps to SHOWCASE_POS,
 * and stage rings stay at opacity 0 forever.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const React      = require('react');
const { useState, useEffect, useCallback } = React;
const { createRoot } = require('react-dom/client');

import * as THREE from 'three';
import { OrbitControls }   from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader }      from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader }       from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader }       from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader }       from 'three/examples/jsm/loaders/FBXLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// ─── Data ─────────────────────────────────────────────────────────────────────
// Populated async in init() before any model loads.
// JSON files should be served at:
//   /assets/data/organData.json
//   /assets/data/specimenCatalog.json

let ORGAN_DATA       = {};
let SPECIMEN_CATALOG = {};

// ─── React <-> Three.js Bridge ────────────────────────────────────────────────

let _setPanelOpen    = null;
let _setPanelData    = null;
let _setActiveLayers = null;

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
    const [activeLayers, setActiveLayers] = useState(new Set(['skin']));

    useEffect(() => {
        _setPanelOpen    = setIsOpen;
        _setPanelData    = setPanelData;
        _setActiveLayers = (nextSet) => setActiveLayers(new Set(nextSet));
    }, []);

    useEffect(() => {
        if (isOpen) setActiveLayers(new Set(['skin']));
    }, [isOpen]);

    const handleLayerToggle = useCallback((layerKey) => {
        setActiveLayers(prev => {
            const next = new Set(prev);
            if (next.has(layerKey)) {
                if (next.size === 1) return prev;
                next.delete(layerKey);
                toggleLayer(layerKey, false);
            } else {
                next.add(layerKey);
                toggleLayer(layerKey, true);
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

// ─── CSS2D Label Renderer ─────────────────────────────────────────────────────

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.cssText =
    'position:absolute;top:0;left:0;pointer-events:none;z-index:10;';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x00060f);

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
    new THREE.MeshBasicMaterial({ color: 0x2a8ab8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0x55c5f0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0x0d4466, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
];
const stageRings = [
    new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.025, 4, 80), ringMats[0]),
    new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.018, 4, 60), ringMats[1]),
    new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.012, 4, 80), ringMats[2]),
];
stageRings.forEach(r => {
    r.rotation.x = Math.PI / 2;
    // Sit at SHOWCASE_POS XZ, slightly below the model centre so they
    // encircle the body rather than appearing at mid-air above the shark
    r.position.set(SHOWCASE_POS.x, SHOWCASE_POS.y - 1.2, SHOWCASE_POS.z);
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

let canonicalScale     = 1;
let canonicalNegCenter = new THREE.Vector3();

const computeCanonical = (object) => {
    const box    = new THREE.Box3().setFromObject(object);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    canonicalScale = 3 / Math.max(size.x, size.y, size.z);
    canonicalNegCenter.copy(center).multiplyScalar(-canonicalScale);
};

const applyCanonical = (object) => {
    object.scale.setScalar(canonicalScale);
    object.position.copy(canonicalNegCenter);
};

// ─── Model State ──────────────────────────────────────────────────────────────

let skinModel       = null;   // the pivot Group — swim path drives this
let skinMesh        = null;   // gltf.scene inside the pivot — ONLY the skin geometry.
                               // Toggling skin visibility must use skinMesh, NOT skinModel:
                               // skinModel is the parent of all layer children, so
                               // skinModel.visible = false would hide every layer too.
let layerModels     = {};
let currentFileName = null;
let mixer           = null;

// Invisible proxy mesh — reliable raycast target for animated SkinnedMesh GLTF.
// SkinnedMesh.raycast() uses the geometry bounding sphere in rest-pose space,
// which never matches the live animated position. A plain SphereGeometry
// parented to the pivot always raycasts correctly at the model's true location.
let clickProxy = null;

// ─── Organ Highlight State ────────────────────────────────────────────────────

let selectedOrganMesh     = null;
let originalOrganMaterial = null;
let activeLabelObject     = null;

const HIGHLIGHT_MAT = new THREE.MeshStandardMaterial({
    color:       0x00d4ff,
    emissive:    new THREE.Color(0x003a55),
    roughness:   0.25,
    metalness:   0.15,
    side:        THREE.DoubleSide,
    transparent: true,
    opacity:     0.92,
});

// ─── Label Helpers ────────────────────────────────────────────────────────────

const showOrganLabel = (mesh, worldPoint) => {
    hideOrganLabel();

    const data  = ORGAN_DATA[mesh.name];
    const label = data?.label       ?? mesh.name ?? 'Unknown Structure';
    const sub   = data?.sublabel    ?? mesh.userData.layerKey ?? '';
    const desc  = data?.description ?? 'No anatomical data available for this structure.';

    const div = document.createElement('div');
    div.className = 'organ-label';
    div.innerHTML = `
        <div class="ol-header">
            <div class="ol-name">${label}</div>
            ${sub ? `<div class="ol-sub">${sub}</div>` : ''}
        </div>
        <div class="ol-desc">${desc}</div>
        <div class="ol-mesh-id">${mesh.name || '—'}</div>
    `;

    const labelObj = new CSS2DObject(div);
    labelObj.position.copy(worldPoint);
    scene.add(labelObj);
    activeLabelObject = labelObj;
};

const hideOrganLabel = () => {
    if (!activeLabelObject) return;
    scene.remove(activeLabelObject);
    activeLabelObject.element?.remove();
    activeLabelObject = null;
};

// ─── Organ Selection ──────────────────────────────────────────────────────────

const selectOrgan = (mesh, worldPoint) => {
    if (selectedOrganMesh && originalOrganMaterial) {
        selectedOrganMesh.material = originalOrganMaterial;
    }
    selectedOrganMesh     = mesh;
    originalOrganMaterial = mesh.material;
    mesh.material         = HIGHLIGHT_MAT;
    showOrganLabel(mesh, worldPoint);
};

const deselectOrgan = () => {
    if (selectedOrganMesh && originalOrganMaterial) {
        selectedOrganMesh.material = originalOrganMaterial;
        selectedOrganMesh          = null;
        originalOrganMaterial      = null;
    }
    hideOrganLabel();
};

// ─── Layer Toggle ─────────────────────────────────────────────────────────────

const toggleLayer = (layerKey, visible) => {
    if (layerKey === 'skin') {
        // Use skinMesh (gltf.scene), NOT skinModel (the pivot).
        // The pivot is the parent of every layer child — hiding it hides them all.
        if (skinMesh) skinMesh.visible = visible;
        return;
    }

    if (!visible) {
        if (layerModels[layerKey]) {
            if (selectedOrganMesh?.userData.layerKey === layerKey) deselectOrgan();
            layerModels[layerKey].visible = false;
        }
        return;
    }

    if (layerModels[layerKey]) {
        layerModels[layerKey].visible = true;
        return;
    }

    const entry    = SPECIMEN_CATALOG[currentFileName];
    const layerDef = entry?.layers?.[layerKey];
    if (!layerDef?.obj) return;

    setStatus(`Loading ${layerDef.label}…`);

    const isGLB = layerDef.obj.toLowerCase().endsWith('.glb');

    if (isGLB) {
        // ── GLB layer ─────────────────────────────────────────────────────
        new GLTFLoader().load(
            layerDef.obj,
            (gltf) => {
                const root = gltf.scene;
                root.traverse(child => {
                    if (!child.isMesh) return;
                    child.castShadow        = true;
                    child.receiveShadow     = true;
                    child.userData.layerKey = layerKey;
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => { m.side = THREE.DoubleSide; });
                });
                applyCanonical(root);
                layerModels[layerKey] = root;
                root.visible = true;
                skinModel.add(root);
                const names = [];
                root.traverse(c => { if (c.isMesh && c.name) names.push(c.name); });
                if (names.length) console.log(`[${layerKey}] mesh names →`, names);
                setStatus('');
            },
            xhr => xhr.total
                ? setStatus(`${layerDef.label} ${Math.round((xhr.loaded / xhr.total) * 100)}%`)
                : setStatus(`${layerDef.label} loading…`),
            err => { console.error(err); setStatus(`Failed to load ${layerDef.label}.`, true); },
        );
    } else {
        // ── OBJ layer (with optional MTL) ─────────────────────────────────
        const doLoad = (materials) => {
            const loader = new OBJLoader();
            if (materials) loader.setMaterials(materials);
            loader.load(
                layerDef.obj,
                (obj) => {
                    obj.traverse(child => {
                        if (!child.isMesh) return;
                        child.castShadow        = true;
                        child.receiveShadow     = true;
                        child.userData.layerKey = layerKey;
                        child.geometry.computeVertexNormals();
                        if (!materials) {
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x8aaabb, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide,
                            });
                        } else {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(m => { m.side = THREE.DoubleSide; });
                        }
                    });
                    applyCanonical(obj);
                    layerModels[layerKey] = obj;
                    obj.visible = true;
                    skinModel.add(obj);
                    const names = [];
                    obj.traverse(c => { if (c.isMesh && c.name) names.push(c.name); });
                    if (names.length) console.log(`[${layerKey}] mesh names →`, names);
                    setStatus('');
                },
                xhr => xhr.total
                    ? setStatus(`${layerDef.label} ${Math.round((xhr.loaded / xhr.total) * 100)}%`)
                    : setStatus(`${layerDef.label} loading…`),
                err => { console.error(err); setStatus(`Failed to load ${layerDef.label}.`, true); },
            );
        };

        if (layerDef.mtl) {
            new MTLLoader().load(layerDef.mtl, mats => { mats.preload(); doLoad(mats); });
        } else {
            doLoad(null);
        }
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

    Object.values(layerModels).forEach(m => { m.visible = false; });
    if (skinMesh) skinMesh.visible = true;
    deselectOrgan();

    document.getElementById('sceneDim')?.classList.add('active');
    badge?.classList.add('visible');
    document.getElementById('hint')?.classList.add('gone');
    document.querySelector('.hud-title')?.style.setProperty('opacity', '0.15');
};

const deselectSpecimen = () => {
    if (!isSelected) return;
    isSelected = false;

    Object.values(layerModels).forEach(m => { m.visible = false; });
    if (skinMesh) skinMesh.visible = true;
    deselectOrgan();

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

canvas.addEventListener('pointerdown', e => {
    ptrDown.x = e.clientX;
    ptrDown.y = e.clientY;
    didDrag   = false;
});

canvas.addEventListener('pointermove', e => {
    const dx = e.clientX - ptrDown.x, dy = e.clientY - ptrDown.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) didDrag = true;
});

canvas.addEventListener('pointerup', e => {
    if (didDrag) return;

    mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (document.getElementById('panelMount')?.contains(e.target)) return;

    // ── Organ picking ─────────────────────────────────────────────────────
    if (isSelected) {
        const layerMeshes = [];
        Object.entries(layerModels).forEach(([layerKey, layerObj]) => {
            if (!layerObj.visible) return;
            layerObj.traverse(child => {
                if (child.isMesh) { child.userData.layerKey = layerKey; layerMeshes.push(child); }
            });
        });
        if (layerMeshes.length > 0) {
            const hits = raycaster.intersectObjects(layerMeshes, false);
            if (hits.length > 0) { selectOrgan(hits[0].object, hits[0].point); return; }
            deselectOrgan();
        }
    }

    // ── Specimen picking ──────────────────────────────────────────────────
    const target = skinModel ?? sharkRoot;
    if (!target) return;

    const pickTargets = clickProxy
        ? [clickProxy]
        : (() => { const m = []; target.traverse(c => { if (c.isMesh) m.push(c); }); return m; })();

    if (raycaster.intersectObjects(pickTargets, false).length > 0) {
        selectSpecimen();
    } else {
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

// ─── Scene Reset Helper ───────────────────────────────────────────────────────

const _clearScene = () => {
    if (sharkRoot)  sharkRoot.visible = false;
    if (skinModel) { scene.remove(skinModel); skinModel = null; }
    skinMesh        = null;
    Object.values(layerModels).forEach(m => scene.remove(m));
    layerModels     = {};
    currentFileName = null;
    clickProxy      = null;
    if (mixer) { mixer.stopAllAction(); mixer = null; }
    deselectOrgan();
};

// ─── Model Loaders ────────────────────────────────────────────────────────────

export const loadOBJ = (objUrl, mtlUrl = null) => {
    setStatus('Loading model…');
    _clearScene();

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
                    child.geometry.computeVertexNormals();
                    if (!materials) child.material = new THREE.MeshStandardMaterial({
                        color: 0x3f6a88, roughness: 0.55, metalness: 0.12, side: THREE.DoubleSide,
                    });
                });
                computeCanonical(obj);
                applyCanonical(obj);
                skinModel       = obj;
                currentFileName = objUrl.split('/').pop();
                scene.add(skinModel);
                setStatus('');
            },
            xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
            err => { console.error(err); setStatus('Failed to load model.', true); if (sharkRoot) sharkRoot.visible = true; },
        );
    };

    if (mtlUrl) new MTLLoader().load(mtlUrl, mats => { mats.preload(); doLoad(mats); });
    else doLoad(null);
};

export const loadFBX = (url) => {
    setStatus('Loading model…');
    _clearScene();

    new FBXLoader().load(
        url,
        (fbx) => {
            fbx.traverse(child => {
                if (child.isMesh)        { child.castShadow = true; child.receiveShadow = true; }
                if (child.isSkinnedMesh) { child.frustumCulled = false; }
            });
            const pivot = new THREE.Group();
            computeCanonical(fbx);
            applyCanonical(fbx);
            fbx.scale.setScalar(0.004);
            pivot.add(fbx);
            scene.add(pivot);
            skinModel       = pivot;
            currentFileName = url.split('/').pop();
            if (fbx.animations.length > 0) {
                mixer = new THREE.AnimationMixer(fbx);
                const action = mixer.clipAction(fbx.animations[0]);
                action.play();
                action.timeScale = 3;
            } else {
                console.warn('[FBXLoader] No animation clips found in', url);
            }
            setStatus('');
        },
        xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
        err => { console.error(err); setStatus('Failed to load model.', true); if (sharkRoot) sharkRoot.visible = true; },
    );
};

export const loadGLTF = (url) => {
    setStatus('Loading model…');
    _clearScene();

    new GLTFLoader().load(
        url,
        (gltf) => {
            const pivot = new THREE.Group();

            gltf.scene.traverse(child => {
                if (child.isMesh && child.material?.map)
                    console.log('texture colorSpace:', child.material.map.colorSpace);
                if (child.isMesh)        { child.castShadow = true; child.receiveShadow = true; }
                if (child.isSkinnedMesh) { child.frustumCulled = false; }
            });

            computeCanonical(gltf.scene);
            applyCanonical(gltf.scene);
            pivot.add(gltf.scene);
            skinMesh = gltf.scene; // reference to skin geometry only — not the pivot

            // Plain sphere proxy — raycasts correctly regardless of skinning.
            // Sized to wrap the canonical 3-unit model (radius 1.6 ≈ half-height).
            const proxy = new THREE.Mesh(
                new THREE.SphereGeometry(1.6, 8, 8),
                new THREE.MeshBasicMaterial({ visible: false }),
            );
            proxy.userData.isClickProxy = true;
            pivot.add(proxy);
            clickProxy = proxy;

            scene.add(pivot);
            skinModel       = pivot;
            currentFileName = url.split('/').pop();
            console.log('filename:', currentFileName);

            if (gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(gltf.scene);
                console.log('Available animations:', gltf.animations.map(a => a.name));
                const action = mixer.clipAction(gltf.animations[0]);
                action.setLoop(THREE.LoopRepeat);
                action.timeScale = 3;
                action.play();
                console.log(
                    `[AnimationMixer] Playing "${gltf.animations[0].name}" — ` +
                    `${Math.round(gltf.animations[0].duration * 24)} frames at 24 fps`
                );
            } else {
                console.warn('[AnimationMixer] No animation clips found in', url);
            }

            setStatus('');
        },
        xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
        err => { console.error(err); setStatus('Failed to load model.', true); if (sharkRoot) sharkRoot.visible = true; },
    );
};

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render Loop ───────────────────────────────────────────────────────────────

const clock = new THREE.Timer();
let swimT = 0;

const _dir       = new THREE.Vector3();
const _lerpVec   = new THREE.Vector3();
const _frozenPos = new THREE.Vector3();

const animate = () => {
    requestAnimationFrame(animate);

    // ── clock.update() MUST be first ─────────────────────────────────────
    // THREE.Timer stores time internally and only updates its registers when
    // update() is explicitly called. getDelta() and getElapsed() return 0
    // until the first update() — and return stale values if update() is
    // skipped on subsequent frames. Always call it before anything else.
    clock.update();
    const delta   = clock.getDelta();
    const elapsed = clock.getElapsed();

    if (mixer) mixer.update(delta);

    if (!isSelected) {
        swimT += delta * SWIM_SPEED;
    } else {
        _frozenPos.copy(swimPos(frozenSwimT));
    }

    const blendTarget = isSelected ? 1 : 0;
    showcaseBlend += (blendTarget - showcaseBlend) * (delta * 2.2);
    showcaseBlend  = THREE.MathUtils.clamp(showcaseBlend, 0, 1);
    const eased    = easeInOut(showcaseBlend);

    const refModel = skinModel ?? sharkRoot;

    if (refModel?.position) {
        const sp = isSelected ? _frozenPos : swimPos(swimT);
        _lerpVec.lerpVectors(sp, SHOWCASE_POS, eased);
        refModel.position.copy(_lerpVec);

        if (!isSelected) {
            const look = swimPos(swimT + 0.025);
            _dir.copy(look).sub(sp).normalize();
        } else {
            showcaseRotY += delta * 0.38;
            refModel.rotation.x = THREE.MathUtils.lerp(refModel.rotation.x, 0, delta * 2);
            refModel.rotation.y = showcaseRotY;
            refModel.rotation.z = THREE.MathUtils.lerp(refModel.rotation.z, 0, delta * 2);
        }
    }

    if (sharkRoot?.visible && tailGroup && sharkPivot) {
        tailGroup.rotation.y  = Math.sin(elapsed * 2.7) * 0.44;
        sharkPivot.rotation.y = Math.sin(elapsed * 2.7 - 0.7) * 0.06;
    }

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
    labelRenderer.render(scene, camera);
};

// ─── Init ─────────────────────────────────────────────────────────────────────
// Fetch both JSON catalogs first so ORGAN_DATA and SPECIMEN_CATALOG are ready
// before any model or layer loads. The await keeps everything sequential;
// a fetch failure falls back to empty objects and logs a warning.

const init = async () => {
    try {
        [ORGAN_DATA, SPECIMEN_CATALOG] = await Promise.all([
            fetch('/assets/data/sharkorgandata.json').then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch('/assets/data/specimencatalog.json').then(r => { if (!r.ok) throw r; return r.json(); }),
        ]);
        console.log(
            `[Atlas] Data loaded — ${Object.keys(SPECIMEN_CATALOG).length} specimen(s), ` +
            `${Object.keys(ORGAN_DATA).length} organ(s)`
        );
    } catch (err) {
        console.warn('[Atlas] Could not load data JSON — falling back to empty catalogs.', err);
    }

    const mountEl = document.getElementById('panelMount');
    if (mountEl) createRoot(mountEl).render(<App />);

    loadGLTF('/assets/models/greatWhite/shark_skin.glb');

    animate();
};

window.onload = init;