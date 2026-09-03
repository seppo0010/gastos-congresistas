import { ArrowLeft } from "lucide-react";
import {
  type PersonDirectoryItem,
  getPersonContextLine,
  getPersonRoute,
  getPowerLabel,
} from "./people";
import { withBasePath } from "./site";

interface PeopleDirectoryPageProps {
  entries: PersonDirectoryItem[];
}

export default function PeopleDirectoryPage({
  entries,
}: PeopleDirectoryPageProps) {
  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <a
              href={withBasePath("/")}
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
            >
              <ArrowLeft size={16} />
              Volver al inicio
            </a>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                Directorio público
              </p>
              <h1 className="text-3xl font-black uppercase tracking-tight text-gray-950 md:text-5xl">
                Personas incluidas en el sitio
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-gray-700 md:text-base">
                Listado alfabético de funcionarios, legisladores y miembros del
                Poder Judicial con ficha individual y acceso a la comparativa
                interactiva.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              Total
            </p>
            <p className="mt-1 text-2xl font-black">
              {entries.length.toLocaleString("es-AR")}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-950">
                Listado alfabético
              </h2>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => {
              const contextLine = getPersonContextLine(entry);

              return (
                <article
                  key={entry.slug}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      {getPowerLabel(entry)}
                    </p>
                    <h2 className="text-base font-black uppercase leading-tight text-gray-950">
                      <a
                        href={getPersonRoute(entry.slug)}
                        className="hover:text-blue-700"
                      >
                        {entry.nombre}
                      </a>
                    </h2>
                    <p className="text-sm leading-relaxed text-gray-600">
                      {contextLine || "Sin detalle institucional adicional."}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
