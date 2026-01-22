export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { name, email, subject, message, website } = req.body || {};

    // antispam
    if (website) {
      return res.status(200).json({ message: "OK" });
    }

    // Validación simple
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Faltan campos obligatorios." });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;

    if (!RESEND_API_KEY || !CONTACT_TO_EMAIL) {
      return res
        .status(500)
        .json({ error: "Faltan variables de entorno en Vercel." });
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Portfolio <onboarding@resend.dev>",
        to: [CONTACT_TO_EMAIL],
        reply_to: email,
        subject: subject?.trim()
          ? `Portfolio: ${subject.trim()}`
          : `Portfolio: Nuevo mensaje de ${name}`,
        html: `
          <div style="background:#0b1220;padding:24px">
            <div style="max-width:640px;margin:0 auto;background:#111a2c;border:1px solid rgba(79,198,206,.35);border-radius:14px;overflow:hidden">
              <div style="padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.08)">
                <h2 style="margin:0;color:#DBDBDB;font-family:Arial,sans-serif">
                  Nuevo mensaje desde tu portfolio
                </h2>
                <p style="margin:6px 0 0;color:#98B1BA;font-family:Arial,sans-serif;font-size:13px">
                  ${new Date().toISOString()}
                </p>
              </div>

              <div style="padding:18px 20px;font-family:Arial,sans-serif;color:#DBDBDB;line-height:1.5">
                <p style="margin:0 0 10px"><b style="color:#4FC6CE">Nombre:</b> ${escapeHtml(name)}</p>
                <p style="margin:0 0 10px"><b style="color:#4FC6CE">Email:</b> ${escapeHtml(email)}</p>
                <p style="margin:0 0 14px"><b style="color:#4FC6CE">Asunto:</b> ${escapeHtml(subject || "-")}</p>

                <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px">
                  <b style="color:#4FC6CE">Mensaje</b>
                  <div style="margin-top:10px;white-space:pre-wrap;color:#DBDBDB">${escapeHtml(message)}</div>
                </div>
              </div>
            </div>
          </div>
        `,
      }),
    });

    const raw = await resp.text();

    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {}

    if (!resp.ok) {
      return res.status(500).json({
        error: data?.message || raw || "No se pudo enviar el mensaje.",
      });
    }

    return res.status(200).json({ message: "Mensaje enviado correctamente." });
  } catch (err) {
    return res.status(500).json({ error: "Error inesperado al enviar." });
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
