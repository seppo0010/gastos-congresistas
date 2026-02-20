import { useMemo, useState, useEffect } from 'react';
import { Home, AlertCircle, X } from 'lucide-react';

import type { Legislator } from './types';
import { COLORS } from './Colors';

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

export default ({ legisladores, onSelect, selectedIds = [], selectedColors = {} }: { legisladores: Legislator[], onSelect: (l: Legislator) => void, selectedIds?: string[], selectedColors?: Record<string, string> }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState("todos");
  const [provinceFilter, setProvinceFilter] = useState("todas");
  const [partyFilter, setPartyFilter] = useState("todos");
  const [unitFilter, setUnitFilter] = useState("todas");
  const [creditFilter, setCreditFilter] = useState("todos");
  const [levelChangeFilter, setLevelChangeFilter] = useState("todos");
  const [sortOrder, setSortOrder] = useState("nombre_asc");

  const provinces = useMemo(() => [...new Set(legisladores.filter(l => l.distrito !== undefined).map(l => l.distrito).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);
  const parties = useMemo(() => [...new Set(legisladores.filter(l => l.partido !== undefined).map(l => l.partido).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);
  const units = useMemo(() => [...new Set(legisladores.filter(l => l.unidad !== undefined).map(l => l.unidad).filter(u => (u || '').trim() !== ''))].sort(), [legisladores]);

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

  useEffect(() => {
    if (positionFilter === 'apn') {
      setProvinceFilter('todas');
      setPartyFilter('todos');
    } else if (positionFilter === 'legisladores') {
      setUnitFilter('todas');
    }
  }, [positionFilter]);

  const filteredAndSorted = useMemo(() => {
    return legisladores
      .filter(l => {
        const searchMatch = debouncedSearchTerm === "" || l.nombre.toLowerCase().includes(debouncedSearchTerm.toLowerCase())

        const isLegislador = !!l.periodos;
        const positionMatch = positionFilter === 'todos' ||
          (positionFilter === 'legisladores' && isLegislador) ||
          (positionFilter === 'apn' && !isLegislador);
        const provinceMatch = provinceFilter === 'todas' || l.distrito === provinceFilter;
        const partyMatch = partyFilter === 'todos' || l.partido === partyFilter;
        const unitMatch = unitFilter === 'todas' || l.unidad === unitFilter;

        const creditMatch = creditFilter === 'todos' || (creditFilter === 'si' ? l.posible_crédito : !l.posible_crédito);
        const levelChangeMatch = levelChangeFilter === 'todos' || (levelChangeFilter === 'si' ? l.cambios_nivel : !l.cambios_nivel);

        return selectedIds.includes(l.cuit) || (searchMatch && positionMatch && provinceMatch && partyMatch && unitMatch && creditMatch && levelChangeMatch);
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
  }, [legisladores, debouncedSearchTerm, positionFilter, provinceFilter, partyFilter, unitFilter, creditFilter, levelChangeFilter, selectedIds, sortOrder, debtStats]);

  return (
    <div className="w-full md:w-80 h-full flex flex-col border-r border-gray-200 bg-white">
      <div className="p-4 border-b">
        <h2 className="font-bold text-gray-800">Funcionarios ({filteredAndSorted.length})</h2>
        <input
          className="w-full mt-2 p-2 border rounded text-sm"
          placeholder="Buscar..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <div className="mt-4 space-y-2 text-sm">
          <div>
            <label htmlFor="sort" className="block text-gray-600 text-xs font-semibold mb-1">Orden</label>
            <select id="sort" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="w-full p-2 border rounded bg-white">
              <option value="nombre_asc">Nombre (A-Z)</option>
              <option value="nombre_desc">Nombre (Z-A)</option>
              <option value="max_deuda_desc">Mayor Deuda Histórica</option>
              <option value="promedio_deuda_desc">Promedio Deuda Histórica</option>
            </select>
          </div>
          <div>
            <label htmlFor="position" className="block text-gray-600 text-xs font-semibold mb-1">Poder</label>
            <select id="position" value={positionFilter} onChange={e => setPositionFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
              <option value="todos">Todos</option>
              <option value="legisladores">Legislativo</option>
              <option value="apn">Ejecutivo</option>
            </select>
          </div>
          {positionFilter === 'legisladores' && (
            <div>
              <label htmlFor="province" className="block text-gray-600 text-xs font-semibold mb-1">Provincia</label>
              <select id="province" value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                <option value="todas">Todas</option>
                {provinces.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
          {positionFilter === 'legisladores' && (
            <div>
              <label htmlFor="party" className="block text-gray-600 text-xs font-semibold mb-1">Bloque</label>
              <select id="party" value={partyFilter} onChange={e => setPartyFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todos</option>
                {parties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
          {positionFilter === 'apn' && (
            <div>
              <label htmlFor="unit" className="block text-gray-600 text-xs font-semibold mb-1">Unidad</label>
              <select id="unit" value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                <option value="todas">Todas</option>
                {units.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="credit" className="block text-gray-600 text-xs font-semibold mb-1 flex gap-1"><Home size={14} className="text-green-600" />Posible Crédito*</label>
              <select id="credit" value={creditFilter} onChange={e => setCreditFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todos</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label htmlFor="levelChange" className="block text-gray-600 text-xs font-semibold mb-1 flex gap-1"><AlertCircle size={14} className="text-orange-500" />Cambios Nivel*</label>
              <select id="levelChange" value={levelChangeFilter} onChange={e => setLevelChangeFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
                <option value="todos">Todos</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 leading-tight">
            * Estos indicadores son heurísticas inferidas a partir de los montos.
          </p>
          <button
            onClick={() => {
              setSearchTerm("");
              setPositionFilter("todos");
              setProvinceFilter("todas");
              setPartyFilter("todos");
              setUnitFilter("todas");
              setCreditFilter("todos");
              setLevelChangeFilter("todos");
            }}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded transition-colors"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredAndSorted.map((l: Legislator) => {
          const index = selectedIds.indexOf(l.cuit);
          const isSelected = index !== -1;
          const color = isSelected ? (selectedColors[l.cuit] || COLORS[index % COLORS.length]) : undefined;
          const { max } = debtStats.get(l.cuit)!;

          return (
            <button
              key={l.cuit}
              onClick={() => onSelect(l)}
              className={`w-full text-left p-3 border-b cursor-pointer transition-colors flex items-center gap-3 ${isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
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
                    {l.posible_crédito && (
                      <div title="Tiene un posible crédito. Este indicador es una heurística inferida a partir de los montos." className="shrink-0 flex">
                        <Home size={14} className="text-green-600" />
                      </div>
                    )}
                    {l.cambios_nivel && (
                      <div title="Tiene un cambio de nivel en su deuda. Este indicador es una heurística inferida a partir de los montos." className="shrink-0 flex">
                        <AlertCircle size={14} className="text-orange-500" />
                      </div>
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
    </div>
  );
};
