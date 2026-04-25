/**
 * viewer.jsx — Elasmobranch Atlas
 *
 * Multi-specimen architecture: each loaded model owns its own state object
 * (pivot, skinMesh, clickProxy, layerModels, mixer, canonicalScale, …).
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
    const LAYER_KEYS = Object.keys(data.layers ?? {});
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

const warmFill = new THREE.DirectionalLight(0xfff5e0, 2.5);
warmFill.position.set(5, 4, 10);
scene.add(warmFill);

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
    r.position.set(SHOWCASE_POS.x, SHOWCASE_POS.y - 1.2, SHOWCASE_POS.z);
    scene.add(r);
});

// ── Procedural Placeholder ────────────────────────────────────────────────────

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

// ─── Per-Specimen State ───────────────────────────────────────────────────────
//
// Each loaded model owns its own state object. Nothing about one specimen
// can be overwritten by loading another.
//
//   specimens   — Map<fileName, specimenState>
//   activeSpec  — the currently showcased specimen, or null

const makeSpecimenState = (fileName, swimOffset = 0) => ({
    fileName,
    // Three.js objects
    pivot:          null,   // Group — swim path drives position/rotation of this
    skinMesh:       null,   // gltf.scene or OBJ root — ONLY the skin geometry
    clickProxy:     null,   // invisible sphere for SkinnedMesh raycast
    layerModels:    {},     // { layerKey: Object3D }
    mixer:          null,   // AnimationMixer, or null for OBJ
    // Canonical transform (computed from skin bounding box)
    canonicalScale: 1,
    canonicalNeg:   new THREE.Vector3(),
    // Swim state
    swimOffset,             // phase offset so specimens don't overlap on path
    showcaseBlend:  0,      // 0 = swimming freely, 1 = at SHOWCASE_POS
    frozenSwimT:    0,      // swimT value at moment of selection
});

const specimens  = new Map();   // fileName -> specimenState
let   activeSpec = null;        // currently showcased specimen (or null)

// Per-specimen canonical helpers
const computeCanonical = (spec, object) => {
    const box    = new THREE.Box3().setFromObject(object);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    spec.canonicalScale = 3 / Math.max(size.x, size.y, size.z);
    spec.canonicalNeg.copy(center).multiplyScalar(-spec.canonicalScale);
};

const applyCanonical = (spec, object) => {
    object.scale.setScalar(spec.canonicalScale);
    object.position.copy(spec.canonicalNeg);
};

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

// ─── Layer Material Palette ───────────────────────────────────────────────────

const LAYER_MATS = {
    muscle: new THREE.MeshStandardMaterial({
        color: 0xc0392b, roughness: 0.65, metalness: 0.05,
        side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    }),
    organs: new THREE.MeshStandardMaterial({
        color: 0x8e44ad, roughness: 0.5, metalness: 0.05,
        side: THREE.DoubleSide, transparent: true, opacity: 0.92,
    }),
    circulatory: new THREE.MeshStandardMaterial({
        color: 0xe74c3c, emissive: new THREE.Color(0x3a0000),
        roughness: 0.35, metalness: 0.1,
        side: THREE.DoubleSide, transparent: true, opacity: 0.88,
    }),
    skeleton: new THREE.MeshStandardMaterial({
        color: 0xe8d5a3, roughness: 0.55, metalness: 0.08,
        side: THREE.DoubleSide, transparent: true, opacity: 0.97,
    }),
};

// ─── Label Helpers ────────────────────────────────────────────────────────────

const showOrganLabel = (mesh, worldPoint) => {
    hideOrganLabel();
    const data  = ORGAN_DATA[mesh.name];
    const label = data?.label       ?? mesh.name ?? 'Unknown Structure';
    const sub   = data?.sublabel    ?? mesh.userData.layerKey ?? '';
    const desc  = data?.description ?? 'No anatomical data available for this structure.';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:absolute;pointer-events:none;';

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
    wrapper.appendChild(div);

    const labelObj = new CSS2DObject(wrapper);
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
    if (!activeSpec) return;

    if (layerKey === 'skin') {
        // Target skinMesh (just the geometry), NOT the pivot (parent of layers).
        if (activeSpec.skinMesh) activeSpec.skinMesh.visible = visible;
        return;
    }

    if (!visible) {
        if (activeSpec.layerModels[layerKey]) {
            if (selectedOrganMesh?.userData.layerKey === layerKey) deselectOrgan();
            activeSpec.layerModels[layerKey].visible = false;
        }
        return;
    }

    if (activeSpec.layerModels[layerKey]) {
        activeSpec.layerModels[layerKey].visible = true;
        return;
    }

    const entry    = SPECIMEN_CATALOG[activeSpec.fileName];
    const layerDef = entry?.layers?.[layerKey];
    if (!layerDef?.obj) return;

    setStatus(`Loading ${layerDef.label}…`);

    const isGLB = layerDef.obj.toLowerCase().endsWith('.glb');

    // Capture spec so async callbacks always reference the right specimen
    const spec = activeSpec;

    if (isGLB) {
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
                applyCanonical(spec, root);
                spec.layerModels[layerKey] = root;
                root.visible = true;
                spec.pivot.add(root);
                const names = [];
                root.traverse(c => { if (c.isMesh && c.name) names.push(c.name); });
                if (names.length) console.log(`[${layerKey}] mesh names →`, names);
                setStatus('');
            },
            xhr => xhr.total ? setStatus(`${layerDef.label} ${Math.round((xhr.loaded / xhr.total) * 100)}%`) : null,
            err => { console.error(err); setStatus(`Failed to load ${layerDef.label}.`, true); },
        );
    } else {
        const doLoad = (materials) => {
            const loader = new OBJLoader();
            if (materials) loader.setMaterials(materials);
            loader.load(
                layerDef.obj,
                (obj) => {
                    const paletteMat = LAYER_MATS[layerKey] ?? new THREE.MeshStandardMaterial({
                        color: 0x8aaabb, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide,
                    });
                    obj.traverse(child => {
                        if (!child.isMesh) return;
                        child.castShadow        = true;
                        child.receiveShadow     = true;
                        child.userData.layerKey = layerKey;
                        child.geometry.computeVertexNormals();
                        const hasMtlTexture = materials && (() => {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            return mats.some(m => m.map || m.normalMap || m.roughnessMap);
                        })();
                        if (hasMtlTexture) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(m => { m.side = THREE.DoubleSide; });
                        } else {
                            child.material = paletteMat;
                        }
                    });
                    applyCanonical(spec, obj);
                    spec.layerModels[layerKey] = obj;
                    obj.visible = true;
                    spec.pivot.add(obj);
                    const names = [];
                    obj.traverse(c => { if (c.isMesh && c.name) names.push(c.name); });
                    if (names.length) console.log(`[${layerKey}] mesh names →`, names);
                    setStatus('');
                },
                xhr => xhr.total ? setStatus(`${layerDef.label} ${Math.round((xhr.loaded / xhr.total) * 100)}%`) : null,
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

// ─── Specimen Selection ───────────────────────────────────────────────────────

const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

const selectSpecimen = async (spec) => {
    if (activeSpec === spec) return;

    // Deselect any previous without running the full UI teardown
    if (activeSpec) {
        Object.values(activeSpec.layerModels).forEach(m => { m.visible = false; });
        if (activeSpec.skinMesh) activeSpec.skinMesh.visible = true;
    }
    deselectOrgan();

    activeSpec           = spec;
    spec.frozenSwimT     = swimT + spec.swimOffset;

    // Load this specimen's organ data
    const entry = SPECIMEN_CATALOG[spec.fileName];
    if (entry?.organDataUrl) {
        try {
            ORGAN_DATA = await fetch(entry.organDataUrl)
                .then(r => { if (!r.ok) throw r; return r.json(); });
            console.log(`[Atlas] Organ data loaded for ${entry.name} — ${Object.keys(ORGAN_DATA).length} entries`);
        } catch (err) {
            console.warn('[Atlas] Could not load organ data:', err);
            ORGAN_DATA = {};
        }
    } else {
        ORGAN_DATA = {};
    }

    const catalogEntry = entry ?? {
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
    if (badge) badge.querySelector('.sb-latin').textContent = catalogEntry.latin;

    _setPanelData?.(catalogEntry);
    _setPanelOpen?.(true);
    _setActiveLayers?.(new Set(['skin']));

    // Reset layers — hide all, show only skin
    Object.values(spec.layerModels).forEach(m => { m.visible = false; });
    if (spec.skinMesh) spec.skinMesh.visible = true;

    document.getElementById('sceneDim')?.classList.add('active');
    badge?.classList.add('visible');
    document.getElementById('hint')?.classList.add('gone');
    document.querySelector('.hud-title')?.style.setProperty('opacity', '0.15');
};

const deselectSpecimen = () => {
    if (!activeSpec) return;

    Object.values(activeSpec.layerModels).forEach(m => { m.visible = false; });
    if (activeSpec.skinMesh) activeSpec.skinMesh.visible = true;
    deselectOrgan();

    activeSpec = null;

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
    ptrDown.x = e.clientX; ptrDown.y = e.clientY; didDrag = false;
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
    if (activeSpec) {
        const layerMeshes = [];
        Object.entries(activeSpec.layerModels).forEach(([layerKey, layerObj]) => {
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

    // ── Specimen picking — iterate all loaded specimens ────────────────────
    for (const [, spec] of specimens) {
        if (!spec.pivot) continue;

        const pickTargets = spec.clickProxy
            ? [spec.clickProxy]
            : (() => {
                const m = [];
                spec.skinMesh?.traverse(c => { if (c.isMesh) m.push(c); });
                return m;
            })();

        if (raycaster.intersectObjects(pickTargets, false).length > 0) {
            selectSpecimen(spec);
            return;
        }
    }

    deselectSpecimen();
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
// Each loader creates or replaces the specimen entry in the Map.
// No global state is touched — specimens are independent.

export const loadGLTF = (url, swimOffset = 0) => {
    const fileName = url.split('/').pop();
    setStatus('Loading model…');
    if (sharkRoot) sharkRoot.visible = false;

    // Remove existing specimen if reloading same file
    if (specimens.has(fileName)) {
        const old = specimens.get(fileName);
        if (old.pivot) scene.remove(old.pivot);
        if (old.mixer) old.mixer.stopAllAction();
        if (activeSpec === old) { activeSpec = null; }
    }

    const spec = makeSpecimenState(fileName, swimOffset);
    specimens.set(fileName, spec);

    new GLTFLoader().load(
        url,
        (gltf) => {
            const pivot = new THREE.Group();

            gltf.scene.traverse(child => {
                if (child.isMesh)        { child.castShadow = true; child.receiveShadow = true; }
                if (child.isSkinnedMesh) { child.frustumCulled = false; }
            });

            computeCanonical(spec, gltf.scene);
            applyCanonical(spec, gltf.scene);
            pivot.add(gltf.scene);
            spec.skinMesh = gltf.scene;

            const proxy = new THREE.Mesh(
                new THREE.SphereGeometry(1.6, 8, 8),
                new THREE.MeshBasicMaterial({ visible: false }),
            );
            proxy.userData.isClickProxy = true;
            pivot.add(proxy);
            spec.clickProxy = proxy;

            scene.add(pivot);
            spec.pivot = pivot;

            if (gltf.animations.length > 0) {
                spec.mixer = new THREE.AnimationMixer(gltf.scene);
                const action = spec.mixer.clipAction(gltf.animations[0]);
                action.setLoop(THREE.LoopRepeat);
                action.timeScale = 3;
                action.play();
                console.log(`[AnimationMixer] "${gltf.animations[0].name}" — ${gltf.animations.length} clip(s)`);
            }

            console.log(`[Atlas] GLTF loaded: ${fileName}`);
            setStatus('');
        },
        xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
        err => { console.error(err); setStatus('Failed to load model.', true); },
    );
};

export const loadOBJ = (url, mtlUrl = null, swimOffset = 0) => {
    const fileName = url.split('/').pop();
    setStatus('Loading model…');
    if (sharkRoot) sharkRoot.visible = false;
 
    if (specimens.has(fileName)) {
        const old = specimens.get(fileName);
        if (old.pivot) scene.remove(old.pivot);
        if (activeSpec === old) { activeSpec = null; }
    }
 
    const spec = makeSpecimenState(fileName, swimOffset);
    specimens.set(fileName, spec);
 
    const doLoad = (materials) => {
        const loader = new OBJLoader();
        if (materials) loader.setMaterials(materials);
        loader.load(
            url,
            (obj) => {
                obj.traverse(child => {
                    if (!child.isMesh) return;
                    child.castShadow    = true;
                    child.receiveShadow = true;
                    child.geometry.computeVertexNormals();
 
                    if (!materials) {
                        // No MTL — use a neutral visible material
                        child.material = new THREE.MeshStandardMaterial({
                            color:     0x7aabb8,
                            roughness: 0.55,
                            metalness: 0.08,
                            side:      THREE.DoubleSide,
                        });
                    } else {
                        const mats = Array.isArray(child.material)
                            ? child.material
                            : [child.material];
                        mats.forEach(m => {
                            m.side      = THREE.DoubleSide;
                            // Cap metalness — high values need an envMap to look right
                            if (m.metalness > 0.25) m.metalness = 0.15;
                            // Ensure roughness is in a visible mid-range
                            if (m.roughness < 0.3)  m.roughness = 0.45;
                            // Clear any zero-opacity or near-black base colour
                            if (m.color) {
                                const { r, g, b } = m.color;
                                if (r + g + b < 0.15) m.color.setHSL(0.55, 0.3, 0.45);
                            }
                            m.needsUpdate = true;
                        });
                    }
                });
 
                const pivot = new THREE.Group();
                computeCanonical(spec, obj);
                applyCanonical(spec, obj);
                pivot.add(obj);
                spec.skinMesh = obj;   // OBJ root IS the skin geometry
 
                scene.add(pivot);
                spec.pivot = pivot;
 
                console.log(`[Atlas] OBJ loaded: ${fileName}`);
                setStatus('');
            },
            xhr => setStatus(`Loading… ${Math.round((xhr.loaded / xhr.total) * 100)}%`),
            err => { console.error(err); setStatus('Failed to load model.', true); },
        );
    };
 
    if (mtlUrl) new MTLLoader().load(mtlUrl, mats => { mats.preload(); doLoad(mats); });
    else doLoad(null);
};

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render Loop ───────────────────────────────────────────────────────────────

let _prevTime = performance.now();
let _elapsed  = 0;
let swimT     = 0;

const _lerpVec = new THREE.Vector3();
const _dir     = new THREE.Vector3();

const animate = () => {
    requestAnimationFrame(animate);

    const now     = performance.now();
    const delta   = Math.min((now - _prevTime) / 1000, 0.1);
    _elapsed     += delta;
    _prevTime     = now;
    const elapsed = _elapsed;

    swimT += delta * SWIM_SPEED;

    // ── Per-specimen update ───────────────────────────────────────────────
    specimens.forEach(spec => {
        if (!spec.pivot) return;

        if (spec.mixer) spec.mixer.update(delta);

        const isShowcased = (spec === activeSpec);
        const t           = swimT + spec.swimOffset;
        const sp          = swimPos(t);

        const blendTarget = isShowcased ? 1 : 0;
        spec.showcaseBlend += (blendTarget - spec.showcaseBlend) * (delta * 2.2);
        spec.showcaseBlend  = THREE.MathUtils.clamp(spec.showcaseBlend, 0, 1);
        const eased         = easeInOut(spec.showcaseBlend);

        const frozenPos = swimPos(spec.frozenSwimT);
        const swimCur   = isShowcased ? frozenPos : sp;
        _lerpVec.lerpVectors(swimCur, SHOWCASE_POS, eased);
        spec.pivot.position.copy(_lerpVec);

        if (!isShowcased) {
            const look = swimPos(t + 0.025);
            _dir.copy(look).sub(sp).normalize();
            // Rotation while swimming
            spec.pivot.rotation.set(
                Math.asin(THREE.MathUtils.clamp(-_dir.y, -1, 1)),
                Math.atan2(_dir.x, _dir.z),
                Math.sin(t * 1.8) * 0.09, 'YXZ',
            );
        } else {
            // Lerp to upright and hold still
            spec.pivot.rotation.x = THREE.MathUtils.lerp(spec.pivot.rotation.x, 0, delta * 2);
            spec.pivot.rotation.y = THREE.MathUtils.lerp(spec.pivot.rotation.y, 0, delta * 2);
            spec.pivot.rotation.z = THREE.MathUtils.lerp(spec.pivot.rotation.z, 0, delta * 2);
        }
    });

    // ── Global effects ────────────────────────────────────────────────────
    const isSelected = activeSpec !== null;

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

    // Ring opacity driven by the ACTIVE specimen's blend (or 0 if nothing selected)
    const showcaseEased = activeSpec ? easeInOut(activeSpec.showcaseBlend) : 0;
    const fade = Math.max(0, (showcaseEased - 0.15) / 0.85);
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

const init = async () => {
    try {
        SPECIMEN_CATALOG = await fetch('/assets/data/specimencatalog.json')
            .then(r => { if (!r.ok) throw r; return r.json(); });
        console.log(`[Atlas] Catalog loaded — ${Object.keys(SPECIMEN_CATALOG).length} specimen(s)`);
    } catch (err) {
        console.warn('[Atlas] Could not load catalog:', err);
    }

    const mountEl = document.getElementById('panelMount');
    if (mountEl) createRoot(mountEl).render(<App />);

    // swimOffset of Math.PI puts the manta on the opposite side of the figure-8
    // loadGLTF('/assets/models/greatWhite/shark_skin.glb', 0);
    loadOBJ('/assets/models/greatWhite/sharky.obj', '/assets/models/greatWhite/sharky.mtl', 0);
    loadOBJ('/assets/models/manta/manta_skin.obj', '/assets/models/manta/manta_skin.mtl', Math.PI);

    animate();
};

window.onload = init;