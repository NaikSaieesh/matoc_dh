from functools import wraps
import io
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta
from db import update_cell, create_blank_row  # <--- Add create_blank_row here

from dotenv import load_dotenv
from authlib.integrations.flask_client import OAuth
from flask import (
    Flask,
    Response,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
import pandas as pd
from werkzeug.security import generate_password_hash
from openpyxl.styles import Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Columns that should be rendered as US-style currency (comma thousands
# separator + 2 decimals) both in the on-screen Raw Data view and in the
# downloaded .xlsx export. Keep this in sync with the whitelist used in
# templates/raw_data.html.
CURRENCY_COLUMNS = [
    "contract value", "addon bid", "asterisk bid", "winner price difference $",
    "total", "mods", "master obligation", "master base & options",
    "master base & exercised", "linked mods total",
]

THIN_BORDER = Border(
    left=Side(style="thin", color="B0B0B0"),
    right=Side(style="thin", color="B0B0B0"),
    top=Side(style="thin", color="B0B0B0"),
    bottom=Side(style="thin", color="B0B0B0"),
)

import pull_pipeline
from charts import (
    build_contractor_project_chart,
    build_contractor_year_chart,
    build_full_dashboard_html,
    build_mods_timeline_chart,
    build_mods_by_project_type_chart,
    build_mods_by_award_chart,
    build_mods_count_by_award_chart,
)
from db import (
    COLUMN_MAP,
    check_login,
    create_matoc,
    create_user_session,
    invalidate_user_session,
    is_session_active,
    delete_matoc,
    delete_row,
    get_contractor_dataframe,
    get_contractors,
    get_matocs,
    get_modification_dataframe,
    load_matoc_dataframe,
    load_raw_dataframe,
    truncate_matoc_table,
    update_cell,
    upsert_dataframe,
    load_raw_dataframe_with_awards,
    get_user_by_username,
    get_user_by_email,
    register_user
)
from email_utils import send_otp_email

load_dotenv()

app = Flask(__name__)

# Needed for login session cookies. Set a real secret in production via env var.
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

# Admin password default fallback
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# --------------------------------------------------------------------------
# Google OAuth ("Login with Google")
# --------------------------------------------------------------------------
oauth = OAuth(app)
google_oauth = oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


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

@app.before_request
def check_session_validity():
    """Validates session_id against DB on every request. 
    If missing or inactive, forces logout."""
    
    # Skip check for static files and the login route to avoid infinite redirects
    if request.endpoint in ("login", "static", "login_google", "login_google_callback"):
        return

    # Check if the user claims to be logged in
    if session.get("logged_in"):
        session_id = session.get("session_id")
        
        # If session_id is missing or marked inactive/expired in DB
        if not session_id or not is_session_active(session_id):
            session.clear()  # Clear cookies/session
            flash("Your session has expired or is invalid. Please log in again.")
            return redirect(url_for("login"))

def _generate_otp() -> str:
    """Generates a cryptographically-random 6 digit OTP."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _send_registration_otp():
    """(Re)generates an OTP for the pending registration in the session and
    emails it via SendGrid. Returns (success, message)."""
    pending = session.get("pending_registration")
    if not pending:
        return False, "No pending registration found."

    otp = _generate_otp()
    pending["otp"] = otp
    pending["otp_expires_at"] = (datetime.now() + timedelta(minutes=10)).isoformat()
    session["pending_registration"] = pending

    ok, msg = send_otp_email(pending["email"], otp, pending["username"])
    return ok, msg


@app.route("/register", methods=["GET", "POST"])
def register():
    # If already logged in, redirect home
    if session.get("logged_in"):
        return redirect(url_for("index"))

    next_url = request.args.get("next") or request.form.get("next") or url_for("index")
    error = None

    if request.method == "POST":
        stage = request.form.get("stage", "register")

        # ------------------------------------------------------------
        # Stage 1: collect username/email/password, send OTP to email
        # ------------------------------------------------------------
        if stage == "register":
            username = request.form.get("username", "").strip()
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")

            if not username or not email or not password:
                error = "Username, email and password are required."
            elif get_user_by_username(username):
                error = "Username is already taken. Please choose another."
            elif get_user_by_email(email):
                error = "An account with that email already exists."
            else:
                session["pending_registration"] = {
                    "username": username,
                    "email": email,
                    "password_hash": generate_password_hash(password),
                }
                ok, msg = _send_registration_otp()
                if ok:
                    flash(f"We sent a verification code to {email}.")
                else:
                    session.pop("pending_registration", None)
                    error = f"Could not send verification email: {msg}"

            if error:
                flash(error)

        # ------------------------------------------------------------
        # Stage 2: resend the OTP
        # ------------------------------------------------------------
        elif stage == "resend":
            ok, msg = _send_registration_otp()
            if ok:
                flash("A new verification code has been sent.")
            else:
                flash(f"Could not resend code: {msg}")

        # ------------------------------------------------------------
        # Stage 3: verify OTP, create the account, auto-login
        # ------------------------------------------------------------
        elif stage == "verify":
            pending = session.get("pending_registration")
            entered_otp = request.form.get("otp", "").strip()

            if not pending:
                error = "Your registration session expired. Please start again."
            elif datetime.now() > datetime.fromisoformat(pending["otp_expires_at"]):
                error = "That code has expired. Please request a new one."
            elif entered_otp != pending.get("otp"):
                error = "Incorrect verification code. Please try again."
            else:
                user_id = register_user(
                    pending["username"], pending["password_hash"], pending["email"]
                )
                if user_id:
                    session.pop("pending_registration", None)

                    session.permanent = True
                    session["logged_in"] = True
                    session["username"] = pending["username"]
                    session["user_id"] = user_id
                    session["is_admin"] = False

                    session_uuid = str(uuid.uuid4())
                    session["session_id"] = session_uuid
                    expires_at = datetime.now() + timedelta(minutes=45)

                    create_user_session(
                        user_id=user_id,
                        session_id=session_uuid,
                        expires_at=expires_at,
                        ip_address=request.remote_addr,
                        user_agent=request.headers.get("User-Agent")
                    )

                    flash("Account created successfully!")
                    return redirect(next_url)
                else:
                    error = "Failed to create account. Please try again."

            if error:
                flash(error)

    return render_template(
        "register_main.html",
        error=error,
        next_url=next_url,
        awaiting_otp=bool(session.get("pending_registration")),
        pending_email=(session.get("pending_registration") or {}).get("email"),
    )

def _establish_session(user_id, username, email, is_admin=False):
    """Sets Flask session keys + creates a DB-tracked session row.
    Shared by password login, registration, and Google OAuth login."""
    session.permanent = True
    session["logged_in"] = True
    session["username"] = username
    session["email"] = email
    session["user_id"] = user_id
    session["is_admin"] = bool(is_admin)

    session_uuid = str(uuid.uuid4())
    session["session_id"] = session_uuid
    expires_at = datetime.now() + timedelta(minutes=45)

    create_user_session(
        user_id=user_id,
        session_id=session_uuid,
        expires_at=expires_at,
        ip_address=request.remote_addr,
        user_agent=request.headers.get("User-Agent"),
    )


@app.route("/login/google")
def login_google():
    """Kicks off the Google OAuth redirect."""
    if session.get("logged_in"):
        return redirect(url_for("index"))

    next_url = request.args.get("next") or url_for("index")
    session["oauth_next"] = next_url
    redirect_uri = url_for("login_google_callback", _external=True)
    return google_oauth.authorize_redirect(redirect_uri)


@app.route("/login/google/callback")
def login_google_callback():
    """Handles Google's redirect back, finds-or-creates the user, logs them in."""
    next_url = session.pop("oauth_next", None) or url_for("index")

    try:
        token = google_oauth.authorize_access_token()
        userinfo = token.get("userinfo")
        if not userinfo:
            userinfo = google_oauth.parse_id_token(token)
    except Exception as e:
        flash(f"Google sign-in failed: {e}")
        return redirect(url_for("login"))

    email = (userinfo.get("email") or "").strip().lower()
    if not email:
        flash("Google did not return an email address for this account.")
        return redirect(url_for("login"))
    if not userinfo.get("email_verified", True):
        flash("Please use a verified Google email address.")
        return redirect(url_for("login"))

    user = get_user_by_email(email)

    if user:
        _establish_session(
            user_id=user["id"],
            username=user["username"],
            email=user.get("email", "") if isinstance(user, dict) else "",
            is_admin=bool(user.get("is_admin", False)),
        )
    else:
        # First time this Google account has signed in -> auto-register.
        base_username = (userinfo.get("name") or email.split("@")[0]).strip()
        base_username = base_username.replace(" ", "_") or "user"
        username = base_username
        suffix = 1
        while get_user_by_username(username):
            suffix += 1
            username = f"{base_username}{suffix}"

        # Google-authenticated accounts don't have a usable local password;
        # store an unguessable random hash so password login is a no-op.
        unusable_hash = generate_password_hash(secrets.token_hex(32))
        user_id = register_user(username, unusable_hash, email)

        if not user_id:
            flash("Could not create an account for that Google login. Please try again.")
            return redirect(url_for("login"))

        _establish_session(user_id=user_id, username=username, email=email, is_admin=False)
        flash("Account created via Google sign-in.")

    return redirect(next_url)


@app.route("/login", methods=["GET", "POST"])
def login():

    # Already logged in
    if session.get("logged_in"):
        return redirect(url_for("index"))

    next_url = request.args.get("next") or request.form.get("next") or url_for("index")
    error = None

    if request.method == "POST":

        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        # Authenticate from database
        user = check_login(email, password) if email else None

        if user:

            # Flask session
            session.permanent = True
            session["logged_in"] = True
            session["username"] = user["username"]
            session["email"] = user["email"]
            session["user_id"] = user["id"]
            session["is_admin"] = bool(user.get("is_admin", False))

            # Generate unique session ID
            session_uuid = str(uuid.uuid4())
            session["session_id"] = session_uuid

            # Session expires in 45 minutes
            expires_at = datetime.now() + timedelta(minutes=45)

            # Save session in database
            create_user_session(
                user_id=user["id"],
                session_id=session_uuid,
                expires_at=expires_at,
                ip_address=request.remote_addr,
                user_agent=request.headers.get("User-Agent")
            )

            return redirect(next_url)

        # Admin fallback login
        elif password == ADMIN_PASSWORD:

            session.permanent = True
            session["logged_in"] = True
            session["username"] = "admin"
            session["user_id"] = 0
            session["is_admin"] = True

            session_uuid = str(uuid.uuid4())
            session["session_id"] = session_uuid

            expires_at = datetime.now() + timedelta(minutes=45)

            create_user_session(
                user_id=0,
                session_id=session_uuid,
                expires_at=expires_at,
                ip_address=request.remote_addr,
                user_agent=request.headers.get("User-Agent")
            )

            return redirect(next_url)

        error = "Invalid credentials. Please try again."
        flash(error)

    return render_template(
        "login_main.html",
        error=error,
        next_url=next_url
    )

@app.route("/logout")
def logout():
    # 1. Retrieve current session_id before clearing
    session_id = session.get("session_id")
    
    # 2. Invalidate session in the database
    if session_id:
        invalidate_user_session(session_id)
    
    # 3. Clear session cookies and redirect
    session.clear()
    return redirect(url_for("login"))

# --------------------------------------------------------------------------
# Landing Page + Main Dashboard (Protected with @login_required)
# --------------------------------------------------------------------------

@app.route("/")
@login_required  # CHANGE 2: Protected main page
def index():
    """Landing page: pick which MATOC to view."""
    return render_template("index.html", matocs=get_matocs(), is_admin=is_admin())


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
    """Shows every row/column for this MATOC, including linked award info."""
    check_slug(slug)

    # Use the new joined function instead of load_raw_dataframe
    df = load_raw_dataframe_with_awards(slug)

    # Automatically includes the new columns in the grid
    columns = list(df.columns)
    columns.remove("id")  # Hide internal DB ID from grid header

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


@app.route("/dashboard/<slug>/data/pull-latest", methods=["POST"])
@admin_required
def pull_latest(slug):
    """Kicks off a background pull of the latest USAspending.gov data for
    every Task Order ID in THIS MATOC's table. Polled by /pull-status."""
    check_slug(slug)
    if pull_pipeline.is_running():
        return jsonify({
            "ok": False,
            "message": f"A pull is already running ({pull_pipeline.PROGRESS.get('matoc_label')})."
        }), 409

    thread = threading.Thread(target=pull_pipeline.run_pull_job, args=(slug,), daemon=True)
    thread.start()
    return jsonify({"ok": True, "message": "Pull started."})


@app.route("/dashboard/<slug>/data/pull-status")
@login_required
def pull_status(slug):
    """Polled from the Raw Data page to show live progress of a pull job."""
    check_slug(slug)
    return jsonify(pull_pipeline.PROGRESS)


@app.route("/dashboard/<slug>/data/export")
@login_required
def export_raw_data(slug):
    """Download the raw table as an .xlsx file."""
    check_slug(slug)
    matoc_label = get_matocs()[slug]
    df = load_raw_dataframe_with_awards(slug).drop(columns=["id"], errors="ignore")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=matoc_label[:31])
        ws = writer.sheets[matoc_label[:31]]
        n_rows = len(df)
        n_cols = len(df.columns)

        # Wrap text on the multi-line "Modifications & Values" column so each
        # modification shows on its own line instead of one long squashed row.
        if "Modifications & Values" in df.columns:
            col_idx = list(df.columns).index("Modifications & Values") + 1  # 1-based, +header offset not needed (openpyxl is 1-based already)
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = 40
            for row_num in range(2, n_rows + 2):  # skip header row
                cell = ws[f"{col_letter}{row_num}"]
                cell.alignment = Alignment(wrap_text=True, vertical="top")

        # Figure out which column positions (1-based) hold dollar values so
        # we can give them a proper US-style "#,##0.00" number format.
        currency_col_idx = {
            i + 1 for i, col in enumerate(df.columns)
            if str(col).strip().lower() in CURRENCY_COLUMNS
        }

        # Apply currency formatting + a thin border to every cell (header
        # and data, all columns) so the sheet looks like a real table.
        for row_num in range(1, n_rows + 2):
            for col_num in range(1, n_cols + 1):
                cell = ws.cell(row=row_num, column=col_num)
                cell.border = THIN_BORDER
                if row_num > 1 and col_num in currency_col_idx:
                    cell.number_format = "#,##0.00"

        # Reasonable default column widths (skip the one we already sized).
        for i, col in enumerate(df.columns, start=1):
            col_letter = get_column_letter(i)
            if col == "Modifications & Values":
                continue
            header_len = len(str(col))
            ws.column_dimensions[col_letter].width = max(12, min(30, header_len + 4))
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
        derived = update_cell(slug, row_id, column, value)
        return {"ok": True, "derived": derived}
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


@app.route("/dashboard/<slug>/modifications")
@login_required
def modification_intelligence(slug):
    """Detail page on post-award MODIFICATIONS: every modification row pulled
    from USAspending (via award_master/award_modifications), not just the
    single 'Mods' dollar figure from the spreadsheet. This is what CEO-level
    questions like 'why did this contract balloon' actually need."""
    check_slug(slug)
    matoc_label = get_matocs()[slug]

    df = get_modification_dataframe(slug)

    if df.empty:
        return render_template(
            "modification_intelligence.html",
            slug=slug,
            matoc_label=matoc_label,
            has_data=False,
            stats=None,
            timeline_chart=None,
            project_chart=None,
            award_chart=None,
            count_chart=None,
            detail=[],
        )

    total_mods = len(df)
    total_mod_value = float(df["Mod Value"].sum())
    awards_with_mods = df["Award/PIID"].nunique()
    avg_mod_value = float(df["Mod Value"].mean()) if total_mods else 0.0

    largest = df.loc[df["Mod Value"].idxmax()]
    stats = {
        "total_mods": total_mods,
        "total_mod_value": total_mod_value,
        "awards_with_mods": awards_with_mods,
        "avg_mod_value": avg_mod_value,
        "largest_mod_value": float(largest["Mod Value"]),
        "largest_mod_award": largest["Award/PIID"],
        "largest_mod_awardee": largest["Awardee"],
    }

    timeline_chart = build_mods_timeline_chart(df)
    project_chart = build_mods_by_project_type_chart(df)
    award_chart = build_mods_by_award_chart(df)
    count_chart = build_mods_count_by_award_chart(df)

    detail_df = df.sort_values("Action Date", ascending=False).copy()
    detail_df["Action Date"] = detail_df["Action Date"].dt.strftime("%Y-%m-%d")
    detail_df["Action Date"] = detail_df["Action Date"].fillna("")
    detail = detail_df.to_dict("records")

    return render_template(
        "modification_intelligence.html",
        slug=slug,
        matoc_label=matoc_label,
        has_data=True,
        stats=stats,
        timeline_chart=timeline_chart,
        project_chart=project_chart,
        award_chart=award_chart,
        count_chart=count_chart,
        detail=detail,
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

@app.template_filter('usd')
def usd_format(value, col_name=""):
    if value is None or value == "":
        return ""
    
    # Skip non-currency columns
    col = str(col_name).lower().trim()
    if col in ['year'] or 'id' in col or 'number of offers' in col:
        return value

    try:
        # Convert to float and format with commas and 2 decimals
        num = float(str(value).replace(',', '').replace('$', '').strip())
        return f"{num:,.2f}"
    except (ValueError, TypeError):
        return value

@app.template_filter('format_currency')
def format_currency(value):
    if value is None or value == '':
        return ''
    try:
        # Strip existing commas or dollar signs if present
        clean_val = str(value).replace(',', '').replace('$', '').strip()
        val_float = float(clean_val)
        return f"{val_float:,.2f}"
    except (ValueError, TypeError):
        return value 

@app.route("/dashboard/<slug>/data/create", methods=["POST"])
@admin_required
def create_data_row(slug):
    """Creates a new row in the database when a user fills in an empty auto-scrolled cell."""
    check_slug(slug)
    payload = request.get_json(force=True)
    column = payload.get("column")
    value = payload.get("value", "")

    try:
        # Create blank record in DB
        new_id = create_blank_row(slug) 

        # Update the target cell for the new row
        derived = update_cell(slug, new_id, column, value)
        
        return jsonify({"ok": True, "new_id": new_id, "derived": derived})
    except Exception as e:
        # Prints exact database/python trace in your terminal console
        print(f"Error creating data row: {e}")
        return jsonify({"ok": False, "error": str(e)}), 400
# --------------------------------------------------------------------------
# Application Entry Point
# --------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)