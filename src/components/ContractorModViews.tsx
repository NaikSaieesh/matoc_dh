import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ArrowLeft, Search, FileSpreadsheet, Users, GitCommit } from "lucide-react";

interface ContractorIntelProps {
  slug: string;
  onBackToDashboard: (slug: string) => void;
  onOpenRawData: (slug: string) => void;
  onOpenModIntel: (slug: string) => void;
}

export const ContractorIntelligenceView: React.FC<ContractorIntelProps> = ({
  slug,
  onBackToDashboard,
  onOpenRawData,
  onOpenModIntel,
}) => {
  const [data, setData] = useState<any | null>(null);
  const [selectedContractor, setSelectedContractor] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchContractorData = async (contractor?: string) => {
    setLoading(true);
    try {
      const q = contractor ? `?contractor=${encodeURIComponent(contractor)}` : "";
      const res = await fetch(`/api/dashboard/${encodeURIComponent(slug)}/contractor${q}`);
      const json = await res.json();
      if (json.ok) {
        setData(json);
        if (json.selected) setSelectedContractor(json.selected);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedContractor("");
    fetchContractorData();
  }, [slug]);

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
      <div>
        <button
          onClick={() => onBackToDashboard(slug)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Dashboard
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {data?.matoc_label || slug} — Contractor Intelligence
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Historical award volume, project type specialization, and win footprint per contractor.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenRawData(slug)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
              Raw Data
            </button>
            <button
              onClick={() => onOpenModIntel(slug)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <GitCommit className="w-3.5 h-3.5 text-amber-600" />
              Modification Intelligence
            </button>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="p-12 text-center text-xs text-slate-400">
          Loading contractor intelligence from database...
        </div>
      ) : !data?.contractors || data.contractors.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <h2 className="text-base font-bold text-slate-800">No Contractor Data Found</h2>
          <p className="text-xs text-slate-500 mt-1">
            No rows with non-empty Awardee values exist in this MATOC table yet.
          </p>
        </div>
      ) : (
        <>
          {/* Contractor Selector Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Select Contractor ({data.contractors.length}):
            </label>
            <select
              value={selectedContractor}
              onChange={(e) => {
                setSelectedContractor(e.target.value);
                fetchContractorData(e.target.value);
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-900 min-w-[300px] focus:outline-none focus:border-indigo-500"
            >
              {data.contractors.map((c: string) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* KPI Cards */}
          {data.stats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-xs font-semibold text-slate-500">Total Projects</div>
                <div className="text-2xl font-extrabold text-indigo-600 mt-1 font-mono tabular-nums">
                  {data.stats.total_projects}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-xs font-semibold text-slate-500">
                  Total Contract Value
                </div>
                <div className="text-2xl font-extrabold text-indigo-600 mt-1 font-mono tabular-nums">
                  ${Math.round(data.stats.total_value).toLocaleString("en-US")}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-xs font-semibold text-slate-500">
                  Total Modifications Value
                </div>
                <div className="text-2xl font-extrabold text-amber-600 mt-1 font-mono tabular-nums">
                  ${Math.round(data.stats.total_mods).toLocaleString("en-US")}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-xs font-semibold text-slate-500">
                  Combined Footprint
                </div>
                <div className="text-2xl font-extrabold text-emerald-600 mt-1 font-mono tabular-nums">
                  $
                  {Math.round(
                    data.stats.total_value + data.stats.total_mods
                  ).toLocaleString("en-US")}
                </div>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">
                Contract Value by Year
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.yearlyData || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(v) =>
                        v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}k`
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        `$${Math.round(Number(v)).toLocaleString()}`,
                        "Contract Value",
                      ]}
                    />
                    <Bar dataKey="contractValue" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">
                Top Project Types
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.projectData || []}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) =>
                        v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}k`
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="projectType"
                      width={150}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        `$${Math.round(Number(v)).toLocaleString()}`,
                        "Contract Value",
                      ]}
                    />
                    <Bar dataKey="contractValue" fill="#10B981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Recent Awards Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">
                Recent Awards ({data.recent?.length || 0})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-600">
                    <th className="py-3 px-4 font-semibold">Year</th>
                    <th className="py-3 px-4 font-semibold">Project Type</th>
                    <th className="py-3 px-4 font-semibold">Title</th>
                    <th className="py-3 px-4 font-semibold text-right">Award Value</th>
                    <th className="py-3 px-4 font-semibold text-right">Mod Value</th>
                    <th className="py-3 px-4 font-semibold text-right">Our Bid</th>
                    <th className="py-3 px-4 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(data.recent || []).map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono tabular-nums">{row["Year"]}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">
                        {row["Project Type"]}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 max-w-md truncate">
                        {row["Title"] || "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        ${Math.round(Number(row["Contract Value"] || 0)).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        ${Math.round(Number(row["Mods"] || 0)).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        ${Math.round(Number(row["Addon Bid"] || 0)).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold">
                        {row["Result"]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// MODIFICATION INTELLIGENCE VIEW (modification_intelligence.html)
// ============================================================================
interface ModIntelProps {
  slug: string;
  onBackToDashboard: (slug: string) => void;
  onOpenRawData: (slug: string) => void;
  onOpenContractorIntel: (slug: string) => void;
}

export const ModificationIntelligenceView: React.FC<ModIntelProps> = ({
  slug,
  onBackToDashboard,
  onOpenRawData,
  onOpenContractorIntel,
}) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/${encodeURIComponent(slug)}/modifications`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setData(json);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const filteredDetail = React.useMemo(() => {
    if (!data?.detail) return [];
    if (!search.trim()) return data.detail;
    const q = search.toLowerCase().trim();
    return data.detail.filter((r: any) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [data, search]);

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
      <div>
        <button
          onClick={() => onOpenRawData(slug)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Raw Data
        </button>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-amber-700">
              {data?.matoc_label || slug} — Modification Intelligence
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Every post-award modification pulled from USAspending.gov (via{" "}
              <code>award_master</code> and <code>award_modifications</code>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onBackToDashboard(slug)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Bid Dashboard
            </button>
            <button
              onClick={() => onOpenContractorIntel(slug)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              Contractor Intelligence
            </button>
            <button
              onClick={() => onOpenRawData(slug)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
              Raw Data (Excel View)
            </button>
            {data?.has_data && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search award, awardee, description..."
                  className="pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 w-64"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400">
          Loading post-award modification records...
        </div>
      ) : !data?.has_data ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center space-y-2">
          <h2 className="text-base font-bold text-slate-700">
            No Modification Detail Found
          </h2>
          <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
            No rows in <code>award_modifications</code> currently match an{" "}
            <code>award_id</code> in this MATOC&apos;s table. Click{" "}
            <strong>Pull Latest from USAspending.gov</strong> on the Raw Data page (or import your SQL dump in Database Studio) to populate this view.
          </p>
        </div>
      ) : (
        <>
          {/* 5 KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Modifications
              </div>
              <div className="text-2xl font-extrabold text-amber-600 mt-1.5 font-mono tabular-nums">
                {data.stats.total_mods}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Modification Value
              </div>
              <div className="text-2xl font-extrabold text-amber-600 mt-1.5 font-mono tabular-nums">
                ${Math.round(data.stats.total_mod_value).toLocaleString()}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Awards With Modifications
              </div>
              <div className="text-2xl font-extrabold text-amber-600 mt-1.5 font-mono tabular-nums">
                {data.stats.awards_with_mods}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Average Modification
              </div>
              <div className="text-2xl font-extrabold text-amber-600 mt-1.5 font-mono tabular-nums">
                ${Math.round(data.stats.avg_mod_value).toLocaleString()}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Largest Single Mod
              </div>
              <div className="text-2xl font-extrabold text-amber-600 mt-1.5 font-mono tabular-nums">
                ${Math.round(data.stats.largest_mod_value).toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 truncate">
                {data.stats.largest_mod_award} · {data.stats.largest_mod_awardee}
              </div>
            </div>
          </div>

          {/* Modification Value by Month */}
          {data.timelineData?.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">
                Modification Value by Month
              </h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.timelineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(v) =>
                        v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}k`
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        `$${Math.round(Number(v)).toLocaleString()}`,
                        "Mod Value",
                      ]}
                    />
                    <Bar dataKey="modValue" fill="#D97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Top 15 Awards by Mod Value & Mod Count */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">
                Top 15 Awards by Total Modification Value
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.awardValueData || []}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={180}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        `$${Math.round(Number(v)).toLocaleString()}`,
                        "Total Mod Value",
                      ]}
                    />
                    <Bar dataKey="modTotal" fill="#EF4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">
                Top 15 Most-Modified Awards (by # of Mods)
              </h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.awardCountData || []}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={180}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(v: any, _n: any, props: any) => [
                        `${v} mods ($${Math.round(
                          props.payload.modTotal
                        ).toLocaleString()})`,
                        "Modifications",
                      ]}
                    />
                    <Bar dataKey="modCount" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Modification Value by Project Type */}
          {data.projectData?.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">
                Modification Value by Project Type
              </h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.projectData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="projectType"
                      width={160}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        `$${Math.round(Number(v)).toLocaleString()}`,
                        "Mod Value",
                      ]}
                    />
                    <Bar dataKey="modValue" fill="#F97316" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* All Modifications Detail Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  All Modifications (Detail)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {filteredDetail.length} modification row
                  {filteredDetail.length === 1 ? "" : "s"} · Sorted by most recent action date.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[65vh]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-amber-800">
                  <tr>
                    <th className="py-3 px-4 font-bold">Award/PIID</th>
                    <th className="py-3 px-4 font-bold">Awardee</th>
                    <th className="py-3 px-4 font-bold">Project Type</th>
                    <th className="py-3 px-4 font-bold">Mod #</th>
                    <th className="py-3 px-4 font-bold">Action Date</th>
                    <th className="py-3 px-4 font-bold">Description</th>
                    <th className="py-3 px-4 font-bold text-right">Mod Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredDetail.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {row["Award/PIID"]}
                      </td>
                      <td className="py-2.5 px-4 text-slate-800">{row["Awardee"]}</td>
                      <td className="py-2.5 px-4 text-slate-600">{row["Project Type"]}</td>
                      <td className="py-2.5 px-4 font-mono">{row["Modification #"]}</td>
                      <td className="py-2.5 px-4 font-mono whitespace-nowrap tabular-nums">
                        {row["Action Date"]}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 max-w-md whitespace-pre-wrap">
                        {row["Description"]}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                        ${Math.round(Number(row["Mod Value"] || 0)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
