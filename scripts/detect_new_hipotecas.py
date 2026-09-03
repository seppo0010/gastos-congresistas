#!/usr/bin/env python3
"""
Detect legislators who newly acquired a hipotecario (mortgage) credit
or whose situacion_bcra changed, by comparing two legisladores_enrich_final_*.json files.

Usage:
    python detect_new_hipotecas.py <old_file.json> <new_file.json>
"""

import json
import sys


def load_by_cuit(path):
    with open(path) as f:
        data = json.load(f)
    return {leg["cuit"]: leg for leg in data["data"]}


def main():
    if len(sys.argv) != 3:
        print("Usage:", sys.argv[0], "<old_file.json> <new_file.json>")
        sys.exit(1)

    old_path, new_path = sys.argv[1], sys.argv[2]
    old = load_by_cuit(old_path)
    new = load_by_cuit(new_path)

    new_hipotecas = []
    situacion_changes = []

    for cuit, new_leg in new.items():
        old_leg = old.get(cuit)
        info = {
            "cuit": cuit,
            "nombre": new_leg["nombre"],
            "cargo": new_leg.get("cargo"),
            "partido": new_leg.get("partido"),
            "distrito": new_leg.get("distrito"),
        }

        # --- Hipoteca detection ---
        new_hip = new_leg.get("hipoteca_bcra", {})
        old_hip = (old_leg or {}).get("hipoteca_bcra", {})
        if new_hip.get("tiene") and not old_hip.get("tiene"):
            new_hipotecas.append({
                **info,
                "estado": "nuevo_legislador" if old_leg is None else "hipoteca_nueva",
                "hipoteca": new_hip,
            })

        # --- Situacion change detection ---
        if old_leg is not None:
            old_sit = old_leg.get("situacion_bcra")
            new_sit = new_leg.get("situacion_bcra")
            if old_sit != new_sit:
                situacion_changes.append({
                    **info,
                    "situacion_anterior": old_sit,
                    "situacion_nueva": new_sit,
                })

    new_hipotecas.sort(key=lambda r: r["nombre"])
    situacion_changes.sort(key=lambda r: r["nombre"])

    print(f"=== New hipotecario credits: {len(new_hipotecas)} ===\n")
    for r in new_hipotecas:
        hip = r["hipoteca"]
        monto = hip.get("monto_miles_pesos")
        monto_str = f"${monto:,.0f}k ARS" if monto is not None else "monto desconocido"
        entidades = ", ".join(hip.get("entidades", []))
        fecha = hip.get("fecha", "")
        print(f"  [{r['estado']}] {r['nombre']} ({r['cargo']}, {r['partido']}, {r['distrito']})")
        print(f"    Desde: {fecha} | Monto: {monto_str} | Entidades: {entidades}")

    print(f"\n=== Situacion BCRA changes: {len(situacion_changes)} ===\n")
    for r in situacion_changes:
        print(
            f"  {r['nombre']} ({r['cargo']}, {r['partido']}, {r['distrito']}): "
            f"{r['situacion_anterior']} → {r['situacion_nueva']}"
        )

    output = {
        "nuevas_hipotecas": new_hipotecas,
        "cambios_situacion": situacion_changes,
    }
    print("\n" + json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
