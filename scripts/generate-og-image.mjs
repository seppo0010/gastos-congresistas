import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const TITLE = "¿Cuánto deben?";
const SITE_URL = "https://cuantodeben.visualizando.ar";
const SURFACE = "#f5f5f4";
const PANEL = "#ffffff";
const BORDER = "#d6d3d1";
const TEXT = "#18181b";
const MUTED = "#52525b";
const STRIPES = ["#2563eb", "#dc2626", "#16a34a", "#d97706"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const require = createRequire(import.meta.url);

function monthLabel(isoMonth) {
  if (!isoMonth) return "Sin datos";

  const [year, month] = isoMonth.split("-");
  const months = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const index = Number(month) - 1;

  if (!year || Number.isNaN(index) || index < 0 || index > 11) {
    return isoMonth;
  }

  return `${months[index]} ${year}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-AR").format(value);
}

async function readBundledFont(packagePath) {
  return fs.readFile(require.resolve(packagePath));
}

async function readJson(filename) {
  const input = await fs.readFile(path.join(publicDir, filename), "utf8");
  return JSON.parse(input);
}

async function loadMetrics() {
  const [legisladoresData, politicosData, judicialData] = await Promise.all([
    readJson("legisladores_full.json"),
    readJson("politicos_full.json"),
    readJson("judicial_full.json"),
  ]);

  const legisladores = legisladoresData.data;
  const politicos = politicosData.data;
  const judiciales = judicialData.data;

  const politicosByCuit = new Map(
    politicos.map((persona) => [persona.cuit, persona]),
  );
  const mergedLegisladores = legisladores.map((persona) => {
    const politico = politicosByCuit.get(persona.cuit);
    return politico ? { ...persona, unidad: politico.unidad } : persona;
  });

  const legisladoresCuits = new Set(
    legisladores.map((persona) => persona.cuit),
  );
  const ejecutivos = politicos.filter(
    (persona) => !legisladoresCuits.has(persona.cuit),
  );
  const ejecutivosCuits = new Set(politicos.map((persona) => persona.cuit));
  const judicialesSolo = judiciales.filter(
    (persona) =>
      !legisladoresCuits.has(persona.cuit) &&
      !ejecutivosCuits.has(persona.cuit),
  );
  const combined = [...mergedLegisladores, ...ejecutivos, ...judicialesSolo];

  let latestMonth = "";
  let familiares = 0;

  for (const persona of combined) {
    for (const registro of persona.historial || []) {
      if (registro.fecha > latestMonth) latestMonth = registro.fecha;
    }

    for (const familiar of persona.familiares || []) {
      familiares += 1;
      for (const registro of familiar.historial || []) {
        if (registro.fecha > latestMonth) latestMonth = registro.fecha;
      }
    }
  }

  return {
    combinedCount: combined.length,
    latestMonthLabel: monthLabel(latestMonth),
    familiaresCount: familiares,
    legislativoCount: legisladores.length,
    ejecutivoCount: ejecutivos.length,
    judicialCount: judicialesSolo.length,
  };
}

function buildImage(metrics) {
  const rowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "18px 0",
    borderBottom: `1px solid ${BORDER}`,
  };

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        width: `${IMAGE_WIDTH}px`,
        height: `${IMAGE_HEIGHT}px`,
        backgroundColor: SURFACE,
        color: TEXT,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "780px",
          padding: "56px 56px 52px 56px",
          borderRight: `1px solid ${BORDER}`,
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              fontSize: 17,
              color: MUTED,
              marginBottom: 28,
            },
          },
          SITE_URL.replace("https://", ""),
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: 96,
              lineHeight: 0.94,
              fontWeight: 700,
              letterSpacing: "-0.06em",
              marginBottom: 24,
            },
          },
          TITLE,
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: 29,
              lineHeight: 1.25,
              color: TEXT,
              maxWidth: "600px",
              marginBottom: 18,
            },
          },
          "Deuda de funcionarios y legisladores nacionales con series historicas del BCRA y cruces con declaraciones juradas.",
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: 22,
              lineHeight: 1.35,
              color: MUTED,
              maxWidth: "600px",
            },
          },
          "Explorador publico para comparar personas, seguir la evolucion mensual y revisar familiares declarados.",
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 22,
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              gap: 8,
            },
          },
          ...STRIPES.map((color, index) =>
            React.createElement("div", {
              key: `${color}-${index}`,
              style: {
                width: 42,
                height: 8,
                backgroundColor: color,
              },
            }),
          ),
        ),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "420px",
          padding: "56px 88px 40px 40px",
          position: "relative",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            display: "flex",
          },
        },
        ...STRIPES.map((color, index) =>
          React.createElement("div", {
            key: `${color}-column-${index}`,
            style: {
              width: 14,
              height: "100%",
              backgroundColor: color,
              opacity: index === STRIPES.length - 1 ? 0.95 : 0.8,
            },
          }),
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 20,
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              backgroundColor: PANEL,
              border: `1px solid ${BORDER}`,
              padding: "28px 28px 24px 28px",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: 17,
                color: MUTED,
                marginBottom: 10,
              },
            },
            "Personas relevadas",
          ),
          React.createElement(
            "div",
            {
              style: {
                fontSize: 64,
                lineHeight: 1,
                fontWeight: 700,
                letterSpacing: "-0.05em",
              },
            },
            formatNumber(metrics.combinedCount),
          ),
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              backgroundColor: PANEL,
              border: `1px solid ${BORDER}`,
              padding: "0 28px",
            },
          },
          React.createElement(
            "div",
            { style: rowStyle },
            React.createElement(
              "div",
              { style: { fontSize: 18, color: MUTED } },
              "Ultimo mes",
            ),
            React.createElement(
              "div",
              { style: { fontSize: 24, fontWeight: 700 } },
              metrics.latestMonthLabel,
            ),
          ),
          React.createElement(
            "div",
            { style: rowStyle },
            React.createElement(
              "div",
              { style: { fontSize: 18, color: MUTED } },
              "Legislativo",
            ),
            React.createElement(
              "div",
              { style: { fontSize: 24, fontWeight: 700 } },
              formatNumber(metrics.legislativoCount),
            ),
          ),
          React.createElement(
            "div",
            { style: rowStyle },
            React.createElement(
              "div",
              { style: { fontSize: 18, color: MUTED } },
              "Ejecutivo",
            ),
            React.createElement(
              "div",
              { style: { fontSize: 24, fontWeight: 700 } },
              formatNumber(metrics.ejecutivoCount),
            ),
          ),
          React.createElement(
            "div",
            {
              style: {
                ...rowStyle,
                borderBottom: "none",
              },
            },
            React.createElement(
              "div",
              { style: { fontSize: 18, color: MUTED } },
              "Familiares declarados",
            ),
            React.createElement(
              "div",
              { style: { fontSize: 24, fontWeight: 700 } },
              formatNumber(metrics.familiaresCount),
            ),
          ),
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 17,
            color: MUTED,
          },
        },
        React.createElement("div", null, "Judicial"),
        React.createElement(
          "div",
          { style: { fontWeight: 700, color: TEXT } },
          formatNumber(metrics.judicialCount),
        ),
      ),
    ),
  );
}

async function main() {
  const [regularFont, boldFont, metrics] = await Promise.all([
    readBundledFont(
      "@fontsource/public-sans/files/public-sans-latin-400-normal.woff",
    ),
    readBundledFont(
      "@fontsource/public-sans/files/public-sans-latin-700-normal.woff",
    ),
    loadMetrics(),
  ]);

  const svg = await satori(buildImage(metrics), {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    fonts: [
      {
        name: "Public Sans",
        data: regularFont,
        weight: 400,
        style: "normal",
      },
      {
        name: "Public Sans",
        data: boldFont,
        weight: 700,
        style: "normal",
      },
    ],
  });

  const png = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: IMAGE_WIDTH,
    },
  })
    .render()
    .asPng();

  await fs.writeFile(path.join(publicDir, "og_image.png"), png);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
