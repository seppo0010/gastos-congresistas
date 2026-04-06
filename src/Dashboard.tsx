import { useState, useEffect, useMemo, useRef } from 'react'
import './Dashboard.css'
import DebtChart from './DebtChart';
import LegislatorSelector from './LegislatorSelector';
import type { DashboardData, Legislator } from './types';
import { Share2, HelpCircle, X, Camera } from 'lucide-react';
import { COLORS } from './Colors';
import { type LegislatorWithSlug, mergeDashboardPeople, slugify } from './people';

async function sha1Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

interface DashboardProps {
  dbData: DashboardData;
  politicosData: DashboardData;
  judicialData: DashboardData;
}

export default function Dashboard({ dbData, politicosData, judicialData }: DashboardProps) {
  const { meta } = dbData;

  const [extraLegisladores, setExtraLegisladores] = useState<Legislator[]>([]);
  const addedCuits = useRef(new Set<string>());

  const [initialCuitsFromUrl] = useState<string[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const entries = (params.get('funcionarios') || params.get('legisladores'))?.split(',') || [];
    return entries.filter(e => e.startsWith('cuit-')).map(e => e.slice(5));
  });

  const legisladores = useMemo(() => {
    const base = mergeDashboardPeople(dbData, politicosData, judicialData);
    const baseCuits = new Set(base.map(l => l.cuit));
    const extras = extraLegisladores
      .filter(e => !baseCuits.has(e.cuit))
      .map(e => ({ ...e, slug: slugify(e.nombre) }));
    return [...base, ...extras];
  }, [dbData, politicosData, judicialData, extraLegisladores]);

  const [selected, setSelected] = useState<LegislatorWithSlug[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const entries = (params.get('funcionarios') || params.get('legisladores'))?.split(',') || [];
    const found = entries
      .filter(s => !s.startsWith('cuit-'))
      .map(s => legisladores.find(l => l.slug === s))
      .filter((l): l is LegislatorWithSlug => !!l)
      .slice(0, 4);
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
    const url = new URL(window.location.href);
    if (selected.length > 0) {
      const extraCuits = new Set(extraLegisladores.map(e => e.cuit));
      url.searchParams.set('funcionarios', selected.map(l => extraCuits.has(l.cuit) ? `cuit-${l.cuit}` : l.slug).join(','));
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
  }, [selected, includeFamiliares, extraLegisladores]);

  const handleSelect = (legislator: Legislator) => {
    const lWithSlug = legislator as LegislatorWithSlug;
    let selectionChanged = false;

    if (selected.some(l => l.cuit === lWithSlug.cuit)) {
      const nextSelected = selected.filter(l => l.cuit !== lWithSlug.cuit);
      setSelected(nextSelected);
      if (isMobile && nextSelected.length === 0) {
        setMobileView('list');
      }
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

  const handleAddCuit = async (cuit: string): Promise<void> => {
    if (addedCuits.current.has(cuit)) return;

    const existing = legisladores.find(l => l.cuit === cuit);
    if (existing) {
      handleSelect(existing);
      return;
    }

    addedCuits.current.add(cuit);

    const hash = await sha1Hex(cuit);
    const dir = hash.slice(0, 2);
    const file = hash.slice(2, 4);
    const fetchUrl = `${import.meta.env.VITE_BCRA_BASE_URL}/202601/${dir}/${file}.json.gz`;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      addedCuits.current.delete(cuit);
      throw new Error(`No se encontraron datos para el CUIT ${cuit}`);
    }
    const ds = new DecompressionStream('gzip');
    const decompressed = response.body!.pipeThrough(ds);
    const text = await new Response(decompressed).text();
    const bucket = JSON.parse(text);
    const entry = bucket[cuit];
    if (!entry || entry.status !== 200) {
      addedCuits.current.delete(cuit);
      throw new Error(`No se encontraron datos para el CUIT ${cuit}`);
    }

    const results = entry.results;
    if (!results) throw new Error(`Respuesta inesperada para el CUIT ${cuit}`);

    const nombre: string = results.denominacion || `CUIT ${cuit}`;

    const historial = (results.periodos || []).flatMap((p: { periodo: string; entidades: { entidad: string; situacion: number; monto: number }[] }) => {
      const fecha = `${p.periodo.slice(0, 4)}-${p.periodo.slice(4, 6)}`;
      return p.entidades.map(e => ({ entidad: e.entidad, fecha, situacion: e.situacion, monto: e.monto }));
    });

    const situaciones = historial.map((r: { situacion: number }) => r.situacion).filter((s: number) => s > 0);
    const situacion_bcra = situaciones.length > 0 ? Math.max(...situaciones) : undefined;

    const newLegislator: Legislator = {
      cuit,
      nombre,
      historial,
      hitos_personales: [],
      cargo: '',
      hipoteca_bcra: { tiene: false },
      cambios_nivel: false,
      situacion_bcra,
    };

    setExtraLegisladores(prev => [...prev, newLegislator]);
    setSelected(prev => {
      const usedColors = new Set(prev.map(l => l.color));
      const nextColor = COLORS.find(c => !usedColors.has(c)) || COLORS[prev.length % COLORS.length];
      return [...prev, { ...newLegislator, slug: slugify(nombre), color: nextColor } as LegislatorWithSlug];
    });
    if (isMobile) setMobileView('chart');
  };

  // Restore manually-added CUITs from URL on mount
  useEffect(() => {
    initialCuitsFromUrl.forEach(cuit => handleAddCuit(cuit).catch(console.error));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          onAddCuit={handleAddCuit}
          extraCuits={new Set(extraLegisladores.map(e => e.cuit))}
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
          onToggleVisibility={(cuit) => setHiddenIds(prev => {
            const next = new Set(prev);
            if (next.has(cuit)) {
              next.delete(cuit);
            } else {
              next.add(cuit);
            }
            return next;
          })}
          extraCuits={new Set(extraLegisladores.map(e => e.cuit))}
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
