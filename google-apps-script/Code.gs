/**
 * Placar MasterChef — ponte entre a planilha do Google e o site.
 *
 * Estrutura da planilha:
 *   Aba "Pontuação":  Código | Descrição | Pontos
 *   Aba "Edições":    Código | Nome | Padrão (x na edição que o site abre)
 *   Uma aba por edição, com o nome igual ao código (ex.: MC-2026), no modelo "Banco de Dados":
 *     linha 1:  (vazio) | (vazio)     | SEMANA 01  (2 colunas mescladas) | SEMANA 02 ...
 *     linha 2:  FOTO    | COMPETIDOR  | 1ª PROVA 1 | 2ª PROVA 1 | 1ª PROVA 2 | 2ª PROVA 2 ...
 *     linha 3+: foto    | nome        | código de cada prova
 *   - A linha 2 pode receber o nome real das provas (ex.: Duelos). "1ª PROVA 1" = prova sem nome.
 *   - Célula vazia = não disputou. "-" = fora da competição. Maiúscula ou minúscula, tanto faz.
 *   - FOTO (opcional): link da imagem ou =IMAGE("link").
 *
 * Instalação (uma vez): veja GOOGLE_SHEETS.md no projeto.
 */

// Troque pela sua senha. O site pede essa senha para criar edições e salvar resultados.
const ADMIN_KEY = "troque-esta-senha";

// Só preencha se o script NÃO foi aberto pela planilha (Extensões → Apps Script).
// É o trecho do link da planilha entre /d/ e /edit. Ex.: docs.google.com/spreadsheets/d/ESTE_TRECHO/edit
const SPREADSHEET_ID = "";

function ss_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Script sem planilha: abra-o pela planilha (Extensões → Apps Script) ou preencha SPREADSHEET_ID.");
  return ss;
}

const SCORING_SHEET = "Pontuação";
const EDITIONS_SHEET = "Edições";
const EDITION_RX = /^MC-/i;
const FIRST_COL = 3; // coluna C: primeira prova
const PLACEHOLDER_RX = /^\s*[12]\s*ª\s*PROVA(\s*\d+)?\s*$/i;

const DEFAULT_SCORING = [
  ["V", "Vitória individual", 10], ["VDP", "Vitória empate", 10], ["VR", "Venceu a repescagem", 10],
  ["VD", "Vitória em duelo", 9], ["VLE", "Vitória líder de equipe", 9], ["VE", "Vitória em equipe", 8],
  ["M", "Melhores", 7], ["VP", "Vitória em prova de pressão", 6], ["S", "Salvo", 5], ["PS", "Poder de salvar", 5],
  ["DS", "Dupla salva", 5], ["P", "Piores", 4], ["E", "Eliminado", 0], ["D", "Desistência", 0], ["I", "Imune", 0],
  ["PP", "Prova de pressão", -1], ["PE", "Prova de eliminação", -1], ["DE", "Derrota em equipe", -1],
  ["ED", "Eliminação direta", -2], ["DLE", "Derrota líder equipe", -2],
];

/* ---------------- entrada HTTP ---------------- */

function doGet() {
  return json_({ ok: true, data: readAll_() });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (req.key !== ADMIN_KEY) return json_({ ok: false, error: "Senha de administrador inválida." });
    const lock = LockService.getDocumentLock();
    lock.waitLock(20000);
    try {
      if (req.action === "saveEdition") saveEdition_(req.edition, !!req.createOnly);
      else if (req.action === "setDefault") setDefault_(req.id);
      else if (req.action !== "ping") return json_({ ok: false, error: "Ação desconhecida: " + req.action });
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true, data: readAll_() });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- leitura ---------------- */

function readAll_() {
  const ss = ss_();
  const scoring = readScoring_(ss);
  const meta = readEditionsMeta_(ss);
  const editions = ss.getSheets()
    .filter((sh) => EDITION_RX.test(sh.getName()))
    .map((sh) => readEdition_(sh, scoring, meta[sh.getName().toUpperCase()]));
  editions.sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
  const flagged = Object.keys(meta).find((k) => meta[k].isDefault && editions.some((e) => e.id.toUpperCase() === k));
  const def = flagged ? editions.find((e) => e.id.toUpperCase() === flagged).id : editions.length ? editions[editions.length - 1].id : null;
  return { default: def, editions: editions, updatedAt: new Date().toISOString() };
}

function readScoring_(ss) {
  const sh = ss.getSheetByName(SCORING_SHEET);
  const rows = sh ? sh.getDataRange().getValues().slice(1) : DEFAULT_SCORING;
  return rows
    .filter((r) => String(r[0]).trim() !== "" && r[2] !== "" && !isNaN(Number(r[2])))
    .map((r) => ({ code: String(r[0]).trim().toUpperCase(), label: String(r[1] || r[0]).trim(), pts: Number(r[2]) }));
}

function readEditionsMeta_(ss) {
  const sh = ss.getSheetByName(EDITIONS_SHEET);
  const out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach((r) => {
    const code = String(r[0]).trim();
    if (code) out[code.toUpperCase()] = { title: String(r[1] || "").trim(), isDefault: String(r[2]).trim() !== "" };
  });
  return out;
}

function readEdition_(sh, scoring, meta) {
  const range = sh.getDataRange();
  const v = range.getValues();
  const f = range.getFormulas();
  const head = v[0] || [], provas = v[1] || [];
  const width = Math.max(head.length, provas.length);
  const c0 = FIRST_COL - 1;

  // episódios: pares de colunas a partir de C; para no primeiro par sem cabeçalho e sem dados
  const weeks = [];
  for (let c = c0; c < width; c += 2) {
    const label = String(head[c] || "").trim();
    if (!label && !columnHasData_(v, c)) break;
    weeks.push({ label: weekLabel_(label, weeks.length + 1), provas: [provaName_(provas[c]), provaName_(provas[c + 1])] });
  }

  const competitors = [];
  for (let r = 2; r < v.length; r++) {
    const name = String(v[r][1] || "").trim();
    if (!name) continue;
    const results = [];
    for (let i = 0; i < weeks.length * 2; i++) results.push(cell_(v[r][c0 + i]));
    const c = { name: name, results: results };
    const photo = photoUrl_(v[r][0], f[r] && f[r][0]);
    if (photo) c.photo = photo;
    competitors.push(c);
  }
  const id = sh.getName();
  return {
    id: id,
    title: (meta && meta.title) || titleFromCode_(id),
    source: "Google Sheets",
    weeks: weeks,
    scoring: scoring,
    competitors: competitors,
  };
}

function columnHasData_(v, c) {
  for (let r = 2; r < v.length; r++) if (String(v[r][c] || "").trim() || String(v[r][c + 1] || "").trim()) return true;
  return false;
}

function weekLabel_(raw, n) {
  const s = String(raw || "").trim().replace(/^SEMENA/i, "SEMANA");
  if (!s) return "Semana " + pad_(n);
  return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function provaName_(raw) {
  const s = String(raw || "").trim();
  if (!s || PLACEHOLDER_RX.test(s)) return "";
  return s.toLowerCase().replace(/(^|\s|-)\S/g, (m) => m.toUpperCase());
}

function photoUrl_(value, formula) {
  const m = String(formula || "").match(/IMAGE\(\s*"([^"]+)"/i);
  if (m) return m[1];
  const s = String(value || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function cell_(x) {
  const s = String(x === null || x === undefined ? "" : x).trim().toUpperCase();
  if (s === "" || s === "0" || s === "·") return "0";
  if (s === "-" || s === "–" || s === "—") return "-";
  return s;
}

function titleFromCode_(code) {
  return String(code).replace(/^MC-?/i, "MasterChef ").trim();
}

function pad_(n) { return (n < 10 ? "0" : "") + n; }

/* ---------------- escrita ---------------- */

function saveEdition_(ed, createOnly) {
  if (!ed || !ed.id) throw new Error("Edição sem código.");
  const id = String(ed.id).trim().toUpperCase();
  if (!EDITION_RX.test(id)) throw new Error("O código precisa começar com MC- (ex.: MC-2027).");
  const ss = ss_();
  ensureScoringSheet_(ss);
  let sh = ss.getSheetByName(id);
  if (sh && createOnly) throw new Error("Já existe uma aba " + id + " na planilha.");
  const isNew = !sh;
  if (!sh) sh = ss.insertSheet(id);

  // guarda as fotos que já estavam na coluna A (por nome), para não perdê-las ao regravar
  const photos = {};
  if (!isNew) {
    const r = sh.getDataRange(), vals = r.getValues(), forms = r.getFormulas();
    for (let i = 2; i < vals.length; i++) {
      const nm = String(vals[i][1] || "").trim();
      if (nm) photos[nm] = forms[i][0] || vals[i][0] || "";
    }
  }

  const weeks = ed.weeks || [];
  const nCols = 2 + weeks.length * 2;
  const people = ed.competitors || [];
  const nRows = 2 + Math.max(people.length, 20); // deixa linhas livres para novos participantes
  const head = ["", ""], provas = ["FOTO", "COMPETIDOR"];
  weeks.forEach((w, i) => {
    head.push(String(w.label || "Semana " + pad_(i + 1)).toUpperCase(), "");
    provas.push((w.provas && w.provas[0]) || "1ª PROVA " + (i + 1), (w.provas && w.provas[1]) || "2ª PROVA " + (i + 1));
  });
  const values = [head, provas];
  for (let r = 0; r < nRows - 2; r++) {
    const c = people[r];
    const row = [c ? photos[c.name] || (c.photo ? '=IMAGE("' + c.photo + '")' : "") : "", c ? c.name : ""];
    for (let i = 0; i < weeks.length * 2; i++) {
      const k = c ? String(c.results[i] || "0") : "0";
      row.push(k === "0" ? "" : k);
    }
    values.push(row);
  }

  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.getRange(1, 1, values.length, nCols).setValues(values);
  formatEditionSheet_(ss, sh, weeks.length, nRows);
  upsertEditionMeta_(ss, id, ed.title || titleFromCode_(id));
  if (isNew) sh.activate();
}

function formatEditionSheet_(ss, sh, nWeeks, nRows) {
  const nCols = 2 + nWeeks * 2;
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
  sh.getRange(1, 1, 2, nCols).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.getRange(1, 1, 1, nCols).setBackground("#e7e5df");
  sh.getRange(2, 1, 1, nCols).setBackground("#f1f0ec").setWrap(true);
  sh.getRange(3, 2, nRows - 2, 1).setFontWeight("bold");
  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 140);
  sh.setRowHeights(3, nRows - 2, 34);
  if (!nWeeks) return;
  sh.setColumnWidths(FIRST_COL, nWeeks * 2, 82);
  for (let w = 0; w < nWeeks; w++) sh.getRange(1, FIRST_COL + w * 2, 1, 2).merge();
  const data = sh.getRange(3, FIRST_COL, nRows - 2, nWeeks * 2);
  data.setHorizontalAlignment("center").setVerticalAlignment("middle").setFontWeight("bold");

  // lista de códigos (aceita minúsculas também, por isso "allowInvalid")
  const codes = readScoring_(ss).map((s) => s.code).concat(["-"]);
  data.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(codes, true).setAllowInvalid(true)
    .setHelpText("Código do resultado (ex.: V, PE, VE). Vazio = não disputou. - = fora da competição.").build());

  // cores iguais às do site: verde soma, vermelho tira
  const a1 = "C3";
  const pts = "N(IFERROR(VLOOKUP(UPPER(TRIM(" + a1 + ")),INDIRECT(\"'" + SCORING_SHEET + "'!A:C\"),3,FALSE),\"\"))";
  const rule = (formula, bg, fg) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(bg).setFontColor(fg).setRanges([data]).build();
  sh.setConditionalFormatRules([
    rule("=OR(UPPER(TRIM(" + a1 + "))=\"E\",UPPER(TRIM(" + a1 + "))=\"D\")", "#d03b3b", "#ffffff"),
    rule("=TRIM(" + a1 + ")=\"-\"", "#ecebe6", "#8b8a84"),
    rule("=" + pts + ">=9", "#0f6b2f", "#ffffff"),
    rule("=" + pts + ">=7", "#1e8f45", "#ffffff"),
    rule("=" + pts + ">=5", "#8fd6a4", "#062a12"),
    rule("=" + pts + ">=1", "#d4f0dc", "#062a12"),
    rule("=" + pts + "<=-2", "#ee8f8a", "#3d0808"),
    rule("=" + pts + "<0", "#f8d3cf", "#6b1414"),
  ]);
}

function upsertEditionMeta_(ss, id, title) {
  const sh = ensureEditionsSheet_(ss);
  const v = sh.getDataRange().getValues();
  for (let r = 1; r < v.length; r++) {
    if (String(v[r][0]).trim().toUpperCase() === id) { sh.getRange(r + 1, 2).setValue(title); return; }
  }
  sh.appendRow([id, title, v.length <= 1 ? "x" : ""]);
}

function setDefault_(id) {
  const ss = ss_();
  const sh = ensureEditionsSheet_(ss);
  const v = sh.getDataRange().getValues();
  let found = false;
  for (let r = 1; r < v.length; r++) {
    const match = String(v[r][0]).trim().toUpperCase() === String(id).toUpperCase();
    found = found || match;
    sh.getRange(r + 1, 3).setValue(match ? "x" : "");
  }
  if (!found) sh.appendRow([String(id).toUpperCase(), titleFromCode_(String(id)), "x"]);
}

function ensureScoringSheet_(ss) {
  let sh = ss.getSheetByName(SCORING_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(SCORING_SHEET, 0);
  sh.getRange(1, 1, 1, 3).setValues([["Código", "Descrição", "Pontos"]]).setFontWeight("bold").setBackground("#e7e5df");
  sh.getRange(2, 1, DEFAULT_SCORING.length, 3).setValues(DEFAULT_SCORING);
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 220);
  return sh;
}

function ensureEditionsSheet_(ss) {
  let sh = ss.getSheetByName(EDITIONS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(EDITIONS_SHEET, 1);
  sh.getRange(1, 1, 1, 3).setValues([["Código", "Nome", "Padrão"]]).setFontWeight("bold").setBackground("#e7e5df");
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 220);
  return sh;
}

/** Rode esta função uma vez pelo editor (botão ▶ Executar) para criar as abas Pontuação e Edições. */
function configurar() {
  const ss = ss_();
  ensureScoringSheet_(ss);
  ensureEditionsSheet_(ss);
  ss.toast("Abas Pontuação e Edições prontas. Agora publique como app da Web (Implantar > Nova implantação).");
}
