// api/contact.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const { name, email, subject, message, website } = req.body || {};

    // honeypot anti-spam
    if (website) {
      return res.status(200).json({ ok: true });
    }

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Faltan campos requeridos." });
    }

    // ✅ ACÁ elegís cómo enviar:
    // Opción A: Resend (recomendado)
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const TO_EMAIL = process.env.CONTACT_TO_EMAIL; // tu email destino
    const FROM_EMAIL = process.env.CONTACT_FROM_EMAIL; // dominio verificado en Resend

    if (!RESEND_API_KEY || !TO_EMAIL || !FROM_EMAIL) {
      return res.status(500).json({ error: "Faltan variables de entorno para email." });
    }

    const payload = {
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: subject ? `Portafolio: ${subject}` : "Nuevo mensaje desde tu portafolio",
      reply_to: email,
      text:
        `Nuevo mensaje desde el portafolio\n\n` +
        `Nombre: ${name}\n` +
        `Email: ${email}\n` +
        `Asunto: ${subject || "(sin asunto)"}\n\n` +
        `Mensaje:\n${message}\n`,
    };

    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await sendRes.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}

    if (!sendRes.ok) {
      return res.status(500).json({ error: "Error enviando email", details: data });
    }

    return res.status(200).json({ ok: true, id: data?.id });
  } catch (err) {
    return res.status(500).json({ error: "Error inesperado", detail: String(err) });
  }
}
