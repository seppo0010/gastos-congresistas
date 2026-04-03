import { useState, useEffect, useMemo, useRef } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import type { DashboardData, Legislator } from './types';
import { Share2, HelpCircle, X, Camera } from 'lucide-react';
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

interface DashboardProps {
  dbData: DashboardData;
  politicosData: DashboardData;
  judicialData: DashboardData;
}

export default function Dashboard({ dbData, politicosData, judicialData }: DashboardProps) {
  const { meta, data: rawLegisladores } = dbData;
  const { data: rawPoliticos } = politicosData;
  const { data: rawJudicial } = judicialData;

  const legisladores = useMemo(() => {
    const politicosByCuit = new Map(rawPoliticos.map(p => [p.cuit, p]));
    const merged = rawLegisladores.map(l => {
      const pol = politicosByCuit.get(l.cuit);
      return pol ? { ...l, unidad: pol.unidad, poder: 'legislativo' as const } : { ...l, poder: 'legislativo' as const };
    });
    const legCuits = new Set(rawLegisladores.map(l => l.cuit));
    const execCuits = new Set(rawPoliticos.map(p => p.cuit));
    const combined = [
      ...merged,
      ...rawPoliticos.filter(p => !legCuits.has(p.cuit)).map(p => ({ ...p, poder: 'ejecutivo' as const })),
      ...rawJudicial.filter(j => !legCuits.has(j.cuit) && !execCuits.has(j.cuit)).map(j => ({ ...j, poder: 'judicial' as const })),
    ];

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
  }, [rawLegisladores, rawPoliticos, rawJudicial]);

  const [selected, setSelected] = useState<LegislatorWithSlug[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const slugs = (params.get('funcionarios') || params.get('legisladores'))?.split(',') || [];
    const found = slugs.map(s => legisladores.find(l => l.slug === s)).filter((l): l is LegislatorWithSlug => !!l).slice(0, 4);
    return found.map((l, i) => ({ ...l, color: COLORS[i % COLORS.length] }));
  });

  const [includeFamiliares, setIncludeFamiliares] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('familiares') === 'true';
  });

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [warning, setWarning] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chart'>(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSlugs = !!(params.get('funcionarios') || params.get('legisladores'));
    return hasSlugs && window.innerWidth < 768 ? 'chart' : 'list';
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const debtChartRef = useRef<{ getChartElement: () => HTMLDivElement | null; openExportMenu: () => void }>(null);

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

    if (includeFamiliares) {
      url.searchParams.set('familiares', 'true');
    } else {
      url.searchParams.delete('familiares');
    }

    window.history.replaceState({}, '', url);
  }, [selected, includeFamiliares]);

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
    // Clean up hiddenIds for removed legislator
    if (selected.some(l => l.cuit === lWithSlug.cuit)) {
      setHiddenIds(prev => { const next = new Set(prev); next.delete(lWithSlug.cuit); return next; });
    }
  };

  const handleShare = () => {
    const url = window.location.href;
    const copyFallback = () => {
      try {
        const el = document.createElement('textarea');
        el.value = url;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        alert('Link: ' + url);
      }
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(copyFallback);
    } else {
      copyFallback();
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 font-sans overflow-hidden relative">
      <div className="md:hidden absolute top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setMobileView(v => v === 'list' ? 'chart' : 'list')}
              className="text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              {mobileView === 'list' ? 'Grafico comparativo >' : '< Seleccionar funcionarios'}
            </button>

            {mobileView === 'chart' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowHelp(true)}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Ayuda"
                >
                  <HelpCircle size={18} />
                </button>
                <button
                  onClick={handleShare}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Compartir"
                >
                  <Share2 size={18} />
                </button>
                <button
                  onClick={() => debtChartRef.current?.openExportMenu()}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Exportar imagen"
                >
                  <Camera size={18} />
                </button>
              </div>
            )}
          </div>
        </div>

      <div className={`absolute inset-0 z-20 w-full h-full transition-transform duration-300 ease-in-out md:relative md:z-0 md:w-auto md:translate-x-0 ${mobileView === 'list' ? 'translate-x-0' : '-translate-x-full'} pt-14 md:pt-0`}>
        <LegislatorSelector 
          legisladores={legisladores} 
          onSelect={handleSelect} 
          selectedIds={selected.map(l => l.cuit)} 
          selectedColors={selected.reduce((acc, l) => ({ ...acc, [l.cuit]: l.color! }), {} as Record<string, string>)}
        />
      </div>

      <div className={`absolute inset-0 z-10 w-full h-full transition-transform duration-300 ease-in-out md:relative md:z-0 md:flex-1 md:translate-x-0 ${mobileView === 'chart' ? 'translate-x-0' : 'translate-x-full'} pt-14 md:pt-0`}>
        <DebtChart
          ref={debtChartRef}
          legislators={selected}
          globalMilestones={meta.hitos_globales} 
          ipc={meta.ipc}
          mep={meta.mep}
          onRemove={handleSelect}
          isMobile={isMobile}
          copied={copied}
          onShare={handleShare}
          onShowHelp={() => setShowHelp(true)}
          includeFamiliares={includeFamiliares}
          onToggleFamiliares={() => setIncludeFamiliares(v => !v)}
          hiddenIds={hiddenIds}
          onToggleVisibility={(cuit) => setHiddenIds(prev => { const next = new Set(prev); next.has(cuit) ? next.delete(cuit) : next.add(cuit); return next; })}
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
            <button onClick={() => setShowHelp(false)} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 cursor-pointer" title="Cerrar">
              <X size={20} />
            </button>
            <h3 className="font-bold text-lg mb-2">Información</h3>
            <p className="mb-4 text-sm text-gray-600">
              Se muestra el total de deuda que cada funcionario/legislador tiene cada mes según lo reportado por el BCRA en la "Central de Deudores", usualmente eso representa los gastos de tarjeta, pero no hay forma de saber si se pagó el total o si tiene un crédito.<br />
              Los datos de bloque y distrito de los legisladores vienen de <a target='_blank' rel='nofollow' href='https://argentinadatos.com/' className="text-blue-600 hover:underline">argentinadatos.com</a>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
