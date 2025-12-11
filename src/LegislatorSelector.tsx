import { useMemo, useState } from 'react';

import type { Legislator } from './types';

export default ({ legisladores, onSelect, selectedId }: { legisladores: Legislator[], onSelect: (l: Legislator) => void, selectedId?: string }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState("todos");
  const [provinceFilter, setProvinceFilter] = useState("todas");
  const [partyFilter, setPartyFilter] = useState("todos");

  const provinces = useMemo(() => [...new Set(legisladores.map(l => l.distrito))].sort(), [legisladores]);
  const parties = useMemo(() => [...new Set(legisladores.map(l => l.partido).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);

  const filteredAndSorted = useMemo(() => {
    return legisladores
      .filter(l => {
        const searchMatch = searchTerm === "" || l.nombre.toLowerCase().includes(searchTerm.toLowerCase())

        const positionMatch = positionFilter === 'todos' || (l.cargo || '').toLocaleLowerCase() === positionFilter;
        const provinceMatch = provinceFilter === 'todas' || l.distrito === provinceFilter;
        const partyMatch = partyFilter === 'todos' || l.partido === partyFilter;

        return searchMatch && positionMatch && provinceMatch && partyMatch;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [legisladores, searchTerm, positionFilter, provinceFilter, partyFilter]);

  return (
    <div className="w-full md:w-80 h-screen flex flex-col border-r border-gray-200 bg-white">
      <div className="p-4 border-b">
        <h2 className="font-bold text-gray-800">Legisladores</h2>
        <input
          className="w-full mt-2 p-2 border rounded text-sm"
          placeholder="Buscar..."
          onChange={e => setSearchTerm(e.target.value)}
        />
        <div className="mt-4 space-y-2 text-sm">
          <div>
            <label htmlFor="position" className="block text-gray-600 text-xs font-semibold mb-1">Cargo</label>
            <select id="position" value={positionFilter} onChange={e => setPositionFilter(e.target.value)} className="w-full p-2 border rounded bg-white">
              <option value="todos">Todos</option>
              <option value="diputado">Diputado/a</option>
              <option value="senador">Senador/a</option>
            </select>
          </div>
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
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredAndSorted.map((l: Legislator) => (
          <button
            key={l.cuit}
            onClick={() => onSelect(l)}
            className={`w-full text-left p-3 hover:bg-gray-50 border-b cursor-pointer ${selectedId === l.cuit ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
          >
            <div className="font-semibold text-sm">{l.nombre}</div>
          </button>
        ))}
      </div>
    </div>
  );
};