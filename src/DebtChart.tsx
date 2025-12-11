import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

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

const teniaCargo = (legislator: Legislator, cargo: 'Diputado' | 'Senador', fecha: string): boolean => {
  return legislator.periodos.filter(p => p.cargo.toLowerCase() === cargo.toLowerCase() && fecha > p.inicio && fecha < p.fin).length > 0
}

const DebtChart = ({ legislator, globalMilestones }: DebtChartProps) => {
  if (!legislator) return <div className="p-10 text-gray-400">Seleccione un legislador</div>;

  // 1. Unificar Hitos (Globales + Personales)
  const allMilestones = useMemo(() => {
    const personales = legislator.hitos_personales || [];
    return Object.values(Object.groupBy([...globalMilestones.filter(m => (
        ['global', 'voto', 'politico'].includes(m.tipo || '') || teniaCargo(legislator, m.tipo, m.fecha)
      )), ...personales], (m: Milestone) => m.fecha)).map((x) => ({
      fecha: x[0].fecha,
      texto: x.map((y) => y.texto).join(', '),
      color: x[0].color,
      tipo: x[0].tipo,
    }))
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
          {[legislator.cargo, legislator.distrito, legislator.partido].map((s) => (s || '') !== '' && (
          <span key={s} className="text-xs px-2 py-1 rounded text-white" style={{backgroundColor: '#2563eb'}}>
              {s}
          </span>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-white p-4 rounded-lg shadow-sm min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{fontSize: 10}} />
            <YAxis tickFormatter={(v: number) => `$${v/1000}M`} tick={{fontSize: 10}} width={40}/>
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

            <Bar dataKey="total" fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DebtChart;