"""Converte a aba 'Placar' da planilha do MasterChef em data.js para o web app."""
import json, sys, warnings
from pathlib import Path
import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "Dados" / "TABELA MASTERCHEF 2026.xlsx"
ws = openpyxl.load_workbook(xlsx, data_only=True)["Placar"]

first, last = column_index_from_string("H"), column_index_from_string("AK")
weeks = []
for col in range(first, last + 1, 2):
    label = ws.cell(1, col).value or f"SEMANA {len(weeks)+1:02d}"
    provas = [str(ws.cell(2, c).value or "").strip() for c in (col, col + 1)]
    weeks.append({"label": str(label).strip().title(), "provas": [p.title() for p in provas]})

competitors = []
for r in range(3, ws.max_row + 1):
    name = ws.cell(r, 4).value
    if not name:
        continue
    res = []
    for c in range(first, last + 1):
        v = ws.cell(r, c).value
        v = "0" if v in (None, 0, "0") else str(v).strip().upper()
        res.append(v)
    competitors.append({"name": str(name).strip(), "results": res})

scoring = []
for r in range(2, 30):
    code, pts = ws.cell(r, column_index_from_string("AS")).value, ws.cell(r, column_index_from_string("AT")).value
    if code is None:
        continue
    label = str(ws.cell(r, column_index_from_string("AP")).value or code).strip().replace("EIMINADO", "ELIMINADO")
    scoring.append({"code": str(code).strip().upper(), "label": label, "pts": pts})

data = {"source": xlsx.name, "weeks": weeks, "scoring": scoring, "competitors": competitors}
out = ROOT / "data.js"
out.write_text("// Gerado por scripts/extrair_dados.py a partir da planilha. Não editar à mão.\n"
               "window.MASTERCHEF_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
print(f"{len(competitors)} competidores, {len(weeks)} semanas, {len(scoring)} códigos -> {out}")
