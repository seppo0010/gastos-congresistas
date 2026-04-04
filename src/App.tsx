import { useMemo, useState, useEffect } from 'react';
import Dashboard from './Dashboard';
import PersonPage from './PersonPage';
import type { DashboardData } from './types';
import {
  type LegislatorWithSlug,
  formatMonthLabel,
  getPersonSlugFromPath,
  mergeDashboardPeople,
  readEmbeddedPersonData,
} from './people';

function scrollToExplorer(behavior: ScrollBehavior = 'smooth') {
  const target = document.getElementById('explorador');
  if (!target) return;
  target.scrollIntoView({ behavior, block: 'start' });
}

interface AppProps {
  initialPathname?: string;
  initialSearch?: string;
}

export default function App({ initialPathname, initialSearch }: AppProps) {
  const pathname = initialPathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const search = initialSearch ?? (typeof window !== 'undefined' ? window.location.search : '');
  const personSlug = useMemo(() => getPersonSlugFromPath(pathname), [pathname]);
  const [embeddedPerson] = useState<LegislatorWithSlug | null>(() => (
    personSlug ? readEmbeddedPersonData() : null
  ));
  const [dbData, setDbData] = useState<DashboardData | null>(null);
  const [politicosData, setPoliticosData] = useState<DashboardData | null>(null);
  const [judicialData, setJudicialData] = useState<DashboardData | null>(null);
  const [person, setPerson] = useState<LegislatorWithSlug | null>(embeddedPerson);
  const [personNotFound, setPersonNotFound] = useState(false);

  useEffect(() => {
    if (personSlug && embeddedPerson) return;

    const params = new URLSearchParams(search);
    const hasPreselected = !!(params.get('funcionarios') || params.get('legisladores'));

    Promise.all([
      fetch('/legisladores_full.json').then(r => r.json()),
      fetch('/politicos_full.json').then(r => r.json()),
      fetch('/judicial_full.json').then(r => r.json()),
    ]).then(([db, pol, jud]) => {
      if (personSlug) {
        const merged = mergeDashboardPeople(db, pol, jud);
        const found = merged.find((candidate) => candidate.slug === personSlug) || null;
        setPerson(found);
        setPersonNotFound(!found);
        return;
      }

      setDbData(db);
      setPoliticosData(pol);
      setJudicialData(jud);
      if (hasPreselected) {
        requestAnimationFrame(() => scrollToExplorer('instant'));
      }
    });
  }, [embeddedPerson, personSlug, search]);

  const heroMetrics = useMemo(() => {
    if (!dbData || !politicosData || !judicialData) return null;
    const combined = mergeDashboardPeople(dbData, politicosData, judicialData);

    let latestMonth = '';

    combined.forEach((l) => {
      (l.historial || []).forEach((h) => {
        if (h.fecha > latestMonth) latestMonth = h.fecha;
      });

      (l.familiares || []).forEach((f) => {
        (f.historial || []).forEach((h) => {
          if (h.fecha > latestMonth) latestMonth = h.fecha;
        });
      });
    });

    return {
      funcionariosCount: combined.length,
      latestMonthLabel: formatMonthLabel(latestMonth),
    };
  }, [dbData, politicosData, judicialData]);

  if (personSlug) {
    if (person) {
      return <PersonPage person={person} />;
    }

    if (personNotFound) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 px-6">
          <div className="max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-3xl font-black uppercase text-gray-950">Persona no encontrada</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              La URL no coincide con ninguna ficha generada. Volvé al explorador para buscar otra persona o abrir una comparativa.
            </p>
            <a
              href="/"
              className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
            >
              Ir al inicio
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando ficha…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800">
      <main>
        <section className="relative overflow-hidden border-b border-gray-200 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.12),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(14,165,233,0.10),transparent_36%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_45%,#f1f5f9_100%)]">
          <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-8 px-6 py-14 md:py-20">
            <div className="max-w-3xl space-y-5">
              <p className="inline-block rounded-full border border-blue-200 bg-blue-50 px-4 py-1 text-xs font-semibold tracking-[0.18em] text-blue-700">
                CENTRAL DE DEUDORES + DECLARACIONES JURADAS
              </p>
              <h1 className="text-4xl font-black uppercase leading-tight text-gray-900 md:text-6xl">¿CUANTO DEBEN?</h1>
              <p className="max-w-2xl text-base leading-relaxed text-gray-700 md:text-lg">
                Este visualizador permite comparar la evolucion mensual de deuda reportada para figuras publicas argentinas,
                con ajustes en pesos constantes o en dolares.
              </p>
              <ul className="space-y-2 text-sm leading-relaxed text-gray-700 md:text-base">
                <li>• Se incluyen funcionarios y legisladores nacionales.</li>
                <li>• Los familiares surgen de las declaraciones juradas patrimoniales.</li>
                <li>• El historial de deuda proviene de la base Central de Deudores del BCRA.</li>
              </ul>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="rounded-lg border border-blue-200 bg-white/70 px-2.5 py-2">
                  <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-blue-700">Funcionarios registrados</p>
                  <p className="mt-0.5 text-lg font-black leading-tight text-gray-900 md:text-xl">
                    {heroMetrics ? heroMetrics.funcionariosCount.toLocaleString('es-AR') : '…'}
                  </p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-white/70 px-2.5 py-2">
                  <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-blue-700">Ultimo mes disponible</p>
                  <p className="mt-0.5 text-sm font-black leading-tight text-gray-900 md:text-base">
                    {heroMetrics ? (heroMetrics.latestMonthLabel || 'Sin datos') : '…'}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <button
                onClick={() => scrollToExplorer()}
                className="inline-flex items-center gap-3 rounded-2xl bg-blue-600 px-6 py-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-blue-700"
              >
                Bajar al explorador
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>
        </section>

        <section id="explorador" className="h-screen w-full border-b border-gray-200 bg-gray-100">
          {dbData && politicosData && judicialData ? (
            <Dashboard dbData={dbData} politicosData={politicosData} judicialData={judicialData} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-gray-500">Cargando datos…</p>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-10 text-sm text-gray-700 md:grid-cols-2">
          <div>
            <h2 className="mb-2 text-base font-bold text-gray-900">About</h2>
            <p className="leading-relaxed">
              Proyecto civico para facilitar la lectura publica de datos financieros de funcionarios y legisladores,
              con foco en transparencia y comparacion historica.
            </p>
          </div>
          <div className="md:text-right">
            <h2 className="mb-2 text-base font-bold text-gray-900">Repositorio</h2>
            <a
              href="https://github.com/seppo0010/gastos-congresistas"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-blue-700 underline-offset-4 transition hover:text-blue-800 hover:underline"
            >
              github.com/seppo0010/gastos-congresistas
            </a>
            <div className="mt-3 space-y-1 text-xs text-gray-600">
              <p>
                Autor: Sebastian Waisbrot (
                <a
                  href="https://github.com/seppo0010"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 underline-offset-4 transition hover:text-blue-800 hover:underline"
                >
                  seppo0010
                </a>
                )
              </p>
              <p>
                Andres Snitcofsky (diseno, viz y ux):
                {' '}
                <a
                  href="https://visualizando.ar"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 underline-offset-4 transition hover:text-blue-800 hover:underline"
                >
                  visualizando.ar
                </a>
              </p>
            </div>
            <p className="mt-3 text-xs text-gray-500">Hecho para exploracion publica y periodismo de datos.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
