#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'out', 'afip', 'parsed.json');
const OUTPUT = path.join(ROOT, 'web', 'public', 'regimenes.json');
const SANITIZED_SOURCE = path.join(ROOT, 'out', 'afip', 'regimenes-source-sanitized.json');

const parsed = JSON.parse(await fs.readFile(INPUT, 'utf8'));
const regimenes = {};
const source = {};

function fechaSolicitudToMonth(value) {
  const match = String(value || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}` : null;
}

for (const [cuit, record] of Object.entries(parsed)) {
  const detallados = Array.isArray(record.regimenesDetallados)
    ? record.regimenesDetallados
    : [];
  const nombres = [...new Set(
    detallados
      .map((regimen) => typeof regimen?.nombre === 'string' ? regimen.nombre.trim() : '')
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  if (nombres.length === 0) continue;

  regimenes[cuit] = {
    nombres,
    solicitudes: detallados
      .map((regimen) => ({
        nombre: typeof regimen?.nombre === 'string' ? regimen.nombre.trim() : '',
        fecha: fechaSolicitudToMonth(regimen?.fechaSolicitud),
      }))
      .filter((solicitud) => solicitud.nombre && solicitud.fecha),
  };
  source[cuit] = {
    cuit,
    nombre: record.nombre ?? null,
    cuitFormateado: record.cuitFormateado ?? null,
    tipo: record.tipo ?? null,
    regimenesDetallados: detallados.map((regimen) => ({
      codigo: regimen.codigo ?? null,
      nombre: regimen.nombre ?? null,
      ley: regimen.ley ?? null,
      periodo: regimen.periodo ?? null,
      fechaSolicitud: regimen.fechaSolicitud ?? null,
    })),
  };
}

await fs.writeFile(OUTPUT, JSON.stringify(regimenes), 'utf8');
await fs.writeFile(SANITIZED_SOURCE, JSON.stringify(source, null, 2), 'utf8');

console.log(`Wrote ${Object.keys(regimenes).length} CUITs to ${OUTPUT}`);
console.log(`Wrote sanitized source to ${SANITIZED_SOURCE}`);
