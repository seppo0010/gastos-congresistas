import pdfplumber
import re
import glob
import json
import os
import sys
from datetime import datetime

# --- 2. FUNCIONES AUXILIARES ---
def parse_date(date_str):
    try:
        return datetime.strptime(date_str, "%m/%Y")
    except ValueError:
        try:
            return datetime.strptime(date_str, "%m/%y")
        except ValueError:
            return None

def normalize_date_str(date_obj):
    return date_obj.strftime("%Y-%m") if date_obj else None

def extract_identity_from_block(text):
    """
    Busca el texto entre 'Consulta de información...' y 'Central de Deudores...'
    para extraer CUIT y Nombre con precisión, ignorando saltos de línea.
    """
    start_marker = "Consulta de información para el CUIT-CUIL-CDI"
    end_marker = "Central de Deudores del Sistema Financiero"
    
    start_idx = text.find(start_marker)
    end_idx = text.find(end_marker)
    
    if start_idx == -1 or end_idx == -1:
        return None, None

    # Extraemos el bloque sucio
    raw_block = text[start_idx + len(start_marker) : end_idx].strip()
    
    # Regex: 11 dígitos (CUIT) + Texto restante (Nombre)
    match = re.search(r'(\d{11})\s*[-]?\s*(.*)', raw_block, re.DOTALL)
    
    if match:
        cuit = match.group(1)
        # Limpiamos saltos de línea y espacios múltiples
        name = match.group(2).replace('\n', ' ').strip()
        if name.startswith('-'): name = name[1:].strip()
        # Eliminar espacios dobles si quedaron
        name = re.sub(r'\s+', ' ', name)
        return cuit, name
        
    return None, None

def print_progress(current, total, filename):
    """Imprime una barra de progreso en la misma línea"""
    percent = int((current / total) * 100)
    bar_length = 30
    filled_length = int(bar_length * current // total)
    bar = '█' * filled_length + '-' * (bar_length - filled_length)
    
    # Truncar nombre de archivo si es muy largo para que no rompa la línea
    display_name = (filename[:35] + '..') if len(filename) > 35 else filename
    
    # \r vuelve al inicio de la línea
    sys.stdout.write(f'\r[{bar}] {percent}% | {current}/{total} | {display_name:<40}')
    sys.stdout.flush()

def clean_entity_name(entity):
    entity = entity.replace('S. A. U.', 'S.A.U.')
    entity = entity.replace('S. A.', 'S.A.')
    entity = entity.replace('S. R. L.', 'S.R.L.')
    entity = entity.replace('BANCO DE LA PAMPA SOCIEDAD DE ECONOMÍA MIXTA', 'BANCO DE LA PAMPA S.A.')
    entity = entity.replace('BANCO DE GALICIA Y BUENOS AIRES S.A.U.', 'BANCO DE GALICIA Y BUENOS AIRES S.A.')
    entity = entity.replace('BANCO SANTANDER ARGENTINA SOCIEDAD ANONIMA', 'BANCO SANTANDER ARGENTINA S.A.')
    entity = entity.replace('BANCO PROVINCIA DE TIERRA DEL FUEGO O. P.', 'BANCO PROVINCIA DE TIERRA DEL FUEGO')
    entity = entity.replace('NUEVO BANCO DEL CHACO SA', 'NUEVO BANCO DEL CHACO S.A.')
    entity = entity.replace('NUEVO BANCO DE SANTA FE SOCIEDAD ANONIMA', 'NUEVO BANCO DE SANTA FE SA')
    return " ".join(entity.split())

# --- 3. PARSER PRINCIPAL ---
def parse_bcra_pdfs(pdf_paths):
    master_db = {}
    data_row_pattern = re.compile(r'(\d{2}/\d{2,4})\s+(\d+)\s+([\d\.]+)')
    
    total_files = len(pdf_paths)
    print(f"Iniciando procesamiento de {total_files} archivos...\n")

    for i, pdf_path in enumerate(pdf_paths, 1):
        print_progress(i, total_files, pdf_path)
        
        current_cuit = None
        current_entity = "Desconocido"
        in_history_section = False
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                # A. IDENTIDAD (Página 1)
                if len(pdf.pages) > 0:
                    first_page_text = pdf.pages[0].extract_text() or ""
                    cuit_found, name_found = extract_identity_from_block(first_page_text)
                    
                    if cuit_found and name_found:
                        current_cuit = cuit_found
                        
                        if current_cuit not in master_db:
                            master_db[current_cuit] = {
                                "nombre": name_found, 
                                "cuit": current_cuit, 
                                "pdf_paths": set(), # Usamos set para evitar duplicados
                                "historial_map": {}
                            }
                        master_db[current_cuit]["pdf_paths"].add(pdf_path)
                    else:
                        # Si no encontramos identidad, no podemos asignar la deuda. Saltamos.
                        continue

                # B. HISTORIAL (Todas las páginas)
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    lines = text.split('\n')
                    
                    for line in lines:
                        line = line.strip()
                        if not line: continue

                        # Control de Sección
                        if "Historia 24 meses" in line:
                            in_history_section = True
                            continue
                        if "Central de cheques rechazados" in line:
                            in_history_section = False
                            break # Fin de datos relevantes
                        
                        if not in_history_section or not current_cuit:
                            continue

                        # 1. Detectar Dato (Fecha + Situación + Monto)
                        match_data = data_row_pattern.search(line)
                        if match_data:
                            try:
                                monto = int(match_data.group(3).replace('.', ''))
                            except ValueError:
                                monto = 0
                            
                            dt_obj = parse_date(match_data.group(1))
                            if dt_obj:
                                fecha_iso = normalize_date_str(dt_obj)
                                # Clave única: Banco + Mes
                                record_key = (clean_entity_name(current_entity), fecha_iso)
                                
                                master_db[current_cuit]["historial_map"][record_key] = {
                                    "entidad": current_entity, 
                                    "fecha": fecha_iso, 
                                    "situacion": int(match_data.group(2)), 
                                    "monto": monto, 
                                    "_dt": dt_obj
                                }
                            continue

                        # 2. Detectar Banco/Entidad
                        ignore = ["Período", "Situación", "Monto", "Judicial", "Observaciones", "The following"]
                        # Heurística: Línea larga, mayúscula, sin números al inicio y palabras clave bancarias
                        if (len(line) > 4 
                            and not line[0].isdigit() 
                            and not any(k in line for k in ignore) 
                            and (
                                "BANCO" in line.upper() or
                                "S.A." in line or
                                "FIDEICOMISO" in line or
                                "TARJETA" in line or
                                "AMERICAN" in line or
                                "FINANCIERA" in line or
                                'S.R.L.' in line)):
                            current_entity = line.strip().strip('+').strip()

        except Exception as e:
            # Capturar errores de archivo corrupto o no encontrado sin detener todo
            # Imprimimos en nueva línea para no romper la barra
            sys.stdout.write(f"\n[Error] {pdf_path}: {e}\n")

    sys.stdout.write("\n\nGenerando JSON final...")
    
    # --- 4. CONSTRUCCIÓN DEL JSON ---
    legisladores_list = []
    for cuit, data in master_db.items():
        # Aplanar historial
        historial = list(data["historial_map"].values())
        historial.sort(key=lambda x: x["_dt"])
        for h in historial: del h["_dt"]
        
        legisladores_list.append({
            "cuit": cuit,
            "nombre": data["nombre"],
            "pdf_paths": list(data["pdf_paths"]), # Convertir set a lista
            "hitos_personales": [],
            "historial": historial
        })

    final_json = {
        "meta": {
        },
        "data": legisladores_list
    }
    
    print(" ¡Listo!")
    return final_json

if __name__ == "__main__":
    # Busca todos los PDFs en el directorio actual y cualquier subdirectorio
    print("Buscando archivos PDF en subdirectorios...")
    files_to_process = glob.glob('**/*.pdf', recursive=True)

    if files_to_process:
        print(f"Se encontraron {len(files_to_process)} archivos. Procesando...")
        data = parse_bcra_pdfs(files_to_process)

        output_file = 'legisladores_full.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        print(f"\n[OK] Base de datos guardada en '{output_file}' con {len(data['data'])} legisladores.")
    else:
        print("No se encontraron archivos .pdf en este directorio ni en sus subcarpetas.")
