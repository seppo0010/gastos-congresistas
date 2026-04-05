import { useEffect } from 'react';
import { ArrowLeft, Building2, CircleAlert, FileBarChart2, Home, Landmark, ShieldAlert, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SITUACION_BCRA } from './LegislatorSelector';
import {
  type LegislatorWithSlug,
  formatCompactMoneyArs,
  formatMoneyArs,
  formatMonthLabel,
  getPeopleDirectoryRoute,
  getPersonContextLine,
  getPersonRoute,
  getPersonStats,
  getPowerLabel,
} from './people';
import { withBasePath } from './site';
import { usePostHog } from '@posthog/react';

interface PersonPageProps {
  person: LegislatorWithSlug;
}

function getSummary(person: LegislatorWithSlug) {
  const stats = getPersonStats(person);
  const latest = stats.latestMonth
    ? `En ${formatMonthLabel(stats.latestMonth)} registró ${formatMoneyArs(stats.latestDebt)}`
    : 'No tiene meses de deuda reportados en el historial disponible';
  const peak = stats.peakMonth
    ? `su pico fue ${formatMoneyArs(stats.peakDebt)} en ${formatMonthLabel(stats.peakMonth)}`
    : 'sin pico identificable';

  return `${latest} y ${peak}. La serie cubre ${stats.monthsWithDebt} meses reportados por el BCRA.`;
}

export default function PersonPage({ person }: PersonPageProps) {
  const posthog = usePostHog();
  const stats = getPersonStats(person);
  const contextLine = getPersonContextLine(person);
  const situation = stats.latestSituation != null ? SITUACION_BCRA[stats.latestSituation] : null;
  const latestRows = [...stats.monthlySeries].slice(-12).reverse();

  useEffect(() => {
    posthog?.capture('person_page_viewed', { nombre: person.nombre, poder: person.poder, slug: person.slug });
  }, [posthog, person.nombre, person.poder, person.slug]);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-blue-700">
              <a
                href={withBasePath("/")}
                className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
              >
                <ArrowLeft size={16} />
                Volver al explorador
              </a>
              <a
                href={getPeopleDirectoryRoute()}
                className="underline-offset-4 hover:underline"
              >
                Ver directorio completo
              </a>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black uppercase tracking-tight text-gray-950 md:text-5xl">
                {person.nombre}
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-gray-700 md:text-base">
                {contextLine || getPowerLabel(person)}. {getSummary(person)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">
              {getPowerLabel(person)}
            </span>
            {person.es_candidato && (
              <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                Candidato
              </span>
            )}
            {situation && (
              <span
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: situation.color }}
              >
                {situation.label}
              </span>
            )}
            <a
              href={withBasePath(`/?funcionarios=${person.slug}`)}
              onClick={() => posthog?.capture('open_comparison_clicked', { nombre: person.nombre, slug: person.slug })}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
            >
              Abrir comparativa
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Último mes</p>
            <p className="mt-2 text-xl font-black text-gray-950">
              {stats.latestMonth ? formatCompactMoneyArs(stats.latestDebt) : 'Sin datos'}
            </p>
            <p className="mt-1 text-sm text-gray-600">{formatMonthLabel(stats.latestMonth)}</p>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pico histórico</p>
            <p className="mt-2 text-xl font-black text-gray-950">
              {stats.peakMonth ? formatCompactMoneyArs(stats.peakDebt) : 'Sin datos'}
            </p>
            <p className="mt-1 text-sm text-gray-600">{formatMonthLabel(stats.peakMonth)}</p>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Promedio mensual</p>
            <p className="mt-2 text-xl font-black text-gray-950">{formatCompactMoneyArs(stats.averageMonthlyDebt)}</p>
            <p className="mt-1 text-sm text-gray-600">{stats.monthsWithDebt} meses con registros</p>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bancos reportados</p>
            <p className="mt-2 text-xl font-black text-gray-950">{stats.entityCount}</p>
            <p className="mt-1 text-sm text-gray-600">
              {stats.latestVariationPct == null
                ? 'Sin variación comparable'
                : `${stats.latestVariationPct >= 0 ? '+' : ''}${stats.latestVariationPct.toFixed(1)}% vs. mes anterior`}
            </p>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <article className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-950">Evolución mensual</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  Totales mensuales agregados a partir del historial del BCRA. Los montos del dataset original están en miles de pesos y acá se muestran en pesos nominales.
                </p>
              </div>
              <a
                href={getPersonRoute(person.slug)}
                className="hidden shrink-0 text-sm font-semibold text-blue-700 underline-offset-4 hover:underline md:block"
              >
                URL pública
              </a>
            </div>

            <div className="mt-5 h-80">
              {stats.monthlySeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.monthlySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) => {
                        const [year, month] = value.split('-');
                        return `${month}/${year.slice(2)}`;
                      }}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(value: number) =>
                        new Intl.NumberFormat('es-AR', { notation: 'compact', compactDisplay: 'short' }).format(value * 1000)
                      }
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={72}
                    />
                    <Tooltip
                      formatter={(value) => formatMoneyArs(typeof value === 'number' ? value : 0)}
                      labelFormatter={(value) => formatMonthLabel(typeof value === 'string' ? value : null)}
                      contentStyle={{ borderRadius: 12, borderColor: '#d1d5db' }}
                    />
                    <Bar dataKey="total" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                  No hay historial de deuda cargado para esta persona.
                </div>
              )}
            </div>
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
            <h2 className="text-lg font-bold text-gray-950">Ficha</h2>
            <div className="mt-4 space-y-3 text-sm text-gray-700">
              <div className="flex items-start gap-3">
                <FileBarChart2 size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Cobertura</p>
                  <p>
                    {stats.firstMonth ? `${formatMonthLabel(stats.firstMonth)} a ${formatMonthLabel(stats.latestMonth)}` : 'Sin serie temporal'}.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Landmark size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Cargo y pertenencia</p>
                  <p>{contextLine || 'Sin detalle institucional adicional.'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Building2 size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Entidades informantes</p>
                  <p>{stats.entityCount > 0 ? `${stats.entityCount} banco(s) o entidad(es) en el historial.` : 'Sin entidades reportadas.'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Users size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Familiares con datos</p>
                  <p>{stats.familiaresCount > 0 ? `${stats.familiaresCount} familiar(es) con historial en las DJ.` : 'Sin familiares cargados.'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Home size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Garantía preferida</p>
                  <p>{person.hipoteca_bcra.tiene ? 'Sí, figura con garantía preferida según BCRA.' : 'No figura con garantía preferida en el BCRA.'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CircleAlert size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Cambio de nivel</p>
                  <p>{person.cambios_nivel ? 'Sí, el dataset marca cambios de nivel en la deuda.' : 'No, el dataset no marca cambios de nivel.'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <ShieldAlert size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <div>
                  <p className="font-semibold text-gray-900">Situación BCRA</p>
                  <p>{situation ? situation.label : 'Sin situación consolidada.'}</p>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-950">Últimos meses reportados</h2>
              <p className="mt-1 text-sm text-gray-600">
                Resumen de la serie mensual agregada. Si querés ver el detalle por banco, abrí la comparativa interactiva.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-semibold">Mes</th>
                  <th className="px-3 py-2 font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Entidades</th>
                  <th className="px-3 py-2 font-semibold">Situación máxima</th>
                </tr>
              </thead>
              <tbody>
                {latestRows.length > 0 ? latestRows.map((row) => (
                  <tr key={row.date} className="border-b border-gray-100 text-gray-700">
                    <td className="px-3 py-2 font-medium text-gray-900">{formatMonthLabel(row.date)}</td>
                    <td className="px-3 py-2">{formatMoneyArs(row.total)}</td>
                    <td className="px-3 py-2">{row.entityCount}</td>
                    <td className="px-3 py-2">
                      {SITUACION_BCRA[row.maxSituation]?.label ?? row.maxSituation ?? 'Sin datos'}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                      No hay meses reportados para mostrar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
