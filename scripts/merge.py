import json
import pandas as pd
import difflib
import unicodedata
import os
import glob
from datetime import datetime
from clean import clean_entity_name
from parse_judicial_pdf import canonicalizar_cargo_judicial

# --- ARCHIVOS ---
JSON_FILE = 'legisladores_full.json'
CSV_FILE = 'historial_legisladores_completo.csv'
IPC_FILE = 'ipc.csv'
DOLARS_FILE = 'dolares_argentinadatos.json'
OUTPUT_FILE = 'legisladores_enrich_final.json'
CACHE_MATCHES_FILE = 'cache_matches_nombres.json'
LEGISLADORES2025_DIR = 'legisladores2025/'
FAMILIARES_CSV = os.path.join(LEGISLADORES2025_DIR, 'grupos-familiares.csv')

POLITICOS_DIR = 'politicos/'
POLITICOS_OUTPUT_FILE = 'politicos_enrich_final.json'
POLITICOS_FAMILIARES_DIR = 'familiares/'
POLITICOS_FAMILIARES_CSV = os.path.join(POLITICOS_DIR, 'familiares.csv')

JUDICIAL_DIR = 'judicial/'
JUDICIAL_OUTPUT_FILE = 'judicial_enrich_final.json'

JGM_DIR = 'jgm/'
JGM_OUTPUT_FILE = 'jgm_enrich_final.json'
DDJJ_2024_CSV = 'DDJJ_Diputados_2024_Base_final_Patrimonio_y_deudas_por_legislador.csv'

def _latest_deudores_file():
    """Ubica el deudores.txt del período más reciente disponible en bcra/*DEUDORES."""
    periodos = []
    for d in glob.glob('bcra/*DEUDORES'):
        periodo = os.path.basename(d)[:6]
        if periodo.isdigit():
            periodos.append((periodo, d))
    if not periodos:
        return None
    _, latest_dir = max(periodos)
    return os.path.join(latest_dir, 'deudores.txt')

BCRA_DEUDORES_FILE = _latest_deudores_file()

def _latest_magistrados_csv():
    """Ubica el CSV de magistrados con la fecha más reciente en el nombre."""
    candidatos = glob.glob('judicial/magistrados-justicia-federal-nacional-jueces-*.csv')
    if not candidatos:
        return None
    return max(candidatos)

MAGISTRADOS_CSV = _latest_magistrados_csv()


# --- MAPA DE EXCEPCIONES MANUALES ---
# Formato: "Nombre en CSV": "NOMBRE EXACTO EN JSON (BCRA)"
EXCEPCIONES_MANUALES = {
    "De Pedro Wado": "DE PEDRO EDUARDO ENRIQUE", # Apodo
    "Carrio Elisa": "CARRIO ELISA MARIA AVELINA",
    "Moreau Cecilia": "MOREAU CECILIA",
    'Hilda Clelia Aguirre de Soria': 'AGUIRRE HILDA CLELIA',
    'Ivana Arrascaeta': 'ARRASCAETA IVANNA MARCELA',
    'Lisandro Almiron': 'ALMIRON CLAUDIO',  # Su nombre completo es Claudio Lisandro
}

# --- 1. CONFIGURACIÓN DE HITOS ---
GLOBAL_MILESTONES = [
    {"fecha": "2023-08", "texto": "PASO 2023", "color": "#a855f7", "tipo": "global"},
    {"fecha": "2023-10", "texto": "Elecciones Generales", "color": "#3b82f6", "tipo": "global"},
    {"fecha": "2023-12", "texto": "Asunción Milei", "color": "#eab308", "tipo": "global"},
    {"fecha": "2024-06", "texto": "Ley Bases (Senado)", "color": "#ef4444", "tipo": "senador"},
    {"fecha": "2024-08", "texto": "Rechazo DNU SIDE (Diputados)", "color": "#ef4444", "tipo": "diputado"},
    {"fecha": "2024-09", "texto": "Rechazo DNU SIDE (Senadores)", "color": "#ef4444", "tipo": "senador"},
    {"fecha": "2024-09", "texto": "87 héroes", "color": "#ef4444", "tipo": "diputado"},
    {"fecha": "2025-10", "texto": "Elecciones Legislativas", "color": "#3b82f6", "tipo": "global"},
]

LEGISLATOR_EVENTS = {
    '20228264130': [{"fecha": "2024-12", "texto": "Detenido en Paraguay", "color": "#cccccc"}]
}

# --- FUNCIONES DE NORMALIZACIÓN ---
def normalizar_para_match(texto):
    if not isinstance(texto, str): return ""
    texto = ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn')
    return texto.upper().strip()

def simplificar_cargo(cargo: str) -> str:
    """Normaliza títulos de cargo al nombre canónico simplificado."""
    import re
    c = cargo.strip()
    # Presidente (todas las variantes, con o sin /a, con o sin sufijo)
    if re.match(r'Presidente', c, re.IGNORECASE):
        return 'Presidente/a'
    # Vicepresidente (ídem)
    if re.match(r'Vicepresidente', c, re.IGNORECASE):
        return 'Vicepresidente/a'
    # Director/a Titular (y sus variantes de clase/representación) → Director/a
    # pero NO Suplente, Nacional, Regional, ni "Director Nacional de..."
    if re.match(r'Director/a\s*(Titular|Ejecutivo)', c, re.IGNORECASE):
        return 'Director/a'
    if c == 'Director/a':
        return 'Director/a'
    # Jefe de Gabinete de Ministros
    if c == 'Jefe de Gabinete de Ministros':
        return 'Jefe de Gabinete'
    # Ministro / Ministra → Ministro/a
    if c in ('Ministro', 'Ministra'):
        return 'Ministro/a'
    # Miembro en representación de...
    if re.match(r'Miembro\b', c, re.IGNORECASE):
        return 'Miembro'
    # Prefecto Nacional Naval
    if re.match(r'Prefecto', c, re.IGNORECASE):
        return 'Prefecto/a'
    return c


def obtener_color_bloque(nombre_bloque):
    b = str(nombre_bloque).lower()
    if 'fin de mandato' in b or 'renuncia' in b: return '#000000'
    if 'libertad avanza' in b or 'lla' in b: return '#8A2BE2'
    if 'frente de todos' in b or 'unión por la patria' in b or 'uxp' in b or 'justicialista' in b: return '#009ADE'
    if 'pro' in b or 'propuesta republicana' in b: return '#FFD700'
    if 'radical' in b or 'ucr' in b: return '#D72D2D'
    if 'izquierda' in b or 'fit' in b: return '#FF0000'
    if 'hacemos' in b or 'encuentro federal' in b: return '#228B22'
    if 'civica' in b or 'ari' in b: return '#008080'
    return '#808080'

# --- LÓGICA DE MATCHING (HÍBRIDA) ---
def encontrar_match_algoritmico(nombre_wiki, lista_legisladores_bcra):
    """
    Intenta Inclusión de Tokens -> Fuzzy.
    Retorna el índice en la lista del JSON o None.
    """
    nombre_wiki_norm = normalizar_para_match(nombre_wiki)
    tokens_wiki = set(nombre_wiki_norm.split())

    # 1. INCLUSIÓN (Tokens Subset)
    candidatos = []
    for idx, leg in enumerate(lista_legisladores_bcra):
        nombre_bcra_norm = normalizar_para_match(leg['nombre'])
        tokens_bcra = set(nombre_bcra_norm.split())

        if tokens_wiki.issubset(tokens_bcra) or tokens_bcra.issubset(tokens_wiki):
            candidatos.append(idx)

    if len(candidatos) == 1:
        return candidatos[0]

    if len(candidatos) > 1:
        return candidatos[0]

    # 2. FUZZY (Solo si falló inclusión)
    nombre_wiki_ordenado = " ".join(sorted(tokens_wiki))
    mejor_idx = None
    mejor_score = 0.0

    for idx, leg in enumerate(lista_legisladores_bcra):
        nombre_bcra_norm = normalizar_para_match(leg['nombre'])
        nombre_bcra_ordenado = " ".join(sorted(nombre_bcra_norm.split()))

        score = difflib.SequenceMatcher(None, nombre_wiki_ordenado, nombre_bcra_ordenado).ratio()
        if score > mejor_score:
            mejor_score = score
            mejor_idx = idx

    if mejor_score > 0.85:
        return mejor_idx

    return None

def cuit_desde_dni(dni: str, genero: str) -> str | None:
    """Computa CUIT argentino desde DNI y género (Masculino/Femenino)."""
    prefijo = '27' if genero.lower().startswith('f') else '20'
    dni_str = dni.strip().zfill(8)
    factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    for pref in [prefijo, '23']:
        base = pref + dni_str
        suma = sum(int(base[i]) * factores[i] for i in range(10))
        r = suma % 11
        if r == 1:
            continue
        verificador = 0 if r == 0 else 11 - r
        return f"{base}{verificador}"
    return None

def _periodo_a_fecha(periodo_str):
    """Convierte '202512' -> '2025-12'"""
    return f"{periodo_str[:4]}-{periodo_str[4:]}"

def _latest_bcra_files(base_dir):
    """One file per CUIT across all subdirs of base_dir, keeping the most recently modified."""
    by_cuit = {}
    for fp in glob.glob(os.path.join(base_dir, '*', '*.json')):
        cuit = os.path.basename(fp).replace('.json', '')
        if cuit not in by_cuit or os.path.getmtime(fp) > os.path.getmtime(by_cuit[cuit]):
            by_cuit[cuit] = fp
    return sorted(by_cuit.values())

def _familiar_files(base_dir):
    """Find files named {cuit_legislador}_{cuit_familiar}.json where the two CUITs differ.
    Returns list of (cuit_legislador, cuit_familiar, filepath), keeping the most recent per pair.
    """
    by_pair = {}
    for fp in glob.glob(os.path.join(base_dir, '*', '*.json')):
        basename = os.path.basename(fp).replace('.json', '')
        parts = basename.split('_')
        if len(parts) != 2:
            continue
        cuit_leg, cuit_fam = parts[0], parts[1]
        if cuit_leg == cuit_fam:
            continue
        key = (cuit_leg, cuit_fam)
        if key not in by_pair or os.path.getmtime(fp) > os.path.getmtime(by_pair[key][2]):
            by_pair[key] = (cuit_leg, cuit_fam, fp)
    return sorted(by_pair.values(), key=lambda x: (x[0], x[1]))


def get_mep():
    with open(DOLARS_FILE) as fp:
        data = pd.DataFrame(json.loads(fp.read()))
    data = data[(data['casa'] == 'bolsa') & (data['fecha'].apply(lambda x: int(x[:4]) >= 2023 and x[-2:] == '14'))]
    data['fecha'] = data['fecha'].apply(lambda x: x[:7])
    data['val'] = (data['compra'] + data['venta']) / 2
    return data.set_index('fecha')['val'].to_dict()

def cargar_hipotecas_bcra(cuits):
    """Escanea deudores.txt y retorna datos de garantía preferida (hipotecas) para los CUITs dados."""
    resultado = {}
    if not BCRA_DEUDORES_FILE or not os.path.exists(BCRA_DEUDORES_FILE):
        print(f"  Archivo no encontrado: {BCRA_DEUDORES_FILE}")
        return resultado

    def parse_monto(s):
        s = s.strip().replace(' ', '')
        if not s or s == ',0':
            return 0.0
        try:
            return float(s.replace(',', '.'))
        except Exception:
            return 0.0

    with open(BCRA_DEUDORES_FILE, encoding='latin-1') as f:
        for line in f:
            if line[11:13].strip() != '11':
                continue
            cuit = line[13:24].strip()
            if cuit not in cuits:
                continue
            if cuit not in resultado:
                resultado[cuit] = {'monto_miles_pesos': 0.0, 'entidades': [], 'fecha': None, 'situacion_actual': 0}
            sit_raw = line[27:29].strip()
            try:
                situacion = int(sit_raw) if sit_raw else 0
            except ValueError:
                situacion = 0
            if 1 <= situacion <= 5 and situacion > resultado[cuit]['situacion_actual']:
                resultado[cuit]['situacion_actual'] = situacion
            garPrefA = parse_monto(line[77:89])
            garPrefB = parse_monto(line[89:101])
            total = garPrefA + garPrefB
            if total > 0:
                entidad = line[0:5].strip()
                fecha_raw = line[5:11].strip()
                fecha = f"{fecha_raw[:4]}-{fecha_raw[4:]}"
                if resultado[cuit]['fecha'] is None:
                    resultado[cuit]['fecha'] = fecha
                resultado[cuit]['monto_miles_pesos'] += total
                resultado[cuit]['entidades'].append(entidad)
    return resultado

def analizar_cambio_nivel(deudas, mep_dict, ipc_dict):
    window_size = 4
    if len(deudas) < window_size * 2: return []
    hitos = []
    windows = []
    for i in range(window_size, len(deudas) - window_size + 1):
        if deudas[i]['fecha'] in windows: continue

        window = [x['fecha'] for x in deudas[i-window_size:i+window_size]]

        usd_med_prev = pd.Series([x['monto'] / mep_dict[x['fecha']] for x in deudas[i-window_size:i]]).median()
        usd_med_next = pd.Series([x['monto'] / mep_dict[x['fecha']] for x in deudas[i:i+window_size]]).median()
        usd_diff = usd_med_next - usd_med_prev
        usd_rel_diff = abs(usd_diff) / usd_med_prev if usd_med_prev > 1 else 10.0

        ipc_med_prev = pd.Series([x['monto'] / ipc_dict[x['fecha']] for x in deudas[i-window_size:i]]).median()
        ipc_med_next = pd.Series([x['monto'] / ipc_dict[x['fecha']] for x in deudas[i:i+window_size]]).median()
        ipc_diff = ipc_med_next - ipc_med_prev
        ipc_rel_diff = abs(ipc_diff) / ipc_med_prev if ipc_med_prev > 1 else 10.0

        if abs(usd_diff) > 5_000 and usd_rel_diff > 0.2 and ipc_rel_diff > 0.2:
            windows.extend(window)
            hitos.append({
                "fecha": deudas[i+1]['fecha'],
                "texto": f"Cambio nivel deuda",
                "color": "#f97316",
                "tipo": "economico",
                "cargo": "Legislador"
            })

    return hitos


if __name__ == "__main__":
    # --- CARGA DE DATOS ---
    print("Cargando archivos...")
    with open(JSON_FILE, 'r', encoding='utf-8') as f:
        datos_json = json.load(f)

    # Normalize entity names in existing data, drop zero-debt entries, and deduplicate (entidad, fecha) keys
    for leg in datos_json['data']:
        seen = {}
        for h in leg['historial']:
            if h['monto'] == 0:
                continue
            h['entidad'] = clean_entity_name(h['entidad'])
            seen[(h['entidad'], h['fecha'])] = h
        leg['historial'] = list(seen.values())

    match_cache = {}
    if os.path.exists(CACHE_MATCHES_FILE):
        with open(CACHE_MATCHES_FILE, 'r', encoding='utf-8') as f:
            match_cache = json.load(f)
        print(f"Caché cargado: {len(match_cache)} nombres pre-resueltos.")

    df_historial = pd.read_csv(CSV_FILE).sort_values(by='fecha')
    df_historial = df_historial[df_historial['bloque_anterior'].str.upper() != df_historial['bloque_nuevo'].str.upper()].reset_index(drop=True)

    # --- MERGE DE ARCHIVOS NUEVOS (legisladores2025/) ---
    if os.path.isdir(LEGISLADORES2025_DIR):
        archivos_nuevos = _latest_bcra_files(LEGISLADORES2025_DIR)
        print(f"Mergeando {len(archivos_nuevos)} archivos de {LEGISLADORES2025_DIR}...")
        entradas_nuevas = 0
        entradas_actualizadas = 0

        mapa_cuit = {str(leg['cuit']): i for i, leg in enumerate(datos_json['data'])}

        for filepath in archivos_nuevos:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    new_data = json.load(f)
            except (json.JSONDecodeError, ValueError):
                print(f"  Archivo vacío o inválido, se omite: {filepath}")
                continue

            results = new_data.get('results', {})
            cuit = str(results.get('identificacion', ''))
            periodos = results.get('periodos', [])

            if cuit not in mapa_cuit:
                print(f"  CUIT {cuit} no encontrado en {JSON_FILE}, se omite.")
                continue

            legislador = datos_json['data'][mapa_cuit[cuit]]

            idx_existente = {(h['entidad'], h['fecha']): i for i, h in enumerate(legislador['historial'])}

            for periodo in periodos:
                fecha = _periodo_a_fecha(periodo['periodo'])
                for ent in periodo.get('entidades', []):
                    entidad = clean_entity_name(ent['entidad'])
                    monto = int(ent['monto'])
                    if monto == 0:
                        continue
                    situacion = ent['situacion']
                    key = (entidad, fecha)

                    if key in idx_existente:
                        existing = legislador['historial'][idx_existente[key]]
                        if existing['monto'] != monto or existing['situacion'] != situacion:
                            existing['monto'] = monto
                            existing['situacion'] = situacion
                            entradas_actualizadas += 1
                    else:
                        legislador['historial'].append({
                            'entidad': entidad,
                            'fecha': fecha,
                            'situacion': situacion,
                            'monto': monto,
                        })
                        idx_existente[key] = len(legislador['historial']) - 1
                        entradas_nuevas += 1

            legislador['historial'].sort(key=lambda x: x['fecha'])

        print(f"Merge completado: {entradas_nuevas} entradas nuevas, {entradas_actualizadas} actualizadas.")

    # Mapa auxiliar: Nombre JSON -> Índice en la lista (para acceso rápido)
    mapa_indices_json = {leg['nombre']: i for i, leg in enumerate(datos_json['data'])}

    # --- PROCESAMIENTO ---
    print("Procesando y enriqueciendo...")
    nuevos_matches_encontrados = 0

    for _, fila in df_historial.iterrows():
        nombre_wiki = fila['legislador']
        bloque_nuevo = fila['bloque_nuevo']
        tipo_evento = fila['tipo_evento']
        fecha = fila['fecha']
        cargo = fila.get('cargo', 'Legislador')
        distrito = str(fila.get('distrito', ''))

        # --- RESOLUCIÓN DEL NOMBRE ---
        nombre_target_json = None

        if nombre_wiki in EXCEPCIONES_MANUALES:
            nombre_target_json = EXCEPCIONES_MANUALES[nombre_wiki]
        elif nombre_wiki in match_cache:
            nombre_target_json = match_cache[nombre_wiki]
        else:
            idx_found = encontrar_match_algoritmico(nombre_wiki, datos_json['data'])
            if idx_found is not None:
                nombre_target_json = datos_json['data'][idx_found]['nombre']
                nuevos_matches_encontrados += 1
            else:
                nombre_target_json = None
            match_cache[nombre_wiki] = nombre_target_json

        if nombre_target_json and nombre_target_json in mapa_indices_json:
            idx = mapa_indices_json[nombre_target_json]
            legislador = datos_json['data'][idx]

            if "distrito" not in legislador or legislador["distrito"] in ["Desconocido", "nan", ""]:
                if distrito and distrito != "nan": legislador["distrito"] = distrito

            if 'Fin de Mandato' not in bloque_nuevo:
                legislador["partido"] = bloque_nuevo
            legislador["cargo"] = cargo
            legislador["mis_hitos"] = LEGISLATOR_EVENTS.get(legislador['cuit'], [])

            if tipo_evento == "Inicio/Alta": titulo = f"Inicio ({cargo}) en {bloque_nuevo}"
            elif tipo_evento == "Cambio": titulo = f"Pase a {bloque_nuevo}"
            else:
                titulo = f"Fin de mandato ({cargo})"
                bloque_nuevo = "Fin de Mandato"

            hito = {
                "fecha": fecha[:7],
                "texto": titulo,
                "color": obtener_color_bloque(bloque_nuevo),
                "tipo": "politico",
                "cargo": cargo
            }

            if "hitos_personales" not in legislador: legislador["hitos_personales"] = []
            legislador["hitos_personales"].append(hito)
            legislador["hitos_personales"].sort(key=lambda x: x['fecha'])

    # --- PROCESAMIENTO DE DDJJ 2024 (Deudas declaradas) ---
    if os.path.exists(DDJJ_2024_CSV):
        print(f"Procesando deudas declaradas desde {DDJJ_2024_CSV}...")
        df_ddjj = pd.read_csv(DDJJ_2024_CSV, thousands='.', decimal=',')
        for _, fila in df_ddjj.iterrows():
            nombre_ddjj = fila['nombre']
            deuda_inicio = fila.get('Deudas al Inicio del año', 0)
            deuda_fin = fila.get('Deudas al final del año', 0)

            if pd.isna(deuda_inicio): deuda_inicio = 0
            if pd.isna(deuda_fin): deuda_fin = 0

            # Reutilizamos la lógica de matching
            nombre_target_json = None
            if nombre_ddjj in EXCEPCIONES_MANUALES:
                nombre_target_json = EXCEPCIONES_MANUALES[nombre_ddjj]
            elif nombre_ddjj in match_cache:
                nombre_target_json = match_cache[nombre_ddjj]
            else:
                idx_found = encontrar_match_algoritmico(nombre_ddjj, datos_json['data'])
                if idx_found is not None:
                    nombre_target_json = datos_json['data'][idx_found]['nombre']
                match_cache[nombre_ddjj] = nombre_target_json

            if nombre_target_json and nombre_target_json in mapa_indices_json:
                idx = mapa_indices_json[nombre_target_json]
                legislador = datos_json['data'][idx]
                
                if "hitos_personales" not in legislador: legislador["hitos_personales"] = []
                
                def fmt(n): return f"{int(n):,.0f}".replace(',', '.')
                
                if deuda_inicio > 0:
                    legislador["hitos_personales"].append({
                        "fecha": "2023-12",
                        "texto": f"Deuda declarada (inicio 2024): ${fmt(deuda_inicio)}",
                        "monto": int(deuda_inicio),
                        "color": "#6b7280",
                        "tipo": "economico",
                        "cargo": legislador.get('cargo', 'Legislador')
                    })
                
                if deuda_fin > 0:
                    legislador["hitos_personales"].append({
                        "fecha": "2024-12",
                        "texto": f"Deuda declarada (final 2024): ${fmt(deuda_fin)}",
                        "monto": int(deuda_fin),
                        "color": "#6b7280",
                        "tipo": "economico",
                        "cargo": legislador.get('cargo', 'Legislador')
                    })
                
                legislador["hitos_personales"].sort(key=lambda x: x['fecha'])

    # --- GENERACIÓN DE PERIODOS ---
    print("Generando períodos de mandatos a partir de los hitos...")
    for legislador in datos_json['data']:
        if 'hitos_personales' in legislador:
            legislador['periodos'] = []
            periodos_abiertos = {}

            for hito in legislador['hitos_personales']:
                cargo_hito = hito.get('cargo', 'Legislador')

                if hito['texto'].startswith('Inicio'):
                    periodos_abiertos[cargo_hito] = hito['fecha']
                elif hito['texto'].startswith('Fin de mandato'):
                    if cargo_hito in periodos_abiertos:
                        fecha_inicio = periodos_abiertos.pop(cargo_hito)
                        periodo = {"cargo": cargo_hito, "inicio": fecha_inicio, "fin": hito['fecha']}
                        if periodo not in legislador['periodos']:
                            legislador['periodos'].append(periodo)

            legislador['periodos'].sort(key=lambda x: x['inicio'])

    datos_json['meta']['mep'] = get_mep()
    datos_json['meta']['ipc'] = pd.read_csv(IPC_FILE).set_index('mes')['ipc'].to_dict()
    datos_json['meta']["hitos_globales"] = GLOBAL_MILESTONES

    # --- DETECCIÓN DE CAMBIOS DE NIVEL ---
    print("Analizando cambios de nivel de deuda...")

    for legislador in datos_json['data']:
        deudas = ((pd.DataFrame(legislador['historial']).groupby('fecha')['monto'].sum() * 1000).reset_index()).to_dict(orient='records')

        hitos_nivel = analizar_cambio_nivel(deudas, datos_json['meta']['mep'], datos_json['meta']['ipc'])
        legislador['cambios_nivel'] = bool(hitos_nivel)

        if hitos_nivel:
            if "hitos_personales" not in legislador: legislador["hitos_personales"] = []
            for h in hitos_nivel:
                h['cargo'] = legislador.get('cargo', 'Legislador')
                legislador["hitos_personales"].append(h)

        if "hitos_personales" in legislador:
            legislador["hitos_personales"].sort(key=lambda x: x['fecha'])

        legislador["distrito"] = {
            'Tucuman': 'Tucumán',
            'Tierra del Fuego': 'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
            'Rio Negro': 'Río Negro',
            'Neuquen': 'Neuquén',
            'Entre Rios': 'Entre Ríos',
            'Cordoba': 'Córdoba',
            'Ciudad de Buenos Aires': 'Ciudad Autónoma de Buenos Aires',
        }.get(legislador.get('distrito', None), legislador.get('distrito', None))
        legislador["partido"] = {
          "Innovacion Federal": "Innovación Federal",
          "Partido Obrero -Frente de Izquierda y de Trabajadores -Unida": "Frente de Izquierda",
        }.get(legislador.get('partido', None), legislador.get('partido', None))

    # --- PROCESAMIENTO DE FAMILIARES ---
    if os.path.exists(FAMILIARES_CSV):
        print("\nProcesando familiares de legisladores...")
        df_fam = pd.read_csv(FAMILIARES_CSV, dtype=str)
        parentesco_map = {
            (row['cuit_legislador'], row['cuit_familiar']): row['parentesco']
            for _, row in df_fam.iterrows()
        }

        familiar_files = _familiar_files(LEGISLADORES2025_DIR)
        print(f"  Encontrados {len(familiar_files)} archivos de familiares.")

        for cuit_leg, cuit_fam, filepath in familiar_files:
            if cuit_leg not in mapa_cuit:
                continue

            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    fam_bcra = json.load(f)
            except (json.JSONDecodeError, ValueError):
                continue

            periodos = fam_bcra.get('results', {}).get('periodos', [])
            parentesco = parentesco_map.get((cuit_leg, cuit_fam), 'FAMILIAR')

            seen = {}
            for periodo in periodos:
                fecha = _periodo_a_fecha(periodo['periodo'])
                for ent in periodo.get('entidades', []):
                    entidad = clean_entity_name(ent['entidad'])
                    monto = int(ent['monto'])
                    if monto == 0:
                        continue
                    seen[(entidad, fecha)] = {
                        'entidad': entidad,
                        'fecha': fecha,
                        'situacion': ent['situacion'],
                        'monto': monto,
                    }
            historial = sorted(seen.values(), key=lambda x: x['fecha'])

            familiar_entry = {
                'parentesco': parentesco,
                'historial': historial,
                'hitos_personales': [],
            }

            if historial:
                deudas = (
                    pd.DataFrame(historial).groupby('fecha')['monto'].sum() * 1000
                ).reset_index().to_dict(orient='records')
                deudas = [d for d in deudas if d['fecha'] in datos_json['meta']['mep']]

                hitos_nivel = analizar_cambio_nivel(
                    deudas, datos_json['meta']['mep'], datos_json['meta']['ipc']
                )
                familiar_entry['cambios_nivel'] = bool(hitos_nivel)
                for h in hitos_nivel:
                    h['cargo'] = parentesco
                    familiar_entry['hitos_personales'].append(h)

                familiar_entry['hitos_personales'].sort(key=lambda x: x['fecha'])
            else:
                familiar_entry['cambios_nivel'] = False

            legislador = datos_json['data'][mapa_cuit[cuit_leg]]
            if 'familiares' not in legislador:
                legislador['familiares'] = []
            legislador['familiares'].append(familiar_entry)

        legs_con_familiares = sum(1 for leg in datos_json['data'] if leg.get('familiares'))
        print(f"  {legs_con_familiares} legisladores con familiares procesados.")

    # --- HIPOTECAS BCRA (carga única para todos los grupos) ---
    cuits_todos = {leg['cuit'] for leg in datos_json['data'] if leg.get('cuit')}
    for fp in glob.glob(os.path.join(POLITICOS_DIR, '*', '*.json')):
        cuits_todos.add(os.path.basename(fp).replace('.json', ''))
    for fp in glob.glob(os.path.join(JUDICIAL_DIR, '*', '*.json')):
        cuits_todos.add(os.path.basename(fp).replace('.json', ''))
    for fp in glob.glob(os.path.join(JGM_DIR, '*', '*.json')):
        cuits_todos.add(os.path.basename(fp).replace('.json', ''))
    print("\nCargando hipotecas BCRA...")
    hipotecas_todos = cargar_hipotecas_bcra(cuits_todos)

    # --- HIPOTECAS BCRA (legisladores) ---
    hipotecas_legs = hipotecas_todos
    for leg in datos_json['data']:
        cuit = leg.get('cuit')
        h = hipotecas_legs.get(cuit, {})
        if cuit and h.get('monto_miles_pesos', 0) > 0:
            leg['hipoteca_bcra'] = {'tiene': True, 'monto_miles_pesos': h['monto_miles_pesos'], 'entidades': h['entidades'], 'fecha': h['fecha']}
        else:
            leg['hipoteca_bcra'] = {'tiene': False}
        leg['situacion_bcra'] = h.get('situacion_actual', 0)
    print(f"  {len(hipotecas_legs)} legisladores con garantía preferida detectada.")

    # --- GUARDADO FINAL ---
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(datos_json, f, indent=2, ensure_ascii=False)

    with open(CACHE_MATCHES_FILE, 'w', encoding='utf-8') as f:
        json.dump(match_cache, f, indent=2, ensure_ascii=False)

    print(f"\nProceso finalizado.")
    print(f"Nuevos matches calculados y cacheados: {nuevos_matches_encontrados}")
    print(f"Total nombres en caché: {len(match_cache)}")
    print(f"JSON final guardado en: {OUTPUT_FILE}")

    # --- PROCESAMIENTO DE POLÍTICOS DEL EJECUTIVO ---
    meta_files = sorted(glob.glob(os.path.join(POLITICOS_DIR, 'politicos_*.json')) + ['politicos/misc.csv'])
    if meta_files and os.path.isdir(POLITICOS_DIR):
        print(f"\nProcesando políticos del ejecutivo...")
        with open(meta_files[-1], 'r', encoding='utf-8') as f:
            politicos_meta = json.load(f)

        mapa_meta = {str(p['autoridad_cuil']): p for p in politicos_meta}
        mep = datos_json['meta']['mep']
        ipc = datos_json['meta']['ipc']

        politicos_data = []
        archivos_bcra = _latest_bcra_files(POLITICOS_DIR)
        print(f"  Leyendo {len(archivos_bcra)} archivos BCRA de {POLITICOS_DIR}...")

        for filepath in archivos_bcra:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    bcra = json.load(f)
            except (json.JSONDecodeError, ValueError):
                print(f"  Archivo vacío o inválido, se omite: {filepath}")
                continue

            if bcra.get('status') != 200:
                continue
            results = bcra.get('results', {})
            cuit = str(results.get('identificacion', ''))
            denominacion = results.get('denominacion', '')
            periodos = results.get('periodos', [])

            meta = mapa_meta.get(cuit, {})

            seen = {}
            for periodo in periodos:
                fecha = _periodo_a_fecha(periodo['periodo'])
                for ent in periodo.get('entidades', []):
                    entidad = clean_entity_name(ent['entidad'])
                    monto = int(ent['monto'])
                    if monto == 0:
                        continue
                    seen[(entidad, fecha)] = {
                        'entidad': entidad,
                        'fecha': fecha,
                        'situacion': ent['situacion'],
                        'monto': monto,
                    }
            historial = sorted(seen.values(), key=lambda x: x['fecha'])

            def nombre(row):
                return f"{row['autoridad_apellido']} {row['autoridad_nombre']}".upper()
            politico = {
                'cuit': cuit,
                'nombre': denominacion if denominacion else nombre([p for p in politicos_meta if p['autoridad_cuil'] == cuit][0]),
                'cargo': simplificar_cargo(meta.get('cargo', '')),
                'unidad': meta.get('unidad_de_nivel_politico', ''),
                'historial': historial,
                'hitos_personales': [],
            }

            if historial:
                deudas = (pd.DataFrame(historial).groupby('fecha')['monto'].sum() * 1000).reset_index().to_dict(orient='records')
                deudas = [d for d in deudas if d['fecha'] in mep]

                hitos_nivel = analizar_cambio_nivel(deudas, mep, ipc)
                politico['cambios_nivel'] = bool(hitos_nivel)
                for h in hitos_nivel:
                    h['cargo'] = politico['cargo']
                    politico['hitos_personales'].append(h)

                politico['hitos_personales'].sort(key=lambda x: x['fecha'])
            else:
                politico['cambios_nivel'] = False

            politicos_data.append(politico)

        # --- PROCESAMIENTO DE FAMILIARES DE POLÍTICOS ---
        if os.path.exists(POLITICOS_FAMILIARES_CSV) and os.path.isdir(POLITICOS_FAMILIARES_DIR):
            print(f"\nProcesando familiares de políticos del ejecutivo...")
            df_fam_pol = pd.read_csv(POLITICOS_FAMILIARES_CSV, dtype=str)

            mapa_politicos = {p['cuit']: i for i, p in enumerate(politicos_data)}

            familiar_files_pol = _familiar_files(POLITICOS_FAMILIARES_DIR)
            print(f"  Encontrados {len(familiar_files_pol)} archivos de familiares.")

            for cuit_pol, cuit_fam, filepath in familiar_files_pol:
                if cuit_pol not in mapa_politicos:
                    continue

                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        fam_bcra = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    continue

                periodos = fam_bcra.get('results', {}).get('periodos', [])

                seen = {}
                for periodo in periodos:
                    fecha = _periodo_a_fecha(periodo['periodo'])
                    for ent in periodo.get('entidades', []):
                        entidad = clean_entity_name(ent['entidad'])
                        monto = int(ent['monto'])
                        if monto == 0:
                            continue
                        seen[(entidad, fecha)] = {
                            'entidad': entidad,
                            'fecha': fecha,
                            'situacion': ent['situacion'],
                            'monto': monto,
                        }
                historial = sorted(seen.values(), key=lambda x: x['fecha'])

                familiar_entry = {
                    'parentesco': 'FAMILIAR',
                    'historial': historial,
                    'hitos_personales': [],
                }

                if historial:
                    deudas = (
                        pd.DataFrame(historial).groupby('fecha')['monto'].sum() * 1000
                    ).reset_index().to_dict(orient='records')
                    deudas = [d for d in deudas if d['fecha'] in mep]

                    hitos_nivel = analizar_cambio_nivel(deudas, mep, ipc)
                    familiar_entry['cambios_nivel'] = bool(hitos_nivel)
                    for h in hitos_nivel:
                        h['cargo'] = 'FAMILIAR'
                        familiar_entry['hitos_personales'].append(h)

                    familiar_entry['hitos_personales'].sort(key=lambda x: x['fecha'])
                else:
                    familiar_entry['cambios_nivel'] = False

                politico = politicos_data[mapa_politicos[cuit_pol]]
                if 'familiares' not in politico:
                    politico['familiares'] = []
                politico['familiares'].append(familiar_entry)

            pols_con_familiares = sum(1 for p in politicos_data if p.get('familiares'))
            print(f"  {pols_con_familiares} políticos con familiares procesados.")

        # --- HIPOTECAS BCRA (políticos) ---
        hipotecas_pols = hipotecas_todos
        for pol in politicos_data:
            cuit = pol.get('cuit')
            h = hipotecas_pols.get(cuit, {})
            if cuit and h.get('monto_miles_pesos', 0) > 0:
                pol['hipoteca_bcra'] = {'tiene': True, 'monto_miles_pesos': h['monto_miles_pesos'], 'entidades': h['entidades'], 'fecha': h['fecha']}
            else:
                pol['hipoteca_bcra'] = {'tiene': False}
            pol['situacion_bcra'] = h.get('situacion_actual', 0)
        print(f"  {len(hipotecas_pols)} políticos con garantía preferida detectada.")

        politicos_output = {
            'meta': {
                'mep': mep,
                'ipc': ipc,
                'hitos_globales': [h for h in GLOBAL_MILESTONES if h.get('tipo') == 'global'],
            },
            'data': politicos_data,
        }

        with open(POLITICOS_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(politicos_output, f, indent=2, ensure_ascii=False)

        print(f"  {len(politicos_data)} políticos procesados.")
        print(f"  JSON guardado en: {POLITICOS_OUTPUT_FILE}")

    # --- MAGISTRADOS FEDERALES TITULARES (desde CSV) ---
    if os.path.isdir(JUDICIAL_DIR) and MAGISTRADOS_CSV and os.path.exists(MAGISTRADOS_CSV):
        mep = datos_json['meta']['mep']
        ipc = datos_json['meta']['ipc']

        judicial_data = []
        archivos_bcra_judicial = _latest_bcra_files(JUDICIAL_DIR)
        print(f"  Leyendo {len(archivos_bcra_judicial)} archivos BCRA de {JUDICIAL_DIR}...")

        # Índice cuit → filepath para búsqueda rápida
        bcra_por_cuit = {}
        for filepath in archivos_bcra_judicial:
            cuit = os.path.basename(filepath).replace('.json', '')
            bcra_por_cuit[cuit] = filepath

        import csv as _csv
        cuits_ya_en_judicial = set()
        print(f"\nProcesando magistrados federales desde {MAGISTRADOS_CSV}...")
        magistrados_agregados = 0
        with open(MAGISTRADOS_CSV, newline='', encoding='utf-8-sig') as f:
            for row in _csv.DictReader(f):
                if not (row['cargo_cobertura'] == 'Titular'
                        and row['cargo_vacante'] == 'NO'
                        and row['justicia_federal_o_nacional'] == 'Federal'
                        and row['magistrado_dni']):
                    continue

                cuit = cuit_desde_dni(row['magistrado_dni'], row['magistrado_genero'])
                if not cuit or cuit in cuits_ya_en_judicial:
                    continue

                nombre_raw = row['magistrado_nombre']
                if ',' in nombre_raw:
                    apellido, nombre_p = nombre_raw.split(',', 1)
                    nombre = f"{apellido.strip()} {nombre_p.strip()}".upper()
                else:
                    nombre = nombre_raw.strip().upper()

                cargo = canonicalizar_cargo_judicial(row['cargo_tipo'].upper())

                seen = {}
                if cuit in bcra_por_cuit:
                    try:
                        with open(bcra_por_cuit[cuit], 'r', encoding='utf-8') as f2:
                            bcra = json.load(f2)
                    except (json.JSONDecodeError, ValueError):
                        bcra = {}
                    if bcra.get('status') == 200:
                        for periodo in bcra.get('results', {}).get('periodos', []):
                            fecha = _periodo_a_fecha(periodo['periodo'])
                            for ent in periodo.get('entidades', []):
                                entidad = clean_entity_name(ent['entidad'])
                                monto = int(ent['monto'])
                                if monto == 0:
                                    continue
                                seen[(entidad, fecha)] = {
                                    'entidad': entidad,
                                    'fecha': fecha,
                                    'situacion': ent['situacion'],
                                    'monto': monto,
                                }

                historial = sorted(seen.values(), key=lambda x: x['fecha'])

                hitos = []
                if row.get('cargo_fecha_jura'):
                    hitos.append({
                        'fecha': row['cargo_fecha_jura'][:7],
                        'texto': f"Jura como {cargo}",
                        'color': '#6b7280',
                        'tipo': 'cargo',
                        'cargo': cargo,
                    })

                magistrado = {
                    'cuit': cuit,
                    'nombre': nombre,
                    'cargo': cargo,
                    'camara': row['camara'],
                    'organo': row['organo_nombre'],
                    'es_magistrado': True,
                    'es_candidato': False,
                    'historial': historial,
                    'hitos_personales': hitos,
                }

                if historial:
                    deudas = (
                        pd.DataFrame(historial).groupby('fecha')['monto'].sum() * 1000
                    ).reset_index().to_dict(orient='records')
                    deudas = [d for d in deudas if d['fecha'] in mep]

                    hitos_nivel = analizar_cambio_nivel(deudas, mep, ipc)
                    magistrado['cambios_nivel'] = bool(hitos_nivel)
                    for h in hitos_nivel:
                        h['cargo'] = cargo
                        magistrado['hitos_personales'].append(h)
                    magistrado['hitos_personales'].sort(key=lambda x: x['fecha'])
                else:
                    magistrado['cambios_nivel'] = False

                judicial_data.append(magistrado)
                cuits_ya_en_judicial.add(cuit)
                magistrados_agregados += 1

        print(f"  {magistrados_agregados} magistrados federales agregados.")

        # --- HIPOTECAS BCRA (magistrados federales) ---
        hipotecas_judiciales = hipotecas_todos
        for magistrado in judicial_data:
            cuit = magistrado.get('cuit')
            h = hipotecas_judiciales.get(cuit, {})
            if cuit and h.get('monto_miles_pesos', 0) > 0:
                magistrado['hipoteca_bcra'] = {
                    'tiene': True,
                    'monto_miles_pesos': h['monto_miles_pesos'],
                    'entidades': h['entidades'],
                    'fecha': h['fecha'],
                }
            else:
                magistrado['hipoteca_bcra'] = {'tiene': False}
            magistrado['situacion_bcra'] = h.get('situacion_actual', 0)
        print(f"  {len(hipotecas_judiciales)} magistrados con garantía preferida detectada.")

        judicial_output = {
            'meta': {
                'mep': mep,
                'ipc': ipc,
                'hitos_globales': [h for h in GLOBAL_MILESTONES if h.get('tipo') == 'global'],
            },
            'data': judicial_data,
        }

        with open(JUDICIAL_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(judicial_output, f, indent=2, ensure_ascii=False)

        print(f"  {len(judicial_data)} magistrados federales procesados.")
        print(f"  JSON guardado en: {JUDICIAL_OUTPUT_FILE}")

    # --- PROCESAMIENTO DE FUNCIONARIOS JGM ---
    jgm_meta_files = sorted(glob.glob(os.path.join(JGM_DIR, 'jgm_*.json')))
    if jgm_meta_files and os.path.isdir(JGM_DIR):
        print(f"\nProcesando funcionarios JGM...")
        with open(jgm_meta_files[-1], 'r', encoding='utf-8') as f:
            jgm_meta = json.load(f)

        mapa_jgm = {str(p['autoridad_cuil']): p for p in jgm_meta}
        mep = datos_json['meta']['mep']
        ipc = datos_json['meta']['ipc']

        jgm_data = []
        archivos_bcra_jgm = _latest_bcra_files(JGM_DIR)
        print(f"  Leyendo {len(archivos_bcra_jgm)} archivos BCRA de {JGM_DIR}...")

        for filepath in archivos_bcra_jgm:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    bcra = json.load(f)
            except (json.JSONDecodeError, ValueError):
                continue

            if bcra.get('status') != 200:
                continue
            results = bcra.get('results', {})
            cuit = str(results.get('identificacion', ''))
            denominacion = results.get('denominacion', '')
            periodos = results.get('periodos', [])

            meta = mapa_jgm.get(cuit, {})

            seen = {}
            for periodo in periodos:
                fecha = _periodo_a_fecha(periodo['periodo'])
                for ent in periodo.get('entidades', []):
                    entidad = clean_entity_name(ent['entidad'])
                    monto = int(ent['monto'])
                    if monto == 0:
                        continue
                    seen[(entidad, fecha)] = {
                        'entidad': entidad,
                        'fecha': fecha,
                        'situacion': ent['situacion'],
                        'monto': monto,
                    }
            historial = sorted(seen.values(), key=lambda x: x['fecha'])

            nombre_meta = f"{meta.get('autoridad_apellido', '')} {meta.get('autoridad_nombre', '')}".upper().strip()
            funcionario = {
                'cuit': cuit,
                'nombre': denominacion if denominacion else nombre_meta,
                'cargo': simplificar_cargo(meta.get('cargo', '')),
                'unidad': meta.get('unidad_de_nivel_politico', ''),
                'historial': historial,
                'hitos_personales': [],
            }

            if historial:
                deudas = (pd.DataFrame(historial).groupby('fecha')['monto'].sum() * 1000).reset_index().to_dict(orient='records')
                deudas = [d for d in deudas if d['fecha'] in mep]
                hitos_nivel = analizar_cambio_nivel(deudas, mep, ipc)
                funcionario['cambios_nivel'] = bool(hitos_nivel)
                for h in hitos_nivel:
                    h['cargo'] = funcionario['cargo']
                    funcionario['hitos_personales'].append(h)
                funcionario['hitos_personales'].sort(key=lambda x: x['fecha'])
            else:
                funcionario['cambios_nivel'] = False

            cuit_h = hipotecas_todos.get(cuit, {})
            if cuit and cuit_h.get('monto_miles_pesos', 0) > 0:
                funcionario['hipoteca_bcra'] = {'tiene': True, 'monto_miles_pesos': cuit_h['monto_miles_pesos'], 'entidades': cuit_h['entidades'], 'fecha': cuit_h['fecha']}
            else:
                funcionario['hipoteca_bcra'] = {'tiene': False}
            funcionario['situacion_bcra'] = cuit_h.get('situacion_actual', 0)

            jgm_data.append(funcionario)

        jgm_output = {
            'meta': {
                'mep': mep,
                'ipc': ipc,
                'hitos_globales': [h for h in GLOBAL_MILESTONES if h.get('tipo') == 'global'],
            },
            'data': jgm_data,
        }

        with open(JGM_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(jgm_output, f, indent=2, ensure_ascii=False)

        print(f"  {len(jgm_data)} funcionarios JGM procesados.")
        print(f"  JSON guardado en: {JGM_OUTPUT_FILE}")
