import json
import difflib
from collections import defaultdict
import os

# Cargar tu base de datos generada
INPUT_FILE = 'legisladores_full.json'

def analizar_duplicados(json_path):
    if not os.path.exists(json_path):
        print(f"No se encontró el archivo {json_path}")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        db = json.load(f)

    # Si el JSON tiene estructura {meta:..., data:...}, usamos data. Si es lista directa, usamos lista.
    legisladores = db.get('data', []) if isinstance(db, dict) else db
    
    reporte_general = []

    print(f"Analizando {len(legisladores)} legisladores en busca de anomalías...\n")

    for leg in legisladores:
        # Agrupar deudas por FECHA
        # mes -> { monto_X: [entidad_A, entidad_B], monto_Y: [entidad_C] }
        timeline = defaultdict(lambda: defaultdict(list))
        
        for record in leg['historial']:
            fecha = record['fecha']
            monto = record['monto']
            entidad = record['entidad']
            
            # Solo nos interesan montos mayores a 0 para evitar falsos positivos con deudas saldadas
            if monto > 0:
                timeline[fecha][monto].append(entidad)

        # Buscar colisiones en cada mes
        for fecha, montos_map in timeline.items():
            for monto, entidades in montos_map.items():
                # Si hay más de 1 entidad reclamando EL MISMO monto en EL MISMO mes
                if len(entidades) > 1:
                    
                    # Comparar nombres para ver si es el mismo banco disfrazado
                    # Tomamos el primer par para comparar (simplificación)
                    entidad_1 = entidades[0]
                    entidad_2 = entidades[1]
                    
                    # Ratio de similitud (0 a 1). "Galicia S.A." y "Galicia S.A.U." darán > 0.8
                    similitud = difflib.SequenceMatcher(None, entidad_1, entidad_2).ratio()
                    
                    tipo_alerta = "COINCIDENCIA"
                    if similitud > 0.8:
                        tipo_alerta = "ERROR_NOMINAL" # Mismo banco, distinto nombre legal
                    elif similitud > 0.4:
                        tipo_alerta = "FUSION_POSIBLE" # Nombres parecidos
                    else:
                        tipo_alerta = "MONTO_DUPLICADO" # Distintos bancos, mismo monto exacto (Raro)

                    reporte_general.append({
                        "legislador": leg['nombre'],
                        "cuit": leg['cuit'],
                        "fecha": fecha,
                        "monto": monto,
                        "entidades": entidades,
                        "tipo": tipo_alerta,
                        "score_similitud": round(similitud, 2)
                    })

    # --- IMPRIMIR REPORTE ---
    if not reporte_general:
        print("✅ No se encontraron duplicados sospechosos.")
        return

    # Ordenar por importancia (Errores nominales primero)
    reporte_general.sort(key=lambda x: x['score_similitud'], reverse=True)

    print(f"⚠️ SE ENCONTRARON {len(reporte_general)} CASOS SOSPECHOSOS:\n")
    
    for caso in reporte_general:
        icon = "🔴" if caso['tipo'] == "ERROR_NOMINAL" else "🟠" if caso['tipo'] == "FUSION_POSIBLE" else "❓"
        
        print(f"{icon} [{caso['tipo']}] {caso['legislador']} ({caso['fecha']})")
        print(f"   Monto: ${caso['monto']:,}")
        print(f"   Entidades en conflicto: {caso['entidades']}")
        if caso['tipo'] == "ERROR_NOMINAL":
            print(f"   >> Diagnóstico: Probablemente es el mismo banco. Se recomienda unificar.")
        print("-" * 60)

if __name__ == "__main__":
    analizar_duplicados(INPUT_FILE)