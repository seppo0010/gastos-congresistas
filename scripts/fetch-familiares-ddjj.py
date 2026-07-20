#!/usr/bin/env python3
"""
Descarga las Declaraciones Juradas Patrimoniales Integrales (DJPI) del sistema
de consulta pública de la Oficina Anticorrupción y extrae el "Grupo Familiar"
(cónyuge/conviviente e hijos) de cada legislador.

Flujo (verificado por HTTP directo, sin captcha):
  1. POST /consultaddjj/Home/ObtenerDeclaracionesJuradas
       params: CUIT + anio (+ datos del consultante) -> JSON con Ids de DDJJ.
  2. GET  /consultaddjj/Home/DescargarDeclaracion?id=<Id>&<datos consultante>
       -> PDF público de la DJPI.
  3. pdftotext -layout y parseo de la sección "4 Grupo Familiar":
       CUIT/CUIL, Apellido y Nombre/s, Sexo, Fecha Nac., Parentesco.

Salida:
  out/ddjj/search/<cuit>/<anio>.json   cache de búsquedas
  out/ddjj/pdf/<id>.pdf                PDFs descargados
  out/ddjj/familiares.json             { cuit_legislador: { nombre, familiares: [...] } }
  out/ddjj/manifest.jsonl              una línea por PDF procesado

Reanudable: no repite búsquedas ni descargas ya hechas.

Uso:
  python3 scripts/fetch-familiares-ddjj.py
  python3 scripts/fetch-familiares-ddjj.py --years 2023-2025 --limit 5
  python3 scripts/fetch-familiares-ddjj.py --cuit 27224913465 23213594729
  python3 scripts/fetch-familiares-ddjj.py --input public/politicos_full.json
"""

import argparse
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://www2.jus.gov.ar/consultaddjj"
SEARCH_URL = f"{BASE}/Home/ObtenerDeclaracionesJuradas"
DOWNLOAD_URL = f"{BASE}/Home/DescargarDeclaracion"
FORM_URL = f"{BASE}/Home/Busqueda"

# Sesión con cookies: DescargarDeclaracion devuelve 500 sin la cookie de sesión
# que se obtiene al cargar el formulario de búsqueda.
_CJ = http.cookiejar.CookieJar()
_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_CJ))
_SESSION_STARTED = False
_SESSION_LOCK = threading.Lock()

# Datos del consultante requeridos por el formulario público de la OA.
CONSULTANTE = {
    "nombreConsultante": os.environ.get("DDJJ_CONSULTANTE_NOMBRE", "Juan Perez"),
    "tipoDocumentoConsultante": os.environ.get("DDJJ_CONSULTANTE_TIPODOC", "1"),
    "documentoConsultante": os.environ.get("DDJJ_CONSULTANTE_DOC", "30000000"),
    "domicilioConsultante": os.environ.get("DDJJ_CONSULTANTE_DOMICILIO", "Calle Falsa 123"),
    "telefonoConsultante": os.environ.get("DDJJ_CONSULTANTE_TEL", "1100000000"),
    "emailConsultante": os.environ.get("DDJJ_CONSULTANTE_EMAIL", "test@example.com"),
    "ocupacionConsultante": os.environ.get("DDJJ_CONSULTANTE_OCUPACION", "Periodista"),
    "motivoConsulta": os.environ.get("DDJJ_CONSULTANTE_MOTIVO", "1"),
    "acepta": "true",
}

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
PARENTESCOS_VALIDOS = {"CONYUGE / CONVIVIENTE", "HIJO/A", "PADRE/MADRE", "HERMANO/A"}


def ensure_session():
    """Carga el formulario y hace una búsqueda mínima: DescargarDeclaracion
    exige una búsqueda reciente dentro de la misma sesión ASP.NET."""
    global _SESSION_STARTED
    with _SESSION_LOCK:
        if not _SESSION_STARTED:
            http_get(FORM_URL)
            try:
                http_post(SEARCH_URL, {
                    "apellido": "a", "nombres": "", "CUIT": "",
                    "anio": "2023", "cargo": "", "page": 1, "recordsPage": 1,
                    **CONSULTANTE,
                })
            except Exception:  # noqa: BLE001
                pass
            _SESSION_STARTED = True


def http_post(url, data, timeout=60, opener=None):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    with (opener or _OPENER).open(req, timeout=timeout) as r:
        return r.read()


def http_get(url, timeout=120, opener=None):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with (opener or _OPENER).open(req, timeout=timeout) as r:
        return r.read()


def new_session_opener():
    """Sesión ASP.NET nueva (form + nada). Devuelve un opener con cookies."""
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    http_get(FORM_URL, opener=opener)
    return opener


def search_in_session(opener, cuit, anio, retries=3):
    """Búsqueda real dentro de la sesión: necesaria para habilitar la descarga
    de las declaraciones de esa persona (el servidor valida contra la sesión)."""
    params = {
        "apellido": "", "nombres": "", "CUIT": cuit,
        "anio": str(anio), "cargo": "",
        "page": 1, "recordsPage": 100,
        **CONSULTANTE,
    }
    last_err = None
    for attempt in range(retries):
        try:
            raw = http_post(SEARCH_URL, params, opener=opener)
            return json.loads(raw.decode("utf-8")).get("data", [])
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1 + attempt * 2)
    print(f"  [search-session] ERROR {cuit}/{anio}: {last_err}", file=sys.stderr)
    return []


def download_in_session(opener, decl_id, pdf_path, delay, retries=2):
    qs = urllib.parse.urlencode({
        "id": decl_id,
        "nombreApellidoConsultante": CONSULTANTE["nombreConsultante"],
        "tipoDocumentoConsultante": CONSULTANTE["tipoDocumentoConsultante"],
        "documentoConsultante": CONSULTANTE["documentoConsultante"],
        "domicilioConsultante": CONSULTANTE["domicilioConsultante"],
        "telefonoConsultante": CONSULTANTE["telefonoConsultante"],
        "emailConsultante": CONSULTANTE["emailConsultante"],
        "ocupacionConsultante": CONSULTANTE["ocupacionConsultante"],
        "razonSocialSolicitante": "",
        "direccionTelefonoSolicitante": "",
        "motivoConsulta": CONSULTANTE["motivoConsulta"],
        "destinoConsulta": "",
    })
    last_err = None
    for attempt in range(retries):
        try:
            raw = http_get(f"{DOWNLOAD_URL}?{qs}", opener=opener)
            if not raw.startswith(b"%PDF"):
                raise ValueError(f"respuesta no-PDF ({len(raw)} bytes)")
            with open(pdf_path, "wb") as f:
                f.write(raw)
            time.sleep(delay)
            return True
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(delay + 2 + attempt * 3)
    print(f"  [download] ERROR id={decl_id}: {last_err}", file=sys.stderr)
    return False


def fetch_cuit_pdfs(cuit, items, pdf_dir, delay):
    """Sesión dedicada por legislador. items = [(decl_id, anio)].

    El servidor solo habilita la descarga de declaraciones devueltas por la
    ÚLTIMA búsqueda de la sesión: hay que intercalar búsqueda(año) + descargas
    de ese año. Devuelve (ok, fail)."""
    ok = fail = 0
    try:
        opener = new_session_opener()
    except Exception as e:  # noqa: BLE001
        print(f"  [sesión] ERROR {cuit}: {e}", file=sys.stderr)
        return ok, len(items)
    for anio, ids in _group_by_anio(items):
        search_in_session(opener, cuit, anio)
        time.sleep(delay)
        for decl_id in ids:
            pdf_path = os.path.join(pdf_dir, f"{decl_id}.pdf")
            if download_in_session(opener, decl_id, pdf_path, delay):
                ok += 1
            else:
                fail += 1
    return ok, fail


def _group_by_anio(items):
    orden = sorted(items, key=lambda x: (x[1] or 0))
    grupos = []
    for decl_id, anio in orden:
        if grupos and grupos[-1][0] == anio:
            grupos[-1][1].append(decl_id)
        else:
            grupos.append((anio, [decl_id]))
    return grupos


def search_ddjj(cuit, anio, cache_dir, delay, retries=3):
    """Retorna la lista de declaraciones {Id, ApellidoNombre, CUIT, Año, ...}."""
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{anio}.json")
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)

    params = {
        "apellido": "", "nombres": "", "CUIT": cuit,
        "anio": str(anio), "cargo": "",
        "page": 1, "recordsPage": 100,
        **CONSULTANTE,
    }
    last_err = None
    for attempt in range(retries):
        try:
            raw = http_post(SEARCH_URL, params)
            data = json.loads(raw.decode("utf-8"))
            rows = data.get("data", [])
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False)
            time.sleep(delay)
            return rows
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(delay * (attempt + 2))
    print(f"  [search] ERROR {cuit}/{anio}: {last_err}", file=sys.stderr)
    return []


def download_pdf(decl_id, pdf_dir, delay, retries=2):
    os.makedirs(pdf_dir, exist_ok=True)
    pdf_path = os.path.join(pdf_dir, f"{decl_id}.pdf")
    if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
        return pdf_path

    qs = urllib.parse.urlencode({
        "id": decl_id,
        "nombreApellidoConsultante": CONSULTANTE["nombreConsultante"],
        "tipoDocumentoConsultante": CONSULTANTE["tipoDocumentoConsultante"],
        "documentoConsultante": CONSULTANTE["documentoConsultante"],
        "domicilioConsultante": CONSULTANTE["domicilioConsultante"],
        "telefonoConsultante": CONSULTANTE["telefonoConsultante"],
        "emailConsultante": CONSULTANTE["emailConsultante"],
        "ocupacionConsultante": CONSULTANTE["ocupacionConsultante"],
        "razonSocialSolicitante": "",
        "direccionTelefonoSolicitante": "",
        "motivoConsulta": CONSULTANTE["motivoConsulta"],
        "destinoConsulta": "",
    })
    last_err = None
    for attempt in range(retries):
        try:
            raw = http_get(f"{DOWNLOAD_URL}?{qs}")
            if not raw.startswith(b"%PDF"):
                raise ValueError(f"respuesta no-PDF ({len(raw)} bytes)")
            with open(pdf_path, "wb") as f:
                f.write(raw)
            time.sleep(delay)
            return pdf_path
        except Exception as e:  # noqa: BLE001
            last_err = e
            with _SESSION_LOCK:
                globals()["_SESSION_STARTED"] = False  # la sesión ASP.NET expira
            try:
                ensure_session()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(delay + min(2 ** attempt * 2, 10))
    print(f"  [download] ERROR id={decl_id}: {last_err}", file=sys.stderr)
    return None


ROW_RE = re.compile(
    r"^\s*(?:(\d{2}-\d{6,8}-\d)\s+)?"          # CUIT/CUIL (puede faltar)
    r"(.+?)\s{2,}"                              # Apellido y Nombre/s
    r"(Masculino|Femenino)\s+"                  # Sexo
    r"(\d{2}/\d{2}/\d{4})\s*"                   # Fecha Nac.
    r"(.*?)\s*$"                                # Parentesco (puede cortarse)
)


def parse_grupo_familiar(pdf_path):
    """Extrae familiares de la sección '4 Grupo Familiar' usando pdftotext."""
    try:
        txt = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            check=True, capture_output=True, text=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  [parse] pdftotext falló en {pdf_path}: {e}", file=sys.stderr)
        return []

    m = re.search(r"4\s+Grupo Familiar(.*?)(?:\n\s*5\s+Bienes|\f\s*5\s+Bienes)", txt, re.S)
    if not m:
        return []
    section = m.group(1)

    familiares = []
    current = None
    for line in section.splitlines():
        if not line.strip() or "CUIT / CUIL" in line or "Apellido y Nombre" in line:
            continue
        row = ROW_RE.match(line)
        if row and row.group(2) and row.group(3):
            if current:
                familiares.append(current)
            cuit = (row.group(1) or "").replace("-", "")
            parentesco = re.sub(r"\s+", " ", row.group(5) or "").strip(" /")
            current = {
                "cuit": cuit,
                "nombre": re.sub(r"\s+", " ", row.group(2)).strip(),
                "sexo": row.group(3),
                "fecha_nacimiento": row.group(4),
                "parentesco": parentesco,
            }
        elif current and line.strip() and not row:
            # Línea de continuación (ej: "CONVIVIENTE" tras "CONYUGE /")
            extra = re.sub(r"\s+", " ", line).strip()
            if extra and len(extra) < 40 and re.fullmatch(r"[A-ZÁÉÍÓÚÑ/ ]+", extra):
                current["parentesco"] = (current["parentesco"] + " / " + extra).strip(" /")
    if current:
        familiares.append(current)

    for fam in familiares:
        p = fam["parentesco"].upper()
        fam["parentesco"] = "CONYUGE / CONVIVIENTE" if "CONYUGE" in p or "CONVIVIENTE" in p else p
    return familiares


# Cache de parseo por PDF (mtime-based no; el contenido no cambia nunca)
_PARSE_CACHE = {}
_PARSE_LOCK = threading.Lock()


def parse_cached(pdf_path):
    with _PARSE_LOCK:
        if pdf_path in _PARSE_CACHE:
            return _PARSE_CACHE[pdf_path]
    fams = parse_grupo_familiar(pdf_path)
    with _PARSE_LOCK:
        _PARSE_CACHE[pdf_path] = fams
    return fams


def load_targets(input_path, only_cuits=None):
    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)
    rows = data["data"] if isinstance(data, dict) and "data" in data else data
    targets = []
    for r in rows:
        cuit = str(r.get("cuit") or r.get("CUIT") or "").strip()
        nombre = (r.get("nombre") or r.get("ApellidoNombre") or "").strip()
        if cuit and (only_cuits is None or cuit in only_cuits):
            targets.append({"cuit": cuit, "nombre": nombre})
    return targets


def parse_years(spec):
    if "-" in spec:
        a, b = spec.split("-", 1)
        return list(range(int(a), int(b) + 1))
    return [int(y) for y in spec.split(",")]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default="public/legisladores_full.json")
    ap.add_argument("--years", default="2012-2025",
                    help="Rango 'AAAA-AAAA' o lista 'AAAA,AAAA' (default 2012-2025)")
    ap.add_argument("--out", default="out/ddjj")
    ap.add_argument("--delay", type=float, default=0.6,
                    help="Espera entre requests al servidor de la OA (segundos)")
    ap.add_argument("--limit", type=int, default=None,
                    help="Procesar solo los primeros N legisladores")
    ap.add_argument("--skip", type=int, default=0,
                    help="Saltar los primeros N legisladores")
    ap.add_argument("--cuit", nargs="+", default=None,
                    help="Procesar solo estos CUITs")
    ap.add_argument("--workers", type=int, default=12,
                    help="Threads paralelos para búsquedas/descargas (default 12)")
    ap.add_argument("--b-rounds", type=int, default=3,
                    help="Rondas de reintento de descargas pendientes (default 3)")
    ap.add_argument("--cooldown", type=int, default=120,
                    help="Espera entre rondas si el backend está caído (segundos)")
    args = ap.parse_args()

    years = parse_years(args.years)
    only = set(args.cuit) if args.cuit else None
    targets = load_targets(args.input, only)
    if args.skip:
        targets = targets[args.skip :]
    if args.limit:
        targets = targets[: args.limit]
    print(f"Legisladores: {len(targets)}  Años: {years[0]}-{years[-1]}  "
          f"Workers: {args.workers}", file=sys.stderr)
    ensure_session()

    search_root = os.path.join(args.out, "search")
    pdf_dir = os.path.join(args.out, "pdf")
    manifest_path = os.path.join(args.out, "manifest.jsonl")
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(pdf_dir, exist_ok=True)

    # ── Fase A: búsquedas (paralelo, con cache) ─────────────────────────────
    search_tasks = []
    for t in targets:
        cuit_dir = os.path.join(search_root, t["cuit"])
        for anio in years:
            if not os.path.exists(os.path.join(cuit_dir, f"{anio}.json")):
                search_tasks.append((t["cuit"], anio, cuit_dir))
    print(f"Fase A: {len(search_tasks)} búsquedas pendientes", file=sys.stderr)
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(search_ddjj, cuit, anio, cdir, args.delay)
                   for cuit, anio, cdir in search_tasks]
        for _ in as_completed(futures):
            done += 1
            if done % 250 == 0:
                print(f"  búsquedas: {done}/{len(search_tasks)}", file=sys.stderr)

    # Leer todas las declaraciones desde el cache (todo el disco, así los
    # PDFs que fallaron en corridas anteriores se reintentan)
    decls = {}  # decl_id -> {cuit, anio, presentacion}
    decls_por_cuit = {}
    cuits_en_cache = set(os.listdir(search_root)) if os.path.isdir(search_root) else set()
    for cuit in cuits_en_cache:
        cuit_dir = os.path.join(search_root, cuit)
        if not os.path.isdir(cuit_dir):
            continue
        decls_por_cuit[cuit] = []
        for fn in os.listdir(cuit_dir):
            if not fn.endswith(".json"):
                continue
            with open(os.path.join(cuit_dir, fn), encoding="utf-8") as f:
                try:
                    rows = json.load(f)
                except json.JSONDecodeError:
                    continue
                for row in rows:
                    decl_id = row["Id"]
                    decls[decl_id] = {"cuit": cuit, "anio": row.get("Año"),
                                      "presentacion": row.get("Presentacion")}
                    decls_por_cuit[cuit].append(decl_id)

    # ── Fase B: descarga de PDFs (sesión dedicada por legislador) ───────────
    # El servidor exige que la persona haya sido buscada dentro de la misma
    # sesión para habilitar la descarga: un worker = un legislador = una sesión.
    def pending_por_cuit():
        por_cuit = {}
        for decl_id, meta in decls.items():
            path = os.path.join(pdf_dir, f"{decl_id}.pdf")
            if os.path.exists(path) and os.path.getsize(path) > 1000:
                continue
            por_cuit.setdefault(meta["cuit"], []).append((decl_id, meta["anio"]))
        return por_cuit

    por_cuit = pending_por_cuit()
    total_pdfs = sum(len(v) for v in por_cuit.values())
    print(f"Fase B: {total_pdfs} PDFs pendientes en {len(por_cuit)} legisladores "
          f"(de {len(decls)} declaraciones)", file=sys.stderr)
    rounds = 0
    while por_cuit and rounds < args.b_rounds:
        rounds += 1
        ok_total = fail_total = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(fetch_cuit_pdfs, cuit, items, pdf_dir, args.delay): cuit
                for cuit, items in por_cuit.items()
            }
            done_cuits = 0
            for fut in as_completed(futures):
                ok, fail = fut.result()
                ok_total += ok
                fail_total += fail
                done_cuits += 1
                if done_cuits % 20 == 0:
                    print(f"  ronda {rounds}: {done_cuits}/{len(por_cuit)} legisladores, "
                          f"ok={ok_total} fail={fail_total}", file=sys.stderr)
        print(f"Fase B ronda {rounds}: ok={ok_total} fail={fail_total}",
              file=sys.stderr)
        por_cuit = pending_por_cuit()
        if not por_cuit:
            break
        if ok_total == 0 and rounds < args.b_rounds:
            print(f"  backend caído; esperando {args.cooldown}s…", file=sys.stderr)
            time.sleep(args.cooldown)

    # ── Fase C: parseo + agregación ──────────────────────────────────────────
    def parse_one(decl_id):
        path = os.path.join(pdf_dir, f"{decl_id}.pdf")
        if not os.path.exists(path):
            return decl_id, []
        return decl_id, parse_cached(path)

    fams_por_decl = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(parse_one, d) for d in decls]
        for fut in as_completed(futures):
            decl_id, fams = fut.result()
            fams_por_decl[decl_id] = fams

    # Manifest: reescritura completa (idempotente)
    with open(manifest_path, "w", encoding="utf-8") as manifest:
        for decl_id, meta in sorted(decls.items()):
            path = os.path.join(pdf_dir, f"{decl_id}.pdf")
            if not os.path.exists(path):
                continue
            manifest.write(json.dumps({
                "id": decl_id, "cuit": meta["cuit"], "anio": meta["anio"],
                "presentacion": meta["presentacion"],
                "n_familiares": len(fams_por_decl.get(decl_id, [])),
            }, ensure_ascii=False) + "\n")

    result = {}
    out_path = os.path.join(args.out, "familiares.json")
    if os.path.exists(out_path):  # merge con corridas anteriores (chunks)
        with open(out_path, encoding="utf-8") as f:
            result = json.load(f)

    for t in targets:
        cuit, nombre = t["cuit"], t["nombre"]
        fams_por_cuit = {}
        for decl_id in decls_por_cuit.get(cuit, []):
            anio = decls[decl_id]["anio"]
            for fam in fams_por_decl.get(decl_id, []):
                key = fam["cuit"] or f"sin-cuit:{fam['nombre']}"
                if key not in fams_por_cuit:
                    fams_por_cuit[key] = {**fam, "fuentes": []}
                fuente = {"id": decl_id, "anio": anio}
                if fuente not in fams_por_cuit[key]["fuentes"]:
                    fams_por_cuit[key]["fuentes"].append(fuente)
        result[cuit] = {
            "nombre": nombre,
            "declaraciones": len(decls_por_cuit.get(cuit, [])),
            "familiares": sorted(fams_por_cuit.values(),
                                 key=lambda f: (f["parentesco"], f["nombre"])),
        }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    n_fam = sum(len(v["familiares"]) for v in result.values())
    print(f"Listo. {len(result)} legisladores, {n_fam} familiares -> {out_path}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
