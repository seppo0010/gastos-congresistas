# Gastos Congresistas

Una aplicación web React + TypeScript para visualizar y comparar las deudas registradas en la "Central de Deudores" del Banco Central de Argentina (BCRA) de legisladores nacionales.

## Características

- **Comparación simultánea**: Visualiza hasta 4 legisladores al mismo tiempo
- **Historial temporal**: Muestra la evolución de las deudas a lo largo del tiempo
- **Ajustes económicos**: Opciones para ajustar los montos por inflación (IPC) o tipo de cambio (MEP)
- **Filtros avanzados**: Busca y filtra legisladores por cargo, distrito, partido político y estado crediticio
- **Compartible**: Los enlaces incluyen el estado de selección para compartir comparaciones

## Demo

La aplicación está desplegada en: [https://seppo0010.github.io/gastos-congresistas/](https://seppo0010.github.io/gastos-congresistas/)

## Instalación

1. Clona el repositorio:
   ```bash
   git clone https://github.com/seppo0010/gastos-congresistas.git
   cd gastos-congresistas
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```

## Comandos disponibles

- `npm run dev` - Inicia el servidor de desarrollo de Vite
- `npm run build` - Construye la aplicación para producción (incluye verificación de TypeScript)
- `npm run lint` - Ejecuta ESLint para verificar el código
- `npm run preview` - Previsualiza la build de producción localmente

## Arquitectura

### Estructura de componentes
- **Dashboard.tsx** - Componente raíz que maneja todo el estado (legisladores seleccionados, parámetros de URL, modo móvil/desktop, modo de moneda)
- **LegislatorSelector.tsx** - Panel izquierdo para búsqueda, filtrado y lista de legisladores
- **DebtChart.tsx** - Panel derecho con gráfico de barras de Recharts mostrando deudas por tiempo, líneas de referencia de hitos y tooltips personalizados

### Carga de datos
Los datos se cargan estáticamente desde `legisladores_full.json` (~4.2 MB) en tiempo de build. No hay llamadas a APIs en runtime.

### Formato de datos
- `DashboardData.meta` - Hitos globales, índices IPC, tasas MEP (claveados por "YYYY-MM")
- `DashboardData.data` - Array de objetos `Legislator`
- Cada `Legislator` tiene un historial plano de `DebtRecord[]` (uno por banco por mes), hitos personales y flags booleanos
- `DebtRecord.monto` está en miles de ARS; `situacion` es 1-5 (1=Normal, 5=Irrecuperable)
- Modos de moneda: `nominal` | `real` (ajustado por IPC) | `usd` (ajustado por MEP)

### Estado de URL
Las selecciones de legisladores se codifican en parámetros de query para permitir compartir comparaciones vía enlace.

### Configuración de Vite
- Ruta base: `/gastos-congresistas/` para GitHub Pages
- Tailwind CSS 4 vía plugin de Vite (no PostCSS)

## Despliegue

El proyecto se despliega automáticamente a GitHub Pages en cada push a la rama `main` mediante el workflow de CI/CD en `.github/workflows/deploy.yml`.

## Tecnologías

- **React** - Framework de UI
- **TypeScript** - Tipado estático
- **Vite** - Build tool y dev server
- **Tailwind CSS** - Estilos
- **Recharts** - Gráficos
- **ESLint** - Linting

## Notas sobre datos

- Los flags `posible_crédito` y `cambios_nivel` son heurísticos calculados al generar el JSON
- El `historial` no está ordenado ni agregado; los componentes del gráfico lo agregan por fecha
- También existe `politicos_full.json` en `src/` que puede ser un dataset alternativo o más nuevo
- La nómina vigente de Diputados se valida contra el CSV y la página oficial de la HCDN con `npm run check:diputados`. La página oficial vincula cada fila con una foto cuyo identificador es el CUIT usado para cruzar identidades. `--update` agrega las bancas faltantes como registros sin historial; no consulta ni fabrica datos de deuda.

## Contribuir

Si encuentras errores o tienes sugerencias, por favor abre un issue en el repositorio de GitHub.

## Licencia

Este proyecto está bajo la Licencia MIT.
