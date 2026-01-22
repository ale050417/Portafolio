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
        from: "Portafolio <onboarding@resend.dev>",
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

const subject = `Portfolio: ${data.subject || "Nuevo mensaje"}`;

const html = `
  <div style="background:#0b1220;padding:24px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#111a2c;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;">
      
      <div style="padding:18px 20px;background:linear-gradient(90deg,#4FC6CE22,#4FC6CE00);border-bottom:1px solid rgba(255,255,255,.08);">
        <h2 style="margin:0;color:#e8f1f3;font-size:18px;letter-spacing:.2px;">
          Nuevo mensaje desde tu portafolio
        </h2>
        <p style="margin:6px 0 0;color:#9bb1ba;font-size:13px;">
          Enviado desde el formulario de contacto
        </p>
      </div>

      <div style="padding:18px 20px;color:#dbe3e6;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:10px 0;color:#9bb1ba;width:110px;">Nombre</td>
            <td style="padding:10px 0;color:#e8f1f3;">${escapeHtml(data.name)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#9bb1ba;">Email</td>
            <td style="padding:10px 0;">
              <a href="mailto:${escapeHtml(data.email)}" style="color:#4FC6CE;text-decoration:none;font-weight:600;">
                ${escapeHtml(data.email)}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#9bb1ba;">Asunto</td>
            <td style="padding:10px 0;color:#e8f1f3;">${escapeHtml(data.subject || "-")}</td>
          </tr>
        </table>

        <div style="margin-top:14px;padding:14px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);">
          <div style="color:#9bb1ba;font-size:12px;margin-bottom:8px;">Mensaje</div>
          <div style="white-space:pre-wrap;line-height:1.55;color:#e8f1f3;font-size:14px;">
            ${escapeHtml(data.message)}
          </div>
        </div>

        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="mailto:${escapeHtml(data.email)}?subject=Re:%20${encodeURIComponent(data.subject || "Contacto")}"
             style="display:inline-block;background:#4FC6CE;color:#0b1220;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700;font-size:13px;">
            Responder
          </a>
          <span style="color:#9bb1ba;font-size:12px;align-self:center;">
            ${new Date().toLocaleString("es-AR")}
          </span>
        </div>
      </div>

      <div style="padding:14px 20px;border-top:1px solid rgba(255,255,255,.08);color:#9bb1ba;font-size:12px;">
        Portfolio · Formulario de contacto
      </div>
    </div>
  </div>
`;


// Helper para evitar HTML raro en el email
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

