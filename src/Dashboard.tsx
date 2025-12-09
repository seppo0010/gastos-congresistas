import { useState } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import dbCargada from './legisladores_full.json';
import type { DashboardData } from './types';

export default function Dashboard() {
  const { meta, data: legisladores } = dbCargada as DashboardData; 
  const [selected, setSelected] = useState(legisladores[0]);

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      <LegislatorSelector 
        legisladores={legisladores} 
        onSelect={setSelected} 
        selectedId={selected?.cuit} 
      />
      <DebtChart 
        legislator={selected} 
        globalMilestones={meta.hitos_globales} 
      />
    </div>
  );
}