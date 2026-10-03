// Panel privado del portafolio: visitas y mensajes. Los datos salen de /api/admin.

const $ = (id) => document.getElementById(id);
const number = (n) => Number(n || 0).toLocaleString('es-AR');

// crea un elemento: el texto siempre entra como texto, nunca como HTML
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

async function api(action, { method = 'GET', body, query = '' } = {}) {
    const res = await fetch(`/api/admin?action=${action}${query}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || 'No se pudo completar el pedido.');
        err.status = res.status;
        throw err;
    }
    return data;
}

function notice(node, text) {
    node.textContent = text || '';
    node.hidden = !text;
}

// ---------- entrada ----------
function showGate(message) {
    $('app').hidden = true;
    $('gate').hidden = false;
    notice($('loginStatus'), message);
    $('password').focus();
}

$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('loginButton');
    button.disabled = true;
    notice($('loginStatus'), '');
    try {
        await api('login', { method: 'POST', body: { password: $('password').value } });
        $('password').value = '';
        // las visitas desde este navegador dejan de contarse
        try { localStorage.setItem('portafolio:propio', '1'); } catch (_) { }
        await load();
    } catch (err) {
        notice($('loginStatus'), err instanceof TypeError ? 'No hay conexión.' : err.message);
    } finally {
        button.disabled = false;
    }
});

$('logout').addEventListener('click', async () => {
    await api('logout', { method: 'POST' }).catch(() => { });
    showGate('');
});

// ---------- fechas ----------
const DAY = 86400000;
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const shortDay = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const moment = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const asDate = (key) => new Date(`${key}T00:00:00Z`);

function ago(iso) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'recién';
    if (minutes < 60) return `hace ${minutes} min`;
    if (minutes < 1440) return `hace ${Math.round(minutes / 60)} h`;
    return moment.format(new Date(iso));
}

// ---------- lugares ----------
const regions = new Intl.DisplayNames(['es'], { type: 'region' });
function country(code) {
    if (!code || code === '??') return 'Sin dato';
    try { return regions.of(code) || code; } catch (_) { return code; }
}

// ---------- visitas ----------
const tooltip = $('tooltip');
function tip(node, text) {
    const show = () => {
        const box = node.getBoundingClientRect();
        tooltip.textContent = text;
        tooltip.hidden = false;
        const half = tooltip.offsetWidth / 2 + 8;
        tooltip.style.left = `${Math.min(innerWidth - half, Math.max(half, box.left + box.width / 2))}px`;
        tooltip.style.top = `${box.top + box.height - node.firstElementChild.offsetHeight}px`;
    };
    const hide = () => { tooltip.hidden = true; };
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointerleave', hide);
    node.addEventListener('focus', show);
    node.addEventListener('blur', hide);
}

// un tope redondo y par para el eje (la mitad también se muestra): 4, 6, 8, 10, 20, 30…
function niceMax(value) {
    if (value <= 4) return 4;
    const power = 10 ** Math.floor(Math.log10(value));
    const step = power >= 10 ? power : 2;
    return Math.ceil(value / step) * step;
}

function drawDays(stats, days) {
    const box = $('days');
    box.replaceChildren();
    if (!stats.total) {
        box.append(el('p', 'empty', 'Todavía no hay visitas en este período.'));
        box.style.display = 'block';
        return;
    }
    box.style.display = '';

    // todos los días del período, también los que no tuvieron visitas
    const byDay = new Map(stats.dias.map((d) => [d.dia, d]));
    const today = asDate(dayKey.format(new Date())).getTime();
    const first = stats.dias.length ? Math.min(asDate(stats.dias[0].dia).getTime(), today - (days - 1) * DAY) : today;
    const series = [];
    for (let t = first; t <= today; t += DAY) {
        const key = new Date(t).toISOString().slice(0, 10);
        series.push({ key, visitas: 0, personas: 0, ...byDay.get(key) });
    }

    const max = niceMax(Math.max(...series.map((d) => d.visitas)));
    const scale = el('div', 'days__scale');
    scale.append(el('span', '', number(max)), el('span', '', number(max / 2)), el('span', '', '0'));
    scale.setAttribute('aria-hidden', 'true');

    const plot = el('div', 'days__plot');
    plot.setAttribute('role', 'list');
    for (const d of series) {
        const label = `${longDay.format(asDate(d.key))}: ${number(d.visitas)} ${d.visitas === 1 ? 'visita' : 'visitas'}, ${number(d.personas)} ${d.personas === 1 ? 'persona' : 'personas'}`;
        const col = el('button', 'days__col');
        col.type = 'button';
        col.setAttribute('role', 'listitem');
        col.setAttribute('aria-label', label);
        const bar = el('span', 'days__bar');
        bar.style.height = `${(d.visitas / max) * 100}%`;
        col.append(bar);
        tip(col, label);
        plot.append(col);
    }

    const axis = el('div', 'days__axis');
    axis.setAttribute('aria-hidden', 'true');
    const ends = series.length > 1 ? [series[0], series[Math.floor((series.length - 1) / 2)], series[series.length - 1]] : [series[0]];
    [...new Set(ends)].forEach((d) => axis.append(el('span', '', shortDay.format(asDate(d.key)))));

    box.append(scale, plot, axis);
}

function drawRows(id, items, { name = (i) => i.nombre, extra } = {}) {
    const list = $(id);
    list.replaceChildren();
    if (!items.length) {
        list.append(el('li', 'empty', 'Sin datos todavía.'));
        return;
    }
    const max = Math.max(...items.map((i) => i.visitas));
    for (const item of items) {
        const li = el('li');
        const value = el('span', 'rows__value', number(item.visitas));
        if (extra) value.append(el('small', '', extra(item)));
        const track = el('span', 'rows__track');
        const fill = el('span', 'rows__fill');
        fill.style.width = `${(item.visitas / max) * 100}%`;
        track.append(fill);
        li.append(el('span', 'rows__name', name(item)), value, track);
        list.append(li);
    }
}

function drawVisits({ stats, recent, messages, days }) {
    const unread = messages.filter((m) => !m.is_read).length;
    const tiles = [
        [number(stats.total), 'visitas'],
        [number(stats.personas), 'personas distintas'],
        [stats.fuentes[0]?.nombre || '—', 'origen principal'],
        [number(unread), unread === 1 ? 'mensaje sin leer' : 'mensajes sin leer'],
    ];
    $('tiles').replaceChildren(...tiles.map(([value, label]) => {
        const li = el('li');
        const strong = el('strong', '', value);
        strong.title = value;
        li.append(strong, document.createTextNode(label));
        return li;
    }));

    drawDays(stats, days);
    drawRows('sources', stats.fuentes, { extra: (i) => `${Math.round((i.visitas / stats.total) * 100)} %` });
    drawRows('countries', stats.paises, { name: (i) => country(i.nombre) });
    drawRows('cities', stats.ciudades);
    drawRows('devices', stats.dispositivos);
    $('campaignsBox').hidden = !stats.campanas.length;
    drawRows('campaigns', stats.campanas);

    const body = $('recent');
    body.replaceChildren();
    if (!recent.length) {
        const cell = el('td', 'empty', 'Todavía no hay visitas en este período.');
        cell.colSpan = 4;
        const row = el('tr');
        row.append(cell);
        body.append(row);
    }
    for (const v of recent) {
        const row = el('tr');
        const when = el('td', '', ago(v.created_at));
        when.title = moment.format(new Date(v.created_at));
        const origin = el('td', '', v.source);
        const detail = v.campaign || (v.referrer && v.referrer.toLowerCase() !== v.source.toLowerCase() ? v.referrer : '');
        if (detail) origin.append(el('small', '', detail));
        const where = [v.city, country(v.country)].filter(Boolean).join(', ');
        row.append(when, origin, el('td', '', where), el('td', '', [v.device, v.os, v.browser].filter(Boolean).join(' · ')));
        body.append(row);
    }
}

// ---------- mensajes ----------
let state = null;

function drawMessages() {
    const { messages } = state;
    const unread = messages.filter((m) => !m.is_read).length;
    $('unreadBadge').textContent = unread;
    $('unreadBadge').hidden = !unread;

    const inbox = $('inbox');
    inbox.replaceChildren();
    if (!messages.length) {
        inbox.append(el('li', 'card empty', 'Todavía no llegó ningún mensaje. Cuando alguien escriba desde el formulario, aparece acá aunque el mail no llegue.'));
        return;
    }

    for (const m of messages) {
        const li = el('li', m.is_read ? 'msg' : 'msg msg--new');

        const head = el('div', 'msg__head');
        const name = el('h2', 'msg__name', m.name);
        if (!m.is_read) name.append(el('span', '', 'Nuevo'));
        head.append(name, el('time', 'msg__when', moment.format(new Date(m.created_at))));

        const meta = el('p', 'msg__meta');
        const mail = el('a', '', m.email);
        mail.href = `mailto:${m.email}`;
        meta.append(mail);
        if (m.subject) meta.append(el('span', '', `Asunto: ${m.subject}`));
        if (m.source) meta.append(el('span', '', `Llegó por ${m.source}`));
        const where = [m.city, m.country ? country(m.country) : ''].filter(Boolean).join(', ');
        if (where) meta.append(el('span', '', where));
        meta.append(el('span', '', m.emailed ? 'Aviso por mail enviado' : 'Sin aviso por mail'));

        const actions = el('div', 'msg__actions');
        const reply = el('a', 'btn btn--glow btn--sm', 'Responder');
        reply.href = `mailto:${m.email}?subject=${encodeURIComponent('Re: ' + (m.subject || 'Tu mensaje en mi portafolio'))}`;

        const toggle = el('button', 'btn btn--glass btn--sm', m.is_read ? 'Marcar como no leído' : 'Marcar como leído');
        toggle.type = 'button';
        toggle.addEventListener('click', () => change(toggle, 'read', { id: m.id, read: !m.is_read }, () => { m.is_read = !m.is_read; }));

        // se borra en dos pasos, para no perder un mensaje por un toque de más
        const remove = el('button', 'btn btn--glass btn--sm btn--danger', 'Eliminar');
        remove.type = 'button';
        remove.addEventListener('click', () => {
            if (remove.dataset.armed) {
                change(remove, 'delete', { id: m.id }, () => { state.messages = state.messages.filter((x) => x !== m); });
                return;
            }
            remove.dataset.armed = '1';
            remove.textContent = '¿Eliminar para siempre?';
            setTimeout(() => {
                delete remove.dataset.armed;
                remove.textContent = 'Eliminar';
            }, 4000);
        });

        actions.append(reply, toggle, remove);
        li.append(head, meta, el('p', 'msg__text', m.message), actions);
        inbox.append(li);
    }
}

async function change(button, action, body, apply) {
    button.disabled = true;
    notice($('appStatus'), '');
    try {
        await api(action, { method: 'POST', body });
        apply();
        drawMessages();
        drawVisits(state);
    } catch (err) {
        if (err.status === 401) return showGate('La sesión se cerró. Entrá de nuevo.');
        notice($('appStatus'), err.message);
        button.disabled = false;
    }
}

// ---------- pestañas ----------
function show(tab) {
    const messages = tab === 'messages';
    $('visits').hidden = messages;
    $('messages').hidden = !messages;
    $('rangeBox').hidden = messages;
    $('tabVisits').setAttribute('aria-selected', String(!messages));
    $('tabMessages').setAttribute('aria-selected', String(messages));
    try { sessionStorage.setItem('panel:pestaña', tab); } catch (_) { }
}

$('tabVisits').addEventListener('click', () => show('visits'));
$('tabMessages').addEventListener('click', () => show('messages'));
$('range').addEventListener('change', load);

// ---------- carga ----------
async function load() {
    try {
        state = await api('data', { query: `&days=${$('range').value}` });
        $('gate').hidden = true;
        $('app').hidden = false;
        notice($('appStatus'), '');
        drawVisits(state);
        drawMessages();
    } catch (err) {
        if (err.status === 401) return showGate('');
        if ($('app').hidden) return showGate(err instanceof TypeError ? 'No hay conexión.' : err.message);
        notice($('appStatus'), err.message);
    }
}

let saved = 'visits';
try { saved = sessionStorage.getItem('panel:pestaña') || 'visits'; } catch (_) { }
show(saved);
load();
