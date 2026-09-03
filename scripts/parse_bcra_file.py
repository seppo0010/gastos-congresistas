#!/usr/bin/env python3
"""
Genera archivos JSON con datos del BCRA a partir del archivo 24DSF.txt,
en el mismo formato que devuelve la API centraldedeudores.

Formato del registro en 24DSF.txt (LEAME DEUDORES.pdf):
  [entidad:5][tipo_id:2][cuit:11] + 24 × [situacion:2][monto:12][proc_jud:1]
  Total: 18 + 360 = 378 bytes por registro (+ CRLF)

Los 24 meses están ordenados del más reciente al más antiguo.
El mes más reciente se deriva del nombre del directorio (ej: 24DSF202602 → 202602).

Uso:
  python parse_bcra_file.py \\
      --dsf bcra/24DSF202602/24DSF.txt \\
      --maeent bcra/202602DEUDORES/Maeent.txt \\
      --periodo 202602 \\
      --output-dir legisladores2025/jan2026/ \\
      --cuits-file /tmp/cuits_legisladores.txt \\
      --pairs-file /tmp/pares_legisladores.txt
"""

import argparse
import json
import os
import sys
from collections import defaultdict

ENTITY_LEN = 5
TIPO_LEN   = 2
CUIT_LEN   = 11
HEADER_LEN = ENTITY_LEN + TIPO_LEN + CUIT_LEN  # 18

SIT_LEN   = 2
MONTO_LEN = 12
PROC_LEN  = 1
MONTH_LEN = SIT_LEN + MONTO_LEN + PROC_LEN  # 15
N_MONTHS  = 24


def parse_maeent(path):
    """Retorna dict: código_entidad (str, sin ceros iniciales) → nombre."""
    entities = {}
    with open(path, encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if len(line) >= 6:
                code = line[:5].strip()
                name = line[5:].strip()
                entities[code] = name
    return entities


def months_backwards(ref_period, n=N_MONTHS):
    """Genera n meses en orden decreciente desde ref_period (YYYYMM)."""
    year  = int(ref_period[:4])
    month = int(ref_period[4:6])
    result = []
    for _ in range(n):
        result.append(f"{year:04d}{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return result


def scan_dsf(dsf_path, maeent, month_seq, target_cuits):
    """
    Lee 24DSF.txt de una sola pasada y devuelve:
      data[cuit][periodo][entity_name] = (situacion, monto_float, proc_jud_int)
    Solo se incluyen CUITs presentes en target_cuits.
    """
    data = defaultdict(lambda: defaultdict(dict))
    found = set()

    with open(dsf_path, 'rb') as f:
        for i, raw in enumerate(f):
            if i % 5_000_000 == 0 and i > 0:
                print(f"  {i:,} líneas, {len(found)} CUITs encontrados…", file=sys.stderr)

            raw = raw.rstrip(b'\r\n')
            if len(raw) < HEADER_LEN:
                continue

            cuit = raw[ENTITY_LEN + TIPO_LEN : HEADER_LEN].decode('ascii').strip()
            if cuit not in target_cuits:
                continue

            found.add(cuit)
            entity_code = raw[:ENTITY_LEN].decode('ascii').strip().zfill(ENTITY_LEN)
            entity_name = maeent.get(entity_code, f'ENTIDAD {entity_code}')

            rest = raw[HEADER_LEN:]
            for m in range(N_MONTHS):
                off = m * MONTH_LEN
                if off + MONTH_LEN > len(rest):
                    break

                sit_raw   = rest[off            : off + SIT_LEN  ].decode('ascii').strip()
                monto_raw = rest[off + SIT_LEN  : off + SIT_LEN + MONTO_LEN].decode('ascii').strip()
                proc_raw  = rest[off + SIT_LEN + MONTO_LEN : off + MONTH_LEN].decode('ascii').strip()

                situacion = int(sit_raw)   if sit_raw   else 0
                proc      = int(proc_raw)  if proc_raw  else 0
                try:
                    monto = float(monto_raw.replace(',', '.')) if monto_raw and monto_raw != ',' else 0.0
                except ValueError:
                    monto = 0.0

                periodo = month_seq[m]
                if entity_name not in data[cuit][periodo]:
                    data[cuit][periodo][entity_name] = (situacion, monto, proc)

    return data, found


def build_json(cuit, data):
    if cuit not in data:
        return {
            "status": 404,
            "errorMessages": ["No se encontró datos para la identificación ingresada."]
        }

    periodos = []
    for periodo in sorted(data[cuit].keys(), reverse=True):
        entidades = []
        for entity_name, (sit, monto, proc) in data[cuit][periodo].items():
            entidades.append({
                "entidad":    entity_name,
                "situacion":  sit,
                "monto":      monto,
                "enRevision": proc == 2,
                "procesoJud": proc == 1,
            })
        if entidades:
            periodos.append({"periodo": periodo, "entidades": entidades})

    if not periodos:
        return {
            "status": 404,
            "errorMessages": ["No se encontró datos para la identificación ingresada."]
        }

    return {
        "status": 200,
        "results": {
            "identificacion": int(cuit),
            "denominacion":   "",
            "periodos":       periodos,
        }
    }


def write_if_missing(path, payload):
    if os.path.exists(path):
        return False
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w') as f:
        json.dump(payload, f)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsf',      required=True, help='Ruta al archivo 24DSF.txt')
    parser.add_argument('--maeent',   required=True, help='Ruta a Maeent.txt')
    parser.add_argument('--periodo',  required=True, help='Período más reciente (YYYYMM), ej: 202602')
    parser.add_argument('--output-dir',       required=True,
                        help='Directorio de salida para CUITs individuales')
    parser.add_argument('--pairs-output-dir', default=None,
                        help='Directorio de salida para pares legislador-familiar '
                             '(por defecto igual a --output-dir)')
    parser.add_argument('--cuits-file',  default=None,
                        help='Archivo con un CUIT por línea')
    parser.add_argument('--pairs-file',  default=None,
                        help='Archivo con pares "cuit_leg cuit_familiar" por línea')
    args = parser.parse_args()

    pairs_output_dir = args.pairs_output_dir or args.output_dir

    # --- Cargar CUITs individuales ---
    cuits = set()
    if args.cuits_file:
        with open(args.cuits_file) as f:
            for line in f:
                c = line.strip()
                if c:
                    cuits.add(c)

    # --- Cargar pares ---
    pairs = []
    familiar_cuits = set()
    if args.pairs_file:
        with open(args.pairs_file) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) == 2:
                    pairs.append((parts[0], parts[1]))
                    familiar_cuits.add(parts[1])

    all_cuits = cuits | familiar_cuits
    if not all_cuits:
        print("No hay CUITs para procesar.", file=sys.stderr)
        sys.exit(0)

    # --- Filtrar los que ya existen ---
    needed_cuits   = {c for c in cuits        if not os.path.exists(os.path.join(args.output_dir, f"{c}.json"))}
    needed_pairs   = [(l, f) for l, f in pairs if not os.path.exists(os.path.join(pairs_output_dir, f"{l}_{f}.json"))]
    needed_familiares = {f for _, f in needed_pairs}

    scan_needed = (needed_cuits | needed_familiares)
    if not scan_needed:
        print("Todos los archivos ya existen, nada que hacer.", file=sys.stderr)
        sys.exit(0)

    print(f"CUITs individuales nuevos: {len(needed_cuits)}", file=sys.stderr)
    print(f"Pares nuevos: {len(needed_pairs)}", file=sys.stderr)
    print(f"CUITs a buscar en el archivo: {len(scan_needed)}", file=sys.stderr)

    # --- Cargar mapa de entidades ---
    print(f"Cargando entidades desde {args.maeent}…", file=sys.stderr)
    maeent = parse_maeent(args.maeent)
    print(f"  {len(maeent)} entidades cargadas.", file=sys.stderr)

    # --- Secuencia de meses ---
    month_seq = months_backwards(args.periodo)
    print(f"Meses: {month_seq[0]} … {month_seq[-1]}", file=sys.stderr)

    # --- Scan del archivo ---
    print(f"Escaneando {args.dsf} …", file=sys.stderr)
    data, found = scan_dsf(args.dsf, maeent, month_seq, scan_needed)
    missing = scan_needed - found
    print(f"Scan completo. Encontrados: {len(found)}, sin datos: {len(missing)}", file=sys.stderr)
    if missing:
        print(f"  Sin datos (404): {sorted(missing)}", file=sys.stderr)

    # --- Escribir archivos individuales ---
    written = 0
    for cuit in needed_cuits:
        path = os.path.join(args.output_dir, f"{cuit}.json")
        if write_if_missing(path, build_json(cuit, data)):
            written += 1

    # --- Escribir archivos de pares ---
    for leg_cuit, fam_cuit in needed_pairs:
        path = os.path.join(pairs_output_dir, f"{leg_cuit}_{fam_cuit}.json")
        if write_if_missing(path, build_json(fam_cuit, data)):
            written += 1

    print(f"Archivos escritos: {written}", file=sys.stderr)


if __name__ == '__main__':
    main()
