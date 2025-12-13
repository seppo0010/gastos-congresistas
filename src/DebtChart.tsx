import { useMemo, useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Brush } from 'recharts';

// Importa tu JSON generado por Python
import type { Legislator, Milestone, CurrencyMode } from './types';
import { Flag, HelpCircle, Share2, Download } from 'lucide-react';
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
  onDownload?: () => void;
  onShowHelp?: () => void;
}

interface Bank {
    fecha: string;
    monto: number;
    entidad: string;
}

const teniaCargo = (legislator: Legislator, cargo: string | undefined, fecha: string): boolean => {
  return legislator.periodos.filter(p => p.cargo.toLowerCase() === (cargo || '').toLowerCase() && fecha > p.inicio && fecha < p.fin).length > 0
}

const GRAY = '#9ca3af';

const DebtChart = forwardRef(({ legislators, globalMilestones, ipc, mep, onRemove, isMobile, copied, onShare, onDownload, onShowHelp }: DebtChartProps, ref) => {
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('nominal');
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getChartElement: () => chartContainerRef.current,
  }));

  // 1. Unificar Hitos (Globales + Personales)
  const allMilestones = useMemo(() => {
    const personales = legislators.flatMap((l, index) => 
      (l.hitos_personales || []).map(h => ({
        ...h,
        legislatorId: l.cuit,
        legislatorColor: COLORS[index % COLORS.length]
      }))
    );

    const relevantes = globalMilestones.filter(m => (
      ['global', 'voto', 'politico'].includes(m.tipo || '') || 
      legislators.some(l => teniaCargo(l, m.tipo, m.fecha))
    ));

    const grouped = Object.groupBy([...relevantes, ...personales], (m: any) => m.fecha);

    return Object.values(grouped).map((group: any) => {
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
    })
  }, [legislators, globalMilestones]);

  const ipcDates = useMemo(() => {
    const r = Object.keys(ipc || {});
    r.sort();
    return r;
  }, [ipc]);

  // 2. Procesar Datos de Deuda (Agrupar por mes)
  const chartData = useMemo(() => {
    const grouped: { [key: string]: any } = {};

    let latestIPC = 0;
    if (currencyMode === 'real' && ipc) {
      if (ipcDates.length > 0) latestIPC = ipc[ipcDates[ipcDates.length - 1]];
    }
    
    legislators.forEach(l => {
      l.historial.forEach(r => {
        if (!grouped[r.fecha]) grouped[r.fecha] = { date: r.fecha, banks: {} };
        
        let monto = r.monto;
        if (currencyMode === 'real' && ipc && latestIPC > 0) {
          const val = ipc[r.fecha];
          if (val) {
            monto = (monto * latestIPC) / val;
          }
        } else if (currencyMode === 'usd' && mep) {
          const val = mep[r.fecha];
          if (val && val > 0) {
            monto = (monto * 1000) / val;
          } else {
            monto = 0;
          }
        }

        // Sumar al total del legislador en esa fecha
        if (!grouped[r.fecha][l.cuit]) grouped[r.fecha][l.cuit] = 0;
        grouped[r.fecha][l.cuit] += monto;

        // Guardar detalle de bancos
        if (!grouped[r.fecha].banks[l.cuit]) grouped[r.fecha].banks[l.cuit] = [];
        grouped[r.fecha].banks[l.cuit].push({ ...r, monto });
      });
    });

    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [legislators, currencyMode, ipc, mep, ipcDates]);


  const xAxisInterval = useMemo(() => {
    if (!isMobile) return 0;
    const ticks = chartData.length;
    if (ticks <= 20) return 0; // Show all for up to 20 ticks
    return Math.floor(ticks / 15); // Aim for ~15 ticks
  }, [isMobile, chartData.length]);

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

  if (legislators.length === 0) return <div className="p-10 text-gray-400">Seleccione hasta 4 legisladores</div>;

  const formatMoney = (val: number) => {
    if (currencyMode === 'usd') return `US$ ${new Intl.NumberFormat('es-AR').format(Math.round(val))}`;
    return `$${new Intl.NumberFormat('es-AR').format(Math.round(val * 1000))}`;
  };

  // Tooltip Personalizado con Hitos
  const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: any, label?: string | number }) => {
    if (!active || !payload || !payload.length) return null;
    
    return (
      <div className="bg-white p-3 border shadow-lg rounded text-xs z-50">
        <p className="font-bold mb-1">{label}</p>
        
        {legislators.map((l, idx) => {
          const item = payload.find((p: any) => p.dataKey === l.cuit);
          if (!item) return null;
          const banks = item.payload.banks[l.cuit] || [];
          
          const personalMilestones = (l.hitos_personales || []).filter(h => h.fecha === label);
          const relevantGlobalMilestones = globalMilestones.filter(m => 
            m.fecha === label && (
              ['global', 'voto', 'politico'].includes(m.tipo || '') || 
              teniaCargo(l, m.tipo as any, m.fecha)
            )
          );
          const milestones = [...personalMilestones, ...relevantGlobalMilestones];

          return (
            <div key={l.cuit} className="mb-2 border-b pb-1 last:border-0">
              <p className="font-bold text-sm" style={{ color: COLORS[idx % COLORS.length] }}>
                {l.nombre}: {formatMoney(item.value)}
              </p>
              {milestones.map((m, i) => (
                <div key={i} className="mb-1 p-1 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 font-semibold flex items-center gap-1">
                    <Flag size={10} /> {m.texto}
                </div>
              ))}
              <div className="opacity-70 pl-2">
                {banks.map((b: Bank, i: number) => (
                  <div key={i}>{b.entidad}: {formatMoney(b.monto)}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 p-6 bg-gray-50 flex flex-col h-full">
      <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
          <h2 className="text-xl font-bold">Comparativa</h2>
          {!isMobile && onShowHelp && (
            <button onClick={onShowHelp} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors" title="Ayuda">
              <HelpCircle size={18} />
            </button>
          )}
          <div className="sm:ml-auto flex items-center gap-2">
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
            {onDownload && (
              <button 
                onClick={onDownload}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors hidden md:block"
                title="Descargar Imagen"
              >
                <Download size={18} />
              </button>
            )}
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
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
              <div>
                <div className="font-bold text-sm">{l.nombre}</div>
                <div className="flex gap-1 mt-1">
                  {l.partido && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{l.partido}</span>}
                  {l.distrito && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{l.distrito}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div ref={chartContainerRef} className="flex-1 bg-white p-4 rounded-lg shadow-sm min-h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: isMobile ? 30 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis 
              dataKey="date" 
              tick={{fontSize: 10, angle: isMobile ? -45 : 0}} 
              textAnchor={isMobile ? "end" : "middle"}
              height={isMobile ? 40 : 30}
              interval={xAxisInterval} 
            />
            <YAxis 
              tickFormatter={yAxisTickFormatter}
              tick={{fontSize: 11}} 
              width={65}
            />
            <Tooltip content={CustomTooltip} />

            {/* RENDERIZADO DE TODOS LOS HITOS */}
            {allMilestones.map((m, idx) => (
              <ReferenceLine 
                key={idx} 
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

            {legislators.map((l, idx) => (
              <Bar key={l.cuit} dataKey={l.cuit} fill={COLORS[idx % COLORS.length]} />
            ))}
            <Brush dataKey="date" height={25} stroke={GRAY} tickFormatter={() => ''} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default DebtChart;