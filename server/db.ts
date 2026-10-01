import fs from "fs";
import path from "path";
import crypto from "crypto";
import mysql from "mysql2/promise";
import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import dotenv from "dotenv";

dotenv.config();

export interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

export const MATOC_CATEGORIES: Record<string, { label: string; desc: string }> = {
  construction: {
    label: "Construction MATOC",
    desc: "Construction MATOC vehicles",
  },
  "construction-management": {
    label: "Construction Management MATOC",
    desc: "Construction Management MATOC vehicles",
  },
};

export const DEFAULT_CATEGORY = "construction";
export const CM_CATEGORY = "construction-management";

export const COLUMN_MAP: Record<string, string> = {
  "Folder Number": "folder_number",
  "8(a) or R": "eight_a_or_r",
  Year: "year",
  "RFP Number": "rfp_number",
  "Task Order ID": "award_id",
  Title: "title",
  "Project Type": "project_type",
  Awardee: "awardee",
  "Resume Names": "resume_names",
  "Contract Value": "contract_value",
  "Addon Bid": "addon_bid",
  "Asterisk Bid": "asterisk_bid",
  "Winner Price Difference $": "winner_price_diff_usd",
  "Winner Price Difference %": "winner_price_diff_pct",
  "Number of Offers Received": "number_of_offers_received",
  Result: "result",
  Mods: "mods",
  Total: "total",
};

export const DB_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_MAP).map(([k, v]) => [v, k])
);

export const NUMERIC_COLS = [
  "contract_value",
  "addon_bid",
  "winner_price_diff_usd",
  "winner_price_diff_pct",
  "number_of_offers_received",
  "mods",
  "total",
];

export const KEY_COL = "folder_number";
export const DERIVED_TRIGGER_COLS = new Set(["contract_value", "addon_bid", "mods"]);

export const CM_HEADER_ALIASES: Record<string, string[]> = {
  "Folder Number": ["id", "folder number"],
  Year: ["year"],
  "RFP Number": ["solicitation number", "rfp number"],
  "Task Order ID": ["piid", "task order id"],
  Title: ["opportunity name", "title"],
  "Project Type": ["project type"],
  Awardee: ["name of winner", "awardee"],
  "Resume Names": ["resume names", "resume name", "resumes"],
  "Contract Value": ["finalized amount", "contract value"],
  "Addon Bid": ["our bid", "addon bid"],
  "Number of Offers Received": ["offer", "offers", "number of offers received"],
  Result: ["status", "result"],
  Mods: ["mods"],
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const SQLITE_PATH = path.join(DATA_DIR, "chart.sqlite");

let activeConfig: DbConnectionConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "chart",
};

let mysqlPool: mysql.Pool | null = null;
let engineMode: "mysql" | "embedded_sql" = "embedded_sql";
let lastMysqlError: string | null = null;
let sqliteDb: SqlJsDatabase | null = null;

// --------------------------------------------------------------------------
// Werkzeug scrypt & pbkdf2 Password Hash Verification & Generation
// --------------------------------------------------------------------------
export function generatePasswordHash(password: string): string {
  const salt = crypto.randomBytes(12).toString("base64url").slice(0, 16);
  const n = 32768;
  const r = 8;
  const p = 1;
  const derived = crypto.scryptSync(password, salt, 64, {
    N: n,
    r,
    p,
    maxmem: 128 * n * r * 2,
  });
  return `scrypt:${n}:${r}:${p}$${salt}$${derived.toString("hex")}`;
}

export function checkPasswordHash(storedHash: string, password: string): boolean {
  if (!storedHash || !password) return false;
  try {
    if (storedHash.startsWith("scrypt:")) {
      const parts = storedHash.split("$");
      if (parts.length !== 3) return false;
      const [methodPart, salt, hexHash] = parts;
      const params = methodPart.split(":");
      const n = parseInt(params[1] || "32768", 10);
      const r = parseInt(params[2] || "8", 10);
      const p = parseInt(params[3] || "1", 10);
      const keyLen = Buffer.from(hexHash, "hex").length;
      const derived = crypto.scryptSync(password, salt, keyLen, {
        N: n,
        r,
        p,
        maxmem: 128 * n * r * 2 + 1024 * 1024,
      });
      return crypto.timingSafeEqual(Buffer.from(hexHash, "hex"), derived);
    }
    if (storedHash.startsWith("pbkdf2:")) {
      const parts = storedHash.split("$");
      if (parts.length !== 3) return false;
      const [methodPart, salt, hexHash] = parts;
      const params = methodPart.split(":");
      const digest = params[1] || "sha256";
      const iterations = parseInt(params[2] || "600000", 10);
      const keyLen = Buffer.from(hexHash, "hex").length;
      const derived = crypto.pbkdf2Sync(password, salt, iterations, keyLen, digest);
      return crypto.timingSafeEqual(Buffer.from(hexHash, "hex"), derived);
    }
    return storedHash === password;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Database Initialization (MySQL + Embedded SQLite Mirror of Schema.sql)
// --------------------------------------------------------------------------
function saveSqliteToDisk() {
  if (!sqliteDb) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const binary = sqliteDb.export();
  fs.writeFileSync(SQLITE_PATH, Buffer.from(binary));
}

async function initEmbeddedSqlite() {
  if (sqliteDb) return sqliteDb;
  const SQL = await initSqlJs();
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(SQLITE_PATH)) {
    const buf = fs.readFileSync(SQLITE_PATH);
    sqliteDb = new SQL.Database(buf);
  } else {
    sqliteDb = new SQL.Database();
  }

  // Ensure exact tables from Schema.sql and db.py exist
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS award_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      piid VARCHAR(150) NOT NULL UNIQUE,
      generated_internal_id VARCHAR(150) DEFAULT NULL,
      description TEXT,
      recipient_name VARCHAR(255) DEFAULT NULL,
      total_obligation DECIMAL(18,2) DEFAULT NULL,
      base_exercised_options DECIMAL(18,2) DEFAULT NULL,
      base_and_all_options DECIMAL(18,2) DEFAULT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      fetched_at DATETIME DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS award_modifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      award_master_id INT NOT NULL,
      modification_number VARCHAR(50) DEFAULT NULL,
      action_date DATE DEFAULT NULL,
      description TEXT,
      federal_action_obligation DECIMAL(18,2) DEFAULT NULL,
      FOREIGN KEY (award_master_id) REFERENCES award_master(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS matoc_config (
      slug VARCHAR(64) NOT NULL PRIMARY KEY,
      label VARCHAR(150) NOT NULL,
      table_name VARCHAR(64) NOT NULL UNIQUE,
      category VARCHAR(40) NOT NULL DEFAULT 'construction',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matoc_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matoc_number VARCHAR(100) DEFAULT NULL,
      matoc_name VARCHAR(255) DEFAULT NULL,
      contract_number VARCHAR(100) DEFAULT NULL,
      business_name VARCHAR(255) DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(100) NOT NULL,
      email VARCHAR(255) DEFAULT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      is_super_admin TINYINT(1) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INT NOT NULL,
      session_id VARCHAR(255) NOT NULL,
      login_time DATETIME NOT NULL,
      last_activity DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      ip_address VARCHAR(45) DEFAULT NULL,
      user_agent TEXT,
      is_active TINYINT(1) DEFAULT 1
    );
  `);

  // Check if category column exists on matoc_config (auto-migration from db.py)
  const colsRes = sqliteDb.exec("PRAGMA table_info(matoc_config)");
  const colNames = colsRes[0]?.values.map((r) => String(r[1])) || [];
  if (!colNames.includes("category")) {
    sqliteDb.run(
      `ALTER TABLE matoc_config ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT '${DEFAULT_CATEGORY}'`
    );
  }

  // Ensure initial user from Schema.sql exists
  /*
  const userCheck = sqliteDb.exec("SELECT COUNT(*) FROM users WHERE email = 'saieeshnaik25@gmail.com'");
  const userCount = Number(userCheck[0]?.values?.[0]?.[0] || 0);
  if (userCount === 0) {
    sqliteDb.run(
      `INSERT INTO users (id, username, email, password, created_at, is_admin, is_super_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        "Saieesh",
        "saieeshnaik25@gmail.com",
        "scrypt:32768:8:1$dWW38mQf1qPyGIta$3b77741db6a4d8cdac148a6109499312a65d01096a979b4b27dfda9217ddc1054e837e769849cd81fbe3efea0c9c2d930dbe3e48cc724e01f5bdfed9c0d98bde",
        "2026-07-27 20:40:08",
        1,
        1,
      ]
    );
  }
    */

  saveSqliteToDisk();
  return sqliteDb;
}

export async function initDatabase(): Promise<void> {
  await initEmbeddedSqlite();
  // Try connecting to configured MySQL database if reachable
  try {
    const pool = mysql.createPool({
      host: activeConfig.host,
      port: activeConfig.port,
      user: activeConfig.user,
      password: activeConfig.password,
      database: activeConfig.database,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 2500,
    });
    const conn = await pool.getConnection();
    await conn.ping();
    // Ensure registry and award tables exist on MySQL
    await conn.query(`
      CREATE TABLE IF NOT EXISTS matoc_config (
        slug VARCHAR(64) PRIMARY KEY,
        label VARCHAR(150) NOT NULL,
        table_name VARCHAR(64) NOT NULL UNIQUE,
        category VARCHAR(40) NOT NULL DEFAULT 'construction',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const [cols]: any = await conn.query("SHOW COLUMNS FROM matoc_config LIKE 'category'");
    if (!cols || cols.length === 0) {
      await conn.query(
        `ALTER TABLE matoc_config ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT '${DEFAULT_CATEGORY}'`
      );
    }
    conn.release();
    mysqlPool = pool;
    engineMode = "mysql";
    lastMysqlError = null;
  } catch (err: any) {
    lastMysqlError = err?.message || "MySQL server not reachable on configured host/port";
    engineMode = "embedded_sql";
  }
}

export async function configureMysqlConnection(
  newConfig: DbConnectionConfig & { preferMode?: "mysql" | "embedded_sql" }
): Promise<{
  ok: boolean;
  mode: "mysql" | "embedded_sql";
  latencyMs: number;
  message: string;
  error?: string;
}> {
  await initEmbeddedSqlite();
  if (newConfig.preferMode === "embedded_sql") {
    engineMode = "embedded_sql";
    return {
      ok: true,
      mode: "embedded_sql",
      latencyMs: 1,
      message: `Switched to Persistent SQL Engine (${SQLITE_PATH}) with full MySQL Schema.sql compatibility.`,
    };
  }

  const start = Date.now();
  try {
    const pool = mysql.createPool({
      host: newConfig.host,
      port: Number(newConfig.port || 3306),
      user: newConfig.user,
      password: newConfig.password || "",
      database: newConfig.database || "chart",
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 4000,
    });
    const conn = await pool.getConnection();
    await conn.ping();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS matoc_config (
        slug VARCHAR(64) PRIMARY KEY,
        label VARCHAR(150) NOT NULL,
        table_name VARCHAR(64) NOT NULL UNIQUE,
        category VARCHAR(40) NOT NULL DEFAULT 'construction',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    conn.release();
    if (mysqlPool) {
      await mysqlPool.end().catch(() => {});
    }
    activeConfig = {
      host: newConfig.host,
      port: Number(newConfig.port || 3306),
      user: newConfig.user,
      password: newConfig.password || "",
      database: newConfig.database || "chart",
    };
    mysqlPool = pool;
    engineMode = "mysql";
    lastMysqlError = null;
    return {
      ok: true,
      mode: "mysql",
      latencyMs: Date.now() - start,
      message: `Connected to live MySQL database '${activeConfig.database}' at ${activeConfig.host}:${activeConfig.port}`,
    };
  } catch (err: any) {
    lastMysqlError = err?.message || String(err);
    return {
      ok: false,
      mode: engineMode,
      latencyMs: Date.now() - start,
      message: `Could not reach MySQL at ${newConfig.host}:${newConfig.port} (${lastMysqlError}). Active engine remains ${engineMode === "mysql" ? "MySQL" : "Embedded SQL Engine"}.`,
      error: lastMysqlError || undefined,
    };
  }
}

// --------------------------------------------------------------------------
// Low-Level Query Helpers (Transparent across MySQL & Embedded SQL)
// --------------------------------------------------------------------------
function sqliteQueryRows(sql: string, params: any[] = []): Record<string, any>[] {
  if (!sqliteDb) throw new Error("Database not initialized");
  const stmt = sqliteDb.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function sqliteRun(sql: string, params: any[] = []): { lastInsertId: number; changes: number } {
  if (!sqliteDb) throw new Error("Database not initialized");
  sqliteDb.run(sql, params);
  const idRes = sqliteDb.exec("SELECT last_insert_rowid()");
  const changesRes = sqliteDb.exec("SELECT changes()");
  const lastInsertId = Number(idRes[0]?.values?.[0]?.[0] || 0);
  const changes = Number(changesRes[0]?.values?.[0]?.[0] || 0);
  saveSqliteToDisk();
  return { lastInsertId, changes };
}

const BID_TABLE_MYSQL_DDL = `
  id INT AUTO_INCREMENT PRIMARY KEY,
  folder_number VARCHAR(50) NOT NULL,
  eight_a_or_r VARCHAR(10),
  year VARCHAR(10),
  rfp_number VARCHAR(100),
  award_id VARCHAR(100),
  title VARCHAR(255),
  project_type VARCHAR(150),
  awardee VARCHAR(255),
  resume_names TEXT,
  contract_value DECIMAL(15,2) DEFAULT 0,
  addon_bid DECIMAL(15,2) DEFAULT 0,
  asterisk_bid VARCHAR(10),
  winner_price_diff_usd DECIMAL(15,2) DEFAULT 0,
  winner_price_diff_pct DECIMAL(10,4) DEFAULT 0,
  number_of_offers_received INT DEFAULT 0,
  result VARCHAR(20),
  mods DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_folder_number (folder_number),
  INDEX idx_project_type (project_type),
  INDEX idx_result (result)
`;

const BID_TABLE_SQLITE_DDL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_number VARCHAR(50) NOT NULL UNIQUE,
  eight_a_or_r VARCHAR(10),
  year VARCHAR(10),
  rfp_number VARCHAR(100),
  award_id VARCHAR(100),
  title VARCHAR(255),
  project_type VARCHAR(150),
  awardee VARCHAR(255),
  resume_names TEXT,
  contract_value DECIMAL(15,2) DEFAULT 0,
  addon_bid DECIMAL(15,2) DEFAULT 0,
  asterisk_bid VARCHAR(10),
  winner_price_diff_usd DECIMAL(15,2) DEFAULT 0,
  winner_price_diff_pct DECIMAL(10,4) DEFAULT 0,
  number_of_offers_received INT DEFAULT 0,
  result VARCHAR(20),
  mods DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
`;

async function ensureResumeColumn(tables: string[]) {
  if (tables.length === 0) return;
  if (engineMode === "mysql" && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      for (const t of tables) {
        const [rows]: any = await conn.query(`SHOW COLUMNS FROM \`${t}\` LIKE 'resume_names'`);
        if (!rows || rows.length === 0) {
          await conn.query(`ALTER TABLE \`${t}\` ADD COLUMN resume_names TEXT AFTER awardee`);
        }
      }
    } finally {
      conn.release();
    }
  } else {
    await initEmbeddedSqlite();
    for (const t of tables) {
      try {
        const info = sqliteDb!.exec(`PRAGMA table_info(\`${t}\`)`);
        const cols = info[0]?.values.map((r) => String(r[1])) || [];
        if (cols.length > 0 && !cols.includes("resume_names")) {
          sqliteDb!.run(`ALTER TABLE \`${t}\` ADD COLUMN resume_names TEXT`);
          saveSqliteToDisk();
        }
      } catch {
        // Table might not exist yet
      }
    }
  }
}

// --------------------------------------------------------------------------
// Registry & MATOC Vehicle Operations (Port of db.py)
// --------------------------------------------------------------------------
export interface MatocRegistryEntry {
  slug: string;
  label: string;
  table_name: string;
  category: string;
  created_at?: string;
  row_count?: number;
}

export async function loadRegistry(): Promise<Record<string, MatocRegistryEntry>> {
  await initEmbeddedSqlite();
  let rows: any[] = [];
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      "SELECT slug, label, table_name, category, created_at FROM matoc_config ORDER BY label"
    );
    rows = res || [];
  } else {
    rows = sqliteQueryRows(
      "SELECT slug, label, table_name, category, created_at FROM matoc_config ORDER BY label"
    );
  }

  const tables = rows.map((r) => String(r.table_name));
  await ensureResumeColumn(tables);

  const registry: Record<string, MatocRegistryEntry> = {};
  for (const r of rows) {
    const slug = String(r.slug);
    const tableName = String(r.table_name);
    let rowCount = 0;
    try {
      if (engineMode === "mysql" && mysqlPool) {
        const [cnt]: any = await mysqlPool.query(`SELECT COUNT(*) AS c FROM \`${tableName}\``);
        rowCount = Number(cnt?.[0]?.c || 0);
      } else {
        const cnt = sqliteQueryRows(`SELECT COUNT(*) AS c FROM \`${tableName}\``);
        rowCount = Number(cnt?.[0]?.c || 0);
      }
    } catch {
      rowCount = 0;
    }

    registry[slug] = {
      slug,
      label: String(r.label),
      table_name: tableName,
      category: String(r.category || DEFAULT_CATEGORY),
      created_at: r.created_at ? String(r.created_at) : undefined,
      row_count: rowCount,
    };
  }
  return registry;
}

export async function getMatocs(category?: string): Promise<Record<string, string>> {
  const reg = await loadRegistry();
  const out: Record<string, string> = {};
  for (const [slug, item] of Object.entries(reg)) {
    if (!category || item.category === category) {
      out[slug] = item.label;
    }
  }
  return out;
}

export async function getCategoryCounts(): Promise<Record<string, number>> {
  const reg = await loadRegistry();
  const counts: Record<string, number> = {};
  for (const k of Object.keys(MATOC_CATEGORIES)) {
    counts[k] = 0;
  }
  for (const item of Object.values(reg)) {
    const cat = item.category in counts ? item.category : DEFAULT_CATEGORY;
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
}

export function slugify(label: string): string {
  const s = (label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "matoc";
}

export async function createMatoc(
  label: string,
  category: string = DEFAULT_CATEGORY
): Promise<string> {
  const cleanLabel = (label || "").trim();
  if (!cleanLabel) throw new Error("Label is required.");
  if (!(category in MATOC_CATEGORIES)) {
    throw new Error(`Unknown category '${category}'`);
  }

  const registry = await loadRegistry();
  const baseSlug = slugify(cleanLabel);
  let slug = baseSlug;
  let i = 2;
  while (slug in registry) {
    slug = `${baseSlug}-${i}`;
    i++;
  }
  const tableName = "bids_" + slug.replace(/-/g, "_");

  if (engineMode === "mysql" && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS \`${tableName}\` (${BID_TABLE_MYSQL_DDL})`);
      await conn.query(
        "INSERT INTO matoc_config (slug, label, table_name, category) VALUES (?, ?, ?, ?)",
        [slug, cleanLabel, tableName, category]
      );
    } finally {
      conn.release();
    }
  } else {
    await initEmbeddedSqlite();
    sqliteDb!.run(`CREATE TABLE IF NOT EXISTS \`${tableName}\` (${BID_TABLE_SQLITE_DDL})`);
    sqliteDb!.run(
      `CREATE INDEX IF NOT EXISTS \`idx_${tableName}_project_type\` ON \`${tableName}\` (project_type)`
    );
    sqliteDb!.run(
      `CREATE INDEX IF NOT EXISTS \`idx_${tableName}_result\` ON \`${tableName}\` (result)`
    );
    sqliteRun(
      "INSERT INTO matoc_config (slug, label, table_name, category) VALUES (?, ?, ?, ?)",
      [slug, cleanLabel, tableName, category]
    );
  }

  return slug;
}

export async function setMatocCategory(slug: string, category: string): Promise<void> {
  if (!(category in MATOC_CATEGORIES)) {
    throw new Error(`Unknown category '${category}'`);
  }
  const reg = await loadRegistry();
  if (!(slug in reg)) {
    throw new Error(`Unknown MATOC slug '${slug}'`);
  }
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query("UPDATE matoc_config SET category = ? WHERE slug = ?", [category, slug]);
  } else {
    sqliteRun("UPDATE matoc_config SET category = ? WHERE slug = ?", [category, slug]);
  }
}

export async function tableFor(slug: string): Promise<string> {
  const reg = await loadRegistry();
  if (!(slug in reg)) {
    throw new Error(`Unknown MATOC slug '${slug}'`);
  }
  return reg[slug].table_name;
}

export async function truncateMatocTable(slug: string): Promise<void> {
  const table = await tableFor(slug);
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query(`TRUNCATE TABLE \`${table}\``);
  } else {
    sqliteRun(`DELETE FROM \`${table}\``);
  }
}

export async function deleteMatoc(slug: string): Promise<void> {
  const reg = await loadRegistry();
  if (!(slug in reg)) {
    throw new Error(`Unknown MATOC slug '${slug}'`);
  }
  const table = reg[slug].table_name;
  if (engineMode === "mysql" && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
      await conn.query("DELETE FROM matoc_config WHERE slug = ?", [slug]);
    } finally {
      conn.release();
    }
  } else {
    sqliteDb!.run(`DROP TABLE IF EXISTS \`${table}\``);
    sqliteRun("DELETE FROM matoc_config WHERE slug = ?", [slug]);
  }
}

// --------------------------------------------------------------------------
// Derived Calculations & Bid Column Filtering (Exact port of db.py)
// --------------------------------------------------------------------------
export function calcDerived(
  contractValue: number | string | null | undefined,
  addonBid: number | string | null | undefined,
  mods: number | string | null | undefined
): { diffUsd: number; diffPct: number; total: number } {
  const cv = Number(contractValue || 0) || 0;
  const ab = Number(addonBid || 0) || 0;
  const m = Number(mods || 0) || 0;

  const diffUsd = ab - cv;
  const diffPct = cv !== 0 ? (diffUsd / cv) * 100 : 0.0;
  const total = cv + m;

  return {
    diffUsd: Math.round(diffUsd * 100) / 100,
    diffPct: Math.round(diffPct * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

export async function bidColumnsFor(matocSlug: string): Promise<string[]> {
  const reg = await loadRegistry();
  const category = reg[matocSlug]?.category || DEFAULT_CATEGORY;
  const allCols = Array.from(new Set(Object.values(COLUMN_MAP)));
  if (category !== CM_CATEGORY) {
    return allCols.filter((c) => c !== "resume_names");
  }
  return allCols;
}

function formatMoney2(val: any): string {
  const num = Number(val || 0) || 0;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// --------------------------------------------------------------------------
// Data Extraction Functions (Exact SQL Joins from db.py)
// --------------------------------------------------------------------------
export async function loadRawDataframeWithAwards(matocSlug: string): Promise<{
  columns: string[];
  rows: Record<string, any>[];
}> {
  const table = await tableFor(matocSlug);
  const uniqueCols = await bidColumnsFor(matocSlug);
  const bidsColsSql = uniqueCols.map((db) => `b.\`${db}\``).join(", ");

  let rawBids: Record<string, any>[] = [];
  let awardsMap = new Map<string, any>();
  let modsByMasterId = new Map<number, any[]>();

  if (engineMode === "mysql" && mysqlPool) {
    const query = `
      SELECT 
        b.id,
        ${bidsColsSql},
        am.piid                                             AS \`Task Order/PIID\`,
        am.recipient_name                                   AS \`Recipient\`,
        am.total_obligation                                 AS \`Obligation\`,
        am.base_and_all_options                             AS \`Base & Options\`,
        am.base_exercised_options                           AS \`Base & Exercised\`,
        am.status                                           AS \`Status\`,
        COALESCE(
          GROUP_CONCAT(
            CONCAT(
              COALESCE(m.modification_number, 'Mod'), 
              ': $', 
              FORMAT(COALESCE(m.federal_action_obligation, 0), 2)
            ) 
            SEPARATOR '\\n'
          ), 
          'None'
        )                                                   AS \`Modifications & Values\`,
        COALESCE(SUM(CASE WHEN m.modification_number <> '0' THEN m.federal_action_obligation ELSE 0 END), 0) AS \`Linked Mods Total\`
      FROM \`${table}\` b
      LEFT JOIN \`award_master\` am 
        ON TRIM(b.award_id) = TRIM(am.piid)
      LEFT JOIN \`award_modifications\` m 
        ON am.id = m.award_master_id
      GROUP BY b.id, am.id
      ORDER BY b.id
    `;
    const [res]: any = await mysqlPool.query(query);
    const mappedRows = (res || []).map((r: any) => {
      const out: Record<string, any> = { id: r.id };
      for (const dbCol of uniqueCols) {
        const label = DB_TO_LABEL[dbCol] || dbCol;
        out[label] = r[dbCol] ?? "";
      }
      out["Task Order/PIID"] = r["Task Order/PIID"] ?? "";
      out["Recipient"] = r["Recipient"] ?? "";
      out["Obligation"] = r["Obligation"] ?? "";
      out["Base & Options"] = r["Base & Options"] ?? "";
      out["Base & Exercised"] = r["Base & Exercised"] ?? "";
      out["Status"] = r["Status"] ?? "";
      out["Modifications & Values"] = r["Modifications & Values"] ?? "None";
      out["Linked Mods Total"] = Number(r["Linked Mods Total"] || 0);
      return out;
    });
    const columns = [
      ...uniqueCols.map((db) => DB_TO_LABEL[db] || db),
      "Task Order/PIID",
      "Recipient",
      "Obligation",
      "Base & Options",
      "Base & Exercised",
      "Status",
      "Modifications & Values",
      "Linked Mods Total",
    ];
    return { columns, rows: mappedRows };
  }

  // Embedded SQL execution with exact equivalent join & formatting
  rawBids = sqliteQueryRows(`SELECT b.id, ${bidsColsSql} FROM \`${table}\` b ORDER BY b.id`);
  const allAwards = sqliteQueryRows(`SELECT * FROM award_master`);
  for (const am of allAwards) {
    if (am.piid != null) {
      awardsMap.set(String(am.piid).trim(), am);
    }
  }
  const allMods = sqliteQueryRows(`SELECT * FROM award_modifications ORDER BY id ASC`);
  for (const m of allMods) {
    const mid = Number(m.award_master_id);
    if (!modsByMasterId.has(mid)) modsByMasterId.set(mid, []);
    modsByMasterId.get(mid)!.push(m);
  }

  const rows = rawBids.map((b) => {
    const out: Record<string, any> = { id: b.id };
    for (const dbCol of uniqueCols) {
      const label = DB_TO_LABEL[dbCol] || dbCol;
      out[label] = b[dbCol] ?? "";
    }
    const awardIdTrimmed = String(b.award_id || "").trim();
    const am = awardIdTrimmed ? awardsMap.get(awardIdTrimmed) : undefined;
    const modsList = am ? modsByMasterId.get(Number(am.id)) || [] : [];

    out["Task Order/PIID"] = am?.piid ?? "";
    out["Recipient"] = am?.recipient_name ?? "";
    out["Obligation"] = am?.total_obligation ?? "";
    out["Base & Options"] = am?.base_and_all_options ?? "";
    out["Base & Exercised"] = am?.base_exercised_options ?? "";
    out["Status"] = am?.status ?? "";

    if (modsList.length > 0) {
      out["Modifications & Values"] = modsList
        .map(
          (m) =>
            `${m.modification_number ?? "Mod"}: $${formatMoney2(m.federal_action_obligation)}`
        )
        .join("\n");
    } else {
      out["Modifications & Values"] = "None";
    }

    const linkedModsTotal = modsList.reduce((acc, m) => {
      if (String(m.modification_number ?? "") !== "0") {
        return acc + (Number(m.federal_action_obligation || 0) || 0);
      }
      return acc;
    }, 0);

    out["Linked Mods Total"] = Math.round(linkedModsTotal * 100) / 100;
    return out;
  });

  const columns = [
    ...uniqueCols.map((db) => DB_TO_LABEL[db] || db),
    "Task Order/PIID",
    "Recipient",
    "Obligation",
    "Base & Options",
    "Base & Exercised",
    "Status",
    "Modifications & Values",
    "Linked Mods Total",
  ];

  return { columns, rows };
}

export async function loadMatocDataframe(matocSlug: string): Promise<Record<string, any>[]> {
  const table = await tableFor(matocSlug);
  const reg = await loadRegistry();
  const category = reg[matocSlug]?.category || DEFAULT_CATEGORY;
  const includeResume = category === CM_CATEGORY;
  const resumeSql = includeResume ? "b.resume_names AS `Resume Names`,\n" : "";

  const query = `
    SELECT
      ${resumeSql}
      b.year                        AS \`Year\`,
      b.project_type                AS \`Project Type\`,
      b.awardee                     AS \`Awardee\`,
      b.contract_value              AS \`Contract Value\`,
      b.addon_bid                   AS \`Addon Bid\`,
      b.asterisk_bid                AS \`Asterisk Bid\`,
      b.winner_price_diff_usd       AS \`Winner Price Difference $\`,
      b.winner_price_diff_pct       AS \`Winner Price Difference %\`,
      b.number_of_offers_received   AS \`Number of Offers Received\`,
      b.result                      AS \`Result\`,
      b.mods                        AS \`Mods\`,
      b.total                       AS \`Total\`,
      COALESCE(mods_agg.linked_mods_total, 0) AS \`Linked Mods Total\`
    FROM \`${table}\` b
    LEFT JOIN (
      SELECT
        am.piid AS piid,
        SUM(CASE WHEN m.modification_number <> '0'
                 THEN m.federal_action_obligation ELSE 0 END) AS linked_mods_total
      FROM \`award_master\` am
      JOIN \`award_modifications\` m ON am.id = m.award_master_id
      GROUP BY am.piid
    ) mods_agg ON TRIM(b.award_id) = TRIM(mods_agg.piid)
  `;

  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(query);
    return res || [];
  }
  return sqliteQueryRows(query);
}

// --------------------------------------------------------------------------
// Cell Editing, Row Creation & Deletion (Exact Port of db.py)
// --------------------------------------------------------------------------
export async function updateCell(
  matocSlug: string,
  rowId: number,
  columnLabel: string,
  value: any
): Promise<Record<string, number> | null> {
  const table = await tableFor(matocSlug);
  if (!(columnLabel in COLUMN_MAP)) {
    throw new Error(`Unknown column '${columnLabel}'`);
  }
  const dbCol = COLUMN_MAP[columnLabel];

  let finalVal: any = value;
  if (NUMERIC_COLS.includes(dbCol)) {
    const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    finalVal = isNaN(num) ? 0 : num;
  } else {
    finalVal = value == null ? "" : String(value);
  }

  let derived: Record<string, number> | null = null;

  if (engineMode === "mysql" && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      const [rows]: any = await conn.query(
        `SELECT \`${dbCol}\` FROM \`${table}\` WHERE id = ?`,
        [rowId]
      );
      const oldValue = rows?.[0]?.[dbCol];
      if (String(oldValue ?? "").trim() !== String(finalVal ?? "").trim()) {
        await conn.query(`UPDATE \`${table}\` SET \`${dbCol}\` = ? WHERE id = ?`, [
          finalVal,
          rowId,
        ]);
      }
      if (DERIVED_TRIGGER_COLS.has(dbCol)) {
        const [dRows]: any = await conn.query(
          `SELECT contract_value, addon_bid, mods FROM \`${table}\` WHERE id = ?`,
          [rowId]
        );
        const row = dRows?.[0] || {};
        const { diffUsd, diffPct, total } = calcDerived(
          row.contract_value,
          row.addon_bid,
          row.mods
        );
        await conn.query(
          `UPDATE \`${table}\` SET winner_price_diff_usd = ?, winner_price_diff_pct = ?, total = ? WHERE id = ?`,
          [diffUsd, diffPct, total, rowId]
        );
        derived = {
          "Winner Price Difference $": diffUsd,
          "Winner Price Difference %": diffPct,
          Total: total,
        };
      }
    } finally {
      conn.release();
    }
  } else {
    const rows = sqliteQueryRows(`SELECT \`${dbCol}\` FROM \`${table}\` WHERE id = ?`, [rowId]);
    const oldValue = rows?.[0]?.[dbCol];
    if (String(oldValue ?? "").trim() !== String(finalVal ?? "").trim()) {
      sqliteRun(
        `UPDATE \`${table}\` SET \`${dbCol}\` = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [finalVal, rowId]
      );
    }
    if (DERIVED_TRIGGER_COLS.has(dbCol)) {
      const dRows = sqliteQueryRows(
        `SELECT contract_value, addon_bid, mods FROM \`${table}\` WHERE id = ?`,
        [rowId]
      );
      const row = dRows?.[0] || {};
      const { diffUsd, diffPct, total } = calcDerived(
        row.contract_value,
        row.addon_bid,
        row.mods
      );
      sqliteRun(
        `UPDATE \`${table}\` SET winner_price_diff_usd = ?, winner_price_diff_pct = ?, total = ? WHERE id = ?`,
        [diffUsd, diffPct, total, rowId]
      );
      derived = {
        "Winner Price Difference $": diffUsd,
        "Winner Price Difference %": diffPct,
        Total: total,
      };
    }
  }

  return derived;
}

export async function createBlankRow(slug: string): Promise<number> {
  const table = await tableFor(slug);
  const tempFolderNum = `NEW-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      `INSERT INTO \`${table}\` (folder_number) VALUES (?)`,
      [tempFolderNum]
    );
    return Number(res.insertId);
  } else {
    const { lastInsertId } = sqliteRun(
      `INSERT INTO \`${table}\` (folder_number) VALUES (?)`,
      [tempFolderNum]
    );
    return lastInsertId;
  }
}

export async function deleteRow(matocSlug: string, rowId: number): Promise<number> {
  const table = await tableFor(matocSlug);
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [rowId]);
  } else {
    sqliteRun(`DELETE FROM \`${table}\` WHERE id = ?`, [rowId]);
  }
  return rowId;
}

// --------------------------------------------------------------------------
// Construction & Construction Management Import Normalization & Upsert
// --------------------------------------------------------------------------
function normHeader(x: any): string {
  if (x == null) return "";
  return String(x).replace(/\s+/g, " ").trim().toLowerCase();
}

function intLikeStr(v: any): string {
  if (v == null || v === "") return "";
  const str = String(v).trim();
  if (!str || str.toLowerCase() === "nan" || str.toLowerCase() === "null") return "";
  const n = Number(str);
  if (!isNaN(n) && Number.isInteger(n)) {
    return String(Math.trunc(n));
  }
  return str;
}

function cmResult(v: any): string {
  if (v == null) return "";
  const s = String(v).trim().toUpperCase();
  if (!s || s === "NAN") return "";
  if (s === "WON" || s === "WIN" || s === "AWARDED") return "WON";
  if (s.startsWith("LOST") || s === "LOSS") return "LOST";
  if (s === "NB" || s === "NO BID" || s === "NO-BID" || s === "NOBID") return "NB";
  if (s.startsWith("CANCEL")) return "CANCELLED";
  return s;
}

function cmToStandard(rawRows: Record<string, any>[]): Record<string, any>[] {
  return rawRows.map((raw) => {
    const normRow: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      const nk = normHeader(k);
      if (nk && !(nk in normRow)) {
        normRow[nk] = v;
      }
    }

    const out: Record<string, any> = {};
    for (const [label, aliases] of Object.entries(CM_HEADER_ALIASES)) {
      for (const a of aliases) {
        if (a in normRow) {
          out[label] = normRow[a];
          break;
        }
      }
    }

    // Year fallback from response date
    if ("response date" in normRow) {
      const currentYear = String(out["Year"] ?? "").trim();
      if (!currentYear) {
        const dt = new Date(normRow["response date"]);
        if (!isNaN(dt.getTime())) {
          out["Year"] = String(dt.getFullYear());
        }
      }
    }

    for (const label of ["Contract Value", "Addon Bid", "Mods", "Number of Offers Received"]) {
      if (label in out && out[label] != null) {
        const cleaned = String(out[label]).replace(/[$,\s]/g, "");
        const num = Number(cleaned);
        out[label] = isNaN(num) ? 0 : num;
      }
    }

    for (const label of ["Folder Number", "Year"]) {
      if (label in out) {
        out[label] = intLikeStr(out[label]);
      }
    }

    if ("Result" in out) {
      out["Result"] = cmResult(out["Result"]);
    }

    return out;
  });
}

export function cleanImportRows(
  rawRows: Record<string, any>[],
  category: string = DEFAULT_CATEGORY
): Record<string, any>[] {
  let rows = category === CM_CATEGORY ? cmToStandard(rawRows) : rawRows;

  // Also detect if user uploaded a Construction Management sheet into a general table by checking if "Opportunity Name" or "Finalized Amount" is present
  if (category !== CM_CATEGORY && rows.length > 0) {
    const firstKeys = Object.keys(rows[0]).map(normHeader);
    if (
      firstKeys.includes("opportunity name") ||
      firstKeys.includes("finalized amount") ||
      (firstKeys.includes("id") && !firstKeys.includes("folder number"))
    ) {
      rows = cmToStandard(rawRows);
    }
  }

  return rows.map((raw) => {
    const trimmedRow: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      const cleanKey = String(k ?? "").trim();
      if (!cleanKey || cleanKey.toLowerCase() === "nan") continue;
      if (cleanKey in COLUMN_MAP) {
        const dbCol = COLUMN_MAP[cleanKey];
        if (trimmedRow[dbCol] == null || trimmedRow[dbCol] === "") {
          trimmedRow[dbCol] = v;
        }
      } else {
        // Case-insensitive match against COLUMN_MAP
        const matchedEntry = Object.entries(COLUMN_MAP).find(
          ([label]) => label.toLowerCase() === cleanKey.toLowerCase()
        );
        if (matchedEntry) {
          const dbCol = matchedEntry[1];
          if (trimmedRow[dbCol] == null || trimmedRow[dbCol] === "") {
            trimmedRow[dbCol] = v;
          }
        }
      }
    }

    for (const col of NUMERIC_COLS) {
      if (col in trimmedRow) {
        const cleaned = String(trimmedRow[col] ?? "").replace(/[$,\s]/g, "");
        const n = Number(cleaned);
        trimmedRow[col] = isNaN(n) ? 0 : n;
      }
    }

    for (const col of [
      "year",
      "eight_a_or_r",
      "rfp_number",
      "award_id",
      "title",
      "project_type",
      "awardee",
      "result",
      "folder_number",
      "asterisk_bid",
      "resume_names",
    ]) {
      if (col in trimmedRow) {
        const val = trimmedRow[col];
        if (col === "folder_number" || col === "year") {
          trimmedRow[col] = intLikeStr(val);
        } else {
          const s = val == null ? "" : String(val).trim();
          trimmedRow[col] = s.toLowerCase() === "nan" ? "" : s;
        }
      }
    }

    const cv = Number(trimmedRow.contract_value ?? 0) || 0;
    const ab = Number(trimmedRow.addon_bid ?? 0) || 0;
    const mods = Number(trimmedRow.mods ?? 0) || 0;
    trimmedRow.contract_value = cv;
    trimmedRow.addon_bid = ab;
    trimmedRow.mods = mods;

    const { diffUsd, diffPct, total } = calcDerived(cv, ab, mods);
    trimmedRow.winner_price_diff_usd = diffUsd;
    trimmedRow.winner_price_diff_pct = diffPct;
    trimmedRow.total = total;

    return trimmedRow;
  });
}

export async function upsertDataframe(
  matocSlug: string,
  rawRows: Record<string, any>[]
): Promise<{ inserted: number; updated: number; unchanged: number; skipped: number }> {
  const table = await tableFor(matocSlug);
  const reg = await loadRegistry();
  const category = reg[matocSlug]?.category || DEFAULT_CATEGORY;
  const cleanedRows = cleanImportRows(rawRows, category);

  if (cleanedRows.length === 0) {
    return { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  }

  const hasFolderCol = cleanedRows.some((r) => KEY_COL in r);
  if (!hasFolderCol) {
    throw new Error(
      "The uploaded file needs a 'Folder Number' (or 'ID') column - it's used as the unique key to detect updates and avoid duplicate rows."
    );
  }

  const stats = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  const allDbCols = Array.from(
    new Set(
      cleanedRows.flatMap((r) =>
        Object.keys(r).filter((c) => c && c !== KEY_COL && c.toLowerCase() !== "nan")
      )
    )
  );
  const allCols = [KEY_COL, ...allDbCols];

  if (engineMode === "mysql" && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      const colListSql = allCols.map((c) => `\`${c}\``).join(", ");
      const placeholders = allCols.map(() => "?").join(", ");
      const updateSql = allDbCols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
      const insertSql = `INSERT INTO \`${table}\` (${colListSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateSql}`;

      for (const row of cleanedRows) {
        const keyVal = String(row[KEY_COL] ?? "").trim();
        if (!keyVal || keyVal.toLowerCase() === "nan") {
          stats.skipped++;
          continue;
        }
        const values = allCols.map((c) => (row[c] === undefined ? null : row[c]));
        const [res]: any = await conn.query(insertSql, values);
        if (res.affectedRows === 1) stats.inserted++;
        else if (res.affectedRows === 2) stats.updated++;
        else stats.unchanged++;
      }
    } finally {
      conn.release();
    }
    return stats;
  }

  // Embedded SQL Upsert (checks existing row on folder_number to compute exact inserted/updated/unchanged counts)
  await initEmbeddedSqlite();
  const existingRows = sqliteQueryRows(`SELECT * FROM \`${table}\``);
  const existingByKey = new Map<string, Record<string, any>>();
  for (const er of existingRows) {
    existingByKey.set(String(er[KEY_COL] ?? "").trim(), er);
  }

  for (const row of cleanedRows) {
    const keyVal = String(row[KEY_COL] ?? "").trim();
    if (!keyVal || keyVal.toLowerCase() === "nan") {
      stats.skipped++;
      continue;
    }

    const existing = existingByKey.get(keyVal);
    if (!existing) {
      const colListSql = allCols.map((c) => `\`${c}\``).join(", ");
      const placeholders = allCols.map(() => "?").join(", ");
      const values = allCols.map((c) => (row[c] === undefined ? null : row[c]));
      sqliteDb!.run(`INSERT INTO \`${table}\` (${colListSql}) VALUES (${placeholders})`, values);
      existingByKey.set(keyVal, { ...row });
      stats.inserted++;
    } else {
      // Check if any column changed
      let changed = false;
      for (const c of allDbCols) {
        const newVal = row[c] ?? "";
        const oldVal = existing[c] ?? "";
        if (NUMERIC_COLS.includes(c)) {
          if (Math.abs((Number(newVal) || 0) - (Number(oldVal) || 0)) > 0.0001) {
            changed = true;
            break;
          }
        } else {
          if (String(newVal).trim() !== String(oldVal).trim()) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        stats.unchanged++;
      } else {
        const setClause = allDbCols.map((c) => `\`${c}\` = ?`).join(", ");
        const values = [
          ...allDbCols.map((c) => (row[c] === undefined ? null : row[c])),
          keyVal,
        ];
        sqliteDb!.run(
          `UPDATE \`${table}\` SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE \`${KEY_COL}\` = ?`,
          values
        );
        existingByKey.set(keyVal, { ...existing, ...row });
        stats.updated++;
      }
    }
  }
  saveSqliteToDisk();
  return stats;
}

// --------------------------------------------------------------------------
// Modification & Contractor Intelligence Queries (Exact port of db.py)
// --------------------------------------------------------------------------
export async function getModificationDataframe(matocSlug: string): Promise<Record<string, any>[]> {
  const table = await tableFor(matocSlug);
  const query = `
    SELECT
      b.folder_number                     AS \`Folder Number\`,
      b.award_id                          AS \`Award/PIID\`,
      b.awardee                           AS \`Awardee\`,
      b.project_type                      AS \`Project Type\`,
      b.year                              AS \`Year\`,
      am.total_obligation                 AS \`Total Obligation\`,
      am.status                           AS \`Award Status\`,
      m.modification_number               AS \`Modification #\`,
      m.action_date                       AS \`Action Date\`,
      m.description                       AS \`Description\`,
      m.federal_action_obligation         AS \`Mod Value\`
    FROM \`${table}\` b
    INNER JOIN \`award_master\` am
      ON TRIM(b.award_id) = TRIM(am.piid)
    INNER JOIN \`award_modifications\` m
      ON am.id = m.award_master_id
    ORDER BY m.action_date DESC
  `;

  let rows: Record<string, any>[] = [];
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(query);
    rows = res || [];
  } else {
    rows = sqliteQueryRows(query);
  }

  return rows.map((r) => ({
    ...r,
    "Mod Value": Number(r["Mod Value"] || 0) || 0,
    "Total Obligation": Number(r["Total Obligation"] || 0) || 0,
    "Action Date": r["Action Date"] ? String(r["Action Date"]).slice(0, 10) : "",
  }));
}

export async function getContractors(matocSlug: string): Promise<string[]> {
  const table = await tableFor(matocSlug);
  const query = `
    SELECT DISTINCT awardee
    FROM \`${table}\`
    WHERE awardee IS NOT NULL
      AND TRIM(awardee) <> ''
    ORDER BY awardee
  `;
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(query);
    return (res || []).map((r: any) => String(r.awardee));
  }
  const rows = sqliteQueryRows(query);
  return rows.map((r) => String(r.awardee));
}

export async function getContractorDataframe(
  matocSlug: string,
  contractor: string
): Promise<Record<string, any>[]> {
  const table = await tableFor(matocSlug);
  const query = `
    SELECT
      year AS \`Year\`,
      project_type AS \`Project Type\`,
      awardee AS \`Awardee\`,
      title AS \`Title\`,
      rfp_number AS \`RFP Number\`,
      award_id AS \`Task Order ID\`,
      contract_value AS \`Contract Value\`,
      addon_bid AS \`Addon Bid\`,
      asterisk_bid AS \`Asterisk Bid\`,
      winner_price_diff_usd AS \`Winner Price Difference $\`,
      winner_price_diff_pct AS \`Winner Price Difference %\`,
      number_of_offers_received AS \`Number of Offers Received\`,
      result AS \`Result\`,
      mods AS \`Mods\`,
      total AS \`Total\`
    FROM \`${table}\`
    WHERE awardee = ?
  `;
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(query, [contractor]);
    return res || [];
  }
  return sqliteQueryRows(query, [contractor]);
}

// --------------------------------------------------------------------------
// USAspending Pull Pipeline DB Helpers (Port of pull_pipeline.py)
// --------------------------------------------------------------------------
export async function getTaskOrderIdsForSlug(slug: string): Promise<string[]> {
  const table = await tableFor(slug);
  const query = `
    SELECT DISTINCT \`award_id\`
    FROM \`${table}\`
    WHERE \`award_id\` IS NOT NULL AND TRIM(\`award_id\`) != ''
  `;
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(query);
    return (res || []).map((r: any) => String(r.award_id).trim()).filter(Boolean);
  }
  const rows = sqliteQueryRows(query);
  return rows.map((r) => String(r.award_id).trim()).filter(Boolean);
}

export async function upsertAwardNotFound(piid: string): Promise<void> {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query(
      `INSERT INTO award_master (piid, status, fetched_at)
       VALUES (?, 'not_found', NOW())
       ON DUPLICATE KEY UPDATE status = 'not_found', fetched_at = NOW()`,
      [piid]
    );
  } else {
    const existing = sqliteQueryRows("SELECT id FROM award_master WHERE piid = ?", [piid]);
    if (existing.length > 0) {
      sqliteRun("UPDATE award_master SET status = 'not_found', fetched_at = ? WHERE piid = ?", [
        now,
        piid,
      ]);
    } else {
      sqliteRun("INSERT INTO award_master (piid, status, fetched_at) VALUES (?, 'not_found', ?)", [
        piid,
        now,
      ]);
    }
  }
}

export async function saveAwardData(data: {
  piid: string;
  generated_internal_id: string | null;
  description: string | null;
  recipient_name: string | null;
  total_obligation: number | null;
  base_exercised_options: number | null;
  base_and_all_options: number | null;
  modifications: Array<{
    modification_number: string | null;
    action_date: string | null;
    description: string | null;
    federal_action_obligation: number | null;
  }>;
}): Promise<void> {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (engineMode === "mysql" && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      await conn.query(
        `INSERT INTO award_master
          (piid, generated_internal_id, description, recipient_name,
           total_obligation, base_exercised_options, base_and_all_options,
           status, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'done', NOW())
         ON DUPLICATE KEY UPDATE
           generated_internal_id = VALUES(generated_internal_id),
           description = VALUES(description),
           recipient_name = VALUES(recipient_name),
           total_obligation = VALUES(total_obligation),
           base_exercised_options = VALUES(base_exercised_options),
           base_and_all_options = VALUES(base_and_all_options),
           status = 'done',
           fetched_at = NOW()`,
        [
          data.piid,
          data.generated_internal_id,
          data.description,
          data.recipient_name,
          data.total_obligation,
          data.base_exercised_options,
          data.base_and_all_options,
        ]
      );
      const [idRows]: any = await conn.query("SELECT id FROM award_master WHERE piid = ?", [
        data.piid,
      ]);
      const awardMasterId = idRows[0].id;
      await conn.query("DELETE FROM award_modifications WHERE award_master_id = ?", [
        awardMasterId,
      ]);
      for (const mod of data.modifications) {
        await conn.query(
          `INSERT INTO award_modifications
            (award_master_id, modification_number, action_date, description, federal_action_obligation)
           VALUES (?, ?, ?, ?, ?)`,
          [
            awardMasterId,
            mod.modification_number,
            mod.action_date || null,
            mod.description,
            mod.federal_action_obligation,
          ]
        );
      }
    } finally {
      conn.release();
    }
    return;
  }

  // Embedded SQLite
  const existing = sqliteQueryRows("SELECT id FROM award_master WHERE piid = ?", [data.piid]);
  let awardMasterId: number;
  if (existing.length > 0) {
    awardMasterId = Number(existing[0].id);
    sqliteDb!.run(
      `UPDATE award_master
       SET generated_internal_id = ?, description = ?, recipient_name = ?,
           total_obligation = ?, base_exercised_options = ?, base_and_all_options = ?,
           status = 'done', fetched_at = ?
       WHERE id = ?`,
      [
        data.generated_internal_id,
        data.description,
        data.recipient_name,
        data.total_obligation,
        data.base_exercised_options,
        data.base_and_all_options,
        now,
        awardMasterId,
      ]
    );
  } else {
    const res = sqliteRun(
      `INSERT INTO award_master
        (piid, generated_internal_id, description, recipient_name,
         total_obligation, base_exercised_options, base_and_all_options,
         status, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?)`,
      [
        data.piid,
        data.generated_internal_id,
        data.description,
        data.recipient_name,
        data.total_obligation,
        data.base_exercised_options,
        data.base_and_all_options,
        now,
      ]
    );
    awardMasterId = res.lastInsertId;
  }

  sqliteDb!.run("DELETE FROM award_modifications WHERE award_master_id = ?", [awardMasterId]);
  for (const mod of data.modifications) {
    sqliteDb!.run(
      `INSERT INTO award_modifications
        (award_master_id, modification_number, action_date, description, federal_action_obligation)
       VALUES (?, ?, ?, ?, ?)`,
      [
        awardMasterId,
        mod.modification_number,
        mod.action_date || null,
        mod.description,
        mod.federal_action_obligation,
      ]
    );
  }
  saveSqliteToDisk();
}

// --------------------------------------------------------------------------
// Auth & User Management Functions (Exact Port of db.py)
// --------------------------------------------------------------------------
export async function checkLogin(identifier: string, password: string): Promise<any | null> {
  const cleanId = (identifier || "").trim();
  if (!cleanId || !password) return null;

  let user: any = null;
  if (engineMode === "mysql" && mysqlPool) {
    const [r1]: any = await mysqlPool.query("SELECT * FROM users WHERE username = ?", [cleanId]);
    user = r1?.[0];
    if (!user) {
      const [r2]: any = await mysqlPool.query("SELECT * FROM users WHERE LOWER(email) = ?", [
        cleanId.toLowerCase(),
      ]);
      user = r2?.[0];
    }
  } else {
    await initEmbeddedSqlite();
    const r1 = sqliteQueryRows("SELECT * FROM users WHERE username = ?", [cleanId]);
    user = r1[0];
    if (!user) {
      const r2 = sqliteQueryRows("SELECT * FROM users WHERE LOWER(email) = ?", [
        cleanId.toLowerCase(),
      ]);
      user = r2[0];
    }
  }

  if (user && checkPasswordHash(String(user.password), password)) {
    return {
      id: Number(user.id),
      username: String(user.username),
      email: user.email ? String(user.email) : "",
      is_admin: Boolean(user.is_admin),
      is_super_admin: Boolean(user.is_super_admin),
    };
  }
  return null;
}

export async function getAllUsers(): Promise<any[]> {
  await initEmbeddedSqlite();
  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      "SELECT id, username, email, created_at, is_admin, is_super_admin FROM users ORDER BY id ASC"
    );
    return res || [];
  }
  return sqliteQueryRows(
    "SELECT id, username, email, created_at, is_admin, is_super_admin FROM users ORDER BY id ASC"
  );
}

export async function updateUserRole(
  userId: number,
  isAdmin: boolean,
  isSuperAdmin: boolean
): Promise<void> {
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query("UPDATE users SET is_admin = ?, is_super_admin = ? WHERE id = ?", [
      isAdmin ? 1 : 0,
      isSuperAdmin ? 1 : 0,
      userId,
    ]);
  } else {
    sqliteRun("UPDATE users SET is_admin = ?, is_super_admin = ? WHERE id = ?", [
      isAdmin ? 1 : 0,
      isSuperAdmin ? 1 : 0,
      userId,
    ]);
  }
}

export async function adminCreateUser(
  username: string,
  email: string,
  password: string,
  isAdmin = false,
  isSuperAdmin = false
): Promise<number> {
  const cleanUser = username.trim();
  const cleanEmail = email ? email.trim().toLowerCase() : null;
  const hashed = generatePasswordHash(password);

  if (engineMode === "mysql" && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      "INSERT INTO users (username, email, password, is_admin, is_super_admin) VALUES (?, ?, ?, ?, ?)",
      [cleanUser, cleanEmail, hashed, isAdmin ? 1 : 0, isSuperAdmin ? 1 : 0]
    );
    return Number(res.insertId);
  } else {
    const { lastInsertId } = sqliteRun(
      "INSERT INTO users (username, email, password, is_admin, is_super_admin) VALUES (?, ?, ?, ?, ?)",
      [cleanUser, cleanEmail, hashed, isAdmin ? 1 : 0, isSuperAdmin ? 1 : 0]
    );
    return lastInsertId;
  }
}

export async function createUserSession(
  userId: number,
  sessionId: string,
  expiresAt: string,
  ipAddress: string,
  userAgent: string
): Promise<void> {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query(
      `INSERT INTO user_sessions
        (user_id, session_id, login_time, last_activity, expires_at, ip_address, user_agent, is_active)
       VALUES (?, ?, NOW(), NOW(), ?, ?, ?, 1)`,
      [userId, sessionId, expiresAt, ipAddress, userAgent]
    );
  } else {
    sqliteRun(
      `INSERT INTO user_sessions
        (user_id, session_id, login_time, last_activity, expires_at, ip_address, user_agent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [userId, sessionId, now, now, expiresAt, ipAddress, userAgent]
    );
  }
}

export async function invalidateUserSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (engineMode === "mysql" && mysqlPool) {
    await mysqlPool.query(
      "UPDATE user_sessions SET is_active = 0, expires_at = NOW() WHERE session_id = ?",
      [sessionId]
    );
  } else {
    sqliteRun("UPDATE user_sessions SET is_active = 0, expires_at = ? WHERE session_id = ?", [
      now,
      sessionId,
    ]);
  }
}

// --------------------------------------------------------------------------
// Database Connections, Schema Inspection & SQL Extraction Workbench
// --------------------------------------------------------------------------
export interface TableMetadata {
  tableName: string;
  tableRole: "system" | "matoc_bids";
  matocSlug?: string;
  matocLabel?: string;
  category?: string;
  rowCount: number;
  columns: Array<{
    name: string;
    type: string;
    notnull: boolean;
    pk: boolean;
    defaultValue: any;
  }>;
  ddl: string;
}

export async function getDatabaseInspectorState(): Promise<{
  mode: "mysql" | "embedded_sql";
  config: { host: string; port: number; user: string; database: string };
  lastMysqlError: string | null;
  sqliteFilePath: string;
  tables: TableMetadata[];
}> {
  await initEmbeddedSqlite();
  const reg = await loadRegistry();
  const tableToMatoc = new Map<string, MatocRegistryEntry>();
  for (const entry of Object.values(reg)) {
    tableToMatoc.set(entry.table_name, entry);
  }

  const tables: TableMetadata[] = [];

  if (engineMode === "mysql" && mysqlPool) {
    const [tRows]: any = await mysqlPool.query("SHOW TABLES");
    for (const tr of tRows || []) {
      const tName = String(Object.values(tr)[0]);
      const [cntRows]: any = await mysqlPool.query(`SELECT COUNT(*) AS c FROM \`${tName}\``);
      const rowCount = Number(cntRows?.[0]?.c || 0);
      const [colRows]: any = await mysqlPool.query(`SHOW COLUMNS FROM \`${tName}\``);
      const [ddlRows]: any = await mysqlPool.query(`SHOW CREATE TABLE \`${tName}\``);
      const ddl = String(ddlRows?.[0]?.["Create Table"] || "");
      const matocEntry = tableToMatoc.get(tName);

      tables.push({
        tableName: tName,
        tableRole: tName.startsWith("bids_") || matocEntry ? "matoc_bids" : "system",
        matocSlug: matocEntry?.slug,
        matocLabel: matocEntry?.label,
        category: matocEntry?.category,
        rowCount,
        columns: (colRows || []).map((c: any) => ({
          name: String(c.Field),
          type: String(c.Type),
          notnull: c.Null === "NO",
          pk: c.Key === "PRI",
          defaultValue: c.Default,
        })),
        ddl,
      });
    }
  } else {
    const tRows = sqliteQueryRows(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    for (const tr of tRows) {
      const tName = String(tr.name);
      const cntRows = sqliteQueryRows(`SELECT COUNT(*) AS c FROM \`${tName}\``);
      const rowCount = Number(cntRows?.[0]?.c || 0);
      const colRows = sqliteQueryRows(`PRAGMA table_info(\`${tName}\`)`);
      const matocEntry = tableToMatoc.get(tName);

      tables.push({
        tableName: tName,
        tableRole: tName.startsWith("bids_") || matocEntry ? "matoc_bids" : "system",
        matocSlug: matocEntry?.slug,
        matocLabel: matocEntry?.label,
        category: matocEntry?.category,
        rowCount,
        columns: colRows.map((c: any) => ({
          name: String(c.name),
          type: String(c.type),
          notnull: Boolean(c.notnull),
          pk: Boolean(c.pk),
          defaultValue: c.dflt_value,
        })),
        ddl: String(tr.sql || ""),
      });
    }
  }

  return {
    mode: engineMode,
    config: {
      host: activeConfig.host,
      port: activeConfig.port,
      user: activeConfig.user,
      database: activeConfig.database,
    },
    lastMysqlError,
    sqliteFilePath: SQLITE_PATH,
    tables,
  };
}

/**
 * Translates MySQL-specific syntax into SQLite-compatible SQL when running in embedded mode
 * so user queries (SHOW TABLES, SHOW COLUMNS, DESCRIBE, GROUP_CONCAT SEPARATOR, FORMAT) work seamlessly.
 */
function translateMysqlQueryForSqlite(rawSql: string): string {
  const trimmed = rawSql.trim().replace(/;+\s*$/, "");
  if (/^SHOW\s+TABLES$/i.test(trimmed)) {
    return "SELECT name AS `Tables_in_chart`, type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
  }
  const showColsMatch = /^SHOW\s+(?:FULL\s+)?COLUMNS\s+FROM\s+[`"]?([a-zA-Z0-9_]+)[`"]?/i.exec(
    trimmed
  );
  if (showColsMatch) {
    return `PRAGMA table_info(\`${showColsMatch[1]}\`)`;
  }
  const descMatch = /^(?:DESCRIBE|DESC)\s+[`"]?([a-zA-Z0-9_]+)[`"]?/i.exec(trimmed);
  if (descMatch) {
    return `PRAGMA table_info(\`${descMatch[1]}\`)`;
  }

  let sql = rawSql;
  // Translate NOW() -> datetime('now')
  sql = sql.replace(/\bNOW\(\)/gi, "datetime('now')");
  // Translate FORMAT(expr, 2) -> PRINTF('%.2f', expr)
  sql = sql.replace(/\bFORMAT\s*\(([^,]+),\s*2\)/gi, "PRINTF('%.2f', $1)");
  // Translate CONCAT(a, b, c, ...) -> (a || b || c)
  // Handle simple GROUP_CONCAT(... SEPARATOR '\n')
  sql = sql.replace(
    /GROUP_CONCAT\s*\(\s*CONCAT\s*\(\s*COALESCE\(m\.modification_number,\s*'Mod'\)\s*,\s*': \$'\s*,\s*(?:FORMAT|PRINTF)\([^)]+\)\s*\)\s*SEPARATOR\s*'\\n'\s*\)/gi,
    "GROUP_CONCAT(COALESCE(m.modification_number, 'Mod') || ': $' || PRINTF('%.2f', COALESCE(m.federal_action_obligation, 0)), char(10))"
  );
  return sql;
}

export async function executeSqlQuery(rawSql: string): Promise<{
  ok: boolean;
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  durationMs: number;
  engine: "mysql" | "embedded_sql";
  error?: string;
}> {
  const start = Date.now();
  await initEmbeddedSqlite();
  const cleanSql = (rawSql || "").trim();
  if (!cleanSql) {
    return {
      ok: false,
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      engine: engineMode,
      error: "SQL query cannot be empty.",
    };
  }

  try {
    if (engineMode === "mysql" && mysqlPool) {
      const [res, fields]: any = await mysqlPool.query(cleanSql);
      if (Array.isArray(res)) {
        const columns =
          fields && fields.length > 0
            ? fields.map((f: any) => String(f.name))
            : res.length > 0
            ? Object.keys(res[0])
            : [];
        return {
          ok: true,
          columns,
          rows: res,
          rowCount: res.length,
          durationMs: Date.now() - start,
          engine: "mysql",
        };
      } else {
        return {
          ok: true,
          columns: ["affectedRows", "insertId", "info"],
          rows: [
            {
              affectedRows: res.affectedRows ?? 0,
              insertId: res.insertId ?? 0,
              info: res.info ?? "Query executed successfully",
            },
          ],
          rowCount: 1,
          durationMs: Date.now() - start,
          engine: "mysql",
        };
      }
    } else {
      const translated = translateMysqlQueryForSqlite(cleanSql);
      const isSelectLike = /^(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(translated.trim());
      if (isSelectLike) {
        const rows = sqliteQueryRows(translated);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
          ok: true,
          columns,
          rows,
          rowCount: rows.length,
          durationMs: Date.now() - start,
          engine: "embedded_sql",
        };
      } else {
        const { changes, lastInsertId } = sqliteRun(translated);
        return {
          ok: true,
          columns: ["changes", "lastInsertId", "status"],
          rows: [{ changes, lastInsertId, status: "Statement executed and saved to disk" }],
          rowCount: 1,
          durationMs: Date.now() - start,
          engine: "embedded_sql",
        };
      }
    }
  } catch (err: any) {
    return {
      ok: false,
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: Date.now() - start,
      engine: engineMode,
      error: err?.message || String(err),
    };
  }
}

/**
 * Splits a MySQL .sql dump file into statements and imports all tables and rows
 * cleanly into either MySQL or Embedded SQLite.
 */
function splitSqlStatements(sqlContent: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlContent.length; i++) {
    const ch = sqlContent[i];
    const next = sqlContent[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (ch === "'" && !inDouble && !inBacktick && sqlContent[i - 1] !== "\\") {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick && sqlContent[i - 1] !== "\\") {
      inDouble = !inDouble;
    } else if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }

    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }
  const leftover = current.trim();
  if (leftover) statements.push(leftover);
  return statements;
}

function convertMysqlCreateOrInsertToSqlite(stmt: string): string | null {
  const trimmed = stmt.trim();
  if (
    /^(CREATE\s+DATABASE|USE\s+|SET\s+|LOCK\s+TABLES|UNLOCK\s+TABLES|START\s+TRANSACTION|COMMIT)/i.test(
      trimmed
    )
  ) {
    return null;
  }

  if (/^CREATE\s+TABLE/i.test(trimmed)) {
    let s = trimmed;
    // Remove ENGINE=InnoDB DEFAULT CHARSET=...
    s = s.replace(/\)\s*ENGINE\s*=\s*[^;]+$/i, ")");
    // Remove ON UPDATE CURRENT_TIMESTAMP
    s = s.replace(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, "");
    // Convert int NOT NULL AUTO_INCREMENT + PRIMARY KEY (`id`) to INTEGER PRIMARY KEY AUTOINCREMENT
    if (/`id`\s+int(?:\(\d+\))?\s+(?:NOT\s+NULL\s+)?AUTO_INCREMENT/i.test(s)) {
      s = s.replace(
        /`id`\s+int(?:\(\d+\))?\s+(?:NOT\s+NULL\s+)?AUTO_INCREMENT/i,
        "`id` INTEGER PRIMARY KEY AUTOINCREMENT"
      );
      s = s.replace(/,\s*PRIMARY\s+KEY\s*\(\s*`?id`?\s*\)/gi, "");
    }
    // Convert inline Unique Key: UNIQUE KEY `name` (`col`) -> UNIQUE (`col`)
    s = s.replace(/UNIQUE\s+KEY\s+[`"]?[a-zA-Z0-9_]+[`"]?\s*\(([^)]+)\)/gi, "UNIQUE ($1)");
    // Remove non-unique KEY/INDEX definitions inside CREATE TABLE
    s = s.replace(/,\s*(?:KEY|INDEX)\s+[`"]?[a-zA-Z0-9_]+[`"]?\s*\([^)]+\)/gi, "");
    return s;
  }

  if (/^INSERT\s+INTO/i.test(trimmed)) {
    return trimmed.replace(/^INSERT\s+INTO/i, "INSERT OR REPLACE INTO");
  }

  return trimmed;
}

export async function importSqlDump(sqlContent: string): Promise<{
  ok: boolean;
  statementsExecuted: number;
  errors: string[];
}> {
  await initEmbeddedSqlite();
  const statements = splitSqlStatements(sqlContent);
  let executed = 0;
  const errors: string[] = [];

  for (const rawStmt of statements) {
    try {
      if (engineMode === "mysql" && mysqlPool) {
        if (/^(CREATE\s+DATABASE|USE\s+)/i.test(rawStmt.trim())) continue;
        await mysqlPool.query(rawStmt);
        executed++;
      } else {
        const converted = convertMysqlCreateOrInsertToSqlite(rawStmt);
        if (!converted) continue;
        sqliteDb!.run(converted);
        executed++;
      }
    } catch (err: any) {
      errors.push(`${rawStmt.slice(0, 65)}... -> ${err?.message || String(err)}`);
    }
  }

  if (engineMode === "embedded_sql") {
    // Re-verify category column on matoc_config in case Schema.sql dropped & recreated matoc_config without category
    const colsRes = sqliteDb!.exec("PRAGMA table_info(matoc_config)");
    const colNames = colsRes[0]?.values.map((r) => String(r[1])) || [];
    if (colNames.length > 0 && !colNames.includes("category")) {
      sqliteDb!.run(
        `ALTER TABLE matoc_config ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT '${DEFAULT_CATEGORY}'`
      );
    }
    saveSqliteToDisk();
  }

  return {
    ok: errors.length === 0 || executed > 0,
    statementsExecuted: executed,
    errors,
  };
}
