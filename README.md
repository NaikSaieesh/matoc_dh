# Contract Intelligence Dashboard (Flask + MySQL/WAMP)

A small web app: a landing page lets you pick a MATOC (**FRR**, **NAVFAC ME**,
**NAVFAC GU**), and each one opens a Plotly dashboard. Each MATOC now has its
**own separate table** in the database, and every dashboard has three extra
buttons at the top:

- **Download Dashboard** - saves the whole rendered dashboard (KPIs, charts,
  tables) as one `.html` file you can open in any browser or email around.
- **View Raw Data (Excel view)** - opens a spreadsheet-style page with every
  row/column, searchable and sortable like Excel.
- **Admin Login** - once logged in, the raw data page becomes editable
  (click a cell to change it) and shows an **import box** to upload a new/
  updated Excel file straight from the browser.

## Files

```
navfac_dashboard/
  app.py            Flask app: dashboard, raw-data view, admin login, import/export routes
  db.py             MySQL connection + per-MATOC table queries + upsert (no-duplicate) import logic
  charts.py         All chart-building logic (adapted from your Colab script)
  import_data.py    Command-line import tool (same upsert logic as the web import box)
  schema.sql        Creates the database + one table PER MATOC
  templates/
    index.html      MATOC picker landing page
    raw_data.html    Excel-style raw data / edit / import page
    login.html      Admin login page
  requirements.txt
```

## 1. Start WAMP

Start WampServer so Apache + MySQL are running (icon turns green). You don't
need Apache for this - Flask runs its own server - but MySQL needs to be up.

## 2. Create the database

Open **phpMyAdmin** (http://localhost/phpmyadmin) -> SQL tab -> paste the
contents of `schema.sql` and run it. This creates a `bid_intel` database with
**three separate tables**: `bids_frr`, `bids_navfac_me`, `bids_navfac_gu` -
one per MATOC, as requested, instead of one shared table.

Each table has a `UNIQUE KEY` on `folder_number` (Excel column 1, "Folder
Number"). That's the key used everywhere in this app to avoid duplicate
rows - see "How duplicate-free importing works" below.

> Already had the old single `bids` table from a previous version? There's a
> commented-out migration `INSERT ... SELECT` at the bottom of `schema.sql`
> to move your existing rows into the 3 new tables.

## 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

## 4. Configure the DB connection (if needed)

`db.py` defaults to WAMP's typical settings: host `localhost`, user `root`,
password `""` (empty), database `bid_intel`, port `3306`. If yours differ,
either edit `DB_CONFIG` in `db.py`, or set environment variables before
running anything:

```bash
set DB_PASSWORD=yourpassword   (Windows cmd)
$env:DB_PASSWORD="yourpassword"  (PowerShell)
```

## 5. Set the admin password

The "Admin Login" button on every dashboard/data page checks against a
password. It defaults to `admin123` - **change this** by setting an
environment variable before running the app:

```bash
set ADMIN_PASSWORD=your-real-password   (Windows cmd)
$env:ADMIN_PASSWORD="your-real-password"  (PowerShell)
```

Also set `SECRET_KEY` to any random string in the same way for production use
(it's what keeps your admin login session secure); it defaults to a
development-only value otherwise.

## 6. Import your bid data

**Option A - from the command line**, once per MATOC:

```bash
python import_data.py --file "FRR_Analysis.xlsx" --matoc frr
python import_data.py --file "NAVFAC_ME_Analysis.xlsx" --matoc navfac-me
python import_data.py --file "NAVFAC_GU_Analysis.xlsx" --matoc navfac-gu
```

**Option B - from the website** (no command line needed): open a MATOC's
dashboard -> **View Raw Data** -> **Admin Login** -> use the "Import /
refresh data from Excel" box to upload the `.xlsx` file directly.

### How duplicate-free importing works

Every import (CLI or web) is matched on **Folder Number** (Excel column 1):

| Situation | What happens |
|---|---|
| Folder Number not seen before | Row is **inserted** as new |
| Folder Number already exists, and every value in the row is identical | Row is **left alone** (no-op) |
| Folder Number already exists, but one or more values changed | The existing row is **updated/replaced** with the new values |
| Row has no Folder Number | **Skipped** |

So you can re-run the same file, or upload a partially-updated version of
it, as many times as you like - it will never create duplicate rows, and
any cell you or someone else changed in Excel will overwrite the old value
in the database automatically.

## 7. Run the site

```bash
python app.py
```

Open **http://127.0.0.1:5000** - you'll see the 3 MATOC cards. Click one to
load its dashboard. From there:

- **Download Dashboard** downloads the full dashboard as an `.html` file.
- **View Raw Data** shows every row in a searchable/sortable Excel-style
  table, with a **Download as Excel (.xlsx)** link.
- **Admin Login** (default password `admin123`, change it - see step 5)
  unlocks inline cell editing (click a cell, edit, click away to save),
  row deletion, and the Excel import box.

## Notes / things you can change

- **MATOC list / tables**: edit the `MATOCS` and `TABLES` dicts in `db.py`
  if you ever add/rename a MATOC or its table name.
- **Column mapping**: if a future Excel file uses slightly different column
  names, adjust `COLUMN_MAP` in `db.py` (used by both the CLI importer and
  the web import box).
- **Dedup/update key**: currently `folder_number`. Change `KEY_COL` in
  `db.py` (and the `UNIQUE KEY` in `schema.sql`) if you'd rather match rows
  on a different column, e.g. RFP Number or Award ID.
- **No data yet**: if you open a dashboard for a MATOC with no imported rows,
  it will say so instead of erroring.
- The dashboard/data routes query MySQL fresh every time they're opened - no
  caching - so any import or edit shows up immediately on refresh.
