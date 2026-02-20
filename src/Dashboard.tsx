import { useState, useEffect, useMemo } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import dbCargada from './legisladores_full.json';
import politicosDb from './politicos_full.json';
import type { DashboardData, Legislator } from './types';
import { List, BarChart3, Share2, HelpCircle, X } from 'lucide-react';
import { COLORS } from './Colors';

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
  const { data: rawPoliticos } = politicosDb as DashboardData;

  const legisladores = useMemo(() => {
    const politicosByCuit = new Map(rawPoliticos.map(p => [p.cuit, p]));
    const merged = rawLegisladores.map(l => {
      const pol = politicosByCuit.get(l.cuit);
      return pol ? { ...l, unidad: pol.unidad } : l;
    });
    const legCuits = new Set(rawLegisladores.map(l => l.cuit));
    const combined = [...merged, ...rawPoliticos.filter(p => !legCuits.has(p.cuit))];

    const seen = new Map<string, number>();
    return combined.map(l => {
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
    const slugs = (params.get('funcionarios') || params.get('legisladores'))?.split(',') || [];
    const found = slugs.map(s => legisladores.find(l => l.slug === s)).filter((l): l is LegislatorWithSlug => !!l).slice(0, 4);
    return found.map((l, i) => ({ ...l, color: COLORS[i % COLORS.length] }));
  });

  const [warning, setWarning] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chart'>('list');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      url.searchParams.set('funcionarios', selected.map(l => l.slug).join(','));
      url.searchParams.delete('legisladores');
    } else {
      url.searchParams.delete('funcionarios');
      url.searchParams.delete('legisladores');
    }
    window.history.replaceState({}, '', url);
  }, [selected]);

  const handleSelect = (legislator: Legislator) => {
    const lWithSlug = legislator as LegislatorWithSlug;
    let selectionChanged = false;

    if (selected.some(l => l.cuit === lWithSlug.cuit)) {
      setSelected(prev => prev.filter(l => l.cuit !== lWithSlug.cuit));
      selectionChanged = true;
    } else if (selected.length >= 4) {
      setWarning("Solo se pueden comparar hasta 4 personas");
    } else {
      const usedColors = new Set(selected.map(l => l.color));
      const nextColor = COLORS.find(c => !usedColors.has(c)) || COLORS[selected.length % COLORS.length];
      setSelected(prev => [...prev, { ...lWithSlug, color: nextColor }]);
      selectionChanged = true;
    }

    if (isMobile && selectionChanged) {
      setMobileView('chart');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Gastos Congresistas',
          url: window.location.href,
        });
      } catch (err) {
        console.error(err);
      }
    } else {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 font-sans overflow-hidden relative">
      <div className="md:hidden fixed top-4 right-4 z-50 flex flex-col gap-2 items-end">
        <button
          onClick={() => {
            setMobileView(v => v === 'list' ? 'chart' : 'list');
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-xl flex items-center justify-center transition-colors"
        >
          {mobileView === 'list' ? <BarChart3 size={24} /> : <List size={24} />}
        </button>
        {mobileView === 'chart' && (
          <div className="flex flex-col gap-2 items-end">
            <button 
              onClick={() => setShowHelp(true)}
              className="bg-white p-3 rounded-full shadow-lg text-gray-600"
              title="Ayuda"
            >
              <HelpCircle size={20} />
            </button>
            <button 
              onClick={handleShare}
              className="bg-white p-3 rounded-full shadow-lg text-gray-600"
              title="Compartir"
            >
              <Share2 size={20} />
            </button>
          </div>
        )}
      </div>

      <div className={`absolute inset-0 z-20 w-full h-full transition-transform duration-300 ease-in-out md:relative md:z-0 md:w-auto md:translate-x-0 ${mobileView === 'list' ? 'translate-x-0' : '-translate-x-full'}`}>
        <LegislatorSelector 
          legisladores={legisladores} 
          onSelect={handleSelect} 
          selectedIds={selected.map(l => l.cuit)} 
          selectedColors={selected.reduce((acc, l) => ({ ...acc, [l.cuit]: l.color! }), {} as Record<string, string>)}
        />
      </div>

      <div className={`absolute inset-0 z-10 w-full h-full transition-transform duration-300 ease-in-out md:relative md:z-0 md:flex-1 md:translate-x-0 ${mobileView === 'chart' ? 'translate-x-0' : 'translate-x-full'}`}>
        <DebtChart
          legislators={selected} 
          globalMilestones={meta.hitos_globales} 
          ipc={meta.ipc}
          mep={meta.mep}
          onRemove={handleSelect}
          isMobile={isMobile}
          copied={copied}
          onShare={handleShare}
          onShowHelp={() => setShowHelp(true)}
        />
      </div>

      {warning && (
        <div className="absolute top-5 right-5 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg z-50">
            {warning}
        </div>
      )}

      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowHelp(false)} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 cursor-pointer">
              <X size={20} />
            </button>
            <h3 className="font-bold text-lg mb-2">Información</h3>
            <p className="mb-4 text-sm text-gray-600">
              Se muestra el total de deuda que cada funcionario/legislador tiene cada mes según lo reportado por el BCRA en la "Central de Deudores", usualmente eso representa los gastos de tarjeta, pero no hay forma de saber si se pagó el total o si tiene un crédito.<br />
              Los datos de bloque y distrito de los legisladores vienen de <a target='_blank' rel='nofollow' href='https://argentinadatos.com/' className="text-blue-600 hover:underline">argentinadatos.com</a>.
            </p>
            <p className="text-xs text-yellow-800 bg-yellow-50 p-2 rounded border border-yellow-200">
              Atención: Parte de la información fue procesada automáticamente y podría contener errores.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}