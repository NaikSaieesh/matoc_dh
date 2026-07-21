import io
import os
from functools import wraps

from flask import (
    Flask, render_template, abort, Response, request, redirect,
    url_for, session, send_file, flash
)
import pandas as pd

from db import (
    load_matoc_dataframe,
    load_raw_dataframe,
    update_cell,
    upsert_dataframe,
    delete_row,
    get_matocs,
    COLUMN_MAP,
    get_contractors,
    get_contractor_dataframe,
    create_matoc,
    truncate_matoc_table,
    delete_matoc,
)

from charts import (
    build_full_dashboard_html,
    build_contractor_year_chart,
    build_contractor_project_chart
)

from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
# Needed for login sessions. Set a real secret in production via env var.
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

# Admin password - change this (or set the ADMIN_PASSWORD env var) before
# putting this anywhere other people can reach.
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


def is_admin() -> bool:
    return bool(session.get("is_admin"))


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def check_slug(slug):
    if slug not in get_matocs():
        abort(404, f"Unknown MATOC '{slug}'")


# --------------------------------------------------------------------------
# Landing page + main dashboard
# --------------------------------------------------------------------------

@app.route("/")
def index():
    """Landing page: pick which MATOC to view."""
    return render_template("index.html", matocs=get_matocs())


'''@app.route("/dashboard/<slug>")
def dashboard(slug):
    check_slug(slug)
    matoc_label = get_matocs()[slug]
    df = load_matoc_dataframe(slug)
    html = build_full_dashboard_html(df, matoc_label, slug=slug, is_admin=is_admin())
    return Response(html, mimetype="text/html")'''

def _asterisk_filter_on() -> bool:
    """Reads the ?asterisk=on/off query param (defaults to ON, same as the
    original always-on behavior) and returns whether the Asterisk Bid
    filter should be applied."""
    return request.args.get("asterisk", "on").strip().lower() != "off"


@app.route("/dashboard/<slug>")
def dashboard(slug):
    check_slug(slug)

    matoc_label = get_matocs()[slug]
    df = load_matoc_dataframe(slug)
    exclude_asterisk_bids = _asterisk_filter_on()

    html = build_full_dashboard_html(
        df,
        matoc_label,
        slug=slug,
        is_admin=is_admin(),
        all_matocs=get_matocs(),
        exclude_asterisk_bids=exclude_asterisk_bids,
    )

    return Response(html, mimetype="text/html")

@app.route("/dashboard/<slug>/download")
def download_dashboard(slug):
    """Download the ENTIRE rendered dashboard as one self-contained .html
    file (charts, KPIs, tables and all - opens straight in a browser)."""
    check_slug(slug)
    matoc_label = get_matocs()[slug]
    df = load_matoc_dataframe(slug)
    exclude_asterisk_bids = _asterisk_filter_on()
    html = build_full_dashboard_html(
        df, matoc_label, slug=slug, is_admin=is_admin(),
        exclude_asterisk_bids=exclude_asterisk_bids,
    )
    buf = io.BytesIO(html.encode("utf-8"))
    filename = f"{matoc_label.replace(' ', '_')}_Dashboard.html"
    return send_file(buf, mimetype="text/html", as_attachment=True, download_name=filename)


# --------------------------------------------------------------------------
# Admin login / logout
# --------------------------------------------------------------------------

@app.route("/login", methods=["GET", "POST"])
def login():
    next_url = request.args.get("next") or request.form.get("next") or url_for("index")
    error = None
    if request.method == "POST":
        if request.form.get("password") == ADMIN_PASSWORD:
            session["is_admin"] = True
            return redirect(next_url)
        error = "Wrong password."
    return render_template("login.html", error=error, next_url=next_url)


@app.route("/logout")
def logout():
    session.pop("is_admin", None)
    return redirect(request.referrer or url_for("index"))


# --------------------------------------------------------------------------
# Raw data / Excel view + admin editing + Excel import
# --------------------------------------------------------------------------

@app.route("/dashboard/<slug>/data")
def raw_data(slug):
    """Shows every row/column for this MATOC in an Excel-like grid.
    Editing and importing are only available once logged in as admin."""
    check_slug(slug)
    df = load_raw_dataframe(slug)
    columns = list(COLUMN_MAP.keys())  # Excel-style headers, in order
    rows = df.to_dict(orient="records")
    return render_template(
        "raw_data.html",
        matoc_label=get_matocs()[slug],
        slug=slug,
        columns=columns,
        rows=rows,
        is_admin=is_admin(),
        message=request.args.get("message"),
    )


@app.route("/dashboard/<slug>/data/export")
def export_raw_data(slug):
    """Download the raw table as a real .xlsx file (opens in Excel)."""
    check_slug(slug)
    matoc_label = get_matocs()[slug]
    df = load_raw_dataframe(slug).drop(columns=["id"], errors="ignore")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=matoc_label[:31])
    buf.seek(0)
    filename = f"{matoc_label.replace(' ', '_')}_Data.xlsx"
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/dashboard/<slug>/data/update", methods=["POST"])
@admin_required
def update_data(slug):
    """AJAX endpoint used by the editable grid to save one cell."""
    check_slug(slug)
    payload = request.get_json(force=True)
    row_id = payload.get("id")
    column = payload.get("column")
    value = payload.get("value", "")
    try:
        update_cell(slug, row_id, column, value)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}, 400


@app.route("/dashboard/<slug>/data/delete/<int:row_id>", methods=["POST"])
@admin_required
def delete_data_row(slug, row_id):
    check_slug(slug)
    delete_row(slug, row_id)
    return redirect(url_for("raw_data", slug=slug, message="Row deleted."))


@app.route("/dashboard/<slug>/data/upload", methods=["POST"])
@admin_required
def upload_data(slug):
    """Import/refresh this MATOC's data from an uploaded Excel file.
    Matched on Folder Number: unchanged rows are skipped, changed rows are
    replaced in place, and brand-new Folder Numbers are added - so
    re-uploading a file (even an updated one) never creates duplicates."""
    check_slug(slug)
    file = request.files.get("excel_file")
    if not file or file.filename == "":
        return redirect(url_for("raw_data", slug=slug, message="No file selected."))

    sheet = request.form.get("sheet") or 0
    try:
        df = pd.read_excel(file, sheet_name=sheet)
        stats = upsert_dataframe(slug, df)
        msg = (f"Import complete - inserted: {stats['inserted']}, "
               f"updated: {stats['updated']}, unchanged: {stats['unchanged']}, "
               f"skipped: {stats['skipped']}.")
    except Exception as e:
        msg = f"Import failed: {e}"

    return redirect(url_for("raw_data", slug=slug, message=msg))

@app.route("/dashboard/<slug>/contractor")
def contractor_intelligence(slug):

    check_slug(slug)

    contractors = get_contractors(slug)

    if len(contractors) == 0:
        return "No contractor data found."

    selected = request.args.get("contractor")

    if not selected:
        selected = contractors[0]

    df = get_contractor_dataframe(slug, selected)

    total_projects = len(df)

    total_wins = (df["Result"] == "WON").sum()

    total_value = df["Contract Value"].sum()

    win_rate = round((total_wins / total_projects) * 100, 1) if total_projects else 0

    stats = {

        "total_projects": total_projects,

        "total_wins": total_wins,

        "total_value": total_value,

        "win_rate": win_rate

    }

    yearly_chart = build_contractor_year_chart(df)

    project_chart = build_contractor_project_chart(df)

    recent = (
        df.sort_values("Year", ascending=False)
        .head(20)
        .to_dict("records")
    )

    return render_template(

        "contractor_intelligence.html",

        slug=slug,

        contractors=contractors,

        selected=selected,

        stats=stats,

        yearly_chart=yearly_chart,

        project_chart=project_chart,

        recent=recent
    )

@app.route("/admin")
@admin_required
def admin_dashboard():
    matocs = get_matocs()
    return render_template(
        "admin.html",
        matocs=matocs,
        active_tab="overview",
        message=request.args.get("message"),
        error=request.args.get("error"),
    )


@app.route("/admin/matoc/create", methods=["POST"])
@admin_required
def admin_create_matoc():
    label = request.form.get("label", "")
    try:
        slug = create_matoc(label)
        return redirect(url_for("admin_dashboard", message=f"MATOC '{label}' created (slug: {slug})."))
    except Exception as e:
        return redirect(url_for("admin_dashboard", error=f"Could not create MATOC: {e}"))


@app.route("/admin/matoc/<slug>/truncate", methods=["POST"])
@admin_required
def admin_truncate_matoc(slug):
    check_slug(slug)
    label = get_matocs()[slug]
    try:
        truncate_matoc_table(slug)
        return redirect(url_for("admin_dashboard", message=f"All rows in '{label}' were deleted (table kept)."))
    except Exception as e:
        return redirect(url_for("admin_dashboard", error=f"Could not truncate '{label}': {e}"))


@app.route("/admin/matoc/<slug>/delete", methods=["POST"])
@admin_required
def admin_delete_matoc(slug):
    check_slug(slug)
    label = get_matocs()[slug]
    try:
        delete_matoc(slug)
        return redirect(url_for("admin_dashboard", message=f"MATOC '{label}' and its table were deleted."))
    except Exception as e:
        return redirect(url_for("admin_dashboard", error=f"Could not delete '{label}': {e}"))


# --------------------------------------------------------------------------
# Admin code editor - lets you edit the site's own source files from the
# browser. Anyone with the admin password can run arbitrary code on this
# server through this feature, so keep ADMIN_PASSWORD strong and never
# expose this app to the open internet without extra protection (VPN,
# firewall, reverse-proxy auth, HTTPS, etc).
# --------------------------------------------------------------------------

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
EDITABLE_EXTENSIONS = {".py", ".html", ".css", ".js", ".sql", ".txt", ".md"}
EXCLUDED_DIRS = {"__pycache__", ".git", "venv", ".venv", "node_modules"}


def _safe_project_path(rel_path):
    """Resolves rel_path under PROJECT_ROOT and blocks any path-traversal
    attempt (e.g. '../../etc/passwd'). Raises ValueError if unsafe."""
    candidate = os.path.abspath(os.path.join(PROJECT_ROOT, rel_path))
    if not (candidate == PROJECT_ROOT or candidate.startswith(PROJECT_ROOT + os.sep)):
        raise ValueError("Path is outside the project folder.")
    _, ext = os.path.splitext(candidate)
    if ext.lower() not in EDITABLE_EXTENSIONS:
        raise ValueError(f"'{ext}' files can't be edited here.")
    return candidate


def _list_editable_files():
    files = []
    for root, dirs, filenames in os.walk(PROJECT_ROOT):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
        for fn in filenames:
            _, ext = os.path.splitext(fn)
            if ext.lower() in EDITABLE_EXTENSIONS:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, PROJECT_ROOT).replace(os.sep, "/")
                files.append(rel)
    return sorted(files)


@app.route("/admin/editor")
@admin_required
def admin_editor():
    matocs = get_matocs()
    files = _list_editable_files()
    selected = request.args.get("file") or (files[0] if files else "")
    content = ""
    if selected:
        try:
            path = _safe_project_path(selected)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            content = f"# Could not read file: {e}"
    return render_template(
        "admin.html",
        matocs=matocs,
        active_tab="editor",
        files=files,
        selected_file=selected,
        file_content=content,
        message=request.args.get("message"),
        error=request.args.get("error"),
    )


@app.route("/admin/editor/save", methods=["POST"])
@admin_required
def admin_editor_save():
    rel_path = request.form.get("file", "")
    content = request.form.get("content", "")
    try:
        path = _safe_project_path(rel_path)
        # Keep a one-deep .bak backup so a bad edit is always recoverable.
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                original = f.read()
            with open(path + ".bak", "w", encoding="utf-8") as f:
                f.write(original)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        note = ""
        if rel_path.endswith(".py"):
            note = (" Python file saved - the dev server will auto-reload in a few seconds "
                    "(if it doesn't come back, there's likely a syntax error - check the "
                    f"terminal, or restore {rel_path}.bak).")
        return redirect(url_for("admin_editor", file=rel_path, message=f"Saved {rel_path}." + note))
    except Exception as e:
        return redirect(url_for("admin_editor", file=rel_path, error=f"Save failed: {e}"))


if __name__ == "__main__":
    # Runs at http://127.0.0.1:5000
    app.run(debug=True, port=5000)
