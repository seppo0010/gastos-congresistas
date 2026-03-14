import Dashboard from './Dashboard';

function scrollToExplorer() {
  const target = document.getElementById('explorador');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function App() {
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
            </div>

            <div>
              <button
                onClick={scrollToExplorer}
                className="inline-flex items-center gap-3 rounded-2xl bg-blue-600 px-6 py-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-blue-700"
              >
                Bajar al explorador
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>
        </section>

        <section id="explorador" className="h-screen w-full border-b border-gray-200 bg-gray-100">
          <Dashboard />
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