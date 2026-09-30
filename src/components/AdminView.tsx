import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Eye,
  EyeOff,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  LayoutDashboard,
} from "lucide-react";

interface AdminViewProps {
  currentUserId: number;
  isSuperAdmin: boolean;
  onOpenDashboard: (slug: string) => void;
  onOpenRawData: (slug: string) => void;
  onRefreshGlobal: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({
  currentUserId,
  isSuperAdmin,
  onOpenDashboard,
  onOpenRawData,
  onRefreshGlobal,
}) => {
  const [activeTab, setActiveTab] = useState<"matocs" | "users" | "create-user">("matocs");
  const [matocsList, setMatocsList] = useState<any[]>([]);
  const [categories, setCategories] = useState<Record<string, { label: string; desc: string }>>({
    construction: { label: "Construction MATOC", desc: "Construction MATOC vehicles" },
    "construction-management": {
      label: "Construction Management MATOC",
      desc: "Construction Management MATOC vehicles",
    },
  });
  const [users, setUsers] = useState<any[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // Add MATOC form
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState("construction");
  const [creatingMatoc, setCreatingMatoc] = useState(false);

  // Create User form
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [grantAdmin, setGrantAdmin] = useState(false);
  const [grantSuperAdmin, setGrantSuperAdmin] = useState(false);

  // Confirm modal state (replaces window.confirm per iframe constraint)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    desc: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const loadAdminOverview = async () => {
    try {
      const res = await fetch("/api/admin/overview");
      const data = await res.json();
      if (data.ok) {
        setMatocsList(data.matocs_list || []);
        if (data.categories) setCategories(data.categories);
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadAdminOverview();
  }, []);

  const handleCreateMatoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreatingMatoc(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/matoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), category: newCategory }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Could not create MATOC");
      }
      setBanner({ ok: true, text: data.message });
      setNewLabel("");
      await loadAdminOverview();
      onRefreshGlobal();
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Failed to create MATOC" });
    } finally {
      setCreatingMatoc(false);
    }
  };

  const handleChangeCategory = async (slug: string, category: string) => {
    try {
      const res = await fetch(`/api/admin/matoc/${encodeURIComponent(slug)}/category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      const data = await res.json();
      if (data.ok) {
        setBanner({ ok: true, text: data.message });
        await loadAdminOverview();
        onRefreshGlobal();
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Could not change category" });
    }
  };

  const handleTruncateMatoc = (slug: string, label: string) => {
    setConfirmAction({
      title: `Truncate '${label}'?`,
      desc: `This will delete ALL rows in '${label}' while keeping its physical database table structure intact.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/matoc/${encodeURIComponent(slug)}/truncate`, {
          method: "POST",
        });
        const data = await res.json();
        if (data.ok) {
          setBanner({ ok: true, text: data.message });
          await loadAdminOverview();
          onRefreshGlobal();
        } else {
          setBanner({ ok: false, text: data.error || "Failed to truncate" });
        }
      },
    });
  };

  const handleDeleteMatoc = (slug: string, label: string) => {
    setConfirmAction({
      title: `Delete '${label}' & Drop Table?`,
      desc: `This permanently deletes '${label}' from matoc_config and executes DROP TABLE on its physical database table.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/matoc/${encodeURIComponent(slug)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.ok) {
          setBanner({ ok: true, text: data.message });
          await loadAdminOverview();
          onRefreshGlobal();
        } else {
          setBanner({ ok: false, text: data.error || "Failed to delete MATOC" });
        }
      },
    });
  };

  const handleUpdateUserRole = async (
    userId: number,
    isAdminFlag: boolean,
    isSuperAdminFlag: boolean
  ) => {
    if (userId === currentUserId && !isSuperAdminFlag && isSuperAdmin) {
      setBanner({
        ok: false,
        text: "You cannot remove your own Super Admin privileges.",
      });
      return;
    }
    try {
      const res = await fetch(`/api/admin/user/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_admin: isAdminFlag,
          is_super_admin: isSuperAdminFlag,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setBanner({ ok: true, text: data.message });
        await loadAdminOverview();
      }
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "Failed to update role" });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    try {
      const res = await fetch("/api/admin/user/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          is_admin: grantAdmin,
          is_super_admin: grantSuperAdmin,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create user");
      }
      setBanner({ ok: true, text: data.message });
      setUsername("");
      setEmail("");
      setPassword("");
      setGrantAdmin(false);
      setGrantSuperAdmin(false);
      await loadAdminOverview();
    } catch (err: any) {
      setBanner({ ok: false, text: err?.message || "User creation failed" });
    }
  };

  // Password strength calculation (matching admin.js)
  const pwdStrength = React.useMemo(() => {
    let score = 0;
    if (password.length >= 6) score += 25;
    if (password.length >= 10) score += 25;
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) score += 25;
    if (/[^A-Za-z0-9]/.test(password)) score += 25;
    return score;
  }, [password]);

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
        <p className="text-xs text-slate-600 mt-1">
          Full control of the MATOC database tables (<code>matoc_config</code> &amp;{" "}
          <code>bids_*</code>) and user access control.
        </p>
      </div>

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

      {/* Confirmation Dialog Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2.5 text-rose-600">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-900">{confirmAction.title}</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{confirmAction.desc}</p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const fn = confirmAction.onConfirm;
                  setConfirmAction(null);
                  await fn();
                }}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("matocs")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === "matocs"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          MATOC Management ({matocsList.length})
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === "users"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          User Access Control ({users.length})
        </button>
        <button
          onClick={() => setActiveTab("create-user")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === "create-user"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Create User
        </button>
      </div>

      {/* TAB 1: MATOC MANAGEMENT */}
      {activeTab === "matocs" && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-bold text-slate-900">Add a New MATOC</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Creates a brand-new physical database table (<code>bids_&lt;slug&gt;</code>) with{" "}
              <code>UNIQUE KEY (folder_number)</code> and registers it in{" "}
              <code>matoc_config</code> immediately.
            </p>
            <form onSubmit={handleCreateMatoc} className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. FRR, NAVFAC ME, NAVFAC GU, NAVFAC SW MACC..."
                required
                className="px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-500 min-w-[280px]"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="px-3.5 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                {Object.entries(categories).map(([key, cat]) => (
                  <option key={key} value={key}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={creatingMatoc}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {creatingMatoc ? "Creating..." : "Create MATOC"}
              </button>
            </form>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-bold text-slate-900">
              Existing MATOCs ({matocsList.length})
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Truncate empties a table&apos;s rows while keeping the MATOC registered. Delete removes the MATOC and drops its physical table permanently.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3 font-semibold">MATOC</th>
                    <th className="py-2.5 px-3 font-semibold">Slug</th>
                    <th className="py-2.5 px-3 font-semibold">Physical DB Table</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Rows</th>
                    <th className="py-2.5 px-3 font-semibold">Category</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matocsList.map((item) => (
                    <tr key={item.slug} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-bold text-slate-900">{item.label}</td>
                      <td className="py-3 px-3 font-mono text-slate-500">{item.slug}</td>
                      <td className="py-3 px-3 font-mono text-indigo-700">{item.table_name}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {item.row_count}
                      </td>
                      <td className="py-3 px-3">
                        <select
                          value={item.category_key}
                          onChange={(e) => handleChangeCategory(item.slug, e.target.value)}
                          className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                        >
                          {Object.entries(categories).map(([k, cat]) => (
                            <option key={k} value={k}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => onOpenDashboard(item.slug)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 cursor-pointer"
                        >
                          <LayoutDashboard className="w-3 h-3" />
                          View
                        </button>
                        <button
                          onClick={() => onOpenRawData(item.slug)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 cursor-pointer"
                        >
                          <FileSpreadsheet className="w-3 h-3" />
                          Data
                        </button>
                        <button
                          onClick={() => handleTruncateMatoc(item.slug, item.label)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-500 hover:text-white transition-colors cursor-pointer"
                        >
                          Truncate
                        </button>
                        <button
                          onClick={() => handleDeleteMatoc(item.slug, item.label)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-md hover:bg-rose-600 hover:text-white transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {matocsList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        No MATOCs registered yet — add one above (e.g. FRR, NAVFAC ME, NAVFAC GU).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER ACCESS CONTROL */}
      {activeTab === "users" && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-bold text-slate-900">Registered Users &amp; Roles</h2>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            Manage user roles and privileges for all accounts stored in the <code>users</code> table.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-3 font-semibold">ID</th>
                  <th className="py-2.5 px-3 font-semibold">Username</th>
                  <th className="py-2.5 px-3 font-semibold">Email</th>
                  <th className="py-2.5 px-3 font-semibold">Admin</th>
                  <th className="py-2.5 px-3 font-semibold">Super Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3 font-mono tabular-nums">{u.id}</td>
                    <td className="py-3 px-3 font-bold text-slate-900">{u.username}</td>
                    <td className="py-3 px-3 text-slate-600">{u.email || "N/A"}</td>
                    <td className="py-3 px-3">
                      <input
                        type="checkbox"
                        checked={Boolean(u.is_admin)}
                        disabled={!isSuperAdmin}
                        onChange={(e) =>
                          handleUpdateUserRole(
                            u.id,
                            e.target.checked,
                            Boolean(u.is_super_admin)
                          )
                        }
                        className="accent-indigo-600 w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <input
                        type="checkbox"
                        checked={Boolean(u.is_super_admin)}
                        disabled={!isSuperAdmin}
                        onChange={(e) =>
                          handleUpdateUserRole(
                            u.id,
                            Boolean(u.is_admin),
                            e.target.checked
                          )
                        }
                        className="accent-indigo-600 w-4 h-4 cursor-pointer"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CREATE USER */}
      {activeTab === "create-user" && (
        <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Create New User</h2>
            <p className="text-xs text-slate-500 mt-1">
              Register a new user account with Werkzeug scrypt password hashing and initial access privileges.
            </p>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Username <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. jdoe"
                required
                className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. jdoe@example.com"
                className="w-full px-3.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter secure password"
                  required
                  className="w-full px-3.5 py-2 pr-10 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${pwdStrength}%`,
                    backgroundColor:
                      pwdStrength <= 25
                        ? "#EF4444"
                        : pwdStrength <= 50
                        ? "#F59E0B"
                        : pwdStrength <= 75
                        ? "#EAB308"
                        : "#10B981",
                  }}
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300">
                <input
                  type="checkbox"
                  checked={grantAdmin}
                  onChange={(e) => setGrantAdmin(e.target.checked)}
                  className="mt-0.5 accent-indigo-600 w-4 h-4"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Grant Admin Access
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Allows managing MATOCs and editing raw database cells.
                  </div>
                </div>
              </label>

              {isSuperAdmin && (
                <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300">
                  <input
                    type="checkbox"
                    checked={grantSuperAdmin}
                    onChange={(e) => setGrantSuperAdmin(e.target.checked)}
                    className="mt-0.5 accent-indigo-600 w-4 h-4"
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Grant Super Admin Access
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Full administrative rights including Excel bulk upload and user role control.
                    </div>
                  </div>
                </label>
              )}
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              Create User Account
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
