import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_URL = 'https://cuantodeben.visualizando.ar';

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

function mergeDashboardPeople(dbData, politicosData, judicialData) {
  const rawLegisladores = dbData.data;
  const rawPoliticos = politicosData.data;
  const rawJudicial = judicialData.data;

  const politicosByCuit = new Map(rawPoliticos.map((p) => [p.cuit, p]));
  const merged = rawLegisladores.map((l) => {
    const pol = politicosByCuit.get(l.cuit);
    return pol
      ? { ...l, unidad: pol.unidad, poder: 'legislativo' }
      : { ...l, poder: 'legislativo' };
  });

  const legCuits = new Set(rawLegisladores.map((l) => l.cuit));
  const execCuits = new Set(rawPoliticos.map((p) => p.cuit));
  const combined = [
    ...merged,
    ...rawPoliticos
      .filter((p) => !legCuits.has(p.cuit))
      .map((p) => ({ ...p, poder: 'ejecutivo' })),
    ...rawJudicial
      .filter((j) => !legCuits.has(j.cuit) && !execCuits.has(j.cuit))
      .map((j) => ({ ...j, poder: 'judicial' })),
  ];

  const seen = new Map();
  return combined.map((person) => {
    let slug = slugify(person.nombre);
    if (seen.has(slug)) {
      const count = seen.get(slug) + 1;
      seen.set(slug, count);
      slug = `${slug}-${count}`;
    } else {
      seen.set(slug, 1);
    }

    return { ...person, slug };
  });
}

function getMonthlyDebtSeries(person) {
  const monthly = new Map();

  for (const record of person.historial || []) {
    const current = monthly.get(record.fecha) || {
      total: 0,
      entities: new Set(),
      maxSituation: 0,
    };

    current.total += record.monto;
    current.entities.add(record.entidad);
    current.maxSituation = Math.max(current.maxSituation, record.situacion || 0);
    monthly.set(record.fecha, current);
  }

  return [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      total: value.total,
      entityCount: value.entities.size,
      maxSituation: value.maxSituation,
    }));
}

function getPersonStats(person) {
  const monthlySeries = getMonthlyDebtSeries(person);
  const firstPoint = monthlySeries[0];
  const latestPoint = monthlySeries[monthlySeries.length - 1];
  const previousPoint = monthlySeries[monthlySeries.length - 2];
  const peakPoint = monthlySeries.reduce((max, point) => {
    if (!max || point.total > max.total) return point;
    return max;
  }, null);

  const totalReportedDebt = monthlySeries.reduce((sum, point) => sum + point.total, 0);
  const entityCount = new Set((person.historial || []).map((record) => record.entidad)).size;
  const familiaresCount = (person.familiares || []).filter((f) => (f.historial || []).length > 0).length;

  return {
    monthlySeries,
    firstMonth: firstPoint?.date ?? null,
    latestMonth: latestPoint?.date ?? null,
    latestDebt: latestPoint?.total ?? 0,
    peakMonth: peakPoint?.date ?? null,
    peakDebt: peakPoint?.total ?? 0,
    averageMonthlyDebt: monthlySeries.length > 0 ? totalReportedDebt / monthlySeries.length : 0,
    monthsWithDebt: monthlySeries.length,
    entityCount,
    familiaresCount,
    latestSituation: person.situacion_bcra ?? latestPoint?.maxSituation ?? null,
    latestVariationPct:
      latestPoint && previousPoint && previousPoint.total > 0
        ? ((latestPoint.total - previousPoint.total) / previousPoint.total) * 100
        : null,
  };
}

function formatMonthLabel(value) {
  if (!value) return 'Sin datos';

  const [year, month] = value.split('-');
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const monthIndex = Number(month) - 1;

  if (!year || monthIndex < 0 || monthIndex >= monthNames.length) {
    return value;
  }

  return `${monthNames[monthIndex]} ${year}`;
}

function formatMoneyArs(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value * 1000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function replaceMetaTag(html, matcher, replacement) {
  if (!matcher.test(html)) {
    throw new Error(`No se encontró el patrón ${matcher}`);
  }

  matcher.lastIndex = 0;
  return html.replace(matcher, replacement);
}

function getPowerLabel(person) {
  switch (person.poder) {
    case 'legislativo':
      return 'Poder Legislativo';
    case 'ejecutivo':
      return 'Poder Ejecutivo';
    case 'judicial':
      return 'Poder Judicial';
    default:
      return 'Funcionario';
  }
}

function getContextLine(person) {
  const parts = [person.cargo];

  if (person.distrito) parts.push(person.distrito);
  if (person.partido) parts.push(person.partido);
  if (person.unidad) parts.push(person.unidad);
  if (person.camara) parts.push(person.camara);
  if (person.organo) parts.push(person.organo);

  return parts.filter(Boolean).join(' · ');
}

function buildDescription(person, stats) {
  const latest = stats.latestMonth
    ? `En ${formatMonthLabel(stats.latestMonth)} registró ${formatMoneyArs(stats.latestDebt)}`
    : 'No tiene historial de deuda reportado';
  const peak = stats.peakMonth
    ? `y su pico fue ${formatMoneyArs(stats.peakDebt)} en ${formatMonthLabel(stats.peakMonth)}`
    : 'y no hay un pico identificable';

  return `${person.nombre}. ${getContextLine(person) || getPowerLabel(person)}. ${latest} ${peak}. Ficha individual con estadísticas del BCRA en ¿Cuánto deben?`;
}

function buildFallbackBody(person, stats, description) {
  const latestRows = [...stats.monthlySeries].slice(-6).reverse();
  const latestVariation = stats.latestVariationPct == null
    ? 'Sin variación comparable contra el mes anterior.'
    : `${stats.latestVariationPct >= 0 ? '+' : ''}${stats.latestVariationPct.toFixed(1)}% contra el mes anterior.`;

  return `
    <article>
      <header>
        <p>${escapeHtml(getPowerLabel(person))}</p>
        <h1>${escapeHtml(person.nombre)}</h1>
        <p>${escapeHtml(description)}</p>
      </header>
      <section>
        <h2>Estadísticas</h2>
        <ul>
          <li>Último mes reportado: ${escapeHtml(formatMonthLabel(stats.latestMonth))}.</li>
          <li>Última deuda reportada: ${escapeHtml(formatMoneyArs(stats.latestDebt))}.</li>
          <li>Pico histórico: ${escapeHtml(stats.peakMonth ? `${formatMoneyArs(stats.peakDebt)} en ${formatMonthLabel(stats.peakMonth)}` : 'Sin datos')}.</li>
          <li>Promedio mensual: ${escapeHtml(formatMoneyArs(stats.averageMonthlyDebt))}.</li>
          <li>Meses con registros: ${stats.monthsWithDebt}.</li>
          <li>Entidades reportadas: ${stats.entityCount}.</li>
          <li>Familiares con datos: ${stats.familiaresCount}.</li>
          <li>Variación más reciente: ${escapeHtml(latestVariation)}</li>
        </ul>
      </section>
      <section>
        <h2>Últimos meses</h2>
        <ul>
          ${latestRows.map((row) => (
            `<li>${escapeHtml(formatMonthLabel(row.date))}: ${escapeHtml(formatMoneyArs(row.total))} en ${row.entityCount} entidad(es).</li>`
          )).join('')}
        </ul>
      </section>
      <p><a href="/?funcionarios=${encodeURIComponent(person.slug)}">Abrir ficha interactiva y compararla en el explorador</a></p>
    </article>
  `.trim();
}

function buildStructuredData(person, canonicalUrl, title, description) {
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: '¿Cuánto deben?',
      url: `${SITE_URL}/`,
      inLanguage: 'es-AR',
    },
    {
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: title,
      description,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      inLanguage: 'es-AR',
      about: { '@id': `${canonicalUrl}#person` },
    },
    {
      '@type': 'Person',
      '@id': `${canonicalUrl}#person`,
      name: person.nombre,
      jobTitle: person.cargo,
      description,
      worksFor: getContextLine(person)
        ? {
            '@type': 'Organization',
            name: getContextLine(person),
          }
        : undefined,
    },
  ].map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));

  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': graph,
    },
    null,
    2,
  );
}

async function main() {
  const [template, dbRaw, politicosRaw, judicialRaw] = await Promise.all([
    fs.readFile(path.join(DIST_DIR, 'index.html'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'legisladores_full.json'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'politicos_full.json'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'judicial_full.json'), 'utf8'),
  ]);

  const dbData = JSON.parse(dbRaw);
  const politicosData = JSON.parse(politicosRaw);
  const judicialData = JSON.parse(judicialRaw);
  const people = mergeDashboardPeople(dbData, politicosData, judicialData);

  const sitemapEntries = [`${SITE_URL}/`];

  for (const person of people) {
    const stats = getPersonStats(person);
    const routePath = `/persona/${person.slug}/`;
    const canonicalUrl = `${SITE_URL}${routePath}`;
    const title = `${person.nombre} | Deuda BCRA y estadísticas`;
    const description = buildDescription(person, stats);
    const structuredData = buildStructuredData(person, canonicalUrl, title, description);
    const fallbackBody = buildFallbackBody(person, stats, description);

    let html = template;
    html = replaceMetaTag(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
    html = replaceMetaTag(
      html,
      /<meta\s+[^>]*name="description"[^>]*>/,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    );
    html = replaceMetaTag(
      html,
      /<link\s+[^>]*rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${canonicalUrl}" />`,
    );
    html = replaceMetaTag(
      html,
      /<meta\s+[^>]*property="og:url"[^>]*>/,
      `<meta property="og:url" content="${canonicalUrl}" />`,
    );
    html = replaceMetaTag(
      html,
      /<meta\s+[^>]*property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
    );
    html = replaceMetaTag(
      html,
      /<meta\s+[^>]*property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
    );
    html = replaceMetaTag(
      html,
      /<meta\s+[^>]*name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    );
    html = replaceMetaTag(
      html,
      /<meta\s+[^>]*name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    );
    html = replaceMetaTag(
      html,
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">\n${structuredData}\n</script>`,
    );
    html = replaceMetaTag(
      html,
      /<!--app-html-->[\s\S]*?<!--\/app-html-->/,
      `<!--app-html--><div id="root">${fallbackBody}</div>\n    <script id="person-page-data" type="application/json">${escapeJson(person)}</script><!--/app-html-->`,
    );

    const outDir = path.join(DIST_DIR, 'persona', person.slug);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
    sitemapEntries.push(canonicalUrl);
  }

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapEntries.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');

  await fs.writeFile(path.join(DIST_DIR, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log(`Generadas ${people.length} páginas de persona y sitemap.xml`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
