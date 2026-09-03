#!/usr/bin/env python3
"""
Genera archivos JSON con datos del BCRA para todas las personas físicas
que aparecen en el 24DSF.txt, enriquecidos con el nombre del padrón ARCA.

Formato de salida: padron/{periodo}/{sha1(cuit)[:2]}/{sha1(cuit)[2:4]}.json.gz
Cada archivo contiene todos los CUITs del bucket como dict {cuit → payload}.

Uso:
  python parse_padron.py \\
      --dsf    bcra/24DSF202602/24DSF.txt \\
      --padron bcra/20260331PADRON/Padron_ARCA.txt \\
      --maeent bcra/202602DEUDORES/Maeent.txt \\
      --dsf1   bcra/1DSF202602/1DSF.txt \\
      --periodo 202602 \\
      --output-dir padron/202602/ \\
      --tmp-dir /tmp/padron_splits/ \\
      [--limit N]

Algoritmo (eficiente en memoria):
  Fase 1 — Scan 24DSF.txt: filtra personas físicas y distribuye líneas raw en
           256 archivos temporales según sha1(cuit)[:2].
  Fase 2 — Scan Padron_ARCA.txt: carga nombres solo para los CUITs vistos.
  Fase 3 — Scan 1DSF.txt: carga fecha de origen situación 1.
  Fase 4 — Por cada prefijo sha1: parsea el archivo temporal y escribe JSON.
"""

import argparse
import gzip
import hashlib
import json
import os
import sys
from collections import defaultdict

# ── Constantes 24DSF (ver LEAME DEUDORES.pdf) ─────────────────────────────────
ENTITY_LEN = 5
TIPO_LEN   = 2
CUIT_LEN   = 11
HEADER_LEN = ENTITY_LEN + TIPO_LEN + CUIT_LEN  # 18

SIT_LEN   = 2
MONTO_LEN = 12
PROC_LEN  = 1
MONTH_LEN = SIT_LEN + MONTO_LEN + PROC_LEN  # 15
N_MONTHS  = 24

PERSONA_FISICA_PREFIXES = {'20', '23', '24', '27'}


# ── Helpers ────────────────────────────────────────────────────────────────────
def parse_maeent(path):
    """Retorna dict: código_entidad (str) → nombre."""
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


def sha1_hex(cuit: str) -> str:
    return hashlib.sha1(cuit.encode()).hexdigest()


def sha1_prefix(cuit: str) -> str:
    """Primeros 2 chars del sha1 → directorio."""
    return sha1_hex(cuit)[:2]


# ── Fase 1: distribuir líneas de 24DSF.txt en archivos temporales ──────────────
def phase1_split(dsf_path, tmp_dir, limit=None, target_cuits=None):
    """
    Lee 24DSF.txt y escribe cada línea de persona física en
    tmp_dir/{sha1(cuit)[:2]}.bin.

    Si target_cuits es un conjunto, solo se incluyen esos CUITs (ignora el
    filtro de prefijo persona física). Útil para probar un CUIT específico.

    Retorna el conjunto de CUITs encontrados.
    """
    os.makedirs(tmp_dir, exist_ok=True)
    handles = {}

    def get_handle(prefix):
        if prefix not in handles:
            # 'wb' para truncar cualquier archivo previo al abrir por primera vez
            handles[prefix] = open(os.path.join(tmp_dir, f"{prefix}.bin"), 'wb')
        return handles[prefix]

    cuit_set = set()
    pf_lines = 0

    print("Fase 1: escaneando 24DSF.txt…", file=sys.stderr)
    with open(dsf_path, 'rb') as f:
        for i, raw in enumerate(f):
            if limit is not None and i >= limit:
                print(f"  --limit {limit} alcanzado.", file=sys.stderr)
                break
            if i % 5_000_000 == 0 and i > 0:
                print(f"  {i:,} líneas, {pf_lines:,} personas físicas, "
                      f"{len(cuit_set):,} CUITs únicos…", file=sys.stderr)

            raw_stripped = raw.rstrip(b'\r\n')
            if len(raw_stripped) < HEADER_LEN:
                continue

            cuit = raw_stripped[ENTITY_LEN + TIPO_LEN: HEADER_LEN].decode('ascii').strip()
            if target_cuits is not None:
                if cuit not in target_cuits:
                    continue
            elif cuit[:2] not in PERSONA_FISICA_PREFIXES:
                continue

            cuit_set.add(cuit)
            pf_lines += 1
            get_handle(sha1_prefix(cuit)).write(raw)

    for h in handles.values():
        h.close()

    print(f"  Líneas persona física: {pf_lines:,}", file=sys.stderr)
    print(f"  CUITs únicos: {len(cuit_set):,}", file=sys.stderr)
    print(f"  Archivos temporales: {len(handles)}", file=sys.stderr)
    return cuit_set


# ── Fase 2: cargar nombres del padrón ─────────────────────────────────────────
def phase2_load_padron(padron_path, cuit_set):
    """
    Lee Padron_ARCA.txt (formato fijo 220 bytes + CRLF) y retorna
    {cuit: denominacion} solo para CUITs en cuit_set.
      Campo  Posición  Longitud
      CUIT      0        11
      Nombre   11       160
    """
    print("Fase 2: cargando nombres del padrón…", file=sys.stderr)
    padron = {}
    with open(padron_path, 'rb') as f:
        for i, raw in enumerate(f):
            if i % 10_000_000 == 0 and i > 0:
                print(f"  {i:,} registros padrón, {len(padron):,} matcheados…",
                      file=sys.stderr)
            raw_stripped = raw.rstrip(b'\r\n')
            if len(raw_stripped) < 171:
                continue
            cuit = raw_stripped[:11].decode('latin-1').strip()
            if cuit not in cuit_set:
                continue
            nombre = raw_stripped[11:171].decode('latin-1').strip()
            padron[cuit] = nombre

    print(f"  Nombres cargados: {len(padron):,}", file=sys.stderr)
    return padron


# ── Fase 3: cargar fecha de origen situación 1 ────────────────────────────────
def phase3_load_sit1(dsf1_path, cuit_set):
    """
    Lee 1DSF.txt (formato: tipo(2) + cuit(11) + fecha(6) = 19 bytes + CRLF)
    y retorna {cuit: fecha_YYYYMM} solo para CUITs en cuit_set.
    """
    print("Fase 3: cargando fechas situación 1…", file=sys.stderr)
    sit1 = {}
    with open(dsf1_path, 'rb') as f:
        for raw in f:
            raw_stripped = raw.rstrip(b'\r\n')
            if len(raw_stripped) < 19:
                continue
            cuit  = raw_stripped[2:13].decode('ascii').strip()
            if cuit not in cuit_set:
                continue
            fecha = raw_stripped[13:19].decode('ascii').strip()
            sit1[cuit] = fecha
    print(f"  Fechas sit1 cargadas: {len(sit1):,}", file=sys.stderr)
    return sit1


# ── Parseo de líneas raw del 24DSF ────────────────────────────────────────────
def parse_raw_lines(raw_lines, maeent, month_seq):
    """
    Parsea una lista de líneas raw del 24DSF.txt.
    Retorna data[cuit][periodo][entity_name] = (situacion, monto, proc).
    """
    data = defaultdict(lambda: defaultdict(dict))
    for raw in raw_lines:
        raw = raw.rstrip(b'\r\n')
        if len(raw) < HEADER_LEN:
            continue

        cuit        = raw[ENTITY_LEN + TIPO_LEN: HEADER_LEN].decode('ascii').strip()
        entity_code = raw[:ENTITY_LEN].decode('ascii').strip().zfill(ENTITY_LEN)
        entity_name = maeent.get(entity_code, f'ENTIDAD {entity_code}')
        rest        = raw[HEADER_LEN:]

        for m in range(N_MONTHS):
            off = m * MONTH_LEN
            if off + MONTH_LEN > len(rest):
                break
            sit_raw   = rest[off:                      off + SIT_LEN          ].decode('ascii').strip()
            monto_raw = rest[off + SIT_LEN:            off + SIT_LEN + MONTO_LEN].decode('ascii').strip()
            proc_raw  = rest[off + SIT_LEN + MONTO_LEN: off + MONTH_LEN        ].decode('ascii').strip()

            situacion = int(sit_raw)  if sit_raw  else 0
            proc      = int(proc_raw) if proc_raw else 0
            try:
                monto = float(monto_raw.replace(',', '.')) if monto_raw and monto_raw != ',' else 0.0
            except ValueError:
                monto = 0.0

            periodo = month_seq[m]
            if entity_name not in data[cuit][periodo]:
                data[cuit][periodo][entity_name] = (situacion, monto, proc)

    return data


def build_json(cuit, cuit_data, denominacion, fecha_sit1):
    """Construye el payload JSON para un CUIT dado."""
    periodos = []
    for periodo in sorted(cuit_data.keys(), reverse=True):
        entidades = []
        for entity_name, (sit, monto, proc) in cuit_data[periodo].items():
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
        return None

    result = {
        "identificacion": int(cuit),
        "denominacion":   denominacion,
        "periodos":       periodos,
    }
    if fecha_sit1:
        result["fecha_situacion_1"] = fecha_sit1

    return {"status": 200, "results": result}


# ── Fase 4: procesar prefijos y escribir buckets gzipped ──────────────────────
def phase4_write_jsons(tmp_dir, output_dir, padron, sit1, maeent, month_seq):
    """
    Itera los 256 prefijos sha1 (directorios), parsea cada archivo temporal
    y escribe archivos output_dir/{dir}/{sub}.json.gz donde:
      dir = sha1(cuit)[:2]
      sub = sha1(cuit)[2:4]
    Cada archivo contiene todos los CUITs del bucket: {cuit: payload, …}.
    Los archivos de bucket existentes se saltan (reanudable).
    """
    print("Fase 4: escribiendo buckets gzipped…", file=sys.stderr)
    written  = 0   # buckets escritos
    skipped  = 0   # buckets saltados
    prefixes = 0

    for prefix_int in range(256):
        dir_prefix = f"{prefix_int:02x}"
        tmp_path   = os.path.join(tmp_dir, f"{dir_prefix}.bin")
        if not os.path.exists(tmp_path):
            continue

        prefix_out_dir = os.path.join(output_dir, dir_prefix)
        os.makedirs(prefix_out_dir, exist_ok=True)

        with open(tmp_path, 'rb') as f:
            raw_lines = f.readlines()

        data = parse_raw_lines(raw_lines, maeent, month_seq)

        # Agrupar CUITs en sub-buckets por sha1[2:4]
        sub_buckets = defaultdict(dict)  # sub → {cuit: payload}
        for cuit, cuit_data in data.items():
            payload = build_json(cuit, cuit_data, padron.get(cuit, ""), sit1.get(cuit))
            if payload is None:
                continue
            sub = sha1_hex(cuit)[2:4]
            sub_buckets[sub][cuit] = payload

        for sub, bucket in sub_buckets.items():
            out_path = os.path.join(prefix_out_dir, f"{sub}.json.gz")
            if os.path.exists(out_path):
                skipped += 1
                continue
            with gzip.open(out_path, 'wt', encoding='utf-8') as f:
                json.dump(bucket, f)
            written += 1

        prefixes += 1
        if prefix_int % 32 == 31:
            print(f"  {prefixes} prefijos procesados (hasta {dir_prefix}), "
                  f"buckets escritos={written:,}, saltados={skipped:,}", file=sys.stderr)

    print(f"Fase 4 completa. Prefijos={prefixes}, "
          f"buckets escritos={written:,}, saltados={skipped:,}", file=sys.stderr)


# ── main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dsf',        required=True,
                        help='Ruta al archivo 24DSF.txt')
    parser.add_argument('--padron',     required=True,
                        help='Ruta a Padron_ARCA.txt')
    parser.add_argument('--maeent',     required=True,
                        help='Ruta a Maeent.txt')
    parser.add_argument('--dsf1',       default=None,
                        help='Ruta a 1DSF.txt (opcional, agrega fecha_situacion_1)')
    parser.add_argument('--periodo',    required=True,
                        help='Período más reciente YYYYMM (ej: 202602)')
    parser.add_argument('--output-dir', required=True,
                        help='Directorio de salida para los JSON por CUIT')
    parser.add_argument('--tmp-dir',    default='/tmp/padron_splits/',
                        help='Directorio para archivos temporales de Fase 1')
    parser.add_argument('--limit',      type=int, default=None,
                        help='Detener Fase 1 tras N líneas del 24DSF.txt (para pruebas)')
    parser.add_argument('--cuit',       nargs='+', default=None, metavar='CUIT',
                        help='Procesar solo estos CUITs (uno o más, separados por espacio)')
    args = parser.parse_args()

    print(f"Cargando entidades desde {args.maeent}…", file=sys.stderr)
    maeent = parse_maeent(args.maeent)
    print(f"  {len(maeent)} entidades.", file=sys.stderr)

    month_seq = months_backwards(args.periodo)
    print(f"Meses: {month_seq[0]} … {month_seq[-1]}", file=sys.stderr)

    target_cuits = set(args.cuit) if args.cuit else None
    cuit_set = phase1_split(args.dsf, args.tmp_dir, limit=args.limit,
                            target_cuits=target_cuits)

    padron = phase2_load_padron(args.padron, cuit_set)

    sit1 = {}
    if args.dsf1:
        sit1 = phase3_load_sit1(args.dsf1, cuit_set)

    phase4_write_jsons(args.tmp_dir, args.output_dir, padron, sit1, maeent, month_seq)


if __name__ == '__main__':
    main()
