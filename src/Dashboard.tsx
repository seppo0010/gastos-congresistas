import { useState, useEffect, useMemo } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import dbCargada from './legisladores_full.json';
import type { DashboardData, Legislator } from './types';

const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-");
};

type LegislatorWithSlug = Legislator & { slug: string };

export default function Dashboard() {
  const { meta, data: rawLegisladores } = dbCargada as DashboardData; 

  const legisladores = useMemo(() => {
    const seen = new Map<string, number>();
    return rawLegisladores.map(l => {
      let slug = slugify(l.nombre);
      if (seen.has(slug)) {
        const count = seen.get(slug)! + 1;
        seen.set(slug, count);
        slug = `${slug}-${count}`;
      } else {
        seen.set(slug, 1);
      }
      return { ...l, slug } as LegislatorWithSlug;
    });
  }, [rawLegisladores]);

  const [selected, setSelected] = useState<LegislatorWithSlug[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const slugs = params.get('legisladores')?.split(',') || [];
    return slugs.map(s => legisladores.find(l => l.slug === s)).filter((l): l is LegislatorWithSlug => !!l).slice(0, 4);
  });

  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (warning) {
      const timer = setTimeout(() => setWarning(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [warning]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected.length > 0) {
      url.searchParams.set('legisladores', selected.map(l => l.slug).join(','));
    } else {
      url.searchParams.delete('legisladores');
    }
    window.history.replaceState({}, '', url);
  }, [selected]);

  const handleSelect = (legislator: Legislator) => {
    const lWithSlug = legislator as LegislatorWithSlug;
    if (selected.some(l => l.cuit === lWithSlug.cuit)) {
      setSelected(prev => prev.filter(l => l.cuit !== lWithSlug.cuit));
    } else if (selected.length >= 4) {
      setWarning("Solo se pueden comparar hasta 4 legisladores");
    } else {
      setSelected(prev => [...prev, lWithSlug]);
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
        ipc={meta.ipc}
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