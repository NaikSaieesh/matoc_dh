export async function generateReasonAnalysis(input: {
  matoc_category: string;
  price_factor_pct: number; technical_factor_pct: number; past_performance_pct: number;
  your_bid_price: number | null; winning_bid_price: number | null;
  price_delta_pct: number | null; raw_debrief_notes: string | null;
}): Promise<{ summary: string; recommendation: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY missing");

  const prompt = `Federal bid loss debrief (${input.matoc_category}).
Loss reasons (percent): Price premium/best-value tradeoff failure ${input.price_factor_pct}%; Technical capability value gap ${input.technical_factor_pct}%; Past performance differentiation ${input.past_performance_pct}%.
Our bid: ${input.your_bid_price}. Winning bid: ${input.winning_bid_price}. Price delta: ${input.price_delta_pct}%.
Notes: ${(input.raw_debrief_notes || "").slice(0, 2000)}
Return JSON only: {"summary":"max 3 sentences","recommendation":"max 4 short actionable sentences"}`;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 400,
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = JSON.parse((await r.json()).choices[0].message.content);
  return { summary: String(j.summary || ""), recommendation: String(j.recommendation || "") };
}