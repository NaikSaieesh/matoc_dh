import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Search,
  Sparkles,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  Plus,
  Filter,
  Users,
  GitCommit,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface RawDataViewProps {
  slug: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  onBackToDashboard: (slug: string) => void;
  onOpenContractorIntel: (slug: string) => void;
  onOpenModIntel: (slug: string) => void;
}

const CURRENCY_COLS = new Set([
  "contract value",
  "addon bid",
  "winner price difference $",
  "mods",
  "total",
  "obligation",
  "base & options",
  "base & exercised",
  "linked mods total",
]);

const INTEGER_COLS = new Set(["folder number", "year", "number of offers received"]);

const EDITABLE_DB_COLS = new Set([
  "Folder Number",
  "8(a) or R",
  "Year",
  "RFP Number",
  "Task Order ID",
  "Title",
  "Project Type",
  "Awardee",
  "Resume Names",
  "Contract Value",
  "Addon Bid",
  "Asterisk Bid",
  "Winner Price Difference $",
  "Winner Price Difference %",
  "Number of Offers Received",
  "Result",
  "Mods",
  "Total",
]);

function formatUsdCell(val: any, colName: string): string {
  if (val === null || val === undefined || val === "") return "";
  const colLower = colName.toLowerCase();
  if (INTEGER_COLS.has(colLower)) {
    const cleaned = String(val).replace(/[^0-9.-]/g, "");
    if (cleaned !== "" && !isNaN(Number(cleaned))) {
      return String(Math.trunc(Number(cleaned)));
    }
    return String(val);
  }
  if (CURRENCY_COLS.has(colLower)) {
    const cleaned = String(val).replace(/[^0-9.-]/g, "");
    if (cleaned === "" || isNaN(Number(cleaned))) return String(val);
    return Number(cleaned).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (colLower === "winner price difference %") {
    const cleaned = String(val).replace(/[^0-9.-]/g, "");
    if (cleaned === "" || isNaN(Number(cleaned))) return String(val);
    return Number(cleaned).toFixed(2);
  }
  return String(val);
}

function sanitizeValueForColumn(colName: string, rawVal: string): string {
  const cleanVal = rawVal.trim();
  if (!cleanVal || cleanVal === "None" || cleanVal.toLowerCase() === "null") {
    return "";
  }
  const colLower = colName.toLowerCase();
  const numericOnly = cleanVal.replace(/[^0-9.-]/g, "");
  if (INTEGER_COLS.has(colLower)) {
    if (numericOnly !== "" && !isNaN(Number(numericOnly))) {
      return String(Math.floor( parseFloat(numericOnly)));
    }
  } else if (CURRENCY_COLS.has(colLower)) {
    if (numericOnly !== "" && !isNaN(Number(numericOnly))) {
      return parseFloat(numericOnly).toFixed(2);
    }
  }
  return cleanVal;
}

export const RawDataView: React.FC<RawDataViewProps> = ({
  slug,
  isAdmin,
  isSuperAdmin,
  onBackToDashboard,
  onOpenContractorIntel,
  onOpenModIntel,
}) => {
  const [matocLabel, setMatocLabel] = useState(slug);
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // Search & Per-Column Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ col: string; asc: boolean } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState("");

  // Selected Row & Cell for AI Classification / Editing
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [savedCells, setSavedCells] = useState<Set<string>>(new Set());
  const [classifying, setClassifying] = useState(false);

  // Excel Upload state
  const [sheetName, setSheetName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // USAspending Pull Pipeline status
  const [pullProgress, setPullProgress] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/${encodeURIComponent(slug)}/data`);
      const data = await res.json();
      if (data.ok) {
        setMatocLabel(data.matoc_label);
        setTableName(data.table_name);
        setColumns(data.columns || []);
        // Append 5 blank rows at bottom for quick spreadsheet entry
        const loadedRows = data.rows || [];
        const blanks = Array.from({ length: 5 }).map(() => {
          const obj: Record<string, any> = { id: null };
          (data.columns || []).forEach((c: string) => {
            obj[c] = "";
          });
          return obj;
        });
        setRows([...loadedRows, ...blanks]);
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Failed to load raw data" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Check USAspending pull status
    fetch(`/api/dashboard/${encodeURIComponent(slug)}/data/pull-status`)
      .then((r) => r.json())
      .then((p) => {
        if (p.running) setPullProgress(p);
      })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    if (!pullProgress?.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/dashboard/${encodeURIComponent(slug)}/data/pull-status`);
        const p = await res.json();
        setPullProgress(p);
        if (!p.running) {
          clearInterval(timer);
          loadData();
        }
      } catch {
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pullProgress?.running, slug]);

  const markCellSaved = (key: string) => {
    setSavedCells((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setTimeout(() => {
      setSavedCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 1300);
  };

  const handleCellBlur = async (
    rowIndex: number,
    colName: string,
    rawInput: string
  ) => {
    const targetRow = rows[rowIndex];
    if (!targetRow) return;

    const cleanVal = sanitizeValueForColumn(colName, rawInput);
    const oldVal = String(targetRow[colName] ?? "").trim();

    if (cleanVal === oldVal) return;

    // Optimistically update local state
    const updatedRows = [...rows];
    updatedRows[rowIndex] = { ...targetRow, [colName]: cleanVal };
    setRows(updatedRows);

    const rowId = targetRow.id;
    const targetUrl = rowId
      ? `/api/dashboard/${encodeURIComponent(slug)}/data/update`
      : `/api/dashboard/${encodeURIComponent(slug)}/data/create`;

    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rowId,
          column: colName,
          value: cleanVal,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Save failed");
      }

      setRows((prev) => {
        const copy = [...prev];
        const cur = { ...copy[rowIndex] };
        if (!rowId && data.new_id) {
          cur.id = data.new_id;
        }
        if (data.derived) {
          Object.entries(data.derived).forEach(([dCol, dVal]) => {
            cur[dCol] = dVal;
            markCellSaved(`${rowIndex}-${dCol}`);
          });
        }
        copy[rowIndex] = cur;
        return copy;
      });
      markCellSaved(`${rowIndex}-${colName}`);
    } catch (err: any) {
      setBanner({ ok: false, text: `Save failed: ${err?.message || "Error"}` });
    }
  };

  // Multi-cell Paste from Excel handler
  const handleTablePaste = async (
    e: React.ClipboardEvent,
    startRowIdx: number,
    startColIdx: number
  ) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) {
      return; // single cell paste handled normally
    }
    e.preventDefault();

    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const grid = lines.map((l) => l.split("\t"));

    // Ensure enough rows exist
    let currentRows = [...rows];
    const needed = startRowIdx + grid.length - currentRows.length;
    if (needed > 0) {
      for (let i = 0; i < needed + 2; i++) {
        const blank: Record<string, any> = { id: null };
        columns.forEach((c) => (blank[c] = ""));
        currentRows.push(blank);
      }
      setRows(currentRows);
    }

    for (let r = 0; r < grid.length; r++) {
      const rIdx = startRowIdx + r;
      for (let c = 0; c < grid[r].length; c++) {
        const cIdx = startColIdx + c;
        if (cIdx >= columns.length) continue;
        const colName = columns[cIdx];
        const canEdit =
          (isAdmin && EDITABLE_DB_COLS.has(colName)) || colName === "Project Type";
        if (!canEdit) continue;
        await handleCellBlur(rIdx, colName, grid[r][c]);
      }
    }
  };

  const handleDeleteRow = async (rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row) return;
    if (!row.id) {
      setRows((prev) => prev.filter((_, idx) => idx !== rowIndex));
      return;
    }
    try {
      const res = await fetch(
        `/api/dashboard/${encodeURIComponent(slug)}/data/${row.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== rowIndex));
        setBanner({ ok: true, text: "Row deleted from database." });
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Delete failed" });
    }
  };

  const handleClassifySelectedRow = async () => {
    if (selectedRowIdx === null || !rows[selectedRowIdx]) {
      setBanner({
        ok: false,
        text: "Click any cell in a row first to select which Title to classify.",
      });
      return;
    }
    const targetRow = rows[selectedRowIdx];
    const titleVal = String(targetRow["Title"] ?? "").trim();
    if (!titleVal) {
      setBanner({
        ok: false,
        text: "The Title cell in the selected row is empty.",
      });
      return;
    }

    setClassifying(true);
    try {
      const res = await fetch(
        `/api/dashboard/${encodeURIComponent(slug)}/data/classify-title`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: titleVal }),
        }
      );
      const data = await res.json();
      if (data.ok && data.project_type) {
        await handleCellBlur(selectedRowIdx, "Project Type", data.project_type);
        const conf = data.details?.confidence
          ? ` (Confidence: ${Math.round(data.details.confidence * 100)}%)`
          : "";
        setBanner({
          ok: true,
          text: `Classified "${titleVal.slice(0, 50)}..." → ${data.project_type}${conf}`,
        });
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Classification failed" });
    } finally {
      setClassifying(false);
    }
  };

  const handleBatchClassifyAll = async () => {
    setClassifying(true);
    try {
      const res = await fetch(
        `/api/dashboard/${encodeURIComponent(slug)}/data/classify-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overwriteAll: false }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        setBanner({ ok: true, text: data.message });
        await loadData();
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Batch classification failed" });
    } finally {
      setClassifying(false);
    }
  };

  const handleStartUsaSpendingPull = async () => {
    try {
      const res = await fetch(
        `/api/dashboard/${encodeURIComponent(slug)}/data/pull-latest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      const data = await res.json();
      if (data.ok) {
        setPullProgress({
          running: true,
          matoc_label: matocLabel,
          percentage: 0,
          last_message: "Initiating USAspending.gov data pull...",
        });
      } else {
        setBanner({ ok: false, text: data.message || "Pull could not start" });
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Failed to start pull" });
    }
  };

  const handleExcelUpload = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setBanner({ ok: false, text: "Please select an Excel (.xlsx/.xls) file." });
      return;
    }

    setUploading(true);
    setBanner(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const arrayBuffer = ev.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64File = btoa(binary);

        const res = await fetch(
          `/api/dashboard/${encodeURIComponent(slug)}/data/upload`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64File,
              sheetName: sheetName.trim() || undefined,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Import failed");
        }
        setBanner({ ok: true, text: data.message });
        if (fileInputRef.current) fileInputRef.current.value = "";
        await loadData();
      } catch (err: any) {
        setBanner({ ok: false, text: err?.message || "Import failed" });
      } finally {
        setUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Filtered and sorted rows
  const visibleRowIndices = React.useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const indices: number[] = [];

    rows.forEach((r, idx) => {
      // Always keep trailing blank rows visible if no search/filter is active
      const isBlankRow = !r.id;
      if (isBlankRow && (q || Object.keys(columnFilters).length > 0)) {
        return;
      }

      if (q) {
        const match = columns.some((c) =>
          String(r[c] ?? "").toLowerCase().includes(q)
        );
        if (!match) return;
      }

      for (const [col, allowedSet] of Object.entries(columnFilters)) {
        const cellVal = formatUsdCell(r[col], col).trim();
        if (!allowedSet.has(cellVal)) return;
      }

      indices.push(idx);
    });

    if (sortConfig) {
      const { col, asc } = sortConfig;
      indices.sort((idxA, idxB) => {
        const rA = rows[idxA];
        const rB = rows[idxB];
        if (!rA.id && !rB.id) return 0;
        if (!rA.id) return 1;
        if (!rB.id) return -1;

        const av = String(rA[col] ?? "").trim();
        const bv = String(rB[col] ?? "").trim();
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;

        const an = parseFloat(av.replace(/[^0-9.-]/g, ""));
        const bn = parseFloat(bv.replace(/[^0-9.-]/g, ""));
        if (!isNaN(an) && !isNaN(bn)) {
          return asc ? an - bn : bn - an;
        }
        return asc
          ? av.localeCompare(bv, undefined, { numeric: true })
          : bv.localeCompare(av, undefined, { numeric: true });
      });
    }

    return indices;
  }, [rows, columns, searchQuery, columnFilters, sortConfig]);

  const persistedRowCount = rows.filter((r) => r.id != null).length;

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">
      {/* Backlink & Header */}
      <div>
        <button
          onClick={() => onBackToDashboard(slug)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to {matocLabel} Dashboard
        </button>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {matocLabel} — Raw Data &amp; Excel Editor
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              <strong className="font-mono">{persistedRowCount}</strong> database row
              {persistedRowCount === 1 ? "" : "s"} in physical table{" "}
              <code className="font-mono text-indigo-700">{tableName}</code>.{" "}
              {isAdmin
                ? "Admin mode active — click any bid cell to edit and auto-save (or paste multi-cell blocks from Excel)."
                : "Standard mode — Project Type column is editable."}
            </p>
          </div>
        </div>
      </div>

      {/* Status / Feedback Banner */}
      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            banner.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {banner.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            onClick={() => setBanner(null)}
            className="text-xs font-bold opacity-70 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* USAspending Live Pull Status Banner */}
      {pullProgress && (pullProgress.running || pullProgress.last_message?.includes("Completed")) && (
        <div className="p-4 rounded-xl bg-slate-900 text-slate-100 border border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              USAspending.gov Sync [{pullProgress.matoc_label || matocLabel}]:{" "}
              <span className="text-indigo-300 font-mono">{pullProgress.last_message}</span>
            </span>
            <span className="font-mono font-bold text-emerald-400 tabular-nums">
              {pullProgress.percentage ?? 0}% ({pullProgress.completed ?? 0}/
              {pullProgress.total ?? 0})
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${pullProgress.percentage ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Interactive Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all columns..."
            className="pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 w-60"
          />
        </div>

        <button
          onClick={handleClassifySelectedRow}
          disabled={classifying}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {classifying ? "Classifying..." : "Classify Selected Title"}
        </button>

        <button
          onClick={handleBatchClassifyAll}
          disabled={classifying}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
        >
          Auto-Classify Blank Project Types
        </button>

        <button
          onClick={() => onOpenContractorIntel(slug)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <Users className="w-3.5 h-3.5 text-indigo-600" />
          Contractor Intelligence
        </button>

        <button
          onClick={() => onOpenModIntel(slug)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <GitCommit className="w-3.5 h-3.5 text-amber-600" />
          Modification Intelligence
        </button>

        <a
          href={`/api/dashboard/${encodeURIComponent(slug)}/data/export`}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-emerald-600" />
          Download Excel (.xlsx)
        </a>

        {isAdmin && (
          <button
            onClick={handleStartUsaSpendingPull}
            disabled={pullProgress?.running}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${pullProgress?.running ? "animate-spin" : ""}`}
            />
            Pull Latest from USAspending.gov
          </button>
        )}
      </div>

      {/* Excel Import Panel (Super Admin / Admin) */}
      {(isSuperAdmin || isAdmin) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Import / Refresh Data from Excel (.xlsx / .xls)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Matched on <strong>Folder Number</strong> (or <strong>ID</strong> for Construction Management sheets) — existing rows are updated in place, unchanged rows stay untouched, and new Folder Numbers are inserted with zero duplicates.
              </p>
            </div>

            <form
              onSubmit={handleExcelUpload}
              className="flex flex-wrap items-center gap-2.5 shrink-0"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                required
                className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-200 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
              />
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Sheet name (optional)"
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-500 w-44"
              />
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Importing..." : "Upload & Import"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main Editable Excel Data Grid */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden relative">
        <div className="overflow-x-auto max-h-[68vh]">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 border-b-2 border-slate-200">
              <tr>
                <th className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-500 border-r border-slate-200 w-12">
                  #
                </th>
                {columns.map((col) => {
                  const hasFilter = Boolean(columnFilters[col]);
                  return (
                    <th
                      key={col}
                      className="py-2.5 px-3 text-left font-bold text-[11px] uppercase tracking-wider text-slate-600 border-r border-slate-200 min-w-[150px] max-w-[240px] relative select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          onClick={() =>
                            setSortConfig((prev) =>
                              prev?.col === col
                                ? { col, asc: !prev.asc }
                                : { col, asc: true }
                            )
                          }
                          className="cursor-pointer hover:text-indigo-600 truncate"
                        >
                          {col}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFilterSearch("");
                            setOpenFilterCol((prev) => (prev === col ? null : col));
                          }}
                          className={`p-1 rounded hover:bg-slate-200 cursor-pointer ${
                            hasFilter ? "text-indigo-600 bg-indigo-50" : "text-slate-400"
                          }`}
                          title="Sort & Filter Column"
                        >
                          <Filter className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Column Filter Dropdown */}
                      {openFilterCol === col && (
                        <ColumnFilterDropdown
                          col={col}
                          rows={rows.filter((r) => r.id != null)}
                          currentAllowed={columnFilters[col]}
                          filterSearch={filterSearch}
                          setFilterSearch={setFilterSearch}
                          onSort={(asc) => {
                            setSortConfig({ col, asc });
                            setOpenFilterCol(null);
                          }}
                          onApply={(selectedSet, totalUniqueCount) => {
                            setColumnFilters((prev) => {
                              const next = { ...prev };
                              if (!selectedSet || selectedSet.size === totalUniqueCount) {
                                delete next[col];
                              } else {
                                next[col] = selectedSet;
                              }
                              return next;
                            });
                            setOpenFilterCol(null);
                          }}
                          onClose={() => setOpenFilterCol(null)}
                        />
                      )}
                    </th>
                  );
                })}
                {isAdmin && (
                  <th className="py-2.5 px-3 text-center font-bold text-[11px] uppercase tracking-wider text-slate-600 w-24">
                    Actions
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td
                    colSpan={columns.length + 2}
                    className="py-12 text-center text-slate-400"
                  >
                    Loading database records...
                  </td>
                </tr>
              ) : (
                visibleRowIndices.map((rIdx, displayNum) => {
                  const row = rows[rIdx];
                  const isSelectedRow = selectedRowIdx === rIdx;
                  return (
                    <tr
                      key={row.id ? `id-${row.id}` : `blank-${rIdx}`}
                      onClick={() => setSelectedRowIdx(rIdx)}
                      className={`transition-colors ${
                        isSelectedRow ? "bg-indigo-50/40" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-400 border-r border-slate-200 tabular-nums">
                        {row.id ? displayNum + 1 : "+"}
                      </td>
                      {columns.map((col, cIdx) => {
                        const canEdit =
                          (isAdmin && EDITABLE_DB_COLS.has(col)) ||
                          col === "Project Type";
                        const cellKey = `${rIdx}-${col}`;
                        const isSaved = savedCells.has(cellKey);
                        const formatted = formatUsdCell(row[col], col);
                        const isNumCol =
                          CURRENCY_COLS.has(col.toLowerCase()) ||
                          INTEGER_COLS.has(col.toLowerCase()) ||
                          col.toLowerCase().includes("%");

                        return (
                          <td
                            key={col}
                            contentEditable={canEdit}
                            suppressContentEditableWarning
                            onFocus={(e) => {
                              setSelectedRowIdx(rIdx);
                              if (CURRENCY_COLS.has(col.toLowerCase())) {
                                const raw = String(row[col] ?? "").replace(
                                  /[^0-9.-]/g,
                                  ""
                                );
                                e.currentTarget.textContent = raw;
                              }
                            }}
                            onBlur={(e) => {
                              const text = e.currentTarget.textContent || "";
                              handleCellBlur(rIdx, col, text);
                              e.currentTarget.textContent = formatUsdCell(
                                sanitizeValueForColumn(col, text),
                                col
                              );
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                            onPaste={(e) => handleTablePaste(e, rIdx, cIdx)}
                            className={`py-2 px-3 border-r border-slate-200 align-middle focus:outline-2 focus:outline-indigo-600 focus:bg-white ${
                              isNumCol ? "font-mono text-right tabular-nums" : ""
                            } ${
                              col === "Modifications & Values"
                                ? "whitespace-pre-line min-w-[210px]"
                                : "max-w-[260px]"
                            } ${isSaved ? "cell-saved" : ""} ${
                              !canEdit ? "bg-slate-50/50 text-slate-500" : "text-slate-900"
                            }`}
                          >
                            {formatted}
                          </td>
                        );
                      })}
                      {isAdmin && (
                        <td className="py-2 px-3 text-center">
                          {row.id ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRow(rIdx);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-600 hover:text-white transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400">New row</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer bar to add more blank spreadsheet rows */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing {visibleRowIndices.length} row(s) · Click any editable cell to type or paste a multi-row block from Excel.
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                const more = Array.from({ length: 10 }).map(() => {
                  const obj: Record<string, any> = { id: null };
                  columns.forEach((c) => (obj[c] = ""));
                  return obj;
                });
                setRows((prev) => [...prev, ...more]);
              }}
              className="inline-flex items-center gap-1 px-3 py-1 font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add 10 Blank Rows
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface ColumnFilterDropdownProps {
  col: string;
  rows: Record<string, any>[];
  currentAllowed?: Set<string>;
  filterSearch: string;
  setFilterSearch: (s: string) => void;
  onSort: (asc: boolean) => void;
  onApply: (selected: Set<string> | null, totalCount: number) => void;
  onClose: () => void;
}

const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  col,
  rows,
  currentAllowed,
  filterSearch,
  setFilterSearch,
  onSort,
  onApply,
  onClose,
}) => {
  const uniqueValues = React.useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      s.add(formatUsdCell(r[col], col).trim());
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rows, col]);

  const [checkedSet, setCheckedSet] = useState<Set<string>>(
    () => new Set(currentAllowed || uniqueValues)
  );

  const visibleValues = uniqueValues.filter((v) =>
    (v || "(Blanks)").toLowerCase().includes(filterSearch.toLowerCase())
  );

  const allChecked = checkedSet.size === uniqueValues.length;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-full mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-lg z-50 text-xs font-normal normal-case tracking-normal text-slate-800 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => onSort(true)}
        className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 hover:text-indigo-700 font-medium cursor-pointer"
      >
        Sort A to Z / Smallest to Largest
      </button>
      <button
        type="button"
        onClick={() => onSort(false)}
        className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 hover:text-indigo-700 font-medium border-b border-slate-100 cursor-pointer"
      >
        Sort Z to A / Largest to Smallest
      </button>

      <div className="p-2.5 border-b border-slate-100">
        <input
          type="text"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          placeholder="Search values..."
          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="max-h-44 overflow-y-auto p-2.5 space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-900">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) => {
              if (e.target.checked) {
                setCheckedSet(new Set(uniqueValues));
              } else {
                setCheckedSet(new Set());
              }
            }}
            className="accent-indigo-600"
          />
          <span>(Select All)</span>
        </label>
        {visibleValues.map((v) => (
          <label key={v} className="flex items-center gap-2 cursor-pointer text-slate-700">
            <input
              type="checkbox"
              checked={checkedSet.has(v)}
              onChange={(e) => {
                const next = new Set(checkedSet);
                if (e.target.checked) next.add(v);
                else next.delete(v);
                setCheckedSet(next);
              }}
              className="accent-indigo-600"
            />
            <span className="truncate">{v === "" ? "(Blanks)" : v}</span>
          </label>
        ))}
      </div>

      <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 border border-slate-200 bg-white rounded-md font-semibold text-slate-600 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(checkedSet, uniqueValues.length)}
          className="px-3 py-1 bg-indigo-600 text-white rounded-md font-semibold cursor-pointer"
        >
          Apply
        </button>
      </div>
    </div>
  );
};
