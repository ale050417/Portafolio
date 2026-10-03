// api/github.js
// Contribuciones del año en GitHub, para el panel de LEDs del taller.
// Usa la API oficial si hay un token válido; si no hay, o GitHub lo rechaza (por ejemplo, porque
// venció), lee el calendario público del perfil, que no necesita token.

const CAP = 10;

// API oficial (GraphQL): necesita GITHUB_TOKEN
async function fromApi(username, token, year) {
  const query = `
    query ($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }
  `;

  const ghRes = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query,
      variables: { login: username, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    }),
  });

  const data = await ghRes.json().catch(() => ({}));
  if (!ghRes.ok || data.errors) {
    throw new Error(data?.errors?.[0]?.message || data?.message || `GitHub respondió ${ghRes.status}`);
  }

  const calendar = data?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error("GitHub no devolvió el calendario");
  const days = calendar.weeks.flatMap((w) => w.contributionDays.map((d) => [d.date, d.contributionCount || 0]));
  return { days, total: calendar.totalContributions };
}

// calendario público del perfil: el mismo que se ve en github.com, sin token
async function fromProfile(username, year) {
  const ghRes = await fetch(
    `https://github.com/users/${encodeURIComponent(username)}/contributions?from=${year}-01-01&to=${year}-12-31`,
    { headers: { "User-Agent": "portfolio-activity", "X-Requested-With": "XMLHttpRequest" } },
  );
  if (!ghRes.ok) throw new Error(`el calendario público respondió ${ghRes.status}`);
  const html = await ghRes.text();

  // cada día es una celda con su fecha, y la cantidad está en el cartelito (tool-tip) que la acompaña
  const tips = new Map(
    [...html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)].map((m) => [m[1], m[2]]),
  );
  const days = [];
  for (const [tag] of html.matchAll(/<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g)) {
    const date = tag.match(/\bdata-date="([^"]+)"/)[1];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const count = Number((tips.get(id) || "").match(/(\d+) contribution/)?.[1] || 0);
    days.push([date, count]);
  }
  if (!days.length) throw new Error("no se pudo leer el calendario público");
  return { days, total: days.reduce((sum, [, count]) => sum + count, 0) };
}

export default async function handler(req, res) {
  const username = process.env.GITHUB_USERNAME || "ale050417";
  const token = process.env.GITHUB_TOKEN;
  const year = new Date().getUTCFullYear();

  const problems = [];
  let result = null;
  if (token) {
    try {
      result = await fromApi(username, token, year);
    } catch (err) {
      problems.push(`API: ${err.message}`);
    }
  }
  if (!result) {
    try {
      result = await fromProfile(username, year);
    } catch (err) {
      problems.push(`perfil: ${err.message}`);
    }
  }

  if (!result) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "No se pudo leer la actividad de GitHub.", details: problems });
  }

  // la API repite cada fecha una vez por contribución, con tope
  const dates = [];
  for (const [date, count] of result.days) {
    for (let i = 0; i < Math.min(count, CAP); i++) dates.push(date);
  }

  // la actividad cambia poco: la respuesta queda guardada una hora en la red de Vercel
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({
    activityData: dates.join(","),
    rangeStart: `${year}-01-01`,
    rangeEnd: `${year}-12-31`,
    cap: CAP,
    total: result.total,
  });
}
