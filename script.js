// (el script del <head> mira esta marca: si no aparece, deja el sitio como si no hubiera JavaScript)
window.portfolioStarted = true;

const root = document.documentElement;

// ===== Carga: la escena 3D avisa cuando está lista =====
const loaderBar = document.getElementById('loaderBar');
const loaderPct = document.getElementById('loaderPct');
let entered = false;
// la escena 3D está andando
let live = false;

function setProgress(value) {
    const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
    if (loaderBar) loaderBar.style.transform = `scaleX(${pct / 100})`;
    if (loaderPct) loaderPct.textContent = `${pct}%`;
}

// abre el sitio: con la escena 3D si ya está lista y, si no, con la foto fija del taller
function enter() {
    if (entered) return;
    entered = true;
    if (!live) root.classList.add('no-3d', 'is-still');
    setProgress(1);
    setTimeout(() => {
        root.classList.remove('is-loading');
        if (live) window.taller?.start();
    }, live ? 450 : 0);
}

// La escena necesita WebGL 2 con aceleración (o que se pida una versión a mano con ?calidad=).
// Con el ahorro de datos activado tampoco se descarga (lo decide el script del <head>).
function canRender() {
    if (root.classList.contains('save-data')) return false;
    try {
        const strict = !new URLSearchParams(location.search).has('calidad');
        const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: strict });
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return Boolean(gl);
    } catch (_) {
        return false;
    }
}

window.addEventListener('taller:progress', (e) => setProgress(e.detail * 0.9));

window.addEventListener('taller:ready', () => {
    live = true;
    if (!entered) {
        enter();
        return;
    }
    // llegó con el sitio ya abierto (conexión lenta, o el teléfono le devolvió la memoria): aparece sobre la foto
    root.classList.remove('no-3d');
    window.taller?.start(true);
    setTimeout(() => {
        if (live) root.classList.remove('is-still');
    }, 1200);
});

// sin escena (no cargó, el equipo no da o se quedó sin memoria) queda la foto fija
window.addEventListener('taller:failed', () => {
    live = false;
    root.classList.add('no-3d', 'is-still');
    enter();
});

if (!canRender()) {
    enter();
} else {
    const scene = document.createElement('script');
    scene.type = 'module';
    scene.src = 'taller.js';
    scene.addEventListener('error', enter);
    document.head.appendChild(scene);
    // si tarda, el sitio se abre igual con la foto fija y la escena aparece cuando llega
    setTimeout(enter, 3500);
    // y si algo se rompe mientras carga, no se espera más (si la escena llega igual, aparece después)
    window.addEventListener('error', enter);
    window.addEventListener('unhandledrejection', enter);
}

// ===== Paradas del recorrido =====
const stations = document.querySelectorAll('.station');
const railDots = document.querySelectorAll('.rail__dot');
const navLinks = document.querySelectorAll('.nav__link');
const GROUPS = { orbita: 'proyectos', fadely: 'proyectos', hefesto: 'proyectos', arduino: 'proyectos', 'sobre-mi': 'sobre-mi', contacto: 'contacto' };

function setStation(id) {
    stations.forEach((station) => station.classList.toggle('is-active', station.id === id));
    railDots.forEach((dot) => {
        const active = dot.getAttribute('href') === `#${id}`;
        dot.classList.toggle('is-active', active);
        if (active) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
    });
    navLinks.forEach((link) => link.classList.toggle('is-active', link.dataset.group === GROUPS[id]));
}

if ('IntersectionObserver' in window) {
    // activa la parada que cruza el centro de la pantalla
    const spy = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) setStation(entry.target.id);
        });
    }, { rootMargin: '-50% 0px -50% 0px' });

    stations.forEach((station) => spy.observe(station));
} else {
    stations.forEach((station) => station.classList.add('is-active'));
}

const scrollHint = document.getElementById('scrollHint');
window.addEventListener('scroll', () => {
    scrollHint?.classList.toggle('is-off', window.scrollY > 60);
}, { passive: true });

// ===== Menú en pantallas chicas =====
const navToggle = document.getElementById('navToggle');
const mobileNav = document.getElementById('mobileNav');

function setMobileNav(open) {
    if (!navToggle || !mobileNav) return;
    mobileNav.hidden = !open;
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    document.body.classList.toggle('nav-open', open);
}

navToggle?.addEventListener('click', () => {
    setMobileNav(navToggle.getAttribute('aria-expanded') !== 'true');
});

// cerrar al tocar una sección
mobileNav?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setMobileNav(false);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
        setMobileNav(false);
        navToggle.focus();
    }
});

window.matchMedia('(min-width: 900px)').addEventListener('change', (e) => {
    if (e.matches) setMobileNav(false);
});

// ===== Cartelito sobre los objetos de la escena =====
const tip = document.getElementById('tip');

window.addEventListener('taller:hover', (e) => {
    if (!tip) return;
    tip.classList.toggle('is-on', Boolean(e.detail));
    if (e.detail) tip.textContent = `Ver ${e.detail.label}`;
});

// (con el dedo no hay puntero que seguir)
if (!window.matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('pointermove', (e) => {
        if (tip) tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
    }, { passive: true });
}

//copiar email
const copyEmail = document.getElementById('copyEmail');

copyEmail?.addEventListener('click', async () => {
    const email = document.getElementById('emailText')?.textContent.trim();
    const label = copyEmail.querySelector('.copy-btn__label');
    if (!email || !label) return;

    try {
        await navigator.clipboard.writeText(email);
        copyEmail.classList.add('is-copied');
        label.textContent = 'Copiado';
    } catch (_) {
        label.textContent = 'No se pudo copiar';
    }

    setTimeout(() => {
        copyEmail.classList.remove('is-copied');
        label.textContent = 'Copiar';
    }, 2200);
});

// ===== Formulario de contacto =====
const form = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');
const submitBtn = document.getElementById('contactSubmit');

const validators = {
    name: (value) => (value ? '' : 'Decime tu nombre.'),
    email: (value) => {
        if (!value) return 'Necesito un email para responderte.';
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Ese email no parece válido. Revisalo.';
    },
    message: (value) => (value ? '' : 'Escribí tu mensaje.'),
};

function validateField(field) {
    const validate = validators[field.name];
    if (!validate) return true;

    const message = validate(field.value.trim());
    const error = document.getElementById(`${field.name}-error`);

    field.setAttribute('aria-invalid', String(Boolean(message)));
    if (error) {
        error.textContent = message;
        error.hidden = !message;
    }
    if (message) {
        field.setAttribute('aria-describedby', `${field.name}-error`);
    } else {
        field.removeAttribute('aria-describedby');
    }

    return !message;
}

function setFormStatus(kind, message) {
    if (!formStatus) return;
    formStatus.hidden = !message;
    formStatus.dataset.kind = kind;
    formStatus.textContent = message;
}

function setSending(sending) {
    if (!submitBtn) return;
    submitBtn.disabled = sending;
    submitBtn.querySelector('.btn__label').textContent = sending ? 'Enviando…' : 'Enviar mensaje';
}

if (form) {
    const fields = [form.elements.name, form.elements.email, form.elements.message];

    fields.forEach((field) => {
        field.addEventListener('blur', () => validateField(field));
        field.addEventListener('input', () => {
            if (field.getAttribute('aria-invalid') === 'true') validateField(field);
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const invalid = fields.filter((field) => !validateField(field));
        if (invalid.length) {
            setFormStatus('error', invalid.length === 1 ? 'Revisá el campo marcado.' : `Revisá los ${invalid.length} campos marcados.`);
            invalid[0].focus();
            return;
        }

        setFormStatus('', '');
        setSending(true);

        const formData = {
            name: form.elements.name.value.trim(),
            email: form.elements.email.value.trim(),
            subject: '',
            message: form.elements.message.value.trim(),
            website: form.elements.website.value,
            // de dónde llegó quien escribe
            ...landing(),
        };

        try {
            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            const raw = await res.text();

            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (_) {
            }

            if (!res.ok) {
                throw new Error(data.error || 'No se pudo enviar el mensaje. Probá de nuevo o escribime por mail.');
            }

            form.reset();
            setFormStatus('success', 'Mensaje enviado. Gracias por escribir: te respondo a la brevedad.');
        } catch (err) {
            const offline = err instanceof TypeError;
            setFormStatus('error', offline ? 'No hay conexión. Probá de nuevo en un momento.' : err.message);
        } finally {
            setSending(false);
            formStatus?.focus();
        }
    });
}

// ===== Actividad en GitHub: va al panel de LEDs del taller =====
async function loadContributions() {
    const summary = document.getElementById('activitySummary');

    try {
        const res = await fetch('/api/github', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error cargando contribuciones');

        // la API repite cada fecha una vez por contribución (con tope)
        const counts = {};
        (data.activityData || '').split(',').filter(Boolean).forEach((date) => {
            counts[date] = (counts[date] || 0) + 1;
        });

        const light = () => window.taller?.setActivity(counts, data.rangeStart, data.rangeEnd);
        if (window.taller) light();
        else window.addEventListener('taller:ready', light, { once: true });

        if (summary) {
            const total = Number(data.total || 0).toLocaleString('es-AR');
            summary.textContent = `${total} contribuciones en ${data.rangeStart.slice(0, 4)}`;
        }
    } catch (_) {
        // sin datos queda el enlace al perfil
    }
}

loadContributions();

// ===== Visitas: una por pestaña, para el panel privado (/admin) =====
// (no usa cookies; el panel deja una marca en este navegador para no contar las visitas propias)
function landing() {
    try {
        const saved = sessionStorage.getItem('portafolio:llegada');
        if (saved) return JSON.parse(saved);
    } catch (_) { }
    return { search: location.search, referrer: document.referrer };
}

function trackVisit() {
    try {
        if (localStorage.getItem('portafolio:propio') || sessionStorage.getItem('portafolio:llegada')) return;
        sessionStorage.setItem('portafolio:llegada', JSON.stringify(landing()));
    } catch (_) {
        return;
    }
    fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...landing(), path: location.pathname, lang: navigator.language }),
        keepalive: true,
    }).catch(() => { });
}

trackVisit();

//año del pie
const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();
