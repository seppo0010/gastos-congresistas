import { useState, useEffect } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import dbCargada from './legisladores_full.json';
import type { DashboardData, Legislator } from './types';

export default function Dashboard() {
  const { meta, data: legisladores } = dbCargada as DashboardData; 
  const [selected, setSelected] = useState<Legislator[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (warning) {
      const timer = setTimeout(() => setWarning(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [warning]);

  const handleSelect = (legislator: Legislator) => {
    if (selected.some(l => l.cuit === legislator.cuit)) {
      setSelected(prev => prev.filter(l => l.cuit !== legislator.cuit));
    } else if (selected.length >= 4) {
      setWarning("Solo se pueden comparar hasta 4 legisladores");
    } else {
      setSelected(prev => [...prev, legislator]);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden relative">
      <LegislatorSelector 
        legisladores={legisladores} 
        onSelect={handleSelect} 
        selectedIds={selected.map(l => l.cuit)} 
      />
      <DebtChart 
        legislators={selected} 
        globalMilestones={meta.hitos_globales} 
        onRemove={handleSelect}
      />
      {warning && (
        <div className="absolute top-5 right-5 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg z-50">
            {warning}
        </div>
      )}
    </div>
  );
}