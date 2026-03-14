import { useMemo, useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Brush } from 'recharts';

// Importa tu JSON generado por Python
import type { Legislator, Milestone, CurrencyMode } from './types';
import { Eye, EyeOff, Flag, HelpCircle, Share2, Users, X } from 'lucide-react';
import { COLORS } from './Colors';

interface DebtChartProps {
  legislators: Legislator[];
  globalMilestones: Milestone[];
  ipc?: { [date: string]: number };
  mep?: { [date: string]: number };
  onRemove?: (legislator: Legislator) => void;
  onToggleVisibility?: (cuit: string) => void;
  isMobile?: boolean;
  copied?: boolean;
  onShare?: () => void;
  onShowHelp?: () => void;
  includeFamiliares?: boolean;
  onToggleFamiliares?: () => void;
  hiddenIds?: Set<string>;
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

interface MilestoneChipStyle {
  color: string;
  backgroundColor: string;
  borderColor: string;
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

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getMilestoneChipStyle(color?: string): MilestoneChipStyle {
  const resolvedColor = color || GRAY;
  return {
    color: resolvedColor,
    backgroundColor: tintColor(resolvedColor, 0.9),
    borderColor: tintColor(resolvedColor, 0.55),
  };
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
  onToggleVisibility,
  isMobile,
  copied,
  onShare,
  onShowHelp,
  includeFamiliares = false,
  onToggleFamiliares,
  hiddenIds = new Set<string>(),
}: DebtChartProps, ref) => {
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('nominal');
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const visibleLegislators = useMemo(
    () => legislators.filter(l => !hiddenIds.has(l.cuit)),
    [legislators, hiddenIds]
  );


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
    const personales = visibleLegislators.flatMap((l, index) =>
      (l.hitos_personales || []).map(h => ({
        ...h,
        legislatorId: l.cuit,
        legislatorColor: l.color || COLORS[index % COLORS.length]
      }))
    );

    const relevantes = globalMilestones.filter(m => (
      ['global', 'voto', 'politico'].includes(m.tipo || '') ||
      visibleLegislators.some(l => teniaCargo(l, m.tipo, m.fecha))
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
      } else if (legislatorIds.size === 0 && hasGlobal && visibleLegislators.length === 1) {
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
  }, [visibleLegislators, globalMilestones, currencyMode, latestIPC, ipc, mep]);

  // 2a. Calcular segmentos únicos (cuit × deudor × entidad) con total acumulado
  const barSegments = useMemo(() => {
    const map = new Map<string, SegmentInfo>();

    visibleLegislators.forEach(l => {
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
  }, [visibleLegislators, includeFamiliares]);

  // 2b. Asignar colores a cada segmento (tintes del color base del político)
  const segmentColors = useMemo(() => {
    const colorMap = new Map<string, string>();

    visibleLegislators.forEach((l, idx) => {
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
  }, [visibleLegislators, barSegments]);

  // 2c. Procesar Datos de Deuda (Agrupar por mes)
  const chartData = useMemo(() => {
    const grouped: { [key: string]: any } = {};

    const ensureEntry = (fecha: string, cuit: string) => {
      if (!grouped[fecha]) grouped[fecha] = { date: fecha, banks: {} };
      if (!grouped[fecha].banks[cuit]) grouped[fecha].banks[cuit] = { propio: [], familiares: {} };
    };

    visibleLegislators.forEach(l => {
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
  }, [visibleLegislators, currencyMode, ipc, mep, ipcDates, includeFamiliares, latestIPC]);


  const xAxisInterval = useMemo(() => {
    if (!isMobile) return 0;
    const ticks = chartData.length;
    if (ticks <= 20) return 0; // Show all for up to 20 ticks
    return Math.floor(ticks / 15); // Aim for ~15 ticks
  }, [isMobile, chartData.length]);

  const xAxisTickFormatter = (date: string) => {
    const [year, month] = date.split('-');
    const monthNum = parseInt(month);
    const d = new Date(parseInt(year), monthNum - 1);

    // Capitalize first letter and remove period
    const monthStr = d.toLocaleDateString('es-AR', { month: 'short' });
    const formattedMonth = monthStr.charAt(0).toUpperCase() + monthStr.slice(1).replace('.', '');

    if (monthNum === 1) {
      // Enero en dos líneas: nombre y año (para marcar cambio de año)
      return `${formattedMonth}\n${year}`;
    }

    return formattedMonth;
  };

  const [milestoneHint, setMilestoneHint] = useState<{ text: string; x: number } | null>(null);
  const [activeMilestoneKey, setActiveMilestoneKey] = useState<string | null>(null);

  useEffect(() => {
    if (!milestoneHint) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('[data-milestone-hint="true"]')) return;
      if (target.closest('[data-milestone-icon="true"]')) return;
      setMilestoneHint(null);
      setActiveMilestoneKey(null);
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [milestoneHint]);

  const renderXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const label = xAxisTickFormatter(payload.value);
    const lines = String(label).split('\n');

    return (
      <text x={x} y={y + 10} textAnchor="middle" fontSize={10} fill="#4b5563">
        {lines.map((line: string, index: number) => (
          <tspan key={index} x={x} dy={index === 0 ? 0 : 12}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

  const MilestoneLabel = (props: any) => {
    const { x, text, color, milestoneKey, viewBox } = props;
    // Recharts no siempre entrega `x` en labels custom de ReferenceLine; usamos fallback para mantener alineación.
    const resolvedX = [x, viewBox?.x, viewBox?.cx].find((v) => typeof v === 'number');
    if (typeof resolvedX !== 'number') return null;

    // Ubicamos el ícono en la franja superior, fuera del área de barras.
    const topY = 18;
    const iconColor = color || '#0b5cff';
    const isActive = activeMilestoneKey === milestoneKey;

    return (
      <g
        transform={`translate(${resolvedX}, ${topY})`}
        cursor="pointer"
        data-milestone-icon="true"
        onClick={(e: any) => {
          e.stopPropagation();
          if (activeMilestoneKey === milestoneKey) {
            setMilestoneHint(null);
            setActiveMilestoneKey(null);
            return;
          }
          const rect = chartContainerRef.current?.getBoundingClientRect();
          const clickX = rect ? e.clientX - rect.left : resolvedX;
          setMilestoneHint({ text, x: clickX });
          setActiveMilestoneKey(milestoneKey);
        }}
        style={{ userSelect: 'none' }}
      >
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={isActive ? 18 : 17}
          fontWeight={isActive ? 900 : 700}
          fill={iconColor}
          stroke={isActive ? iconColor : 'none'}
          strokeWidth={isActive ? 0.6 : 0}
          data-milestone-icon="true"
        >
          ⚑
        </text>
      </g>
    );
  };

  const MilestoneHintRow = () => {
    if (!milestoneHint) return null;

    const containerWidth = chartContainerRef.current?.clientWidth ?? 0;
    const clampedLeft = containerWidth > 0
      ? Math.max(12, Math.min(milestoneHint.x, containerWidth - 12))
      : milestoneHint.x;
    const hintStyle = getMilestoneChipStyle(activeMilestoneKey ? verticalMilestones.find((m, idx) => `${m.fecha}-${m.texto}-${idx}` === activeMilestoneKey)?.color : undefined);

    return (
      <div
        className={`${isMobile ? 'h-6 w-full overflow-hidden' : 'absolute top-0 z-30 w-max max-w-[calc(100%-1rem)]'}`}
        data-milestone-hint="true"
        onClick={(e) => e.stopPropagation()}
        style={isMobile ? undefined : { left: clampedLeft, transform: 'translateX(-50%)' }}
      >
        <div
          className={`rounded border font-semibold flex items-center gap-1 w-full ${isMobile ? 'px-1.5 py-0.5 text-[11px] leading-none' : 'px-2 py-1 text-xs'}`}
          style={hintStyle}
        >
          <Flag size={isMobile ? 9 : 11} className="shrink-0" />
          <span className={`${isMobile ? 'truncate' : ''}`}>{milestoneHint.text}</span>
          <button
            type="button"
            className={`ml-auto shrink-0 font-bold leading-none ${isMobile ? 'text-[11px]' : ''}`}
            aria-label="Cerrar hito"
            onClick={(e) => {
              e.stopPropagation();
              setMilestoneHint(null);
              setActiveMilestoneKey(null);
            }}
            style={{ color: hintStyle.color }}
          >
            ×
          </button>
        </div>
      </div>
    );
  };


  const yAxisTickFormatter = (value: number) => {
    if (value === 0) return '';

    if (currencyMode === 'usd') {
      if (Math.abs(value) >= 1000000) {
        return `US$${(value / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
      }
      if (Math.abs(value) >= 1000) {
        return `US$${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k`;
      }
      return `US$${value.toLocaleString('es-AR')}`;
    } else { // ARS (nominal o real), value está en miles de pesos.
      if (Math.abs(value) >= 1000000) { // 1,000,000k = 1B
        return `$${(value / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}B`;
      }
      if (Math.abs(value) >= 1000) { // 1,000k = 1M
        return `$${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
      }
      if (value > 0) {
        return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}k`;
      }
      return '';
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

        {visibleLegislators.map((l, idx) => {
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
          const milestones = [
            ...personalMilestones.map(m => ({ ...m, displayColor: l.color || COLORS[idx % COLORS.length] })),
            ...relevantGlobalMilestones.map(m => ({ ...m, displayColor: m.color || (visibleLegislators.length === 1 ? (l.color || COLORS[idx % COLORS.length]) : GRAY) })),
          ];
          const familiarEntries = Object.entries(banks.familiares as { [parentesco: string]: Bank[] });

          return (
            <div key={l.cuit} className="mb-2 border-b pb-1 last:border-0">
              <p className="font-bold text-sm" style={{ color: l.color || COLORS[idx % COLORS.length] }}>
                {l.nombre}: {formatMoney(total)}
              </p>
              {milestones.map((m, i) => (
                <div
                  key={i}
                  className="mb-1 p-1 rounded border font-semibold flex items-center gap-1"
                  style={getMilestoneChipStyle((m as any).displayColor)}
                >
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
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label
                htmlFor="include-familiares"
                className="flex items-center gap-2 text-xs text-gray-700 whitespace-nowrap px-2 py-1 rounded border border-gray-300 bg-gray-50"
                title="Incluir deuda de familiares"
              >
                <input
                  id="include-familiares"
                  type="checkbox"
                  checked={includeFamiliares}
                  onChange={() => onToggleFamiliares?.()}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                Incluir familiares
              </label>
              <select
                value={currencyMode}
                onChange={e => setCurrencyMode(e.target.value as CurrencyMode)}
                className="min-w-0 flex-1 text-xs border border-gray-300 rounded px-2 py-1 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 outline-none sm:flex-none"
              >
                <option value="nominal">Pesos (Nominal)</option>
                {ipc && <option value="real">Pesos (Ajustado por inflación a precios de {ipcDates.length > 0 ? ipcDates[ipcDates.length - 1] : ''})</option>}
                {mep && <option value="usd">Dólares (MEP)</option>}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
          {legislators.map((l, idx) => {
            const cardColor = l.color || COLORS[idx % COLORS.length];
            return (
            <div
              key={l.cuit}
              className="flex items-center gap-2 p-2 rounded shrink-0 w-[75vw] max-w-[360px] md:w-auto"
              style={{ border: `1px solid ${cardColor}`, backgroundColor: withAlpha(cardColor, 0.2) }}
            >
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onRemove && onRemove(l)}
                  title="Quitar"
                  className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X size={15} />
                </button>
                <button
                  onClick={() => onToggleVisibility?.(l.cuit)}
                  title={hiddenIds.has(l.cuit) ? 'Mostrar en gráfico' : 'Ocultar en gráfico'}
                  className={`transition-colors cursor-pointer ${hiddenIds.has(l.cuit) ? 'text-gray-300 hover:text-gray-500' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {hiddenIds.has(l.cuit) ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="min-w-0 max-w-full">
                <div className={`font-bold text-sm flex items-center gap-1 min-w-0 ${hiddenIds.has(l.cuit) ? 'text-gray-400' : ''}`}>
                  <span className="truncate">{l.nombre}</span>
                  {l.familiares && l.familiares.length > 0 && (
                    <span title="Tiene datos de familiares" className="flex">
                      <Users size={13} className="text-blue-400 shrink-0" />
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1 min-w-0">
                  {l.partido && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{l.partido}</span>}
                  {l.distrito && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{l.distrito}</span>}
                  {l.unidad && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{l.unidad}</span>}
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="relative flex-1 min-h-48 md:bg-white md:p-4 md:rounded-lg md:shadow-sm"
        onClick={() => {
          setMilestoneHint(null);
          setActiveMilestoneKey(null);
        }}
      >
        <div className="h-full flex flex-col">
          <div className={`relative px-2 mb-1 shrink-0 ${isMobile ? 'h-6' : 'h-7'}`}>
            <MilestoneHintRow />
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 30, right: 0, left: -30, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={renderXAxisTick}
              height={40}
              interval={xAxisInterval}
              tickFormatter={xAxisTickFormatter}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={yAxisTickFormatter}
              axisLine={false}
              tickLine={false}
              tick={{
                fontSize: 11,
                textAnchor: 'start',
                dx: 10,
                fill: '#111',
                stroke: '#fff',
                strokeWidth: 3,
                paintOrder: 'stroke fill',
              }}
              width={30}
            />
            <Tooltip content={CustomTooltip} />

            {visibleLegislators.flatMap((l, idx) => {
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
                label={<MilestoneLabel text={m.texto} color={m.color} milestoneKey={`${m.fecha}-${m.texto}-${idx}`} />}
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
      </div>
    </div>
  );
});

export default DebtChart;
