import { useState, useEffect, useMemo } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import dbCargada from './legisladores_full.json';
import type { DashboardData, Legislator } from './types';
import { List, BarChart3 } from 'lucide-react';

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
  const [mobileView, setMobileView] = useState<'list' | 'chart'>('list');
  const [isFabVisible, setIsFabVisible] = useState(true);

  useEffect(() => {
    if (warning) {
      const timer = setTimeout(() => setWarning(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [warning]);

  useEffect(() => {
    if (selected.length === 0) {
      setMobileView('list');
    }
  }, [selected]);

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
    const isMobile = window.innerWidth < 768;
    let selectionChanged = false;

    if (selected.some(l => l.cuit === lWithSlug.cuit)) {
      setSelected(prev => prev.filter(l => l.cuit !== lWithSlug.cuit));
      selectionChanged = true;
    } else if (selected.length >= 4) {
      setWarning("Solo se pueden comparar hasta 4 legisladores");
    } else {
      setSelected(prev => [...prev, lWithSlug]);
      selectionChanged = true;
    }

    if (isMobile && selectionChanged) {
      setMobileView('chart');
      setIsFabVisible(true);
    }
  };

  const handleListScroll = (direction: 'up' | 'down') => {
    setIsFabVisible(direction === 'up');
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 font-sans overflow-hidden relative">
      <div className={`md:hidden fixed bottom-6 right-6 z-50 transition-transform duration-300 ${isFabVisible ? 'translate-y-0' : 'translate-y-24'}`}>
        <button
          onClick={() => {
            setMobileView(v => v === 'list' ? 'chart' : 'list');
            setIsFabVisible(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-xl flex items-center justify-center transition-colors"
        >
          {mobileView === 'list' ? <BarChart3 size={24} /> : <List size={24} />}
        </button>
      </div>

      <div className={`absolute inset-0 z-20 w-full h-full transition-transform duration-300 ease-in-out md:relative md:z-0 md:w-auto md:translate-x-0 ${mobileView === 'list' ? 'translate-x-0' : '-translate-x-full'}`}>
        <LegislatorSelector 
          legisladores={legisladores} 
          onSelect={handleSelect} 
          selectedIds={selected.map(l => l.cuit)} 
          onScroll={handleListScroll}
        />
      </div>

      <div className={`absolute inset-0 z-10 w-full h-full transition-transform duration-300 ease-in-out md:relative md:z-0 md:flex-1 md:translate-x-0 ${mobileView === 'chart' ? 'translate-x-0' : 'translate-x-full'}`}>
        <DebtChart 
          legislators={selected} 
          globalMilestones={meta.hitos_globales} 
          ipc={meta.ipc}
          mep={meta.mep}
          onRemove={handleSelect}
        />
      </div>

      {warning && (
        <div className="absolute top-5 right-5 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg z-50">
            {warning}
        </div>
      )}
    </div>
  );
}