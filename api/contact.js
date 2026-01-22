// api/contact.js

export default async function handler(req, res) {
  // Solo permitimos POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { name, email, subject, message } = req.body || {};

    // Validación simple
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Faltan campos obligatorios." });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;

    if (!RESEND_API_KEY || !CONTACT_TO_EMAIL) {
      return res.status(500).json({ error: "Faltan variables de entorno en Vercel." });
    }

    // Enviar correo con Resend (vía API REST, sin librerías)
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
          <div style="font-family: Arial, sans-serif; line-height:1.5">
            <h2>Nuevo mensaje desde tu portfolio</h2>
            <p><b>Nombre:</b> ${escapeHtml(name)}</p>
            <p><b>Email:</b> ${escapeHtml(email)}</p>
            <p><b>Asunto:</b> ${escapeHtml(subject || "-")}</p>
            <hr />
            <p style="white-space:pre-wrap"><b>Mensaje:</b><br/>${escapeHtml(message)}</p>
          </div>
        `,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(500).json({
        error: data?.message || "No se pudo enviar el mensaje.",
      });
    }

    return res.status(200).json({ message: "Mensaje enviado correctamente." });
  } catch (err) {
    return res.status(500).json({ error: "Error inesperado al enviar." });
  }
}

// Helper para evitar HTML raro en el email
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
