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
  monto?: number;   // Monto en pesos (opcional)
  tipo?: 'global' | 'personal' | 'voto' | 'politico' | 'economico' | 'senadores' | 'diputados'; // Opcional, para lógica de filtrado visual
}

// 3. Familiar de un legislador
export interface Familiar {
  parentesco: string; // Ej: "CONYUGE / CONVIVIENTE", "HIJO/A"
  historial: DebtRecord[];
}

// 4. El Legislador (La entidad principal)
export interface Legislator {
  cuit: string;     // Identificador único (Ej: "20326896684")
  nombre: string;   // Nombre completo
  pdf_paths?: string[]; // Lista de archivos fuente procesados
  hitos_personales: Milestone[]; // Eventos específicos de esta persona
  historial: DebtRecord[];       // Lista cruda de deudas (sin agrupar)
  distrito?: string;  // Solo legisladores
  partido?: string;   // Solo legisladores
  cargo: string;
  poder?: 'legislativo' | 'ejecutivo' | 'judicial';
  es_candidato?: boolean;
  unidad?: string;    // Solo funcionarios del ejecutivo (ej: "Ministerio de Salud")
  periodos?: { cargo: 'Senador' | 'Diputado', inicio: string, fin: string }[];  // Solo legisladores
  hipoteca_bcra: { tiene: boolean; monto_miles_pesos?: number; entidades?: string[]; fecha?: string };
  situacion_bcra?: number; // 0=no reportado, 1=normal, 2=riesgo bajo, 3=riesgo medio, 4=riesgo alto, 5=irrecuperable, 11=garantías preferidas "A"
  cambios_nivel: boolean;
  familiares?: Familiar[];
  color?: string;
}

// 5. Estructura Raíz del JSON (Dashboard completo)
export interface DashboardData {
  meta: {
    hitos_globales: Milestone[]; // Hitos que aplican a todos
    ipc: { [date: string]: number }
    mep: { [date: string]: number }
  };
  data: Legislator[];
}

// 5. Opciones de visualización de moneda
export type CurrencyMode =
  | 'nominal' // Pesos corrientes (valor histórico)
  | 'real'    // Pesos constantes (ajustado por IPC)
  | 'usd';    // Dólares (ajustado por MEP)