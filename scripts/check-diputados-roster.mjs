import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';

const ROSTER_URL = 'https://www.diputados.gob.ar/diputados/index.html';
const CSV_URL = 'https://www.diputados.gob.ar/system/modules/ar.gob.hcdn.diputados/formatters/generar-lista-diputados.csv';
const DATA_FILE = path.resolve('public/legisladores_full.json');
const UPDATE = process.argv.includes('--update');

// The official table's portrait URLs use the same 11-digit CUIT identifiers as
// this project's BCRA/ARCA-derived records. Keep exceptional public/legal names
// explicit rather than trying to infer aliases from fuzzy name matching.
const IDENTITY_OVERRIDES = {
  '27208314128': {
    nombre: 'VAZQUEZ BUSTELO KARINA CELIA',
    aliases: ['Karen Reichardt'],
  },
};

function cleanHtml(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .trim();
}

function titleCase(value) {
  return value.toLocaleLowerCase('es-AR').replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase('es-AR'));
}

function datasetName(displayName) {
  const comma = displayName.indexOf(',');
  if (comma === -1) return displayName.toLocaleUpperCase('es-AR');
  return `${displayName.slice(0, comma).trim()} ${displayName.slice(comma + 1).trim()}`.toLocaleUpperCase('es-AR');
}

function isoMonth(date) {
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Fecha oficial inesperada: ${date}`);
  return `${match[3]}-${match[2]}`;
}

function parseOfficialRoster(html) {
  const rows = [];
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = match[1];
    const photo = row.match(/parlamentaria\.hcdn\.gob\.ar\/image\/(\d{11})_[^"']+/);
    const profile = row.match(/<a href="\/diputados\/([^/]+)\/">\s*([\s\S]*?)\s*<\/a>/);
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cleanHtml(cell[1]));
    if (!photo || !profile || cells.length < 7) continue;
    rows.push({
      cuit: photo[1],
      slug: profile[1],
      nombre: cleanHtml(profile[2]),
      distrito: cells[2],
      partido: cells[3],
      inicio: cells[5],
      fin: cells[6],
    });
  }
  if (rows.length < 250 || new Set(rows.map((row) => row.cuit)).size !== rows.length) {
    throw new Error(`La página oficial produjo una nómina inválida (${rows.length} filas)`);
  }
  return rows;
}

function newRecord(row) {
  const override = IDENTITY_OVERRIDES[row.cuit] || {};
  return {
    aliases: override.aliases || [],
    cambios_nivel: false,
    cargo: 'Diputado',
    cuit: row.cuit,
    distrito: titleCase(row.distrito),
    fuentes: [ROSTER_URL, `${ROSTER_URL.replace(/index\.html$/, '')}${row.slug}/`, CSV_URL],
    historial: [],
    hitos_personales: [{
      cargo: 'Diputado',
      color: '#8A2BE2',
      fecha: isoMonth(row.inicio),
      texto: `Inicio (Diputado) en ${titleCase(row.partido)}`,
      tipo: 'politico',
    }],
    mis_hitos: [],
    nombre: override.nombre || datasetName(row.nombre),
    partido: titleCase(row.partido),
    pdf_paths: [],
    periodos: [{ cargo: 'Diputado', inicio: isoMonth(row.inicio), fin: isoMonth(row.fin) }],
    situacion_bcra: 0,
  };
}

function download(url) {
  return new Promise((resolve, reject) => {
    // The HCDN server currently omits an intermediate certificate in its TLS
    // chain. Scope the compatibility exception to this one official host.
    https.get(url, {
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'gastos-congresistas-roster-check/1.0 (+https://github.com/seppo0010/gastos-congresistas)' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(download(new URL(response.headers.location, url).href));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`No se pudo descargar la nómina HCDN: HTTP ${response.statusCode}`));
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const roster = parseOfficialRoster(await download(ROSTER_URL));
const dashboard = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
const known = new Set(dashboard.data.map((person) => person.cuit));
const missing = roster.filter((person) => !known.has(person.cuit));

console.log(`HCDN: ${roster.length} bancas ocupadas; dataset: ${dashboard.data.length} personas; coincidencias: ${roster.length - missing.length}.`);
if (missing.length) console.log(`Diputados actuales faltantes (${missing.length}):\n${missing.map((person) => `- ${person.nombre} (${person.cuit})`).join('\n')}`);

if (UPDATE && missing.length) {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const marker = '\n  ],\n  "meta": {';
  const markerIndex = raw.indexOf(marker);
  if (markerIndex === -1) throw new Error(`No se encontró el cierre de data en ${DATA_FILE}`);
  const records = missing.map((row) => JSON.stringify(newRecord(row), null, 2)
    .split('\n').map((line) => `    ${line}`).join('\n')).join(',\n');
  const separator = dashboard.data.length ? ',\n' : '\n';
  const updated = `${raw.slice(0, markerIndex)}${separator}${records}${raw.slice(markerIndex)}`;
  await fs.writeFile(DATA_FILE, updated);
  console.log(`Actualizado ${DATA_FILE}. Los registros nuevos tienen historial vacío y situacion_bcra=0.`);
}

if (!UPDATE && missing.length) process.exitCode = 1;
