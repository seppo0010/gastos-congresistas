#!/usr/bin/env node
// Scraper de Constancia de Inscripción / Opción de Monotributo del portal
// SETI de ARCA (ex AFIP), para los CUITs de los JSONs del proyecto.
//
// Flujo (descubierto con agent-browser + verificado por HTTP directo):
//   1. GET /padron-puc-constancia-internet/restCaptchaCode?type=maths&systemId=constanciaPadron
//        -> { challenge, token, ... }  (token = JWT de un solo uso)
//   2. POST /padron-puc-constancia-internet/ConstanciaAction.do?bar=<ms>
//        body: { "data": "{\"cuit\":...,\"txtSolucion\":...,\"txtToken\":...,\"systemId\":...}" }
//        -> { "redirect": "./ConstanciaInscripcionBody.jsp" }   (o ConstanciaOpcionBody.jsp, o ErrorAction.do)
//   3. GET <redirect>   -> HTML de la constancia (o página de error)
//
// El captcha es de tipo "Cálculo matemático" (un texto tipo
// "¿Cuál es el resultado de 2 + 4?" o "Calcule 8 * 9, ignore el símbolo %").
// Lo resuelve un LLM vía OpenRouter (DeepSeek V4 Flash, sort=latency).
//
// Salida:
//   out/afip/<cuit>.html        HTML de la constancia (o página de error)
//   out/afip/<cuit>.meta.json   { cuit, redirect, status, ts } | { cuit, error, ts }
//   out/afip/manifest.json      Resumen de toda la corrida
//   out/afip/manifest.jsonl     Una línea por CUIT (append-only, robusto a crashes)
//
// Reanudable: si <cuit>.html ya existe, se salta el CUIT.
//
// Uso:
//   node --env-file=.env scripts/scrape-afip-constancia.mjs
//   node --env-file=.env scripts/scrape-afip-constancia.mjs --limit 5
//   node --env-file=.env scripts/scrape-afip-constancia.mjs --cuit 20179070104
//   node --env-file=.env scripts/scrape-afip-constancia.mjs --dry-run

import fs from 'node:fs/promises';
import path from 'node:path';
import { argv, env, exit } from 'node:process';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'web', 'public');
const OUT_DIR = path.join(ROOT, 'out', 'afip');

const AFIP_BASE = 'https://seti.afip.gob.ar/padron-puc-constancia-internet';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4-flash';

const SYSTEM_ID = 'constanciaPadron';
const DELAY_MS = Number(env.AFIP_DELAY_MS ?? 800);
const RETRIES = Number(env.AFIP_RETRIES ?? 3);
const LLM_TIMEOUT_MS = Number(env.AFIP_LLM_TIMEOUT_MS ?? 20_000);
const HTTP_TIMEOUT_MS = Number(env.AFIP_HTTP_TIMEOUT_MS ?? 15_000);

const args = new Set(argv.slice(2));
// Acepta --name=value y --name value
function getArg(name) {
  const argvTail = argv.slice(2);
  for (let i = 0; i < argvTail.length; i++) {
    const a = argvTail[i];
    if (a === `--${name}`) return argvTail[i + 1] ?? '';
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return null;
}
const LIMIT = getArg('limit') ? Number(getArg('limit')) : null;
const SINGLE_CUIT = getArg('cuit');
const CUIT_FILE = getArg('cuit-file');
const DRY_RUN = args.has('--dry-run');
const SKIP_DONE = !args.has('--force');
const CONCURRENCY = Number(getArg('concurrency') ?? 1);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, opts = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function loadCuits() {
  const files = ['legisladores_full.json', 'politicos_full.json', 'judicial_full.json'];
  const set = new Set();
  for (const f of files) {
    const data = JSON.parse(await fs.readFile(path.join(PUBLIC_DIR, f), 'utf8'));
    for (const person of data.data) {
      if (person.cuit) set.add(person.cuit);
    }
  }
  return [...set].sort();
}

class AfipClient {
  constructor() {
    this.cookie = '';
  }

  async _fetch(url, opts = {}) {
    const headers = {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'es-AR,es;q=0.9',
      Referer: `${AFIP_BASE}/jsp/Constancia.jsp`,
      ...opts.headers,
    };
    if (this.cookie) headers.Cookie = this.cookie;
    const r = await fetchWithTimeout(url, { ...opts, headers });
    const setCookie = r.headers.getSetCookie?.() ?? r.headers.get('set-cookie');
    if (setCookie) {
      const sc = Array.isArray(setCookie) ? setCookie : [setCookie];
      const pairs = sc.map((c) => c.split(';')[0]).filter(Boolean);
      const newCookie = pairs.join('; ');
      if (newCookie) this.cookie = this.cookie ? `${this.cookie}; ${newCookie}` : newCookie;
    }
    return r;
  }

  async getCaptcha() {
    const url = `${AFIP_BASE}/restCaptchaCode?type=maths&systemId=${SYSTEM_ID}`;
    const r = await this._fetch(url);
    if (!r.ok) throw new Error(`captcha HTTP ${r.status}`);
    return r.json();
  }

  async submit(cuit, solution, token) {
    const bar = Date.now();
    const url = `${AFIP_BASE}/ConstanciaAction.do?bar=${bar}`;
    const inner = JSON.stringify({
      cuit,
      txtSolucion: String(solution),
      txtToken: token,
      systemId: SYSTEM_ID,
    });
    const body = JSON.stringify({ data: inner });
    const r = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body,
    });
    if (!r.ok) throw new Error(`submit HTTP ${r.status}`);
    return r.json();
  }

  async fetchResult(redirectPath) {
    // El redirect que viene en el JSON es relativo al form
    // (.../padron-puc-constancia-internet/jsp/Constancia.jsp), no al ConstanciaAction.do.
    // Lo resolvemos contra .../jsp/Constancia.jsp que es la base real.
    const baseForRedirect = `${AFIP_BASE}/jsp/Constancia.jsp`;
    const url = new URL(redirectPath, baseForRedirect).toString();
    const r = await this._fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    return { status: r.status, body: await r.text(), finalUrl: url };
  }
}

async function solveWithLlm(question) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no está en .env');

  const r = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/seppo0010/gastos-congresistas',
        'X-Title': 'gastos-congresistas afip scraper',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 64,
        messages: [
          {
            role: 'system',
            content:
              'Sos un resolvedor de CAPTCHA matemático. Recibís una pregunta en español (ej: "¿Cuál es el resultado de 2 + 4?" o "Calcule 8 * 9, ignore el símbolo %" o "ignore el número 10. Calcule 8 - 1"). Respondé SOLO con el número resultante, sin unidades, sin explicación, sin signo de pregunta, sin comillas. Si la pregunta dice "ignore el número X" o "ignore el símbolo Y", tenés que aplicar esa instrucción al resolver la cuenta.',
          },
          { role: 'user', content: question },
        ],
      }),
    },
    LLM_TIMEOUT_MS,
  );

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`LLM HTTP ${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  // Tomamos el primer número (entero o decimal, con signo opcional)
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) throw new Error(`LLM no devolvió un número: "${text}"`);
  return match[0].replace(',', '.');
}

async function processCuit(cuit, client) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    // Captcha nuevo en cada intento (los tokens son de un solo uso)
    const captcha = await client.getCaptcha();
    let answer;
    try {
      answer = await solveWithLlm(captcha.challenge);
    } catch (err) {
      lastErr = err;
      // respuesta vacía o mal formada → reintentar captcha
      continue;
    }
    const submitRes = await client.submit(cuit, answer, captcha.token);
    const redirect = submitRes.redirect;
    if (!redirect) throw new Error(`Respuesta inesperada: ${JSON.stringify(submitRes)}`);
    // Si la respuesta fue un error semántico (no HTTP), no es un error transitorio
    if (redirect.includes('ErrorAction.do')) {
      return { redirect, status: 200, html: redirect };
    }
    if (redirect.includes('MsgAction.do')) {
      // "Código de seguridad inválido" → reintentar con captcha nuevo
      lastErr = new Error(`Captcha rechazado: ${redirect}`);
      continue;
    }
    const page = await client.fetchResult(redirect);
    return { redirect, status: page.status, html: page.body, finalUrl: page.finalUrl };
  }
  throw lastErr ?? new Error('sin intentos');
}

async function writeMeta(cuit, payload) {
  const metaFile = path.join(OUT_DIR, `${cuit}.meta.json`);
  try {
    await fs.writeFile(metaFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    // Si falla el write del meta (ej: ENOSPC), logueamos pero no tiramos el proceso entero
    console.error(`\n[warn] no pude escribir ${metaFile}: ${err.message}`);
  }
}

async function appendManifest(line) {
  const manifestFile = path.join(OUT_DIR, 'manifest.jsonl');
  try {
    await fs.appendFile(manifestFile, JSON.stringify(line) + '\n', 'utf8');
  } catch (err) {
    console.error(`\n[warn] no pude escribir ${manifestFile}: ${err.message}`);
  }
}

async function runOne(cuit, client, cuits) {
  const outFile = path.join(OUT_DIR, `${cuit}.html`);
  if (SKIP_DONE) {
    const exists = await fs.access(outFile).then(() => true).catch(() => false);
    if (exists) {
      const skipLine = { cuit, skipped: true, ts: new Date().toISOString() };
      await appendManifest(skipLine);
      process.stdout.write('·');
      return { skipped: true };
    }
  }
  try {
    const result = await processCuit(cuit, client);
    try {
      await fs.writeFile(outFile, result.html, 'utf8');
    } catch (writeErr) {
      console.error(`\n[warn] no pude escribir ${outFile}: ${writeErr.message}`);
    }
    const okLine = {
      cuit,
      redirect: result.redirect,
      status: result.status,
      finalUrl: result.finalUrl,
      ts: new Date().toISOString(),
    };
    await writeMeta(cuit, okLine);
    await appendManifest(okLine);
    const tag = result.redirect.includes('ErrorAction')
      ? '⚠'
      : result.redirect.includes('ConstanciaSelector')
        ? '?'
        : '✓';
    process.stdout.write(tag);
    return okLine;
  } catch (err) {
    const errLine = { cuit, error: String(err.message ?? err), ts: new Date().toISOString() };
    await writeMeta(cuit, errLine);
    await appendManifest(errLine);
    process.stdout.write('✗');
    return errLine;
  }
}

async function processWithConcurrency(cuits, concurrency) {
  const client = new AfipClient();
  const queue = [...cuits];
  const workers = Array.from({ length: concurrency }, async () => {
    const localClient = new AfipClient();
    while (queue.length) {
      const cuit = queue.shift();
      if (!cuit) break;
      await runOne(cuit, localClient, cuits);
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(workers);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  let cuits = await loadCuits();
  console.error(`CUITs únicos: ${cuits.length}`);

  if (CUIT_FILE) {
    const text = await fs.readFile(CUIT_FILE, 'utf8');
    const set = new Set(text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    cuits = [...set].sort();
    console.error(`Filtrado a ${cuits.length} CUITs desde ${CUIT_FILE}`);
  } else if (SINGLE_CUIT) {
    cuits = [SINGLE_CUIT];
    console.error(`Filtrado a 1 CUIT: ${SINGLE_CUIT}`);
  } else if (LIMIT) {
    cuits = cuits.slice(0, LIMIT);
    console.error(`Limitado a ${LIMIT} CUITs`);
  }

  if (DRY_RUN) {
    console.error('Dry run, primeros 5:', cuits.slice(0, 5));
    return;
  }

  // Limpiar manifest si está vacío (corrida nueva)
  const manifestFile = path.join(OUT_DIR, 'manifest.jsonl');
  try {
    const stat = await fs.stat(manifestFile);
    if (stat.size === 0) await fs.unlink(manifestFile);
  } catch {
    /* no existe */
  }

  console.error(`Procesando ${cuits.length} CUITs (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms, retries=${RETRIES})...\n`);

  const t0 = Date.now();
  await processWithConcurrency(cuits, CONCURRENCY);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.error(`\nListo en ${elapsed}s.`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('\n[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('\n[uncaughtException]', err);
});
