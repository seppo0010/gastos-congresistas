import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITE_URL = 'https://cuantodeben.visualizando.ar';
const rawBasePath = process.env.GITHUB_PAGES_BASE || '/';

function normalizeBasePath(base) {
  if (!base || base === '/') return '/';
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

const BASE_PATH = normalizeBasePath(rawBasePath);

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

function buildDescription(person, stats, people) {
  const latest = stats.latestMonth
    ? `En ${people.formatMonthLabel(stats.latestMonth)} registró ${people.formatMoneyArs(stats.latestDebt)}`
    : 'No tiene historial de deuda reportado';
  const peak = stats.peakMonth
    ? `y su pico fue ${people.formatMoneyArs(stats.peakDebt)} en ${people.formatMonthLabel(stats.peakMonth)}`
    : 'y no hay un pico identificable';

  return `${person.nombre}. ${people.getPersonContextLine(person) || people.getPowerLabel(person)}. ${latest} ${peak}. Ficha individual del BCRA en ¿Cuánto deben?`;
}

function buildPeopleDirectoryDescription(count) {
  return `Listado alfabético de ${count.toLocaleString('es-AR')} funcionarios, legisladores y miembros del Poder Judicial con ficha pública y enlaces internos.`;
}

function buildStructuredData(person, canonicalUrl, title, description, people) {
  const contextLine = people.getPersonContextLine(person);
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
      worksFor: contextLine
        ? {
            '@type': 'Organization',
            name: contextLine,
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

function buildPeopleDirectoryStructuredData(entries, canonicalUrl, title, description) {
  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          name: '¿Cuánto deben?',
          url: `${SITE_URL}/`,
          inLanguage: 'es-AR',
        },
        {
          '@type': 'CollectionPage',
          '@id': `${canonicalUrl}#webpage`,
          url: canonicalUrl,
          name: title,
          description,
          isPartOf: { '@id': `${SITE_URL}/#website` },
          inLanguage: 'es-AR',
        },
        {
          '@type': 'ItemList',
          '@id': `${canonicalUrl}#list`,
          name: title,
          numberOfItems: entries.length,
          itemListElement: entries.map((entry, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${SITE_URL}/personas/${entry.slug}/`,
            name: entry.nombre,
          })),
        },
      ],
    },
    null,
    2,
  );
}

function injectAppHtml(template, rootHtml, extraScripts = '') {
  return replaceMetaTag(
    template,
    /<!--app-html-->[\s\S]*?<!--\/app-html-->/,
    `<!--app-html--><div id="root" data-prerendered-app="true">${rootHtml}</div>${extraScripts}<!--/app-html-->`,
  );
}

function suppressResponsiveContainerWarnings(render) {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  const suppressWarning = (...args) => {
    const [message] = args;
    if (
      typeof message === 'string'
      && message.includes('The width(-1) and height(-1) of chart should be greater than 0')
    ) {
      return;
    }

    originalConsoleError(...args);
  };

  console.error = suppressWarning;
  console.warn = (...args) => {
    const [message] = args;
    if (
      typeof message === 'string'
      && message.includes('The width(-1) and height(-1) of chart should be greater than 0')
    ) {
      return;
    }

    originalConsoleWarn(...args);
  };

  try {
    return render();
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
}

async function writeHtmlPage({
  template,
  outDir,
  title,
  description,
  canonicalUrl,
  structuredData,
  rootHtml,
  extraScripts = '',
}) {
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
  html = injectAppHtml(html, rootHtml, extraScripts);

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
}

async function main() {
  const [template, dbRaw, politicosRaw, judicialRaw, familiaresRaw] = await Promise.all([
    fs.readFile(path.join(DIST_DIR, 'index.html'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'legisladores_full.json'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'politicos_full.json'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'judicial_full.json'), 'utf8'),
    fs.readFile(path.join(PUBLIC_DIR, 'familiares.json'), 'utf8').catch(() => '{}'),
  ]);

  const vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
  });

  try {
    const [people, staticPages] = await Promise.all([
      vite.ssrLoadModule('/src/people.ts'),
      vite.ssrLoadModule('/src/static-pages.tsx'),
    ]);

    const dbData = JSON.parse(dbRaw);
    const politicosData = JSON.parse(politicosRaw);
    const judicialData = JSON.parse(judicialRaw);
    const familiaresDdjj = JSON.parse(familiaresRaw);
    const mergedPeople = people.mergeDashboardPeople(dbData, politicosData, judicialData, {}, familiaresDdjj);
    const directoryEntries = people.getPeopleDirectoryEntries(mergedPeople);

    const homeHtml = injectAppHtml(template, staticPages.renderHomePage());
    await fs.writeFile(path.join(DIST_DIR, 'index.html'), homeHtml, 'utf8');

    const sitemapEntries = [`${SITE_URL}/`];

    for (const person of mergedPeople) {
      const stats = people.getPersonStats(person);
      const routePath = `/personas/${person.slug}/`;
      const canonicalUrl = `${SITE_URL}${routePath}`;
      const title = `${person.nombre} | Deuda BCRA y estadísticas`;
      const description = buildDescription(person, stats, people);
      const structuredData = buildStructuredData(person, canonicalUrl, title, description, people);
      const rootHtml = suppressResponsiveContainerWarnings(() => staticPages.renderPersonPage(person));
      const extraScripts = `\n    <script id="person-page-data" type="application/json">${escapeJson(person)}</script>`;

      await writeHtmlPage({
        template,
        outDir: path.join(DIST_DIR, 'personas', person.slug),
        title,
        description,
        canonicalUrl,
        structuredData,
        rootHtml,
        extraScripts,
      });
      sitemapEntries.push(canonicalUrl);
    }

    const directoryUrl = `${SITE_URL}/personas/`;
    const directoryTitle = 'Personas incluidas en el sitio | ¿Cuánto deben?';
    const directoryDescription = buildPeopleDirectoryDescription(directoryEntries.length);
    const directoryStructuredData = buildPeopleDirectoryStructuredData(
      directoryEntries,
      directoryUrl,
      directoryTitle,
      directoryDescription,
    );
    const directoryHtml = staticPages.renderPeopleDirectoryPage(directoryEntries);
    const directoryScript = `\n    <script id="people-directory-data" type="application/json">${escapeJson(directoryEntries)}</script>`;

    await writeHtmlPage({
      template,
      outDir: path.join(DIST_DIR, 'personas'),
      title: directoryTitle,
      description: directoryDescription,
      canonicalUrl: directoryUrl,
      structuredData: directoryStructuredData,
      rootHtml: directoryHtml,
      extraScripts: directoryScript,
    });
    sitemapEntries.push(directoryUrl);

    const sitemapXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...sitemapEntries.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`),
      '</urlset>',
      '',
    ].join('\n');

    await fs.writeFile(path.join(DIST_DIR, 'sitemap.xml'), sitemapXml, 'utf8');
    console.log(`Generadas ${mergedPeople.length} páginas de persona, directorio público y sitemap.xml`);
    console.log(`Base de preview: ${BASE_PATH}`);
  } finally {
    await vite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
