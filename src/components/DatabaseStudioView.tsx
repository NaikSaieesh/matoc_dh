import React, { useState, useEffect } from "react";
import {
  Database,
  Server,
  Play,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon,
  Code2,
  RefreshCw,
  HardDrive,
  Search,
  ArrowUpDown,
  FileSpreadsheet,
  Terminal,
  Layers,
} from "lucide-react";

interface ColumnMeta {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  defaultValue: any;
}

interface TableMeta {
  tableName: string;
  tableRole: "system" | "matoc_bids";
  matocSlug?: string;
  matocLabel?: string;
  category?: string;
  rowCount: number;
  columns: ColumnMeta[];
  ddl: string;
}

interface DbInspectorState {
  mode: "mysql" | "embedded_sql";
  config: {
    host: string;
    port: number;
    user: string;
    database: string;
  };
  lastMysqlError: string | null;
  sqliteFilePath: string;
  tables: TableMeta[];
}

interface DatabaseStudioViewProps {
  onOpenMatocDashboard: (slug: string) => void;
  onOpenMatocRawData: (slug: string) => void;
  onRefreshRegistry: () => void;
}

const SCHEMA_SQL_REFERENCE = `-- Database: chart (Exact Schema from Schema.sql & db.py)
CREATE TABLE IF NOT EXISTS award_master (
  id int NOT NULL AUTO_INCREMENT,
  piid varchar(150) NOT NULL,
  generated_internal_id varchar(150) DEFAULT NULL,
  description text,
  recipient_name varchar(255) DEFAULT NULL,
  total_obligation decimal(18,2) DEFAULT NULL,
  base_exercised_options decimal(18,2) DEFAULT NULL,
  base_and_all_options decimal(18,2) DEFAULT NULL,
  status varchar(30) DEFAULT 'pending',
  fetched_at datetime DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_piid (piid)
);

CREATE TABLE IF NOT EXISTS award_modifications (
  id int NOT NULL AUTO_INCREMENT,
  award_master_id int NOT NULL,
  modification_number varchar(50) DEFAULT NULL,
  action_date date DEFAULT NULL,
  description text,
  federal_action_obligation decimal(18,2) DEFAULT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS matoc_config (
  slug varchar(64) NOT NULL,
  label varchar(150) NOT NULL,
  table_name varchar(64) NOT NULL,
  category varchar(40) NOT NULL DEFAULT 'construction',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  UNIQUE KEY table_name (table_name)
);

CREATE TABLE IF NOT EXISTS matoc_contracts (
  id int NOT NULL AUTO_INCREMENT,
  matoc_number varchar(100) DEFAULT NULL,
  matoc_name varchar(255) DEFAULT NULL,
  contract_number varchar(100) DEFAULT NULL,
  business_name varchar(255) DEFAULT NULL,
  PRIMARY KEY (id)
);`;

export const DatabaseStudioView: React.FC<DatabaseStudioViewProps> = ({
  onOpenMatocDashboard,
  onOpenMatocRawData,
  onRefreshRegistry,
}) => {
  const [dbState, setDbState] = useState<DbInspectorState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"workbench" | "schema" | "connection">(
    "workbench"
  );

  // Connection form state
  const [connHost, setConnHost] = useState("localhost");
  const [connPort, setConnPort] = useState("3306");
  const [connUser, setConnUser] = useState("root");
  const [connPassword, setConnPassword] = useState("");
  const [connDatabase, setConnDatabase] = useState("chart");
  const [connTesting, setConnTesting] = useState(false);
  const [connBanner, setConnBanner] = useState<{
    ok: boolean;
    text: string;
    latencyMs?: number;
  } | null>(null);

  // SQL Dump Import state
  const [sqlDumpInput, setSqlDumpInput] = useState("");
  const [importingSql, setImportingSql] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{
    ok: boolean;
    message: string;
    errors?: string[];
  } | null>(null);

  // Schema inspector selected table
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);

  // SQL Query Workbench state
  const [sqlQuery, setSqlQuery] = useState<string>(
    "SELECT slug, label, table_name, category, created_at FROM matoc_config ORDER BY label;"
  );
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<{
    ok: boolean;
    columns: string[];
    rows: Record<string, any>[];
    rowCount: number;
    durationMs: number;
    engine: string;
    error?: string;
  } | null>(null);

  // Result table client-side filter, sort & pagination
  const [resultFilter, setResultFilter] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const fetchDbState = async () => {
    setLoadingState(true);
    try {
      const res = await fetch("/api/db/status");
      const data = await res.json();
      if (data.ok) {
        setDbState(data);
        setConnHost(data.config.host || "localhost");
        setConnPort(String(data.config.port || 3306));
        setConnUser(data.config.user || "root");
        setConnDatabase(data.config.database || "chart");
        if (!selectedTableName && data.tables?.length > 0) {
          setSelectedTableName(data.tables[0].tableName);
        }
      }
    } catch (err) {
      console.error("Failed to fetch DB status:", err);
    } finally {
      setLoadingState(false);
    }
  };

  const runSql = async (customSql?: string) => {
    const targetSql = customSql ?? sqlQuery;
    if (!targetSql.trim()) return;
    setQueryRunning(true);
    setCurrentPage(1);
    try {
      const res = await fetch("/api/db/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: targetSql }),
      });
      const data = await res.json();
      setQueryResult(data);
      if (
        /^\s*(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)/i.test(targetSql)
      ) {
        await fetchDbState();
        onRefreshRegistry();
      }
    } catch (err: any) {
      setQueryResult({
        ok: false,
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: 0,
        engine: dbState?.mode || "embedded_sql",
        error: err?.message || "Network error executing query",
      });
    } finally {
      setQueryRunning(false);
    }
  };

  useEffect(() => {
    fetchDbState();
    runSql("SELECT slug, label, table_name, category, created_at FROM matoc_config ORDER BY label;");
  }, []);

  const handleTestMysqlConnection = async (preferMode?: "mysql" | "embedded_sql") => {
    setConnTesting(true);
    setConnBanner(null);
    try {
      const res = await fetch("/api/db/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: connHost,
          port: Number(connPort),
          user: connUser,
          password: connPassword,
          database: connDatabase,
          preferMode,
        }),
      });
      const data = await res.json();
      setConnBanner({
        ok: Boolean(data.ok),
        text: data.message || (data.ok ? "Connected" : "Connection failed"),
        latencyMs: data.latencyMs,
      });
      if (data.state) {
        setDbState(data.state);
      }
      onRefreshRegistry();
    } catch (err: any) {
      setConnBanner({
        ok: false,
        text: err?.message || "Failed to test connection",
      });
    } finally {
      setConnTesting(false);
    }
  };

  const handleSqlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || "");
      setSqlDumpInput(content);
    };
    reader.readAsText(file);
  };

  const handleExecuteSqlDump = async () => {
    if (!sqlDumpInput.trim()) return;
    setImportingSql(true);
    setImportFeedback(null);
    try {
      const res = await fetch("/api/db/import-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sqlContent: sqlDumpInput }),
      });
      const data = await res.json();
      setImportFeedback({
        ok: Boolean(data.ok),
        message: `Executed ${data.statementsExecuted || 0} SQL statement(s) into the active database.`,
        errors: data.errors,
      });
      if (data.state) {
        setDbState(data.state);
      }
      onRefreshRegistry();
    } catch (err: any) {
      setImportFeedback({
        ok: false,
        message: err?.message || "Failed to import SQL dump",
      });
    } finally {
      setImportingSql(false);
    }
  };

  // Build preset extraction queries dynamically based on existing MATOC tables
  const firstBidTable =
    dbState?.tables.find((t) => t.tableRole === "matoc_bids")?.tableName || "bids_frr";

  const extractionPresets = [
    {
      name: "1. MATOC Registry (matoc_config)",
      desc: "All registered MATOC vehicles, physical table mappings, and categories",
      sql: "SELECT slug, label, table_name, category, created_at FROM matoc_config ORDER BY label;",
    },
    {
      name: `2. Full Bid + USAspending Join (${firstBidTable})`,
      desc: "Exact load_raw_dataframe_with_awards() join across bids, award_master, and award_modifications",
      sql: `SELECT
  b.id,
  b.folder_number AS \`Folder Number\`,
  b.year AS \`Year\`,
  b.rfp_number AS \`RFP Number\`,
  b.award_id AS \`Task Order ID\`,
  b.title AS \`Title\`,
  b.project_type AS \`Project Type\`,
  b.awardee AS \`Awardee\`,
  b.contract_value AS \`Contract Value\`,
  b.addon_bid AS \`Addon Bid\`,
  b.winner_price_diff_usd AS \`Winner Price Difference $\`,
  b.winner_price_diff_pct AS \`Winner Price Difference %\`,
  b.number_of_offers_received AS \`Number of Offers Received\`,
  b.result AS \`Result\`,
  b.mods AS \`Mods\`,
  b.total AS \`Total\`,
  am.piid AS \`Task Order/PIID\`,
  am.recipient_name AS \`Recipient\`,
  am.total_obligation AS \`Obligation\`,
  am.status AS \`Status\`,
  COALESCE(SUM(CASE WHEN m.modification_number <> '0' THEN m.federal_action_obligation ELSE 0 END), 0) AS \`Linked Mods Total\`
FROM \`${firstBidTable}\` b
LEFT JOIN award_master am ON TRIM(b.award_id) = TRIM(am.piid)
LEFT JOIN award_modifications m ON am.id = m.award_master_id
GROUP BY b.id, am.id
ORDER BY b.id;`,
    },
    {
      name: `3. Dashboard Analytical Extraction (${firstBidTable})`,
      desc: "Exact load_matoc_dataframe() query with Linked Mods Total subquery",
      sql: `SELECT
  b.year AS \`Year\`,
  b.project_type AS \`Project Type\`,
  b.awardee AS \`Awardee\`,
  b.contract_value AS \`Contract Value\`,
  b.addon_bid AS \`Addon Bid\`,
  b.asterisk_bid AS \`Asterisk Bid\`,
  b.winner_price_diff_usd AS \`Winner Price Difference $\`,
  b.winner_price_diff_pct AS \`Winner Price Difference %\`,
  b.number_of_offers_received AS \`Number of Offers Received\`,
  b.result AS \`Result\`,
  b.mods AS \`Mods\`,
  b.total AS \`Total\`,
  COALESCE(mods_agg.linked_mods_total, 0) AS \`Linked Mods Total\`
FROM \`${firstBidTable}\` b
LEFT JOIN (
  SELECT
    am.piid AS piid,
    SUM(CASE WHEN m.modification_number <> '0' THEN m.federal_action_obligation ELSE 0 END) AS linked_mods_total
  FROM award_master am
  JOIN award_modifications m ON am.id = m.award_master_id
  GROUP BY am.piid
) mods_agg ON TRIM(b.award_id) = TRIM(mods_agg.piid);`,
    },
    {
      name: `4. Post-Award Modifications Join (${firstBidTable})`,
      desc: "Exact get_modification_dataframe() INNER JOIN for modification intelligence",
      sql: `SELECT
  b.folder_number AS \`Folder Number\`,
  b.award_id AS \`Award/PIID\`,
  b.awardee AS \`Awardee\`,
  b.project_type AS \`Project Type\`,
  b.year AS \`Year\`,
  am.total_obligation AS \`Total Obligation\`,
  am.status AS \`Award Status\`,
  m.modification_number AS \`Modification #\`,
  m.action_date AS \`Action Date\`,
  m.description AS \`Description\`,
  m.federal_action_obligation AS \`Mod Value\`
FROM \`${firstBidTable}\` b
INNER JOIN award_master am ON TRIM(b.award_id) = TRIM(am.piid)
INNER JOIN award_modifications m ON am.id = m.award_master_id
ORDER BY m.action_date DESC;`,
    },
    {
      name: "5. USAspending Master & Modifications Audit",
      desc: "Inspect award_master records and aggregated modification counts",
      sql: `SELECT
  am.id,
  am.piid,
  am.recipient_name,
  am.total_obligation,
  am.base_exercised_options,
  am.base_and_all_options,
  am.status,
  am.fetched_at,
  COUNT(m.id) AS modification_rows,
  COALESCE(SUM(CASE WHEN m.modification_number <> '0' THEN m.federal_action_obligation ELSE 0 END), 0) AS post_award_mods_sum
FROM award_master am
LEFT JOIN award_modifications m ON am.id = m.award_master_id
GROUP BY am.id
ORDER BY am.id DESC;`,
    },
    {
      name: "6. Registered Users & Permissions (users)",
      desc: "Inspect users table and admin / super_admin flags",
      sql: "SELECT id, username, email, created_at, is_admin, is_super_admin FROM users ORDER BY id ASC;",
    },
  ];

  // Filter and sort query results
  const processedRows = React.useMemo(() => {
    if (!queryResult?.rows) return [];
    let list = [...queryResult.rows];
    if (resultFilter.trim()) {
      const q = resultFilter.toLowerCase().trim();
      list = list.filter((row) =>
        Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    if (sortCol) {
      list.sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = Number(String(av).replace(/[$,]/g, ""));
        const bn = Number(String(bv).replace(/[$,]/g, ""));
        if (!isNaN(an) && !isNaN(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
          return sortAsc ? an - bn : bn - an;
        }
        return sortAsc
          ? String(av).localeCompare(String(bv), undefined, { numeric: true })
          : String(bv).localeCompare(String(av), undefined, { numeric: true });
      });
    }
    return list;
  }, [queryResult, resultFilter, sortCol, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize));
  const pagedRows = processedRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const exportQueryResultsCsv = () => {
    if (!queryResult || queryResult.columns.length === 0) return;
    const cols = queryResult.columns;
    const escapeCsv = (val: any) => {
      const s = String(val ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const csvContent = [
      cols.map(escapeCsv).join(","),
      ...processedRows.map((r) => cols.map((c) => escapeCsv(r[c])).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query_extraction_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedTable =
    dbState?.tables.find((t) => t.tableName === selectedTableName) ||
    dbState?.tables[0] ||
    null;

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
      {/* Header & Active Connection Status Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Database Connections, Data Extraction &amp; SQL Query Studio
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Direct relational table inspection, live SQL data extraction pipelines, and WAMP MySQL / SQL dump synchronization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                dbState?.mode === "mysql" ? "bg-emerald-600" : "bg-indigo-600"
              }`}
            />
            <span className="font-semibold text-slate-900">
              {dbState?.mode === "mysql"
                ? `MySQL Live (${dbState.config.host}:${dbState.config.port}/${dbState.config.database})`
                : `Persistent SQL Engine (Database: ${dbState?.config.database || "chart"})`}
            </span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-600 tabular-nums">
              {dbState?.tables.length || 0} tables
            </span>
          </div>

          <button
            onClick={fetchDbState}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingState ? "animate-spin" : ""}`} />
            Refresh Schema
          </button>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        <button
          onClick={() => setActiveSubTab("workbench")}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            activeSubTab === "workbench"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          Data Extraction &amp; SQL Query Results
        </button>
        <button
          onClick={() => setActiveSubTab("schema")}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            activeSubTab === "schema"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Physical Tables &amp; Schema Inspector ({dbState?.tables.length || 0})
        </button>
        <button
          onClick={() => setActiveSubTab("connection")}
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            activeSubTab === "connection"
              ? "bg-white text-slate-900 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          MySQL Connection &amp; .SQL Dump Import
        </button>
      </div>

      {/* TAB 1: DATA EXTRACTION & SQL QUERY WORKBENCH */}
      {activeSubTab === "workbench" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Physical Tables Quick Extract + Preset Pipelines */}
          <div className="lg:col-span-4 space-y-5">
            {/* Physical Tables Quick-Extract */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-900">
                  Physical Database Tables
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {dbState?.tables.reduce((acc, t) => acc + t.rowCount, 0) || 0} total rows
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Click any table below to extract its live rows immediately.
              </p>
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {dbState?.tables.map((t) => (
                  <div
                    key={t.tableName}
                    className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 px-2 rounded-md transition-colors"
                  >
                    <button
                      onClick={() => {
                        const q = `SELECT * FROM \`${t.tableName}\` LIMIT 500;`;
                        setSqlQuery(q);
                        runSql(q);
                      }}
                      className="flex items-center gap-2 text-left group cursor-pointer min-w-0 flex-1"
                    >
                      <TableIcon className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <div className="truncate">
                        <div className="text-xs font-mono font-semibold text-slate-900 group-hover:text-indigo-600 truncate">
                          {t.tableName}
                        </div>
                        {t.matocLabel && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {t.matocLabel} · {t.category}
                          </div>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-slate-600 tabular-nums">
                        {t.rowCount.toLocaleString()} rows
                      </span>
                      {t.matocSlug && (
                        <button
                          onClick={() => onOpenMatocRawData(t.matocSlug!)}
                          className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                          title="Open Excel Editor"
                        >
                          Grid &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Extraction Pipeline Presets (from db.py) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-1">
                db.py Extraction Pipelines
              </h2>
              <p className="text-xs text-slate-500 mb-3">
                Exact SQL joins used for MATOC dashboards, USAspending award links, and modifications.
              </p>
              <div className="space-y-2">
                {extractionPresets.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setSqlQuery(p.sql);
                      runSql(p.sql);
                    }}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900">{p.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                      {p.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: SQL Editor & High-Density Results Display */}
          <div className="lg:col-span-8 space-y-5">
            {/* SQL Query Editor Box */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">
                    SQL Extraction Query Editor
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    Supports SELECT, JOIN, GROUP_CONCAT, SHOW TABLES, DESCRIBE
                  </span>
                  <button
                    onClick={() => runSql()}
                    disabled={queryRunning}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {queryRunning ? "Running..." : "Execute Query"}
                  </button>
                </div>
              </div>

              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    runSql();
                  }
                }}
                rows={7}
                className="w-full font-mono text-xs bg-slate-900 text-slate-100 p-4 rounded-lg border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed"
                placeholder="Write any SQL query (e.g. SELECT * FROM matoc_config;)"
              />
            </div>

            {/* Query Results Panel */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-slate-900">Query Results</span>
                  {queryResult && queryResult.ok && (
                    <>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-emerald-700 font-semibold tabular-nums">
                        {processedRows.length.toLocaleString()} row
                        {processedRows.length === 1 ? "" : "s"}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {queryResult.columns.length} cols
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {queryResult.durationMs} ms
                      </span>
                    </>
                  )}
                </div>

                {queryResult && queryResult.ok && queryResult.columns.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={resultFilter}
                        onChange={(e) => {
                          setResultFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        placeholder="Filter extracted rows..."
                        className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-indigo-500 w-48"
                      />
                    </div>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700"
                    >
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                      <option value={250}>250 / page</option>
                      <option value={5000}>All rows</option>
                    </select>
                    <button
                      onClick={exportQueryResultsCsv}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>
                )}
              </div>

              {queryResult?.error && (
                <div className="p-5 bg-rose-50/80 border-b border-rose-200 flex items-start gap-3 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">SQL Execution Error</div>
                    <div className="font-mono mt-1">{queryResult.error}</div>
                  </div>
                </div>
              )}

              {queryResult && queryResult.ok && queryResult.columns.length === 0 && (
                <div className="p-10 text-center text-sm text-slate-500">
                  Query executed successfully (0 rows returned).
                </div>
              )}

              {queryResult && queryResult.ok && queryResult.columns.length > 0 && (
                <>
                  <div className="overflow-x-auto max-h-[540px]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 z-10">
                        <tr>
                          <th className="py-2.5 px-3 font-mono text-[11px] text-slate-500 border-r border-slate-200 w-12 text-right">
                            #
                          </th>
                          {queryResult.columns.map((col) => (
                            <th
                              key={col}
                              onClick={() => {
                                if (sortCol === col) {
                                  setSortAsc(!sortAsc);
                                } else {
                                  setSortCol(col);
                                  setSortAsc(true);
                                }
                              }}
                              className="py-2.5 px-3 font-semibold text-slate-700 border-r border-slate-200 whitespace-nowrap cursor-pointer hover:bg-slate-200/70 select-none"
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span>{col}</span>
                                <ArrowUpDown className="w-3 h-3 text-slate-400" />
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono">
                        {pagedRows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50">
                            <td className="py-2 px-3 text-right text-slate-400 border-r border-slate-100 tabular-nums">
                              {(currentPage - 1) * pageSize + rIdx + 1}
                            </td>
                            {queryResult.columns.map((col) => {
                              const val = row[col];
                              const isNum =
                                typeof val === "number" ||
                                (typeof val === "string" &&
                                  val.trim() !== "" &&
                                  !isNaN(Number(val)));
                              return (
                                <td
                                  key={col}
                                  className={`py-2 px-3 border-r border-slate-100 max-w-xs truncate ${
                                    isNum
                                      ? "text-right tabular-nums text-slate-900"
                                      : "text-slate-700"
                                  }`}
                                  title={String(val ?? "")}
                                >
                                  {val === null || val === undefined ? (
                                    <span className="text-slate-400 italic">NULL</span>
                                  ) : (
                                    String(val)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 bg-slate-50">
                      <span>
                        Showing {(currentPage - 1) * pageSize + 1}–
                        {Math.min(currentPage * pageSize, processedRows.length)} of{" "}
                        {processedRows.length.toLocaleString()} rows
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          className="px-2.5 py-1 border border-slate-200 bg-white rounded disabled:opacity-40 cursor-pointer"
                        >
                          Previous
                        </button>
                        <span className="font-mono tabular-nums">
                          Page {currentPage} / {totalPages}
                        </span>
                        <button
                          disabled={currentPage >= totalPages}
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                          className="px-2.5 py-1 border border-slate-200 bg-white rounded disabled:opacity-40 cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PHYSICAL TABLES & SCHEMA INSPECTOR */}
      {activeSubTab === "schema" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-1">
              Database Tables ({dbState?.tables.length || 0})
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Every MATOC vehicle has its own physical table (<code>bids_&lt;slug&gt;</code>) with a <code>UNIQUE KEY</code> on <code>folder_number</code>.
            </p>
            <div className="space-y-1.5">
              {dbState?.tables.map((t) => {
                const isSelected = selectedTable?.tableName === t.tableName;
                return (
                  <button
                    key={t.tableName}
                    onClick={() => setSelectedTableName(t.tableName)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-indigo-50/70 border-indigo-500 text-indigo-950"
                        : "bg-white border-slate-200 hover:bg-slate-50 text-slate-800"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-mono text-xs font-bold truncate">
                        {t.tableName}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {t.tableRole === "matoc_bids"
                          ? `MATOC Table · ${t.matocLabel || t.tableName}`
                          : "Core Schema.sql Table"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-xs font-semibold tabular-nums">
                        {t.rowCount.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-400">rows</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-8 space-y-5">
            {selectedTable ? (
              <>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold font-mono text-slate-900">
                          {selectedTable.tableName}
                        </h2>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-600 font-mono tabular-nums">
                          {selectedTable.rowCount.toLocaleString()} rows
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-600 font-mono tabular-nums">
                          {selectedTable.columns.length} columns
                        </span>
                      </div>
                      {selectedTable.matocLabel && (
                        <p className="text-xs text-slate-500 mt-1">
                          Linked MATOC Vehicle: <strong>{selectedTable.matocLabel}</strong> (Slug:{" "}
                          <code>{selectedTable.matocSlug}</code>, Category:{" "}
                          <code>{selectedTable.category}</code>)
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const q = `SELECT * FROM \`${selectedTable.tableName}\` LIMIT 500;`;
                          setSqlQuery(q);
                          setActiveSubTab("workbench");
                          runSql(q);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Query Table Rows
                      </button>
                      {selectedTable.matocSlug && (
                        <>
                          <button
                            onClick={() => onOpenMatocRawData(selectedTable.matocSlug!)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            Open Excel Grid
                          </button>
                          <button
                            onClick={() => onOpenMatocDashboard(selectedTable.matocSlug!)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                          >
                            Dashboard &rarr;
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Column Structure Table */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-600">
                          <th className="py-2 px-3 font-semibold">Column Name</th>
                          <th className="py-2 px-3 font-semibold">Data Type</th>
                          <th className="py-2 px-3 font-semibold">Key</th>
                          <th className="py-2 px-3 font-semibold">Nullable</th>
                          <th className="py-2 px-3 font-semibold">Default</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono">
                        {selectedTable.columns.map((c) => (
                          <tr key={c.name} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              {c.name}
                            </td>
                            <td className="py-2 px-3 text-indigo-700">{c.type}</td>
                            <td className="py-2 px-3">
                              {c.pk ? (
                                <span className="text-amber-700 font-semibold">PRIMARY KEY</span>
                              ) : c.name === "folder_number" || c.name === "piid" || c.name === "table_name" ? (
                                <span className="text-emerald-700 font-semibold">UNIQUE</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {c.notnull ? "NOT NULL" : "NULL"}
                            </td>
                            <td className="py-2 px-3 text-slate-500">
                              {c.defaultValue != null ? String(c.defaultValue) : "NULL"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Table DDL Viewer */}
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Table Creation DDL ({selectedTable.tableName})
                  </h3>
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                    {selectedTable.ddl || "-- DDL not available"}
                  </pre>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* TAB 3: MYSQL CONNECTION & .SQL DUMP IMPORT */}
      {activeSubTab === "connection" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: MySQL Server Connection Configuration */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  MySQL Server Connection (db.py / .env)
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Connect directly to a MySQL instance (default database: <code>chart</code> on port <code>3306</code>) or use the persistent embedded SQL engine.
                </p>
              </div>
              <HardDrive className="w-5 h-5 text-indigo-600 shrink-0" />
            </div>

            {connBanner && (
              <div
                className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
                  connBanner.ok
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                }`}
              >
                {connBanner.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">{connBanner.text}</div>
                  {connBanner.latencyMs !== undefined && (
                    <div className="mt-0.5 text-[11px] opacity-80 font-mono">
                      Response time: {connBanner.latencyMs} ms
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DB_HOST
                </label>
                <input
                  type="text"
                  value={connHost}
                  onChange={(e) => setConnHost(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DB_PORT
                </label>
                <input
                  type="number"
                  value={connPort}
                  onChange={(e) => setConnPort(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  placeholder="3306"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DB_USER
                </label>
                <input
                  type="text"
                  value={connUser}
                  onChange={(e) => setConnUser(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  placeholder="root"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DB_PASSWORD
                </label>
                <input
                  type="password"
                  value={connPassword}
                  onChange={(e) => setConnPassword(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  placeholder="(empty for default WAMP)"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DB_NAME
                </label>
                <input
                  type="text"
                  value={connDatabase}
                  onChange={(e) => setConnDatabase(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  placeholder="chart"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => handleTestMysqlConnection("mysql")}
                disabled={connTesting}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                {connTesting ? "Connecting..." : "Test & Connect to MySQL"}
              </button>
              <button
                onClick={() => handleTestMysqlConnection("embedded_sql")}
                disabled={connTesting}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Use Persistent Embedded SQL Engine
              </button>
            </div>
          </div>

          {/* Right: Import .SQL Dump / Schema.sql */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Import MySQL Dump (.sql) / Schema.sql
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Upload a phpMyAdmin <code>.sql</code> export (e.g. <code>chart.sql</code> or <code>Schema.sql</code>) to create and populate tables directly.
                </p>
              </div>
              <button
                onClick={() => setSqlDumpInput(SCHEMA_SQL_REFERENCE)}
                className="text-xs font-semibold text-indigo-600 hover:underline shrink-0 cursor-pointer"
              >
                Load Schema.sql Template
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Choose .sql File
                <input
                  type="file"
                  accept=".sql,.txt"
                  onChange={handleSqlFileUpload}
                  className="hidden"
                />
              </label>
              <span className="text-xs text-slate-500">
                Or paste SQL statements below:
              </span>
            </div>

            <textarea
              value={sqlDumpInput}
              onChange={(e) => setSqlDumpInput(e.target.value)}
              rows={8}
              placeholder="Paste CREATE TABLE / INSERT INTO statements from your MySQL dump..."
              className="w-full font-mono text-xs bg-slate-900 text-slate-100 p-3.5 rounded-lg border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {importFeedback && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  importFeedback.ok
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-rose-50 border-rose-200 text-rose-900"
                }`}
              >
                <div className="font-semibold">{importFeedback.message}</div>
                {importFeedback.errors && importFeedback.errors.length > 0 && (
                  <ul className="mt-1.5 list-disc list-inside text-[11px] font-mono space-y-0.5 max-h-28 overflow-y-auto">
                    {importFeedback.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              onClick={handleExecuteSqlDump}
              disabled={importingSql || !sqlDumpInput.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {importingSql ? "Executing SQL Dump..." : "Execute SQL Dump in Database"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
