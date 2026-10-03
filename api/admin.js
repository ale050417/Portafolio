// api/admin.js
// Panel privado (/admin): entrar con contraseña, ver las visitas y leer los mensajes del formulario.
// Necesita ADMIN_PASSWORD y la base de datos (FIREBASE_SERVICE_ACCOUNT) en Vercel.

import { adminReady, clearCookie, dbReady, deleteDoc, hasSession, listDocs, passwordOk, sessionCookie, summarize, updateDoc } from "./_lib/portal.js";

const RANGES = [1, 7, 30, 90, 365];
// tope de visitas que se leen para armar el resumen de un período
const MAX_VISITS = 20000;
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = String(req.query?.action || "");

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    if (!adminReady()) {
      return res.status(503).json({ error: "Falta cargar ADMIN_PASSWORD en Vercel." });
    }

    if (action === "login" && req.method === "POST") {
      if (!passwordOk(body.password)) {
        // frena a quien prueba contraseñas
        await wait(900);
        return res.status(401).json({ error: "Contraseña incorrecta." });
      }
      res.setHeader("Set-Cookie", sessionCookie());
      return res.status(200).json({ ok: true });
    }

    if (action === "logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", clearCookie());
      return res.status(200).json({ ok: true });
    }

    if (!hasSession(req)) return res.status(401).json({ error: "Sesión cerrada." });

    if (!dbReady()) {
      return res.status(503).json({ error: "Falta cargar FIREBASE_SERVICE_ACCOUNT en Vercel." });
    }

    if (action === "data" && req.method === "GET") {
      const days = RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [visits, messages] = await Promise.all([
        listDocs("portfolio_visits", { since, limit: MAX_VISITS }),
        listDocs("portfolio_messages", { limit: 200 }),
      ]);
      return res.status(200).json({ days, stats: summarize(visits), recent: visits.slice(0, 60), messages });
    }

    const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(body.id || "")) ? String(body.id) : null;
    if (action === "read" && req.method === "POST" && id) {
      await updateDoc("portfolio_messages", id, { is_read: Boolean(body.read) });
      return res.status(200).json({ ok: true });
    }

    if (action === "delete" && req.method === "POST" && id) {
      await deleteDoc("portfolio_messages", id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Pedido no válido." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Error inesperado." });
  }
}
