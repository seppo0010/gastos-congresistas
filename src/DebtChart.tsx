import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// Importa tu JSON generado por Python
import type { Legislator, Milestone, CurrencyMode } from './types';
import { Flag, HelpCircle } from 'lucide-react';
import { COLORS } from './Colors';

interface DebtChartProps {
  legislators: Legislator[];
  globalMilestones: Milestone[];
  ipc?: { [date: string]: number };
  mep?: { [date: string]: number };
  onRemove?: (legislator: Legislator) => void;
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

const DebtChart = ({ legislators, globalMilestones, ipc, mep, onRemove }: DebtChartProps) => {
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('nominal');

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
          <div className="relative group outline-none" tabIndex={0}>
            <HelpCircle size={18} className="text-gray-400 cursor-help" />
            <div className="absolute left-0 top-full mt-2 w-80 p-3 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none z-50">
              <p className="mb-2">
                Se muestra el total de deuda que cada legislador tiene cada mes según lo reportado por el BCRA en la "Central de Deudores", usualmente eso representa los gastos de tarjeta, pero no hay forma de saber si se pagó el total o si tiene un crédito.<br />
                Los datos de bloque y distrito vienen de <a target='_blank' rel='nofollow' href='https://argentinadatos.com/'></a>
              </p>
              <p className="text-yellow-300">
                Atención: Parte de la información fue procesada automáticamente y podría contener errores.
              </p>
            </div>
          </div>
          <div className="sm:ml-auto">
            <select 
              value={currencyMode} 
              onChange={e => setCurrencyMode(e.target.value as CurrencyMode)}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="nominal">Pesos (Nominal)</option>
              {ipc && <option value="real">Pesos (Ajustado por inflación a precios de {ipcDates[ipcDates.length - 1]})</option>}
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

      <div className="flex-1 bg-white p-4 rounded-lg shadow-sm min-h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{fontSize: 10}} />
            <YAxis 
              tickFormatter={(v: number) => currencyMode === 'usd' ? `US$${v/1000}k ` : `$${v/1000}M`} 
              tick={{fontSize: 10}} 
              width={currencyMode === 'usd' ? 50 : 40}
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
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DebtChart;