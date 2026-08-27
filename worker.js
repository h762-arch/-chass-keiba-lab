const TRACK_NAMES = {
  19: "船橋",
  22: "笠松",
  27: "園田",
  28: "姫路",
  36: "門別"
};

const PUBLIC_PATHS = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/manifest.webmanifest"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function fmtDate(date) {
  return String(date || "").replaceAll("-", "/");
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; ChassKeibaLab/7.2; +https://www.keiba.go.jp/)",
      "accept-language": "ja,en;q=0.8"
    }
  });
  if (!r.ok) throw new Error(`NAR HTTP ${r.status}`);
  return await r.text();
}

function parseFinishOrder(refundHtml) {
  const text = cleanText(refundHtml);
  let m = text.match(/三連単\s*([0-9]+)\s*[-－]\s*([0-9]+)\s*[-－]\s*([0-9]+)/);
  if (m) return [m[1], m[2], m[3]];

  m = text.match(/複勝\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)/);
  return m ? [m[1], m[2], m[3]] : [];
}

function parseTanFuku(html) {
  const rows = [];
  const text = cleanText(html);
  const checked =
    (text.match(/単勝・複勝[^（]*(?:（([^）]+)）)?/) || [])[1] ||
    ((text.match(/（最終）/) || [])[0] ? "最終" : "");

  const tr = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(x => cleanText(x[1]));

  for (const row of tr) {
    const m = row.match(
      /^\s*(\d+)\s+(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([\d.]+\s*[-－]\s*[\d.]+|\d+(?:\.\d+)?)\s+(\d+)\s+/
    );
    if (m) {
      rows.push({
        frameNo: Number(m[1]),
        horseNo: String(m[2]),
        horseName: m[3].trim(),
        winOdds: Number(m[4]),
        popularity: Number(m[6])
      });
      continue;
    }

    const m2 = row.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+/);
    if (m2 && Number(m2[2]) <= 18) {
      rows.push({
        frameNo: Number(m2[1]),
        horseNo: String(m2[2]),
        horseName: m2[3].trim(),
        winOdds: Number(m2[4]),
        popularity: null
      });
    }
  }

  if (rows.length) {
    const sorted = [...rows].sort((a, b) => a.winOdds - b.winOdds);
    sorted.forEach((x, i) => {
      if (!x.popularity) x.popularity = i + 1;
    });
  }

  return { checkedAt: checked || "NAR公式", odds: rows };
}

function parseActualTimes(resultHtml) {
  const out = {};
  const tr = [...resultHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(x => cleanText(x[1]));

  for (const row of tr) {
    const tm = row.match(/(\d+):([0-5]\d(?:\.\d+)?)/);
    if (!tm) continue;

    const nums = [...row.matchAll(/(?:^|\s)(\d{1,2})(?=\s)/g)].map(m => m[1]);
    const horseNo = nums.find(n => Number(n) >= 1 && Number(n) <= 18);

    if (horseNo && !out[horseNo]) out[horseNo] = tm[0];
  }
  return out;
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);

    if (u.pathname === "/api/health") {
      return json({ ok: true, version: "7.2", service: "chass-keiba-lab" });
    }

    if (u.pathname === "/api/nar/sync") {
      const code = u.searchParams.get("code");
      const date = u.searchParams.get("date");
      const race = u.searchParams.get("race");

      if (!code || !date || !race) {
        return json({ error: "code,date,race are required" }, 400);
      }

      const d = encodeURIComponent(fmtDate(date));
      const q =
        `k_babaCode=${encodeURIComponent(code)}` +
        `&k_raceDate=${d}` +
        `&k_raceNo=${encodeURIComponent(race)}`;

      const refund =
        `https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RefundMoneyList?${q}`;
      const odds =
        `https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/OddsTanFuku_ipat?${q}`;
      const result =
        `https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`;

      try {
        const [refundHtml, oddsHtml, resultHtml] = await Promise.all([
          fetchText(refund).catch(() => ""),
          fetchText(odds).catch(() => ""),
          fetchText(result).catch(() => "")
        ]);

        const finishOrder = refundHtml ? parseFinishOrder(refundHtml) : [];
        const market = oddsHtml
          ? parseTanFuku(oddsHtml)
          : { checkedAt: "", odds: [] };
        const actualTimes = resultHtml ? parseActualTimes(resultHtml) : {};

        return json({
          source: "NAR公式",
          track: TRACK_NAMES[Number(code)] || "",
          code,
          date,
          race,
          finishOrder,
          actualTimes,
          ...market,
          pending: finishOrder.length < 3,
          urls: { refund, odds, result }
        });
      } catch (e) {
        return json(
          { error: String(e?.message || e), source: "NAR公式" },
          502
        );
      }
    }

    // Rootに置かれたアプリ用ファイルだけを公開する。
    // package.json / worker.js / wrangler.jsonc / README.md 等は公開しない。
    if (PUBLIC_PATHS.has(u.pathname)) {
      const assetUrl = new URL(request.url);
      if (u.pathname === "/") assetUrl.pathname = "/index.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return new Response("Not Found", { status: 404 });
  }
};
