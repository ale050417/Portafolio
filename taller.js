// Taller 3D: la escena del portafolio. three.js llega por CDN (ver el importmap en index.html).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const canvas = document.getElementById('scene');
// cuánto tarda cada etapa de la carga, en milisegundos (se consulta con taller.stats())
const timing = {};
const clock = (name, since) => { timing[name] = Math.round(performance.now() - since); };
const born = performance.now();

// La escena se arma por tramos y cede el control cada tanto: así la página sigue respondiendo
// (se puede leer y deslizar) aunque el equipo sea lento.
let slice = performance.now();

async function breathe() {
    if (performance.now() - slice < 40) return;
    await new Promise((done) => { setTimeout(done); });
    slice = performance.now();
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
// ?calidad=baja o ?calidad=alta fuerza una versión, para probar
const forced = new URLSearchParams(location.search).get('calidad');

// Hay dos versiones de la misma escena. La liviana es la de teléfonos y tablets: sin espejo, sombras ni
// posprocesado, con la luz ya pintada en los vértices y casi todo el taller unido en un par de mallas.
let lite = forced ? forced === 'baja' : touch || Math.min(window.screen.width, window.screen.height) < 600;

// los extras de la versión completa se cargan aparte, así el teléfono ni los descarga
let EffectComposer, RenderPass, UnrealBloomPass, OutputPass, Reflector, RoomEnvironment;
if (!lite) {
    try {
        [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { Reflector }, { RoomEnvironment }] = await Promise.all([
            import('three/addons/postprocessing/EffectComposer.js'),
            import('three/addons/postprocessing/RenderPass.js'),
            import('three/addons/postprocessing/UnrealBloomPass.js'),
            import('three/addons/postprocessing/OutputPass.js'),
            import('three/addons/objects/Reflector.js'),
            import('three/addons/environments/RoomEnvironment.js'),
        ]);
    } catch (_) {
        lite = true;
    }
}

const C = {
    bg: 0x04060a, wall: 0x0d131b, trim: 0x17212d, floor: 0x0a0f16,
    metal: 0x1b2430, steel: 0x3a4757, white: 0xdfe7ee, dark: 0x0b0f14,
    teal: 0x4fc6ce, tealDeep: 0x0e7c86, blue: 0x4c8dff, orange: 0xff8a2b,
    red: 0xff4d5a, gold: 0xe6b04a, violet: 0x9b6bff, green: 0x35c98a,
};

// ===== Recorrido: dónde se para la cámara en cada sección =====
// shift corre la escena dentro de la pantalla (derecha y abajo en positivo) para dejarle lugar al panel de texto;
// tall ajusta la parada en pantallas verticales: cuánto se aleja la cámara y cuánto sube el objeto
const STATIONS = [
    { id: 'inicio', pos: [17.0, 9.8, 17.4], look: [-0.2, 2.0, -0.4], shift: [0.19, 0.05] },
    { id: 'orbita', pos: [1.2, 4.0, 3.2], look: [-2.4, 3.4, -5.5], shift: [0.2, 0.03] },
    { id: 'fadely', pos: [0.9, 2.9, 8.7], look: [-4.3, 2.3, 3.9], shift: [-0.2, 0] },
    { id: 'hefesto', pos: [1.9, 4.1, 4.0], look: [-5.7, 2.8, -1.3], shift: [0.2, 0] },
    { id: 'arduino', pos: [8.3, 4.1, 8.5], look: [3.7, 1.6, 3.4], shift: [-0.2, 0] },
    { id: 'sobre-mi', pos: [10.2, 4.8, 4.8], look: [2.7, 2.3, -1.4], shift: [0.27, 0], tall: [1.9, -0.31] },
    { id: 'contacto', pos: [11.5, 13.5, 16.5], look: [-0.5, 1.0, -0.5], shift: [-0.17, 0] },
];

// ---------- utilidades ----------
const shared = new Map();

function once(key, make) {
    if (!shared.has(key)) shared.set(key, make());
    return shared.get(key);
}

function std(color, roughness = 0.7, metalness = 0, extra) {
    if (!lite) return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    // Versión liviana: sombreado simple y un solo material por color. Los metales van más oscuros:
    // sin reflejos que los expliquen quedarían claros de más.
    const tone = new THREE.Color(color).multiplyScalar(1 - 0.45 * metalness);
    if (extra) return new THREE.MeshLambertMaterial({ ...extra, color: tone });
    return once(`lit${color}/${metalness}`, () => new THREE.MeshLambertMaterial({ color: tone }));
}

function glow(color, intensity = 2.2) {
    if (!lite) return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    // sin posprocesado no hay halo: queda el color encendido, más vivo cuanto más fuerte era la luz
    return once(`glow${color}/${intensity}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(clamp(1.1 + intensity * 0.14, 1.2, 1.7)) }));
}

// en la versión liviana las formas llevan muchos menos triángulos
const detail = (n) => (lite ? Math.max(8, Math.round(n * 0.45)) : n);

function box(w, h, d, material, r = 0.04) {
    const radius = Math.max(Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001), 0.001);
    if (!lite) return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
    // en la versión liviana solo las piezas bien redondeadas (el brazo, el robot) conservan el borde curvo
    if (r >= 0.1) return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), material);
    // la luz se pinta por vértice: las caras grandes van partidas en tramos para que el degradé salga parejo
    const cuts = (n) => (material.isMeshBasicMaterial ? 1 : clamp(Math.round(n / 0.55), 1, 24));
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d, cuts(w), cuts(h), cuts(d)), material);
}

function cyl(rTop, rBottom, h, material, seg = 32) {
    return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, detail(seg)), material);
}

function ball(r, material, seg = 24) {
    return new THREE.Mesh(new THREE.SphereGeometry(r, detail(seg), Math.max(6, Math.round(detail(seg) * 0.7))), material);
}

// los aros finos se engrosan en el teléfono, donde un tubo de un píxel parpadea
function torus(r, tube, material, radial = 8, tubular = 48) {
    return new THREE.Mesh(new THREE.TorusGeometry(r, lite && tube < 0.05 ? tube * 1.35 : tube, lite ? 6 : radial, detail(tubular)), material);
}

// Luz puntual. En la versión liviana no ilumina en vivo: queda anotada, y su luz se pinta una sola vez
// sobre todo lo que no se mueve (ver paint).
const painted = [];

function pointLight(color, intensity, distance) {
    if (!lite) return new THREE.PointLight(color, intensity, distance, 2);
    const mark = new THREE.Object3D();
    painted.push({ mark, color: new THREE.Color(color).multiplyScalar(intensity), distance });
    return mark;
}

function at(obj, x, y, z) {
    obj.position.set(x, y, z);
    return obj;
}

function group(x = 0, y = 0, z = 0) {
    return at(new THREE.Group(), x, y, z);
}

const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- texturas dibujadas ----------
// rectángulo de esquinas redondeadas (recto en los navegadores que todavía no lo traen)
function rounded(g, x, y, w, h, r) {
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = lite ? 2 : 8;
    return texture;
}

// ----- en la versión liviana, la luz y la sombra van pintadas en vez de calcularse -----
// mancha redonda y difusa: sirve de resplandor
function spotTexture() {
    return once('spot', () => canvasTexture(64, 64, (g, w) => {
        const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.45, 'rgba(255,255,255,.4)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, w);
    }));
}

// resplandor que acompaña a algo encendido: hace las veces del brillo del posprocesado y, como él,
// se suma por encima de lo que tenga delante
function halo(color, size, opacity = 0.55) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spotTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    sprite.scale.setScalar(size);
    return sprite;
}

// sombras blandas bajo los muebles: zonas del piso que se pintan más oscuras
const shades = [];

function shade(x, z, w, d) {
    shades.push({ x, z, w, d });
}

// La luz que se pinta en la versión liviana: cielo, sol y cuánto se refuerzan las luces de color
// (sin brillos ni reflejos hace falta un poco más de luz para que el taller se lea igual).
const BAKE = { sky: 0x9bbcff, ground: 0x0a0c10, ambient: 1.1, sun: 0xcfe0ff, power: 1.5, from: [9, 15, 11], lamps: 1.8, sheen: 0.012 };

// cartel de neón: texto con halo, opcionalmente dentro de un marco
function neonSign(text, height, { color = '#4fc6ce', weight = 600, size = 150, spacing = 0, italic = false, frame = false, family = 'Sora' } = {}) {
    if (lite) {
        // la mitad de resolución: un cuarto de la memoria
        size *= 0.5;
        spacing *= 0.5;
    }
    const font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}, sans-serif`;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    probe.letterSpacing = `${spacing}px`;
    // sin posprocesado, el resplandor del tubo va pintado: necesita más margen alrededor
    const bleed = lite ? size * 0.5 : 0;
    const pad = (frame ? size * 0.7 : size * 0.45) + bleed;
    const w = Math.ceil(probe.measureText(text).width + pad * 2);
    const h = Math.ceil(size * 1.3 + pad * 2);

    const texture = canvasTexture(w, h, (g) => {
        g.font = font;
        g.letterSpacing = `${spacing}px`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.shadowColor = color;

        if (frame) {
            g.shadowBlur = size * 0.3;
            g.strokeStyle = color;
            g.lineWidth = size * (lite ? 0.095 : 0.07);
            g.beginPath();
            rounded(g, size * 0.28 + bleed, size * 0.28 + bleed, w - size * 0.56 - bleed * 2, h - size * 0.56 - bleed * 2, size * 0.42);
            g.stroke();
        }

        g.fillStyle = color;
        if (lite) {
            // el halo ancho y el grosor que en la versión completa pone el posprocesado
            g.strokeStyle = color;
            g.lineWidth = size * 0.075;
            g.shadowBlur = size * 0.6;
            g.strokeText(text, w / 2, h / 2 + size * 0.04);
            g.shadowBlur = size * 0.2;
            g.fillText(text, w / 2, h / 2 + size * 0.04);
        } else {
            g.shadowBlur = size * 0.36;
            g.fillText(text, w / 2, h / 2 + size * 0.04);
            g.shadowBlur = size * 0.12;
            g.fillText(text, w / 2, h / 2 + size * 0.04);
        }
        // núcleo casi blanco, como un tubo encendido
        g.shadowBlur = 0;
        g.globalAlpha = lite ? 0.9 : 0.72;
        g.fillStyle = '#ffffff';
        g.fillText(text, w / 2, h / 2 + size * 0.04);
    });

    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    // (sin posprocesado el tubo se ve más fino y apagado a la distancia: va más fuerte)
    material.userData.neon = lite ? 1.8 : 1.3;
    material.color.setScalar(0);
    neons.push(material);
    // el margen extra no achica el texto
    const tall = height * h / (h - bleed * 2);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(tall * (w / h), tall), material);
    mesh.renderOrder = 2;
    return mesh;
}

const neons = [];

// ---------- escena ----------
let renderer;
try {
    // En la versión liviana el suavizado de bordes lo hace el propio teléfono, que le sale casi gratis.
    // Sin aceleración por hardware la escena no arranca y queda la foto fija (salvo que se pida una versión a mano).
    renderer = new THREE.WebGLRenderer({ canvas, antialias: lite, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !forced });
} catch (error) {
    dispatchEvent(new CustomEvent('taller:failed'));
    throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.info.autoReset = false;
renderer.setClearColor(C.bg, 1);
renderer.shadowMap.enabled = !lite;
renderer.shadowMap.type = THREE.PCFShadowMap;
// en la versión liviana ningún color pasa de 1: se ahorra esa cuenta en cada píxel
renderer.toneMapping = lite ? THREE.NoToneMapping : THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
renderer.debug.checkShaderErrors = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(C.bg, 0.014);
if (!lite) {
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;
}

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 220);

const loading = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loading);
// las imágenes que todavía no llegaron (si alguna falla, la escena arranca igual)
const pending = [];

function image(url) {
    let texture;
    pending.push(new Promise((done) => { texture = loader.load(url, done, undefined, done); }));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = lite ? 2 : 8;
    return texture;
}

// las capturas tienen una copia más chica para el teléfono
const capture = (name, small) => `assets/projects/${name}${lite ? small : ''}.webp`;

function screen(w, h, url) {
    const material = new THREE.MeshBasicMaterial({ map: image(url) });
    // un poco más apagada que el neón, para que la captura se lea sin quemarse
    material.color.setScalar(0.82);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

const M = {
    wall: std(C.wall, 0.94),
    trim: std(C.trim, 0.8, 0.2),
    metal: std(C.metal, 0.5, 0.65),
    steel: std(C.steel, 0.38, 0.8),
    white: std(C.white, 0.45, 0.05),
    dark: std(C.dark, 0.6, 0.3),
    wood: std(0x241d18, 0.75, 0.05),
    black: std(0x050608, 0.5, 0.2),
};

const room = new THREE.Group();
scene.add(room);

// lo que se mueve en cada cuadro
const updates = [];
let mirror = null;
// zonas clicables: llevan a la sección de cada proyecto
const hits = [];

function hit(id, label, w, h, d, x, y, z) {
    const mesh = at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false })), x, y, z);
    mesh.userData = { id, label };
    room.add(mesh);
    hits.push(mesh);
}

// ===== El cuarto =====
let floor = null;

function buildRoom() {
    const size = lite ? 512 : 1024;
    const lines = canvasTexture(size, size, (g, w) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, w);
        const n = 8;
        const cell = w / n;
        const line = w / 340;
        for (let i = 0; i <= n; i++) {
            g.fillStyle = i % 4 === 0 ? 'rgba(79,198,206,.5)' : 'rgba(79,198,206,.16)';
            g.fillRect(i * cell - line / 2, 0, line, w);
            g.fillRect(0, i * cell - line / 2, w, line);
        }
    });
    let floorMat;
    if (lite) {
        // la luz del piso va pintada en los vértices, y las líneas de la textura se suman encima
        floorMat = new THREE.MeshBasicMaterial({ map: lines, vertexColors: true });
        floorMat.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <map_fragment>', '')
                .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb += texture2D( map, vMapUv ).rgb * 0.8;');
        };
    } else {
        floorMat = std(C.floor, 0.32, 0.35, { emissive: 0xffffff, emissiveMap: lines, emissiveIntensity: 0.75 });
    }
    floor = at(new THREE.Mesh(new THREE.PlaneGeometry(13, 13, lite ? 26 : 1, lite ? 26 : 1), floorMat), 0, 0.001, 0);
    floor.rotation.x = -Math.PI / 2;
    const base = lite ? new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 13, 8, 1, 8), M.dark) : box(13, 0.5, 13, M.dark, 0.08);
    room.add(at(base, 0, -0.25, 0), floor);

    room.add(at(box(13, 6.6, 0.3, M.wall, 0.05), 0, 3.05, -6.35));
    room.add(at(box(0.3, 6.6, 13, M.wall, 0.05), -6.35, 3.05, 0));
    room.add(at(box(13.06, 0.12, 0.38, M.trim, 0.03), 0, 6.41, -6.35));
    room.add(at(box(0.38, 0.12, 13.06, M.trim, 0.03), -6.35, 6.41, 0));

    // tiras de luz: zócalos y borde de la plataforma
    const strip = glow(C.teal, 1.5);
    // un poco más gruesas en el teléfono, para que no parpadeen
    const w = lite ? 0.065 : 0.05;
    room.add(at(box(12.5, w, w, strip, 0.02), 0.1, 0.06, -6.17));
    room.add(at(box(w, w, 12.5, strip, 0.02), -6.17, 0.06, 0.1));
    room.add(at(box(12.7, w, w, strip, 0.02), 0, -0.3, 6.5));
    room.add(at(box(w, w, 12.7, strip, 0.02), 6.5, -0.3, 0));
    // contorno de las paredes
    const outline = glow(C.teal, 1.1);
    const o = lite ? 0.055 : 0.04;
    room.add(at(box(13, o, o, outline, 0.015), 0, 6.49, -6.19), at(box(o, o, 13, outline, 0.015), -6.19, 6.49, 0), at(box(o, 6.4, o, outline, 0.015), -6.19, 3.25, -6.19));
}

// ===== Órbita: escritorio, monitor y planeta =====
function buildDesk() {
    const g = group(-2.3, 0, -5.15);
    g.add(at(box(4.8, 0.14, 1.9, M.wood, 0.05), 0, 1.6, 0));
    g.add(at(box(0.12, 1.55, 1.7, M.metal), -2.25, 0.78, 0), at(box(0.12, 1.55, 1.7, M.metal), 2.25, 0.78, 0));
    g.add(at(box(1.3, 1.15, 1.6, M.metal, 0.05), 1.5, 0.95, 0));
    g.add(at(box(1.1, 0.42, 0.04, M.steel, 0.02), 1.5, 1.22, 0.81), at(box(1.1, 0.42, 0.04, M.steel, 0.02), 1.5, 0.72, 0.81));

    // monitor con la portada de Órbita
    g.add(at(box(1.0, 0.06, 0.6, M.metal, 0.02), 0, 1.7, -0.3), at(box(0.14, 0.75, 0.14, M.metal), 0, 2.05, -0.4));
    g.add(at(box(3.0, 1.95, 0.12, M.black, 0.06), 0, 3.25, -0.4));
    g.add(at(screen(2.8, 1.75, capture('orbita-home', '-720')), 0, 3.25, -0.335));

    g.add(at(box(1.6, 0.06, 0.5, M.steel, 0.03), -0.1, 1.7, 0.45), at(box(0.2, 0.07, 0.32, M.steel, 0.03), 1.0, 1.7, 0.5));

    // tablet con el panel de administración
    const tablet = group(1.55, 2.12, 0.1);
    tablet.rotation.set(-0.32, -0.42, 0);
    tablet.add(box(1.36, 0.88, 0.06, M.black, 0.05), at(screen(1.26, 0.7875, `assets/projects/orbita-panel-${lite ? 400 : 800}.webp`), 0, 0, 0.032));
    g.add(tablet, at(box(0.5, 0.36, 0.08, M.steel, 0.02), 1.6, 1.82, -0.12));

    const mug = at(cyl(0.11, 0.1, 0.24, M.white), -1.55, 1.79, 0.35);
    const handle = at(torus(0.07, 0.02, M.white, 8, 16), -1.43, 1.79, 0.35);
    g.add(mug, handle);

    // planta
    const leaves = std(0x2f9c6f, 0.8, 0, { flatShading: true });
    g.add(at(cyl(0.2, 0.15, 0.3, std(0x39424e, 0.8)), -1.95, 1.82, -0.45));
    [[0, 0.5, 0, 0.3], [0.16, 0.38, 0.08, 0.2], [-0.15, 0.36, -0.06, 0.19]].forEach(([x, y, z, r]) => {
        g.add(at(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaves), -1.95 + x, 1.82 + y, -0.45 + z));
    });

    // lámpara
    const lamp = group(2.0, 1.67, -0.5);
    lamp.add(at(cyl(0.18, 0.2, 0.05, M.metal), 0, 0.03, 0));
    const stem = at(cyl(0.02, 0.02, 0.95, M.steel, 8), -0.14, 0.46, 0);
    stem.rotation.z = 0.3;
    const head = at(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.26, 20, 1, true), std(C.white, 0.5, 0, { side: THREE.DoubleSide })), -0.42, 0.92, 0);
    head.rotation.z = -0.9;
    lamp.add(stem, head, at(ball(0.06, glow(0xffd29a, 4)), -0.46, 0.86, 0));
    const lampLight = at(pointLight(0xffc98a, 7, 6), -0.6, 0.7, 0.1);
    lamp.add(lampLight);
    g.add(lamp);

    // banqueta
    g.add(at(cyl(0.48, 0.48, 0.1, std(C.tealDeep, 0.8)), 0, 1.05, 1.95), at(cyl(0.05, 0.05, 1.0, M.steel), 0, 0.52, 1.95), at(cyl(0.4, 0.45, 0.06, M.metal), 0, 0.03, 1.95));

    // holograma: un planeta en órbita sobre el monitor
    const holo = group(0, 4.95, -0.4);
    const core = ball(0.25, glow(C.blue, 1.6));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshBasicMaterial({ color: C.blue, wireframe: true, transparent: true, opacity: 0.45 }));
    const ring = torus(0.55, 0.012, glow(C.blue, 3), 8, 64);
    ring.rotation.x = 1.25;
    const moon = ball(0.05, glow(0xffffff, 3));
    const beam = at(new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.62, 28, 1, true), new THREE.MeshBasicMaterial({ color: C.blue, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })), 0, -0.42, 0);
    holo.add(core, wire, ring, moon, beam);
    holo.userData.dynamic = true;
    moon.userData.live = true;
    if (lite) {
        holo.add(halo(C.blue, 2.0, 0.5));
        lamp.add(at(halo(0xffd29a, 1.0, 0.5), -0.46, 0.86, 0));
        shade(-2.3, -5.0, 6.2, 3.0);
    }
    g.add(holo, at(cyl(0.2, 0.25, 0.06, M.steel), 0, 4.26, -0.4));
    g.add(at(pointLight(C.blue, 14, 7), 0, 4.6, 0.6));

    updates.push((t) => {
        wire.rotation.y = t * 0.4;
        core.rotation.y = -t * 0.2;
        moon.position.set(Math.cos(t * 0.9) * 0.55, Math.sin(t * 0.9) * 0.55 * Math.cos(1.25) * -1, Math.sin(t * 0.9) * 0.55 * Math.sin(1.25));
        holo.position.y = 4.95 + Math.sin(t * 1.3) * 0.04;
    });

    room.add(g);
    hit('orbita', 'Órbita', 5, 5.4, 2.2, -2.3, 2.9, -5.2);
}

// ===== Hefesto 3D: impresora, banco y pantalla en la pared =====
function buildPrinter() {
    const bench = group(-5.15, 0, -1.3);
    bench.add(at(box(1.9, 0.12, 3.7, M.wood, 0.04), 0, 1.25, 0), at(box(1.7, 0.06, 3.4, M.metal, 0.02), 0, 0.45, 0));
    [[-0.85, -1.7], [0.85, -1.7], [-0.85, 1.7], [0.85, 1.7]].forEach(([x, z]) => bench.add(at(box(0.12, 1.2, 0.12, M.metal), x, 0.62, z)));
    bench.add(at(box(0.7, 0.5, 0.9, std(0x2b3542, 0.8), 0.04), -0.2, 0.74, -0.9), at(box(0.6, 0.36, 0.7, std(0x39424e, 0.8), 0.04), 0.1, 0.67, 0.5));

    const p = group(0, 1.31, -0.75);
    p.add(at(box(1.5, 0.14, 1.5, M.metal, 0.04), 0, 0.07, 0), at(box(1.1, 0.05, 1.1, M.black, 0.02), 0, 0.165, 0));
    [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]].forEach(([x, z]) => p.add(at(box(0.09, 1.65, 0.09, M.steel, 0.02), x, 0.94, z)));
    p.add(at(box(1.45, 0.09, 0.09, M.steel, 0.02), 0, 1.74, -0.68), at(box(1.45, 0.09, 0.09, M.steel, 0.02), 0, 1.74, 0.68));
    p.add(at(box(0.09, 0.09, 1.45, M.steel, 0.02), -0.68, 1.74, 0), at(box(0.09, 0.09, 1.45, M.steel, 0.02), 0.68, 1.74, 0));
    p.add(at(box(0.36, 0.1, 0.02, glow(C.teal, 1.4), 0.008), 0.3, 0.08, 0.76));

    // la pieza se imprime capa por capa: un plano de corte sube con el cabezal
    const bedY = 0.19;
    const height = 0.95;
    const profile = [];
    for (let i = 0; i <= 26; i++) {
        const y = (i / 26) * height;
        profile.push(new THREE.Vector2(0.2 + 0.09 * Math.sin(y * 6.2 + 0.6) + 0.06 * (1 - y / height), y));
    }
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const piece = at(new THREE.Mesh(new THREE.LatheGeometry(profile, detail(40)), std(C.gold, 0.42, 0.25, { side: THREE.DoubleSide, clippingPlanes: [cut], clipShadows: true, emissive: lite ? 0x4a2a08 : 0x000000 })), 0, bedY, 0);
    const layer = torus(0.24, 0.014, glow(C.orange, 4), 8, 40);
    layer.rotation.x = Math.PI / 2;

    const gantry = group(0, 0.6, 0);
    gantry.add(box(1.4, 0.07, 0.07, M.white, 0.02));
    const headGroup = group();
    const nozzle = at(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 12), glow(C.orange, 3.2)), 0, -0.2, 0);
    nozzle.rotation.x = Math.PI;
    headGroup.add(at(box(0.24, 0.22, 0.24, M.white, 0.04), 0, -0.04, 0), nozzle, at(pointLight(C.orange, 2.2, 2.6), 0, -0.3, 0));
    gantry.add(headGroup);
    gantry.userData.dynamic = true;
    layer.userData.live = true;
    if (lite) headGroup.add(at(halo(0xff7a1a, 1.9, 0.72), 0, -0.24, 0));

    const spool = at(torus(0.3, 0.12, std(C.gold, 0.5, 0.1), 12, 36), 0.98, 1.25, -0.2);
    spool.rotation.y = Math.PI / 2;
    spool.userData.live = true;
    p.add(piece, layer, gantry, spool, at(cyl(0.03, 0.03, 0.4, M.steel, 8), 0.86, 1.25, -0.2));
    bench.add(p);

    // piezas terminadas sobre el banco
    [[C.teal, 0.2, 0.75, 0.5], [C.white, -0.3, 1.25, 0.34], [C.gold, 0.35, 1.45, 0.42]].forEach(([color, x, z, s]) => {
        const done = at(new THREE.Mesh(new THREE.LatheGeometry(profile, detail(28)), std(color, 0.45, 0.2, { side: THREE.DoubleSide })), x, 1.31, z);
        done.scale.setScalar(s);
        bench.add(done);
    });
    room.add(bench);
    if (lite) {
        shade(-5.15, -1.3, 3.0, 4.8);
    }

    const origin = new THREE.Vector3();
    let progress = reduced ? 0.7 : 0;
    updates.push((t, dt) => {
        if (!reduced) progress = ((t * 0.055) % 1.25);
        const k = clamp(progress, 0, 1);
        const y = bedY + height * k;
        p.getWorldPosition(origin);
        cut.constant = origin.y + y;
        layer.position.set(0, y, 0);
        layer.scale.setScalar((profile[Math.round(k * 26)].x + 0.02) / 0.24);
        layer.visible = k < 1;
        gantry.position.y = y + 0.3;
        if (reduced) return;
        gantry.position.z = Math.cos(t * 1.7) * 0.2;
        headGroup.position.x = Math.sin(t * 2.3) * 0.26;
        spool.rotation.x += dt * 0.6;
    });

    // pantalla con el catálogo, colgada en la pared
    const frame = at(box(0.1, 1.74, 2.64, M.black, 0.04), -6.14, 3.75, -1.3);
    const view = at(screen(2.44, 1.525, capture('hefesto-catalogo', '-720')), -6.08, 3.75, -1.3);
    view.rotation.y = Math.PI / 2;
    room.add(frame, view, at(pointLight(C.gold, 7, 6), -4.4, 3.4, -1.2));
    hit('hefesto', 'Hefesto 3D', 2.6, 5.4, 4.2, -5.2, 2.7, -1.3);
}

// ===== Fadely: teléfono y poste de barbería =====
function buildFadely() {
    const g = group(-4.3, 0, 3.9);
    g.rotation.y = Math.PI / 4;

    g.add(at(box(1.6, 0.9, 1.1, M.metal, 0.08), 0, 0.45, 0), at(box(1.5, 0.04, 0.04, glow(C.red, 2.2), 0.015), 0, 0.86, 0.56));
    g.add(at(box(0.26, 0.5, 0.2, M.steel, 0.04), 0.25, 1.15, 0));

    const phone = group(0.25, 2.5, 0.02);
    phone.rotation.x = -0.1;
    phone.add(box(1.12, 2.36, 0.12, M.black, 0.1), at(screen(0.99, 2.21, 'assets/projects/fadely-pantalla.webp'), 0, 0, 0.064));
    g.add(phone);

    // poste de barbería giratorio
    const stripes = canvasTexture(256, 256, (c, w) => {
        c.fillStyle = '#f6f1e6';
        c.fillRect(0, 0, w, w);
        ['#d6362e', '#2a4fb5'].forEach((color, i) => {
            c.fillStyle = color;
            for (let k = -2; k < 4; k++) {
                c.beginPath();
                const x = k * 128 + i * 64;
                c.moveTo(x, 0);
                c.lineTo(x + 32, 0);
                c.lineTo(x + 32 + 128, w);
                c.lineTo(x + 128, w);
                c.fill();
            }
        });
    });
    stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
    stripes.repeat.set(1, 1.5);
    const pole = group(-0.95, 0, 0.1);
    const chrome = std(lite ? 0x8d97a1 : 0xcfd8e0, 0.25, 0.9);
    pole.add(at(cyl(0.2, 0.25, 0.12, chrome), 0, 0.96, 0), at(cyl(0.05, 0.05, 0.4, chrome, 12), 0, 1.2, 0), at(cyl(0.17, 0.17, 0.12, chrome), 0, 1.44, 0));
    const tube = at(cyl(0.14, 0.14, 1.3, std(0xffffff, 0.35, 0, { map: stripes, emissive: 0xffffff, emissiveMap: stripes, emissiveIntensity: 0.75 })), 0, 2.15, 0);
    pole.add(tube, at(cyl(0.17, 0.17, 0.12, chrome), 0, 2.86, 0), at(ball(0.13, glow(0xfff1d6, 2.6)), 0, 3.04, 0));
    g.add(pole, at(pointLight(0xff6a55, 9, 6), -0.2, 2.4, 1.3));
    if (lite) {
        const aura = at(halo(0xffd9c2, 1, 0.4), 0, 2.15, 0);
        aura.scale.set(1.6, 2.8, 1);
        pole.add(aura, at(halo(0xfff1d6, 1.3, 0.55), 0, 3.04, 0));
        shade(-4.3, 3.9, 3.0, 3.0);
    }
    if (!reduced) updates.push((t, dt) => { stripes.offset.y -= dt * 0.22; });

    room.add(g);
    hit('fadely', 'Fadely', 3, 3.8, 3, -4.5, 1.9, 3.9);
}

// ===== Arduino IOT: placa, sensor, llama y teléfono =====
function buildArduino() {
    const g = group(3.8, 0, 3.5);
    g.add(at(cyl(1.6, 1.6, 0.1, M.metal, 56), 0, 1.0, 0), at(cyl(0.12, 0.16, 0.95, M.steel), 0, 0.5, 0), at(cyl(0.7, 0.8, 0.08, M.metal, 40), 0, 0.04, 0));
    const rim = at(torus(1.6, 0.014, glow(C.orange, 1.8), 8, 80), 0, 1.0, 0);
    rim.rotation.x = Math.PI / 2;
    g.add(rim);

    const board = group(-0.35, 1.09, -0.25);
    board.rotation.y = -0.45;
    const black = M.black;
    board.add(box(1.9, 0.06, 1.3, std(C.tealDeep, 0.5, 0.1), 0.06));
    board.add(at(box(1.15, 0.14, 0.09, black, 0.01), 0.18, 0.1, -0.56), at(box(0.95, 0.14, 0.09, black, 0.01), 0.3, 0.1, 0.56));
    board.add(at(box(0.78, 0.08, 0.2, black, 0.01), 0.22, 0.07, 0.18), at(box(0.3, 0.22, 0.34, std(lite ? 0x7c8690 : 0xb8c2cc, 0.3, 0.9), 0.02), -0.86, 0.14, -0.3), at(box(0.3, 0.24, 0.28, black, 0.02), -0.83, 0.15, 0.35));
    board.add(at(cyl(0.07, 0.07, 0.16, std(0x2a4fb5, 0.5)), -0.42, 0.11, 0.08), at(cyl(0.07, 0.07, 0.16, std(0x2a4fb5, 0.5)), -0.24, 0.11, 0.08));
    const leds = [[C.green, 0.72, -0.2], [C.orange, 0.72, -0.05], [C.orange, 0.5, -0.32], [C.orange, 0.38, -0.32]].map(([color, x, z]) => {
        const led = at(box(0.07, 0.04, 0.04, glow(color, 3), 0.01), x, 0.05, z);
        led.userData.live = true;
        if (lite) led.add(halo(color, 0.26, 0.55));
        board.add(led);
        return led;
    });
    g.add(board);

    // protoboard con el sensor
    const proto = group(0.6, 1.1, 0.8);
    proto.rotation.y = 0.35;
    proto.add(box(1.25, 0.09, 0.44, M.white, 0.02), at(box(1.15, 0.01, 0.02, glow(C.red, 1.2), 0.004), 0, 0.05, -0.18), at(box(1.15, 0.01, 0.02, glow(C.blue, 1.2), 0.004), 0, 0.05, 0.18));
    proto.add(at(box(0.22, 0.28, 0.12, std(0x2c7be5, 0.6), 0.02), -0.3, 0.19, 0), at(cyl(0.1, 0.1, 0.14, black, 20), 0.35, 0.12, 0));
    g.add(proto);

    // cables entre la placa y la protoboard
    [[C.red, -0.1], [0xffd23f, 0.05], [C.teal, 0.2]].forEach(([color, o]) => {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.1 + o, 1.22, 0.2), new THREE.Vector3(0.3 + o, 1.55, 0.45), new THREE.Vector3(0.45 + o, 1.2, 0.72),
        ]);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 6), std(color, 0.6)));
    });

    // la llama que dispara la alerta
    const flame = group(1.0, 1.05, -0.5);
    const outer = at(new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 16), glow(C.orange, 3.2)), 0, 0.3, 0);
    const inner = at(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 12), glow(0xffe08a, 4)), 0, 0.24, 0);
    const fire = at(pointLight(0xff7a2b, 8, 5), 0, 0.5, 0);
    flame.add(at(cyl(0.16, 0.18, 0.09, black), 0, 0.045, 0), outer, inner, fire);
    outer.userData.live = true;
    inner.userData.live = true;
    g.add(flame);
    if (lite) {
        flame.add(at(halo(C.orange, 2.3, 0.7), 0, 0.3, 0));
        shade(3.8, 3.5, 4.0, 4.0);
    }

    const phone = group(-0.15, 1.72, 1.0);
    phone.rotation.set(-0.3, 0.5, 0);
    phone.add(box(0.66, 1.34, 0.07, M.black, 0.06), at(screen(0.57, 1.265, capture('arduino-iot', '-270')), 0, 0, 0.037));
    g.add(phone, at(box(0.5, 0.12, 0.3, M.steel, 0.03), -0.15, 1.1, 0.92));

    updates.push((t) => {
        leds[1].visible = Math.sin(t * 3) > 0;
        leds[2].visible = Math.sin(t * 17) > 0.2;
        leds[3].visible = Math.sin(t * 13 + 1) > 0.3;
        if (reduced) return;
        const f = 0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.07;
        outer.scale.set(f, 0.9 + f * 0.2, f);
        inner.scale.set(1 / f, f, 1 / f);
        fire.intensity = 8 * f;
    });

    room.add(g);
    hit('arduino', 'Arduino IOT', 3.2, 1.9, 3.2, 3.8, 1.55, 3.5);
}

// ===== El brazo robótico: sigue al puntero y presenta cada proyecto =====
const arm = { target: new THREE.Vector3(4, 3, 4), base: new THREE.Vector3(2.7, 0, -1.4), L1: 1.9, L2: 1.6, h0: 1.05, wave: 0 };

function buildArm() {
    const g = group(arm.base.x, 0, arm.base.z);
    const joint = std(0x121820, 0.5, 0.6);
    const ringGlow = glow(C.teal, 2.6);

    g.add(at(cyl(0.95, 1.05, 0.3, M.metal, 48), 0, 0.15, 0));
    const floorRing = at(torus(0.98, 0.02, ringGlow, 8, 72), 0, 0.31, 0);
    floorRing.rotation.x = Math.PI / 2;
    g.add(floorRing);

    const yaw = group(0, 0.3, 0);
    yaw.add(at(cyl(0.55, 0.64, 0.5, M.white, 40), 0, 0.25, 0), at(box(0.8, 0.5, 0.62, M.white, 0.12), 0, 0.68, 0));
    const shoulderAxis = at(cyl(0.3, 0.3, 0.98, joint, 28), 0, 0.75, 0);
    shoulderAxis.rotation.z = Math.PI / 2;
    yaw.add(shoulderAxis);
    [-0.5, 0.5].forEach((x) => {
        const r = at(torus(0.2, 0.02, ringGlow, 8, 36), x, 0.75, 0);
        r.rotation.y = Math.PI / 2;
        yaw.add(r);
    });

    const shoulder = group(0, 0.75, 0);
    shoulder.add(at(box(0.36, arm.L1, 0.32, M.white, 0.13), 0, arm.L1 / 2, 0), at(box(0.05, arm.L1 * 0.62, 0.34, joint, 0.02), 0, arm.L1 / 2, 0));

    const elbow = group(0, arm.L1, 0);
    const elbowAxis = cyl(0.25, 0.25, 0.72, joint, 24);
    elbowAxis.rotation.z = Math.PI / 2;
    elbow.add(elbowAxis, at(box(0.28, arm.L2, 0.26, M.white, 0.11), 0, arm.L2 / 2, 0));

    const hand = group(0, arm.L2, 0);
    const wrist = cyl(0.17, 0.17, 0.4, joint, 20);
    wrist.rotation.z = Math.PI / 2;
    const fingers = [-1, 1].map((s) => at(box(0.07, 0.42, 0.14, M.white, 0.03), s * 0.15, 0.42, 0));
    const eye = at(ball(0.075, glow(C.teal, 4)), 0, 0.2, 0.18);
    hand.add(wrist, at(box(0.4, 0.16, 0.32, joint, 0.05), 0, 0.14, 0), ...fingers, eye, at(pointLight(C.teal, 3, 3.5), 0, 0.5, 0.3));

    elbow.add(hand);
    shoulder.add(elbow);
    yaw.add(shoulder);
    g.add(yaw, at(pointLight(C.teal, 12, 8), 0.6, 3.2, 1.2));
    room.add(g);
    yaw.userData.dynamic = true;
    fingers.forEach((finger) => { finger.userData.live = true; });
    if (lite) {
        // sin posprocesado, el resplandor del brazo son manchas de luz que lo acompañan
        g.add(at(halo(C.teal, 4.6, 0.34), 0, 0.5, 0));
        shoulder.add(at(halo(0x8fe6ec, 2.6, 0.34), 0, arm.L1 * 0.5, 0));
        elbow.add(at(halo(0x8fe6ec, 2.2, 0.32), 0, arm.L2 * 0.5, 0));
        hand.add(at(halo(C.teal, 0.9, 0.6), 0, 0.2, 0.2));
        shade(arm.base.x, arm.base.z, 3.0, 3.0);
    }

    const state = { yaw: 0.8, s: 0.5, e: 1.2 };
    const local = new THREE.Vector3();

    updates.push((t, dt) => {
        local.copy(arm.target).sub(arm.base);
        local.y -= arm.h0;
        // el saludo de la sección de contacto
        if (arm.wave > 0.01) {
            local.x += Math.sin(t * 5) * 1.1 * arm.wave;
            local.y += 0.6 * arm.wave;
        }
        if (!reduced) local.y += Math.sin(t * 1.4) * 0.08;

        const d = Math.hypot(local.x, local.z);
        const reach = clamp(Math.hypot(d, local.y), 1.0, arm.L1 + arm.L2 - 0.15);
        const pitch = Math.atan2(local.y, d);
        const a = Math.acos(clamp((arm.L1 ** 2 + reach ** 2 - arm.L2 ** 2) / (2 * arm.L1 * reach), -1, 1));
        const b = Math.acos(clamp((arm.L1 ** 2 + arm.L2 ** 2 - reach ** 2) / (2 * arm.L1 * arm.L2), -1, 1));

        let yawGoal = Math.atan2(local.x, local.z);
        while (yawGoal - state.yaw > Math.PI) yawGoal -= Math.PI * 2;
        while (yawGoal - state.yaw < -Math.PI) yawGoal += Math.PI * 2;
        state.yaw = damp(state.yaw, yawGoal, 4, dt);
        state.s = damp(state.s, Math.PI / 2 - (pitch + a), 4, dt);
        state.e = damp(state.e, Math.PI - b, 4, dt);

        yaw.rotation.y = state.yaw;
        shoulder.rotation.x = state.s;
        elbow.rotation.x = state.e;
        hand.rotation.x = 0.35;
        const grip = reduced ? 0.15 : 0.15 + (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.06;
        fingers[0].position.x = -grip;
        fingers[1].position.x = grip;
    });

    hit('sobre-mi', 'Sobre mí', 2.0, 3.2, 2.0, 2.7, 1.6, -1.4);
}

// ===== Un robot que da vueltas por el taller =====
function buildRover() {
    const g = group();
    const tire = std(0x0d1116, 0.9);
    g.add(at(box(0.8, 0.3, 0.56, M.white, 0.1), 0, 0.36, 0), at(box(0.5, 0.1, 0.4, std(C.tealDeep, 0.6), 0.04), 0, 0.56, 0));
    g.add(at(box(0.36, 0.26, 0.3, M.dark, 0.07), 0, 0.72, 0.1));
    const eyes = [-0.09, 0.09].map((x) => at(box(0.09, 0.09, 0.02, glow(C.teal, 3.4), 0.008), x, 0.74, 0.26));
    const tip = at(ball(0.035, glow(C.red, 4), 12), -0.12, 1.08, -0.05);
    g.add(...eyes, at(cyl(0.01, 0.01, 0.34, M.steel, 6), -0.12, 0.9, -0.05), tip);
    const wheels = [[-0.44, 0.2], [0.44, 0.2], [-0.44, -0.2], [0.44, -0.2]].map(([x, z]) => {
        const w = at(cyl(0.16, 0.16, 0.12, tire, 20), x, 0.16, z);
        w.rotation.z = Math.PI / 2;
        g.add(w);
        return w;
    });
    room.add(g);
    g.userData.dynamic = true;
    tip.userData.live = true;
    if (lite) tip.add(halo(C.red, 0.34, 0.7));

    g.scale.setScalar(1.45);
    const center = new THREE.Vector3(-0.6, 0, 1.6);
    const radius = 2.0;
    const place = (a) => {
        g.position.set(center.x + Math.cos(a) * radius, 0, center.z + Math.sin(a) * radius);
        g.rotation.y = -a;
    };
    place(0.9);
    if (reduced) return;
    updates.push((t, dt) => {
        place(0.9 + t * 0.28);
        g.position.y = Math.sin(t * 9) * 0.006;
        tip.visible = Math.sin(t * 4) > 0;
        // en la versión liviana las ruedas y los ojos van unidos al cuerpo
        if (lite) return;
        wheels.forEach((w) => { w.rotation.x += dt * 3.6; });
        const blink = Math.sin(t * 0.9) > 0.985 ? 0.15 : 1;
        eyes.forEach((e) => { e.scale.y = blink; });
    });
}

// ===== Un dron dando vueltas arriba =====
function buildDrone() {
    const g = group();
    g.add(box(0.5, 0.14, 0.5, M.white, 0.06), at(box(0.2, 0.08, 0.2, M.dark, 0.03), 0, -0.1, 0), at(ball(0.035, glow(C.red, 4), 10), 0, -0.16, 0.08));
    const rotors = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => {
        const armBar = at(box(0.46, 0.04, 0.06, M.dark, 0.015), x * 0.3, 0.02, z * 0.3);
        armBar.rotation.y = Math.atan2(-z, x);
        const rotor = at(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.01, 24), new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.22, depthWrite: false })), x * 0.48, 0.1, z * 0.48);
        g.add(armBar, at(cyl(0.05, 0.05, 0.08, M.steel, 12), x * 0.48, 0.05, z * 0.48), rotor, at(ball(0.025, glow(C.teal, 3.5), 8), x * 0.48, -0.02, z * 0.48));
        return rotor;
    });
    room.add(g);
    g.userData.dynamic = true;

    const place = (t) => {
        g.position.set(-0.6 + Math.sin(t * 0.33) * 3.4, 5.0 + Math.sin(t * 0.9) * 0.18, -1.0 + Math.sin(t * 0.66) * 2.0);
        g.rotation.set(Math.cos(t * 0.66) * 0.12, t * 0.2, -Math.cos(t * 0.33) * 0.16);
    };
    place(2);
    if (reduced) return;
    updates.push((t, dt) => {
        place(t + 2);
        rotors.forEach((r, i) => { r.rotation.y += dt * (40 + i); });
    });
}

// ===== Paredes: carteles, estantes y el panel de actividad =====
const ledCanvas = document.createElement('canvas');
ledCanvas.width = 53 * 16;
ledCanvas.height = 7 * 16;
const ledTexture = new THREE.CanvasTexture(ledCanvas);
ledTexture.colorSpace = THREE.SRGBColorSpace;
const LED_COLORS = ['#101a22', '#125058', '#1f8a94', '#3db9c2', '#8ff1f6'];

function drawLeds(levelAt) {
    const g = ledCanvas.getContext('2d');
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, ledCanvas.width, ledCanvas.height);
    for (let w = 0; w < 53; w++) {
        for (let d = 0; d < 7; d++) {
            g.fillStyle = LED_COLORS[levelAt(w, d)];
            g.beginPath();
            rounded(g, w * 16 + 3, d * 16 + 3, 10, 10, 3);
            g.fill();
        }
    }
    ledTexture.needsUpdate = true;
}

function buildWalls() {
    if (lite) {
        shade(3.3, -5.5, 4.8, 2.4);
    }

    // estante y gabinete bajo el panel
    room.add(at(box(3.8, 1.3, 1.3, M.metal, 0.06), 3.3, 0.65, -5.55));
    [2.35, 3.3, 4.25].forEach((x) => room.add(at(box(0.9, 1.0, 0.04, M.steel, 0.02), x, 0.66, -4.89), at(box(0.3, 0.03, 0.03, glow(C.teal, 1.6), 0.01), x, 1.02, -4.86)));
    room.add(at(box(0.9, 0.4, 0.45, std(0xc0392b, 0.6, 0.2), 0.05), 2.3, 1.5, -5.5), at(box(0.5, 0.05, 0.06, M.steel, 0.02), 2.3, 1.76, -5.5));
    room.add(at(box(0.4, 0.5, 0.3, std(0xf2c230, 0.6), 0.05), 3.4, 1.55, -5.55), at(box(0.3, 0.18, 0.02, glow(C.green, 1.2), 0.01), 3.4, 1.62, -5.39));
    room.add(at(cyl(0.14, 0.16, 0.4, M.steel), 4.3, 1.5, -5.6), at(cyl(0.02, 0.02, 0.5, M.steel, 8), 4.3, 1.9, -5.6));

    room.add(at(box(3.8, 0.08, 0.7, M.wood, 0.03), 3.3, 2.85, -5.85));
    [[0x4c8dff, 2.0, 0.5], [0xe6b04a, 2.2, 0.62], [0xdfe7ee, 2.4, 0.44], [0x35c98a, 2.6, 0.56], [0x9b6bff, 4.5, 0.52], [0xff8a2b, 4.7, 0.4]].forEach(([color, x, h]) => {
        room.add(at(box(0.16, h, 0.44, std(color, 0.8), 0.02), x, 2.89 + h / 2, -5.85));
    });
    // un robotito de adorno
    const toy = group(3.4, 2.89, -5.82);
    toy.add(at(box(0.36, 0.34, 0.26, M.white, 0.06), 0, 0.22, 0), at(box(0.3, 0.24, 0.24, M.white, 0.06), 0, 0.54, 0));
    toy.add(at(box(0.06, 0.06, 0.02, glow(C.teal, 3), 0.01), -0.07, 0.56, 0.13), at(box(0.06, 0.06, 0.02, glow(C.teal, 3), 0.01), 0.07, 0.56, 0.13));
    toy.add(at(cyl(0.012, 0.012, 0.14, M.steel, 6), 0, 0.73, 0), at(ball(0.03, glow(C.orange, 3), 10), 0, 0.81, 0));
    room.add(toy);

    // panel de LEDs con la actividad de GitHub
    room.add(at(box(4.5, 0.86, 0.08, M.black, 0.03), 3.3, 4.4, -6.16));
    const leds = at(new THREE.Mesh(new THREE.PlaneGeometry(4.3, 4.3 * (7 / 53)), new THREE.MeshBasicMaterial({ map: ledTexture })), 3.3, 4.4, -6.11);
    leds.material.color.setScalar(1.25);
    room.add(leds);
    drawLeds((w, d) => ((w * 7 + d * 3) % 11 === 0 ? 1 : 0));

    // estante con bobinas de filamento y cuadros de los proyectos, en la pared izquierda
    room.add(at(box(0.7, 0.08, 2.4, M.wood, 0.03), -5.85, 2.1, 2.5));
    [[C.gold, 1.75], [C.teal, 2.5], [C.white, 3.25]].forEach(([color, z]) => {
        const s = at(torus(0.27, 0.12, std(color, 0.55, 0.1), 12, 32), -5.85, 2.53, z);
        s.rotation.y = 0.5;
        room.add(s);
    });
    [['orbita', 3.55, 1.95], ['fadely', 3.55, 3.05], ['hefesto', 4.65, 1.95], ['arduino-iot', 4.65, 3.05]].forEach(([name, y, z]) => {
        const logo = at(new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.74), new THREE.MeshBasicMaterial({ map: image(`assets/projects/${name}-logo.webp`), transparent: true })), -6.15, y, z);
        logo.rotation.y = Math.PI / 2;
        room.add(at(box(0.06, 0.9, 0.9, M.black, 0.03), -6.18, y, z), logo);
    });
}

// los carteles necesitan la tipografía ya cargada
function buildSigns() {
    const name = at(neonSign('ALEXANDER IBARRA', 1.0, { color: '#4fc6ce', spacing: 14, frame: true }), -2.3, 5.62, -6.18);
    const tag = at(neonSign('robótica · apps · web', 0.56, { color: '#b9c8ff', weight: 300, size: 120 }), 3.3, 5.5, -6.18);
    const github = at(neonSign('actividad en GitHub', 0.3, { color: '#7fe3ea', weight: 400, size: 110 }), 3.3, 3.78, -6.18);
    const hefesto = at(neonSign('HEFESTO 3D', 0.6, { color: '#e6b04a', spacing: 10, size: 130 }), -6.18, 5.2, -1.3);
    hefesto.rotation.y = Math.PI / 2;
    const orbita = at(neonSign('Órbita', 0.5, { color: '#6ea4ff', size: 130 }), -4.75, 4.6, -6.18);
    room.add(name, tag, github, hefesto, orbita);
    if (lite) {
        // el resplandor de cada cartel sobre su pared
        room.add(at(pointLight(C.teal, 3.2, 5), -2.3, 5.6, -5.3), at(pointLight(0xb9c8ff, 1.6, 4), 3.3, 5.5, -5.4));
        room.add(at(pointLight(C.gold, 2.2, 4), -5.4, 5.2, -1.3), at(pointLight(C.blue, 1.2, 3), -4.75, 4.6, -5.5));
    }

    // los dos puestos sueltos llevan su cartel flotando
    [['Fadely', '#ff6a5c', true, -4.4, 4.45, 3.9], ['Arduino IOT', '#ff9a3d', false, 3.8, 3.1, 3.5]].forEach(([text, color, italic, x, y, z]) => {
        const label = neonSign(text, 0.5, { color, italic, size: 130 });
        const sprite = at(new THREE.Sprite(new THREE.SpriteMaterial({ map: label.material.map, transparent: true, depthWrite: false })), x, y, z);
        sprite.material.userData.neon = lite ? 1.8 : 1.3;
        sprite.material.color.setScalar(0);
        neons.splice(neons.indexOf(label.material), 1, sprite.material);
        sprite.scale.set(label.geometry.parameters.width, label.geometry.parameters.height, 1);
        room.add(sprite);
        updates.push((t) => {
            if (!reduced) sprite.position.y = y + Math.sin(t * 1.2 + x) * 0.05;
            sprite.material.opacity = clamp((camera.position.distanceTo(sprite.position) - 8) / 5, 0, 1);
        });
    });

    // poste con flechas: la navegación dentro de la escena
    const post = group(0.3, 0, 5.3);
    post.add(at(cyl(0.3, 0.36, 0.1, M.metal), 0, 0.05, 0), at(cyl(0.06, 0.06, 3.1, M.steel, 12), 0, 1.6, 0), at(ball(0.1, glow(C.teal, 3)), 0, 3.2, 0));
    [['Proyectos', '#4fc6ce', 2.75, 0.5, 'orbita'], ['Sobre mí', '#b08cff', 2.15, 0.9, 'sobre-mi'], ['Contacto', '#ff9a3d', 1.55, 0.2, 'contacto']].forEach(([text, color, y, turn, id]) => {
        const board = at(neonSign(text, 0.52, { color, frame: true, size: 120, weight: 500 }), 0.75, y, 0.08);
        const arrow = group(0, 0, 0);
        arrow.rotation.y = turn;
        arrow.add(board);
        post.add(arrow);
        const target = at(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.3), new THREE.MeshBasicMaterial({ visible: false })), 0.75, y, 0.08);
        target.userData = { id, label: text };
        arrow.add(target);
        hits.push(target);
    });
    room.add(post);
    if (lite) {
        post.add(at(halo(C.teal, 0.8, 0.5), 0, 3.2, 0));
        shade(0.3, 5.3, 1.6, 1.6);
    }
}

// ===== Ambiente: piso espejado, brillos, polvo y estrellas =====
function buildAmbient() {
    if (!lite) {
        mirror = at(new Reflector(new THREE.CircleGeometry(70, 48), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x7d8a99 }), 0, -0.5, 0);
        mirror.rotation.x = -Math.PI / 2;
        scene.add(mirror);

        // velo que apaga el reflejo a medida que se aleja del taller
        const veil = canvasTexture(512, 512, (g, w) => {
            const grad = g.createRadialGradient(w / 2, w / 2, w * 0.05, w / 2, w / 2, w / 2);
            grad.addColorStop(0, 'rgba(4,6,10,.62)');
            grad.addColorStop(0.26, 'rgba(4,6,10,.86)');
            grad.addColorStop(0.55, 'rgba(4,6,10,1)');
            g.fillStyle = grad;
            g.fillRect(0, 0, w, w);
        });
        const fade = at(new THREE.Mesh(new THREE.CircleGeometry(70, 48), new THREE.MeshBasicMaterial({ map: veil, transparent: true, depthWrite: false })), 0, -0.49, 0);
        fade.rotation.x = -Math.PI / 2;
        scene.add(fade);
    } else {
        // sin espejo: el resplandor del taller sobre el suelo va pintado en una textura
        const spill = canvasTexture(512, 512, (g, w) => {
            const unit = w / 44;
            const mid = w / 2;
            const half = 6.5 * unit;
            g.fillStyle = '#04060a';
            g.fillRect(0, 0, w, w);
            g.globalCompositeOperation = 'lighter';
            const wash = (color, x, z, radius) => {
                const grad = g.createRadialGradient(mid + x * unit, mid + z * unit, 0, mid + x * unit, mid + z * unit, radius * unit);
                grad.addColorStop(0, color);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                g.fillStyle = grad;
                g.fillRect(0, 0, w, w);
            };
            wash('rgba(79,198,206,.2)', 0, 0, 19);
            wash('rgba(110,164,255,.12)', -4, 9, 11);
            wash('rgba(155,107,255,.12)', 10, -3, 11);
            wash('rgba(255,138,43,.1)', 8, 7, 9);
            // el borde encendido de la plataforma, reflejado: solo la sombra difusa de un marco dibujado fuera del lienzo
            g.shadowColor = 'rgba(79,198,206,.8)';
            g.shadowBlur = 2.2 * unit;
            g.shadowOffsetX = w * 2;
            g.lineWidth = 0.7 * unit;
            g.strokeRect(mid - half - w * 2, mid - half, half * 2, half * 2);
        });
        // la textura ocupa solo el centro: más allá el suelo sigue con el color del borde, que es el del fondo
        spill.repeat.setScalar(160 / 44);
        spill.offset.setScalar((1 - 160 / 44) / 2);
        const ground = at(new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ map: spill })), 0, -0.5, 0);
        ground.rotation.x = -Math.PI / 2;
        // se dibuja después del taller, así no se pinta lo que queda tapado
        ground.renderOrder = 1;
        scene.add(ground);
    }

    // bruma de color alrededor del taller
    const haze = (color, x, y, z, size, opacity) => {
        const sprite = at(new THREE.Sprite(new THREE.SpriteMaterial({ map: spotTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })), x, y, z);
        sprite.scale.setScalar(size);
        scene.add(sprite);
    };
    if (lite) {
        // la bruma va más allá del borde del suelo: asoma arriba, como un horizonte encendido
        haze(C.teal, -92, 12, -92, 170, 0.55);
        haze(C.violet, 30, 10, -120, 130, 0.3);
    } else {
        haze(C.teal, -13, 7, -15, 34, 0.26);
        haze(C.violet, 15, 3, -18, 38, 0.2);
        haze(C.blue, -18, 2, 8, 30, 0.16);
    }

    const count = lite ? 50 : 110;
    const dust = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) dust.set([Math.random() * 12 - 6, Math.random() * 6.5, Math.random() * 12 - 6], i * 3);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9fe6ea, size: 0.03, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })));
    if (!reduced) {
        updates.push((t, dt) => {
            for (let i = 0; i < count; i++) {
                dust[i * 3 + 1] += dt * (0.06 + (i % 5) * 0.012);
                if (dust[i * 3 + 1] > 6.6) dust[i * 3 + 1] = 0;
            }
            dustGeo.attributes.position.needsUpdate = true;
        });
    }

    const starCount = lite ? 140 : 300;
    const stars = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const v = new THREE.Vector3().setFromSphericalCoords(70 + Math.random() * 40, Math.random() * Math.PI * 0.48, Math.random() * Math.PI * 2);
        stars.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe6ff, size: 0.35, transparent: true, opacity: 0.7, fog: false, depthWrite: false })));
}

let keyLight = null;

function buildLights() {
    // las tres luces de color que bañan todo el taller
    scene.add(at(pointLight(C.violet, 26, 16), 5.5, 5.5, -3.5), at(pointLight(C.teal, 30, 18), -2, 5.6, 2), at(pointLight(0xff9a6a, lite ? 3 : 12, 12), 5, 3.2, 6));
    if (lite) {
        // estas dos solo alumbran lo que se mueve (el brazo, el robot, el dron): un blanco frío con algo de
        // turquesa, como les llega en la versión completa. El resto ya lleva la luz pintada (ver paint).
        scene.add(new THREE.HemisphereLight(0xbdeef2, 0x0e3038, 1.7));
        const sun = new THREE.DirectionalLight(0xdfe9ff, 1.9);
        sun.position.fromArray(BAKE.from);
        scene.add(sun);
        return;
    }
    scene.add(new THREE.HemisphereLight(0x9bbcff, 0x0a0c10, 0.8));
    keyLight = new THREE.DirectionalLight(0xcfe0ff, 1.5);
    keyLight.position.set(9, 15, 11);
    keyLight.target.position.set(-1, 0, -1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(keyLight.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 42 });
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.03;
    scene.add(keyLight, keyLight.target);
}

for (const build of [buildRoom, buildDesk, buildPrinter, buildFadely, buildArduino, buildArm, buildRover, buildDrone, buildWalls, buildAmbient, buildLights]) {
    build();
    await breathe();
}
clock('build', born);

if (!lite) {
    room.traverse((o) => {
        if (!o.isMesh || !o.material.isMeshStandardMaterial) return;
        o.castShadow = true;
        o.receiveShadow = true;
    });
}

// ---------- versión liviana: luz pintada y mallas unidas ----------
// En un teléfono flojo pesan dos cosas: cuántas mallas hay que mandar a dibujar y cuánta cuenta lleva cada
// píxel. Por eso todo lo que no se mueve se funde en un par de mallas, y su luz se calcula una sola vez,
// al cargar, y queda guardada como color en cada vértice.
const skyTint = new THREE.Color(BAKE.sky).multiplyScalar(BAKE.ambient);
const soilTint = new THREE.Color(BAKE.ground).multiplyScalar(BAKE.ambient);
const sunTint = new THREE.Color(BAKE.sun).multiplyScalar(BAKE.power);
const sunFrom = new THREE.Vector3().fromArray(BAKE.from).normalize();
const lamps = [];

// los tonos muy altos se aplastan de a poco en vez de quemarse
const soften = (v) => (v < 0.75 ? v : 0.75 + (v - 0.75) / (1 + (v - 0.75) * 3));

function paint(geometry, base, out, offset, ground) {
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    for (let i = 0; i < position.length; i += 3) {
        const x = position[i];
        const y = position[i + 1];
        const z = position[i + 2];
        const nx = normal[i];
        const ny = normal[i + 1];
        const nz = normal[i + 2];

        // cielo y sol
        const up = ny * 0.5 + 0.5;
        const facing = Math.max(0, nx * sunFrom.x + ny * sunFrom.y + nz * sunFrom.z);
        const r = soilTint.r + (skyTint.r - soilTint.r) * up + sunTint.r * facing;
        const g = soilTint.g + (skyTint.g - soilTint.g) * up + sunTint.g * facing;
        const b = soilTint.b + (skyTint.b - soilTint.b) * up + sunTint.b * facing;
        let lr = 0;
        let lg = 0;
        let lb = 0;

        // las luces de colores, con la caída que tendrían encendidas
        for (const lamp of lamps) {
            const dx = lamp.x - x;
            const dy = lamp.y - y;
            const dz = lamp.z - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            const far = d2 / (lamp.reach * lamp.reach);
            if (far >= 1) continue;
            const towards = (nx * dx + ny * dy + nz * dz) / Math.sqrt(d2);
            if (towards <= 0) continue;
            const k = towards * (1 - far * far) ** 2 / Math.max(d2, 0.3);
            lr += lamp.r * k;
            lg += lamp.g * k;
            lb += lamp.b * k;
        }

        // sombra: en el piso, bajo los muebles; en lo demás, un poco contra el suelo
        let dim = 1;
        if (ground) {
            for (const blot of shades) {
                const edge = Math.max(Math.abs(x - blot.x) / (blot.w / 2), Math.abs(z - blot.z) / (blot.d / 2));
                dim *= 1 - 0.55 * (1 - smooth(clamp((edge - 0.5) / 0.5, 0, 1)));
            }
        } else if (y >= 0) {
            dim = 0.62 + 0.38 * smooth(clamp(y / 0.9, 0, 1));
        }
        dim /= Math.PI;
        // (el pequeño extra hace que las luces de color también tiñan lo más oscuro, como un reflejo)
        out[offset + i] = soften((base.r * r + (base.r + BAKE.sheen) * lr) * dim);
        out[offset + i + 1] = soften((base.g * g + (base.g + BAKE.sheen) * lg) * dim);
        out[offset + i + 2] = soften((base.b * b + (base.b + BAKE.sheen) * lb) * dim);
    }
}

const fused = {};

function fusable(mesh) {
    const m = mesh.material;
    return !mesh.userData.live && !mesh.userData.merged && (m.isMeshLambertMaterial || m.isMeshBasicMaterial)
        && m.visible && !m.map && !m.emissiveMap && !m.transparent && !m.wireframe && !m.clippingPlanes;
}

function fuse(parent, meshes, world) {
    const groups = new Map();
    for (const mesh of meshes) {
        // lo quieto ya lleva la luz pintada, así que encendido y apagado van en la misma malla
        const key = `${world || mesh.material.isMeshBasicMaterial ? 'flat' : 'lit'}${mesh.material.side}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(mesh);
    }

    for (const [key, list] of groups) {
        if (!world && list.length < 2) continue;
        let vertices = 0;
        let corners = 0;
        const parts = list.map((mesh) => {
            const faceted = mesh.material.flatShading;
            const geometry = faceted && mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
            if (!world) mesh.updateMatrix();
            geometry.applyMatrix4(world ? mesh.matrixWorld : mesh.matrix);
            if (faceted) geometry.computeVertexNormals();
            vertices += geometry.attributes.position.count;
            corners += geometry.index ? geometry.index.count : geometry.attributes.position.count;
            return { geometry, material: mesh.material };
        });

        const lit = key.startsWith('lit');
        const position = new Float32Array(vertices * 3);
        const normal = lit ? new Float32Array(vertices * 3) : null;
        const color = new Float32Array(vertices * 3);
        const index = new (vertices > 65535 ? Uint32Array : Uint16Array)(corners);
        let v = 0;
        let c = 0;
        for (const { geometry, material } of parts) {
            const count = geometry.attributes.position.count;
            position.set(geometry.attributes.position.array, v * 3);
            if (lit) normal.set(geometry.attributes.normal.array, v * 3);
            if (world && material.isMeshLambertMaterial) {
                paint(geometry, material.color, color, v * 3, false);
            } else {
                for (let i = v * 3; i < (v + count) * 3; i += 3) {
                    color[i] = material.color.r;
                    color[i + 1] = material.color.g;
                    color[i + 2] = material.color.b;
                }
            }
            if (geometry.index) {
                const source = geometry.index.array;
                for (let i = 0; i < source.length; i++) index[c++] = source[i] + v;
            } else {
                for (let i = 0; i < count; i++) index[c++] = v + i;
            }
            v += count;
            geometry.dispose();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
        if (lit) geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        if (!fused[key]) {
            const Material = lit ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial;
            fused[key] = new Material({ vertexColors: true, side: list[0].material.side });
        }
        const merged = new THREE.Mesh(geometry, fused[key]);
        merged.userData.merged = true;
        parent.add(merged);
        for (const mesh of list) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
        }
    }
}

function optimize() {
    scene.updateMatrixWorld(true);

    // dónde quedó cada luz anotada; las que viajan con algo que se mueve no se pintan
    const spot = new THREE.Vector3();
    for (const { mark, color, distance } of painted) {
        let rides = false;
        mark.traverseAncestors((node) => {
            if (node.userData.dynamic) rides = true;
        });
        if (!rides) {
            mark.getWorldPosition(spot);
            lamps.push({ x: spot.x, y: spot.y, z: spot.z, r: color.r * BAKE.lamps, g: color.g * BAKE.lamps, b: color.b * BAKE.lamps, reach: distance });
        }
        mark.removeFromParent();
    }

    const fixed = [];
    const walk = (node, moving) => {
        const moves = moving || node.userData.dynamic === true;
        const own = [];
        for (const child of [...node.children]) {
            if (!child.isMesh) walk(child, moves);
            else if (fusable(child)) (moves ? own : fixed).push(child);
        }
        // lo que se mueve se une por partes, cada una dentro de su grupo
        if (moves) fuse(node, own, false);
    };
    walk(room, false);
    fuse(room, fixed, true);

    // el piso queda aparte porque lleva la textura de líneas
    floor.updateMatrix();
    floor.geometry.applyMatrix4(floor.matrix);
    floor.position.set(0, 0, 0);
    floor.rotation.set(0, 0, 0);
    const tint = new Float32Array(floor.geometry.attributes.position.count * 3);
    paint(floor.geometry, new THREE.Color(C.floor), tint, 0, true);
    floor.geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3));
}

// ---------- posprocesado: el brillo ----------
// (la versión liviana dibuja directo a la pantalla)
let composer = null;
let bloom = null;
if (!lite) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
}

// ---------- cámara: sigue al scroll ----------
const sections = STATIONS.map((s) => document.getElementById(s.id));
let centers = [];
const view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), shift: new THREE.Vector2(), station: 0 };
const goal = { pos: new THREE.Vector3(), look: new THREE.Vector3(), shift: new THREE.Vector2() };
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const lookA = new THREE.Vector3();
const shiftA = new THREE.Vector2();
const pointer = new THREE.Vector2();
const pointerSmooth = new THREE.Vector2();
let width = 1;
let height = 1;
let intro = reduced ? 1 : 0;
let started = false;

function portrait() {
    return width / height < 0.9;
}

function measure() {
    centers = sections.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0));
}

function resize(force) {
    // el lienzo mide lo mismo con o sin las barras del navegador, así en el teléfono no se
    // rehace cada vez que aparecen y desaparecen al deslizar
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (force === true || w !== width || h !== height) {
        width = w;
        height = h;
        renderer.setSize(width, height, false);
        composer?.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    measure();
}

function stationPose(i, pos, look, shift) {
    const s = STATIONS[i];
    look.fromArray(s.look);
    pos.fromArray(s.pos);
    shift.fromArray(s.shift);
    if (portrait()) {
        // en vertical la cámara se aleja y el objeto queda en la mitad de arriba
        const [far, lift] = s.tall || [i === 0 || i === STATIONS.length - 1 ? 1.7 : 1.45, i === 0 ? -0.1 : -0.2];
        pos.sub(look).multiplyScalar(far).add(look);
        shift.set(0, lift);
    } else {
        // en pantallas menos apaisadas la cámara retrocede para que el taller entre completo
        pos.sub(look).multiplyScalar(clamp(2.05 / (width / height), 1, 1.6)).add(look);
    }
}

function updateGoal() {
    const mid = scrollY + innerHeight / 2;
    let i = 0;
    while (i < centers.length - 2 && mid > centers[i + 1]) i++;
    const span = centers[i + 1] - centers[i] || 1;
    // la cámara se queda un momento en cada parada antes de seguir viaje
    const t = smooth(clamp(((mid - centers[i]) / span - 0.2) / 0.6, 0, 1));
    stationPose(i, tmpA, lookA, shiftA);
    stationPose(i + 1, tmpB, goal.look, goal.shift);
    goal.pos.lerpVectors(tmpA, tmpB, t);
    // un poco de altura en el trayecto, para pasar por encima de las cosas
    goal.pos.y += Math.sin(t * Math.PI) * 1.2;
    goal.look.lerpVectors(lookA, goal.look, t);
    goal.shift.lerpVectors(shiftA, goal.shift, t);
    view.station = t < 0.5 ? i : i + 1;
}

const raycaster = new THREE.Raycaster();
const shoulder = new THREE.Vector3(arm.base.x, arm.h0, arm.base.z);
let hovered = null;

function pick() {
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObjects(hits, false)[0];
    return found ? found.object : null;
}

function armTarget() {
    const id = STATIONS[view.station].id;
    arm.wave = damp(arm.wave, id === 'contacto' ? 1 : 0, 3, 0.016);
    if (hovered && hovered.userData.id !== 'sobre-mi') {
        // señala el objeto sobre el que está el puntero
        hovered.getWorldPosition(tmpA);
    } else if (id === 'inicio' || id === 'sobre-mi' || id === 'contacto') {
        // mira hacia donde está el puntero
        raycaster.setFromCamera(pointerSmooth, camera);
        raycaster.ray.at(camera.position.distanceTo(shoulder) * 0.72, tmpA);
    } else {
        tmpA.fromArray(STATIONS[view.station].look);
    }
    // el objetivo queda siempre a una distancia cómoda del hombro: el brazo apunta, no se estira
    tmpA.sub(shoulder);
    tmpA.y = clamp(tmpA.y, -0.2, 2.4);
    tmpA.setLength(id === 'arduino' ? 2.9 : id === 'orbita' || id === 'fadely' || id === 'hefesto' ? 2.0 : 2.6).add(shoulder);
    arm.target.lerp(tmpA, 0.1);
}

// ---------- calidad: se ajusta sola según lo que aguante el equipo ----------
// escalones de resolución de la versión liviana, del más nítido al más liviano
const steps = [Math.min(devicePixelRatio, 2), 1.5, 1, 0.75].filter((ratio, i, all) => i === 0 || ratio < all[0]);
// el último escalón al que se puede bajar
const lowest = lite ? steps.length - 1 : 3;
let quality = 0;
let idleGap = 0;
let stopped = false;

function draw() {
    renderer.info.reset();
    if (composer) composer.render();
    else renderer.render(scene, camera);
}

// cuánto tarda en dibujarse un cuadro, en milisegundos (promedio de varios)
const pixel = new Uint8Array(4);

function frameCost(frames) {
    const gl = renderer.getContext();
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
        draw();
        // leer un píxel obliga a terminar el dibujo antes de seguir
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    return (performance.now() - start) / frames;
}

// no hay forma de que ande fluido: la escena se apaga y queda la foto fija del taller
function giveUp() {
    if (stopped) return;
    stopped = true;
    renderer.setAnimationLoop(null);
    dispatchEvent(new CustomEvent('taller:failed'));
    renderer.forceContextLoss();
}

// baja un escalón
function lower() {
    quality++;
    if (lite) {
        renderer.setPixelRatio(steps[quality]);
    } else if (quality === 1) {
        renderer.setPixelRatio(1);
        composer.setPixelRatio(1);
        if (mirror) mirror.visible = false;
    } else if (quality === 2) {
        bloom.enabled = false;
        keyLight.castShadow = false;
    } else {
        renderer.setPixelRatio(0.75);
        composer.setPixelRatio(0.75);
    }
}

// Antes de mostrar nada se dibujan un par de cuadros, así todo queda cargado y después no hay tirones.
// En el teléfono, además, se mide cuánto tarda un cuadro y se elige la resolución que ese equipo
// puede mover con soltura. Devuelve false si ni la más baja alcanza.
async function calibrate() {
    frameCost(2);
    if (!lite) return true;
    await breathe();

    // se mide de cerca, que es cuando más píxeles se pintan
    stationPose(1, tmpA, lookA, shiftA);
    camera.position.copy(tmpA);
    camera.lookAt(lookA);
    frameCost(2);
    // (de dos tandas vale la peor: una medida optimista deja al equipo justo de fuerza)
    const cost = () => Math.max(frameCost(3), frameCost(3));
    measured = cost();
    // un cuadro tiene que costar menos de la mitad del tiempo disponible: el resto es para la página
    while (measured > 8 && quality < lowest) {
        lower();
        await breathe();
        measured = cost();
    }
    if (measured > 32) return false;
    // en reposo, un equipo justo de fuerza dibuja a media velocidad
    idleGap = measured > 6 ? 30 : 14;
    return true;
}

let measured = 0;
let last = 0;
let drawn = 0;
let elapsed = 0;
let average = 16;
let warm = 0;
let samples = 0;

function tick(now) {
    const since = Math.min(now - (last || now), 100);
    last = now;

    if (started && intro < 1) intro = Math.min(1, intro + since / 2600);
    updateGoal();
    const moving = intro < 1 || view.pos.distanceToSquared(goal.pos) > 0.0006
        || Math.abs(view.shift.x - goal.shift.x) + Math.abs(view.shift.y - goal.shift.y) > 0.001;

    if (lite && !moving) {
        warm = 0;
        if (now - drawn < idleGap) return;
    } else if (started && warm++ > 8) {
        // con la cámara en viaje se dibuja cada cuadro: si el ritmo no da, se mide cuánto cuesta uno
        average += (since - average) * 0.08;
        if (++samples > 90 && average > 20) {
            samples = 0;
            average = 16;
            measured = frameCost(2);
            // Un cuadro barato quiere decir que el que frena es el navegador (en modo de ahorro, por
            // ejemplo, dibuja a media velocidad): ahí bajar la calidad no arregla nada.
            if (measured > 13 && quality < lowest) lower();
            else if (lite && measured > 32) giveUp();
            else samples = -600;
            if (stopped) return;
        }
    }

    const dt = Math.min((now - (drawn || now)) / 1000, 0.05);
    drawn = now;
    elapsed += dt;
    const t = elapsed;
    const k = 1 - (1 - intro) ** 3;

    const speed = reduced ? 30 : 3.2;
    view.pos.set(damp(view.pos.x, goal.pos.x, speed, dt), damp(view.pos.y, goal.pos.y, speed, dt), damp(view.pos.z, goal.pos.z, speed, dt));
    view.look.set(damp(view.look.x, goal.look.x, speed, dt), damp(view.look.y, goal.look.y, speed, dt), damp(view.look.z, goal.look.z, speed, dt));
    view.shift.set(damp(view.shift.x, goal.shift.x, speed, dt), damp(view.shift.y, goal.shift.y, speed, dt));
    pointerSmooth.set(damp(pointerSmooth.x, pointer.x, 3, dt), damp(pointerSmooth.y, pointer.y, 3, dt));

    // la entrada: la cámara baja desde lejos mientras se encienden los carteles
    tmpA.copy(view.pos).sub(view.look).multiplyScalar(1 + (1 - k) * 0.9).add(view.look);
    tmpA.y += (1 - k) * 7;
    camera.position.copy(tmpA);
    camera.lookAt(view.look);
    if (!reduced && !touch) {
        const sway = view.station === 0 ? 0.55 : 0.2;
        camera.translateX(pointerSmooth.x * sway);
        camera.translateY(pointerSmooth.y * sway * 0.6);
        camera.lookAt(view.look);
    }
    camera.setViewOffset(width, height, -view.shift.x * width, -view.shift.y * height, width, height);

    neons.forEach((m, i) => {
        const on = clamp((intro * 2.4 - 0.5 - (i % 5) * 0.12) * 3, 0, 1);
        const flicker = on < 1 && on > 0 ? (Math.sin(t * 60 + i * 9) > 0 ? 1 : 0.25) : 1;
        m.color.setScalar(m.userData.neon * on * flicker);
    });

    armTarget();
    for (const update of updates) update(t, dt);
    draw();
}

// ---------- interacción ----------
addEventListener('resize', resize);
addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
    if (touch) return;
    const over = e.target === canvas ? pick() : null;
    if (over !== hovered) {
        hovered = over;
        document.body.classList.toggle('is-pointing', Boolean(over));
        dispatchEvent(new CustomEvent('taller:hover', { detail: over ? over.userData : null }));
    }
});

canvas.addEventListener('click', (e) => {
    pointer.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
    const target = pick();
    if (target) document.getElementById(target.userData.id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
});

// ---------- API para script.js ----------
window.taller = {
    // enciende el panel de LEDs con las contribuciones: counts[fecha] y el rango del año
    setActivity(counts, rangeStart, rangeEnd) {
        const DAY = 86400000;
        const start = new Date(`${rangeStart}T00:00:00Z`);
        const end = new Date(`${rangeEnd}T00:00:00Z`);
        const first = start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY;
        drawLeds((w, d) => {
            const date = new Date(first + (w * 7 + d) * DAY);
            if (date < start || date > end) return 0;
            const n = counts[date.toISOString().slice(0, 10)] || 0;
            return n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
        });
    },
    // skip: la escena llegó tarde y entra ya armada, sin el vuelo de la cámara
    start(skip) {
        started = true;
        if (skip) intro = 1;
    },
    // para medir: cuántas órdenes de dibujo y triángulos lleva un cuadro
    stats() {
        const { render, memory } = renderer.info;
        return { version: lite ? 'liviana' : 'completa', calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, pixelRatio: renderer.getPixelRatio(), quality, frameMs: Math.round(measured * 10) / 10, idleGap, stopped, timing };
    },
};

// El teléfono puede quitarle la memoria a la escena (por ejemplo, con la pestaña de fondo): mientras
// tanto queda la foto fija, y cuando la devuelve la escena sigue.
let booted = false;

canvas.addEventListener('webglcontextlost', () => {
    if (stopped) return;
    renderer.setAnimationLoop(null);
    dispatchEvent(new CustomEvent('taller:failed'));
});

canvas.addEventListener('webglcontextrestored', () => {
    if (stopped || !booted) return;
    renderer.setAnimationLoop(tick);
    dispatchEvent(new CustomEvent('taller:ready'));
});

loading.onProgress = (url, loaded, total) => {
    dispatchEvent(new CustomEvent('taller:progress', { detail: loaded / total }));
};

// ---------- arranque ----------
await Promise.all([
    Promise.all(pending),
    // la tipografía de los carteles: si tarda demasiado, se dibujan con la del sistema
    Promise.race([
        Promise.all([document.fonts.load('600 40px Sora'), document.fonts.load('300 40px Sora'), document.fonts.load('italic 600 40px Sora')]).catch(() => { }),
        new Promise((done) => { setTimeout(done, 3000); }),
    ]),
]);
clock('assets', born);

let mark = performance.now();
buildSigns();
clock('signs', mark);
await breathe();

mark = performance.now();
if (lite) optimize();
clock('bake', mark);
await breathe();

resize(true);
updateGoal();
view.pos.copy(goal.pos);
view.look.copy(goal.look);
view.shift.copy(goal.shift);

// Los programas se compilan sin frenar la página (donde el navegador lo permite) y, mientras tanto,
// se suben las texturas de a una.
mark = performance.now();
const compiled = renderer.compileAsync(scene, camera).catch(() => { });
const textures = new Set();
scene.traverse((o) => {
    for (const key of ['map', 'emissiveMap']) if (o.material?.[key]) textures.add(o.material[key]);
});
for (const texture of textures) {
    renderer.initTexture(texture);
    await breathe();
}
clock('textures', mark);
await compiled;
clock('compile', mark);

mark = performance.now();
tick(performance.now());
const fluid = await calibrate();
clock('prepare', mark);
clock('ready', born);
booted = true;

if (!fluid) {
    giveUp();
} else if (!renderer.getContext().isContextLost()) {
    renderer.setAnimationLoop(tick);
    addEventListener('load', measure);
    new ResizeObserver(measure).observe(document.body);
    dispatchEvent(new CustomEvent('taller:ready'));
}
