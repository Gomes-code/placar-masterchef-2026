"""Lê as planilhas de Dados/*.xlsx (aba 'Placar') e atualiza data.js com todas as edições.

Uso:
    py scripts/extrair_dados.py                 # todas as planilhas de Dados/
    py scripts/extrair_dados.py caminho.xlsx    # só uma planilha

Cada planilha vira uma edição. O nome vem do arquivo:
    "TABELA MASTERCHEF 2026.xlsx"  ->  "MasterChef 2026" (id: masterchef-2026)
Edições que já estão em data.js e não vieram de planilha (criadas pelo app) são mantidas.
"""
import json
import re
import sys
import unicodedata
import warnings
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "data.js"


def slug(text):
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-") or "edicao"


def title_from_file(path):
    name = re.sub(r"^\s*tabela\s+", "", path.stem, flags=re.I).strip()
    name = " ".join(w.capitalize() for w in name.split())
    return re.sub(r"masterchef", "MasterChef", name, flags=re.I)


def tc(s):
    s = str(s or "").strip().lower()
    return re.sub(r"(^|\s|-)(\S)", lambda m: m.group(1) + m.group(2).upper(), s)


def find(ws, pattern):
    rx = re.compile(pattern, re.I)
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and rx.search(c.value.strip()):
                return c.row, c.column
    return None


def read_workbook(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = next((wb[n] for n in wb.sheetnames if "placar" in n.lower()), wb.worksheets[0])
    pins = find(ws, r"^PINS$")
    week1 = find(ws, r"^SEMANA 0?1$")
    if not pins or not week1:
        raise ValueError(f"{path.name}: não encontrei as colunas PINS e SEMANA 01 na aba Placar")
    head_row, name_col, first_col = pins[0], pins[1] - 1, week1[1]

    weeks = []
    col = first_col
    while True:
        label = ws.cell(week1[0], col).value
        if not label or (str(label).strip().upper() == "SEMANA" and col > first_col + 2):
            break
        weeks.append({"label": tc(label), "provas": [tc(ws.cell(head_row, col).value), tc(ws.cell(head_row, col + 1).value)]})
        col += 2

    competitors = []
    for r in range(head_row + 1, ws.max_row + 1):
        name = ws.cell(r, name_col).value
        if not isinstance(name, str) or not name.strip():
            continue
        res = []
        for i in range(len(weeks) * 2):
            v = ws.cell(r, first_col + i).value
            res.append("0" if v in (None, 0, "0", "") else str(v).strip().upper())
        competitors.append({"name": name.strip(), "results": res})

    scoring = []
    tab = find(ws, r"TABELA DE PONTUA")
    if tab:
        for r in range(tab[0] + 1, ws.max_row + 1):
            code, pts = ws.cell(r, tab[1] + 3).value, ws.cell(r, tab[1] + 4).value
            if code is None or not isinstance(pts, (int, float)):
                continue
            label = str(ws.cell(r, tab[1]).value or code).strip().replace("EIMINADO", "ELIMINADO")
            scoring.append({"code": str(code).strip().upper(), "label": label, "pts": pts})

    title = title_from_file(path)
    return {"id": slug(title), "title": title, "source": path.name, "weeks": weeks, "scoring": scoring, "competitors": competitors}


def load_bundle():
    if not DATA_JS.exists():
        return {"default": None, "editions": []}
    text = DATA_JS.read_text(encoding="utf-8")
    body = text[text.index("=") + 1:].strip().rstrip(";")
    obj = json.loads(body)
    if "editions" not in obj:  # formato antigo: uma edição só
        obj = {"default": "masterchef-2026", "editions": [{"id": "masterchef-2026", "title": "MasterChef 2026", **obj}]}
    return obj


def main():
    files = [Path(a) for a in sys.argv[1:]] or sorted((ROOT / "Dados").glob("*.xls*"))
    files = [f for f in files if not f.name.startswith("~$")]
    bundle = load_bundle()
    by_id = {e["id"]: e for e in bundle["editions"]}
    for f in files:
        ed = read_workbook(f)
        by_id[ed["id"]] = ed
        print(f"{f.name}: {ed['title']} — {len(ed['competitors'])} competidores, {len(ed['weeks'])} semanas, {len(ed['scoring'])} códigos")
    order = [e["id"] for e in bundle["editions"]] + [i for i in by_id if i not in {e["id"] for e in bundle["editions"]}]
    bundle["editions"] = [by_id[i] for i in order]
    if not bundle.get("default") or bundle["default"] not in by_id:
        bundle["default"] = bundle["editions"][-1]["id"] if bundle["editions"] else None
    DATA_JS.write_text(
        "// Gerado por scripts/extrair_dados.py (ou exportado pelo app). Todas as edições do placar.\n"
        "window.MASTERCHEF_EDITIONS = " + json.dumps(bundle, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"data.js atualizado: {len(bundle['editions'])} edição(ões), padrão = {bundle['default']}")


if __name__ == "__main__":
    main()
