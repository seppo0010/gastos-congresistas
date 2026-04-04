import { useMemo, useState, useRef, forwardRef, useImperativeHandle, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Brush } from 'recharts';
import { toPng } from 'html-to-image';

// Importa tu JSON generado por Python
import type { Legislator, Milestone, CurrencyMode } from './types';
import { Camera, Check, Copy, Download, Eye, EyeOff, Flag, HelpCircle, Loader2, Share2, Users, X } from 'lucide-react';
import { COLORS } from './Colors';
import { SITUACION_BCRA } from './LegislatorSelector';

const abbreviateOrgano = (text: string): string =>
  text
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    .replace(/Tribunal(?:es)?\s+Oral(?:es)?\s+en\s+lo\s+Criminal\s+y\s+Correccional/gi, 'TOC CyC')
    .replace(/Tribunal(?:es)?\s+Oral(?:es)?\s+en\s+lo\s+Criminal/gi, 'TOC')
    .replace(/en\s+lo\s+Contencioso\s+Administrativo\s+Federal/gi, 'CAF')
    .replace(/en\s+lo\s+Criminal\s+y\s+Correccional/gi, 'CyC')
    .replace(/\s+de\s+Primera\s+Instancia/gi, '')
    .replace(/\s+en\s+Primera\s+Instancia/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\b(Ii|Iii|Iv)\b/g, s => s.toUpperCase())
    .trim();

interface DebtChartProps {
  legislators: Legislator[];
  globalMilestones: Milestone[];
  ipc?: { [date: string]: number };
  mep?: { [date: string]: number };
  onRemove?: (legislator: Legislator) => void;
  onToggleVisibility?: (cuit: string) => void;
  isMobile?: boolean;
  copied?: boolean;
  onShare?: () => void;
  onShowHelp?: () => void;
  includeFamiliares?: boolean;
  onToggleFamiliares?: () => void;
  hiddenIds?: Set<string>;
}

interface Bank {
    fecha: string;
    monto: number;
    entidad: string;
}

// Separator used in segment keys (unlikely to appear in data)
const SEP = '|||';

interface SegmentInfo {
  cuit: string;
  entidad: string;
  isFamiliar: boolean;
  parentesco?: string;
  totalMonto: number;
}

interface MilestoneChipStyle {
  color: string;
  backgroundColor: string;
  borderColor: string;
}

interface MilestoneWithOwner extends Milestone {
  legislatorId?: string;
  legislatorColor?: string;
  displayColor?: string;
  convertedMonto?: number;
}

interface VerticalMilestone {
  fecha: string;
  texto: string;
  color: string;
  tipo?: Milestone['tipo'];
}

interface EconomicMilestone extends MilestoneWithOwner {
  color: string;
  convertedMonto: number;
}

interface ChartBankGroup {
  propio: Bank[];
  familiares: Record<string, Bank[]>;
}

interface ChartDatum extends Record<string, unknown> {
  date: string;
  banks: Record<string, ChartBankGroup>;
  [key: string]: unknown;
}

interface EconomicMarkerProps {
  cx?: number;
  cy?: number;
  color?: string;
}

interface XAxisTickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string };
}

interface MilestoneLabelProps {
  x?: number;
  text: string;
  color?: string;
  milestoneKey: string;
  viewBox?: { x?: number; cx?: number };
}

interface TooltipPayloadItem {
  dataKey: string;
  value?: number;
  payload: ChartDatum;
}

function tintColor(hex: string, amount: number): string {
  // amount 0 = original color, 1 = white
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getMilestoneChipStyle(color?: string): MilestoneChipStyle {
  const resolvedColor = color || GRAY;
  return {
    color: resolvedColor,
    backgroundColor: tintColor(resolvedColor, 0.9),
    borderColor: tintColor(resolvedColor, 0.55),
  };
}

const teniaCargo = (legislator: Legislator, cargo: string | undefined, fecha: string): boolean => {
  return (legislator.periodos || []).filter(p => p.cargo.toLowerCase() === (cargo || '').toLowerCase() && fecha > p.inicio && fecha < p.fin).length > 0
}

const GRAY = '#9ca3af';
const ORANGE = '#FFA800';

const CustomEconomicMarker = ({ cx, cy, color }: EconomicMarkerProps) => {
  if (!cx || !cy) return null;
  return (
    <g>
      <line
        x1={cx - 15}
        x2={cx + 15}
        y1={cy}
        y2={cy}
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
};

const DebtChart = forwardRef(({
  legislators,
  globalMilestones,
  ipc,
  mep,
  onRemove,
  onToggleVisibility,
  isMobile,
  copied,
  onShare,
  onShowHelp,
  includeFamiliares = false,
  onToggleFamiliares,
  hiddenIds = new Set<string>(),
}: DebtChartProps, ref) => {
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('nominal');
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const visibleLegislators = useMemo(
    () => legislators.filter(l => !hiddenIds.has(l.cuit)),
    [legislators, hiddenIds]
  );


  useImperativeHandle(ref, () => ({
    getChartElement: () => chartContainerRef.current,
    openExportMenu: () => setShowExportMenu(true),
  }));

  const ipcDates = useMemo(() => {
    const r = Object.keys(ipc || {});
    r.sort();
    return r;
  }, [ipc]);

  const latestIPC = useMemo(() => {
    if (currencyMode === 'real' && ipc && ipcDates.length > 0) {
      return ipc[ipcDates[ipcDates.length - 1]];
    }
    return 0;
  }, [currencyMode, ipc, ipcDates]);

  const convertMonto = useCallback((monto: number, fecha: string) => {
    if (currencyMode === 'real' && ipc && latestIPC > 0) {
      const val = ipc[fecha];
      if (val) return (monto * latestIPC) / val;
    } else if (currencyMode === 'usd' && mep) {
      const val = mep[fecha];
      return (val && val > 0) ? (monto * 1000) / val : 0;
    }
    return monto;
  }, [currencyMode, ipc, latestIPC, mep]);

  // 1. Unificar Hitos (Globales + Personales)
  const { verticalMilestones, economicMilestones } = useMemo(() => {
    const personales = visibleLegislators.flatMap((l, index) =>
      (l.hitos_personales || []).map(h => ({
        ...h,
        legislatorId: l.cuit,
        legislatorColor: l.color || COLORS[index % COLORS.length]
      }))
    );

    const relevantes = globalMilestones.filter(m => (
      ['global', 'voto', 'politico'].includes(m.tipo || '') ||
      visibleLegislators.some(l => teniaCargo(l, m.tipo, m.fecha))
    ));

    const all = [...relevantes, ...personales];

    // Milestones with monto are economic
    const eco: EconomicMilestone[] = all.filter((m): m is MilestoneWithOwner & { monto: number } => m.monto != null).map(m => ({
      ...m,
      color: ORANGE,
      convertedMonto: convertMonto((m.monto || 0) / 1000, m.fecha)
    }));

    // Grouping only for vertical milestones
    const grouped = all.filter((m): m is MilestoneWithOwner => m.monto == null).reduce<Record<string, MilestoneWithOwner[]>>((acc, milestone) => {
      (acc[milestone.fecha] ??= []).push(milestone);
      return acc;
    }, {});

    const vertical: VerticalMilestone[] = Object.values(grouped).map((group) => {
      const legislatorIds = new Set(group.map((milestone) => milestone.legislatorId).filter(Boolean));
      const hasGlobal = group.some((milestone) => !milestone.legislatorId);

      let color = GRAY;

      if (legislatorIds.size === 1 && !hasGlobal) {
        color = group.find((milestone) => milestone.legislatorId)?.legislatorColor || GRAY;
      } else if (legislatorIds.size === 0 && hasGlobal && visibleLegislators.length === 1) {
        color = group[0].color;
      }

      return {
        fecha: group[0].fecha,
        texto: group.map((milestone) => milestone.texto).join(', '),
        color,
        tipo: group[0].tipo,
      }
    });

    return { verticalMilestones: vertical, economicMilestones: eco };
  }, [convertMonto, globalMilestones, visibleLegislators]);

  // 2a. Calcular segmentos únicos (cuit × deudor × entidad) con total acumulado
  const barSegments = useMemo(() => {
    const map = new Map<string, SegmentInfo>();

    visibleLegislators.forEach(l => {
      l.historial.forEach(r => {
        const key = `${l.cuit}${SEP}propio${SEP}${r.entidad}`;
        const existing = map.get(key);
        if (existing) existing.totalMonto += r.monto;
        else map.set(key, { cuit: l.cuit, entidad: r.entidad, isFamiliar: false, totalMonto: r.monto });
      });

      if (includeFamiliares && l.familiares) {
        l.familiares.forEach(familiar => {
          familiar.historial.forEach(r => {
            const key = `${l.cuit}${SEP}${familiar.parentesco}${SEP}${r.entidad}`;
            const existing = map.get(key);
            if (existing) existing.totalMonto += r.monto;
            else map.set(key, { cuit: l.cuit, entidad: r.entidad, isFamiliar: true, parentesco: familiar.parentesco, totalMonto: r.monto });
          });
        });
      }
    });

    return map;
  }, [visibleLegislators, includeFamiliares]);

  // 2b. Asignar colores a cada segmento (tintes del color base del político)
  const segmentColors = useMemo(() => {
    const colorMap = new Map<string, string>();

    visibleLegislators.forEach((l, idx) => {
      const baseColor = l.color || COLORS[idx % COLORS.length];

      const propioKeys = [...barSegments.entries()]
        .filter(([, v]) => v.cuit === l.cuit && !v.isFamiliar)
        .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
        .map(([key]) => key);

      const familiaresKeys = [...barSegments.entries()]
        .filter(([, v]) => v.cuit === l.cuit && v.isFamiliar)
        .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
        .map(([key]) => key);

      // Propio: base color → tinte 55% (de oscuro a claro según deuda)
      propioKeys.forEach((key, i) => {
        const tint = propioKeys.length <= 1 ? 0 : (i / (propioKeys.length - 1)) * 0.55;
        colorMap.set(key, tintColor(baseColor, tint));
      });

      // Familiares: tintes 65%–85% (zona visualmente diferenciada)
      familiaresKeys.forEach((key, i) => {
        const tint = familiaresKeys.length <= 1
          ? 0.65
          : 0.65 + (i / (familiaresKeys.length - 1)) * 0.2;
        colorMap.set(key, tintColor(baseColor, tint));
      });
    });

    return colorMap;
  }, [visibleLegislators, barSegments]);

  // 2c. Procesar Datos de Deuda (Agrupar por mes)
  const chartData = useMemo(() => {
    const grouped: Record<string, ChartDatum> = {};

    const ensureEntry = (fecha: string, cuit: string) => {
      if (!grouped[fecha]) grouped[fecha] = { date: fecha, banks: {} };
      if (!grouped[fecha].banks[cuit]) grouped[fecha].banks[cuit] = { propio: [], familiares: {} };
    };

    visibleLegislators.forEach(l => {
      // Historial propio
      l.historial.forEach(r => {
        ensureEntry(r.fecha, l.cuit);
        const monto = convertMonto(r.monto, r.fecha);
        const key = `${l.cuit}${SEP}propio${SEP}${r.entidad}`;
        const currentValue = grouped[r.fecha][key];
        grouped[r.fecha][key] = (typeof currentValue === 'number' ? currentValue : 0) + monto;
        grouped[r.fecha].banks[l.cuit].propio.push({ ...r, monto });
      });

      // Familiares
      if (includeFamiliares && l.familiares) {
        l.familiares.forEach(familiar => {
          familiar.historial.forEach(r => {
            ensureEntry(r.fecha, l.cuit);
            const monto = convertMonto(r.monto, r.fecha);
            const key = `${l.cuit}${SEP}${familiar.parentesco}${SEP}${r.entidad}`;
            const currentValue = grouped[r.fecha][key];
            grouped[r.fecha][key] = (typeof currentValue === 'number' ? currentValue : 0) + monto;
            const fams = grouped[r.fecha].banks[l.cuit].familiares;
            if (!fams[familiar.parentesco]) fams[familiar.parentesco] = [];
            fams[familiar.parentesco].push({ ...r, monto });
          });
        });
      }
    });

    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [convertMonto, includeFamiliares, visibleLegislators]);


  const xAxisInterval = useMemo(() => {
    if (!isMobile) return 0;
    const ticks = chartData.length;
    if (ticks <= 20) return 0; // Show all for up to 20 ticks
    return Math.floor(ticks / 15); // Aim for ~15 ticks
  }, [isMobile, chartData.length]);

  const xAxisTickFormatter = (date: string) => {
    const [year, month] = date.split('-');
    const monthNum = parseInt(month);
    const d = new Date(parseInt(year), monthNum - 1);

    // Capitalize first letter and remove period
    const monthStr = d.toLocaleDateString('es-AR', { month: 'short' });
    const formattedMonth = monthStr.charAt(0).toUpperCase() + monthStr.slice(1).replace('.', '');

    if (monthNum === 1) {
      // Enero en dos líneas: nombre y año (para marcar cambio de año)
      return `${formattedMonth}\n${year}`;
    }

    return formattedMonth;
  };

  const [milestoneHint, setMilestoneHint] = useState<{ text: string; x: number } | null>(null);
  const [activeMilestoneKey, setActiveMilestoneKey] = useState<string | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest('[data-export-menu]')) setShowExportMenu(false);
    };
    const t = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', handler); };
  }, [showExportMenu]);

  const buildExportCanvas = async (): Promise<HTMLCanvasElement> => {
    if (!chartContainerRef.current) throw new Error('No chart element');

    const scale = 2;

    const el = chartContainerRef.current;

    // Temporarily hide brush so it doesn't appear in the export
    const brushEl = el.querySelector('.recharts-brush') as HTMLElement | null;
    const prevVisibility = brushEl?.style.visibility ?? '';
    if (brushEl) brushEl.style.visibility = 'hidden';

    // Force landscape dimensions for export: if portrait, constrain height so width > height
    // Also add horizontal padding so chart edges aren't clipped (BarChart has right: 0 margin)
    const origWidth = el.style.width;
    const origHeight = el.style.height;
    const origMinHeight = el.style.minHeight;
    const origPaddingLeft = el.style.paddingLeft;
    const origPaddingRight = el.style.paddingRight;
    const svgEl = el.querySelector('svg') as SVGElement | null;
    const origSvgOverflow = svgEl?.style.overflow ?? '';
    const naturalW = el.offsetWidth;
    const naturalH = el.offsetHeight;
    const MIN_ASPECT = 1.6; // width/height
    const CAPTURE_PAD = 12; // px padding added to container sides before capture
    el.style.paddingLeft = CAPTURE_PAD + 'px';
    el.style.paddingRight = CAPTURE_PAD + 'px';
    if (svgEl) svgEl.style.overflow = 'visible';
    if (naturalH > naturalW / MIN_ASPECT) {
      const targetH = Math.round(naturalW / MIN_ASPECT);
      el.style.height = targetH + 'px';
      el.style.minHeight = targetH + 'px';
    }
    await new Promise(r => setTimeout(r, 200)); // wait for Recharts re-render

    let chartDataUrl: string;
    try {
      chartDataUrl = await toPng(el, {
        backgroundColor: '#ffffff',
        pixelRatio: scale,
        skipFonts: true,
      });
    } finally {
      if (brushEl) brushEl.style.visibility = prevVisibility;
      el.style.width = origWidth;
      el.style.height = origHeight;
      el.style.minHeight = origMinHeight;
      el.style.paddingLeft = origPaddingLeft;
      el.style.paddingRight = origPaddingRight;
      if (svgEl) svgEl.style.overflow = origSvgOverflow;
    }

    const chartImg = new Image();
    await new Promise<void>((resolve, reject) => {
      chartImg.onload = () => resolve();
      chartImg.onerror = reject;
      chartImg.src = chartDataUrl;
    });

    const px = (n: number) => Math.round(n * scale);
    const PADDING = px(16);
    const TITLE_SIZE = px(20);
    const NAME_SIZE = px(17);
    const DETAIL_SIZE = px(14);
    const FOOTER_H = px(48);

    // Compute per-legislator stats from chartData
    const legislatorStats = legislators.map(l => {
      const monthlyTotals = chartData
        .map(entry => Object.entries(entry)
          .filter(([k]) => k.startsWith(l.cuit + SEP))
          .reduce((sum, [, v]) => sum + (typeof v === 'number' ? v : 0), 0))
        .filter(v => v > 0);
      const avg = monthlyTotals.length > 0 ? monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length : 0;
      const max = monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0;
      return { avg, max };
    });

    // Calculate header height
    let headerH = PADDING + TITLE_SIZE + px(12);
    legislators.forEach(() => {
      headerH += NAME_SIZE + px(4);
      headerH += DETAIL_SIZE + px(4); // details or stats line
      headerH += DETAIL_SIZE + px(4); // stats line
      headerH += px(6);
    });
    headerH += PADDING;

    const CHART_SCALE = 0.7;
    const rawChartW = Math.round(chartImg.width * CHART_SCALE);
    const rawChartH = Math.round(chartImg.height * CHART_SCALE);

    // Ensure canvas is wide enough for header text on narrow mobile screens
    const MIN_W = px(500);
    const CHART_PAD = PADDING * 2; // horizontal padding around the chart image
    const scaledChartW = Math.max(rawChartW, MIN_W - CHART_PAD * 2);
    const scaledChartH = rawChartW < scaledChartW ? Math.round(rawChartH * scaledChartW / rawChartW) : rawChartH;
    const W = scaledChartW + CHART_PAD * 2;
    const H = scaledChartH + headerH + FOOTER_H;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Title
    let y = PADDING + TITLE_SIZE;
    ctx.fillStyle = '#111827';
    ctx.font = `bold ${TITLE_SIZE}px system-ui,Arial,sans-serif`;
    ctx.fillText('Deuda BCRA · Central de Deudores', PADDING, y);
    y += px(12);

    // Legislators
    legislators.forEach((l, idx) => {
      const color = l.color || COLORS[idx % COLORS.length];
      const stats = legislatorStats[idx];
      const textX = PADDING + NAME_SIZE + px(6);

      ctx.fillStyle = color;
      ctx.fillRect(PADDING, y, NAME_SIZE, NAME_SIZE);
      ctx.font = `bold ${NAME_SIZE}px system-ui,Arial,sans-serif`;
      y += NAME_SIZE;
      ctx.fillText(l.nombre, textX, y);
      y += px(4);

      const details = [l.cargo, l.partido, l.distrito, l.unidad, l.organo ? abbreviateOrgano(l.organo) : undefined].filter(Boolean).join(' · ');
      ctx.fillStyle = '#6b7280';
      ctx.font = `${DETAIL_SIZE}px system-ui,Arial,sans-serif`;
      if (details) {
        y += DETAIL_SIZE;
        ctx.fillText(details, textX, y);
        y += px(4);
      }

      y += DETAIL_SIZE;
      ctx.fillText(`Promedio: ${formatMoney(stats.avg)}  ·  Máximo: ${formatMoney(stats.max)}`, textX, y);
      y += px(4);

      y += px(6);
    });

    // Chart (scaled down, with horizontal padding)
    ctx.drawImage(chartImg, CHART_PAD, headerH, scaledChartW, scaledChartH);

    // Footer
    const FOOTER_FONT = px(14);
    ctx.fillStyle = '#6b7280';
    ctx.font = `${FOOTER_FONT}px system-ui,Arial,sans-serif`;
    const baseUrl = `${window.location.host}${window.location.pathname}`;
    const lastDate = chartData.length > 0 ? chartData[chartData.length - 1].date : null;
    const lastDateStr = lastDate
      ? new Date(lastDate + '-02').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
      : null;
    const currencyLabel = currencyMode === 'real'
      ? `Ajustado por inflación a ${ipcDates.length > 0 ? new Date(ipcDates[ipcDates.length - 1] + '-02').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : ''}`
      : currencyMode === 'usd'
      ? 'Dólares MEP'
      : null;
    const footerParts = [baseUrl, lastDateStr ? `Última actualización: ${lastDateStr}` : null, currencyLabel].filter(Boolean);
    const footerText = footerParts.join('  ·  ');
    ctx.fillText(footerText, PADDING, H - FOOTER_H / 2 + FOOTER_FONT / 3);

    return canvas;
  };

  const handleExportDownload = async () => {
    setExportState('loading');
    setShowExportMenu(false);
    try {
      const canvas = await buildExportCanvas();
      const link = document.createElement('a');
      const names = legislators.map(l => l.nombre).join('-').replace(/\s+/g, '_').slice(0, 60);
      link.download = `deuda-bcra-${names}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      setExportState('done');
    } catch (e) {
      console.error('Export failed', e);
      setExportState('idle');
    } finally {
      setTimeout(() => setExportState('idle'), 2000);
    }
  };

  const handleExportCopy = async () => {
    setExportState('loading');
    setShowExportMenu(false);
    try {
      const canvas = await buildExportCanvas();
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async blob => {
          if (!blob) { reject(new Error('No blob')); return; }
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(resolve).catch(reject);
        });
      });
      setExportState('done');
    } catch (e) {
      console.error('Copy failed', e);
      setExportState('idle');
    } finally {
      setTimeout(() => setExportState('idle'), 2000);
    }
  };

  const handleExportShare = async () => {
    setExportState('loading');
    setShowExportMenu(false);
    try {
      const canvas = await buildExportCanvas();
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async blob => {
          if (!blob) { reject(new Error('No blob')); return; }
          const file = new File([blob], 'deuda-bcra.png', { type: 'image/png' });
          navigator.share({ files: [file], title: 'Deuda BCRA · Central de Deudores', url: window.location.href })
            .then(resolve).catch(reject);
        });
      });
      setExportState('done');
    } catch (e) {
      console.error('Share failed', e);
      setExportState('idle');
    } finally {
      setTimeout(() => setExportState('idle'), 2000);
    }
  };

  useEffect(() => {
    if (!milestoneHint) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('[data-milestone-hint="true"]')) return;
      if (target.closest('[data-milestone-icon="true"]')) return;
      setMilestoneHint(null);
      setActiveMilestoneKey(null);
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [milestoneHint]);

  const renderXAxisTick = (props: XAxisTickProps) => {
    const { x = 0, y = 0, payload } = props;
    const numericX = typeof x === 'number' ? x : Number(x) || 0;
    const numericY = typeof y === 'number' ? y : Number(y) || 0;
    const label = xAxisTickFormatter(payload?.value || '');
    const lines = String(label).split('\n');

    return (
      <text x={numericX} y={numericY + 10} textAnchor="middle" fontSize={10} fill="#4b5563">
        {lines.map((line: string, index: number) => (
          <tspan key={index} x={numericX} dy={index === 0 ? 0 : 12}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

  const MilestoneLabel = (props: MilestoneLabelProps) => {
    const { x, text, color, milestoneKey, viewBox } = props;
    // Recharts no siempre entrega `x` en labels custom de ReferenceLine; usamos fallback para mantener alineación.
    const resolvedX = [x, viewBox?.x, viewBox?.cx].find((v) => typeof v === 'number');
    if (typeof resolvedX !== 'number') return null;

    // Ubicamos el ícono en la franja superior, fuera del área de barras.
    const topY = 18;
    const iconColor = color || '#0b5cff';
    const isActive = activeMilestoneKey === milestoneKey;

    return (
      <g
        transform={`translate(${resolvedX}, ${topY})`}
        cursor="pointer"
        data-milestone-icon="true"
        onClick={(e: ReactMouseEvent<SVGGElement>) => {
          e.stopPropagation();
          if (activeMilestoneKey === milestoneKey) {
            setMilestoneHint(null);
            setActiveMilestoneKey(null);
            return;
          }
          const rect = chartContainerRef.current?.getBoundingClientRect();
          const clickX = rect ? e.clientX - rect.left : resolvedX;
          setMilestoneHint({ text, x: clickX });
          setActiveMilestoneKey(milestoneKey);
        }}
        style={{ userSelect: 'none' }}
      >
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={isActive ? 18 : 17}
          fontWeight={isActive ? 900 : 700}
          fill={iconColor}
          stroke={isActive ? iconColor : 'none'}
          strokeWidth={isActive ? 0.6 : 0}
          data-milestone-icon="true"
        >
          ⚑
        </text>
      </g>
    );
  };

  const MilestoneHintRow = () => {
    if (!milestoneHint) return null;

    const containerWidth = chartContainerRef.current?.clientWidth ?? 0;
    const clampedLeft = containerWidth > 0
      ? Math.max(12, Math.min(milestoneHint.x, containerWidth - 12))
      : milestoneHint.x;
    const hintStyle = getMilestoneChipStyle(activeMilestoneKey ? verticalMilestones.find((m, idx) => `${m.fecha}-${m.texto}-${idx}` === activeMilestoneKey)?.color : undefined);

    return (
      <div
        className={`${isMobile ? 'h-6 w-full overflow-hidden' : 'absolute top-0 z-30 w-max max-w-[calc(100%-1rem)]'}`}
        data-milestone-hint="true"
        onClick={(e) => e.stopPropagation()}
        style={isMobile ? undefined : { left: clampedLeft, transform: 'translateX(-50%)' }}
      >
        <div
          className={`rounded border font-semibold flex items-center gap-1 w-full ${isMobile ? 'px-1.5 py-0.5 text-[11px] leading-none' : 'px-2 py-1 text-xs'}`}
          style={hintStyle}
        >
          <Flag size={isMobile ? 9 : 11} className="shrink-0" />
          <span className={`${isMobile ? 'truncate' : ''}`}>{milestoneHint.text}</span>
          <button
            type="button"
            className={`ml-auto shrink-0 font-bold leading-none ${isMobile ? 'text-[11px]' : ''}`}
            aria-label="Cerrar hito"
            onClick={(e) => {
              e.stopPropagation();
              setMilestoneHint(null);
              setActiveMilestoneKey(null);
            }}
            style={{ color: hintStyle.color }}
          >
            ×
          </button>
        </div>
      </div>
    );
  };


  const yAxisTickFormatter = (value: number) => {
    if (value === 0) return '';

    if (currencyMode === 'usd') {
      if (Math.abs(value) >= 1000000) {
        return `US$${(value / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
      }
      if (Math.abs(value) >= 1000) {
        return `US$${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}k`;
      }
      return `US$${value.toLocaleString('es-AR')}`;
    } else { // ARS (nominal o real), value está en miles de pesos.
      if (Math.abs(value) >= 1000000) { // 1,000,000k = 1B
        return `$${(value / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}B`;
      }
      if (Math.abs(value) >= 1000) { // 1,000k = 1M
        return `$${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
      }
      if (value > 0) {
        return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}k`;
      }
      return '';
    }
  };

  if (legislators.length === 0) return (
    <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 h-full">
      <div className="max-w-md w-full">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Central de Deudores</h2>
        <p className="text-gray-600 mb-6 text-sm leading-relaxed">
          Explorá los registros de deuda de legisladores y funcionarios del Estado argentino
          según el BCRA. Los datos muestran el total informado cada mes por los bancos,
          lo que usualmente representa gastos de tarjeta de crédito u otros créditos.
        </p>
        <div className="space-y-3 mb-6">
          <div className="flex items-start gap-3">
            <span className="bg-blue-100 text-blue-700 font-bold rounded-full w-6 h-6 flex items-center justify-center text-sm shrink-0 mt-0.5">1</span>
            <p className="text-sm text-gray-700">Buscá un funcionario o legislador en la lista de la izquierda</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="bg-blue-100 text-blue-700 font-bold rounded-full w-6 h-6 flex items-center justify-center text-sm shrink-0 mt-0.5">2</span>
            <p className="text-sm text-gray-700">Hacé click para ver su historial de deuda en el gráfico</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="bg-blue-100 text-blue-700 font-bold rounded-full w-6 h-6 flex items-center justify-center text-sm shrink-0 mt-0.5">3</span>
            <p className="text-sm text-gray-700">Seleccioná hasta 4 personas para comparar</p>
          </div>
        </div>
      </div>
    </div>
  );

  const formatMoney = (val: number) => {
    if (currencyMode === 'usd') return `US$ ${new Intl.NumberFormat('es-AR').format(Math.round(val))}`;
    return `$${new Intl.NumberFormat('es-AR').format(Math.round(val * 1000))}`;
  };

  // Tooltip Personalizado con Hitos
  const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: readonly TooltipPayloadItem[], label?: string | number }) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div className="bg-white p-3 border shadow-lg rounded text-xs z-50 max-w-xs">
        <p className="font-bold mb-1">{label}</p>

        {visibleLegislators.map((l, idx) => {
          const lPayloads = payload.filter((p) => p.dataKey.startsWith(l.cuit + SEP));
          if (lPayloads.length === 0) return null;
          const total = lPayloads.reduce((sum, p) => sum + (p.value || 0), 0);
          const banks = lPayloads[0].payload.banks[l.cuit] || { propio: [], familiares: {} };

          const personalMilestones = (l.hitos_personales || []).filter(h => h.fecha === label);
          const relevantGlobalMilestones = globalMilestones.filter(m =>
            m.fecha === label && (
              ['global', 'voto', 'politico'].includes(m.tipo || '') ||
              teniaCargo(l, m.tipo, m.fecha)
            )
          );
          const milestones = [
            ...personalMilestones.map(m => ({ ...m, displayColor: l.color || COLORS[idx % COLORS.length] })),
            ...relevantGlobalMilestones.map(m => ({ ...m, displayColor: m.color || (visibleLegislators.length === 1 ? (l.color || COLORS[idx % COLORS.length]) : GRAY) })),
          ];
          const familiarEntries = Object.entries(banks.familiares as { [parentesco: string]: Bank[] });

          return (
            <div key={l.cuit} className="mb-2 border-b pb-1 last:border-0">
              <p className="font-bold text-sm" style={{ color: l.color || COLORS[idx % COLORS.length] }}>
                {l.nombre}: {formatMoney(total)}
              </p>
              {milestones.map((m, i) => (
                <div
                  key={i}
                  className="mb-1 p-1 rounded border font-semibold flex items-center gap-1"
                  style={getMilestoneChipStyle(m.displayColor)}
                >
                    <Flag size={10} /> {m.texto}
                </div>
              ))}
              {/* Deuda propia */}
              {(banks.propio.length > 0) && (
                <div className="mt-1">
                  {includeFamiliares && familiarEntries.length > 0 && (
                    <p className="font-semibold opacity-60 uppercase tracking-wide" style={{ fontSize: 9 }}>Titular</p>
                  )}
                  <div className="pl-1">
                    {banks.propio.map((b: Bank, i: number) => {
                      const color = segmentColors.get(`${l.cuit}${SEP}propio${SEP}${b.entidad}`);
                      return (
                        <div key={i} className="flex items-center gap-1 opacity-80">
                          <span className="shrink-0 w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                          {b.entidad}: {formatMoney(b.monto)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Deuda familiares */}
              {familiarEntries.map(([parentesco, records]) => (
                <div key={parentesco} className="mt-1">
                  <p className="font-semibold opacity-60 uppercase tracking-wide flex items-center gap-1" style={{ fontSize: 9 }}>
                    <Users size={9} /> {parentesco}
                  </p>
                  <div className="pl-1">
                    {records.map((b: Bank, i: number) => {
                      const color = segmentColors.get(`${l.cuit}${SEP}${parentesco}${SEP}${b.entidad}`);
                      return (
                        <div key={i} className="flex items-center gap-1 opacity-80">
                          <span className="shrink-0 w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                          {b.entidad}: {formatMoney(b.monto)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 p-2 md:p-6 bg-gray-50 flex flex-col h-full">
      <div className="bg-white p-2 md:p-4 rounded-lg shadow-sm mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
          <h2 className="text-xl font-bold">Comparativa</h2>
          {!isMobile && onShowHelp && (
            <button onClick={onShowHelp} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors" title="Ayuda">
              <HelpCircle size={18} />
            </button>
          )}
          <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
            {copied && <span className="text-sm text-green-600 font-semibold animate-pulse mr-2">¡Link copiado!</span>}
            {onShare && (
              <button
                onClick={onShare}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors hidden md:block"
                title="Compartir link"
              >
                <Share2 size={18} />
              </button>
            )}
            <div className="relative" data-export-menu>
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="hidden md:block p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
                style={{ color: exportState === 'done' ? '#22c55e' : '#6b7280' }}
                title="Exportar imagen"
                disabled={exportState === 'loading'}
              >
                {exportState === 'loading' ? <Loader2 size={18} className="animate-spin" /> :
                 exportState === 'done' ? <Check size={18} /> :
                 <Camera size={18} />}
              </button>
              {showExportMenu && (
                <div className="fixed top-14 right-2 md:absolute md:top-10 md:right-0 bg-white border border-gray-200 shadow-lg rounded-lg z-50 py-1 min-w-44" data-export-menu>
                  <button onClick={handleExportDownload} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                    <Download size={14} /> Descargar imagen
                  </button>
                  <button onClick={handleExportCopy} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                    <Copy size={14} /> Copiar imagen
                  </button>
                  {typeof navigator !== 'undefined' && 'canShare' in navigator && (
                    <button onClick={handleExportShare} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                      <Share2 size={14} /> Compartir imagen
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label
                htmlFor="include-familiares"
                className="flex items-center gap-2 text-xs text-gray-700 whitespace-nowrap px-2 py-1 rounded border border-gray-300 bg-gray-50"
                title="Incluir deuda de familiares"
              >
                <input
                  id="include-familiares"
                  type="checkbox"
                  checked={includeFamiliares}
                  onChange={() => onToggleFamiliares?.()}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                Incluir familiares
              </label>
              <select
                value={currencyMode}
                onChange={e => setCurrencyMode(e.target.value as CurrencyMode)}
                className="min-w-0 flex-1 text-xs border border-gray-300 rounded px-2 py-1 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 outline-none sm:flex-none"
              >
                <option value="nominal">Pesos (Nominal)</option>
                {ipc && <option value="real">Pesos (Ajustado por inflación a precios de {ipcDates.length > 0 ? ipcDates[ipcDates.length - 1] : ''})</option>}
                {mep && <option value="usd">Dólares (MEP)</option>}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
          {legislators.map((l, idx) => {
            const cardColor = l.color || COLORS[idx % COLORS.length];
            return (
            <div
              key={l.cuit}
              className="flex items-center gap-2 p-2 rounded shrink-0 w-[75vw] max-w-[360px] md:w-auto"
              style={{ border: `1px solid ${cardColor}`, backgroundColor: withAlpha(cardColor, 0.2) }}
            >
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onRemove && onRemove(l)}
                  title="Quitar"
                  className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X size={15} />
                </button>
                <button
                  onClick={() => onToggleVisibility?.(l.cuit)}
                  title={hiddenIds.has(l.cuit) ? 'Mostrar en gráfico' : 'Ocultar en gráfico'}
                  className={`transition-colors cursor-pointer ${hiddenIds.has(l.cuit) ? 'text-gray-300 hover:text-gray-500' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {hiddenIds.has(l.cuit) ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="min-w-0 max-w-full">
                <div className={`font-bold text-sm flex items-center gap-1 min-w-0 ${hiddenIds.has(l.cuit) ? 'text-gray-400' : ''}`}>
                  <span className="truncate">{l.nombre}</span>
                  {l.familiares && l.familiares.length > 0 && (
                    <span title="Tiene datos de familiares" className="flex">
                      <Users size={13} className="text-blue-400 shrink-0" />
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1 min-w-0 flex-wrap">
                  {l.cargo && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full shrink-0">{l.cargo}</span>}
                  {l.es_candidato && <span title="Candidato: aún no ocupa el cargo" className="text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full shrink-0">Candidato</span>}
                  {l.partido && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{l.partido}</span>}
                  {l.distrito && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{l.distrito}</span>}
                  {l.unidad && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{l.unidad}</span>}
                  {l.organo && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full truncate max-w-[35vw]">{abbreviateOrgano(l.organo)}</span>}
                  {l.situacion_bcra !== undefined && (
                    <span
                      title="Situación en el BCRA (Central de Deudores)"
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: SITUACION_BCRA[l.situacion_bcra]?.color ?? '#9ca3af', color: '#fff' }}
                    >
                      {SITUACION_BCRA[l.situacion_bcra]?.label ?? `Sit. ${l.situacion_bcra}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="relative flex-1 min-h-48 md:bg-white md:p-4 md:rounded-lg md:shadow-sm"
        onClick={() => {
          setMilestoneHint(null);
          setActiveMilestoneKey(null);
        }}
      >
        <div className="h-full flex flex-col">
          <div className={`relative px-2 mb-1 shrink-0 ${isMobile ? 'h-6' : 'h-7'}`}>
            <MilestoneHintRow />
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 30, right: 0, left: -30, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={renderXAxisTick}
              height={40}
              interval={xAxisInterval}
              tickFormatter={xAxisTickFormatter}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={yAxisTickFormatter}
              axisLine={false}
              tickLine={false}
              tick={{
                fontSize: 11,
                textAnchor: 'start',
                dx: 10,
                fill: '#111',
                stroke: '#fff',
                strokeWidth: 3,
                paintOrder: 'stroke fill',
              }}
              width={30}
            />
            <Tooltip content={CustomTooltip} />

            {visibleLegislators.flatMap((l, idx) => {
              const propioKeys = [...barSegments.entries()]
                .filter(([, v]) => v.cuit === l.cuit && !v.isFamiliar)
                .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
                .map(([key]) => key);
              const familiaresKeys = [...barSegments.entries()]
                .filter(([, v]) => v.cuit === l.cuit && v.isFamiliar)
                .sort((a, b) => b[1].totalMonto - a[1].totalMonto)
                .map(([key]) => key);
              return [...propioKeys, ...familiaresKeys].map(key => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId={l.cuit}
                  fill={segmentColors.get(key) || l.color || COLORS[idx % COLORS.length]}
                  isAnimationActive={false}
                />
              ));
            })}

            {/* RENDERIZADO DE TODOS LOS HITOS */}
            {verticalMilestones.map((m, idx) => (
              <ReferenceLine
                key={`vert-${idx}`}
                x={m.fecha}
                stroke={m.color}
                strokeDasharray="4 2"
                label={<MilestoneLabel text={m.texto} color={m.color} milestoneKey={`${m.fecha}-${m.texto}-${idx}`} />}
              />
            ))}

            {economicMilestones.map((m, idx) => (
              <ReferenceDot
                key={`eco-${idx}`}
                x={m.fecha}
                y={m.convertedMonto}
                shape={<CustomEconomicMarker color={m.color} />}
              />
            ))}
            <Brush dataKey="date" height={25} stroke={GRAY} tickFormatter={() => ''} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
});

export default DebtChart;
