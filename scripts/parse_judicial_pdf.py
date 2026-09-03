#!/usr/bin/env python3
"""
parse_judicial_pdf.py

Lee PDFs con capa de texto OCR (generados por ocrmypdf) de candidatos
propuestos para el poder judicial y extrae datos estructurados:
nombre, cargo, organo, dni, mensaje, genero, cuit.

Uso:
    python3 parse_judicial_pdf.py --input-dir judicial/ocr/ --output judicial/candidatos_2026-03.json
"""

import argparse
import glob
import json
import os
import re

import pdfplumber


def derive_cuit(dni: int, gender: str) -> str:
    """Deriva el CUIT a partir del DNI y género ('M' o 'F')."""
    prefix = 27 if gender == 'F' else 20
    base = f"{prefix}{dni:08d}"
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(int(c) * w for c, w in zip(base, weights))
    check = 11 - (total % 11)
    if check == 11:
        check = 0
    elif check == 10:
        # Dígito verificador inválido → usar prefijo 23
        prefix = 23
        base = f"{prefix}{dni:08d}"
        total = sum(int(c) * w for c, w in zip(base, weights))
        check = 11 - (total % 11)
        if check == 11:
            check = 0
    return f"{base}{check}"


def normalizar_nombre(nombre_raw: str) -> str:
    """Convierte 'Juan Carlos GARCIA LOPEZ' → 'GARCIA LOPEZ JUAN CARLOS'."""
    tokens = nombre_raw.split()
    apellido = [t for t in tokens if t == t.upper() and t.isalpha()]
    nombre = [t for t in tokens if not (t == t.upper() and t.isalpha())]
    return ' '.join(apellido + nombre).upper()


def canonicalizar_cargo_judicial(cargo: str) -> str:
    """Normaliza cargo judicial: sin artículo inicial, forma no marcada con /A."""
    c = cargo.strip()
    # Quitar artículo inicial (LA, EL)
    c = re.sub(r'^(?:LA|EL)\s+', '', c)
    # Unificar sustantivos con género marcado → forma /A
    c = re.sub(r'\bJUEZA\b', 'JUEZ/A', c)
    c = re.sub(r'\bJUEZ\b(?!/)', 'JUEZ/A', c)
    c = re.sub(r'\bDEFENSORA\b', 'DEFENSOR/A', c)
    c = re.sub(r'\bDEFENSOR\b(?!/)', 'DEFENSOR/A', c)
    c = re.sub(r'\bFISCALA\b', 'FISCAL', c)
    # Unificar adjetivos con género marcado
    c = re.sub(r'\bPÚBLICA\b', 'PÚBLICO/A', c)
    c = re.sub(r'\bPÚBLICO\b(?!/)', 'PÚBLICO/A', c)
    return c


def infer_gender(cargo: str, nombre: str) -> str:
    """Infiere género desde el título del cargo; cae en análisis del primer nombre."""
    c = cargo.lower()
    if re.search(r'\bjueza\b', c):
        return 'F'
    if re.search(r'\bdefensora\b', c):
        return 'F'
    if re.search(r'\bfiscala\b', c):
        return 'F'
    if re.search(r'\bjuez\b', c):
        return 'M'
    if re.search(r'\bdefensor\b', c):
        return 'M'
    if re.search(r'\bfiscal\b', c):
        return 'M'

    # Para "Vocal" u otros títulos neutros, usamos el primer nombre
    female_names = {
        'maria', 'paula', 'ivana', 'samanta', 'soledad', 'veronica', 'lucila',
        'laura', 'gloria', 'ines', 'julia', 'marcela', 'analia', 'andrea',
        'carolina', 'monica', 'patricia', 'alejandra', 'silvina', 'claudia',
        'fabiana', 'lorena', 'analía', 'verónica', 'inés', 'lucía', 'lucia',
        'natalia', 'valeria', 'graciela', 'susana', 'rosa', 'beatriz',
    }
    first = nombre.strip().split()[0].lower() if nombre.strip() else ''
    if first in female_names:
        return 'F'
    # Nombres que terminan en 'a' (heurística para nombres femeninos en español)
    if first.endswith('a') and len(first) > 3 and first not in {'garcia', 'andrea'}:
        return 'F'

    return 'M'


def extract_text(pdf_path: str) -> str:
    """Extrae texto de un PDF con capa OCR usando pdfplumber."""
    parts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
    return '\n'.join(parts)


# Palabras que típicamente inician el nombre del órgano judicial
_ORGANO_RE = re.compile(
    r'(?:Tribunal|Juzgado|C[aá]mara|Defensor[ií]a|Fiscal[ií]a|Ministerio|'
    r'Corte|Secretar[ií]a|Procurac)',
    re.IGNORECASE,
)

# Preposiciones (en mayúsculas) que separan cargo de órgano
_PREP_ORGANO_UPPER = re.compile(
    r'\b(?:DEL|DE LA|DE LOS|DE LAS|ANTE LOS?|ANTE LA|EN EL)\b'
)


def _split_cargo_organo(cargo_organo: str) -> tuple[str, str]:
    """Separa 'JUEZ DE CÁMARA DEL TRIBUNAL...' en (cargo, organo)."""
    for prep_m in _PREP_ORGANO_UPPER.finditer(cargo_organo):
        rest = cargo_organo[prep_m.end():].strip()
        if _ORGANO_RE.match(rest):
            return cargo_organo[:prep_m.start()].strip(), rest
    return cargo_organo, ''


def parse_referencia(text: str) -> dict:
    """
    Extrae nombre, cargo y órgano desde el bloque REFERENCIA del texto OCR.

    Formato real (GDE): "Referencia: Mensaje - NOMBRE - Solicita acuerdo -
    Designación de CARGO DEL ORGANO"
    """
    # Unir todas las líneas del bloque REFERENCIA hasta la siguiente línea en blanco
    ref_match = re.search(
        r'Referencia\s*:\s*(.*?)(?:\n{2,}|AL H\.|Tengo el agrado)',
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if not ref_match:
        return {}

    ref_text = re.sub(r'\s+', ' ', ref_match.group(1).replace('\n', ' ')).strip()

    # Formato GDE: "Mensaje[-] [NAME] Solicita acuerdo[-] [Designación [de]] CARGO DEL ORGANO"
    # Usamos "Solicita acuerdo" como ancla en lugar de los guiones (que varían por OCR)
    m_nombre = re.search(
        r'Mensaje\s*[-–—]?\s*(.+?)\s*Solicita\s+acuerdo',
        ref_text,
        re.IGNORECASE,
    )
    m_cargo = re.search(
        r'Solicita\s+acuerdo\s*[-–—]\s*(?:Designaci[oó]n\s+(?:de\s+)?)?(.+)',
        ref_text,
        re.IGNORECASE,
    )
    if m_nombre and m_cargo:
        nombre_raw = m_nombre.group(1).strip().strip('-–— ').strip()
        cargo_organo_raw = m_cargo.group(1).strip().rstrip('.')
        if nombre_raw:
            cargo, organo = _split_cargo_organo(cargo_organo_raw.upper())
            return {'nombre': normalizar_nombre(nombre_raw), 'nombre_raw': nombre_raw, 'cargo': canonicalizar_cargo_judicial(cargo), 'organo': organo}

    # Fallback: "designar a NAME como CARGO del ORGANO" (otros formatos)
    m2 = re.search(
        r'(?:designar|confirmar)\s+a\s+(.+?)\s+como\s+(.+?)[\.\n]',
        ref_text,
        re.IGNORECASE,
    )
    if m2:
        nombre_raw = m2.group(1).strip()
        cargo_organo_raw = m2.group(2).strip().upper()
        cargo, organo = _split_cargo_organo(cargo_organo_raw)
        return {'nombre': normalizar_nombre(nombre_raw), 'nombre_raw': nombre_raw, 'cargo': canonicalizar_cargo_judicial(cargo), 'organo': organo}

    return {}


def parse_dni(text: str) -> str | None:
    """
    Extrae el número de DNI del texto OCR.

    Maneja variaciones de OCR como 'D'N.L N*', 'D.N.I. N°', 'D.N.l N*', etc.
    Solo acepta DNIs de 7 u 8 dígitos (rango válido Argentina).
    """
    # Patrón permisivo: D + cualquier ruido + N + cualquier ruido + I + separador + N + símbolo + número
    m = re.search(
        r'[Dd][\'.\s]*[Nn][\'.\s]*[IiLl1][Ll]?[\'.\s]*\s*[Nn]\s*[\*°o?9]\s*([\d\.]+)',
        text,
    )
    if m:
        dni = m.group(1).replace('.', '').strip()
        if 7 <= len(dni) <= 8:
            return dni
    return None


def parse_mensaje(text: str) -> str | None:
    """Extrae número de expediente GDE (e.g. MEN-2026-25-APN-PTE)."""
    m = re.search(r'\b((?:MEN|MSG|EX|IF)-\d{4}-[\d]+-[A-Z\-]+)\b', text, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return None


def parse_pdf(pdf_path: str) -> dict | None:
    """Parsea un PDF judicial y retorna los datos estructurados, o None en error."""
    try:
        text = extract_text(pdf_path)
    except Exception as e:
        print(f"  Error leyendo {pdf_path}: {e}")
        return None

    if not text.strip():
        print(f"  Sin texto extraíble en {pdf_path} (¿falta OCR?)")
        return None

    ref = parse_referencia(text)
    dni_str = parse_dni(text)
    mensaje = parse_mensaje(text)

    nombre = ref.get('nombre', '')
    nombre_raw = ref.get('nombre_raw', nombre)
    cargo = ref.get('cargo', '')
    organo = ref.get('organo', '')

    entry: dict = {
        'nombre': nombre,
        'cargo': cargo,
        'organo': organo,
        'mensaje': mensaje,
        'pdf': os.path.basename(pdf_path),
    }

    if dni_str:
        try:
            dni_int = int(dni_str)
            genero = infer_gender(cargo, nombre_raw)
            entry['dni'] = dni_str
            entry['genero'] = genero
            entry['cuit'] = derive_cuit(dni_int, genero)
        except ValueError:
            print(f"  DNI inválido en {pdf_path}: {dni_str!r}")

    if not nombre:
        print(f"  Advertencia: no se pudo extraer nombre de {os.path.basename(pdf_path)}")

    return entry


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Extrae candidatos judiciales de PDFs con capa OCR'
    )
    parser.add_argument('--input-dir', required=True, help='Directorio con PDFs OCR\'eados')
    parser.add_argument('--output', required=True, help='Ruta del JSON de salida')
    args = parser.parse_args()

    pdfs = sorted(glob.glob(os.path.join(args.input_dir, '*.pdf')))
    if not pdfs:
        print(f"No se encontraron PDFs en {args.input_dir}")
        return

    print(f"Procesando {len(pdfs)} PDFs judiciales...")
    candidatos = []
    for pdf_path in pdfs:
        print(f"  {os.path.basename(pdf_path)}...", end=' ')
        result = parse_pdf(pdf_path)
        if result:
            candidatos.append(result)
            nombre = result.get('nombre') or '(sin nombre)'
            cuit = result.get('cuit', '(sin CUIT)')
            print(f"{nombre} | {cuit}")
        else:
            print("OMITIDO")

    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(candidatos, f, ensure_ascii=False, indent=2)

    with_cuit = sum(1 for c in candidatos if c.get('cuit'))
    print(f"\n{len(candidatos)} candidatos extraídos ({with_cuit} con CUIT) → {args.output}")


if __name__ == '__main__':
    main()
