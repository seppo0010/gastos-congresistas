#!/usr/bin/env python3
"""
Search padron_index.db by name, CUIL, or DNI.

The query type is detected automatically:
  11 digits (dashes optional) → CUIL exact match
  7-8 digits                  → DNI (matches all CUILs containing that DNI)
  anything else               → full-text name search

Usage:
  python search_padron.py "GARCIA JUAN"
  python search_padron.py --exact "GARCIA JUAN CARLOS"
  python search_padron.py --any --limit 20 "RODRIGUEZ"
  python search_padron.py 20123456789
  python search_padron.py 20-12345678-9
  python search_padron.py 12345678

Options:
  --exact    Require all query tokens to match (FTS5 AND logic, default)
  --any      Match records containing any query token (FTS5 OR logic)
  --limit N  Max results to show (default: 10)
"""

import sqlite3
import sys

INDEX_FILE = "padron_index.db"

HEADER = f"{'CUIL':<13} {'NACIMIENTO':<12} {'S':<2} {'PROVINCIA':<35} {'FALLECIMIENTO':<14} NOMBRE / ACTIVIDAD"
DIVIDER = "-" * 120


def _print_rows(rows):
    print(HEADER)
    print(DIVIDER)
    for cuil, nombre, actividad, fecha_nac, sexo, provincia, fecha_fall in rows:
        print(
            f"{cuil:<13} "
            f"{(fecha_nac or ''):<12} "
            f"{(sexo or ''):<2} "
            f"{(provincia or ''):<35} "
            f"{(fecha_fall or ''):<14} "
            f"{nombre}"
        )
        if actividad:
            print(f"{'':13} {actividad}")


def search(query: str, mode: str = "exact", limit: int = 10):
    con = sqlite3.connect(INDEX_FILE)
    cur = con.cursor()

    tokens = query.upper().split()
    if not tokens:
        print("Empty query.", file=sys.stderr)
        return

    joiner = " AND " if mode == "exact" else " OR "
    fts_query = joiner.join(f'"{t}"' for t in tokens)

    cur.execute(
        """SELECT cuil, nombre, actividad, fecha_nacimiento, sexo, provincia, fecha_fallecimiento
           FROM padron_fts WHERE nombre MATCH ? LIMIT ?""",
        (fts_query, limit),
    )
    rows = cur.fetchall()

    if not rows:
        con.close()
        print("No results found.")
        return

    truncated = len(rows) == limit
    if truncated:
        cur.execute(
            "SELECT count(*) FROM padron_fts WHERE nombre MATCH ?",
            (fts_query,),
        )
        total = cur.fetchone()[0]

    con.close()
    _print_rows(rows)

    if truncated:
        print(f"\nShowing {limit} of {total:,} results. Use --limit to see more.")


def search_by_cuil(cuil_raw: str):
    cuil = cuil_raw.replace("-", "").replace(" ", "")
    if not cuil.isdigit() or len(cuil) != 11:
        print(f"Invalid CUIL '{cuil_raw}': must be 11 digits (dashes optional).", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(INDEX_FILE)
    cur = con.cursor()
    cur.execute(
        """SELECT cuil, nombre, actividad, fecha_nacimiento, sexo, provincia, fecha_fallecimiento
           FROM padron WHERE cuil = ?""",
        (cuil,),
    )
    rows = cur.fetchall()
    con.close()

    if not rows:
        print("No results found.")
        return
    _print_rows(rows)


def search_by_dni(dni_raw: str):
    dni = dni_raw.replace(".", "").replace(" ", "")
    if not dni.isdigit():
        print(f"Invalid DNI '{dni_raw}': must be numeric.", file=sys.stderr)
        sys.exit(1)
    dni = dni.zfill(8)  # CUIL stores DNI zero-padded to 8 digits

    con = sqlite3.connect(INDEX_FILE)
    cur = con.cursor()
    cur.execute(
        """SELECT cuil, nombre, actividad, fecha_nacimiento, sexo, provincia, fecha_fallecimiento
           FROM padron WHERE substr(cuil, 3, 8) = ?""",
        (dni,),
    )
    rows = cur.fetchall()
    con.close()

    if not rows:
        print("No results found.")
        return
    _print_rows(rows)


def _classify(query: str):
    """Return 'cuil', 'dni', or 'name'."""
    digits = query.replace("-", "").replace(".", "").replace(" ", "")
    if digits.isdigit():
        if len(digits) == 11:
            return "cuil"
        if len(digits) in (7, 8):
            return "dni"
    return "name"


def main():
    args = sys.argv[1:]
    mode = "exact"
    limit = 10

    filtered = []
    i = 0
    while i < len(args):
        if args[i] == "--exact":
            mode = "exact"
        elif args[i] == "--any":
            mode = "any"
        elif args[i] == "--limit" and i + 1 < len(args):
            i += 1
            limit = int(args[i])
        else:
            filtered.append(args[i])
        i += 1

    if not filtered:
        print(__doc__)
        sys.exit(1)

    query = " ".join(filtered)
    kind = _classify(query)
    if kind == "cuil":
        search_by_cuil(query)
    elif kind == "dni":
        search_by_dni(query)
    else:
        search(query, mode=mode, limit=limit)


if __name__ == "__main__":
    main()
