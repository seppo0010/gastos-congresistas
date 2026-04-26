import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

function parseCuit(cuit: string): { dni: string; genero: 'M' | 'F' } | null {
  const digits = cuit.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  const prefix = digits.slice(0, 2);
  const dniRaw = digits.slice(2, 10);
  const dni = String(parseInt(dniRaw, 10)); // strip leading zeros
  if (prefix === '20') return { dni, genero: 'M' };
  if (prefix === '27') return { dni, genero: 'F' };
  if (prefix === '23' || prefix === '24') {
    // Infer gender by checking which one produces this exact CUIT
    return { dni, genero: calcularCuit(dniRaw, 'M') === digits ? 'M' : 'F' };
  }
  return null;
}

function calcularCuit(dni: string, genero: 'M' | 'F'): string {
  const dniPadded = dni.padStart(8, '0');
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

  const checkDigit = (prefix: string): number => {
    const digits = (prefix + dniPadded).split('').map(Number);
    const sum = digits.reduce((acc, d, i) => acc + d * multipliers[i], 0);
    const rem = sum % 11;
    return rem === 0 ? 0 : rem === 1 ? -1 : 11 - rem;
  };

  const prefixes = genero === 'M' ? ['20', '23', '24'] : ['27', '23', '24'];
  for (const prefix of prefixes) {
    const cd = checkDigit(prefix);
    if (cd !== -1) return `${prefix}-${dniPadded}-${cd}`;
  }
  // Extremely unlikely fallback
  return `${prefixes[0]}-${dniPadded}-0`;
}
import { Home, AlertCircle, X, Users, ShieldAlert, ArrowDownAZ, ArrowUpAZ, TrendingUp, BarChart2 } from 'lucide-react';

import type { Legislator } from './types';
import { COLORS } from './Colors';
import { usePostHog } from '@posthog/react';

const SITUACION_BCRA: Record<number, { label: string; color: string }> = {
  0:  { label: 'Sin datos',          color: '#9ca3af' },
  1:  { label: 'Normal',             color: '#16a34a' },
  2:  { label: 'Riesgo bajo',        color: '#ca8a04' },
  3:  { label: 'Riesgo medio',       color: '#ea580c' },
  4:  { label: 'Riesgo alto',        color: '#dc2626' },
  5:  { label: 'Irrecuperable',      color: '#7f1d1d' },
  11: { label: 'Con garantías "A"',  color: '#0284c7' },
}

const getDebtStats = (l: Legislator) => {
  const monthly: { [key: string]: number } = {};
  let total = 0;
  const months = new Set<string>();

  for (const h of (l.historial || [])) {
    monthly[h.fecha] = (monthly[h.fecha] || 0) + h.monto;
    total += h.monto;
    months.add(h.fecha);
  }

  return {
    max: Math.max(0, ...Object.values(monthly)),
    avg: months.size > 0 ? total / months.size : 0
  };
};

function CuitModal({ onClose, onAddCuit }: { onClose: () => void; onAddCuit: (cuit: string) => Promise<void> }) {
  const [cuitInput, setCuitInput] = useState("");
  const [dniInput, setDniInput] = useState("");
  const [genero, setGenero] = useState<'M' | 'F'>('M');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const cuit = cuitInput.replace(/\D/g, '');
    if (cuit.length < 10) return;
    setLoading(true);
    setError(null);
    try {
      await onAddCuit(cuit);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al buscar el CUIT');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 cursor-pointer"
          title="Cerrar"
        >
          <X size={20} />
        </button>
        <h3 className="font-bold text-lg mb-2">Agregar CUIT</h3>
        <p className="text-sm text-gray-600 mb-4">
          La información proviene de la Central de Deudores del BCRA.
        </p>

        <div className="space-y-3">
          <div className="border rounded-lg p-3">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Opción 1 — DNI y género</label>
            <div className="flex gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Género</label>
                <div className="flex rounded border overflow-hidden text-sm">
                  {(['M', 'F'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => {
                        setGenero(g);
                        const digits = dniInput.replace(/\D/g, '');
                        if (digits.length >= 7) setCuitInput(calcularCuit(digits, g));
                      }}
                      className={`px-3 py-2 ${genero === g ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      {g === 'M' ? 'Masc.' : 'Fem.'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">DNI</label>
                <input
                  autoFocus
                  className="w-full p-2 border rounded text-sm"
                  placeholder="99.999.999"
                  value={dniInput}
                  onChange={e => {
                    const raw = e.target.value;
                    setDniInput(raw);
                    const digits = raw.replace(/\D/g, '');
                    if (digits.length >= 7) setCuitInput(calcularCuit(digits, genero));
                    else setCuitInput('');
                    setError(null);
                  }}
                  maxLength={10}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400 font-semibold">
            <div className="flex-1 border-t border-gray-200" />
            O
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <div className="border rounded-lg p-3">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Opción 2 — CUIL / CUIT</label>
            <div className="flex gap-2">
              <input
                className="flex-1 p-2 border rounded text-sm font-mono"
                placeholder="99-9999999-9"
                value={cuitInput}
                onChange={e => {
                  const raw = e.target.value;
                  setCuitInput(raw);
                  setError(null);
                  const parsed = parseCuit(raw);
                  if (parsed) { setDniInput(parsed.dni); setGenero(parsed.genero); }
                }}
                maxLength={13}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || cuitInput.replace(/\D/g, '').length < 10}
          className="mt-4 w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '...' : 'Buscar'}
        </button>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </div>
    </div>,
    document.body
  );
}

interface LegislatorSelectorProps {
  legisladores: Legislator[];
  onSelect: (l: Legislator) => void;
  selectedIds?: string[];
  selectedColors?: Record<string, string>;
  onAddCuit?: (cuit: string) => Promise<void>;
  extraCuits?: Set<string>;
}

export default function LegislatorSelector({
  legisladores,
  onSelect,
  selectedIds = [],
  selectedColors = {},
  onAddCuit,
  extraCuits = new Set(),
}: LegislatorSelectorProps) {
  const posthog = usePostHog();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCuitModal, setShowCuitModal] = useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState("todos");
  const [provinceFilter, setProvinceFilter] = useState("todas");
  const [partyFilter, setPartyFilter] = useState("todos");
  const [unitFilter, setUnitFilter] = useState("todas");
  const [cargoApnFilter, setCargoApnFilter] = useState("todos");
  const [cargoJudicialFilter, setCargoJudicialFilter] = useState("todos");
  const [camaraFilter, setCamaraFilter] = useState("todas");
  const [creditFilter, setCreditFilter] = useState("todos");
  const [levelChangeFilter, setLevelChangeFilter] = useState("todos");
  const [familiaresFilter, setFamiliaresFilter] = useState("todos");
  const [situacionFilter, setSituacionFilter] = useState("todos");
  const [sortOrder, setSortOrder] = useState("nombre_asc");

  const provinces = useMemo(() => [...new Set(legisladores.filter(l => l.distrito !== undefined).map(l => l.distrito).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);
  const parties = useMemo(() => [...new Set(legisladores.filter(l => l.partido !== undefined).map(l => l.partido).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);
  const units = useMemo(() => [...new Set(legisladores.filter(l => l.unidad !== undefined).map(l => l.unidad).filter(u => (u || '').trim() !== ''))].sort(), [legisladores]);
  const cargosApn = useMemo(() => [...new Set(legisladores.filter(l => l.poder === 'ejecutivo' && l.cargo).map(l => l.cargo).filter(c => (c || '').trim() !== ''))].sort(), [legisladores]);
  const cargosJudicial = useMemo(() => [...new Set(legisladores.filter(l => l.poder === 'judicial' && l.cargo).map(l => l.cargo).filter(c => (c || '').trim() !== ''))].sort(), [legisladores]);
  const camaras = useMemo(() => [...new Set(legisladores.filter(l => l.poder === 'judicial' && l.camara).map(l => l.camara).filter(c => (c || '').trim() !== ''))].sort(), [legisladores]);

  const garantiaFecha = useMemo(() => {
    const l = legisladores.find(l => l.hipoteca_bcra.tiene && l.hipoteca_bcra.fecha);
    return l?.hipoteca_bcra.fecha ?? null;
  }, [legisladores]);

  const debtStats = useMemo(() => {
    const stats = new Map<string, { max: number; avg: number }>();
    legisladores.forEach(l => {
      stats.set(l.cuit, getDebtStats(l));
    });
    return stats;
  }, [legisladores]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);


  const filteredAndSorted = useMemo(() => {
    return legisladores
      .filter(l => {
        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const searchMatch = debouncedSearchTerm === "" || normalize(l.nombre).includes(normalize(debouncedSearchTerm));


        const isLegislador = l.poder === 'legislativo';
        const isJudicial = l.poder === 'judicial';
        const positionMatch = positionFilter === 'todos' ||
          (positionFilter === 'legisladores' && isLegislador) ||
          (positionFilter === 'apn' && !isLegislador && !isJudicial) ||
          (positionFilter === 'judicial' && isJudicial);
        const provinceMatch = provinceFilter === 'todas' || l.distrito === provinceFilter;
        const partyMatch = partyFilter === 'todos' || l.partido === partyFilter;
        const unitMatch = unitFilter === 'todas' || l.unidad === unitFilter;
        const cargoApnMatch = cargoApnFilter === 'todos' || l.cargo === cargoApnFilter;
        const cargoJudicialMatch = cargoJudicialFilter === 'todos' || l.cargo === cargoJudicialFilter;
        const camaraMatch = camaraFilter === 'todas' || l.camara === camaraFilter;

        const creditMatch = creditFilter === 'todos' || (creditFilter === 'si' ? l.hipoteca_bcra.tiene : !l.hipoteca_bcra.tiene);
        const levelChangeMatch = levelChangeFilter === 'todos' || (levelChangeFilter === 'si' ? l.cambios_nivel : !l.cambios_nivel);
        const hasFamiliares = l.familiares && l.familiares.length > 0;
        const familiaresMatch = familiaresFilter === 'todos' || (familiaresFilter === 'si' ? hasFamiliares : !hasFamiliares);
        const situacionMatch = situacionFilter === 'todos' || String(l.situacion_bcra ?? 1) === situacionFilter;

        return selectedIds.includes(l.cuit) || (searchMatch && positionMatch && provinceMatch && partyMatch && unitMatch && cargoApnMatch && cargoJudicialMatch && camaraMatch && creditMatch && levelChangeMatch && familiaresMatch && situacionMatch);
      })
      .sort((a, b) => {
        const aSelected = selectedIds.includes(a.cuit);
        const bSelected = selectedIds.includes(b.cuit);
        if (aSelected !== bSelected) return aSelected ? -1 : 1;

        if (sortOrder === 'nombre_desc') return b.nombre.localeCompare(a.nombre);
        if (sortOrder === 'nombre_asc') return a.nombre.localeCompare(b.nombre);

        const statsA = debtStats.get(a.cuit)!;
        const statsB = debtStats.get(b.cuit)!;

        if (sortOrder === 'max_deuda_desc') return statsB.max - statsA.max;
        if (sortOrder === 'promedio_deuda_desc') return statsB.avg - statsA.avg;

        return 0;
      });
  }, [legisladores, debouncedSearchTerm, positionFilter, provinceFilter, partyFilter, unitFilter, cargoApnFilter, cargoJudicialFilter, camaraFilter, creditFilter, levelChangeFilter, familiaresFilter, situacionFilter, selectedIds, sortOrder, debtStats]);

  return (
    <div className="w-full md:w-80 h-full flex flex-col border-r border-gray-200 bg-white">
      <div className="p-4 border-b">
        <h2 className="font-bold text-gray-800">Funcionarios ({filteredAndSorted.length})</h2>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug hidden md:block">Deuda en el BCRA · hacé click para ver el historial</p>
        <input
          className="w-full mt-2 p-2 border rounded text-sm"
          placeholder="Buscar..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        {onAddCuit && (
          <button
            onClick={() => setShowCuitModal(true)}
            className="mt-2 text-xs text-blue-600 hover:underline"
          >
            + Agregar CUIT
          </button>
        )}
        <div className="mt-4 space-y-2 text-sm">
          <div>
            <span className="block text-gray-600 text-xs font-semibold mb-1">Orden</span>
            <div className="flex gap-1">
              {[
                { value: 'nombre_asc', icon: <ArrowDownAZ size={14} />, label: 'A-Z' },
                { value: 'nombre_desc', icon: <ArrowUpAZ size={14} />, label: 'Z-A' },
                { value: 'max_deuda_desc', icon: <TrendingUp size={14} />, label: 'Máx' },
                { value: 'promedio_deuda_desc', icon: <BarChart2 size={14} />, label: 'Prom' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { posthog?.capture('sort_order_changed', { sort_order: opt.value }); setSortOrder(opt.value); }}
                  title={{ nombre_asc: 'Nombre A-Z', nombre_desc: 'Nombre Z-A', max_deuda_desc: 'Mayor Deuda Histórica', promedio_deuda_desc: 'Promedio Deuda Histórica' }[opt.value]}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 px-1 rounded border text-xs ${sortOrder === opt.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="position" className="block text-gray-600 text-xs font-semibold mb-1">Poder</label>
            <select id="position" value={positionFilter} onChange={e => {
                const nextValue = e.target.value;
                posthog?.capture('filter_applied', { filter: 'poder', value: nextValue });
                setPositionFilter(nextValue);
                if (nextValue === 'apn') {
                  setProvinceFilter('todas');
                  setPartyFilter('todos');
                  setCargoJudicialFilter('todos');
                } else if (nextValue === 'legisladores') {
                  setUnitFilter('todas');
                  setCargoApnFilter('todos');
                  setCargoJudicialFilter('todos');
                } else if (nextValue === 'judicial') {
                  setProvinceFilter('todas');
                  setPartyFilter('todos');
                  setUnitFilter('todas');
                  setCargoApnFilter('todos');
                } else {
                  setCamaraFilter('todas');
                  setCargoJudicialFilter('todos');
                }
              }} className="w-full p-2 border rounded bg-white">
              <option value="todos">Todos</option>
              <option value="legisladores">Legislativo</option>
              <option value="apn">Ejecutivo</option>
              <option value="judicial">Judicial</option>
            </select>
          </div>
          {positionFilter === 'legisladores' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="province" className="block text-gray-600 text-xs font-semibold mb-1">Provincia</label>
                <select id="province" value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                  <option value="todas">Todas</option>
                  {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="party" className="block text-gray-600 text-xs font-semibold mb-1">Bloque</label>
                <select id="party" value={partyFilter} onChange={e => setPartyFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                  <option value="todos">Todos</option>
                  {parties.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}
          {positionFilter === 'apn' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="cargoApn" className="block text-gray-600 text-xs font-semibold mb-1">Cargo</label>
                <select id="cargoApn" value={cargoApnFilter} onChange={e => setCargoApnFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                  <option value="todos">Todos</option>
                  {cargosApn.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="unit" className="block text-gray-600 text-xs font-semibold mb-1">Unidad</label>
                <select id="unit" value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                  <option value="todas">Todas</option>
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
          )}
          {positionFilter === 'judicial' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="cargoJudicial" className="block text-gray-600 text-xs font-semibold mb-1">Cargo</label>
                <select id="cargoJudicial" value={cargoJudicialFilter} onChange={e => setCargoJudicialFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                  <option value="todos">Todos</option>
                  {cargosJudicial.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="camara" className="block text-gray-600 text-xs font-semibold mb-1">Cámara</label>
                <select id="camara" value={camaraFilter} onChange={e => setCamaraFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                  <option value="todas">Todas</option>
                  {camaras.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="credit" className="block text-gray-600 text-xs font-semibold mb-1 flex gap-1">
                <span title="Preferido (hipoteca, prenda, etc.)" className="flex"><Home size={14} className="text-green-600" /></span>
                Garantía†
              </label>
              <select id="credit" value={creditFilter} onChange={e => { posthog?.capture('filter_applied', { filter: 'garantia', value: e.target.value }); setCreditFilter(e.target.value); }} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todos</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label htmlFor="levelChange" className="block text-gray-600 text-xs font-semibold mb-1 flex gap-1">
                <span title="Cambio de nivel de deuda*" className="flex"><AlertCircle size={14} className="text-orange-500" /></span>
                Nivel*
              </label>
              <select id="levelChange" value={levelChangeFilter} onChange={e => { posthog?.capture('filter_applied', { filter: 'cambio_nivel', value: e.target.value }); setLevelChangeFilter(e.target.value); }} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todos</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="familiares" className="block text-gray-600 text-xs font-semibold mb-1 flex gap-1">
                <span title="Tiene familiares" className="flex"><Users size={14} className="text-blue-400" /></span>
                Familiares
              </label>
              <select id="familiares" value={familiaresFilter} onChange={e => { posthog?.capture('filter_applied', { filter: 'familiares', value: e.target.value }); setFamiliaresFilter(e.target.value); }} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todos</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label htmlFor="situacion" className="block text-gray-600 text-xs font-semibold mb-1 flex gap-1">
                <span title="Situación en el BCRA" className="flex"><ShieldAlert size={14} className="text-red-500" /></span>
                Situación
              </label>
              <select id="situacion" value={situacionFilter} onChange={e => { posthog?.capture('filter_applied', { filter: 'situacion_bcra', value: e.target.value }); setSituacionFilter(e.target.value); }} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todas</option>
                {Object.entries(SITUACION_BCRA).map(([val, { label }]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 leading-tight space-y-0.5">
            {garantiaFecha && <span className="block">† Preferido (hipoteca, prenda, etc.) al {garantiaFecha} según BCRA.</span>}
            <span className="block">* Cambio de nivel: heurística inferida a partir de los montos.</span>
          </p>
          <button
            onClick={() => {
              setSearchTerm("");
              setPositionFilter("todos");
              setProvinceFilter("todas");
              setPartyFilter("todos");
              setUnitFilter("todas");
              setCargoApnFilter("todos");
              setCargoJudicialFilter("todos");
              setCamaraFilter("todas");
              setCreditFilter("todos");
              setLevelChangeFilter("todos");
              setFamiliaresFilter("todos");
              setSituacionFilter("todos");
            }}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded transition-colors"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>
      <div className="selector-results-scroll flex-1 overflow-y-auto px-2 md:px-0">
        {filteredAndSorted.map((l: Legislator) => {
          const index = selectedIds.indexOf(l.cuit);
          const isSelected = index !== -1;
          const color = isSelected ? (selectedColors[l.cuit] || COLORS[index % COLORS.length]) : undefined;
          const { max } = debtStats.get(l.cuit)!;
          return (
            <button
              key={l.cuit}
              onClick={() => onSelect(l)}
              className={`w-full text-left p-3 border-b border-gray-200 cursor-pointer transition-colors flex items-center gap-3 rounded-md md:rounded-none ${isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
            >
              <div
                className="w-4 h-4 flex-shrink-0 rounded-sm flex items-center justify-center"
                style={{ backgroundColor: isSelected ? color : 'transparent' }}
              >
                {isSelected && <X size={12} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center w-full">
                  <div className="font-semibold text-sm mr-2 flex-1 flex items-center gap-1 min-w-0">
                    <span className="truncate">{l.nombre}</span>
                    {extraCuits.has(l.cuit) && (
                      <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none bg-purple-100 text-purple-700 border border-purple-300">
                        CUIT agregado
                      </span>
                    )}
                    {l.es_candidato && (
                      <span title="Candidato: aún no ocupa el cargo" className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none bg-amber-100 text-amber-700 border border-amber-300">
                        Candidato
                      </span>
                    )}
                    {l.hipoteca_bcra.tiene && (
                      <div title="Tiene preferido (hipoteca, prenda, etc.) registrado en el BCRA." className="shrink-0 flex">
                        <Home size={14} className="text-green-600" />
                      </div>
                    )}
                    {l.cambios_nivel && (
                      <div title="Tiene un cambio de nivel en su deuda. Este indicador es una heurística inferida a partir de los montos." className="shrink-0 flex">
                        <AlertCircle size={14} className="text-orange-500" />
                      </div>
                    )}
                    {l.familiares && l.familiares.length > 0 && (
                      <div title="Tiene datos de familiares en el BCRA." className="shrink-0 flex">
                        <Users size={14} className="text-blue-400" />
                      </div>
                    )}
                    {l.situacion_bcra !== undefined && l.situacion_bcra !== 1 && (
                      <span
                        title={`Situación BCRA: ${SITUACION_BCRA[l.situacion_bcra]?.label ?? l.situacion_bcra}`}
                        className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none"
                        style={{ backgroundColor: SITUACION_BCRA[l.situacion_bcra]?.color ?? '#9ca3af', color: '#fff' }}
                      >
                        {l.situacion_bcra}
                      </span>
                    )}
                  </div>
                  {max > 0 && (
                    <span className="text-xs text-gray-500 whitespace-nowrap bg-gray-100 px-1.5 py-0.5 rounded">
                      {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', notation: "compact", compactDisplay: "short" }).format(max * 1000)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {showCuitModal && (
        <CuitModal
          onClose={() => setShowCuitModal(false)}
          onAddCuit={onAddCuit!}
        />
      )}
    </div>
  );
}

export { SITUACION_BCRA };
