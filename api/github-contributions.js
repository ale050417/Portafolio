export default async function handler(req, res) {
  try {
    const username = process.env.GITHUB_USERNAME;
    const token = process.env.GITHUB_TOKEN;

    if (!username) {
      return res.status(500).json({ error: "Falta GITHUB_USERNAME en Vercel." });
    }

    const query = `
      query ($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `;

    const ghRes = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables: { login: username } }),
    });

    const data = await ghRes.json();

    if (!ghRes.ok || data.errors) {
      return res.status(500).json({
        error: data?.errors?.[0]?.message || "Error consultando GitHub GraphQL",
        details: data,
      });
    }

    const weeks =
      data.user.contributionsCollection.contributionCalendar.weeks || [];

    // activity-graph usa "activity-data" como lista de fechas repetidas
    // Para no explotar el tamaño, capeo a 10 repeticiones por día
    const CAP = 10;
    const dates = [];

    for (const w of weeks) {
      for (const d of w.contributionDays) {
        const repeat = Math.min(d.contributionCount || 0, CAP);
        for (let i = 0; i < repeat; i++) dates.push(d.date);
      }
    }

    // Rango (último año aprox)
    const allDays = weeks.flatMap(w => w.contributionDays);
    const rangeStart = allDays[0]?.date;
    const rangeEnd = allDays[allDays.length - 1]?.date;

    return res.status(200).json({
      activityData: dates.join(","),
      rangeStart,
      rangeEnd,
      cap: CAP,
      total:
        data.user.contributionsCollection.contributionCalendar.totalContributions,
    });
  } catch (err) {
    return res.status(500).json({ error: "Error inesperado.", detail: String(err) });
  }
}
