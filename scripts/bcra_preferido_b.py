#!/usr/bin/env python3
"""
Genera un CSV con todas las personas físicas que tienen garantías preferidas B
en el BCRA (usa el snapshot DEUDORES/PADRON más reciente disponible en bcra/),
enriquecido con nombre, fecha de nacimiento y si aparecen en los listados de
legisladores, políticos o judiciales.

Uso (desde la raíz del repo):
  python scripts/bcra_preferido_b.py

Salida: preferido_b_deudores.csv
"""

import csv
import glob
import json
import sys
from pathlib import Path


def _latest_dir(pattern):
    """Ubica el directorio más reciente que matchea pattern (ordenado por nombre), relativo al cwd."""
    candidatos = glob.glob(pattern)
    if not candidatos:
        raise FileNotFoundError(f"No se encontró ningún directorio para el patrón: {pattern}")
    return Path(max(candidatos))


_DEUDORES_DIR = _latest_dir("bcra/*DEUDORES")
_PADRON_DIR = _latest_dir("bcra/*PADRON")

DEUDORES_FILE = _DEUDORES_DIR / "deudores.txt"
MAEENT_FILE   = _DEUDORES_DIR / "Maeent.txt"
PADRON_FILE   = _PADRON_DIR / "Padron_ARCA.txt"

LEGISLADORES_FILE = "legisladores_full_enrich.json"
POLITICOS_FILE    = "politicos_enrich_final.json"
JUDICIAL_FILE     = "judicial_enrich_final.json"

OUTPUT_FILE = "preferido_b_deudores.csv"

# Prefijos CUIT de personas físicas
PERSONA_FISICA_PREFIXES = {'20', '23', '24', '27'}

# Posiciones en deudores.txt (bytes, fixed-width, 171 bytes + CRLF)
ENTITY_START  = 0;   ENTITY_END  = 5
TIPO_START    = 11;  TIPO_END    = 13
CUIT_START    = 13;  CUIT_END    = 24
PREF_B_START  = 89;  PREF_B_END  = 101

# Posiciones en Padron_ARCA.txt (bytes, fixed-width, 220 bytes + CRLF)
PAD_CUIT_START   = 0;   PAD_CUIT_END   = 11
PAD_NAME_START   = 11;  PAD_NAME_END   = 171
PAD_BAJA_POS     = 177
PAD_NACIM_START  = 189; PAD_NACIM_END  = 199


def parse_maeent(path):
    """Retorna dict: código_entidad (str) → nombre (str)."""
    entities = {}
    with open(path, encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if len(line) >= 6:
                code = line[:5].strip()
                name = line[5:].strip()
                entities[code] = name
    return entities


def load_cuits_from_json(path):
    """Extrae el conjunto de CUITs de un archivo JSON con estructura {data: [...{cuit:...}]}."""
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    entries = data['data'] if isinstance(data, dict) else data
    return {str(e['cuit']) for e in entries if 'cuit' in e}


def parse_pref_b(raw_bytes):
    """Parsea un campo de monto BCRA (comma como decimal). Retorna float o 0.0."""
    raw = raw_bytes.decode('latin-1').strip()
    if not raw or raw == ',':
        return 0.0
    try:
        return float(raw.replace(',', '.'))
    except ValueError:
        return 0.0


def scan_deudores(path, maeent):
    """
    Escanea deudores.txt y retorna dict:
      cuit → {'total': float, 'entities': set of entity names}
    Solo incluye personas físicas (prefijo 20/23/24/27) con garantías preferidas B > 0.
    """
    print("Escaneando deudores.txt…", file=sys.stderr)
    cuit_data = {}
    n_lines = 0

    with open(path, 'rb') as f:
        for raw in f:
            n_lines += 1
            if n_lines % 5_000_000 == 0:
                print(f"  {n_lines:,} líneas, {len(cuit_data):,} CUITs con preferido B…",
                      file=sys.stderr)

            raw = raw.rstrip(b'\r\n')
            if len(raw) < PREF_B_END:
                continue

            tipo = raw[TIPO_START:TIPO_END]
            if tipo != b'11':
                continue

            cuit = raw[CUIT_START:CUIT_END].decode('latin-1').strip()
            if cuit[:2] not in PERSONA_FISICA_PREFIXES:
                continue

            pref_b = parse_pref_b(raw[PREF_B_START:PREF_B_END])
            if pref_b <= 0:
                continue

            entity_code = raw[ENTITY_START:ENTITY_END].decode('latin-1').strip()
            entity_name = maeent.get(entity_code, f'ENTIDAD {entity_code}')

            if cuit not in cuit_data:
                cuit_data[cuit] = {'total': 0.0, 'entities': {}}
            cuit_data[cuit]['total'] += pref_b
            cuit_data[cuit]['entities'][entity_name] = \
                cuit_data[cuit]['entities'].get(entity_name, 0.0) + pref_b

    print(f"  Total líneas: {n_lines:,}", file=sys.stderr)
    print(f"  CUITs con preferido B > 0: {len(cuit_data):,}", file=sys.stderr)
    return cuit_data


def scan_padron(path, cuit_set):
    """
    Escanea Padron_ARCA.txt y retorna dict:
      cuit → {'nombre': str, 'fecha_nacimiento': str, 'baja': bool}
    Solo para CUITs en cuit_set.
    """
    print("Escaneando Padron_ARCA.txt…", file=sys.stderr)
    padron = {}
    n_lines = 0

    with open(path, 'rb') as f:
        for raw in f:
            n_lines += 1
            if n_lines % 10_000_000 == 0:
                print(f"  {n_lines:,} registros, {len(padron):,} matcheados…",
                      file=sys.stderr)

            raw = raw.rstrip(b'\r\n')
            if len(raw) < PAD_CUIT_END:
                continue

            cuit = raw[PAD_CUIT_START:PAD_CUIT_END].decode('latin-1').strip()
            if cuit not in cuit_set:
                continue

            nombre = raw[PAD_NAME_START:PAD_NAME_END].decode('latin-1').strip() \
                     if len(raw) >= PAD_NAME_END else ''
            baja   = (len(raw) > PAD_BAJA_POS and raw[PAD_BAJA_POS:PAD_BAJA_POS+1] == b'*')
            fecha_nac = raw[PAD_NACIM_START:PAD_NACIM_END].decode('latin-1').strip() \
                        if len(raw) >= PAD_NACIM_END else ''
            if fecha_nac == '1901-01-01':
                fecha_nac = ''

            padron[cuit] = {'nombre': nombre, 'fecha_nacimiento': fecha_nac, 'baja': baja}

    print(f"  Total líneas padrón: {n_lines:,}", file=sys.stderr)
    print(f"  CUITs matcheados: {len(padron):,}", file=sys.stderr)
    return padron


def main():
    # 1. Cargar entidades
    print(f"Cargando entidades desde {MAEENT_FILE}…", file=sys.stderr)
    maeent = parse_maeent(MAEENT_FILE)
    print(f"  {len(maeent)} entidades.", file=sys.stderr)

    # 2. Cargar CUITs de los tres listados de referencia
    print("Cargando listados de referencia…", file=sys.stderr)
    legisladores_cuits = load_cuits_from_json(LEGISLADORES_FILE)
    politicos_cuits    = load_cuits_from_json(POLITICOS_FILE)
    judicial_cuits     = load_cuits_from_json(JUDICIAL_FILE)
    print(f"  Legisladores: {len(legisladores_cuits)}, "
          f"Políticos: {len(politicos_cuits)}, "
          f"Judiciales: {len(judicial_cuits)}", file=sys.stderr)

    # 3. Escanear deudores.txt para preferido B
    cuit_data = scan_deudores(DEUDORES_FILE, maeent)

    # 4. Escanear padrón para nombre y fecha de nacimiento
    padron = scan_padron(PADRON_FILE, set(cuit_data.keys()))

    # 5. Escribir CSV ordenado por monto descendente
    print(f"Escribiendo {OUTPUT_FILE}…", file=sys.stderr)
    rows = []
    for cuit, d in cuit_data.items():
        p = padron.get(cuit, {})
        rows.append({
            'cuit':                       cuit,
            'nombre':                     p.get('nombre', ''),
            'fecha_nacimiento':           p.get('fecha_nacimiento', ''),
            'baja':                       'si' if p.get('baja') else 'no',
            'monto_preferido_b_miles_pesos': round(d['total'], 1),
            'entidades':                  '|'.join(
                f"{name}:{round(amt, 1)}"
                for name, amt in sorted(d['entities'].items())
            ),
            'es_legislador':              'si' if cuit in legisladores_cuits else 'no',
            'es_politico':                'si' if cuit in politicos_cuits    else 'no',
            'es_judicial':                'si' if cuit in judicial_cuits     else 'no',
        })

    rows.sort(key=lambda r: r['monto_preferido_b_miles_pesos'], reverse=True)

    fieldnames = [
        'cuit', 'nombre', 'fecha_nacimiento', 'baja',
        'monto_preferido_b_miles_pesos', 'entidades',
        'es_legislador', 'es_politico', 'es_judicial',
    ]
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Listo. {len(rows):,} personas con garantías preferidas B.", file=sys.stderr)
    print(f"  en legisladores: {sum(1 for r in rows if r['es_legislador'] == 'si'):,}",
          file=sys.stderr)
    print(f"  en políticos:    {sum(1 for r in rows if r['es_politico'] == 'si'):,}",
          file=sys.stderr)
    print(f"  en judiciales:   {sum(1 for r in rows if r['es_judicial'] == 'si'):,}",
          file=sys.stderr)


if __name__ == '__main__':
    main()
