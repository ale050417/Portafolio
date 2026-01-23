
export default async function handler(req, res) {
  try {
    const username = process.env.GITHUB_USERNAME;
    const token = process.env.GITHUB_TOKEN;

    if (!username) {
      return res.status(500).json({ error: "Falta GITHUB_USERNAME en Vercel." });
    }

    // SOLO 2026
    const from = "2026-01-01T00:00:00Z";
    const to   = "2026-12-31T23:59:59Z";

    const query = `
      query ($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to, includePrivateContributions: true) {
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
      body: JSON.stringify({
        query,
        variables: { login: username, from, to },
      }),
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

    const CAP = 10;
    const dates = [];

    for (const w of weeks) {
      for (const d of w.contributionDays) {
        const repeat = Math.min(d.contributionCount || 0, CAP);
        for (let i = 0; i < repeat; i++) dates.push(d.date);
      }
    }

    return res.status(200).json({
      activityData: dates.join(","),
      rangeStart: "2026-01-01",
      rangeEnd: "2026-06-31",
      cap: CAP,
      total:
        data.user.contributionsCollection.contributionCalendar.totalContributions,
    });
  } catch (err) {
    return res.status(500).json({ error: "Error inesperado.", detail: String(err) });
  }
}