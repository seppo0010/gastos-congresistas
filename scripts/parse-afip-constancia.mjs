#!/usr/bin/env node
// Parser de los HTML de Constancia descargados en out/afip/<cuit>.html
// Salida: out/afip/parsed.json   (un objeto por CUIT)
//
// Por cada CUIT, extrae (cuando aplica):
//   - nombre, cuit (formateado XX-XXXXXXXX-X)
//   - tipo: "inscripcion" | "opcion" | "selector" | "error" | "unknown"
//   - domicilio fiscal: calle, localidad, cp, provincia
//   - impuestos registrados (solo Inscripcion): [{impuesto, fechaAlta}, ...]
//   - monotributo (solo Opcion): codigo, categoria, actividad, fechaInicio
//   - vigencia: desde, hasta
//   - verificador
//   - errorMessage (si vino de ErrorAction/MsgAction)
//
// Para los errores toma el mensaje del manifest.jsonl (el HTML es una página
// genérica de JBoss que no incluye el texto del error).
//
// Uso:
//   node scripts/parse-afip-constancia.mjs
//   node scripts/parse-afip-constancia.mjs --out out/afip/parsed.json

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const AFIP_DIR = path.join(ROOT, 'out', 'afip');
const OUT_FILE = path.join(AFIP_DIR, 'parsed.json');

const getArg = (name) => {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(`--out=`)) return a.slice('--out='.length);
  }
  return null;
};
const customOut = getArg('out');
const OUT = customOut || OUT_FILE;

// ---------- Manifest index (CUIT → {redirect, error?}) ----------
async function loadManifest() {
  const file = path.join(AFIP_DIR, 'manifest.jsonl');
  const map = new Map();
  try {
    const text = await fs.readFile(file, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        if (m.skipped) continue;
        // Para "skipped" no pisamos lo que ya había
        if (!map.has(m.cuit)) map.set(m.cuit, m);
      } catch {}
    }
  } catch {
    // sin manifest → OK
  }
  return map;
}

// ---------- HTML helpers ----------
const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&oacute;/g, 'ó')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&nbsp&nbsp/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findFirst = (html, regex) => {
  const m = html.match(regex);
  return m ? decodeEntities(m[1]) : null;
};

// Strip HTML tags from a chunk
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

// ---------- Type detection ----------
// Detectamos a partir del manifest (redirect) y luego confirmamos con el HTML.
function detectType(html, meta) {
  const r = meta?.redirect || '';
  // El redirect es la señal más confiable
  if (/ErrorAction\.do/.test(r) || /MsgAction\.do/.test(r)) return 'error';
  if (/ConstanciaSelector/.test(r)) return 'selector';
  if (/ConstanciaInscripcionBody/.test(r)) return 'inscripcion';
  if (/ConstanciaOpcionBody/.test(r)) return 'opcion';
  // Fallback al HTML
  if (/tipoConstanciaSelector/.test(html)) return 'selector';
  if (/CONSTANCIA DE INSCRIPCI&Oacute;N|CONSTANCIA DE INSCRIPCION/i.test(html)) return 'inscripcion';
  if (/CONSTANCIA DE OPCI&Oacute;N|CONSTANCIA DE OPCION/i.test(html)) return 'opcion';
  if (html.length < 500 && /(ErrorAction|MsgAction)/.test(html)) return 'error';
  return 'unknown';
}

// ---------- Fields per type ----------
function parseInscripcion(html) {
  const data = {};
  // Nombre: aparece como <FONT ...>&nbsp;APELLIDO NOMBRE</FONT> seguido de "CUIT:"
  const nombreMatch = html.match(/&nbsp;([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .,'-]+?)\s*<\/FONT>[\s\S]{0,500}?CUIT:/);
  data.nombre = nombreMatch ? decodeEntities(nombreMatch[1].replace(/\s+/g, ' ').trim()) : null;
  // CUIT formateado XX-XXXXXXXX-X
  data.cuitFormateado = findFirst(
    html,
    /CUIT:[\s\S]{0,200}?<FONT[^>]*>(\d{2}-\d{8}-\d)<\/FONT>/i,
  );

  // Impuestos / regimenes: <TR><TD><FONT ...>Nombre Impuesto</FONT></TD><TD>fecha</TD></TR>
  // y notas/info: <TR><TD colspan="2"><FONT ...>texto</FONT></TD></TR>
  // Sólo si no es "No registra impuestos activos"
  const noRegistra = /No registra\s*impuestos activos/i.test(html);
  data.impuestos = [];
  data.regimenesDetallados = [];
  data.notas = [];
  if (!noRegistra) {
    const tableMatch = html.match(/IMPUESTOS\/REGIMENES NACIONALES REGISTRADOS[\s\S]*?<\/TABLE>/i);
    if (tableMatch) {
      const tableHtml = tableMatch[0];
      const rowRe = /<TR>([\s\S]*?)<\/TR>/g;
      let m;
      while ((m = rowRe.exec(tableHtml)) !== null) {
        const cells = [...m[1].matchAll(/<TD([^>]*)>([\s\S]*?)<\/TD>/gi)].map((c) => ({
          attrs: c[1],
          text: stripTags(c[2]),
        }));
        if (cells.length === 0) continue;
        const isFullRow = cells.length === 1 && /colspan/i.test(cells[0].attrs);
        const text = cells[0]?.text;
        if (isFullRow && text && text.length > 3) {
          // Fila informativa (colspan=2). Distinguimos regimenes detallados de notas.
          const regMatch = text.match(
            /^(\d{3})\s*-\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ &.\-\d]+?)\s*\(Periodo:\s*(\d{4}),\s*Fecha de solicitud:\s*(\d{2}-\d{2}-\d{4})\)\s*$/i,
          );
          if (regMatch) {
            data.regimenesDetallados.push({
              codigo: regMatch[1],
              nombre: regMatch[2].trim(),
              ley: (text.match(/LEY\s+([\d.]+)/i) || [])[1] || null,
              periodo: regMatch[3],
              fechaSolicitud: regMatch[4],
            });
          } else if (text.trim() && !/^[\s*]+$/.test(text)) {
            // Cualquier otra nota con texto (excluyendo separadores y blancos)
            data.notas.push(text);
          }
          continue;
        }
        // Fila estándar: nombre + fecha
        if (cells.length >= 2 && cells[0]?.text && cells[1]?.text && !cells[0].text.startsWith('***')) {
          const nombre = cells[0].text;
          const fecha = cells[1].text;
          if (nombre && fecha && /\d/.test(fecha)) {
            data.impuestos.push({ impuesto: nombre, fechaAlta: fecha });
          }
        }
      }
    }
  }

  // Domicilio fiscal: 3 filas después de "DOMICILIO FISCAL - ARCA"
  const domMatch = html.match(/DOMICILIO FISCAL\s*-?\s*ARCA([\s\S]*?)<\/TABLE>/i);
  if (domMatch) {
    const cells = [...domMatch[1].matchAll(/<FONT[^>]*>([\s\S]*?)<\/FONT>/g)].map((m) =>
      decodeEntities(m[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()),
    );
    if (cells[0]) data.calle = cells[0];
    if (cells[1]) data.localidad = cells[1];
    const cp = cells[2]?.match(/^(\d{4})-(.+)$/);
    if (cp) {
      data.codigoPostal = cp[1];
      data.provincia = cp[2];
    } else if (cells[2]) {
      data.provincia = cells[2];
    }
  }

  return data;
}

function parseOpcion(html) {
  const data = {};
  // Nombre (después de CUIT)
  const nombreMatch = html.match(/CUIT:[\s\S]{0,500}?<FONT[^>]*>(\d{2}-\d{8}-\d)<\/FONT>[\s\S]{0,500}?<FONT[^>]*>([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .,'-]+?)<\/FONT>/);
  if (nombreMatch) {
    data.cuitFormateado = decodeEntities(nombreMatch[1]);
    data.nombre = decodeEntities(nombreMatch[2].replace(/\s+/g, ' ').trim());
  } else {
    data.cuitFormateado = findFirst(html, /CUIT:[\s\S]{0,200}?<FONT[^>]*>(\d{2}-\d{8}-\d)<\/FONT>/i);
  }
  // Domicilio: 3 líneas después del nombre
  const domMatch = html.match(/<FONT[^>]*>([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .,'-]+?)<\/FONT>\s*<\/TD>\s*<\/TR>\s*<TR>\s*<TD>\s*<FONT[^>]*>([\s\S]*?)<\/FONT>/);
  if (domMatch) {
    data.calle = decodeEntities(domMatch[2].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
  }
  // Mejor: tomamos las 3 filas siguientes después del nombre como domicilio
  const despuesDeNombre = html.split(/[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .,'-]+?<\/FONT>\s*<\/TD>\s*<\/TR>/i)[1] || '';
  const lineas = [...despuesDeNombre.matchAll(/<FONT[^>]*>([\s\S]*?)<\/FONT>/g)]
    .map((m) => decodeEntities(m[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter((s) => s && s.length > 1 && s.length < 100)
    .slice(0, 3);
  if (lineas[0]) data.calle = lineas[0];
  if (lineas[1]) data.localidad = lineas[1];
  if (lineas[2]) {
    const cp = lineas[2].match(/^(\d{4})-(.+)$/);
    if (cp) {
      data.codigoPostal = cp[1];
      data.provincia = cp[2];
    } else {
      data.provincia = lineas[2];
    }
  }

  // Monotributo: "<codigo> - MONOTRIBUTO" y luego CATEGORÍA y actividad
  const codigoMatch = html.match(/(\d{3}\s*-\s*MONOTRIBUTO[^<]*)/i);
  data.monotributo = {};
  if (codigoMatch) data.monotributo.codigo = decodeEntities(codigoMatch[1].replace(/\s+/g, ' ').trim());
  // Categoría: el carácter grande en FONT-SIZE: 40pt después de "CATEGORÍA"
  const catMatch = html.match(
    /CATEGOR&Iacute;A[\s\S]{0,500}?<FONT[^>]*style="FONT-SIZE:\s*\d+pt"[^>]*>\s*([A-Z0-9]+)\s*<\/FONT>/i,
  );
  if (catMatch) data.monotributo.categoria = catMatch[1].trim();
  // Actividad: la línea que sigue a "<!-- Esta es la descripcion de la categoria -->"
  // Estructura típica: <TD><FONT>SIZE="2">ACTIVIDAD</FONT></TD>
  // Limitamos la búsqueda a los siguientes 500 chars para no confundir con secciones lejanas
  const actMatch = html.match(
    /descripcion de la categoria[\s\S]{0,500}?<FONT[^>]*>([A-ZÁÉÍÓÚÑ &.\-]{8,})/i,
  );
  if (actMatch && actMatch[1].length < 100) {
    data.monotributo.actividad = decodeEntities(actMatch[1].replace(/&nbsp;?/g, ' ').replace(/\s+/g, ' ').trim());
  }
  // Fecha de inicio
  const fechaMatch = html.match(/FECHA DE INICIO:\s*(\d{2}-\d{2}-\d{4})/i);
  if (fechaMatch) data.monotributo.fechaInicio = fechaMatch[1];

  return data;
}

function parseCommon(html) {
  // Vigencia: "Vigencia de la presente constancia: DD-MM-YYYY a DD-MM-YYYY"
  const vigMatch = html.match(
    /Vigencia de la[\s\S]*?(\d{2}-\d{2}-\d{4})[\s\S]{0,100}?a[\s\S]{0,100}?(\d{2}-\d{2}-\d{4})/i,
  );
  const vigencia = vigMatch ? { desde: vigMatch[1], hasta: vigMatch[2] } : null;
  // Verificador
  const verifMatch = html.match(/Verificador[\s\S]{0,200}?<B>\s*<FONT[^>]*>\s*(\d{9,})\s*<\/FONT>/i)
    || html.match(/Verificador[\s\S]{0,200}?(\d{9,})/i);
  const verificador = verifMatch ? verifMatch[1].trim() : null;
  return { vigencia, verificador };
}

// ---------- Main ----------
async function main() {
  const manifest = await loadManifest();
  const files = (await fs.readdir(AFIP_DIR)).filter((f) => /^\d+\.html$/.test(f));
  files.sort();
  console.error(`Procesando ${files.length} HTMLs...`);

  const results = {};
  let stats = { inscripcion: 0, opcion: 0, selector: 0, error: 0, unknown: 0 };

  for (const f of files) {
    const cuit = f.replace(/\.html$/, '');
    const html = await fs.readFile(path.join(AFIP_DIR, f), 'utf8');
    const meta = manifest.get(cuit) || {};
    const tipo = detectType(html, meta);
    stats[tipo] = (stats[tipo] || 0) + 1;

    const common = parseCommon(html);
    let specific = {};
    if (tipo === 'inscripcion') specific = parseInscripcion(html);
    else if (tipo === 'opcion') specific = parseOpcion(html);

    const rec = {
      cuit,
      tipo,
      ...specific,
      ...common,
    };
    if (meta.redirect) rec.redirect = meta.redirect;
    if (meta.status) rec.status = meta.status;
    if (meta.finalUrl) rec.finalUrl = meta.finalUrl;
    if (meta.error) rec.error = meta.error;
    if (meta.redirect && /(ErrorAction|MsgAction)\.do/.test(meta.redirect)) {
      // Extraer el mensaje del query string
      try {
        const url = new URL(meta.redirect, 'https://x/');
        rec.errorMessage = decodeEntities(url.searchParams.get('mensaje') || '').trim();
      } catch {}
    }
    if (tipo === 'error' && !rec.errorMessage) {
      rec.errorMessage = 'Ver redirect en manifest';
    }
    results[cuit] = rec;
  }

  await fs.writeFile(OUT, JSON.stringify(results, null, 2), 'utf8');
  console.error(`Escrito: ${OUT}`);
  console.error(`Stats:`, stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
