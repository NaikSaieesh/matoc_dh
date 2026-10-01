import React, { useState, useEffect } from "react";
import {
  Search,
  ArrowRight,
  ArrowLeft,
  Plus,
  Database,
  Shield,
  LogOut,
  LogIn,
  FileSpreadsheet,
} from "lucide-react";
import { DatabaseStudioView } from "./components/DatabaseStudioView.tsx";
import { DashboardView } from "./components/DashboardView.tsx";
import { RawDataView } from "./components/RawDataView.tsx";
import {
  ContractorIntelligenceView,
  ModificationIntelligenceView,
} from "./components/ContractorModViews.tsx";
import { AdminView } from "./components/AdminView.tsx";

type ViewState =
  | { page: "home" }
  | { page: "category"; categoryKey: string }
  | { page: "dashboard"; slug: string }
  | { page: "raw_data"; slug: string }
  | { page: "contractor"; slug: string }
  | { page: "modifications"; slug: string }
  | { page: "database_studio" }
  | { page: "admin" }
  | { page: "login"; nextView?: ViewState };

interface UserSession {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_super_admin: boolean;
  session_id?: string;
}

export default function App() {
    const [user, setUser] = useState<UserSession | null>(() => {
    try {
      const saved = sessionStorage.getItem("matoc_session_user");
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!parsed?.user || !parsed?.expiresAt || Date.now() > parsed.expiresAt) {
        sessionStorage.removeItem("matoc_session_user");
        return null;
      }
      return parsed.user as UserSession;
    } catch {
      return null;
    }
  });

    // Start on the login page. The dashboard is only shown after a successful login.
    const [view, setView] = useState<ViewState>(() => {
    try {
      const saved = sessionStorage.getItem("matoc_session_user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.user && Date.now() < parsed.expiresAt) return { page: "home" };
      }
    } catch {}
    return { page: "login" };
  });

  // Auth guard: if nobody is logged in, always show the login page
  useEffect(() => {
    if (!user && view.page !== "login") {
      setView({ page: "login" });
    }
  }, [user, view.page]);

  const [categories, setCategories] = useState<
    Array<{ key: string; label: string; desc: string; count: number }>
  >([
    {
      key: "construction",
      label: "Construction MATOC",
      desc: "Construction MATOC vehicles",
      count: 0,
    },
    {
      key: "construction-management",
      label: "Construction Management MATOC",
      desc: "Construction Management MATOC vehicles",
      count: 0,
    },
  ]);
  const [allMatocs, setAllMatocs] = useState<
    Array<{
      slug: string;
      label: string;
      table_name: string;
      category: string;
      row_count?: number;
    }>
  >([]);

  // Category page search & inline create
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [quickMatocLabel, setQuickMatocLabel] = useState("");
  const [quickCreating, setQuickCreating] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("saieeshnaik25@gmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const fetchGlobalRegistry = async () => {
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      if (data.ok) {
        setCategories(data.categories || []);
        setAllMatocs(data.matocs || []);
      }
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  };

  useEffect(() => {
    fetchGlobalRegistry();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Invalid credentials");
      }
      setUser(data.user);
      localStorage.setItem("matoc_session_user", JSON.stringify(data.user));
      if (view.page === "login" && view.nextView) {
        setView(view.nextView);
      } else {
        setView({ page: "home" });
      }
    } catch (err: any) {
      setLoginError(err?.message || "Invalid credentials. Please try again.");
    }
  };

  const handleLogout = async () => {
    if (user?.session_id) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: user.session_id }),
      }).catch(() => {});
    }
    setUser(null);
    localStorage.removeItem("matoc_session_user");
    setView({ page: "login" });
  };

  const handleQuickCreateMatoc = async (categoryKey: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!quickMatocLabel.trim()) return;
    setQuickCreating(true);
    try {
      const res = await fetch("/api/admin/matoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: quickMatocLabel.trim(),
          category: categoryKey,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setQuickMatocLabel("");
        await fetchGlobalRegistry();
      }
    } finally {
      setQuickCreating(false);
    }
  };

  const isAdmin = Boolean(user?.is_admin);
  const isSuperAdmin = Boolean(user?.is_super_admin);

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* 3-Zone Top Bar Contract */}
      <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-40">
        {/* Zone 1: Single text element wordmark */}
        <button
          onClick={() => setView({ page: "home" })}
          className="text-base font-extrabold tracking-tight text-slate-900 hover:text-indigo-600 transition-colors cursor-pointer whitespace-nowrap"
        >
          MATOC Contract Intelligence
        </button>

        {/* Zone 2: 5 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600">
          <button
            onClick={() => setView({ page: "home" })}
            className={`hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap ${
              view.page === "home" ? "text-indigo-600 underline underline-offset-4" : ""
            }`}
          >
            Categories
          </button>
          <button
            onClick={() =>
              setView({ page: "category", categoryKey: "construction" })
            }
            className={`hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap ${
              view.page === "category" && view.categoryKey === "construction"
                ? "text-indigo-600 underline underline-offset-4"
                : ""
            }`}
          >
            Construction MATOC
          </button>
          <button
            onClick={() =>
              setView({
                page: "category",
                categoryKey: "construction-management",
              })
            }
            className={`hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap ${
              view.page === "category" &&
              view.categoryKey === "construction-management"
                ? "text-indigo-600 underline underline-offset-4"
                : ""
            }`}
          >
            Construction Management
          </button>
          {isAdmin && (
          <button
            onClick={() => setView({ page: "database_studio" })}
            className={`hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap ${
              view.page === "database_studio"
                ? "text-indigo-600 underline underline-offset-4"
                : ""
            }`}
          >
            Database &amp; SQL Studio
          </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setView({ page: "admin" })}
              className={`hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap ${
                view.page === "admin"
                  ? "text-indigo-600 underline underline-offset-4"
                  : ""
              }`}
            >
              Admin Panel
            </button>
          )}
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-xs text-slate-600 hidden sm:inline whitespace-nowrap">
                {user.username} · {user.is_super_admin ? "Super Admin" : user.is_admin ? "Admin" : "User"}
              </span>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log Out
              </button>
            </>
          ) : (
            <button
              onClick={() => setView({ page: "login" })}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5" />
              Admin Login
            </button>
          )}
        </div>
      </header>

      {/* Main Viewport Content */}
      <main className="flex-1">
        {/* VIEW 1: LOGIN PAGE (login_main.html) */}
        {view.page === "login" && (
          <div className="min-h-[calc(100vh-56px)] flex items-center justify-center p-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-8 w-full max-w-sm space-y-5 shadow-xs">
              <div className="text-center">
                <h1 className="text-xl font-extrabold text-indigo-700">
                  MATOC INTEL LOGIN
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                </p>
              </div>

              {loginError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {loginError}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Email or Username
                  </label>
                  <input
                    type="text"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-600"
                    placeholder="saieeshnaik25@gmail.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-600"
                    placeholder="Enter password (e.g. Admin@123)"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
                >
                  Log In
                </button>
              </form>
            </div>
          </div>
        )}

        {/* VIEW 2: HOME LANDING PAGE (index.html) */}
        {view.page === "home" && (
          <div className="max-w-6xl mx-auto px-6 py-12 space-y-10">
            <div className="text-center max-w-2xl mx-auto">
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
                Contract Intelligence Dashboard
              </h1>
              <p className="text-sm text-slate-600 mt-2">
                Choose a MATOC vehicle category, manage database connections &amp; SQL extractions, or open the Admin Panel.
              </p>
            </div>

            {/* 3 Primary Home Cards (Construction MATOC, Construction Management MATOC, Admin Panel) + Database Studio Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {categories.map((c) => (
                <button
                  key={c.key}
                  onClick={() => {
                    setVehicleSearch("");
                    setView({ page: "category", categoryKey: c.key });
                  }}
                  className="text-left min-h-[190px] bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between hover:border-indigo-600 hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-600" />
                  <div>
                    <div className="text-base font-bold text-slate-900 leading-snug">
                      {c.label}
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
                      {c.count} MATOC vehicle{c.count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 group-hover:text-indigo-600">
                      View MATOCs
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              ))}

              {/* Database Connections & Data Extraction Studio Card */}
              {isAdmin && (
              <button
                onClick={() => setView({ page: "database_studio" })}
                className="text-left min-h-[190px] bg-white border border-indigo-200 rounded-2xl p-6 flex flex-col justify-between hover:border-indigo-600 hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-600" />
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-base font-bold text-slate-900 leading-snug">
                      Database &amp; SQL Studio
                    </div>
                    <Database className="w-4 h-4 text-emerald-600 shrink-0" />
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5">
                    MySQL connections, Schema.sql inspector &amp; live query extraction
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                  <span className="text-xs font-semibold text-emerald-700">
                    Connections &amp; Queries
                  </span>
                  <ArrowRight className="w-4 h-4 text-emerald-600 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
              )}

              {/* Admin Panel Card */}
              {isAdmin && (
                <button
                  onClick={() => setView({ page: "admin" })}
                  className="text-left min-h-[190px] bg-amber-50/70 border border-amber-200 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-600 hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="text-base font-bold text-slate-900 leading-snug">
                        Admin Panel
                      </div>
                      <Shield className="w-4 h-4 text-amber-600 shrink-0" />
                    </div>
                    <div className="text-xs text-slate-600 mt-1.5">
                      Users, MATOC physical tables &amp; settings
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-amber-200/60">
                    <span className="text-xs font-semibold text-amber-700">
                      Full Control
                    </span>
                    <ArrowRight className="w-4 h-4 text-amber-600 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              )}
            </div>

            {/* Registered MATOC Vehicles Direct Access Table */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Registered MATOC Database Tables ({allMatocs.length})
                  </h2>
                  {/*<p className="text-xs text-slate-500 mt-0.5">
                    Every MATOC below maps to its own physical table (<code>bids_&lt;slug&gt;</code>) in the database.
                  </p> */}
                </div>

                {isAdmin && (
                  <button
                    onClick={() => setView({ page: "admin" })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add / Manage MATOCs
                  </button>
                )}
              </div>

              {allMatocs.length === 0 ? (
                <div className="p-8 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-3">
                  <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
                    Just like in <code>db.py</code>, <code>matoc_config</code> starts clean without pre-seeded fake MATOCs. Create your MATOC vehicles (e.g., <strong>FRR</strong>, <strong>NAVFAC ME</strong>, <strong>NAVFAC GU</strong>) in the Admin Panel or import your <code>.sql</code> database dump in the Database &amp; SQL Studio.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => setView({ page: "admin" })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create MATOC in Admin Panel
                    </button>
                    <button
                      onClick={() => setView({ page: "database_studio" })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-emerald-600" />
                      Connect MySQL / Import .SQL Dump
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {allMatocs.map((m) => (
                    <div
                      key={m.slug}
                      className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3 hover:border-indigo-400 transition-colors"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {m.label}
                          </span>
                          <span className="text-xs font-mono text-slate-500 tabular-nums">
                            {m.row_count ?? 0} rows
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-1">
                          {m.table_name} · {m.category}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => setView({ page: "dashboard", slug: m.slug })}
                          className="flex-1 py-1.5 px-3 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer text-center"
                        >
                          Open Dashboard
                        </button>
                        <button
                          onClick={() => setView({ page: "raw_data", slug: m.slug })}
                          className="py-1.5 px-3 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer inline-flex items-center gap-1"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          Raw Data
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 3: CATEGORY VEHICLE LIST PAGE (matoc_list.html) */}
        {view.page === "category" && (
          <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
            <div className="text-center">
              <button
                onClick={() => setView({ page: "home" })}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline cursor-pointer mb-3"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to home
              </button>
              <h1 className="text-3xl font-extrabold text-slate-900">
                {categories.find((c) => c.key === view.categoryKey)?.label ||
                  view.categoryKey}
              </h1>
              <p className="text-sm text-slate-600 mt-1.5">
                Select a MATOC to view its competitive pricing &amp; win/loss dashboard
              </p>
            </div>

            {/* Search + Quick Add MATOC Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-2xl mx-auto">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  placeholder="Search MATOC vehicle (e.g. NAVFAC, FRR, USACE)..."
                  className="w-full pl-10 pr-4 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 shadow-2xs"
                />
              </div>

              {isAdmin && (
                <form
                  onSubmit={(e) => handleQuickCreateMatoc(view.categoryKey, e)}
                  className="flex items-center gap-2 w-full sm:w-auto shrink-0"
                >
                  <input
                    type="text"
                    value={quickMatocLabel}
                    onChange={(e) => setQuickMatocLabel(e.target.value)}
                    placeholder="New MATOC name..."
                    className="px-3 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 w-44"
                  />
                  <button
                    type="submit"
                    disabled={quickCreating}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add MATOC
                  </button>
                </form>
              )}
            </div>

            {/* MATOC Vehicle Grid */}
            {(() => {
              const filtered = allMatocs.filter(
                (m) =>
                  m.category === view.categoryKey &&
                  m.label
                    .toLowerCase()
                    .includes(vehicleSearch.toLowerCase().trim())
              );

              if (filtered.length === 0) {
                return (
                  <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl text-xs text-slate-500">
                    No MATOC vehicles found in this category yet. Use the{" "}
                    <strong>Add MATOC</strong> box above or the Admin Panel to create one.
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filtered.map((m) => (
                    <button
                      key={m.slug}
                      onClick={() => setView({ page: "dashboard", slug: m.slug })}
                      className="text-left min-h-[130px] bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between hover:border-indigo-600 hover:-translate-y-1 transition-all cursor-pointer group relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-600 opacity-80 group-hover:opacity-100" />
                      <div>
                        <div className="text-base font-bold text-slate-900">
                          {m.label}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-1 tabular-nums">
                          {m.table_name} · {m.row_count ?? 0} rows
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3">
                        <span className="text-xs font-medium text-slate-500 group-hover:text-indigo-600">
                          View dashboard
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* VIEW 4: DASHBOARD VIEW */}
        {view.page === "dashboard" && (
          <DashboardView
            slug={view.slug}
            isAdmin={isAdmin}
            isSuperAdmin={isSuperAdmin}
            onSelectMatoc={(s) => setView({ page: "dashboard", slug: s })}
            onOpenRawData={(s) => setView({ page: "raw_data", slug: s })}
            onOpenContractorIntel={(s) => setView({ page: "contractor", slug: s })}
            onOpenModIntel={(s) => setView({ page: "modifications", slug: s })}
          />
        )}

        {/* VIEW 5: RAW DATA / EXCEL VIEW */}
        {view.page === "raw_data" && (
          <RawDataView
            slug={view.slug}
            isAdmin={isAdmin}
            isSuperAdmin={isSuperAdmin}
            onBackToDashboard={(s) => setView({ page: "dashboard", slug: s })}
            onOpenContractorIntel={(s) => setView({ page: "contractor", slug: s })}
            onOpenModIntel={(s) => setView({ page: "modifications", slug: s })}
          />
        )}

        {/* VIEW 6: CONTRACTOR INTELLIGENCE VIEW */}
        {view.page === "contractor" && (
          <ContractorIntelligenceView
            slug={view.slug}
            onBackToDashboard={(s) => setView({ page: "dashboard", slug: s })}
            onOpenRawData={(s) => setView({ page: "raw_data", slug: s })}
            onOpenModIntel={(s) => setView({ page: "modifications", slug: s })}
          />
        )}

        {/* VIEW 7: MODIFICATION INTELLIGENCE VIEW */}
        {view.page === "modifications" && (
          <ModificationIntelligenceView
            slug={view.slug}
            onBackToDashboard={(s) => setView({ page: "dashboard", slug: s })}
            onOpenRawData={(s) => setView({ page: "raw_data", slug: s })}
            onOpenContractorIntel={(s) => setView({ page: "contractor", slug: s })}
          />
        )}

        {/* VIEW 8: DATABASE CONNECTIONS, DATA EXTRACTION & SQL QUERY STUDIO */}
        {view.page === "database_studio" && (
          <DatabaseStudioView
            onOpenMatocDashboard={(s) => setView({ page: "dashboard", slug: s })}
            onOpenMatocRawData={(s) => setView({ page: "raw_data", slug: s })}
            onRefreshRegistry={fetchGlobalRegistry}
          />
        )}

        {/* VIEW 9: ADMIN PANEL */}
        {view.page === "admin" && (
          <AdminView
            currentUserId={user?.id || 0}
            isSuperAdmin={isSuperAdmin}
            onOpenDashboard={(s) => setView({ page: "dashboard", slug: s })}
            onOpenRawData={(s) => setView({ page: "raw_data", slug: s })}
            onRefreshGlobal={fetchGlobalRegistry}
          />
        )}
      </main>
    </div>
  );
}
