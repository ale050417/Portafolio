// api/_lib/portal.js
// Lo que comparten el registro de visitas, el formulario de contacto y el panel privado (/admin):
// la base de datos (Firestore), la sesión del panel y de dónde llegó cada visita.

import { createHash, createHmac, createSign, timingSafeEqual } from "node:crypto";

// ---------- base de datos: Firestore, por su API REST ----------
// La cuenta de servicio va en FIREBASE_SERVICE_ACCOUNT: el JSON completo de la clave (o ese JSON en base64).
let cachedAccount;
function account() {
  if (cachedAccount !== undefined) return cachedAccount;
  cachedAccount = null;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        cachedAccount = { ...parsed, private_key: parsed.private_key.replaceAll("\\n", "\n") };
      }
    } catch (_) {}
  }
  return cachedAccount;
}

export const dbReady = () => Boolean(account());

// Google entrega un pase de una hora a cambio de un pedido firmado con la clave
let pass = { value: "", expires: 0 };
async function accessToken() {
  if (pass.expires > Date.now() + 60000) return pass.value;
  const { client_email, private_key } = account();
  const now = Math.floor(Date.now() / 1000);
  const part = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const claims = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(private_key, "base64url");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(data.error_description || "Firebase rechazó la clave de la cuenta de servicio.");
  }
  pass = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return pass.value;
}

async function firestore(path, { method = "GET", body } = {}) {
  if (!dbReady()) throw new Error("Falta cargar FIREBASE_SERVICE_ACCOUNT en Vercel.");
  const base = `https://firestore.googleapis.com/v1/projects/${account().project_id}/databases/(default)/documents`;
  const resp = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await resp.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {}
  if (!resp.ok) {
    const problem = Array.isArray(data) ? data[0]?.error : data?.error;
    throw new Error(problem?.message || `La base de datos respondió ${resp.status}`);
  }
  return data;
}

// Firestore guarda cada valor con su tipo; los campos que terminan en _at son fechas (texto ISO)
const toValue = (key, value) =>
  value === null || value === undefined ? { nullValue: null }
  : typeof value === "boolean" ? { booleanValue: value }
  : key.endsWith("_at") ? { timestampValue: value }
  : { stringValue: String(value) };

const toFields = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toValue(key, value)]));

const fromValue = (value) =>
  "stringValue" in value ? value.stringValue
  : "booleanValue" in value ? value.booleanValue
  : "timestampValue" in value ? value.timestampValue
  : "integerValue" in value ? Number(value.integerValue)
  : null;

const fromDoc = (doc) => ({
  id: doc.name.split("/").pop(),
  ...Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, fromValue(value)])),
});

// agrega un documento con la fecha de ahora y devuelve su id
export async function addDoc(collection, data) {
  const doc = await firestore(`/${collection}`, {
    method: "POST",
    body: { fields: toFields({ ...data, created_at: new Date().toISOString() }) },
  });
  return doc.name.split("/").pop();
}

// cambia solo los campos indicados de un documento que ya existe
export async function updateDoc(collection, id, data) {
  const mask = Object.keys(data).map((key) => `updateMask.fieldPaths=${key}`).join("&");
  await firestore(`/${collection}/${id}?${mask}&currentDocument.exists=true`, { method: "PATCH", body: { fields: toFields(data) } });
}

export async function deleteDoc(collection, id) {
  await firestore(`/${collection}/${id}`, { method: "DELETE" });
}

// los documentos más nuevos primero; since: fecha ISO desde la que se buscan
export async function listDocs(collection, { since, limit = 200 } = {}) {
  const where = since
    ? { where: { fieldFilter: { field: { fieldPath: "created_at" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since } } } }
    : {};
  const rows = await firestore(":runQuery", {
    method: "POST",
    body: {
      structuredQuery: {
        from: [{ collectionId: collection }],
        ...where,
        orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
        limit,
      },
    },
  });
  return (rows || []).filter((row) => row.document).map((row) => fromDoc(row.document));
}

// ---------- resumen de las visitas ----------
// Firestore no agrupa: el resumen se arma acá, con las visitas del período
function group(visits, key, limit) {
  const groups = new Map();
  for (const visit of visits) {
    const name = key(visit);
    if (name === null || name === undefined || name === "") continue;
    const found = groups.get(name) || { nombre: name, visitas: 0, people: new Set() };
    found.visitas += 1;
    found.people.add(visit.visitor);
    groups.set(name, found);
  }
  return [...groups.values()]
    .sort((a, b) => b.visitas - a.visitas || String(a.nombre).localeCompare(String(b.nombre)))
    .slice(0, limit || undefined)
    .map(({ people, ...rest }) => ({ ...rest, personas: people.size }));
}

// el día de cada visita, en hora de Argentina (UTC-3, sin horario de verano)
const argentineDay = (iso) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);

export function summarize(visits) {
  return {
    total: visits.length,
    personas: new Set(visits.map((visit) => visit.visitor)).size,
    fuentes: group(visits, (visit) => visit.source),
    dias: group(visits, (visit) => argentineDay(visit.created_at))
      .map(({ nombre, ...rest }) => ({ dia: nombre, ...rest }))
      .sort((a, b) => a.dia.localeCompare(b.dia)),
    paises: group(visits, (visit) => visit.country || "??", 8),
    ciudades: group(visits, (visit) => visit.city, 8),
    dispositivos: group(visits, (visit) => visit.device || "Sin dato"),
    campanas: group(visits, (visit) => visit.campaign, 8),
  };
}

// ---------- sesión del panel ----------
const COOKIE = "portafolio_admin";
const SESSION_DAYS = 7;

export const adminReady = () => Boolean(process.env.ADMIN_PASSWORD);

// la firma depende de la contraseña: si se cambia, las sesiones abiertas dejan de valer
const sessionKey = () => createHash("sha256").update(`portafolio-admin:${process.env.ADMIN_PASSWORD}`).digest();
const sign = (value) => createHmac("sha256", sessionKey()).update(value).digest("hex");

function same(a, b) {
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export const passwordOk = (password) => adminReady() && same(password ?? "", process.env.ADMIN_PASSWORD);

export function sessionCookie() {
  const expires = String(Date.now() + SESSION_DAYS * 86400000);
  return `${COOKIE}=${expires}.${sign(expires)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function hasSession(req) {
  if (!adminReady()) return false;
  const found = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!found) return false;
  const [expires, signature] = found.slice(COOKIE.length + 1).split(".");
  if (!expires || !signature || !same(signature, sign(expires))) return false;
  return Number(expires) > Date.now();
}

// ---------- quién visita ----------
export const clip = (value, max) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
};

const header = (req, name) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value || "";
};

// Vercel agrega de dónde es la conexión
export function place(req) {
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  };
  return {
    country: clip(header(req, "x-vercel-ip-country"), 8),
    region: clip(header(req, "x-vercel-ip-country-region"), 16),
    city: clip(decode(header(req, "x-vercel-ip-city")), 80),
  };
}

// huella para contar personas: no se guarda la IP, solo este hash
export function visitorId(req) {
  const ip = header(req, "x-real-ip") || header(req, "x-forwarded-for").split(",")[0].trim();
  const salt = account()?.private_key_id || "";
  return createHash("sha256").update(`${ip}|${header(req, "user-agent")}|${salt}`).digest("hex").slice(0, 20);
}

export const isBot = (ua) =>
  !ua || /bot|crawl|spider|slurp|preview|scan|monitor|lighthouse|headless|pingdom|facebookexternalhit|whatsapp\/|curl|wget|python|node-fetch|axios/i.test(ua);

export function device(ua) {
  const tablet = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua);
  const mobile = /Mobi|iPhone|Android/i.test(ua);
  const os = /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux" : "Otro";
  const browser = /Instagram/i.test(ua) ? "Instagram"
    : /FBAN|FBAV/i.test(ua) ? "Facebook"
    : /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /SamsungBrowser/i.test(ua) ? "Samsung Internet"
    : /Firefox|FxiOS/i.test(ua) ? "Firefox"
    : /Chrome|CriOS/i.test(ua) ? "Chrome"
    : /Safari/i.test(ua) ? "Safari" : "Otro";
  return { device: tablet ? "Tablet" : mobile ? "Celular" : "Computadora", os, browser };
}

// ---------- de dónde llegó ----------
// nombres prolijos para lo que venga en el enlace (?de=instagram, ?utm_source=ig…)
const NAMES = {
  ig: "Instagram", instagram: "Instagram", insta: "Instagram",
  fb: "Facebook", facebook: "Facebook",
  google: "Google", linkedin: "LinkedIn", li: "LinkedIn",
  wpp: "WhatsApp", wa: "WhatsApp", whatsapp: "WhatsApp",
  x: "X", twitter: "X", tiktok: "TikTok", youtube: "YouTube", github: "GitHub",
  cv: "CV", mail: "Mail", email: "Mail", qr: "QR",
};

// sitios desde los que suelen llegar (el orden importa: Google Play va antes que Google)
const HOSTS = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"],
  [/^play\.google\.com$/, "Google Play"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\.com$/, "Yahoo"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/(^|\.)(twitter\.com|x\.com)$|^t\.co$/, "X"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)orbita\.site$/, "Órbita"],
  [/(^|\.)hefesto3d\.com\.ar$/, "Hefesto 3D"],
];

// search: lo que viene después del "?" en el enlace · referrer: la página anterior · host: este sitio
export function sourceOf({ search, referrer, ua, host }) {
  const params = new URLSearchParams(search || "");
  const campaign = clip(params.get("utm_campaign") || params.get("campaign"), 80);

  let refHost = null;
  try {
    refHost = referrer ? new URL(referrer).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch (_) {}
  // una vuelta dentro del mismo sitio no es un origen
  if (refHost && host && refHost === host.toLowerCase().replace(/^www\./, "").split(":")[0]) refHost = null;

  const done = (source) => ({ source, referrer: refHost, campaign });

  // 1. lo que diga el enlace
  const tagged = clip(params.get("utm_source") || params.get("de") || params.get("ref") || params.get("source"), 40);
  if (tagged) return done(NAMES[tagged.toLowerCase()] || tagged);
  if (params.has("igshid") || params.has("igsh")) return done("Instagram");
  if (params.has("gclid")) return done("Google");

  // 2. el navegador de adentro de cada app
  if (/Instagram/i.test(ua)) return done("Instagram");
  if (/FBAN|FBAV/i.test(ua)) return done("Facebook");
  if (/LinkedInApp/i.test(ua)) return done("LinkedIn");
  if (/TikTok|musical_ly|Bytedance/i.test(ua)) return done("TikTok");

  // 3. la página anterior
  if (refHost) return done(HOSTS.find(([pattern]) => pattern.test(refHost))?.[1] || refHost);
  if (params.has("fbclid")) return done("Facebook");

  // 4. sin datos: escribió la dirección, o abrió el enlace desde WhatsApp, un mail o un PDF
  return done("Directo");
}
