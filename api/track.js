// api/track.js
// Anota una visita para el panel privado (/admin): de dónde llegó, desde qué lugar y con qué equipo.
// No guarda la IP ni usa cookies. Si la base de datos no está configurada, no hace nada.

import { addDoc, clip, dbReady, device, isBot, place, sourceOf, visitorId } from "./_lib/portal.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const ua = String(req.headers["user-agent"] || "");
  if (!dbReady() || isBot(ua)) return res.status(204).end();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const origin = sourceOf({ search: clip(body.search, 500), referrer: clip(body.referrer, 500), ua, host: req.headers.host });

    await addDoc("portfolio_visits", {
      visitor: visitorId(req),
      ...origin,
      path: clip(body.path, 200),
      ...place(req),
      ...device(ua),
      lang: clip(body.lang, 16),
    });
  } catch (_) {
    // una visita sin anotar no es un problema de quien visita
  }
  return res.status(204).end();
}
