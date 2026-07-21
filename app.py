from functools import wraps
import io
import os

from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    abort,
    flash,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
import pandas as pd

from charts import (
    build_contractor_project_chart,
    build_contractor_year_chart,
    build_full_dashboard_html,
)
from db import (
    COLUMN_MAP,
    check_login,
    create_matoc,
    delete_matoc,
    delete_row,
    get_contractor_dataframe,
    get_contractors,
    get_matocs,
    load_matoc_dataframe,
    load_raw_dataframe,
    truncate_matoc_table,
    update_cell,
    upsert_dataframe,
)

load_dotenv()

app = Flask(__name__)

# Needed for login session cookies. Set a real secret in production via env var.
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

# Admin password default fallback
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


# --------------------------------------------------------------------------
# Helper & Decorator Functions
# --------------------------------------------------------------------------

def is_admin() -> bool:
    """Check whether the current session has admin privileges."""
    return bool(session.get("is_admin"))


def login_required(f):
    """Ensure user is logged in before accessing the view."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login", next=request.path))
        return f(*args, **kwargs)
    return decorated


def admin_required(view):
    """Ensure user is authenticated with admin privileges."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def check_slug(slug):
    """Verify that a MATOC slug exists, else abort with 404."""
    if slug not in get_matocs():
        abort(404, f"Unknown MATOC '{slug}'")


def _asterisk_filter_on() -> bool:
    """Reads the ?asterisk=on/off query param (defaults to ON) and returns
    whether the Asterisk Bid filter should be applied."""
    return request.args.get("asterisk", "on").strip().lower() != "off"


# --------------------------------------------------------------------------
# Auth Routes
# --------------------------------------------------------------------------

@app.route("/login", methods=["GET", "POST"])
def login():
    # CHANGE 1: If user is ALREADY logged in, redirect them directly to index
    if session.get("logged_in"):
        return redirect(url_for("index"))

    next_url = request.args.get("next") or request.form.get("next") or url_for("index")
    error = None

    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        # Check DB authentication (MySQL / Database check)
        user = check_login(username, password) if username else None

        if user:
            session["logged_in"] = True
            session["username"] = user["username"]
            session["user_id"] = user["id"]
            session["is_admin"] = user.get("is_admin", False)
            return redirect(next_url)

        # Fallback to direct admin password check
        elif password == ADMIN_PASSWORD:
            session["logged_in"] = True
            session["username"] = "admin"
            session["is_admin"] = True
            return redirect(next_url)

        error = "Invalid credentials. Please try again."
        flash(error)

    return render_template("login_main.html", error=error, next_url=next_url)


@app.route("/logout")
def logout():
    session.clear()  # Clears session cookie data
    return redirect(url_for("login"))


# --------------------------------------------------------------------------
# Landing Page + Main Dashboard (Protected with @login_required)
# --------------------------------------------------------------------------

@app.route("/")
@login_required  # CHANGE 2: Protected main page
def index():
    """Landing page: pick which MATOC to view."""
    return render_template("index.html", matocs=get_matocs())


@app.route("/dashboard/<slug>")
@login_required  # CHANGE 2: Protected dashboard
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
@login_required
def download_dashboard(slug):
    """Download the ENTIRE rendered dashboard as one self-contained .html file."""
    check_slug(slug)
    matoc_label = get_matocs()[slug]
    df = load_matoc_dataframe(slug)
    exclude_asterisk_bids = _asterisk_filter_on()
    html = build_full_dashboard_html(
        df,
        matoc_label,
        slug=slug,
        is_admin=is_admin(),
        exclude_asterisk_bids=exclude_asterisk_bids,
    )
    buf = io.BytesIO(html.encode("utf-8"))
    filename = f"{matoc_label.replace(' ', '_')}_Dashboard.html"
    return send_file(buf, mimetype="text/html", as_attachment=True, download_name=filename)


# --------------------------------------------------------------------------
# Raw Data / Excel View + Editing + Import/Export
# --------------------------------------------------------------------------

@app.route("/dashboard/<slug>/data")
@login_required
def raw_data(slug):
    """Shows every row/column for this MATOC in an Excel-like grid."""
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
@login_required
def export_raw_data(slug):
    """Download the raw table as an .xlsx file."""
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
    """Import/refresh this MATOC's data from an uploaded Excel file."""
    check_slug(slug)
    file = request.files.get("excel_file")
    if not file or file.filename == "":
        return redirect(url_for("raw_data", slug=slug, message="No file selected."))

    sheet = request.form.get("sheet") or 0
    try:
        df = pd.read_excel(file, sheet_name=sheet)
        stats = upsert_dataframe(slug, df)
        msg = (
            f"Import complete - inserted: {stats['inserted']}, "
            f"updated: {stats['updated']}, unchanged: {stats['unchanged']}, "
            f"skipped: {stats['skipped']}."
        )
    except Exception as e:
        msg = f"Import failed: {e}"

    return redirect(url_for("raw_data", slug=slug, message=msg))


@app.route("/dashboard/<slug>/contractor")
@login_required
def contractor_intelligence(slug):
    check_slug(slug)

    contractors = get_contractors(slug)
    if not contractors:
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
        "win_rate": win_rate,
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
        recent=recent,
    )


# --------------------------------------------------------------------------
# Admin Operations
# --------------------------------------------------------------------------

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
        return redirect(
            url_for("admin_dashboard", message=f"MATOC '{label}' created (slug: {slug}).")
        )
    except Exception as e:
        return redirect(url_for("admin_dashboard", error=f"Could not create MATOC: {e}"))


@app.route("/admin/matoc/<slug>/truncate", methods=["POST"])
@admin_required
def admin_truncate_matoc(slug):
    check_slug(slug)
    label = get_matocs()[slug]
    try:
        truncate_matoc_table(slug)
        return redirect(
            url_for("admin_dashboard", message=f"All rows in '{label}' were deleted (table kept).")
        )
    except Exception as e:
        return redirect(url_for("admin_dashboard", error=f"Could not truncate '{label}': {e}"))


@app.route("/admin/matoc/<slug>/delete", methods=["POST"])
@admin_required
def admin_delete_matoc(slug):
    check_slug(slug)
    label = get_matocs()[slug]
    try:
        delete_matoc(slug)
        return redirect(
            url_for("admin_dashboard", message=f"MATOC '{label}' and its table were deleted.")
        )
    except Exception as e:
        return redirect(url_for("admin_dashboard", error=f"Could not delete '{label}': {e}"))


# --------------------------------------------------------------------------
# Admin Code Editor
# --------------------------------------------------------------------------

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
EDITABLE_EXTENSIONS = {".py", ".html", ".css", ".js", ".sql", ".txt", ".md"}
EXCLUDED_DIRS = {"__pycache__", ".git", "venv", ".venv", "node_modules"}


def _safe_project_path(rel_path):
    """Resolves rel_path under PROJECT_ROOT and blocks path-traversal attempts."""
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
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                original = f.read()
            with open(path + ".bak", "w", encoding="utf-8") as f:
                f.write(original)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        note = ""
        if rel_path.endswith(".py"):
            note = (
                " Python file saved - the dev server will auto-reload in a few seconds."
            )
        return redirect(
            url_for("admin_editor", file=rel_path, message=f"Saved {rel_path}." + note)
        )
    except Exception as e:
        return redirect(url_for("admin_editor", file=rel_path, error=f"Save failed: {e}"))


# --------------------------------------------------------------------------
# Application Entry Point
# --------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)