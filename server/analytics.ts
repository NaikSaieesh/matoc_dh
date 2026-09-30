/**
 * Port of charts.py: Complete Analytical Engine for MATOC Dashboards,
 * Contractor Intelligence, Modification Intelligence, and Standalone HTML Export.
 */

export const OUR_COMPANY = "Addon Services LLC";

export function priceBand(pct: number): string {
  if (pct <= -50) return "Priced <= -50% (Very Low)";
  if (pct < 0) return "Below Winner (-50% to 0%)";
  if (pct === 0) return "Exact Match (tied the winning price)";
  if (pct < 50) return "Overpriced 1-50%";
  if (pct < 100) return "Overpriced 50-99%";
  return "OVERPRICED 100%+ CRITICAL";
}

export interface PreparedBidRow {
  Year: string;
  "Project Type": string;
  Awardee: string;
  Awardee_short: string;
  "Resume Names"?: string;
  "Contract Value": number;
  "Addon Bid": number;
  "Asterisk Bid": string;
  "Winner Price Difference $": number;
  "Winner Price Difference %": number;
  PriceDiffPct: number;
  PriceBand: string;
  "Number of Offers Received": number;
  Result: string;
  Mods: number;
  Total: number;
  "Linked Mods Total": number;
}

export function prepareDataframe(
  rawRows: Record<string, any>[],
  excludeAsteriskBids: boolean = true
): { rows: PreparedBidRow[]; hasAsteriskBid: boolean } {
  let hasAsteriskBid = false;

  const rows: PreparedBidRow[] = rawRows.map((raw) => {
    const toNum = (v: any) => {
      const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
      return isNaN(n) ? 0 : n;
    };

    let contractValue = toNum(raw["Contract Value"]);
    let addonBid = toNum(raw["Addon Bid"]);
    let diffUsd = toNum(raw["Winner Price Difference $"]);
    let diffPct = toNum(raw["Winner Price Difference %"]);
    const offers = toNum(raw["Number of Offers Received"]);
    const mods = toNum(raw["Mods"]);
    const total = toNum(raw["Total"]);
    const linkedMods = toNum(raw["Linked Mods Total"]);

    const year = String(raw["Year"] ?? "").trim();
    let result = String(raw["Result"] ?? "").trim().toUpperCase();
    const projectType = String(raw["Project Type"] ?? "").trim() || "Unspecified";
    const awardee = String(raw["Awardee"] ?? "").trim();
    const awardeeShort =
      awardee
        .replace(/\b(LLC|INC|JV|Corp|Services|Facility|Support)\b|[.,]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 24) || "Unspecified";

    const asteriskBid = String(raw["Asterisk Bid"] ?? "").trim().toUpperCase();
    if (asteriskBid === "YES") {
      hasAsteriskBid = true;
    }

    if (excludeAsteriskBids && asteriskBid === "YES") {
      result = "NB";
      addonBid = 0;
      diffUsd = 0;
      diffPct = 0;
    }

    return {
      Year: year,
      "Project Type": projectType,
      Awardee: awardee,
      Awardee_short: awardeeShort,
      "Resume Names": raw["Resume Names"] != null ? String(raw["Resume Names"]).trim() : undefined,
      "Contract Value": contractValue,
      "Addon Bid": addonBid,
      "Asterisk Bid": asteriskBid,
      "Winner Price Difference $": diffUsd,
      "Winner Price Difference %": diffPct,
      PriceDiffPct: diffPct,
      PriceBand: priceBand(diffPct),
      "Number of Offers Received": offers,
      Result: result,
      Mods: mods,
      Total: total,
      "Linked Mods Total": linkedMods,
    };
  });

  return { rows, hasAsteriskBid };
}

export function computeKpis(rows: PreparedBidRow[]) {
  const total_bids = rows.length;
  const wonRows = rows.filter((r) => r.Result === "WON");
  const lostRows = rows.filter((r) => r.Result === "LOST");
  const nbRows = rows.filter((r) => r.Result === "NB");
  const cancelRows = rows.filter((r) => r.Result === "CANCELLED");
  const soleRows = rows.filter(
    (r) => !["WON", "LOST", "NB", "CANCELLED", "CANCEL"].includes(r.Result)
  );

  const won = wonRows.length;
  const lost = lostRows.length;
  const nb = nbRows.length;
  const cancel = cancelRows.length;
  const sole = soleRows.length;

  const win_rate = total_bids ? Math.round((won / total_bids) * 1000) / 10 : 0;
  const total_value = rows.reduce((s, r) => s + r["Contract Value"], 0);
  const won_value = wonRows.reduce((s, r) => s + r["Contract Value"], 0);
  const avg_diff =
    lost > 0 ? lostRows.reduce((s, r) => s + r.PriceDiffPct, 0) / lost : 0;
  const over100 = rows.filter((r) => r.PriceDiffPct >= 100).length;

  const nonZeroOffers = rows
    .map((r) => r["Number of Offers Received"])
    .filter((v) => v > 0);
  const avg_comp =
    nonZeroOffers.length > 0
      ? nonZeroOffers.reduce((a, b) => a + b, 0) / nonZeroOffers.length
      : 0;

  const largest_deal =
    total_bids > 0 ? Math.max(...rows.map((r) => r["Contract Value"])) : 0;
  const total_mods = rows.reduce((s, r) => s + r["Linked Mods Total"], 0);

  // Top rivals on LOST bids excluding ADDON
  const rivalCounts = new Map<string, number>();
  for (const r of lostRows) {
    if (!r.Awardee_short.toUpperCase().includes("ADDON")) {
      rivalCounts.set(r.Awardee_short, (rivalCounts.get(r.Awardee_short) || 0) + 1);
    }
  }
  const topRivals = Array.from(rivalCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const top_rival_n = topRivals.length > 0 ? topRivals[0][1] : 0;
  const top_rival_list = topRivals.map(([name, count]) => ({ name, count }));
  const top_rival =
    topRivals.map(([name, count]) => `${name} (${count})`).join(" · ") || "N/A";

  return {
    total_bids,
    won,
    lost,
    sole,
    nb,
    cancel,
    win_rate,
    total_value,
    won_value,
    avg_diff,
    over100,
    avg_comp,
    largest_deal,
    total_mods,
    top_rival,
    top_rival_list,
    top_rival_n,
  };
}

export function buildKpiContext(k: ReturnType<typeof computeKpis>) {
  return {
    won_value: Math.round(k.won_value).toLocaleString("en-US"),
    avg_diff: k.avg_diff.toFixed(1),
    total_value_m: (k.total_value / 1e6).toFixed(1),
    largest_deal_m: (k.largest_deal / 1e6).toFixed(1),
    total_mods_m: (k.total_mods / 1e6).toFixed(1),
  };
}

export function buildDashboardAnalytics(
  rawRows: Record<string, any>[],
  excludeAsteriskBids: boolean = true
) {
  const { rows: df, hasAsteriskBid } = prepareDataframe(rawRows, excludeAsteriskBids);
  const k = computeKpis(df);
  const kpi = buildKpiContext(k);

  // 1. Price Bands (LOST bids) + 50%+ Overpriced by Project Type
  const lostDf = df.filter((r) => r.Result === "LOST");
  const bandCountsMap = new Map<string, number>();
  for (const r of lostDf) {
    bandCountsMap.set(r.PriceBand, (bandCountsMap.get(r.PriceBand) || 0) + 1);
  }
  const bandColors: Record<string, string> = {
    "Priced <= -50% (Very Low)": "#10B981",
    "Below Winner (-50% to 0%)": "#34D399",
    "Exact Match (tied the winning price)": "#64748B",
    "Overpriced 1-50%": "#F97316",
    "Overpriced 50-99%": "#EF4444",
    "OVERPRICED 100%+ CRITICAL": "#DC2626",
  };
  const priceBandsPie = Array.from(bandCountsMap.entries()).map(([name, value]) => ({
    name,
    value,
    color: bandColors[name] || "#4F46E5",
  }));

  const crit50Df = lostDf.filter((r) => r.PriceDiffPct >= 50);
  const critProjMap = new Map<string, { sum: number; count: number }>();
  for (const r of crit50Df) {
    const cur = critProjMap.get(r["Project Type"]) || { sum: 0, count: 0 };
    cur.sum += r.PriceDiffPct;
    cur.count += 1;
    critProjMap.set(r["Project Type"], cur);
  }
  const overpricedByProject = Array.from(critProjMap.entries())
    .map(([projectType, { sum, count }]) => ({
      projectType,
      avgOver: Math.round((sum / count) * 10) / 10,
      count,
    }))
    .sort((a, b) => b.avgOver - a.avgOver);

  // 2. Competitor Intelligence (WON/LOST)
  const compDf = df.filter((r) => r.Result === "WON" || r.Result === "LOST");
  const compMap = new Map<
    string,
    { theyBeatUs: number; totalWins: number; totalValue: number; diffSum: number; count: number }
  >();
  for (const r of compDf) {
    const cur = compMap.get(r.Awardee_short) || {
      theyBeatUs: 0,
      totalWins: 0,
      totalValue: 0,
      diffSum: 0,
      count: 0,
    };
    if (r.Result === "LOST") cur.theyBeatUs += 1;
    if (r.Result === "WON") cur.totalWins += 1;
    cur.totalValue += r["Contract Value"];
    cur.diffSum += r.PriceDiffPct;
    cur.count += 1;
    compMap.set(r.Awardee_short, cur);
  }
  const competitors = Array.from(compMap.entries())
    .filter(([, v]) => v.theyBeatUs > 0)
    .map(([awardee, v]) => ({
      awardee,
      theyBeatUs: v.theyBeatUs,
      totalWins: v.totalWins,
      totalValueM: Math.round((v.totalValue / 1e6) * 100) / 100,
      totalValue: v.totalValue,
      avgPriceDiff: Math.round((v.diffSum / v.count) * 10) / 10,
    }))
    .sort((a, b) => b.theyBeatUs - a.theyBeatUs)
    .slice(0, 12);

  // 3. Missed Revenue Radar (Scatter of Contract Value $M vs PriceDiffPct for WON/LOST)
  const radarPoints = compDf.map((r, idx) => ({
    id: idx,
    contractValueM: Math.round((r["Contract Value"] / 1e6) * 1000) / 1000,
    contractValue: r["Contract Value"],
    priceDiffPct: Math.round(r.PriceDiffPct * 10) / 10,
    result: r.Result,
    projectType: r["Project Type"],
    awardee: r.Awardee_short,
    year: r.Year,
  }));

  // 4. Resume vs Lost Price Difference (CM Only)
  const resumeLostBars: Array<{
    label: string;
    resume: string;
    diffUsd: number;
    diffPct: number;
    awardee: string;
    awardeeShort: string;
    contractValue: number;
    addonBid: number;
    year: string;
    projectType: string;
  }> = [];

  const lostWithResume = lostDf.filter((r) => {
    const res = String(r["Resume Names"] ?? "").trim();
    return (
      res &&
      !["", "0", "0.0", "nan", "none", "null", "-", "n/a"].includes(res.toLowerCase())
    );
  });
  lostWithResume.sort(
    (a, b) => b["Winner Price Difference $"] - a["Winner Price Difference $"]
  );
  const dupCounter = new Map<string, number>();
  lostWithResume.forEach((r) => {
    const resume = String(r["Resume Names"]).trim();
    const seen = (dupCounter.get(resume) || 0) + 1;
    dupCounter.set(resume, seen);
    const label = seen > 1 ? `${resume.slice(0, 40)} (${seen})` : resume.slice(0, 45);
    resumeLostBars.push({
      label,
      resume,
      diffUsd: r["Winner Price Difference $"],
      diffPct: r.PriceDiffPct,
      awardee: r.Awardee,
      awardeeShort: r.Awardee_short,
      contractValue: r["Contract Value"],
      addonBid: r["Addon Bid"],
      year: r.Year,
      projectType: r["Project Type"],
    });
  });

  // 5. Project Type Deep Dive
  const projMap = new Map<
    string,
    {
      totalBids: number;
      wins: number;
      totalValue: number;
      over100: number;
      lostDiffSum: number;
      lostCount: number;
      linkedMods: number;
    }
  >();
  for (const r of df) {
    const pt = r["Project Type"];
    const cur = projMap.get(pt) || {
      totalBids: 0,
      wins: 0,
      totalValue: 0,
      over100: 0,
      lostDiffSum: 0,
      lostCount: 0,
      linkedMods: 0,
    };
    cur.totalBids += 1;
    if (r.Result === "WON") cur.wins += 1;
    cur.totalValue += r["Contract Value"];
    cur.linkedMods += r["Linked Mods Total"];
    if (r.PriceDiffPct >= 100) cur.over100 += 1;
    if (r.Result === "LOST") {
      cur.lostDiffSum += r.PriceDiffPct;
      cur.lostCount += 1;
    }
    projMap.set(pt, cur);
  }

  const projectDeepDive = Array.from(projMap.entries())
    .map(([projectType, v]) => ({
      projectType,
      totalBids: v.totalBids,
      wins: v.wins,
      totalValue: v.totalValue,
      totalValueM: Math.round((v.totalValue / 1e6) * 100) / 100,
      linkedMods: v.linkedMods,
      linkedModsM: Math.round((v.linkedMods / 1e6) * 100) / 100,
      winRate: v.totalBids ? Math.round((v.wins / v.totalBids) * 1000) / 10 : 0,
      avgPriceDiff: v.lostCount ? Math.round((v.lostDiffSum / v.lostCount) * 10) / 10 : 0,
      over100: v.over100,
    }))
    .sort((a, b) => b.totalValue - a.totalValue);

  // 6. Year-Over-Year Trends
  const yrMap = new Map<
    string,
    {
      totalBids: number;
      submittedBids: number;
      wins: number;
      totalValue: number;
      subDiffSum: number;
    }
  >();
  for (const r of df) {
    const yr = r.Year || "Unspecified";
    const cur = yrMap.get(yr) || {
      totalBids: 0,
      submittedBids: 0,
      wins: 0,
      totalValue: 0,
      subDiffSum: 0,
    };
    cur.totalBids += 1;
    if (r.Result !== "NB") {
      cur.submittedBids += 1;
      if (r.Result === "WON") cur.wins += 1;
      cur.totalValue += r["Contract Value"];
      cur.subDiffSum += r.PriceDiffPct;
    }
    yrMap.set(yr, cur);
  }
  const yoyTrends = Array.from(yrMap.entries())
    .map(([year, v]) => ({
      year,
      totalBids: v.totalBids,
      submittedBids: v.submittedBids,
      wins: v.wins,
      winRate: v.submittedBids ? Math.round((v.wins / v.submittedBids) * 1000) / 10 : 0,
      avgPriceDiff: v.submittedBids
        ? Math.round((v.subDiffSum / v.submittedBids) * 10) / 10
        : 0,
      totalValueM: Math.round((v.totalValue / 1e6) * 100) / 100,
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  // 7. Top Competitors by Project Type (%) & Revenue Distribution Dropdown
  const shareDf = df.filter((r) => ["LOST", "WON", "NB"].includes(r.Result));
  const winnerEntity = (r: PreparedBidRow) =>
    r.Result === "WON" ? OUR_COMPANY : r.Awardee_short;

  const projEntityTotals = new Map<string, Map<string, number>>();
  const companyProjTotals = new Map<string, Map<string, number>>();
  const companyGrandTotals = new Map<string, number>();

  for (const r of shareDf) {
    const entity = winnerEntity(r);
    const pt = r["Project Type"];
    const val = r.Total || r["Contract Value"] || 0;

    if (!projEntityTotals.has(pt)) projEntityTotals.set(pt, new Map());
    const pMap = projEntityTotals.get(pt)!;
    pMap.set(entity, (pMap.get(entity) || 0) + val);

    if (!companyProjTotals.has(entity)) companyProjTotals.set(entity, new Map());
    const cMap = companyProjTotals.get(entity)!;
    cMap.set(pt, (cMap.get(pt) || 0) + val);

    companyGrandTotals.set(entity, (companyGrandTotals.get(entity) || 0) + val);
  }

  const topCompetitorsByProject: Array<{
    projectType: string;
    totalVolume: number;
    shares: Array<{ entity: string; sharePct: number; volume: number }>;
  }> = [];

  for (const [pt, eMap] of projEntityTotals.entries()) {
    if (eMap.size <= 1) continue; // only competitive projects with > 1 winner entity
    const totalVol = Array.from(eMap.values()).reduce((a, b) => a + b, 0);
    if (totalVol <= 0) continue;
    const shares = Array.from(eMap.entries())
      .map(([entity, volume]) => ({
        entity,
        volume,
        sharePct: Math.round((volume / totalVol) * 1000) / 10,
      }))
      .sort((a, b) => b.sharePct - a.sharePct);
    topCompetitorsByProject.push({ projectType: pt, totalVolume: totalVol, shares });
  }

  const revenueDistributionByCompany = Array.from(companyGrandTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, total]) => total > 0)
    .map(([company, grandTotal]) => {
      const pMap = companyProjTotals.get(company)!;
      const breakdown = Array.from(pMap.entries())
        .map(([projectType, value]) => ({
          projectType,
          value,
          sharePct: Math.round((value / grandTotal) * 1000) / 10,
        }))
        .sort((a, b) => b.value - a.value);
      return { company, grandTotal, breakdown };
    });

  // 8. Modifications by Company & Project Type
  const modsCompMap = new Map<string, { awardee: string; projectType: string; mods: number; total: number }>();
  for (const r of df) {
    const key = `${r.Awardee_short} | ${r["Project Type"]}`;
    const cur = modsCompMap.get(key) || {
      awardee: r.Awardee_short,
      projectType: r["Project Type"],
      mods: 0,
      total: 0,
    };
    cur.mods += r.Mods;
    cur.total += r.Total;
    modsCompMap.set(key, cur);
  }
  const modsByCompanyProject = Array.from(modsCompMap.entries())
    .filter(([, v]) => v.mods !== 0)
    .map(([label, v]) => ({
      label,
      awardee: v.awardee,
      projectType: v.projectType,
      mods: v.mods,
      total: v.total,
    }))
    .sort((a, b) => b.mods - a.mods);

  // 9. Pricing Heatmap (Project Type x Top 10 Winning Competitors on LOST bids)
  const lostRivalCounts = new Map<string, number>();
  for (const r of lostDf) {
    lostRivalCounts.set(r.Awardee_short, (lostRivalCounts.get(r.Awardee_short) || 0) + 1);
  }
  const top10Cos = Array.from(lostRivalCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  const heatmapProjectTypes = Array.from(
    new Set(lostDf.filter((r) => top10Cos.includes(r.Awardee_short)).map((r) => r["Project Type"]))
  ).sort();

  const heatmapMatrix = heatmapProjectTypes.map((pt) => {
    const cells = top10Cos.map((co) => {
      const matches = lostDf.filter(
        (r) => r["Project Type"] === pt && r.Awardee_short === co
      );
      if (matches.length === 0) return { competitor: co, avgDiffPct: null, count: 0 };
      const avg = matches.reduce((s, r) => s + r.PriceDiffPct, 0) / matches.length;
      return {
        competitor: co,
        avgDiffPct: Math.round(avg * 10) / 10,
        count: matches.length,
      };
    });
    return { projectType: pt, cells };
  });

  // 10. Critical 100%+ Overpriced Table
  const criticalRows = df
    .filter((r) => r.PriceDiffPct >= 100)
    .sort((a, b) => b.PriceDiffPct - a.PriceDiffPct)
    .map((r) => ({
      year: r.Year,
      project_type: r["Project Type"],
      awardee: r.Awardee,
      contract_value: `$${Math.round(r["Contract Value"]).toLocaleString("en-US")}`,
      our_bid: r["Addon Bid"] > 0 ? `$${Math.round(r["Addon Bid"]).toLocaleString("en-US")}` : "N/A",
      winner_diff: `$${Math.round(r["Winner Price Difference $"]).toLocaleString("en-US")}`,
      pct: `+${r.PriceDiffPct.toFixed(1)}%`,
      result: r.Result,
    }));

  // 11. CEO Brief Context
  const posDiffDf = df.filter((r) => r.PriceDiffPct > 0);
  const posByProj = new Map<string, { sum: number; count: number }>();
  for (const r of posDiffDf) {
    const cur = posByProj.get(r["Project Type"]) || { sum: 0, count: 0 };
    cur.sum += r.PriceDiffPct;
    cur.count += 1;
    posByProj.set(r["Project Type"], cur);
  }
  const worstPricing = Array.from(posByProj.entries())
    .map(([name, v]) => ({ name, avg: v.sum / v.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 2);
  const worst_proj_str =
    worstPricing.map((w) => `${w.name} (+${Math.round(w.avg)}%)`).join(", ") || "N/A";

  const crit100ByProj = new Map<string, { sum: number; count: number }>();
  for (const r of df.filter((x) => x.PriceDiffPct >= 100)) {
    const cur = crit100ByProj.get(r["Project Type"]) || { sum: 0, count: 0 };
    cur.sum += r.PriceDiffPct;
    cur.count += 1;
    crit100ByProj.set(r["Project Type"], cur);
  }
  const topCrit100 = Array.from(crit100ByProj.entries())
    .map(([name, v]) => ({ name, avg: v.sum / v.count }))
    .sort((a, b) => b.avg - a.avg)[0];
  const worst_crit_str = topCrit100
    ? `${topCrit100.name} (+${Math.round(topCrit100.avg)}%)`
    : "None";

  const pct_captured = k.total_value ? (k.won_value / k.total_value) * 100 : 0;

  const brief = {
    won_value_m: (k.won_value / 1e6).toFixed(1),
    total_value_m: (k.total_value / 1e6).toFixed(1),
    pct_captured: pct_captured.toFixed(1),
    avg_diff: k.avg_diff.toFixed(1),
    avg_comp: k.avg_comp.toFixed(1),
    worst_proj_str,
    worst_crit_str,
  };

  return {
    hasAsteriskBid,
    k,
    kpi,
    priceBandsPie,
    overpricedByProject,
    competitors,
    radarPoints,
    resumeLostBars,
    projectDeepDive,
    yoyTrends,
    topCompetitorsByProject,
    revenueDistributionByCompany,
    modsByCompanyProject,
    heatmap: {
      competitors: top10Cos,
      rows: heatmapMatrix,
    },
    critical: criticalRows.length > 0 ? { count: criticalRows.length, rows: criticalRows } : null,
    brief,
  };
}

/**
 * Generates a self-contained HTML dashboard file for "Download Dashboard (.html)"
 */
export function buildStandaloneDashboardHtml(
  rawRows: Record<string, any>[],
  matocLabel: string,
  slug: string,
  excludeAsteriskBids: boolean = true
): string {
  const data = buildDashboardAnalytics(rawRows, excludeAsteriskBids);
  const { k, kpi, brief, critical } = data;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${matocLabel} — Executive Performance Dashboard</title>
<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #F8FAFC; color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1360px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #E2E8F0; padding-bottom: 16px; }
  h1 { margin: 0; font-size: 26px; font-weight: 800; }
  .sub { margin: 4px 0 0; color: #64748B; font-size: 14px; }
  .card { background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 12px; padding: 24px; }
  .card h2 { margin: 0 0 6px; font-size: 17px; }
  .card p.desc { margin: 0 0 18px; font-size: 13px; color: #64748B; }
  .kgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .kcard { border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; background: #F8FAFC; }
  .klbl { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; }
  .kval { font-size: 24px; font-weight: 800; margin: 8px 0 4px; font-variant-numeric: tabular-nums; }
  .ksub { font-size: 12px; color: #64748B; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #F1F5F9; color: #475569; text-align: left; padding: 10px 12px; border-bottom: 1px solid #E2E8F0; }
  td { padding: 10px 12px; border-bottom: 1px solid #E2E8F0; font-variant-numeric: tabular-nums; }
  .r { text-align: right; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div>
      <h1>${matocLabel} Intelligence Dashboard</h1>
      <p class="sub">Exported Snapshot · Exclude Asterisk Bids: ${excludeAsteriskBids ? "ON" : "OFF"}</p>
    </div>
  </div>
  <div class="card">
    <h2>Executive Overview</h2>
    <p class="desc">Headline metrics across all task orders in ${matocLabel}</p>
    <div class="kgrid">
      <div class="kcard"><div class="klbl">Total Task Orders</div><div class="kval">${k.total_bids}</div><div class="ksub">Won ${k.won} · Lost ${k.lost} · No Bid ${k.nb}</div></div>
      <div class="kcard"><div class="klbl">Win Rate</div><div class="kval" style="color:#059669">${k.win_rate}%</div><div class="ksub">$${kpi.won_value} captured</div></div>
      <div class="kcard"><div class="klbl">Avg Overpriced When Lost</div><div class="kval" style="color:#E11D48">+${kpi.avg_diff}%</div><div class="ksub">above winning bid</div></div>
      <div class="kcard"><div class="klbl">Overpriced 100%+</div><div class="kval" style="color:#D97706">${k.over100}</div><div class="ksub">critical overpricing</div></div>
      <div class="kcard"><div class="klbl">Total Contract Value</div><div class="kval">$${kpi.total_value_m}M</div><div class="ksub">across all bids</div></div>
      <div class="kcard"><div class="klbl">Largest Contract</div><div class="kval">$${kpi.largest_deal_m}M</div><div class="ksub">single biggest deal</div></div>
      <div class="kcard"><div class="klbl">Total Mods Value</div><div class="kval">$${kpi.total_mods_m}M</div><div class="ksub">post-award modifications</div></div>
      <div class="kcard"><div class="klbl">Top Competitors</div><div class="kval" style="font-size:14px">${k.top_rival}</div><div class="ksub">winning most often</div></div>
    </div>
  </div>
  <div class="card">
    <h2>Project Type Performance Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Project Type</th>
          <th class="r">Total Bids</th>
          <th class="r">Wins</th>
          <th class="r">Win Rate</th>
          <th class="r">Contract Value ($M)</th>
          <th class="r">Avg Diff % (Lost)</th>
          <th class="r">100%+ Overpriced</th>
        </tr>
      </thead>
      <tbody>
        ${data.projectDeepDive
          .map(
            (p) => `<tr>
          <td><strong>${p.projectType}</strong></td>
          <td class="r">${p.totalBids}</td>
          <td class="r">${p.wins}</td>
          <td class="r">${p.winRate}%</td>
          <td class="r">$${p.totalValueM.toFixed(2)}M</td>
          <td class="r">${p.avgPriceDiff > 0 ? "+" : ""}${p.avgPriceDiff}%</td>
          <td class="r">${p.over100}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>
  ${
    critical
      ? `<div class="card">
    <h2>Critical Overpricing (${critical.count} bids at 100%+ above winner)</h2>
    <table>
      <thead>
        <tr>
          <th>Year</th><th>Project Type</th><th>Winner</th><th class="r">Contract $</th><th class="r">Our Bid $</th><th class="r">Overbid $</th><th class="r">Over %</th><th>Result</th>
        </tr>
      </thead>
      <tbody>
        ${critical.rows
          .map(
            (r) => `<tr>
          <td>${r.year}</td><td>${r.project_type}</td><td>${r.awardee}</td><td class="r">${r.contract_value}</td><td class="r">${r.our_bid}</td><td class="r">${r.winner_diff}</td><td class="r" style="color:#E11D48;font-weight:700">${r.pct}</td><td>${r.result}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>`
      : ""
  }
  <div class="card">
    <h2>CEO Action Intelligence Brief</h2>
    <p>1. Win rate is <strong>${k.win_rate}%</strong> (${k.won} wins from ${k.total_bids} bids). Captured <strong>$${brief.won_value_m}M</strong> of $${brief.total_value_m}M (${brief.pct_captured}%).</p>
    <p>2. Average overpricing on losses: <strong>+${brief.avg_diff}%</strong>. Worst project types: <strong>${brief.worst_proj_str}</strong>.</p>
    <p>3. Critical 100%+ overpriced bids: <strong>${k.over100}</strong> (Worst: <strong>${brief.worst_crit_str}</strong>).</p>
    <p>4. Top rival: <strong>${k.top_rival}</strong> · Average competition: <strong>${brief.avg_comp} bidders</strong>.</p>
  </div>
</div>
</body>
</html>`;
}
