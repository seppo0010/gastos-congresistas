#!/usr/bin/env python3
"""
Build a SQLite index from bcra/20260331PADRON/Padron_ARCA.txt.

Fixed-width format per line (220 chars, CRLF terminated):
  [0:11]   CUIL/CUIL/CDI        11 chars
  [11:171] DENOMINACIÓN         160 chars
  [171:177] ACTIVIDAD           6 chars
  [177]    MARCA DE BAJA        1 char  (* = baja, blank = activo)
  [178:189] CUIT REEMPLAZO      11 chars
  [189:199] FECHA NACIMIENTO    10 chars  AAAA-MM-DD (1901-01-01 = no informada)
  [199]    SEXO                 1 char   M/F/blank
  [200:210] CÓDIGO POSTAL       10 chars
  [210:212] PROVINCIA           2 chars  (código numérico)
  [212:220] FECHA FALLECIMIENTO 8 chars  AAAAMMDD (blanks = no corresponde)

Creates padron_index.db with FTS5 for fast name search.
"""

import sqlite3
import time

PADRON_FILE = "bcra/20260331PADRON/Padron_ARCA.txt"
ACTIVIDADES_FILE = "bcra/20260331PADRON/Actividades_ARCA.txt"
INDEX_FILE = "padron_index.db"
BATCH_SIZE = 100_000

PROVINCIAS = {
    "00": "Ciudad Autónoma de Buenos Aires",
    "01": "Buenos Aires",
    "02": "Catamarca",
    "03": "Córdoba",
    "04": "Corrientes",
    "05": "Entre Ríos",
    "06": "Jujuy",
    "07": "Mendoza",
    "08": "La Rioja",
    "09": "Salta",
    "10": "San Juan",
    "11": "San Luis",
    "12": "Santa Fe",
    "13": "Santiago del Estero",
    "14": "Tucumán",
    "16": "Chaco",
    "17": "Chubut",
    "18": "Formosa",
    "19": "Misiones",
    "20": "Neuquén",
    "21": "La Pampa",
    "22": "Río Negro",
    "23": "Santa Cruz",
    "24": "Tierra del Fuego",
}


def load_actividades() -> dict[str, str]:
    actividades = {}
    with open(ACTIVIDADES_FILE, "r", encoding="latin-1", newline="") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if len(line) < 6:
                continue
            code = line[:6].strip()
            desc = line[6:].strip()
            if code:
                actividades[code] = desc
    return actividades


def parse_fecha_nacimiento(raw: str) -> str | None:
    """Returns AAAA-MM-DD or None if not informed."""
    s = raw.strip()
    return None if s == "1901-01-01" or not s else s


def parse_fecha_fallecimiento(raw: str) -> str | None:
    """Returns AAAA-MM-DD or None if blank/no-date sentinel."""
    s = raw.strip()
    if not s or s == "19010101":
        return None
    # Convert AAAAMMDD → AAAA-MM-DD
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def build_index():
    con = sqlite3.connect(INDEX_FILE)
    cur = con.cursor()

    cur.executescript("""
        DROP TABLE IF EXISTS padron;
        DROP TABLE IF EXISTS padron_fts;
        CREATE TABLE padron (
            cuil              TEXT NOT NULL,
            nombre            TEXT NOT NULL,
            actividad         TEXT,
            fecha_nacimiento  TEXT,
            sexo              TEXT,
            provincia         TEXT,
            fecha_fallecimiento TEXT
        );
    """)

    actividades = load_actividades()
    print(f"Loaded {len(actividades):,} actividades.", flush=True)

    print(f"Reading {PADRON_FILE} ...", flush=True)
    start = time.time()
    count = 0
    batch = []

    with open(PADRON_FILE, "r", encoding="latin-1", newline="") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if len(line) < 11:
                continue
            cuil = line[:11]
            if not cuil.isdigit():
                continue

            nombre = line[11:171].strip()
            act_code = line[171:177].strip() if len(line) > 176 else ""
            actividad = actividades.get(act_code)
            fecha_nac = parse_fecha_nacimiento(line[189:199]) if len(line) > 198 else None
            sexo_raw = line[199:200].strip() if len(line) > 199 else ""
            sexo = sexo_raw if sexo_raw in ("M", "F") else None
            prov_code = line[210:212].strip() if len(line) > 211 else ""
            provincia = PROVINCIAS.get(prov_code)
            fecha_fall = parse_fecha_fallecimiento(line[212:220]) if len(line) > 211 else None

            batch.append((cuil, nombre, actividad, fecha_nac, sexo, provincia, fecha_fall))
            count += 1
            if len(batch) >= BATCH_SIZE:
                cur.executemany("INSERT INTO padron VALUES (?,?,?,?,?,?,?)", batch)
                batch.clear()
                if count % 1_000_000 == 0:
                    elapsed = time.time() - start
                    print(f"  {count:,} records ({elapsed:.0f}s)...", flush=True)

    if batch:
        cur.executemany("INSERT INTO padron VALUES (?,?,?,?,?,?,?)", batch)

    print(f"Inserted {count:,} records. Building FTS5 index...", flush=True)

    cur.executescript("""
        CREATE INDEX padron_cuil ON padron(cuil);
        CREATE INDEX padron_dni ON padron(substr(cuil, 3, 8));
        CREATE VIRTUAL TABLE padron_fts USING fts5(
            cuil              UNINDEXED,
            nombre,
            actividad         UNINDEXED,
            fecha_nacimiento  UNINDEXED,
            sexo              UNINDEXED,
            provincia         UNINDEXED,
            fecha_fallecimiento UNINDEXED,
            content=padron,
            tokenize='unicode61'
        );
        INSERT INTO padron_fts(padron_fts) VALUES('rebuild');
    """)

    con.commit()
    con.close()

    elapsed = time.time() - start
    print(f"Done. Index saved to {INDEX_FILE} ({elapsed:.0f}s total).")


if __name__ == "__main__":
    build_index()
