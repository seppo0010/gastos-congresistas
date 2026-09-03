import json
import pandas as pd
from collections import defaultdict
import os

# --- CONFIGURACIÓN ---
SENADORES_FILE = 'senadores_argentinadatos.json'
DIPUTADOS_FILE = 'diputados_argentinadatos.json'
OUTPUT_CSV = 'historial_legisladores_completo.csv'
MIN_DATE = '2019-12-09'

def clean_bloque(bloque):
    return {
        'Frente Todos': 'Alianza Frente de Todos',
        'Ucr': 'Unión Cívica Radical',
        'Ucr - Union Civica Radical': 'Unión Cívica Radical',
        'Ucr - Uniã\x93n Cã\x8dvica Radical': 'Unión Cívica Radical',
        'Pro': 'PRO',
        'Partido Propuesta Salteã\x91a': 'Partido Propuesta Salteña',
        'Izquierda Socialista - Frente de Izquierda': 'Frente de Izquierda',
        'Partido Obrero Frente de Izquierda y de Trabajadores Unidad': 'Frente de Izquierda',
        'Frente de Izquierda y de Trabajadores - Unidad': 'Frente de Izquierda',
        'Pts - Frente de Izquierda y de Trabajadores - Unidad': 'Frente de Izquierda',
        'Partido Obrero Â Frente de Izquierda y de Trabajadores - Unidad': 'Frente de Izquierda',
        'Frente de Izquierda y de Trabajadores Unidad': 'Frente de Izquierda',
        'Pts-Frente de Izquierda Unidad': 'Frente de Izquierda',
        'Partido Obrero-Frente de Izquierda y Trabajadores Unidad': 'Frente de Izquierda',
        'Izquierda Socialista Fit-Unidad': 'Frente de Izquierda',
        'Partido Obrero -Frente de Izquierda y de Trabajadores -Unidad': 'Frente de Izquierda',
        'Mst - Frente de Izquierda y Trabajadores Unidad': 'Frente de Izquierda',
        'Partido Obrero Â\x80\x93 Frente de Izquierda y de Trabajadores - Uni': 'Frente de Izquierda',
        'Partido Obrero Â\x80\x93 Frente de Izquierda y de Trabajadores - Unidad': 'Frente de Izquierda',
        'No Integra Bloque': 'Sin Bloque',
        'Bloque Unipersonal': 'Sin Bloque',
        'La Uniã\x93n Mendocina': 'La Union Mendocina',
        'Innovaciã\x93n Federal': 'Innovación Federal',
        'Uniã\x93n por la Patria': 'Unión por la Patria',
        'Hacemos Coaliciã\x93n Federal': 'Hacemos Coalición Federal',
        'Hacemos por Nuestro Paã\x8Ds': 'Hacemos por Nuestro País',
        'Coalicion Civica': 'Coalición Cívica',
        'Coaliciã\x93n Cã\x8Dvica': 'Coalición Cívica',
        'Transformaciã\x93n b.t': 'Transformación b.t',
        'Transformaciã\x93n': 'Transformación',
        'Mid - Movimiento de Integraciã\x93n y Desarrollo': 'Mid - Movimiento de Integración y Desarrollo',
        'Union por la Patria': 'Unión por la Patria',
        'Uniã\x93n por la Patria': 'Unión por la Patria',
    }.get(bloque, bloque)
    
# --- BUCLE PRINCIPAL ---

def reformat_senator_name(name):
    """Convierte "Apellido, Nombre" a "Nombre Apellido"."""
    if not isinstance(name, str):
        return ""
    parts = name.split(',')
    if len(parts) == 2:
        return f"{parts[1].strip()} {parts[0].strip()}"
    return name.strip()

def format_date(date_str):
    """Convierte fechas a formato ISO 8601 UTC (YYYY-MM-DDTHH:MM:SSZ)."""
    if not date_str:
        return None
    try:
        dt = pd.to_datetime(date_str, utc=True)
        return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    except (ValueError, TypeError):
        print(f"\nAdvertencia: No se pudo parsear la fecha '{date_str}'")
        return None

def process_senadores(filepath):
    """Procesa el archivo JSON de senadores y genera eventos históricos."""
    print(f"Procesando senadores desde {filepath}...")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: No se encontró el archivo {filepath}")
        return []
    
    eventos = []
    for record in data:
        nombre_leg = reformat_senator_name(record.get('nombre'))
        if not nombre_leg:
            continue

        distrito = record.get('provincia')
        bloque = clean_bloque(record.get('partido', 'Sin Especificar'))
        
        fecha_inicio = record.get('periodoReal', {}).get('inicio')
        fecha_fin_real = record.get('periodoReal', {}).get('fin')
        fecha_fin_legal = record.get('periodoLegal', {}).get('fin')

        # Evento de Inicio
        if fecha_inicio and fecha_inicio >= MIN_DATE:
            eventos.append({
                "fecha": format_date(fecha_inicio),
                "legislador": nombre_leg,
                "cargo": "Senador",
                "distrito": distrito,
                "bloque_anterior": None,
                "bloque_nuevo": bloque,
                "tipo_evento": "Inicio/Alta"
            })

        # Evento de Fin
        if fecha_fin_real and fecha_fin_real >= MIN_DATE:
            tipo_evento = "Fin de Mandato"
            bloque_nuevo_fin = "Fin de Mandato"
            
            if fecha_fin_legal and fecha_fin_real < fecha_fin_legal:
                tipo_evento = "Baja"
                bloque_nuevo_fin = "Fin de Mandato/Renuncia"

            eventos.append({
                "fecha": format_date(fecha_fin_real),
                "legislador": nombre_leg,
                "cargo": "Senador",
                "distrito": distrito,
                "bloque_anterior": bloque,
                "bloque_nuevo": bloque_nuevo_fin,
                "tipo_evento": tipo_evento
            })
            
    print(f"Se procesaron {len(data)} registros de senadores, generando {len(eventos)} eventos.")
    return eventos

def process_diputados(filepath):
    """Procesa el archivo JSON de diputados y genera eventos históricos."""
    print(f"Procesando diputados desde {filepath}...")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: No se encontró el archivo {filepath}")
        return []

    legislator_mandates = defaultdict(list)
    for record in data:
        legislator_id = record.get('id')
        mandato = record.get('periodoMandato', {})
        mandate_key = (mandato.get('inicio'), mandato.get('fin'))
        
        if not legislator_id or not mandate_key[0]:
            continue
            
        key = (legislator_id, mandate_key)
        legislator_mandates[key].append(record)

    eventos = []
    for (legislator_id, mandate_key), records in legislator_mandates.items():
        records.sort(key=lambda r: r.get('periodoBloque', {}).get('inicio') or '9999-12-31')
        
        if not records:
            continue

        primer_registro = records[0]
        nombre_leg = f"{primer_registro.get('nombre', '')} {primer_registro.get('apellido', '')}".strip().replace('ã\x91', 'ñ')
        distrito = primer_registro.get('provincia')
        
        fecha_inicio_bloque = primer_registro.get('periodoBloque', {}).get('inicio')
        if not fecha_inicio_bloque:
            fecha_inicio_bloque = primer_registro.get('periodoMandato', {}).get('inicio')

        if fecha_inicio_bloque >= MIN_DATE:
            eventos.append({
                "fecha": format_date(fecha_inicio_bloque),
                "legislador": nombre_leg,
                "cargo": "Diputado",
                "distrito": distrito,
                "bloque_anterior": None,
                "bloque_nuevo": clean_bloque(primer_registro.get('bloque')),
                "tipo_evento": "Inicio/Alta"
            })

        for i in range(1, len(records)):
            bloque_anterior = clean_bloque(records[i-1].get('bloque'))
            bloque_nuevo = clean_bloque(records[i].get('bloque'))
            fecha_cambio = records[i].get('periodoBloque', {}).get('inicio')
            
            if bloque_anterior != bloque_nuevo and fecha_cambio and fecha_cambio >= MIN_DATE:
                eventos.append({
                    "fecha": format_date(fecha_cambio),
                    "legislador": nombre_leg,
                    "cargo": "Diputado",
                    "distrito": distrito,
                    "bloque_anterior": bloque_anterior,
                    "bloque_nuevo": bloque_nuevo,
                    "tipo_evento": "Cambio"
                })

        fecha_fin_real = primer_registro.get('ceseFecha')
        fecha_fin_legal = mandate_key[1]
        
        if fecha_fin_real and fecha_fin_real >= MIN_DATE:
            tipo_evento = "Fin de Mandato"
            bloque_nuevo_fin = "Fin de Mandato"
            
            if fecha_fin_legal and fecha_fin_real < fecha_fin_legal:
                tipo_evento = "Baja"
                bloque_nuevo_fin = "Fin de Mandato/Renuncia"

            eventos.append({
                "fecha": format_date(fecha_fin_real),
                "legislador": nombre_leg,
                "cargo": "Diputado",
                "distrito": distrito,
                "bloque_anterior": clean_bloque(records[-1].get('bloque')),
                "bloque_nuevo": bloque_nuevo_fin,
                "tipo_evento": tipo_evento
            })
            
    print(f"Se procesaron {len(data)} registros de diputados, generando {len(eventos)} eventos.")
    return eventos

if __name__ == "__main__":
    registro_historico = []

    if not os.path.exists(DIPUTADOS_FILE) and os.path.exists('diputados_argentinadatos_sample.json'):
        print(f"Advertencia: No se encontró '{DIPUTADOS_FILE}', usando el archivo de muestra.")
        DIPUTADOS_FILE = 'diputados_argentinadatos_sample.json'

    if not os.path.exists(SENADORES_FILE) and os.path.exists('senadores_argentinadatos_sample.json'):
        print(f"Advertencia: No se encontró '{SENADORES_FILE}', usando el archivo de muestra.")
        SENADORES_FILE = 'senadores_argentinadatos_sample.json'

    registro_historico.extend(process_senadores(SENADORES_FILE))
    registro_historico.extend(process_diputados(DIPUTADOS_FILE))

    if not registro_historico:
        print("\nNo se generaron eventos. Verifique que los archivos de entrada existan y no estén vacíos.")
    else:
        df_final = pd.DataFrame(registro_historico)
        
        df_final.dropna(subset=['fecha'], inplace=True)
        
        df_final.sort_values(by='fecha', inplace=True)
        
        print(f"\nTotal eventos generados: {len(df_final)}")
        df_final.to_csv(OUTPUT_CSV, index=False)
        print(f"Historial guardado en '{OUTPUT_CSV}'")

