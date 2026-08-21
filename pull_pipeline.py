import time
import traceback

import usaspending_api
from db import get_connection, table_for, get_matocs

DELAY_BETWEEN_AWARDS_SECONDS = 1.5

# Shared progress state that /dashboard/<slug>/pull-status reads.
# Only one pull job runs at a time across the whole app.
PROGRESS = {
    "running": False,
    "slug": None,
    "matoc_label": None,
    "total": 0,
    "completed": 0,
    "current_piid": None,
    "last_message": "Idle",
    "errors": [],
}

def is_running():
    return PROGRESS["running"]


def _init_award_tables(conn):
    """Creates award_master / award_modifications if they don't exist yet.
    Safe to call every time - matches the schema matoc_dh already reads from."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS award_master (
            id SERIAL PRIMARY KEY,
            piid VARCHAR(150) NOT NULL UNIQUE,
            generated_internal_id VARCHAR(150),
            description TEXT,
            recipient_name VARCHAR(255),
            total_obligation DECIMAL(18,2),
            base_exercised_options DECIMAL(18,2),
            base_and_all_options DECIMAL(18,2),
            status VARCHAR(30) DEFAULT 'pending',
            fetched_at TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS award_modifications (
            id SERIAL PRIMARY KEY,
            award_master_id INT NOT NULL,
            modification_number VARCHAR(50),
            action_date DATE NULL,
            description TEXT,
            federal_action_obligation DECIMAL(18,2),
            FOREIGN KEY (award_master_id)
                REFERENCES award_master(id)
                ON DELETE CASCADE
        )
    """)
    conn.commit()
    cur.close()


def _task_order_ids_for_slug(slug):
    """Distinct, non-empty award_id values from THIS MATOC's table only."""
    table = table_for(slug)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f'SELECT DISTINCT award_id FROM "{table}" '
            f"WHERE award_id IS NOT NULL AND award_id != ''"
        )
        rows = cur.fetchall()
        cur.close()
        return [r[0].strip() for r in rows if r[0]]
    finally:
        conn.close()


def _upsert_award_not_found(conn, piid):
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO award_master (piid, status, fetched_at)
        VALUES (%s, 'not_found', CURRENT_TIMESTAMP)
        ON CONFLICT (piid) DO UPDATE SET
            status = 'not_found',
            fetched_at = CURRENT_TIMESTAMP
    """, (piid,))
    conn.commit()
    cur.close()


def _save_award_data(conn, data):
    """Insert/update award_master + rewrite its modification rows."""
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO award_master
            (piid, generated_internal_id, description, recipient_name,
             total_obligation, base_exercised_options, base_and_all_options,
             status, fetched_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'done', CURRENT_TIMESTAMP)
        ON CONFLICT (piid) DO UPDATE SET
            generated_internal_id = EXCLUDED.generated_internal_id,
            description = EXCLUDED.description,
            recipient_name = EXCLUDED.recipient_name,
            total_obligation = EXCLUDED.total_obligation,
            base_exercised_options = EXCLUDED.base_exercised_options,
            base_and_all_options = EXCLUDED.base_and_all_options,
            status = 'done',
            fetched_at = CURRENT_TIMESTAMP
    """, (
        data["piid"],
        data["generated_internal_id"],
        data["description"],
        data["recipient_name"],
        data["total_obligation"],
        data["base_exercised_options"],
        data["base_and_all_options"],
    ))

    cur.execute("SELECT id FROM award_master WHERE piid = %s", (data["piid"],))
    award_master_id = cur.fetchone()[0]

    cur.execute(
        "DELETE FROM award_modifications WHERE award_master_id = %s",
        (award_master_id,),
    )
    for mod in data["modifications"]:
        cur.execute("""
            INSERT INTO award_modifications
                (award_master_id, modification_number, action_date,
                 description, federal_action_obligation)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            award_master_id,
            mod.get("modification_number"),
            mod.get("action_date") or None,
            mod.get("description"),
            mod.get("federal_action_obligation"),
        ))

    conn.commit()
    cur.close()


def run_pull_job(slug):
    """Main entry point: pulls the latest USAspending.gov data for every
    task order in one MATOC's table. Safe to call in a background thread."""
    if PROGRESS["running"]:
        return  # a pull is already running (for this or another MATOC)

    matoc_label = get_matocs().get(slug, slug)

    PROGRESS.update({
        "running": True,
        "slug": slug,
        "matoc_label": matoc_label,
        "total": 0,
        "completed": 0,
        "current_piid": None,
        "last_message": "Starting...",
        "errors": [],
    })

    try:
        setup_conn = get_connection()
        try:
            _init_award_tables(setup_conn)
        finally:
            setup_conn.close()

        task_orders = _task_order_ids_for_slug(slug)
        PROGRESS["total"] = len(task_orders)
        PROGRESS["last_message"] = f"Found {len(task_orders)} task order(s) in {matoc_label}"

        for piid in task_orders:
            PROGRESS["current_piid"] = piid
            PROGRESS["last_message"] = f"Fetching {piid}..."

            conn = get_connection()
            try:
                try:
                    data = usaspending_api.fetch_award_data(piid)
                    if data is None:
                        _upsert_award_not_found(conn, piid)
                        PROGRESS["last_message"] = f"{piid}: not found on USAspending.gov"
                    else:
                        _save_award_data(conn, data)
                        PROGRESS["last_message"] = f"{piid}: saved"
                except Exception as exc:
                    # Don't let one bad award kill the whole run - log it and move on.
                    error_msg = f"{piid}: {exc}"
                    PROGRESS["errors"].append(error_msg)
                    PROGRESS["last_message"] = f"{piid}: ERROR - see errors list"
                    traceback.print_exc()
            finally:
                conn.close()

            PROGRESS["completed"] += 1
            time.sleep(DELAY_BETWEEN_AWARDS_SECONDS)

        PROGRESS["last_message"] = f"Completed - {matoc_label} is up to date."

    except Exception as exc:
        PROGRESS["errors"].append(f"Fatal error: {exc}")
        PROGRESS["last_message"] = "Stopped due to a fatal error"
        traceback.print_exc()

    finally:
        PROGRESS["running"] = False
        PROGRESS["current_piid"] = None