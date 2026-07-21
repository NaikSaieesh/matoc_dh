"""
Import a bid-tracking Excel file into the WAMP MySQL database, into that
MATOC's own table (bids_frr / bids_navfac_me / bids_navfac_gu).

This is a safe, repeatable import: it's keyed on "Folder Number" (Excel
column 1), so running it again - even with an updated version of the same
file - will NOT create duplicate rows. For every row:
  - new Folder Number                    -> inserted
  - existing Folder Number, same values  -> left alone
  - existing Folder Number, some changed -> that row's values are replaced

Usage:
    python import_data.py --file "FRR_Analysis.xlsx" --matoc frr
    python import_data.py --file "NAVFAC_ME_Analysis.xlsx" --matoc navfac-me
    python import_data.py --file "NAVFAC_GU_Analysis.xlsx" --matoc navfac-gu

Optional --sheet lets you pick a specific sheet name if the workbook has more
than one (defaults to the first sheet).

Run schema.sql once beforehand (in phpMyAdmin or the mysql CLI) to create the
database and the 3 tables before running this script.

(You can also import through the website itself now - open a dashboard,
click "View Raw Data", log in as admin, and use the upload box there.)
"""
import argparse
import pandas as pd
from db import upsert_dataframe, get_tables


def main():
    tables = get_tables()
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="Path to the .xlsx file")
    ap.add_argument("--matoc", required=True, choices=sorted(tables.keys()),
                     help="MATOC slug - run with --help to see current options")
    ap.add_argument("--sheet", default=0, help="Sheet name or index (default: first sheet)")
    args = ap.parse_args()

    df = pd.read_excel(args.file, sheet_name=args.sheet)
    stats = upsert_dataframe(args.matoc, df)

    print(
        f"Import into '{tables[args.matoc]}' from '{args.file}' complete:\n"
        f"  inserted (new Folder Number):   {stats['inserted']}\n"
        f"  updated  (values changed):      {stats['updated']}\n"
        f"  unchanged (already up to date): {stats['unchanged']}\n"
        f"  skipped  (missing Folder Number): {stats['skipped']}"
    )


if __name__ == "__main__":
    main()
