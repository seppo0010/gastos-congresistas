import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// Importa tu JSON generado por Python
import type { Legislator, Milestone } from './types';
import { Flag } from 'lucide-react';

interface DebtChartProps {
  legislator: Legislator;
  globalMilestones: Milestone[];
}

interface Bank {
    fecha: string;
    monto: number;
    entidad: string;
}

interface Group {
    date: string;
    total: number;
    banks: Bank[];
}

const DebtChart = ({ legislator, globalMilestones }: DebtChartProps) => {
  if (!legislator) return <div className="p-10 text-gray-400">Seleccione un legislador</div>;

  // 1. Unificar Hitos (Globales + Personales)
  const allMilestones = useMemo(() => {
    const personales = legislator.hitos_personales || [];
    return [...globalMilestones, ...personales];
  }, [legislator, globalMilestones]);

  // 2. Procesar Datos de Deuda (Agrupar por mes)
  const chartData = useMemo(() => {
    const grouped: { [key: string]: Group } = {};
    legislator.historial.forEach(r => {
      if (!grouped[r.fecha]) grouped[r.fecha] = { date: r.fecha, total: 0, banks: [] };
      grouped[r.fecha].total += r.monto;
      grouped[r.fecha].banks.push(r);
    });
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [legislator]);

  const formatMoney = (val: number) => `$${new Intl.NumberFormat('es-AR').format(val)}`;

  // Tooltip Personalizado con Hitos
  const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: any, label?: string | number }) => {
    if (!active || !payload || !payload.length) return null;
    
    // Buscar si hay un hito en este mes exacto
    const hitoDelMes = allMilestones.find(m => m.fecha === label);

    return (
      <div className="bg-white p-3 border shadow-lg rounded text-xs z-50">
        <p className="font-bold mb-1">{label}</p>
        
        {hitoDelMes && (
            <div className="mb-2 p-1 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 font-semibold flex items-center gap-1">
                <Flag size={10} /> {hitoDelMes.texto}
            </div>
        )}

        <p className="text-blue-600 font-bold text-sm mb-1">
          Total: {formatMoney(payload[0].value)}k
        </p>
        <div className="opacity-70">
           {payload[0].payload.banks.map((b: Bank, i: number) => (
             <div key={i}>{b.entidad.slice(0,15)}... : {formatMoney(b.monto)}k</div>
           ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 p-6 bg-gray-50 flex flex-col h-full">
      <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
        <h2 className="text-xl font-bold">{legislator.nombre}</h2>
        <div className="flex gap-2 mt-2">
            {/* Badges de hitos personales para referencia rápida */}
            {legislator.hitos_personales?.map((h, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded text-white" style={{backgroundColor: h.color}}>
                    {h.fecha}: {h.texto}
                </span>
            ))}
        </div>
      </div>

      <div className="flex-1 bg-white p-4 rounded-lg shadow-sm min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorDeuda" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{fontSize: 10}} />
            <YAxis tickFormatter={(v: number) => `$${v/1000}M`} tick={{fontSize: 10}} width={40}/>
            <Tooltip content={CustomTooltip} />
            
            <Area type="monotone" dataKey="total" stroke="#2563eb" fill="url(#colorDeuda)" strokeWidth={2} />

            {/* RENDERIZADO DE TODOS LOS HITOS */}
            {allMilestones.map((m, idx) => (
              <ReferenceLine 
                key={idx} 
                x={m.fecha} 
                stroke={m.color} 
                strokeDasharray="4 2"
                label={{ 
                    value: m.texto, 
                    position: 'insideTopLeft', 
                    fill: m.color, 
                    fontSize: 10, 
                    fontWeight: 'bold',
                    angle: -90, // Texto vertical para que no se pisen
                    dx: 10,
                    dy: 50
                }} 
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DebtChart;