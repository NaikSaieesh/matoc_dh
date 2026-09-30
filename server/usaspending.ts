/**
 * Port of usaspending_api.py
 * All calls to the USAspending.gov public API live in this file.
 */

const USASPENDING_BASE_URL = "https://api.usaspending.gov/api/v2";
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postWithRetries(url: string, payload: unknown, timeoutMs = 30000): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

async function getWithRetries(url: string, timeoutMs = 30000): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

export async function getAwardIdByPiid(piid: string): Promise<string | null> {
  const url = `${USASPENDING_BASE_URL}/search/spending_by_award/`;
  const payload = {
    filters: {
      award_type_codes: ["A", "B", "C", "D"],
      keywords: [piid],
    },
    fields: [
      "Award ID",
      "generated_internal_id",
      "Recipient Name",
      "Award Amount",
    ],
    limit: 10,
  };

  const data = await postWithRetries(url, payload);
  const results = data?.results || [];

  for (const r of results) {
    if (String(r["Award ID"] || "").trim() === piid.trim()) {
      return r["generated_internal_id"] || null;
    }
  }
  return null;
}

export async function getAwardSummary(generatedId: string): Promise<any> {
  const url = `${USASPENDING_BASE_URL}/awards/${encodeURIComponent(generatedId)}/`;
  return await getWithRetries(url);
}

export async function getTransactions(generatedId: string): Promise<any[]> {
  const url = `${USASPENDING_BASE_URL}/transactions/`;
  const payload = {
    award_id: generatedId,
    limit: 100,
    page: 1,
    sort: "action_date",
    order: "asc",
  };
  const data = await postWithRetries(url, payload);
  return data?.results || [];
}

export interface AwardModItem {
  modification_number: string | null;
  action_date: string | null;
  description: string | null;
  federal_action_obligation: number | null;
}

export interface FetchedAwardData {
  piid: string;
  generated_internal_id: string;
  description: string | null;
  recipient_name: string | null;
  total_obligation: number | null;
  base_exercised_options: number | null;
  base_and_all_options: number | null;
  modifications: AwardModItem[];
}

export async function fetchAwardData(piid: string): Promise<FetchedAwardData | null> {
  const cleanPiid = piid.trim();
  if (!cleanPiid) return null;

  const generatedId = await getAwardIdByPiid(cleanPiid);
  if (!generatedId) return null;

  const award = await getAwardSummary(generatedId);
  const transactions = await getTransactions(generatedId);

  const modifications: AwardModItem[] = transactions.map((t: any) => ({
    modification_number: t?.modification_number != null ? String(t.modification_number) : null,
    action_date: t?.action_date ? String(t.action_date) : null,
    description: t?.description ? String(t.description) : null,
    federal_action_obligation:
      t?.federal_action_obligation != null && !isNaN(Number(t.federal_action_obligation))
        ? Number(t.federal_action_obligation)
        : 0,
  }));

  return {
    piid: award?.piid || cleanPiid,
    generated_internal_id: generatedId,
    description: award?.description || null,
    recipient_name: award?.recipient?.recipient_name || null,
    total_obligation:
      award?.total_obligation != null && !isNaN(Number(award.total_obligation))
        ? Number(award.total_obligation)
        : null,
    base_exercised_options:
      award?.base_exercised_options != null && !isNaN(Number(award.base_exercised_options))
        ? Number(award.base_exercised_options)
        : null,
    base_and_all_options:
      award?.base_and_all_options != null && !isNaN(Number(award.base_and_all_options))
        ? Number(award.base_and_all_options)
        : null,
    modifications,
  };
}
