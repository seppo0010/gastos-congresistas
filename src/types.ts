// 1. Registro individual de deuda (Un mes, un banco)
export interface DebtRecord {
  entidad: string;  // Ej: "BANCO DE LA NACION ARGENTINA"
  fecha: string;    // Formato ISO "YYYY-MM" (Ej: "2024-06")
  situacion: number;// 1 (Normal) a 5 (Irrecuperable)
  monto: number;    // En miles de pesos (int)
}

// 2. Hito (Evento político o personal)
export interface Milestone {
  fecha: string;    // Formato ISO "YYYY-MM"
  texto: string;    // Ej: "Voto Ley Bases"
  color: string;    // Hex code: "#ef4444"
  tipo?: 'global' | 'personal' | 'voto'; // Opcional, para lógica de filtrado visual
}

// 3. El Legislador (La entidad principal)
export interface Legislator {
  cuit: string;     // Identificador único (Ej: "20326896684")
  nombre: string;   // Nombre completo
  pdf_paths: string[]; // Lista de archivos fuente procesados
  hitos_personales: Milestone[]; // Eventos específicos de esta persona
  historial: DebtRecord[];       // Lista cruda de deudas (sin agrupar)
}

// 4. Estructura Raíz del JSON (Dashboard completo)
export interface DashboardData {
  meta: {
    generated_at: string;
    hitos_globales: Milestone[]; // Hitos que aplican a todos
  };
  data: Legislator[];
}