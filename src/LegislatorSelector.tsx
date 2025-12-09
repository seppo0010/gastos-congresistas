import { useState } from 'react';

import type { Legislator } from './types';

export default ({ legisladores, onSelect, selectedId }: { legisladores: Legislator[], onSelect: (l: Legislator) => void, selectedId?: string }) => {
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = legisladores.filter(l => 
    l.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || l.cuit.includes(searchTerm)
  );

  return (
    <div className="w-full md:w-80 h-[600px] flex flex-col border-r border-gray-200 bg-white">
      <div className="p-4 border-b">
        <h2 className="font-bold text-gray-800">Legisladores</h2>
        <input 
          className="w-full mt-2 p-2 border rounded text-sm" 
          placeholder="Buscar..." 
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((l: Legislator) => (
          <button
            key={l.cuit}
            onClick={() => onSelect(l)}
            className={`w-full text-left p-3 hover:bg-gray-50 border-b ${selectedId === l.cuit ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
          >
            <div className="font-semibold text-sm">{l.nombre}</div>
          </button>
        ))}
      </div>
    </div>
  );
};