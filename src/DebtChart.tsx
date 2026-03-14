import { useMemo, useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Brush } from 'recharts';

// Importa tu JSON generado por Python
import type { Legislator, Milestone, CurrencyMode } from './types';
import { Flag, HelpCircle, Share2, Users } from 'lucide-react';
import { COLORS } from './Colors';

interface DebtChartProps {
  legislators: Legislator[];
  globalMilestones: Milestone[];
  ipc?: { [date: string]: number };
  mep?: { [date: string]: number };
  onRemove?: (legislator: Legislator) => void;
  isMobile?: boolean;
  copied?: boolean;
  onShare?: () => void;
  onShowHelp?: () => void;
  includeFamiliares?: boolean;
  onToggleFamiliares?: () => void;
}

interface Bank {
    fecha: string;
    monto: number;
    entidad: string;
}

// Separator used in segment keys (unlikely to appear in data)
const SEP = '|||';

interface SegmentInfo {
  cuit: string;
  entidad: string;
  isFamiliar: boolean;
  parentesco?: string;
  totalMonto: number;
}

function tintColor(hex: string, amount: number): string {
  // amount 0 = original color, 1 = white
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

const teniaCargo = (legislator: Legislator, cargo: string | undefined, fecha: string): boolean => {
  return (legislator.periodos || []).filter(p => p.cargo.toLowerCase() === (cargo || '').toLowerCase() && fecha > p.inicio && fecha < p.fin).length > 0
}

const GRAY = '#9ca3af';
const ORANGE = '#FFA800';

const CustomEconomicMarker = (props: any) => {
  const { cx, cy, color } = props;
  if (!cx || !cy) return null;
  return (
    <g>
      <line
        x1={cx - 15}
        x2={cx + 15}
        y1={cy}
        y2={cy}
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
};

const DebtChart = forwardRef(({
  legislators,
  globalMilestones,
  ipc,
  mep,
  onRemove,
  isMobile,
  copied,
  onShare,
  onShowHelp,
  includeFamiliares = false,
  onToggleFamiliares
}: DebtChartProps, ref) => {
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('nominal');
  const chartContainerRef = useRef<HTMLDivElement>(null);


  useImperativeHandle(ref, () => ({
    getChartElement: () => chartContainerRef.current,
  }));

  const ipcDates = useMemo(() => {
    const r = Object.keys(ipc || {});
    r.sort();
    return r;
  }, [ipc]);

  const latestIPC = useMemo(() => {
    if (currencyMode === 'real' && ipc && ipcDates.length > 0) {
      return ipc[ipcDates[ipcDates.length - 1]];
    }
    return 0;
  }, [currencyMode, ipc, ipcDates]);

  const convertMonto = (monto: number, fecha: string) => {
    if (currencyMode === 'real' && ipc && latestIPC > 0) {
      const val = ipc[fecha];
      if (val) return (monto * latestIPC) / val;
    } else if (currencyMode === 'usd' && mep) {
      const val = mep[fecha];
      return (val && val > 0) ? (monto * 1000) / val : 0;
    }
    return monto;
  };

  // 1. Unificar Hitos (Globales + Personales)
  const { verticalMilestones, economicMilestones } = useMemo(() => {
    const personales = legislators.flatMap((l, index) =>
      (l.hitos_personales || []).map(h => ({
        ...h,
        legislatorId: l.cuit,
        legislatorColor: l.color || COLORS[index % COLORS.length]
      }))
    );

    const relevantes = globalMilestones.filter(m => (
      ['global', 'voto', 'politico'].includes(m.tipo || '') ||
      legislators.some(l => teniaCargo(l, m.tipo, m.fecha))
    ));

    const all = [...relevantes, ...personales];

    // Milestones with monto are economic
    const eco = all.filter(m => m.monto != null).map(m => ({
      ...m,
      color: ORANGE,
      convertedMonto: convertMonto((m.monto || 0) / 1000, m.fecha)
    }));

    // Grouping only for vertical milestones
    const grouped = all.filter(m => m.monto == null).reduce((acc: Record<string, any[]>, m: any) => {
      (acc[m.fecha] ??= []).push(m);
      return acc;
    }, {});

    const vertical = Object.values(grouped).map((group: any) => {
      const legislatorIds = new Set(group.map((m: any) => m.legislatorId).filter(Boolean));
      const hasGlobal = group.some((m: any) => !m.legislatorId);

      let color = GRAY;

      if (legislatorIds.size === 1 && !hasGlobal) {
        color = group.find((m: any) => m.legislatorId).legislatorColor;
      } else if (legislatorIds.size === 0 && hasGlobal && legislators.length === 1) {
        color = group[0].color;
      }

      return {
        fecha: group[0].fecha,
        texto: group.map((y: any) => y.texto).join(', '),
        color,
        tipo: group[0].tipo,
      }
    });

    return { verticalMilestones: vertical, economicMilestones: eco };
  }, [legislators, globalMilestones, currencyMode, latestIPC, ipc, mep]);

  // 2a. Calcular segmentos únicos (cuit × deudor × entidad) con total acumulado
  const barSegments = useMemo(() => {
    const map = new Map<string, SegmentInfo>();

    legislators.forEach(l => {
      l.historial.forEach(r => {
        const key = `${l.cuit}${SEP}propio${SEP}${r.entidad}`;
        const existing = map.get(key);
        if (existing) existing.totalMonto += r.monto;
        else map.set(key, { cuit: l.cuit, entidad: r.entidad, isFamiliar: false, totalMonto: r.monto });
      });

      if (includeFamiliares && l.familiares) {
        l.familiares.forEach(familiar => {
          familiar.historial.forEach(r => {
            const key = `${l.cuit}${SEP}${familiar.parentesco}${SEP}${r.entidad}`;
            const existing = map.get(key);
            if (existing) existing.totalMonto += r.monto;
            else map.set(key, { cuit: l.cuit, entidad: r.entidad, isFamiliar: true, parentesco: familiar.parentesco, totalMonto: r.monto });
          });
        });
      }
    });

    return map;
  }, [legislators, includeFamiliares]);

  // 2b. Asignar colores a cada segmento (tintes del color base del político)
  const segmentColors = useMemo(() => {
    const colorMap = new Map<string, string>();

    legislators.forEach((l, idx) => {
      const baseColor = l.color || COLORS[idx % COLORS.length];

      const propioKeys = [...barSegments.entries()]
        .filter(([, v]) => v.cuit === l.cuit && !v.isFamiliar)
        .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
        .map(([key]) => key);

      const familiaresKeys = [...barSegments.entries()]
        .filter(([, v]) => v.cuit === l.cuit && v.isFamiliar)
        .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
        .map(([key]) => key);

      // Propio: base color → tinte 55% (de oscuro a claro según deuda)
      propioKeys.forEach((key, i) => {
        const tint = propioKeys.length <= 1 ? 0 : (i / (propioKeys.length - 1)) * 0.55;
        colorMap.set(key, tintColor(baseColor, tint));
      });

      // Familiares: tintes 65%–85% (zona visualmente diferenciada)
      familiaresKeys.forEach((key, i) => {
        const tint = familiaresKeys.length <= 1
          ? 0.65
          : 0.65 + (i / (familiaresKeys.length - 1)) * 0.2;
        colorMap.set(key, tintColor(baseColor, tint));
      });
    });

    return colorMap;
  }, [legislators, barSegments]);

  // 2c. Procesar Datos de Deuda (Agrupar por mes)
  const chartData = useMemo(() => {
    const grouped: { [key: string]: any } = {};

    const ensureEntry = (fecha: string, cuit: string) => {
      if (!grouped[fecha]) grouped[fecha] = { date: fecha, banks: {} };
      if (!grouped[fecha].banks[cuit]) grouped[fecha].banks[cuit] = { propio: [], familiares: {} };
    };

    legislators.forEach(l => {
      // Historial propio
      l.historial.forEach(r => {
        ensureEntry(r.fecha, l.cuit);
        const monto = convertMonto(r.monto, r.fecha);
        const key = `${l.cuit}${SEP}propio${SEP}${r.entidad}`;
        grouped[r.fecha][key] = (grouped[r.fecha][key] || 0) + monto;
        grouped[r.fecha].banks[l.cuit].propio.push({ ...r, monto });
      });

      // Familiares
      if (includeFamiliares && l.familiares) {
        l.familiares.forEach(familiar => {
          familiar.historial.forEach(r => {
            ensureEntry(r.fecha, l.cuit);
            const monto = convertMonto(r.monto, r.fecha);
            const key = `${l.cuit}${SEP}${familiar.parentesco}${SEP}${r.entidad}`;
            grouped[r.fecha][key] = (grouped[r.fecha][key] || 0) + monto;
            const fams = grouped[r.fecha].banks[l.cuit].familiares;
            if (!fams[familiar.parentesco]) fams[familiar.parentesco] = [];
            fams[familiar.parentesco].push({ ...r, monto });
          });
        });
      }
    });

    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [legislators, currencyMode, ipc, mep, ipcDates, includeFamiliares, latestIPC]);


  const xAxisInterval = useMemo(() => {
    if (!isMobile) return 0;
    const ticks = chartData.length;
    if (ticks <= 20) return 0; // Show all for up to 20 ticks
    return Math.floor(ticks / 15); // Aim for ~15 ticks
  }, [isMobile, chartData.length]);

  const xAxisTickFormatter = (date: string) => {
    const [year, month] = date.split('-');
    const d = new Date(parseInt(year), parseInt(month) - 1);

    // Capitalize first letter and remove period
    const monthStr = d.toLocaleDateString('es-AR', { month: 'short' });
    const formattedMonth = monthStr.charAt(0).toUpperCase() + monthStr.slice(1).replace('.', '');

    return `${formattedMonth} '${year.substring(2)}`;
  };

  const yAxisTickFormatter = (value: number) => {
    if (currencyMode === 'usd') {
      if (Math.abs(value) >= 1000000) {
        return `US$${(value / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
      }
      if (Math.abs(value) >= 1000) {
        return `US$${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k`;
      }
      return `US$${value.toLocaleString('es-AR')}`;
    } else { // ARS (nominal or real), value is in thousands of pesos.
      if (Math.abs(value) >= 1000000) { // 1,000,000k = 1B
        return `$${(value / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}B`;
      }
      if (Math.abs(value) >= 1000) { // 1,000k = 1M
        return `$${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
      }
      if (value > 0) {
        return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}k`;
      }
      return '$0';
    }
  };

  if (legislators.length === 0) return (
    <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 h-full">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Central de Deudores</h1>
        <p className="text-gray-600 mb-6 text-sm leading-relaxed">
          Explorá los registros de deuda de legisladores y funcionarios del Estado argentino
          según el BCRA. Los datos muestran el total informado cada mes por los bancos,
          lo que usualmente representa gastos de tarjeta de crédito u otros créditos.
        </p>
        <div className="space-y-3 mb-6">
          <div className="flex items-start gap-3">
            <span className="bg-blue-100 text-blue-700 font-bold rounded-full w-6 h-6 flex items-center justify-center text-sm shrink-0 mt-0.5">1</span>
            <p className="text-sm text-gray-700">Buscá un funcionario o legislador en la lista de la izquierda</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="bg-blue-100 text-blue-700 font-bold rounded-full w-6 h-6 flex items-center justify-center text-sm shrink-0 mt-0.5">2</span>
            <p className="text-sm text-gray-700">Hacé click para ver su historial de deuda en el gráfico</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="bg-blue-100 text-blue-700 font-bold rounded-full w-6 h-6 flex items-center justify-center text-sm shrink-0 mt-0.5">3</span>
            <p className="text-sm text-gray-700">Seleccioná hasta 4 personas para comparar</p>
          </div>
        </div>
      </div>
    </div>
  );

  const formatMoney = (val: number) => {
    if (currencyMode === 'usd') return `US$ ${new Intl.NumberFormat('es-AR').format(Math.round(val))}`;
    return `$${new Intl.NumberFormat('es-AR').format(Math.round(val * 1000))}`;
  };

  // Tooltip Personalizado con Hitos
  const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: any, label?: string | number }) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div className="bg-white p-3 border shadow-lg rounded text-xs z-50 max-w-xs">
        <p className="font-bold mb-1">{label}</p>

        {legislators.map((l, idx) => {
          const lPayloads = payload.filter((p: any) => p.dataKey.startsWith(l.cuit + SEP));
          if (lPayloads.length === 0) return null;
          const total = lPayloads.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
          const banks = lPayloads[0].payload.banks[l.cuit] || { propio: [], familiares: {} };

          const personalMilestones = (l.hitos_personales || []).filter(h => h.fecha === label);
          const relevantGlobalMilestones = globalMilestones.filter(m =>
            m.fecha === label && (
              ['global', 'voto', 'politico'].includes(m.tipo || '') ||
              teniaCargo(l, m.tipo as any, m.fecha)
            )
          );
          const milestones = [...personalMilestones, ...relevantGlobalMilestones];
          const familiarEntries = Object.entries(banks.familiares as { [parentesco: string]: Bank[] });

          return (
            <div key={l.cuit} className="mb-2 border-b pb-1 last:border-0">
              <p className="font-bold text-sm" style={{ color: l.color || COLORS[idx % COLORS.length] }}>
                {l.nombre}: {formatMoney(total)}
              </p>
              {milestones.map((m, i) => (
                <div key={i} className="mb-1 p-1 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 font-semibold flex items-center gap-1">
                    <Flag size={10} /> {m.texto}
                </div>
              ))}
              {/* Deuda propia */}
              {(banks.propio.length > 0) && (
                <div className="mt-1">
                  {includeFamiliares && familiarEntries.length > 0 && (
                    <p className="font-semibold opacity-60 uppercase tracking-wide" style={{ fontSize: 9 }}>Titular</p>
                  )}
                  <div className="pl-1">
                    {banks.propio.map((b: Bank, i: number) => {
                      const color = segmentColors.get(`${l.cuit}${SEP}propio${SEP}${b.entidad}`);
                      return (
                        <div key={i} className="flex items-center gap-1 opacity-80">
                          <span className="shrink-0 w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                          {b.entidad}: {formatMoney(b.monto)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Deuda familiares */}
              {familiarEntries.map(([parentesco, records]) => (
                <div key={parentesco} className="mt-1">
                  <p className="font-semibold opacity-60 uppercase tracking-wide flex items-center gap-1" style={{ fontSize: 9 }}>
                    <Users size={9} /> {parentesco}
                  </p>
                  <div className="pl-1">
                    {records.map((b: Bank, i: number) => {
                      const color = segmentColors.get(`${l.cuit}${SEP}${parentesco}${SEP}${b.entidad}`);
                      return (
                        <div key={i} className="flex items-center gap-1 opacity-80">
                          <span className="shrink-0 w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                          {b.entidad}: {formatMoney(b.monto)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 p-2 md:p-6 bg-gray-50 flex flex-col h-full">
      <div className="bg-white p-2 md:p-4 rounded-lg shadow-sm mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
          <h2 className="text-xl font-bold">Comparativa</h2>
          {!isMobile && onShowHelp && (
            <button onClick={onShowHelp} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors" title="Ayuda">
              <HelpCircle size={18} />
            </button>
          )}
          <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
            {copied && <span className="text-sm text-green-600 font-semibold animate-pulse mr-2">¡Link copiado!</span>}
            {onShare && (
              <button
                onClick={onShare}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors hidden md:block"
                title="Compartir"
              >
                <Share2 size={18} />
              </button>
            )}
            <button
              onClick={onToggleFamiliares}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                includeFamiliares
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
              title="Incluir deuda de familiares"
            >
              <Users size={13} />
              Familiares
            </button>
            <select
              value={currencyMode}
              onChange={e => setCurrencyMode(e.target.value as CurrencyMode)}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="nominal">Pesos (Nominal)</option>
              {ipc && <option value="real">Pesos (Ajustado por inflación a precios de {ipcDates.length > 0 ? ipcDates[ipcDates.length - 1] : ''})</option>}
              {mep && <option value="usd">Dólares (MEP)</option>}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          {legislators.map((l, idx) => (
            <div
              key={l.cuit}
              className="flex items-center gap-2 border p-2 rounded cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => onRemove && onRemove(l)}
            >
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: l.color || COLORS[idx % COLORS.length] }}></div>
              <div>
                <div className="font-bold text-sm flex items-center gap-1">
                  {l.nombre}
                  {l.familiares && l.familiares.length > 0 && (
                    <span title="Tiene datos de familiares" className="flex">
                      <Users size={13} className="text-blue-400 shrink-0" />
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {l.partido && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{l.partido}</span>}
                  {l.distrito && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{l.distrito}</span>}
                  {l.unidad && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{l.unidad}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div ref={chartContainerRef} className="flex-1 min-h-48 md:bg-white md:p-4 md:rounded-lg md:shadow-sm">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: isMobile ? 30 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{fontSize: 10}}
              angle={isMobile ? -45 : 0}
              textAnchor={isMobile ? "end" : "middle"}
              height={isMobile ? 40 : 30}
              interval={xAxisInterval}
              tickFormatter={xAxisTickFormatter}
            />
            <YAxis
              tickFormatter={yAxisTickFormatter}
              tick={{fontSize: 11}}
              width={65}
            />
            <Tooltip content={CustomTooltip} />

            {legislators.flatMap((l, idx) => {
              const propioKeys = [...barSegments.entries()]
                .filter(([, v]) => v.cuit === l.cuit && !v.isFamiliar)
                .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
                .map(([key]) => key);
              const familiaresKeys = [...barSegments.entries()]
                .filter(([, v]) => v.cuit === l.cuit && v.isFamiliar)
                .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
                .map(([key]) => key);
              return [...propioKeys, ...familiaresKeys].map(key => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId={l.cuit}
                  fill={segmentColors.get(key) || l.color || COLORS[idx % COLORS.length]}
                  isAnimationActive={false}
                />
              ));
            })}

            {/* RENDERIZADO DE TODOS LOS HITOS */}
            {verticalMilestones.map((m, idx) => (
              <ReferenceLine
                key={`vert-${idx}`}
                x={m.fecha}
                stroke={m.color}
                strokeDasharray="4 2"
                label={{
                    value: m.texto,
                    position: 'insideTop',
                    fill: m.color,
                    fontSize: 10,
                    fontWeight: 'bold',
                    angle: -90, // Texto vertical para que no se pisen
                    textAnchor: 'end',
                    dx: 4,
                }}
              />
            ))}

            {economicMilestones.map((m, idx) => (
              <ReferenceDot
                key={`eco-${idx}`}
                x={m.fecha}
                y={m.convertedMonto}
                shape={<CustomEconomicMarker color={m.color} />}
              />
            ))}
            <Brush dataKey="date" height={25} stroke={GRAY} tickFormatter={() => ''} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default DebtChart;
