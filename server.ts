import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import * as XLSX from "xlsx";
import dotenv from "dotenv";

import {
  initDatabase,
  MATOC_CATEGORIES,
  DEFAULT_CATEGORY,
  loadRegistry,
  getMatocs,
  getCategoryCounts,
  createMatoc,
  setMatocCategory,
  truncateMatocTable,
  deleteMatoc,
  loadRawDataframeWithAwards,
  loadMatocDataframe,
  updateCell,
  createBlankRow,
  deleteRow,
  upsertDataframe,
  getModificationDataframe,
  getContractors,
  getContractorDataframe,
  getTaskOrderIdsForSlug,
  upsertAwardNotFound,
  saveAwardData,
  checkLogin,
  getAllUsers,
  updateUserRole,
  adminCreateUser,
  createUserSession,
  invalidateUserSession,
  getDatabaseInspectorState,
  configureMysqlConnection,
  executeSqlQuery,
  importSqlDump,
  getReason,
  saveDebrief,
  claimAiRun,
  saveAiResult,
  markAiFailed,
} from "./server/db.ts";
import { classifyProject, classifyProjectType, PROJECT_TYPES } from "./server/classifier.ts";
import { generateReasonAnalysis } from "./server/groq.ts";
import { fetchAwardData } from "./server/usaspending.ts";
import {
  buildDashboardAnalytics,
  buildStandaloneDashboardHtml,
} from "./server/analytics.ts";

dotenv.config();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

// Shared background pull progress state (Port of pull_pipeline.py)
interface PullProgress {
  running: boolean;
  slug: string | null;
  matoc_label: string | null;
  total: number;
  completed: number;
  percentage: number;
  current_piid: string | null;
  last_message: string;
  errors: string[];
}

const PROGRESS: PullProgress = {
  running: false,
  slug: null,
  matoc_label: null,
  total: 0,
  completed: 0,
  percentage: 0,
  current_piid: null,
  last_message: "Idle",
  errors: [],
};

async function runPullJob(slug: string) {
  if (PROGRESS.running) return;
  const matocs = await getMatocs();
  const matocLabel = matocs[slug] || slug;

  Object.assign(PROGRESS, {
    running: true,
    slug,
    matoc_label: matocLabel,
    total: 0,
    completed: 0,
    percentage: 0,
    current_piid: null,
    last_message: "Starting...",
    errors: [],
  });

  try {
    const taskOrders = await getTaskOrderIdsForSlug(slug);
    const totalItems = taskOrders.length;
    PROGRESS.total = totalItems;
    PROGRESS.last_message = `Found ${totalItems} task order(s) in ${matocLabel}`;

    for (let idx = 1; idx <= totalItems; idx++) {
      const piid = taskOrders[idx - 1];
      PROGRESS.current_piid = piid;
      PROGRESS.last_message = `Fetching ${piid} from USAspending.gov...`;

      try {
        const data = await fetchAwardData(piid);
        if (!data) {
          await upsertAwardNotFound(piid);
          PROGRESS.last_message = `${piid}: not found on USAspending.gov`;
        } else {
          await saveAwardData(data);
          PROGRESS.last_message = `${piid}: saved (${data.modifications.length} modification rows)`;
        }
      } catch (err: any) {
        const errMsg = `${piid}: ${err?.message || String(err)}`;
        PROGRESS.errors.push(errMsg);
        PROGRESS.last_message = `${piid}: ERROR - see errors list`;
      }

      PROGRESS.completed = idx;
      PROGRESS.percentage = totalItems > 0 ? Math.round((idx / totalItems) * 1000) / 10 : 100;

      await new Promise((r) => setTimeout(r, 1500));
    }

    PROGRESS.last_message = `Completed - ${matocLabel} is up to date.`;
    PROGRESS.percentage = 100;
  } catch (err: any) {
    PROGRESS.errors.push(`Fatal error: ${err?.message || String(err)}`);
    PROGRESS.last_message = "Stopped due to a fatal error";
  } finally {
    PROGRESS.running = false;
    PROGRESS.current_piid = null;
  }
}

async function startServer() {
  await initDatabase();

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --------------------------------------------------------------------------
  // Auth Endpoints
  // --------------------------------------------------------------------------
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const identifier = String(email || "").trim();
      const pwd = String(password || "");

      let user = identifier ? await checkLogin(identifier, pwd) : null;

      // Admin password fallback (Admin@123 or admin123) as in app.py
      if (!user && (pwd === ADMIN_PASSWORD || pwd === "admin123" || pwd === "Admin@123")) {
        user = {
          id: 1,
          username: identifier || "Saieesh",
          email: identifier.includes("@") ? identifier : "saieeshnaik25@gmail.com",
          is_admin: true,
          is_super_admin: true,
        };
      }

      if (!user) {
        res.status(401).json({ ok: false, error: "Invalid credentials. Please try again." });
        return;
      }

      const sessionUuid = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 45 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      await createUserSession(
        user.id,
        sessionUuid,
        expiresAt,
        req.ip || "127.0.0.1",
        String(req.headers["user-agent"] || "")
      );

      res.json({
        ok: true,
        user: {
          ...user,
          session_id: sessionUuid,
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Login failed" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const { session_id } = req.body || {};
      if (session_id) {
        await invalidateUserSession(String(session_id));
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Categories & MATOC Vehicles Endpoints
  // --------------------------------------------------------------------------
  app.get("/api/categories", async (_req, res) => {
    try {
      const counts = await getCategoryCounts();
      const registry = await loadRegistry();
      const categories = Object.entries(MATOC_CATEGORIES).map(([key, meta]) => ({
        key,
        label: meta.label,
        desc: meta.desc,
        count: counts[key] || 0,
      }));
      res.json({
        ok: true,
        categories,
        matocs: Object.values(registry),
        projectTypes: PROJECT_TYPES,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/matocs", async (req, res) => {
    try {
      const category = req.query.category ? String(req.query.category) : undefined;
      const registry = await loadRegistry();
      const items = Object.values(registry).filter(
        (m) => !category || m.category === category
      );
      res.json({
        ok: true,
        category,
        category_label: category ? MATOC_CATEGORIES[category]?.label || category : "All MATOCs",
        items,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Main Dashboard Analytical Endpoint + Standalone HTML Download
  // --------------------------------------------------------------------------
  app.get("/api/dashboard/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const registry = await loadRegistry();
      if (!(slug in registry)) {
        res.status(404).json({ ok: false, error: `Unknown MATOC '${slug}'` });
        return;
      }

      const entry = registry[slug];
      const excludeAsteriskBids =
        String(req.query.asterisk || "on").trim().toLowerCase() !== "off";
      const rawRows = await loadMatocDataframe(slug);
      const analytics = buildDashboardAnalytics(rawRows, excludeAsteriskBids);
      const siblingMatocs = await getMatocs(entry.category);

      res.json({
        ok: true,
        slug,
        matoc_label: entry.label,
        category: entry.category,
        category_label: MATOC_CATEGORIES[entry.category]?.label || entry.category,
        table_name: entry.table_name,
        exclude_asterisk_bids: excludeAsteriskBids,
        sibling_matocs: siblingMatocs,
        ...analytics,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.get("/api/dashboard/:slug/download", async (req, res) => {
    try {
      const { slug } = req.params;
      const registry = await loadRegistry();
      if (!(slug in registry)) {
        res.status(404).send(`Unknown MATOC '${slug}'`);
        return;
      }
      const matocLabel = registry[slug].label;
      const excludeAsteriskBids =
        String(req.query.asterisk || "on").trim().toLowerCase() !== "off";
      const rawRows = await loadMatocDataframe(slug);
      const html = buildStandaloneDashboardHtml(
        rawRows,
        matocLabel,
        slug,
        excludeAsteriskBids
      );
      const filename = `${matocLabel.replace(/\s+/g, "_")}_Dashboard.html`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(html);
    } catch (err: any) {
      res.status(500).send(err?.message || "Failed to generate dashboard download");
    }
  });

  // --------------------------------------------------------------------------
  // Raw Data View, Cell Editing, Batch Paste, Excel Upload & Export
  // --------------------------------------------------------------------------
  app.get("/api/dashboard/:slug/data", async (req, res) => {
    try {
      const { slug } = req.params;
      const registry = await loadRegistry();
      if (!(slug in registry)) {
        res.status(404).json({ ok: false, error: `Unknown MATOC '${slug}'` });
        return;
      }
      const { columns, rows } = await loadRawDataframeWithAwards(slug);
      res.json({
        ok: true,
        slug,
        matoc_label: registry[slug].label,
        table_name: registry[slug].table_name,
        category: registry[slug].category,
        columns,
        rows,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/dashboard/:slug/data/update", async (req, res) => {
    try {
      const { slug } = req.params;
      const { id, column, value } = req.body || {};
      const derived = await updateCell(slug, Number(id), String(column), value);
      res.json({ ok: true, derived });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/dashboard/:slug/data/create", async (req, res) => {
    try {
      const { slug } = req.params;
      const { column, value } = req.body || {};
      const newId = await createBlankRow(slug);
      const derived = column
        ? await updateCell(slug, newId, String(column), value ?? "")
        : null;
      res.json({ ok: true, new_id: newId, derived });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.delete("/api/dashboard/:slug/data/:rowId", async (req, res) => {
    try {
      const { slug, rowId } = req.params;
      await deleteRow(slug, Number(rowId));
      res.json({ ok: true, deleted_id: Number(rowId) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/dashboard/:slug/data/upload", async (req, res) => {
    try {
      const { slug } = req.params;
      const { base64File, sheetName, rows: directRows } = req.body || {};

      let parsedRows: Record<string, any>[] = [];
      if (Array.isArray(directRows)) {
        parsedRows = directRows;
      } else if (base64File) {
        const buffer = Buffer.from(base64File, "base64");
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const targetSheet =
          sheetName && wb.SheetNames.includes(String(sheetName).trim())
            ? String(sheetName).trim()
            : wb.SheetNames[0];
        if (!targetSheet) {
          throw new Error("No worksheet found in uploaded Excel file.");
        }
        parsedRows = XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { defval: "" });
      } else {
        throw new Error("No Excel file content provided.");
      }

      const stats = await upsertDataframe(slug, parsedRows);
      const message = `Import complete - inserted: ${stats.inserted}, updated: ${stats.updated}, unchanged: ${stats.unchanged}, skipped: ${stats.skipped}.`;
      res.json({ ok: true, stats, message });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: `Import failed: ${err?.message || String(err)}` });
    }
  });

  app.get("/api/dashboard/:slug/data/export", async (req, res) => {
    try {
      const { slug } = req.params;
      const registry = await loadRegistry();
      if (!(slug in registry)) {
        res.status(404).send(`Unknown MATOC '${slug}'`);
        return;
      }
      const matocLabel = registry[slug].label;

      // Sheet 1: Main Data (excluding id, 8(a) or R, Status as in app.py)
      const { columns, rows: mainRows } = await loadRawDataframeWithAwards(slug);
      const keepCols = columns.filter(
        (c) => !["8(a) or r", "8a or r", "status"].includes(c.trim().toLowerCase())
      );
      const sheet1Data = mainRows.map((r) => {
        const obj: Record<string, any> = {};
        for (const c of keepCols) {
          obj[c] = r[c];
        }
        return obj;
      });

      // Sheet 2: Modification Details
      const modRows = await getModificationDataframe(slug);

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(sheet1Data);
      const ws2 = XLSX.utils.json_to_sheet(
        modRows.length > 0
          ? modRows
          : [
              {
                "Folder Number": "",
                "Award/PIID": "",
                Awardee: "",
                "Project Type": "",
                Year: "",
                "Total Obligation": 0,
                "Award Status": "",
                "Modification #": "",
                "Action Date": "",
                Description: "",
                "Mod Value": 0,
              },
            ]
      );

      XLSX.utils.book_append_sheet(wb, ws1, matocLabel.slice(0, 31) || "MATOC Data");
      XLSX.utils.book_append_sheet(wb, ws2, "Modification Details");

      const outBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const filename = `${matocLabel.replace(/\s+/g, "_")}_Data.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(outBuffer);
    } catch (err: any) {
      res.status(500).send(err?.message || "Export failed");
    }
  });

  // --------------------------------------------------------------------------
  // SAM.gov Weighted Rule-Based Title Classifier Endpoints
  // --------------------------------------------------------------------------
  app.post("/api/dashboard/:slug/data/classify-title", async (req, res) => {
    try {
      const { title, description, naics } = req.body || {};
      if (!title || !String(title).trim()) {
        res.status(400).json({ ok: false, error: "No title provided." });
        return;
      }
      const details = classifyProject(String(title), String(description || ""), naics);
      res.json({
        ok: true,
        project_type: details.project_type,
        details,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/dashboard/:slug/data/classify-all", async (req, res) => {
    try {
      const { slug } = req.params;
      const { overwriteAll } = req.body || {};
      const { rows } = await loadRawDataframeWithAwards(slug);
      let updatedCount = 0;

      for (const r of rows) {
        const title = String(r["Title"] ?? "").trim();
        const currentPt = String(r["Project Type"] ?? "").trim();
        if (!title) continue;
        if (
          overwriteAll ||
          !currentPt ||
          currentPt.toLowerCase() === "unspecified" ||
          currentPt.toLowerCase() === "other" ||
          currentPt.toLowerCase() === "none"
        ) {
          const newPt = classifyProjectType(title);
          if (newPt && newPt !== currentPt) {
            await updateCell(slug, Number(r.id), "Project Type", newPt);
            updatedCount++;
          }
        }
      }

      res.json({
        ok: true,
        updatedCount,
        message: `Classified ${updatedCount} row(s) using SAM.gov rule engine.`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/classify", (req, res) => {
    const data = req.body || {};
    const result = classifyProject(
      String(data.title || ""),
      String(data.description || ""),
      data.naics
    );
    res.json(result);
  });

  // --------------------------------------------------------------------------
  // USAspending.gov Pull Pipeline Endpoints
  // --------------------------------------------------------------------------
  app.post("/api/dashboard/:slug/data/pull-latest", async (req, res) => {
    const { slug } = req.params;
    const registry = await loadRegistry();
    if (!(slug in registry)) {
      res.status(404).json({ ok: false, error: `Unknown MATOC '${slug}'` });
      return;
    }
    if (PROGRESS.running) {
      res.status(409).json({
        ok: false,
        message: `A pull is already running (${PROGRESS.matoc_label}).`,
      });
      return;
    }
    runPullJob(slug);
    res.json({ ok: true, message: "Pull started." });
  });

  app.get("/api/dashboard/:slug/data/pull-status", (_req, res) => {
    res.json(PROGRESS);
  });

  // --------------------------------------------------------------------------
  // Contractor Intelligence Endpoint
  // --------------------------------------------------------------------------
  app.get("/api/dashboard/:slug/contractor", async (req, res) => {
    try {
      const { slug } = req.params;
      const registry = await loadRegistry();
      if (!(slug in registry)) {
        res.status(404).json({ ok: false, error: `Unknown MATOC '${slug}'` });
        return;
      }

      const contractors = await getContractors(slug);
      if (contractors.length === 0) {
        res.json({
          ok: true,
          slug,
          matoc_label: registry[slug].label,
          contractors: [],
          selected: null,
          stats: null,
          yearlyData: [],
          projectData: [],
          recent: [],
        });
        return;
      }

      const selected =
        req.query.contractor && contractors.includes(String(req.query.contractor))
          ? String(req.query.contractor)
          : contractors[0];

      const rows = await getContractorDataframe(slug, selected);
      const total_projects = rows.length;
      const total_wins = rows.filter(
        (r) => String(r["Result"] || "").toUpperCase() === "WON"
      ).length;
      const total_value = rows.reduce((s, r) => s + (Number(r["Contract Value"]) || 0), 0);
      const total_mods = rows.reduce((s, r) => s + (Number(r["Mods"]) || 0), 0);
      const win_rate = total_projects
        ? Math.round((total_wins / total_projects) * 1000) / 10
        : 0;

      // Yearly chart aggregation
      const byYear = new Map<string, number>();
      const byProj = new Map<string, number>();
      for (const r of rows) {
        const yr = String(r["Year"] || "Unspecified");
        const pt = String(r["Project Type"] || "Unspecified").trim() || "Unspecified";
        const cv = Number(r["Contract Value"]) || 0;
        byYear.set(yr, (byYear.get(yr) || 0) + cv);
        byProj.set(pt, (byProj.get(pt) || 0) + cv);
      }

      const yearlyData = Array.from(byYear.entries())
        .map(([year, contractValue]) => ({ year, contractValue }))
        .sort((a, b) => a.year.localeCompare(b.year));

      const projectData = Array.from(byProj.entries())
        .map(([projectType, contractValue]) => ({ projectType, contractValue }))
        .sort((a, b) => b.contractValue - a.contractValue)
        .slice(0, 10);

      const recent = [...rows].sort((a, b) =>
        String(b["Year"] || "").localeCompare(String(a["Year"] || ""))
      );

      res.json({
        ok: true,
        slug,
        matoc_label: registry[slug].label,
        contractors,
        selected,
        stats: {
          total_projects,
          total_wins,
          total_value,
          total_mods,
          win_rate,
        },
        yearlyData,
        projectData,
        recent,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Modification Intelligence Endpoint
  // --------------------------------------------------------------------------
  app.get("/api/dashboard/:slug/modifications", async (req, res) => {
    try {
      const { slug } = req.params;
      const registry = await loadRegistry();
      if (!(slug in registry)) {
        res.status(404).json({ ok: false, error: `Unknown MATOC '${slug}'` });
        return;
      }

      const matocLabel = registry[slug].label;
      const df = await getModificationDataframe(slug);

      if (df.length === 0) {
        res.json({
          ok: true,
          slug,
          matoc_label: matocLabel,
          has_data: false,
          stats: null,
          timelineData: [],
          projectData: [],
          awardValueData: [],
          awardCountData: [],
          detail: [],
        });
        return;
      }

      const total_mods = df.length;
      const total_mod_value = df.reduce((s, r) => s + (Number(r["Mod Value"]) || 0), 0);
      const uniqueAwards = new Set(df.map((r) => String(r["Award/PIID"])));
      const awards_with_mods = uniqueAwards.size;
      const avg_mod_value = total_mods ? total_mod_value / total_mods : 0;

      let largest = df[0];
      for (const r of df) {
        if ((Number(r["Mod Value"]) || 0) > (Number(largest["Mod Value"]) || 0)) {
          largest = r;
        }
      }

      const stats = {
        total_mods,
        total_mod_value,
        awards_with_mods,
        avg_mod_value,
        largest_mod_value: Number(largest["Mod Value"]) || 0,
        largest_mod_award: String(largest["Award/PIID"] || ""),
        largest_mod_awardee: String(largest["Awardee"] || ""),
      };

      // Timeline by Month
      const monthMap = new Map<string, number>();
      const projMap = new Map<string, number>();
      const awardMap = new Map<
        string,
        { piid: string; awardee: string; modTotal: number; modCount: number }
      >();

      for (const r of df) {
        const mv = Number(r["Mod Value"]) || 0;
        const dt = String(r["Action Date"] || "").slice(0, 7);
        if (dt && /^\d{4}-\d{2}$/.test(dt)) {
          monthMap.set(dt, (monthMap.get(dt) || 0) + mv);
        }
        const pt = String(r["Project Type"] || "Unspecified").trim() || "Unspecified";
        projMap.set(pt, (projMap.get(pt) || 0) + mv);

        const piid = String(r["Award/PIID"] || "");
        const awardee = String(r["Awardee"] || "Unknown");
        const key = `${piid} - ${awardee}`;
        const cur = awardMap.get(key) || { piid, awardee, modTotal: 0, modCount: 0 };
        cur.modTotal += mv;
        cur.modCount += 1;
        awardMap.set(key, cur);
      }

      const timelineData = Array.from(monthMap.entries())
        .map(([month, modValue]) => ({ month, modValue }))
        .sort((a, b) => a.month.localeCompare(b.month));

      const projectData = Array.from(projMap.entries())
        .map(([projectType, modValue]) => ({ projectType, modValue }))
        .sort((a, b) => b.modValue - a.modValue)
        .slice(0, 10);

      const awardValueData = Array.from(awardMap.entries())
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.modTotal - a.modTotal)
        .slice(0, 15);

      const awardCountData = Array.from(awardMap.entries())
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.modCount - a.modCount)
        .slice(0, 15);

      res.json({
        ok: true,
        slug,
        matoc_label: matocLabel,
        has_data: true,
        stats,
        timelineData,
        projectData,
        awardValueData,
        awardCountData,
        detail: df,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Admin Panel Endpoints
  // --------------------------------------------------------------------------
  app.get("/api/admin/overview", async (_req, res) => {
    try {
      const reg = await loadRegistry();
      const matocsList = Object.values(reg).map((item) => ({
        slug: item.slug,
        label: item.label,
        table_name: item.table_name,
        category_key: item.category,
        category_label: MATOC_CATEGORIES[item.category]?.label || item.category,
        row_count: item.row_count || 0,
      }));
      const users = await getAllUsers();
      res.json({
        ok: true,
        matocs_list: matocsList,
        categories: MATOC_CATEGORIES,
        users,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/admin/matoc/create", async (req, res) => {
    try {
      const { label, category } = req.body || {};
      const slug = await createMatoc(String(label || ""), String(category || DEFAULT_CATEGORY));
      res.json({
        ok: true,
        slug,
        message: `MATOC '${label}' created (slug: ${slug}, table: bids_${slug.replace(/-/g, "_")}).`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/admin/matoc/:slug/category", async (req, res) => {
    try {
      const { slug } = req.params;
      const { category } = req.body || {};
      await setMatocCategory(slug, String(category));
      res.json({
        ok: true,
        message: `Moved '${slug}' to ${MATOC_CATEGORIES[category]?.label || category}.`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/admin/matoc/:slug/truncate", async (req, res) => {
    try {
      const { slug } = req.params;
      const matocs = await getMatocs();
      const label = matocs[slug] || slug;
      await truncateMatocTable(slug);
      res.json({
        ok: true,
        message: `All rows in '${label}' were deleted (table structure kept).`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.delete("/api/admin/matoc/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const matocs = await getMatocs();
      const label = matocs[slug] || slug;
      await deleteMatoc(slug);
      res.json({
        ok: true,
        message: `MATOC '${label}' and its physical table were permanently deleted.`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/admin/user/create", async (req, res) => {
    try {
      const { username, email, password, is_admin, is_super_admin } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ ok: false, error: "Username and password are required." });
        return;
      }
      const userId = await adminCreateUser(
        String(username),
        String(email || ""),
        String(password),
        Boolean(is_admin),
        Boolean(is_super_admin)
      );
      res.json({
        ok: true,
        user_id: userId,
        message: `User '${username}' created successfully.`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/admin/user/:userId/role", async (req, res) => {
    try {
      const { userId } = req.params;
      const { is_admin, is_super_admin } = req.body || {};
      await updateUserRole(Number(userId), Boolean(is_admin), Boolean(is_super_admin));
      res.json({ ok: true, message: "User role updated successfully." });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  // --------------------------------------------------------------------------
  // Database Connections, Schema Inspection & SQL Extraction Workbench Endpoints
  // --------------------------------------------------------------------------
  app.get("/api/db/status", async (_req, res) => {
    try {
      const state = await getDatabaseInspectorState();
      res.json({ ok: true, ...state });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/db/connect", async (req, res) => {
    try {
      const { host, port, user, password, database, preferMode } = req.body || {};
      const result = await configureMysqlConnection({
        host: String(host || "localhost"),
        port: Number(port || 3306),
        user: String(user || "root"),
        password: password != null ? String(password) : "",
        database: String(database || "chart"),
        preferMode,
      });
      const state = await getDatabaseInspectorState();
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/db/query", async (req, res) => {
    try {
      const { sql } = req.body || {};
      const result = await executeSqlQuery(String(sql || ""));
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  app.post("/api/db/import-sql", async (req, res) => {
    try {
      const { sqlContent } = req.body || {};
      if (!sqlContent || !String(sqlContent).trim()) {
        res.status(400).json({ ok: false, error: "No SQL content provided." });
        return;
      }
      const result = await importSqlDump(String(sqlContent));
      const state = await getDatabaseInspectorState();
      res.json({ ...result, state });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message });
    }
  });

  // Save the reason/debrief data. Does NOT call AI.
app.post("/api/reason/save", async (req, res) => {
  try {
    const d = req.body || {};
    const sum = Number(d.price_factor_pct) + Number(d.technical_factor_pct) + Number(d.past_performance_pct);
    if (!d.folder_number) return res.status(400).json({ ok: false, error: "folder_number required" });
    if (Math.abs(sum - 100) > 0.01) return res.status(400).json({ ok: false, error: "Percentages must total 100" });
    await saveDebrief(d);
    res.json({ ok: true });
  } catch (e: any) { res.status(400).json({ ok: false, error: e?.message }); }
});

app.get("/api/reason/:folder", async (req, res) => {
  res.json({ ok: true, data: await getReason(req.params.folder) });
});

// AI runs here, ONE time only
app.post("/api/reason/:folder/generate", async (req, res) => {
  const folder = req.params.folder;
  try {
    const row: any = await getReason(folder);
    if (!row) return res.status(404).json({ ok: false, error: "Save the debrief first." });

    if (row.ai_summary) // already done: return saved text, ZERO tokens used
      return res.json({ ok: true, cached: true, summary: row.ai_summary, recommendation: row.ai_recommendation });

    if (!(await claimAiRun(folder)))  // someone else is running it
      return res.status(409).json({ ok: false, error: "Already generating." });

    try {
      const out = await generateReasonAnalysis(row);
      await saveAiResult(folder, out.summary, out.recommendation);
      res.json({ ok: true, cached: false, ...out });
    } catch (e: any) {
      await markAiFailed(folder);   // allows a retry after a real failure
      res.status(502).json({ ok: false, error: e?.message });
    }
  } catch (e: any) { res.status(400).json({ ok: false, error: e?.message }); }
});

  // --------------------------------------------------------------------------
  // Vite Middleware (Dev) or Static Assets (Prod)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MATOC Contract & Database Intelligence Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
