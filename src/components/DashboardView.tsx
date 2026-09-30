import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  Download,
  FileSpreadsheet,
  GitCommit,
  Users,
  Maximize2,
  Minimize2,
  Upload,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

interface DashboardViewProps {
  slug: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  onSelectMatoc: (slug: string) => void;
  onOpenRawData: (slug: string) => void;
  onOpenContractorIntel: (slug: string) => void;
  onOpenModIntel: (slug: string) => void;
}

const CHART_PALETTE = [
  "#4F46E5",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#EC4899",
  "#14B8A6",
  "#F97316",
  "#6366F1",
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  slug,
  isAdmin,
  onSelectMatoc,
  onOpenRawData,
  onOpenContractorIntel,
  onOpenModIntel,
}) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excludeAsterisk, setExcludeAsterisk] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [matocSearch, setMatocSearch] = useState("");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [selectedRevCompany, setSelectedRevCompany] = useState<string>("");

  // Quick Excel upload state when table is empty
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const fetchDashboard = async (asteriskFlag: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/${encodeURIComponent(slug)}?asterisk=${asteriskFlag ? "on" : "off"}`
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load dashboard");
      }
      setData(json);
      if (
        json.revenueDistributionByCompany?.length > 0 &&
        !selectedRevCompany
      ) {
        setSelectedRevCompany(json.revenueDistributionByCompany[0].company);
      }
    } catch (err: any) {
      setError(err?.message || "Error loading dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedRevCompany("");
    fetchDashboard(excludeAsterisk);
  }, [slug, excludeAsterisk]);

  const handleQuickExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingExcel(true);
    setUploadMsg(null);
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
        const res = await fetch(`/api/dashboard/${encodeURIComponent(slug)}/data/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64File }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Upload failed");
        }
        setUploadMsg(json.message);
        await fetchDashboard(excludeAsterisk);
      } catch (err: any) {
        setUploadMsg(err?.message || "Failed to import Excel file");
      } finally {
        setUploadingExcel(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  if (loading && !data) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-12 space-y-6">
        <div className="h-8 w-72 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <div className="bg-white border border-rose-200 rounded-xl p-8">
          <h2 className="text-lg font-bold text-slate-900">Unable to Load MATOC Dashboard</h2>
          <p className="text-xs text-rose-600 mt-2 font-mono">{error}</p>
        </div>
      </div>
    );
  }

  const {
    matoc_label,
    table_name,
    category_label,
    sibling_matocs = {},
    hasAsteriskBid,
    k,
    kpi,
    priceBandsPie = [],
    overpricedByProject = [],
    competitors = [],
    radarPoints = [],
    resumeLostBars = [],
    projectDeepDive = [],
    yoyTrends = [],
    topCompetitorsByProject = [],
    revenueDistributionByCompany = [],
    modsByCompanyProject = [],
    heatmap = { competitors: [], rows: [] },
    critical,
    brief,
  } = data;

  const siblingEntries = Object.entries(sibling_matocs).filter(([, label]) =>
    String(label).toLowerCase().includes(matocSearch.toLowerCase().trim())
  );

  const activeCompanyDist =
    revenueDistributionByCompany.find((c: any) => c.company === selectedRevCompany) ||
    revenueDistributionByCompany[0] ||
    null;

  const toggleExpand = (id: string) => {
    setExpandedCard((prev) => (prev === id ? null : id));
  };

  const renderCardHeader = (
    num: string | number,
    title: string,
    subtitle: string,
    cardId?: string
  ) => (
    <div className="flex items-center gap-3.5 px-6 py-4 border-b border-slate-200 bg-white">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 font-mono text-xs font-bold flex items-center justify-center shrink-0">
        {num}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-slate-900 tracking-tight">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {cardId && (
        <button
          onClick={() => toggleExpand(cardId)}
          className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-300 flex items-center justify-center transition-colors cursor-pointer"
          title="Expand / Collapse Card"
        >
          {expandedCard === cardId ? (
            <Minimize2 className="w-4 h-4" />
          ) : (
            <Maximize2 className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-[calc(100vh-57px)]">
      {/* Left Collapsible Sidebar */}
      {sidebarOpen && (
        <aside className="w-68 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-100">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {category_label}
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5 truncate">
              {matoc_label}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              Table: {table_name}
            </div>
          </div>

          <div className="p-3 flex-1 overflow-y-auto">
            <div className="text-[11px] font-semibold text-slate-500 mb-2 px-1">
              Switch MATOC Vehicle
            </div>
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={matocSearch}
                onChange={(e) => setMatocSearch(e.target.value)}
                placeholder="Search MATOCs..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              {siblingEntries.map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => onSelectMatoc(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer truncate ${
                    s === slug
                      ? "bg-indigo-50 text-indigo-700 font-bold"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {String(label)}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0">
        {/* Sticky Sub-Toolbar & Section Jump Bar */}
        <div className="sticky top-0 z-30 bg-[#F8FAFC]/90 backdrop-blur-md border-b border-slate-200 px-6 py-2.5 flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 cursor-pointer"
              title="Toggle Vehicle Sidebar"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>
            <span className="text-xs text-slate-500">
              {category_label} / <strong className="text-slate-900">{matoc_label}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs overflow-x-auto py-0.5">
            <a
              href="#overview"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              Overview
            </a>
            <a
              href="#price-bands"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              Price Bands
            </a>
            <a
              href="#competitors"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              Competitors
            </a>
            <a
              href="#radar"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              Revenue Radar
            </a>
            <a
              href="#deep-dive"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              Project Deep Dive
            </a>
            <a
              href="#yoy"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              YoY Trends
            </a>
            <a
              href="#heatmap"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              Pricing Heatmap
            </a>
            <a
              href="#brief"
              className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-600 font-medium whitespace-nowrap"
            >
              CEO Brief
            </a>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
          {/* Hero Header & Action Buttons */}
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                {matoc_label} Intelligence Dashboard
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Competitive pricing · Win/Loss analysis · Market intelligence · Physical table:{" "}
                <code className="font-mono text-xs text-indigo-700">{table_name}</code>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <a
                href={`/api/dashboard/${encodeURIComponent(slug)}/download?asterisk=${
                  excludeAsterisk ? "on" : "off"
                }`}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download Dashboard
              </a>
              <button
                onClick={() => onOpenRawData(slug)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                Raw Data (Excel View)
              </button>
              <button
                onClick={() => onOpenContractorIntel(slug)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                Contractor Intel
              </button>
              <button
                onClick={() => onOpenModIntel(slug)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <GitCommit className="w-3.5 h-3.5 text-amber-600" />
                Modification Intel
              </button>
              {hasAsteriskBid && (
                <button
                  onClick={() => setExcludeAsterisk((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    excludeAsterisk
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-slate-100 border-slate-200 text-slate-600"
                  }`}
                >
                  ✱ Exclude Asterisk Bids: {excludeAsterisk ? "ON" : "OFF"}
                </button>
              )}
            </div>
          </div>

          {/* Empty Database Table Prompt (if 0 rows imported yet) */}
          {k.total_bids === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div className="max-w-lg mx-auto">
                <h2 className="text-lg font-bold text-slate-900">
                  No Bid Rows in Physical Table <code className="font-mono">{table_name}</code> Yet
                </h2>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  This dashboard reads 100% directly from your database table{" "}
                  <code className="font-mono">{table_name}</code> with zero synthetic placeholder data. Upload your{" "}
                  <strong>{matoc_label}</strong> Excel file (<code>.xlsx</code>) below or open the Raw Data spreadsheet editor to add rows.
                </p>
              </div>

              {uploadMsg && (
                <div className="max-w-md mx-auto p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 font-medium">
                  {uploadMsg}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <label className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {uploadingExcel ? "Importing Workbook..." : "Upload Excel (.xlsx) into Database"}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleQuickExcelUpload}
                    disabled={uploadingExcel}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={() => onOpenRawData(slug)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Open Raw Data Spreadsheet &rarr;
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* SECTION 0: 8 HEADLINE KPI CARDS */}
              <section
                id="overview"
                className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
              >
                {renderCardHeader(
                  "00",
                  "Executive Overview",
                  "Headline numbers extracted directly from database across every task order in this MATOC"
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-6">
                  {/* 1. Total Task Orders */}
                  <div className="border border-indigo-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Total Task Orders
                    </div>
                    <div className="text-2xl font-extrabold text-slate-900 mt-2 font-mono tabular-nums">
                      {k.total_bids}
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">
                      Won {k.won} · Lost {k.lost} · No Bid {k.nb} · Sole {k.sole} · Cancel{" "}
                      {k.cancel}
                    </div>
                  </div>

                  {/* 2. Win Rate */}
                  <div className="border border-emerald-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Win Rate
                    </div>
                    <div className="text-2xl font-extrabold text-emerald-600 mt-2 font-mono tabular-nums">
                      {k.win_rate}%
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
                      ${kpi.won_value} revenue captured
                    </div>
                  </div>

                  {/* 3. Avg Overpriced When Lost */}
                  <div className="border border-rose-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Avg Overpriced When Lost
                    </div>
                    <div className="text-2xl font-extrabold text-rose-600 mt-2 font-mono tabular-nums">
                      +{kpi.avg_diff}%
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">
                      above winning bid on losses
                    </div>
                  </div>

                  {/* 4. Overpriced 100%+ */}
                  <div className="border border-amber-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Overpriced 100%+
                    </div>
                    <div className="text-2xl font-extrabold text-amber-600 mt-2 font-mono tabular-nums">
                      {k.over100}
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">
                      bids at critical overpricing
                    </div>
                  </div>

                  {/* 5. Total Contract Value */}
                  <div className="border border-indigo-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Total Contract Value
                    </div>
                    <div className="text-2xl font-extrabold text-slate-900 mt-2 font-mono tabular-nums">
                      ${kpi.total_value_m}M
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">across all bids</div>
                  </div>

                  {/* 6. Largest Contract */}
                  <div className="border border-amber-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Largest Contract
                    </div>
                    <div className="text-2xl font-extrabold text-amber-600 mt-2 font-mono tabular-nums">
                      ${kpi.largest_deal_m}M
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">single biggest deal</div>
                  </div>

                  {/* 7. Total Mods Value */}
                  <div className="border border-indigo-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Total Mods Value
                    </div>
                    <div className="text-2xl font-extrabold text-slate-900 mt-2 font-mono tabular-nums">
                      ${kpi.total_mods_m}M
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5">
                      post-award modifications
                    </div>
                  </div>

                  {/* 8. Top Competitors */}
                  <div className="border border-rose-200 rounded-xl p-4 bg-white">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Top Competitors
                    </div>
                    <div className="text-xs font-bold text-rose-700 mt-2 leading-snug">
                      {k.top_rival_list && k.top_rival_list.length > 0 ? (
                        k.top_rival_list.map((r: any, idx: number) => (
                          <div key={idx} className="truncate">
                            {r.name} ({r.count})
                          </div>
                        ))
                      ) : (
                        <span>N/A</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">winning most often</div>
                  </div>
                </div>
              </section>

              {/* CHART 1: PRICE BANDS */}
              <section
                id="price-bands"
                className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                  expandedCard === "price-bands" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                }`}
              >
                {renderCardHeader(
                  "01",
                  "Price Bands & 50%+ Overpriced Breakdown",
                  "Where our lost bids landed vs the winning price, and which project types were 50%+ overpriced.",
                  "price-bands"
                )}
                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left: Price Bands Pie */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                      Price Bands — Bids We Lost
                    </h3>
                    {priceBandsPie.length === 0 ? (
                      <div className="h-72 flex items-center justify-center text-xs text-slate-400">
                        No lost bids recorded.
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={priceBandsPie}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={65}
                              outerRadius={105}
                              paddingAngle={2}
                            >
                              {priceBandsPie.map((entry: any, index: number) => (
                                <Cell key={index} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(val: any, name: any) => [`${val} bids`, name]}
                            />
                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  {/* Right: 50%+ Overpriced by Project Type */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                      50%+ Overpriced — By Project Type (Avg % Above Winner)
                    </h3>
                    {overpricedByProject.length === 0 ? (
                      <div className="h-72 flex items-center justify-center text-xs text-slate-400">
                        No bids overpriced by 50%+.
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={overpricedByProject}
                            layout="vertical"
                            margin={{ top: 5, right: 40, left: 40, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                            <YAxis
                              type="category"
                              dataKey="projectType"
                              width={140}
                              tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                              formatter={(val: any, _n: any, props: any) => [
                                `+${val}% (${props.payload.count} bids)`,
                                "Avg Overbid",
                              ]}
                            />
                            <Bar dataKey="avgOver" fill="#EF4444" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* CHART 2: COMPETITOR INTELLIGENCE */}
              {competitors.length > 0 && (
                <section
                  id="competitors"
                  className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                    expandedCard === "competitors" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                  }`}
                >
                  {renderCardHeader(
                    "02",
                    "Competitor Intelligence",
                    "Who beats us most often on lost task orders, and how much contract value they carry.",
                    "competitors"
                  )}
                  <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Times Each Company Beat Us
                      </h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={competitors}
                            layout="vertical"
                            margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis
                              type="category"
                              dataKey="awardee"
                              width={140}
                              tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                              formatter={(val: any) => [`Beat us ${val} times`, "Wins vs Us"]}
                            />
                            <Bar dataKey="theyBeatUs" radius={[0, 4, 4, 0]}>
                              {competitors.map((c: any, idx: number) => (
                                <Cell
                                  key={idx}
                                  fill={
                                    c.theyBeatUs > 3
                                      ? "#EF4444"
                                      : c.theyBeatUs > 1
                                      ? "#F59E0B"
                                      : "#10B981"
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Contract Value Won by Each Company ($M)
                      </h3>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={[...competitors].sort(
                              (a, b) => b.totalValueM - a.totalValueM
                            )}
                            layout="vertical"
                            margin={{ top: 5, right: 35, left: 40, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis type="number" unit="M" tick={{ fontSize: 11 }} />
                            <YAxis
                              type="category"
                              dataKey="awardee"
                              width={140}
                              tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                              formatter={(val: any) => [`$${val}M`, "Total Contract Value"]}
                            />
                            <Bar dataKey="totalValueM" fill="#4F46E5" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 3: MISSED REVENUE RADAR */}
              {radarPoints.length > 0 && (
                <section
                  id="radar"
                  className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                    expandedCard === "radar" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                  }`}
                >
                  {renderCardHeader(
                    "03",
                    "Missed Revenue Radar",
                    "Contract size ($M) vs how far our bid overshot the winning price (%).",
                    "radar"
                  )}
                  <div className="p-6">
                    <div className="h-96">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis
                            type="number"
                            dataKey="contractValueM"
                            name="Contract Value"
                            unit="M"
                            tick={{ fontSize: 11 }}
                          />
                          <YAxis
                            type="number"
                            dataKey="priceDiffPct"
                            name="Price Diff"
                            unit="%"
                            tick={{ fontSize: 11 }}
                          />
                          <ZAxis type="number" dataKey="contractValueM" range={[50, 400]} />
                          <Tooltip
                            cursor={{ strokeDasharray: "3 3" }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const pt = payload[0].payload;
                              return (
                                <div className="bg-white border border-slate-200 p-3 rounded-lg shadow-md text-xs">
                                  <div className="font-bold text-slate-900">
                                    {pt.projectType} ({pt.result})
                                  </div>
                                  <div className="text-slate-600 mt-0.5">
                                    Winner: {pt.awardee} · Year: {pt.year}
                                  </div>
                                  <div className="font-mono text-slate-900 mt-1">
                                    Contract Value: ${pt.contractValueM}M
                                  </div>
                                  <div className="font-mono text-rose-600">
                                    Price Diff: {pt.priceDiffPct > 0 ? "+" : ""}
                                    {pt.priceDiffPct}%
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Legend />
                          <ReferenceLine y={0} stroke="#64748B" strokeDasharray="3 3" />
                          <ReferenceLine
                            y={50}
                            stroke="#F59E0B"
                            strokeDasharray="5 5"
                            label={{ value: "50% Overpriced", fill: "#D97706", fontSize: 11 }}
                          />
                          <ReferenceLine
                            y={100}
                            stroke="#EF4444"
                            strokeDasharray="5 5"
                            label={{ value: "100% Overpriced", fill: "#DC2626", fontSize: 11 }}
                          />
                          <Scatter
                            name="LOST"
                            data={radarPoints.filter((p: any) => p.result === "LOST")}
                            fill="#EF4444"
                          />
                          <Scatter
                            name="WON"
                            data={radarPoints.filter((p: any) => p.result === "WON")}
                            fill="#10B981"
                          />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 4: RESUME VS LOST PRICE DIFFERENCE (Construction Management Only) */}
              {resumeLostBars.length > 0 && (
                <section
                  id="resume-lost"
                  className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                    expandedCard === "resume-lost" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                  }`}
                >
                  {renderCardHeader(
                    "04",
                    "Resume vs Lost Price Difference",
                    "How far above the winning price ($) each resume's lost bid was, and which company won it.",
                    "resume-lost"
                  )}
                  <div className="p-6">
                    <div style={{ height: Math.max(360, resumeLostBars.length * 36) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={resumeLostBars}
                          layout="vertical"
                          margin={{ top: 10, right: 50, left: 60, bottom: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={180}
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const d = payload[0].payload;
                              return (
                                <div className="bg-white border border-slate-200 p-3 rounded-lg shadow-md text-xs space-y-1">
                                  <div className="font-bold text-slate-900">{d.resume}</div>
                                  <div>Winner: {d.awardee}</div>
                                  <div className="font-mono">
                                    Winning Price: ${d.contractValue.toLocaleString()}
                                  </div>
                                  <div className="font-mono">
                                    Our Bid: ${d.addonBid.toLocaleString()}
                                  </div>
                                  <div className="font-mono text-rose-600 font-semibold">
                                    Lost by: ${d.diffUsd.toLocaleString()} ({d.diffPct.toFixed(1)}%)
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="diffUsd" fill="#4F46E5" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 5: PROJECT TYPE DEEP DIVE (2x2 Matrix) */}
              {projectDeepDive.length > 0 && (
                <section
                  id="deep-dive"
                  className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                    expandedCard === "deep-dive" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                  }`}
                >
                  {renderCardHeader(
                    "05",
                    "Project Type Deep Dive",
                    "Market capacity, win rates, average price difference on losses, and 100%+ overpriced count by project type.",
                    "deep-dive"
                  )}
                  <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* 1. Total Contract Value ($M) */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Total Contract Value by Project ($M)
                      </h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={projectDeepDive.filter((p: any) => p.totalValueM > 0)}
                            margin={{ top: 10, right: 20, left: 10, bottom: 50 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis
                              dataKey="projectType"
                              angle={-30}
                              textAnchor="end"
                              interval={0}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis unit="M" tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: any) => [`$${v}M`, "Total Value"]} />
                            <Bar dataKey="totalValueM" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* 2. Win Rate by Project Type (%) */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Win Rate by Project Type (%)
                      </h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={projectDeepDive}
                            margin={{ top: 10, right: 20, left: 10, bottom: 50 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis
                              dataKey="projectType"
                              angle={-30}
                              textAnchor="end"
                              interval={0}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis unit="%" tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: any) => [`${v}%`, "Win Rate"]} />
                            <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                              {projectDeepDive.map((p: any, idx: number) => (
                                <Cell
                                  key={idx}
                                  fill={
                                    p.winRate >= 30
                                      ? "#10B981"
                                      : p.winRate >= 15
                                      ? "#F59E0B"
                                      : "#EF4444"
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* 3. Avg Price Difference % (When Lost) */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Avg Price Difference % (When Lost)
                      </h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={projectDeepDive.filter((p: any) => p.avgPriceDiff !== 0)}
                            margin={{ top: 10, right: 20, left: 10, bottom: 50 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis
                              dataKey="projectType"
                              angle={-30}
                              textAnchor="end"
                              interval={0}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis unit="%" tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: any) => [`${v}%`, "Avg Over Winner"]} />
                            <Bar dataKey="avgPriceDiff" radius={[4, 4, 0, 0]}>
                              {projectDeepDive
                                .filter((p: any) => p.avgPriceDiff !== 0)
                                .map((p: any, idx: number) => (
                                  <Cell
                                    key={idx}
                                    fill={
                                      p.avgPriceDiff > 50
                                        ? "#EF4444"
                                        : p.avgPriceDiff > 0
                                        ? "#F59E0B"
                                        : "#10B981"
                                    }
                                  />
                                ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* 4. Count of 100%+ Overpriced Bids */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Count of 100%+ Overpriced Bids
                      </h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={projectDeepDive.filter((p: any) => p.over100 > 0)}
                            margin={{ top: 10, right: 20, left: 10, bottom: 50 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis
                              dataKey="projectType"
                              angle={-30}
                              textAnchor="end"
                              interval={0}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip
                              formatter={(v: any) => [`${v} bids`, "100%+ Overpriced"]}
                            />
                            <Bar dataKey="over100" fill="#EF4444" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 6: YEAR-OVER-YEAR TRENDS */}
              {yoyTrends.length > 0 && (
                <section
                  id="yoy"
                  className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                    expandedCard === "yoy" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                  }`}
                >
                  {renderCardHeader(
                    "06",
                    "Year-over-Year Trends",
                    "Bid volume (Total vs Submitted), Win Rate trend (%), and Average Price Difference (%) over time.",
                    "yoy"
                  )}
                  <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Bids: Total vs Submitted
                      </h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={yoyTrends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="totalBids" name="Total Bids" fill="#C7D2FE" />
                            <Bar dataKey="submittedBids" name="Submitted Bids" fill="#4F46E5" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Win Rate Trend (%)
                      </h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={yoyTrends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                            <YAxis unit="%" tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: any) => [`${v}%`, "Win Rate"]} />
                            <Line
                              type="monotone"
                              dataKey="winRate"
                              stroke="#10B981"
                              strokeWidth={3}
                              dot={{ r: 5, fill: "#10B981" }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Avg Price Diff (%)
                      </h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={yoyTrends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                            <YAxis unit="%" tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: any) => [`${v}%`, "Avg Price Diff"]} />
                            <Line
                              type="monotone"
                              dataKey="avgPriceDiff"
                              stroke="#F59E0B"
                              strokeWidth={3}
                              dot={{ r: 5, fill: "#F59E0B" }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 7: FINANCIAL EXTENSION (Mods vs Baseline) */}
              {projectDeepDive.length > 0 && (
                <section
                  id="mods-total"
                  className={`bg-white border-2 border-slate-900 rounded-2xl overflow-hidden ${
                    expandedCard === "mods-total" ? "fixed inset-6 z-50 overflow-y-auto" : ""
                  }`}
                >
                  {renderCardHeader(
                    "07",
                    "Financial Extension",
                    "Linked modifications vs baseline contract value ($M) by project type.",
                    "mods-total"
                  )}
                  <div className="p-6">
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={projectDeepDive}
                          layout="vertical"
                          margin={{ top: 10, right: 30, left: 50, bottom: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis type="number" unit="M" tick={{ fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="projectType"
                            width={150}
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip formatter={(v: any) => [`$${v}M`, ""]} />
                          <Legend />
                          <Bar
                            dataKey="totalValueM"
                            name="Contract Baseline ($M)"
                            stackId="a"
                            fill="#4F46E5"
                          />
                          <Bar
                            dataKey="linkedModsM"
                            name="Linked Mods Value ($M)"
                            stackId="a"
                            fill="#F59E0B"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 8 & 9: TOP COMPETITORS MARKET SHARE & REVENUE DISTRIBUTION DROPDOWN */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Competitors by Project Type */}
                <section
                  id="top-competitors"
                  className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
                >
                  {renderCardHeader(
                    "08",
                    "Top Competitors by Project Type (%)",
                    "Market share of each winning company within competitive project types."
                  )}
                  <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
                    {topCompetitorsByProject.length === 0 ? (
                      <div className="text-xs text-slate-400 py-10 text-center">
                        Not enough multi-winner project types to display market share split.
                      </div>
                    ) : (
                      topCompetitorsByProject.map((row: any) => (
                        <div key={row.projectType} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-900">{row.projectType}</span>
                            <span className="font-mono text-slate-500 tabular-nums">
                              ${(row.totalVolume / 1e6).toFixed(2)}M total
                            </span>
                          </div>
                          <div className="w-full h-6 rounded-md overflow-hidden flex bg-slate-100">
                            {row.shares.map((s: any, idx: number) => (
                              <div
                                key={s.entity}
                                style={{
                                  width: `${Math.max(s.sharePct, 2)}%`,
                                  backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length],
                                }}
                                className="h-full flex items-center justify-center text-[10px] font-bold text-white truncate px-1"
                                title={`${s.entity}: ${s.sharePct}% ($${Math.round(
                                  s.volume
                                ).toLocaleString()})`}
                              >
                                {s.sharePct >= 12 ? `${s.entity} (${s.sharePct}%)` : ""}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* Revenue Distribution by Company Dropdown */}
                <section
                  id="revenue-dist"
                  className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
                >
                  {renderCardHeader(
                    "09",
                    "Revenue Distribution by Company",
                    "Switch company below to inspect revenue breakdown by project type."
                  )}
                  <div className="p-6">
                    {revenueDistributionByCompany.length === 0 ? (
                      <div className="text-xs text-slate-400 py-10 text-center">
                        No company revenue distribution data available.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <select
                            value={activeCompanyDist?.company || ""}
                            onChange={(e) => setSelectedRevCompany(e.target.value)}
                            className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-indigo-500"
                          >
                            {revenueDistributionByCompany.map((c: any) => (
                              <option key={c.company} value={c.company}>
                                {c.company} (${(c.grandTotal / 1e6).toFixed(2)}M)
                              </option>
                            ))}
                          </select>
                          {activeCompanyDist && (
                            <span className="text-xs font-mono text-slate-600 tabular-nums">
                              Total: ${Math.round(activeCompanyDist.grandTotal).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {activeCompanyDist && (
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={activeCompanyDist.breakdown}
                                  dataKey="sharePct"
                                  nameKey="projectType"
                                  innerRadius={50}
                                  outerRadius={90}
                                >
                                  {activeCompanyDist.breakdown.map((_: any, idx: number) => (
                                    <Cell
                                      key={idx}
                                      fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(v: any, name: any, props: any) => [
                                    `${v}% ($${Math.round(
                                      props.payload.value
                                    ).toLocaleString()})`,
                                    name,
                                  ]}
                                />
                                <Legend />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              </div>

              {/* CHART 10: MODIFICATIONS BY COMPANY & PROJECT */}
              {modsByCompanyProject.length > 0 && (
                <section
                  id="mods-company"
                  className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
                >
                  {renderCardHeader(
                    "10",
                    "Modifications by Company & Project Type",
                    "Post-award spreadsheet modification value ($) per company and project type."
                  )}
                  <div className="p-6">
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={modsByCompanyProject.slice(0, 15)}
                          layout="vertical"
                          margin={{ top: 5, right: 40, left: 60, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={210}
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip
                            formatter={(v: any) => [
                              `$${Number(v).toLocaleString()}`,
                              "Mods Value",
                            ]}
                          />
                          <Bar dataKey="mods" fill="#F59E0B" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>
              )}

              {/* CHART 11: PRICING HEATMAP */}
              {heatmap.rows.length > 0 && (
                <section
                  id="heatmap"
                  className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
                >
                  {renderCardHeader(
                    "11",
                    "Pricing Heatmap — Overpricing vs Each Competitor by Project Type",
                    "Average % we overpriced vs each top competitor across project types on lost bids."
                  )}
                  <div className="p-6 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200">
                          <th className="py-2.5 px-3 text-left font-bold text-slate-700 border-r border-slate-200">
                            Project Type \ Winner
                          </th>
                          {heatmap.competitors.map((comp: string) => (
                            <th
                              key={comp}
                              className="py-2.5 px-3 text-center font-semibold text-slate-700 border-r border-slate-200"
                            >
                              {comp}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono">
                        {heatmap.rows.map((r: any) => (
                          <tr key={r.projectType}>
                            <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 border-r border-slate-200 bg-slate-50">
                              {r.projectType}
                            </td>
                            {r.cells.map((c: any) => {
                              const val = c.avgDiffPct;
                              let bg = "bg-white text-slate-300";
                              if (val !== null) {
                                if (val >= 100) bg = "bg-rose-800 text-white font-bold";
                                else if (val >= 50) bg = "bg-rose-600 text-white font-bold";
                                else if (val > 0) bg = "bg-amber-500 text-white font-semibold";
                                else bg = "bg-emerald-600 text-white font-semibold";
                              }
                              return (
                                <td
                                  key={c.competitor}
                                  className={`py-2.5 px-3 text-center border-r border-slate-100 tabular-nums ${bg}`}
                                  title={
                                    val !== null
                                      ? `${r.projectType} vs ${c.competitor}: ${
                                          val > 0 ? "+" : ""
                                        }${val}% (${c.count} bid${c.count === 1 ? "" : "s"})`
                                      : "No lost bids"
                                  }
                                >
                                  {val !== null ? `${val > 0 ? "+" : ""}${Math.round(val)}%` : "—"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* CRITICAL OVERPRICING TABLE (100%+ Above Winner) */}
              {critical && critical.rows.length > 0 && (
                <section
                  id="critical"
                  className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
                >
                  {renderCardHeader(
                    "!",
                    "Critical Overpricing",
                    `${critical.count} bids where our price was 100%+ above the winning contractor`
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 uppercase text-[11px]">
                          <th className="py-3 px-4 font-bold">Year</th>
                          <th className="py-3 px-4 font-bold">Project Type</th>
                          <th className="py-3 px-4 font-bold">Winner (Beat Us)</th>
                          <th className="py-3 px-4 font-bold text-right">Their Contract $</th>
                          <th className="py-3 px-4 font-bold text-right">Our Bid $</th>
                          <th className="py-3 px-4 font-bold text-right">We Overbid By $</th>
                          <th className="py-3 px-4 font-bold text-right">Over %</th>
                          <th className="py-3 px-4 font-bold">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {critical.rows.map((r: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-mono tabular-nums">{r.year}</td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {r.project_type}
                            </td>
                            <td className="py-3 px-4 text-slate-700">{r.awardee}</td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {r.contract_value}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {r.our_bid}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {r.winner_diff}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-rose-600 tabular-nums">
                              {r.pct}
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-rose-700">
                              {r.result}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* CEO ACTION INTELLIGENCE BRIEF */}
              <section
                id="brief"
                className="bg-white border-2 border-slate-900 rounded-2xl overflow-hidden"
              >
                {renderCardHeader(
                  "✦",
                  "CEO Action Intelligence Brief",
                  "What the extracted database numbers mean and what to do next"
                )}
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-200 rounded-xl p-5 bg-white space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" />
                      Market Capture &amp; Win Rate
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      Win rate is <strong className="text-slate-900">{k.win_rate}%</strong> —{" "}
                      {k.won} wins from {k.total_bids} bids. We captured{" "}
                      <strong className="text-slate-900 font-mono">${brief.won_value_m}M</strong> of
                      ${brief.total_value_m}M total market value ({brief.pct_captured}%).
                    </p>
                    <div className="p-2.5 rounded-lg bg-slate-50 border-l-3 border-indigo-600 text-[11px] text-slate-600">
                      Industry benchmark is 20–35%. Market capture rate is the true executive KPI.
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-5 bg-white space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
                      <AlertTriangle className="w-4 h-4" />
                      Pricing Gap on Losses
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      When we lose, our bid is on average{" "}
                      <strong className="text-slate-900 font-mono">+{brief.avg_diff}%</strong> above
                      the winning bid. Worst project types:{" "}
                      <strong className="text-slate-900">{brief.worst_proj_str}</strong>.
                    </p>
                    <div className="p-2.5 rounded-lg bg-slate-50 border-l-3 border-indigo-600 text-[11px] text-slate-600">
                      Run a cost model review on these project types and benchmark subcontractor quotes vs market.
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-5 bg-white space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-rose-700">
                      <AlertTriangle className="w-4 h-4" />
                      Critical 100%+ Overpricing Audit
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      <strong className="text-slate-900 font-mono">{k.over100} bids</strong> were
                      priced 100%+ above the winner. Worst category:{" "}
                      <strong className="text-slate-900">{brief.worst_crit_str}</strong>.
                    </p>
                    <div className="p-2.5 rounded-lg bg-slate-50 border-l-3 border-indigo-600 text-[11px] text-slate-600">
                      Review takeoff assumptions and general conditions markup on 100%+ outlier bids.
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-5 bg-white space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-indigo-700">
                      <Users className="w-4 h-4" />
                      Top Rival &amp; Competition Density
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      Top rival: <strong className="text-slate-900">{k.top_rival}</strong> — beat us{" "}
                      <strong className="text-slate-900">{k.top_rival_n} times</strong>. Average
                      competition per bid:{" "}
                      <strong className="text-slate-900 font-mono">{brief.avg_comp} bidders</strong>.
                    </p>
                    <div className="p-2.5 rounded-lg bg-slate-50 border-l-3 border-indigo-600 text-[11px] text-slate-600">
                      Analyze historical winning unit prices in Contractor Intelligence to calibrate bidding strategy.
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
