"""
Database connection helper for Supabase (PostgreSQL).

Default PostgreSQL settings use host, user, password, and database from 
environment variables or fallback defaults.

Each MATOC has its OWN physical table (bids_frr, bids_navfac_me,
bids_navfac_gu) registered in `matoc_config`. Tables enforce a UNIQUE constraint 
on `folder_number` (Excel column 1) to avoid duplicate rows during imports.
"""
import os
import uuid
import re
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
from flask import session, request

load_dotenv()

DB_CONFIG = {
    "host":     os.environ.get("DB_HOST", "localhost"),
    "user":     os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": os.environ.get("DB_NAME", "postgres"),
    "port":     int(os.environ.get("DB_PORT", 5432)),
}

# --------------------------------------------------------------------------
# MATOC registry
# --------------------------------------------------------------------------
_SEED_MATOCS = {
    "frr":            ("FRR",           "bids_frr"),
    "navfac-me":      ("NAVFAC ME",     "bids_navfac_me"),
    "navfac-gu":      ("NAVFAC GU",     "bids_navfac_gu"),
    "nih":            ("NIH MACC",      "bids_nih"),
    "usda-mep":       ("USDA MEP",      "bids_usda_mep"),
    "usace-dha-areli":("USACE DHA ARELI", "bids_usace_dha_areli"),
    "usace-dha-2a":   ("USACE DHA 2A",    "bids_usace_dha_2a"),
    "micc-ft-drum":   ("MICC FT DRUM",    "bids_micc_ft_drum"),
    "usag-hi":        ("USAG HI",         "bids_usag_hi"),
}

_BID_TABLE_DDL = """
    id                          SERIAL PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL UNIQUE,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              NUMERIC(15,2) DEFAULT 0,
    addon_bid                   NUMERIC(15,2) DEFAULT 0,
    asterisk_bid                VARCHAR(10),
    winner_price_diff_usd       NUMERIC(15,2) DEFAULT 0,
    winner_price_diff_pct       NUMERIC(10,4) DEFAULT 0,
    number_of_offers_received   INTEGER DEFAULT 0,
    result                      VARCHAR(20),
    mods                        NUMERIC(15,2) DEFAULT 0,
    total                       NUMERIC(15,2) DEFAULT 0,
    created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP NULL
"""

def _ensure_registry_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS matoc_config (
            slug        VARCHAR(64) PRIMARY KEY,
            label       VARCHAR(150) NOT NULL,
            table_name  VARCHAR(64)  NOT NULL UNIQUE,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("SELECT COUNT(*) FROM matoc_config")
    (count,) = cur.fetchone()
    if count == 0:
        for slug, (label, table_name) in _SEED_MATOCS.items():
            cur.execute(
                """
                INSERT INTO matoc_config (slug, label, table_name) 
                VALUES (%s, %s, %s)
                ON CONFLICT (slug) DO NOTHING
                """,
                (slug, label, table_name),
            )
    conn.commit()
    cur.close()

# --------------------------------------------------------------------------
# User & Auth Helpers
# --------------------------------------------------------------------------

def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def get_user_by_username(username):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute('SELECT * FROM users WHERE username = %s', (username,))
            return cursor.fetchone()
    finally:
        conn.close()


def get_user_by_id(user_id):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute('SELECT * FROM users WHERE id = %s', (user_id,))
            return cursor.fetchone()
    finally:
        conn.close()


def get_user_by_email(email):
    """Checks if an email already exists in the database."""
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT id, username FROM users WHERE email = %s", (email,))
            return cursor.fetchone()
    finally:
        conn.close()


def create_user(username, password):
    hashed_password = generate_password_hash(password)
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                'INSERT INTO users (username, password) VALUES (%s, %s)',
                (username, hashed_password)
            )
            conn.commit()
    finally:
        conn.close()


def register_user(username, hashed_password, email=None):
    """Inserts a new (already-verified) user and returns their generated ID."""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (username, password, email) VALUES (%s, %s, %s) RETURNING id",
                (username, hashed_password, email)
            )
            user_id = cursor.fetchone()[0]
            conn.commit()
            return user_id
    except Exception as e:
        print(f"Registration Error: {e}")
        return None
    finally:
        conn.close()


def check_login(email_or_username, password):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                "SELECT * FROM users WHERE email = %s OR username = %s",
                (email_or_username.strip().lower(), email_or_username.strip())
            )
            user = cursor.fetchone()

            if user and check_password_hash(user["password"], password):
                return user
            return None
    finally:
        conn.close()


def create_user_session(user_id, session_id, expires_at, ip_address, user_agent):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO user_sessions
        (user_id, session_id, login_time, last_activity,
         expires_at, ip_address, user_agent, is_active)
        VALUES (%s, %s, NOW(), NOW(), %s, %s, %s, TRUE)
    """, (
        user_id,
        session_id,
        expires_at,
        ip_address,
        user_agent
    ))

    conn.commit()
    cursor.close()
    conn.close()


def invalidate_user_session(session_id):
    """Deactivates a user session in the database upon logout."""
    if not session_id:
        return
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE user_sessions
        SET is_active = FALSE, expires_at = NOW()
        WHERE session_id = %s
    """, (session_id,))
    conn.commit()
    cursor.close()
    conn.close()


def is_session_active(session_id):
    """Check if the session_id exists, is marked active, and has not expired."""
    if not session_id:
        return False
        
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT id FROM user_sessions
                WHERE session_id = %s 
                  AND is_active = TRUE 
                  AND expires_at > NOW()
            """, (session_id,))
            session_record = cursor.fetchone()
            return bool(session_record)
    finally:
        conn.close()


def handle_user_session(user):
    """
    Sets up Flask session keys and persists session record to DB.
    Call this inside your login route after successful verification.
    """
    session.permanent = True
    session["user_id"] = user["id"]
    session["username"] = user["username"]

    session_uuid = str(uuid.uuid4())
    session["session_id"] = session_uuid

    expires_at = datetime.now() + timedelta(minutes=45)

    create_user_session(
        user_id=user["id"],
        session_id=session_uuid,
        expires_at=expires_at,
        ip_address=request.remote_addr,
        user_agent=request.headers.get("User-Agent")
    )


def _load_registry() -> dict:
    """Returns {slug: (label, table_name)} straight from the database."""
    conn = get_connection()
    _ensure_registry_table(conn)
    cur = conn.cursor()
    cur.execute("SELECT slug, label, table_name FROM matoc_config ORDER BY label")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {slug: (label, table_name) for slug, label, table_name in rows}


def get_matocs() -> dict:
    """{slug: label} - use this anywhere the old MATOCS dict was used."""
    return {slug: label for slug, (label, _t) in _load_registry().items()}


def get_tables() -> dict:
    """{slug: table_name} - use this anywhere the old TABLES dict was used."""
    return {slug: table for slug, (_l, table) in _load_registry().items()}


def _slugify(label: str) -> str:
    s = label.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "matoc"


def create_matoc(label: str) -> str:
    """Add a brand-new MATOC: makes a slug + table name from the label,
    creates the physical table, registers it, and returns the new slug."""
    label = (label or "").strip()
    if not label:
        raise ValueError("Label is required.")

    registry = _load_registry()
    base_slug = _slugify(label)
    slug = base_slug
    i = 2
    while slug in registry:
        slug = f"{base_slug}-{i}"
        i += 1
    table_name = "bids_" + slug.replace("-", "_")

    conn = get_connection()
    _ensure_registry_table(conn)
    cur = conn.cursor()
    cur.execute(f'CREATE TABLE IF NOT EXISTS "{table_name}" ({_BID_TABLE_DDL})')
    cur.execute(
        "INSERT INTO matoc_config (slug, label, table_name) VALUES (%s, %s, %s)",
        (slug, label, table_name),
    )
    conn.commit()
    cur.close()
    conn.close()
    return slug


def truncate_matoc_table(slug: str):
    """Wipes every row for one MATOC but keeps the table and registry entry."""
    table = table_for(slug)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f'TRUNCATE TABLE "{table}"')
    conn.commit()
    cur.close()
    conn.close()


def delete_matoc(slug: str):
    """Removes a MATOC entirely: drops physical table AND removes from config."""
    registry = _load_registry()
    if slug not in registry:
        raise KeyError(f"Unknown MATOC slug '{slug}'")
    _label, table = registry[slug]
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f'DROP TABLE IF EXISTS "{table}"')
    cur.execute("DELETE FROM matoc_config WHERE slug = %s", (slug,))
    conn.commit()
    cur.close()
    conn.close()


COLUMN_MAP = {
    "Folder Number":               "folder_number",
    "8(a) or R":                  "eight_a_or_r",
    "Year":                       "year",
    "RFP Number":                  "rfp_number",
    "Task Order ID":              "award_id",
    "Title":                      "title",
    "Project Type":               "project_type",
    "Awardee":                    "awardee",
    "Contract Value":              "contract_value",
    "Addon Bid":                  "addon_bid",
    "Asterisk Bid":               "asterisk_bid",
    "Winner Price Difference $":  "winner_price_diff_usd",
    "Winner Price Difference %":  "winner_price_diff_pct",
    "Number of Offers Received":  "number_of_offers_received",
    "Result":                     "result",
    "Mods":                       "mods",
    "Total":                      "total",
}

DB_TO_LABEL = {v: k for k, v in COLUMN_MAP.items()}

NUMERIC_COLS = [
    "contract_value", "addon_bid", "winner_price_diff_usd",
    "winner_price_diff_pct", "number_of_offers_received", "mods", "total",
]

KEY_COL = "folder_number"

DERIVED_TRIGGER_COLS = {"contract_value", "addon_bid", "mods"}


def _calc_derived(contract_value, addon_bid, mods):
    """Given the 3 raw inputs, returns (winner_price_diff_usd,
    winner_price_diff_pct, total). Guards against divide-by-zero when
    Contract Value is 0/empty."""
    contract_value = float(contract_value or 0)
    addon_bid = float(addon_bid or 0)
    mods = float(mods or 0)

    diff_usd = addon_bid - contract_value
    diff_pct = (diff_usd / contract_value * 100) if contract_value else 0.0
    total = contract_value + mods

    return diff_usd, diff_pct, total


def table_for(slug: str) -> str:
    tables = get_tables()
    if slug not in tables:
        raise KeyError(f"Unknown MATOC slug '{slug}'")
    return tables[slug]


def load_raw_dataframe_with_awards(matoc_slug: str) -> pd.DataFrame:
    """Loads raw bid data joined with the award_master and award_modifications 
    tables from the external database using 'award_id' == 'piid'.
    """
    table = table_for(matoc_slug)
    conn = get_connection()

    unique_cols = list(dict.fromkeys(COLUMN_MAP.values()))
    bids_cols_sql = ", ".join(f'b."{db}"' for db in unique_cols)

    query = f"""
        SELECT 
            b.id,
            {bids_cols_sql},
            am.piid                                             AS "Task Order/PIID",
            am.recipient_name                                   AS "Recipient",
            am.total_obligation                                 AS "Obligation",
            am.base_and_all_options                             AS "Base & Options",
            am.base_exercised_options                           AS "Base & Exercised",
            am.status                                           AS "Status",
            COALESCE(
                STRING_AGG(
                    CONCAT(
                        COALESCE(m.modification_number, 'Mod'), 
                        ': $', 
                        TO_CHAR(COALESCE(m.federal_action_obligation, 0), 'FM999,999,999,990.00')
                    ), 
                    E'\n'
                ), 
                'None'
            )                                                   AS "Modifications & Values",
            COALESCE(SUM(m.federal_action_obligation), 0)       AS "Linked Mods Total"
        FROM "{table}" b
        LEFT JOIN award_master am 
            ON TRIM(b.award_id) = TRIM(am.piid)
        LEFT JOIN award_modifications m 
            ON am.id = m.award_master_id
        GROUP BY b.id, am.id, am.piid, am.recipient_name, am.total_obligation, am.base_and_all_options, am.base_exercised_options, am.status
        ORDER BY b.id
    """

    df = pd.read_sql(query, conn)
    conn.close()

    df = df.rename(columns=DB_TO_LABEL)
    return df


def load_matoc_dataframe(matoc_slug: str) -> pd.DataFrame:
    table = table_for(matoc_slug)
    conn = get_connection()
    query = f"""
        SELECT
            year                        AS "Year",
            project_type                AS "Project Type",
            awardee                     AS "Awardee",
            contract_value              AS "Contract Value",
            addon_bid                   AS "Addon Bid",
            asterisk_bid                AS "Asterisk Bid",
            winner_price_diff_usd       AS "Winner Price Difference $",
            winner_price_diff_pct       AS "Winner Price Difference %",
            number_of_offers_received   AS "Number of Offers Received",
            result                      AS "Result",
            mods                        AS "Mods",
            total                       AS "Total"
        FROM "{table}"
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df


def load_raw_dataframe(matoc_slug: str) -> pd.DataFrame:
    table = table_for(matoc_slug)
    conn = get_connection()
    unique_cols = list(dict.fromkeys(COLUMN_MAP.values()))
    cols_sql = ", ".join(f'"{db}"' for db in unique_cols)
    query = f'SELECT id, {cols_sql} FROM "{table}" ORDER BY id'
    df = pd.read_sql(query, conn)
    conn.close()
    df = df.rename(columns=DB_TO_LABEL)
    return df


def update_cell(matoc_slug: str, row_id: int, column_label: str, value: str):
    table = table_for(matoc_slug)
    if column_label not in COLUMN_MAP:
        raise ValueError(f"Unknown column '{column_label}'")
    db_col = COLUMN_MAP[column_label]

    if db_col in NUMERIC_COLS:
        value = pd.to_numeric(value, errors="coerce")
        if pd.isna(value):
            value = 0

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f'UPDATE "{table}" SET "{db_col}" = %s WHERE id = %s', (value, row_id))

    derived = None
    if db_col in DERIVED_TRIGGER_COLS:
        cur.execute(
            f'SELECT contract_value, addon_bid, mods FROM "{table}" WHERE id = %s',
            (row_id,),
        )
        contract_value, addon_bid, mods = cur.fetchone()
        diff_usd, diff_pct, total = _calc_derived(contract_value, addon_bid, mods)
        cur.execute(
            f'UPDATE "{table}" SET winner_price_diff_usd = %s, '
            f'winner_price_diff_pct = %s, total = %s WHERE id = %s',
            (diff_usd, diff_pct, total, row_id),
        )
        derived = {
            "Winner Price Difference $": diff_usd,
            "Winner Price Difference %": round(diff_pct, 2),
            "Total": total,
        }

    conn.commit()
    cur.close()
    conn.close()
    return derived


def _clean_import_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = (
        pd.Index(df.columns)
        .map(lambda x: str(x).strip() if pd.notna(x) else None)
    )

    df = df.loc[:, [c not in [None, "", "nan", "NaN"] for c in df.columns]]
    keep = {src: dst for src, dst in COLUMN_MAP.items() if src in df.columns}
    df = df[list(keep.keys())].rename(columns=keep)

    df = df.loc[:, [pd.notna(c) for c in df.columns]]
    df = df.loc[:, [str(c).lower() != "nan" for c in df.columns]]

    if df.columns.duplicated().any():
        deduped = {}
        for col in df.columns.unique():
            same = df.loc[:, [c == col for c in df.columns]]
            deduped[col] = same.bfill(axis=1).iloc[:, 0]
        df = pd.DataFrame(deduped)

    for col in NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    for col in ["year", "eight_a_or_r", "rfp_number", "award_id", "title",
                "project_type", "awardee", "result", "folder_number", "asterisk_bid"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace({"nan": ""})

    for col in ("contract_value", "addon_bid", "mods"):
        if col not in df.columns:
            df[col] = 0.0

    contract_value = df["contract_value"]
    addon_bid = df["addon_bid"]
    mods = df["mods"]

    diff_usd = addon_bid - contract_value
    diff_pct = np.where(contract_value != 0, (diff_usd / contract_value) * 100, 0.0)

    df["winner_price_diff_usd"] = diff_usd
    df["winner_price_diff_pct"] = np.round(diff_pct, 2)
    df["total"] = contract_value + mods

    return df


def upsert_dataframe(matoc_slug: str, df: pd.DataFrame) -> dict:
    table = table_for(matoc_slug)
    df = _clean_import_df(df)

    if KEY_COL not in df.columns:
        raise ValueError(
            "The uploaded file needs a 'Folder Number' column - it's used as "
            "the unique key to detect updates and avoid duplicate rows."
        )

    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "skipped": 0}

    conn = get_connection()
    cur = conn.cursor()

    db_cols = [
        c for c in df.columns
        if c != KEY_COL
        and pd.notna(c)
        and str(c).lower() != "nan"
    ]
    all_cols = [KEY_COL] + list(dict.fromkeys(db_cols))
    col_list_sql = ", ".join(f'"{c}"' for c in all_cols)
    placeholders = ", ".join(["%s"] * len(all_cols))
    
    update_assignments = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in db_cols)
    insert_sql = (
        f'INSERT INTO "{table}" ({col_list_sql}) VALUES ({placeholders}) '
        f'ON CONFLICT (folder_number) DO UPDATE SET {update_assignments}'
    )

    for row in df.itertuples(index=False, name=None):
        row_dict = dict(zip(df.columns, row))
        key_val = str(row_dict.get(KEY_COL, "")).strip()
        if not key_val or key_val.lower() == "nan":
            stats["skipped"] += 1
            continue

        values = [None if pd.isna(row_dict[c]) else row_dict[c] for c in all_cols]

        cur.execute(insert_sql, values)
        if cur.rowcount == 1:
            stats["inserted"] += 1
        else:
            stats["updated"] += 1

    conn.commit()
    cur.close()
    conn.close()
    return stats


def get_modification_dataframe(matoc_slug: str) -> pd.DataFrame:
    table = table_for(matoc_slug)
    conn = get_connection()
    query = f"""
        SELECT
            b.folder_number                     AS "Folder Number",
            b.award_id                          AS "Award/PIID",
            b.awardee                           AS "Awardee",
            b.project_type                      AS "Project Type",
            b.year                              AS "Year",
            am.total_obligation                 AS "Total Obligation",
            am.status                           AS "Award Status",
            m.modification_number               AS "Modification #",
            m.action_date                       AS "Action Date",
            m.description                       AS "Description",
            m.federal_action_obligation         AS "Mod Value"
        FROM "{table}" b
        INNER JOIN award_master am
            ON TRIM(b.award_id) = TRIM(am.piid)
        INNER JOIN award_modifications m
            ON am.id = m.award_master_id
        ORDER BY m.action_date DESC
    """
    df = pd.read_sql(query, conn)
    conn.close()

    if not df.empty:
        df["Mod Value"] = pd.to_numeric(df["Mod Value"], errors="coerce").fillna(0)
        df["Action Date"] = pd.to_datetime(df["Action Date"], errors="coerce")

    return df


def get_contractors(matoc_slug):
    table = table_for(matoc_slug)
    conn = get_connection()
    query = f"""
        SELECT DISTINCT awardee
        FROM "{table}"
        WHERE awardee IS NOT NULL
          AND awardee <> ''
        ORDER BY awardee
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df["awardee"].tolist()


def get_contractor_dataframe(matoc_slug, contractor):
    table = table_for(matoc_slug)
    conn = get_connection()
    query = f"""
        SELECT
            year AS "Year",
            project_type AS "Project Type",
            awardee AS "Awardee",
            contract_value AS "Contract Value",
            addon_bid AS "Addon Bid",
            asterisk_bid AS "Asterisk Bid",
            winner_price_diff_usd AS "Winner Price Difference $",
            winner_price_diff_pct AS "Winner Price Difference %",
            number_of_offers_received AS "Number of Offers Received",
            result AS "Result",
            mods AS "Mods",
            total AS "Total"
        FROM "{table}"
        WHERE awardee = %s
    """
    df = pd.read_sql(query, conn, params=(contractor,))
    conn.close()
    return df


def delete_row(matoc_slug: str, row_id: int):
    table = table_for(matoc_slug)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(f'DELETE FROM "{table}" WHERE id = %s', (row_id,))
    conn.commit()
    cur.close()
    conn.close()


def create_blank_row(slug):
    """Inserts a new empty row into the database table and returns its new ID."""
    table = table_for(slug)

    conn = get_connection()
    cursor = conn.cursor()
    
    temp_folder_num = f"NEW-{uuid.uuid4().hex[:8]}"
    
    cursor.execute(f'INSERT INTO "{table}" (folder_number) VALUES (%s) RETURNING id', (temp_folder_num,))
    new_id = cursor.fetchone()[0]
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return new_id