/* Placar MasterChef 2026 — lógica do app (sem build, roda direto no navegador). */
(() => {
  "use strict";

  const STORAGE_KEY = "mc2026-data-v2";
  const THEME_KEY = "mc2026-theme";
  const TEAM_WIN = new Set(["VDP", "VLE", "VE", "VD"]);
  const RISK = new Set(["PE", "P", "PP", "ED", "DE", "DLE", "E"]);
  const OUT = new Set(["E", "D"]);
  const RECENT_DECAY = 0.6; // peso de cada semana anterior na "fase recente"
  const SD_PRIOR_WEIGHT = 2; // semanas "fictícias" com a oscilação média do elenco

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n) => (n >= 0.995 ? "100%" : n > 0 && n < 0.005 ? "<1%" : fmt(n * 100, 0) + "%");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue só em memória */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };

  /* ---------------- estado ---------------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let data = loadData();
  let model = null;
  let sim = null;
  let charts = {};
  let activeTab = "classificacao";
  let sortKey = null;

  // impressão digital do data.js publicado: se mudar, edições locais antigas são descartadas
  const BASE_ID = (() => { const t = JSON.stringify(window.MASTERCHEF_DATA); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); })();
  function loadData() {
    const saved = store.get(STORAGE_KEY);
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.base === BASE_ID && s.data) return normalize(s.data);
        store.del(STORAGE_KEY);
      } catch { /* cai para o padrão */ }
    }
    return normalize(clone(window.MASTERCHEF_DATA));
  }
  function normalize(d) {
    const slots = d.weeks.length * 2;
    d.competitors.forEach((c) => {
      c.results = Array.from({ length: slots }, (_, i) => {
        const v = c.results[i];
        return v == null || v === "" || v === 0 ? "0" : String(v).trim().toUpperCase();
      });
    });
    return d;
  }
  function save() { store.set(STORAGE_KEY, JSON.stringify({ base: BASE_ID, data })); }

  /* ---------------- modelo ---------------- */
  function compute(d) {
    const pts = Object.fromEntries(d.scoring.map((s) => [s.code, Number(s.pts) || 0]));
    const nW = d.weeks.length;
    const scored = (code) => Object.prototype.hasOwnProperty.call(pts, code);

    let currentWeek = -1;
    d.competitors.forEach((c) => c.results.forEach((code, i) => { if (scored(code)) currentWeek = Math.max(currentWeek, Math.floor(i / 2)); }));

    const comps = d.competitors.map((c, idx) => {
      const weekly = [], present = [], cum = [];
      let raw = 0;
      for (let w = 0; w < nW; w++) {
        const pair = [c.results[2 * w], c.results[2 * w + 1]];
        const s = pair.filter(scored);
        weekly.push(s.length ? s.reduce((a, k) => a + pts[k], 0) : null);
        present.push(pair.some((k) => k !== "-"));
        raw += weekly[w] || 0;
        cum.push(Math.max(0, raw));
      }
      const played = c.results.filter(scored);
      const lastIdx = c.results.reduce((acc, k, i) => (k !== "0" && k !== "-" ? i : acc), -1);
      const lastCode = lastIdx >= 0 ? c.results[lastIdx] : null;
      const eliminated = OUT.has(lastCode);
      const wasOut = c.results.some((k, i) => OUT.has(k) && i < lastIdx);
      const vals = weekly.filter((v) => v != null);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) : 0;
      let wsum = 0, wtot = 0;
      vals.forEach((v, i) => { const wt = RECENT_DECAY ** (vals.length - 1 - i); wsum += v * wt; wtot += wt; });
      const risk = played.filter((k) => RISK.has(k)).length;
      return {
        idx, name: c.name, results: c.results, weekly, present, cum,
        total: Math.max(0, played.reduce((a, k) => a + pts[k], 0)),
        pins: c.results.filter((k) => k === "V").length,
        teamWins: c.results.filter((k) => TEAM_WIN.has(k)).length,
        eliminated, wasOut,
        outWeek: eliminated ? Math.floor(lastIdx / 2) : null,
        weeksPlayed: vals.length, provasPlayed: played.length,
        mean, sd, recent: wtot ? wsum / wtot : 0,
        consistency: played.length ? 1 - risk / played.length : 0,
      };
    });

    const order = (key) => (a, b) => b[key] - a[key] || b.pins - a.pins || b.teamWins - a.teamWins || a.name.localeCompare(b.name, "pt-BR");
    const rankAt = (w) => {
      const arr = comps.map((c) => ({ c, v: w < 0 ? 0 : c.cum[w], pins: c.pins, teamWins: c.teamWins, name: c.name }));
      arr.sort(order("v"));
      const m = new Map(); arr.forEach((x, i) => m.set(x.c.idx, i + 1)); return m;
    };
    const sorted = [...comps].sort(order("total"));
    sorted.forEach((c, i) => (c.pos = i + 1));
    const prev = rankAt(currentWeek - 1);
    comps.forEach((c) => {
      c.prevPos = currentWeek > 0 ? prev.get(c.idx) : c.pos;
      c.delta = currentWeek > 0 ? c.total - c.cum[currentWeek - 1] : c.total;
      c.rankHistory = [];
    });
    for (let w = 0; w <= currentWeek; w++) {
      const m = rankAt(w); comps.forEach((c) => c.rankHistory.push(m.get(c.idx)));
    }

    // cor fixa por participante ativo (ordem alfabética: a cor segue a pessoa, nunca a posição)
    const active = comps.filter((c) => !c.eliminated).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    active.forEach((c, i) => (c.slot = i < 8 ? i + 1 : null));
    comps.filter((c) => c.eliminated).forEach((c) => (c.slot = null));

    return { pts, currentWeek, comps, sorted, active };
  }

  /* ---------------- simulação ---------------- */
  function simulate(m, momentum, runs) {
    const act = m.active;
    if (!act.length) return { runs: 0, rows: [] };
    const allVals = act.flatMap((c) => c.weekly.filter((v) => v != null));
    const gMean = allVals.reduce((a, b) => a + b, 0) / (allVals.length || 1);
    const gSd = Math.sqrt(allVals.reduce((a, v) => a + (v - gMean) ** 2, 0) / (allVals.length || 1)) || 1;
    const params = act.map((c) => {
      const n = c.weeksPlayed;
      return {
        c,
        mu: (1 - momentum) * c.mean + momentum * c.recent,
        sigma: Math.sqrt((n * c.sd ** 2 + SD_PRIOR_WEIGHT * gSd ** 2) / (n + SD_PRIOR_WEIGHT)),
      };
    });
    const k = params.length;
    const wins = new Float64Array(k), finals = new Float64Array(k), firstOut = new Float64Array(k);
    const randn = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
    const alive = new Int32Array(k), score = new Float64Array(k);
    for (let r = 0; r < runs; r++) {
      let n = k;
      for (let i = 0; i < k; i++) alive[i] = i;
      let round = 0;
      while (n > 1) {
        if (n <= 3 && round === 0 || n === 3) for (let i = 0; i < n; i++) finals[alive[i]]++;
        let minJ = 0, minV = Infinity;
        for (let j = 0; j < n; j++) {
          const p = params[alive[j]];
          const v = p.mu + p.sigma * randn();
          score[j] = v;
          if (v < minV) { minV = v; minJ = j; }
        }
        if (round === 0) firstOut[alive[minJ]]++;
        alive[minJ] = alive[n - 1]; n--; round++;
      }
      wins[alive[0]]++;
      if (k === 1) finals[0]++;
    }
    const rows = params.map((p, i) => ({ ...p, win: wins[i] / runs, final: Math.min(1, finals[i] / runs), nextOut: k > 1 ? firstOut[i] / runs : 0 }));
    rows.sort((a, b) => b.win - a.win || b.mu - a.mu);
    return { runs, rows };
  }

  /* ---------------- cores ---------------- */
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const seriesColor = (c) => (c.slot ? css(`--series-${c.slot}`) : css("--series-muted"));
  function codeClass(code) {
    if (code === "0") return "c-none";
    if (code === "-") return "c-gone";
    if (OUT.has(code)) return "c-out";
    const p = model.pts[code];
    if (p == null) return "c-neu";
    if (p >= 9) return "c-pos-3";
    if (p >= 7) return "c-pos-2";
    if (p >= 5) return "c-pos-1";
    if (p >= 1) return "c-pos-0";
    if (p === 0) return "c-neu";
    if (p === -1) return "c-neg-1";
    return "c-neg-2";
  }
  const codeLabel = (code) => (data.scoring.find((s) => s.code === code) || {}).label || code;
  const initials = (n) => n.replace(/\./g, "").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const avatar = (c) => `<span class="avatar" style="border-color:${seriesColor(c)}">${esc(initials(c.name))}</span>`;
  const pinSvg = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M10.5 1.5 14.5 5.5l-1.4.6-2.7 2.7.3 3.2-1.2 1.2-2.5-2.5L3 14.5 1.5 13l3.8-4-2.5-2.5L4 5.3l3.2.3L9.9 2.9z"/></svg>';

  /* ---------------- render: topo & KPIs ---------------- */
  function renderHeader() {
    const w = model.currentWeek;
    const wl = w >= 0 ? data.weeks[w].label : "sem resultados";
    $("#subtitle").textContent = `${model.active.length} na disputa · atualizado até ${wl.toLowerCase()}`;
  }

  function renderKpis() {
    const leader = model.sorted[0];
    const second = model.sorted[1];
    const maxPins = Math.max(...model.comps.map((c) => c.pins));
    const pinLeaders = model.comps.filter((c) => c.pins === maxPins && maxPins > 0);
    const fav = sim && sim.rows[0];
    const w = model.currentWeek;
    const weekBest = w >= 0 ? [...model.comps].filter((c) => c.weekly[w] != null).sort((a, b) => b.weekly[w] - a.weekly[w])[0] : null;
    const tiles = [
      { label: "Líder", value: leader ? esc(leader.name) : "—", meta: leader ? `${fmt(leader.total)} pts${second ? ` · ${fmt(leader.total - second.total)} à frente de ${esc(second.name)}` : ""}` : "" },
      { label: "Mais pins", value: pinLeaders.length ? pinLeaders.map((c) => esc(c.name)).join(", ") : "—", meta: maxPins ? `${maxPins} vitórias individuais` : "ninguém venceu sozinho ainda" },
      { label: "Favorito pelo modelo", value: fav ? esc(fav.c.name) : "—", meta: fav ? `${pct(fav.win)} de chance de vencer` : "" },
      { label: w >= 0 ? `Destaque · ${esc(data.weeks[w].label)}` : "Destaque da semana", value: weekBest ? esc(weekBest.name) : "—", meta: weekBest ? `${fmt(weekBest.weekly[w])} pts na semana` : "" },
    ];
    $("#kpis").innerHTML = tiles.map((t) => `<div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="meta">${t.meta}</div></div>`).join("");
  }

  /* ---------------- render: classificação ---------------- */
  function sparkline(c) {
    const w = model.currentWeek; if (w < 0) return "";
    const vals = c.weekly.slice(0, w + 1);
    const known = vals.filter((v) => v != null);
    if (!known.length) return "";
    const lo = Math.min(-4, ...known), hi = Math.max(20, ...known);
    const W = 96, H = 24, x = (i) => (w === 0 ? W / 2 : (i / w) * (W - 4) + 2), y = (v) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
    let d = "", pen = false, last = null;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; last = [x(i), y(v)]; });
    const zero = y(0).toFixed(1);
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="var(--grid-line)" stroke-width="1"/>
      <path d="${d}" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="var(--text-primary)"/>` : ""}</svg>`;
  }

  function statusPill(c) {
    if (c.eliminated) return `<span class="pill off"><span>Eliminado · ${esc(data.weeks[c.outWeek].label)}</span></span>`;
    if (c.wasOut) return `<span class="pill back"><span>Na disputa · voltou</span></span>`;
    return `<span class="pill on"><span>Na disputa</span></span>`;
  }

  function renderRanking() {
    const only = $("#onlyActive").checked;
    const rows = model.sorted.filter((c) => !only || !c.eliminated);
    const maxT = Math.max(1, ...model.comps.map((c) => c.total));
    const move = (c) => {
      const d = c.prevPos - c.pos;
      if (model.currentWeek <= 0 || d === 0) return `<span class="move same" title="Mesma posição">–</span>`;
      return d > 0 ? `<span class="move up" title="Subiu ${d}">▲${d}</span>` : `<span class="move down" title="Caiu ${-d}">▼${-d}</span>`;
    };
    $("#rankTable").innerHTML = `
      <thead><tr>
        <th>#</th><th></th><th>Competidor</th><th>Situação</th>
        <th class="r">Pontos</th><th class="r" title="Pontos ganhos na última semana">Na semana</th><th>Pins</th><th class="c">Vit. equipe</th>
        <th class="r">Média/sem.</th><th>Pontos por semana</th>
      </tr></thead>
      <tbody>${rows.map((c) => `
        <tr class="${c.eliminated ? "out" : ""}">
          <td class="pos ${c.pos <= 3 && !c.eliminated ? "top" : ""} num">${c.pos}º</td>
          <td>${move(c)}</td>
          <td><div class="who">${avatar(c)}<b>${esc(c.name)}</b></div></td>
          <td>${statusPill(c)}</td>
          <td class="r"><div class="bar-cell"><div class="track"><div class="fill" style="width:${(c.total / maxT) * 100}%;${c.eliminated ? "background:var(--series-muted)" : ""}"></div></div><b class="num">${fmt(c.total)}</b></div></td>
          <td class="r num">${c.delta > 0 ? "+" : ""}${fmt(c.delta)}</td>
          <td><span class="pins" title="${c.pins} pin(s)">${c.pins ? pinSvg.repeat(c.pins) : '<span style="color:var(--text-muted)">—</span>'}</span></td>
          <td class="c num">${c.teamWins}</td>
          <td class="r num">${fmt(c.mean, 1)}</td>
          <td>${sparkline(c)}</td>
        </tr>`).join("")}</tbody>`;
  }

  function renderBoard() {
    const nW = data.weeks.length;
    const shownW = Math.max(model.currentWeek + 1, 1);
    const weeks = data.weeks.slice(0, Math.min(nW, shownW));
    const only = $("#onlyActive").checked;
    const rows = model.sorted.filter((c) => !only || !c.eliminated);
    $("#boardTable").innerHTML = `
      <thead>
        <tr class="weeks"><th class="name"></th>${weeks.map((w) => `<th colspan="2">${esc(w.label)}</th>`).join("")}<th></th></tr>
        <tr class="provas"><th class="name">Competidor</th>${weeks.map((w) => w.provas.map((p) => `<th>${esc(p || "—")}</th>`).join("")).join("")}<th>Total</th></tr>
      </thead>
      <tbody>${rows.map((c) => `
        <tr>
          <td class="name"><div class="who">${avatar(c)}${esc(c.name)}</div></td>
          ${c.results.slice(0, weeks.length * 2).map((code, i) => {
            const w = Math.floor(i / 2);
            const tip = `${c.name} · ${data.weeks[w].label} · ${data.weeks[w].provas[i % 2] || "prova"}<br><b>${code === "0" ? "Não disputou" : code === "-" ? "Fora da competição" : esc(codeLabel(code))}</b>${model.pts[code] != null ? ` · ${model.pts[code] > 0 ? "+" : ""}${model.pts[code]} pts` : ""}`;
            return `<td><span class="code ${codeClass(code)} ${code === "V" ? "win" : ""}" data-tip="${esc(tip)}">${code === "0" ? "·" : code === "-" ? "" : esc(code)}</span></td>`;
          }).join("")}
          <td class="tot num">${fmt(c.total)}</td>
        </tr>`).join("")}</tbody>`;

    const used = new Set(model.comps.flatMap((c) => c.results));
    $("#codeLegend").innerHTML = data.scoring.filter((s) => used.has(s.code))
      .sort((a, b) => b.pts - a.pts)
      .map((s) => `<span class="item"><span class="code ${codeClass(s.code)} ${s.code === "V" ? "win" : ""}">${esc(s.code)}</span>${esc(s.label.toLowerCase())} (${s.pts > 0 ? "+" : ""}${s.pts})</span>`).join("")
      + `<span class="item"><span class="code c-none">·</span>não disputou</span><span class="item"><span class="code c-gone"></span>fora</span>`;
  }

  /* ---------------- charts ---------------- */
  function chartDefaults() {
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--text-secondary");
    Chart.defaults.borderColor = css("--grid-line");
    Chart.defaults.plugins.tooltip.backgroundColor = css("--text-primary");
    Chart.defaults.plugins.tooltip.titleColor = css("--bg");
    Chart.defaults.plugins.tooltip.bodyColor = css("--bg");
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    Chart.defaults.plugins.tooltip.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
  }
  const destroy = (k) => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } };

  // rótulo direto no fim de cada linha ativa, empurrando para não sobrepor
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(chart, _a, opts) {
      const { ctx, chartArea } = chart;
      const items = [];
      chart.data.datasets.forEach((ds, i) => {
        if (!ds._label || !chart.isDatasetVisible(i)) return;
        const meta = chart.getDatasetMeta(i);
        for (let j = meta.data.length - 1; j >= 0; j--) {
          if (ds.data[j] != null) { items.push({ y: meta.data[j].y, x: meta.data[j].x, text: ds.label }); break; }
        }
      });
      items.sort((a, b) => a.y - b.y);
      const gap = 14;
      for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
      ctx.save();
      ctx.font = "600 11.5px Inter, sans-serif";
      ctx.fillStyle = css("--text-primary");
      ctx.textBaseline = "middle";
      items.forEach((it) => ctx.fillText(it.text, Math.min(it.x + 8, chartArea.right + 6), it.y));
      ctx.restore();
    },
  };

  function renderCumChart() {
    destroy("cum");
    const w = model.currentWeek; if (w < 0) return;
    const showOut = $("#showEliminated").checked;
    const labels = data.weeks.slice(0, w + 1).map((x) => x.label.replace("Semana ", "S"));
    const list = [...model.comps].filter((c) => showOut || !c.eliminated).sort((a, b) => (a.eliminated - b.eliminated) || b.total - a.total);
    const datasets = list.map((c) => ({
      label: c.name,
      _label: !c.eliminated,
      data: c.cum.slice(0, w + 1).map((v, i) => (c.present[i] ? v : null)),
      borderColor: seriesColor(c), backgroundColor: seriesColor(c),
      borderWidth: c.eliminated ? 1.5 : 2.25,
      pointRadius: c.eliminated ? 0 : 2.5, pointHoverRadius: 5,
      pointBorderColor: css("--surface-1"), pointBorderWidth: 1.5,
      cubicInterpolationMode: "monotone", spanGaps: false,
      order: c.eliminated ? 2 : 1,
    }));
    charts.cum = new Chart($("#cumChart"), {
      type: "line", data: { labels, datasets }, plugins: [endLabels],
      options: {
        maintainAspectRatio: false, layout: { padding: { right: 80 } },
        interaction: { mode: "index", intersect: false },
        scales: { y: { beginAtZero: true, grid: { color: css("--grid-line") }, title: { display: true, text: "pontos acumulados" } }, x: { grid: { display: false } } },
        plugins: {
          legend: { position: "bottom", labels: { filter: (it, d) => d.datasets[it.datasetIndex]._label } },
          tooltip: {
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            filter: (it) => it.parsed.y != null && it.dataset._label,
            callbacks: {
              title: (it) => data.weeks[it[0].dataIndex].label,
              label: (it) => ` ${it.dataset.label}: ${fmt(it.parsed.y)} pts`,
            },
          },
        },
      },
    });
  }

  function renderRankChart() {
    destroy("rank");
    const w = model.currentWeek; if (w < 0) return;
    const labels = data.weeks.slice(0, w + 1).map((x) => x.label.replace("Semana ", "S"));
    const datasets = model.active.map((c) => ({
      label: c.name, _label: true,
      data: c.rankHistory.map((r, i) => (c.present[i] ? r : null)),
      borderColor: seriesColor(c), backgroundColor: seriesColor(c),
      borderWidth: 2.25, pointRadius: 3, pointHoverRadius: 5, pointBorderColor: css("--surface-1"), pointBorderWidth: 1.5, cubicInterpolationMode: "monotone", clip: false,
    }));
    charts.rank = new Chart($("#rankChart"), {
      type: "line", data: { labels, datasets }, plugins: [endLabels],
      options: {
        maintainAspectRatio: false, layout: { padding: { right: 80, top: 8 } },
        interaction: { mode: "index", intersect: false },
        scales: {
          y: { reverse: true, min: 1, max: model.comps.length, afterBuildTicks: (ax) => { ax.ticks = Array.from({ length: model.comps.length }, (_, i) => ({ value: i + 1 })); }, ticks: { autoSkip: false, callback: (v) => v + "º" }, grid: { color: css("--grid-line") } },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: { itemSort: (a, b) => a.parsed.y - b.parsed.y, callbacks: { title: (it) => data.weeks[it[0].dataIndex].label, label: (it) => ` ${it.parsed.y}º · ${it.dataset.label}` } },
        },
      },
    });
  }

  function renderProbChart() {
    destroy("prob");
    if (!sim || !sim.rows.length) return;
    const rows = sim.rows;
    const valueLabels = {
      id: "valueLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart; const meta = chart.getDatasetMeta(0);
        ctx.save(); ctx.font = "600 12px Inter, sans-serif"; ctx.fillStyle = css("--text-primary"); ctx.textBaseline = "middle";
        meta.data.forEach((bar, i) => ctx.fillText(pct(rows[i].win), bar.x + 6, bar.y));
        ctx.restore();
      },
    };
    charts.prob = new Chart($("#probChart"), {
      type: "bar",
      data: {
        labels: rows.map((r) => r.c.name),
        datasets: [{ label: "Chance de vencer", data: rows.map((r) => r.win * 100), backgroundColor: rows.map((r) => seriesColor(r.c)), borderRadius: 4, borderSkipped: "start", barThickness: 20, borderColor: css("--surface-1"), borderWidth: 0 }],
      },
      plugins: [valueLabels],
      options: {
        indexAxis: "y", maintainAspectRatio: false, layout: { padding: { right: 48 } },
        scales: { x: { beginAtZero: true, suggestedMax: Math.min(100, Math.max(...rows.map((r) => r.win * 100)) * 1.1), ticks: { callback: (v) => v + "%" }, grid: { color: css("--grid-line") } }, y: { grid: { display: false }, ticks: { color: css("--text-primary"), font: { weight: 600 } } } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (it) => { const r = rows[it.dataIndex]; return [` Vencer: ${pct(r.win)}`, ` Chegar à final (top 3): ${pct(r.final)}`, ` Sair na próxima eliminação: ${pct(r.nextOut)}`]; } } },
        },
      },
    });
    $("#predHint").textContent = `${fmt(sim.runs)} temporadas simuladas a partir de ${esc(data.weeks[model.currentWeek]?.label || "—")}`;
  }

  function renderScatter() {
    destroy("scatter");
    if (!sim) return;
    const momentum = Number($("#momentum").value) / 100;
    const mk = (c) => ({ x: (1 - momentum) * c.mean + momentum * c.recent, y: c.consistency * 100, r: 5 + c.pins * 2.5, c });
    const act = model.active.map(mk);
    const out = model.comps.filter((c) => c.eliminated && c.weeksPlayed > 0).map(mk);
    const nameLabels = {
      id: "nameLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart; const meta = chart.getDatasetMeta(1);
        ctx.save(); ctx.font = "600 11.5px Inter, sans-serif"; ctx.fillStyle = css("--text-primary"); ctx.textBaseline = "middle";
        const items = meta.data.map((pt, i) => ({ x: pt.x + act[i].r + 5, y: pt.y, t: act[i].c.name })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < items.length; i++) { const p = items[i - 1]; if (Math.abs(items[i].x - p.x) < 70 && items[i].y - p.y < 14) items[i].y = p.y + 14; }
        items.forEach((it) => ctx.fillText(it.t, it.x, it.y));
        ctx.restore();
      },
    };
    const tip = (it) => { const p = it.raw; return [` ${p.c.name}${p.c.eliminated ? " (eliminado)" : ""}`, ` Desempenho esperado: ${fmt(p.x, 1)} pts/semana`, ` Consistência: ${fmt(p.y, 0)}%`, ` Pins: ${p.c.pins}`]; };
    charts.scatter = new Chart($("#scatterChart"), {
      type: "bubble",
      data: {
        datasets: [
          { label: "Eliminados", data: out, backgroundColor: css("--series-muted"), borderColor: css("--surface-1"), borderWidth: 2, order: 2 },
          { label: "Na disputa", data: act, backgroundColor: act.map((p) => seriesColor(p.c)), borderColor: css("--surface-1"), borderWidth: 2, order: 1 },
        ],
      },
      plugins: [nameLabels],
      options: {
        maintainAspectRatio: false, layout: { padding: { right: 70, top: 10 } },
        scales: {
          x: { title: { display: true, text: "desempenho esperado (pts por semana)" }, grid: { color: css("--grid-line") } },
          y: { title: { display: true, text: "consistência (% provas fora de risco)" }, suggestedMin: 0, max: 100, ticks: { callback: (v) => v + "%" }, grid: { color: css("--grid-line") } },
        },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: tip } } },
      },
    });
  }

  function renderPredTable() {
    if (!sim) return;
    const maxWin = Math.max(0.01, ...sim.rows.map((r) => r.win));
    $("#predTable").innerHTML = `
      <thead><tr>
        <th>Competidor</th><th>Chance de vencer</th><th class="r">Chegar à final</th><th class="r">Risco na próxima</th>
        <th class="r">Média/sem.</th><th class="r">Fase recente</th><th class="r">Oscilação (±)</th><th class="r">Consistência</th><th class="c">Pins</th>
      </tr></thead>
      <tbody>${sim.rows.map((r) => `
        <tr>
          <td><div class="who">${avatar(r.c)}<b>${esc(r.c.name)}</b></div></td>
          <td><div class="bar-cell"><div class="track"><div class="fill" style="width:${(r.win / maxWin) * 100}%;background:${seriesColor(r.c)}"></div></div><b class="num">${pct(r.win)}</b></div></td>
          <td class="r num">${pct(r.final)}</td>
          <td class="r num">${pct(r.nextOut)}</td>
          <td class="r num">${fmt(r.c.mean, 1)}</td>
          <td class="r num">${fmt(r.c.recent, 1)}</td>
          <td class="r num">${fmt(r.c.sd, 1)}</td>
          <td class="r num">${fmt(r.c.consistency * 100, 0)}%</td>
          <td class="c num">${r.c.pins}</td>
        </tr>`).join("")}</tbody>`;
  }

  /* ---------------- lançar resultados ---------------- */
  function optionsHtml(sel) {
    const opts = [["0", "·"], ["-", "–"], ...data.scoring.map((s) => [s.code, s.code])];
    if (!opts.some(([v]) => v === sel)) opts.push([sel, sel]);
    return opts.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`).join("");
  }

  function renderEdit() {
    const weeks = data.weeks;
    $("#editTable").innerHTML = `
      <thead>
        <tr class="weeks"><th class="name"></th>${weeks.map((w, wi) => `<th colspan="2"><input data-week="${wi}" value="${esc(w.label)}" style="width:110px;text-transform:uppercase;font-weight:600;color:var(--text-primary)"></th>`).join("")}<th></th><th></th></tr>
        <tr class="provas"><th class="name">Competidor</th>${weeks.map((w, wi) => w.provas.map((p, pi) => `<th><input data-prova="${wi}-${pi}" value="${esc(p)}" placeholder="prova"></th>`).join("")).join("")}<th>Total</th><th></th></tr>
      </thead>
      <tbody>${data.competitors.map((c, ci) => {
        const m = model.comps[ci];
        return `<tr>
          <td class="name"><input class="name-input" data-name="${ci}" value="${esc(c.name)}"></td>
          ${c.results.map((code, i) => `<td><select class="code ${codeClass(code)}" data-c="${ci}" data-i="${i}" title="${esc(weeks[Math.floor(i / 2)].label)} · ${esc(weeks[Math.floor(i / 2)].provas[i % 2] || "")}">${optionsHtml(code)}</select></td>`).join("")}
          <td class="tot num" data-total="${ci}">${fmt(m.total)}</td>
          <td><button class="del-btn" data-del="${ci}" title="Remover ${esc(c.name)}" aria-label="Remover ${esc(c.name)}">×</button></td>
        </tr>`;
      }).join("")}</tbody>`;
  }

  function renderRules() {
    $("#rulesTable").innerHTML = `
      <thead><tr><th>Código</th><th>Resultado</th><th class="r">Pontos</th></tr></thead>
      <tbody>${[...data.scoring].sort((a, b) => b.pts - a.pts).map((s) => `
        <tr><td><span class="code ${codeClass(s.code)} ${s.code === "V" ? "win" : ""}" style="width:44px">${esc(s.code)}</span></td>
        <td>${esc(s.label.charAt(0) + s.label.slice(1).toLowerCase())}</td>
        <td class="r"><input type="number" data-rule="${esc(s.code)}" value="${s.pts}" style="width:64px;text-align:right;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);color:var(--text-primary);font:inherit"></td></tr>`).join("")}</tbody>`;
  }

  /* ---------------- orquestração ---------------- */
  function runSim() {
    sim = simulate(model, Number($("#momentum").value) / 100, Number($("#sims").value));
  }

  function renderVisibleCharts() {
    if (activeTab === "evolucao") { renderCumChart(); renderRankChart(); }
    if (activeTab === "previsoes") { renderProbChart(); renderScatter(); renderPredTable(); }
  }

  function refresh({ edit = true } = {}) {
    model = compute(data);
    runSim();
    renderHeader(); renderKpis(); renderRanking(); renderBoard(); renderRules();
    if (edit) renderEdit();
    renderVisibleCharts();
  }

  function flash(msg) {
    const el = $("#statusMsg"); el.textContent = msg;
    clearTimeout(flash.t); flash.t = setTimeout(() => (el.textContent = ""), 5000);
  }

  /* ---------------- importação da planilha ---------------- */
  function parseWorkbook(wb) {
    const sheetName = wb.SheetNames.find((n) => /placar/i.test(n)) || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const find = (re) => { for (let r = 0; r < aoa.length; r++) for (let c = 0; c < (aoa[r] || []).length; c++) if (typeof aoa[r][c] === "string" && re.test(aoa[r][c].trim())) return [r, c]; return null; };
    const pinsAt = find(/^PINS$/i);
    const week1 = find(/^SEMANA 0?1$/i);
    if (!pinsAt || !week1) throw new Error("Não encontrei as colunas PINS e SEMANA 01 na aba Placar.");
    const headRow = pinsAt[0], nameCol = pinsAt[1] - 1, firstCol = week1[1];
    const weekRow = aoa[week1[0]];
    const weeks = [];
    for (let c = firstCol; c < firstCol + 60; c += 2) {
      const lab = weekRow[c];
      if (!lab || /^SEMANA$/i.test(String(lab).trim()) && c > firstCol + 2) break;
      const tc = (s) => String(s || "").trim().toLowerCase().replace(/(^|\s|-)\S/g, (m) => m.toUpperCase());
      weeks.push({ label: tc(lab), provas: [tc(aoa[headRow][c]), tc(aoa[headRow][c + 1])] });
    }
    const competitors = [];
    for (let r = headRow + 1; r < aoa.length; r++) {
      const nm = aoa[r] && aoa[r][nameCol];
      if (!nm || typeof nm !== "string") continue;
      const results = [];
      for (let i = 0; i < weeks.length * 2; i++) {
        const v = aoa[r][firstCol + i];
        results.push(v == null || v === 0 || v === "0" ? "0" : String(v).trim().toUpperCase());
      }
      competitors.push({ name: nm.trim(), results });
    }
    let scoring = data.scoring;
    const tab = find(/TABELA DE PONTUA/i);
    if (tab) {
      const list = [];
      for (let r = tab[0] + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const code = row[tab[1] + 3], p = row[tab[1] + 4];
        if (code == null || typeof p !== "number") continue;
        list.push({ code: String(code).trim().toUpperCase(), label: String(row[tab[1]] || code).trim().replace("EIMINADO", "ELIMINADO"), pts: p });
      }
      if (list.length) scoring = list;
    }
    if (!competitors.length) throw new Error("Nenhum competidor encontrado.");
    return normalize({ source: "importado", weeks, scoring, competitors });
  }

  /* ---------------- eventos ---------------- */
  function bind() {
    const showTab = (name) => {
      const b = $(`.tabs button[data-tab="${name}"]`); if (!b) return;
      activeTab = name;
      $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $$(".panel").forEach((p) => (p.hidden = p.id !== `tab-${activeTab}`));
      renderVisibleCharts();
    };
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => { history.replaceState(null, "", "#" + b.dataset.tab); showTab(b.dataset.tab); }));
    addEventListener("hashchange", () => showTab(location.hash.slice(1)));
    bind.showTab = showTab;

    $("#onlyActive").addEventListener("change", () => { renderRanking(); renderBoard(); });
    $("#showEliminated").addEventListener("change", renderCumChart);

    const onMomentum = () => { $("#momentumOut").textContent = $("#momentum").value + "%"; };
    const onSims = () => { $("#simsOut").textContent = fmt(Number($("#sims").value)); };
    $("#momentum").addEventListener("input", onMomentum);
    $("#sims").addEventListener("input", onSims);
    const resim = () => { runSim(); renderKpis(); renderVisibleCharts(); };
    $("#momentum").addEventListener("change", resim);
    $("#sims").addEventListener("change", resim);
    $("#rerun").addEventListener("click", resim);

    // edição
    const edit = $("#editTable");
    edit.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("select[data-c]")) {
        const ci = +t.dataset.c, i = +t.dataset.i;
        data.competitors[ci].results[i] = t.value;
        save(); refresh({ edit: false });
        t.className = `code ${codeClass(t.value)}`;
        $$("[data-total]", edit).forEach((td) => (td.textContent = fmt(model.comps[+td.dataset.total].total)));
      } else if (t.matches("[data-name]")) {
        data.competitors[+t.dataset.name].name = t.value.trim() || "Sem nome"; save(); refresh({ edit: false });
      } else if (t.matches("[data-week]")) {
        data.weeks[+t.dataset.week].label = t.value.trim(); save(); refresh({ edit: false });
      } else if (t.matches("[data-prova]")) {
        const [wi, pi] = t.dataset.prova.split("-").map(Number);
        data.weeks[wi].provas[pi] = t.value.trim(); save(); refresh({ edit: false });
      }
    });
    edit.addEventListener("click", (e) => {
      const b = e.target.closest("[data-del]"); if (!b) return;
      const c = data.competitors[+b.dataset.del];
      if (!confirm(`Remover ${c.name}?`)) return;
      data.competitors.splice(+b.dataset.del, 1); save(); refresh();
    });
    $("#addCompetitor").addEventListener("click", () => {
      data.competitors.push({ name: "Novo competidor", results: Array(data.weeks.length * 2).fill("0") });
      save(); refresh(); flash("Competidor adicionado no fim da tabela.");
    });
    $("#rulesTable").addEventListener("change", (e) => {
      const t = e.target; if (!t.matches("[data-rule]")) return;
      const s = data.scoring.find((x) => x.code === t.dataset.rule);
      s.pts = Number(t.value) || 0; save(); refresh();
    });

    $("#xlsxInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        if (typeof XLSX === "undefined") throw new Error("Leitor de planilhas não carregou (sem internet?).");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        data = parseWorkbook(wb); data.source = f.name;
        save(); refresh(); flash(`Planilha “${f.name}” importada: ${data.competitors.length} competidores.`);
      } catch (err) { flash("Erro ao importar: " + err.message); }
      e.target.value = "";
    });
    $("#jsonInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (!d.weeks || !d.competitors || !d.scoring) throw new Error("arquivo sem weeks/competitors/scoring");
        data = normalize(d); save(); refresh(); flash(`Dados de “${f.name}” carregados.`);
      } catch (err) { flash("Erro ao ler JSON: " + err.message); }
      e.target.value = "";
    });
    const download = (name, text, type) => {
      const blob = new Blob([text], { type });
      const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      link.click(); URL.revokeObjectURL(link.href);
    };
    $("#exportDataJs").addEventListener("click", () => {
      download("data.js", "// Exportado pelo app (Lançar resultados).\nwindow.MASTERCHEF_DATA = " + JSON.stringify(data, null, 1) + ";\n", "text/javascript");
      flash("data.js baixado: substitua o arquivo na pasta do projeto e rode publicar.bat.");
    });
    $("#exportJson").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "masterchef-2026.json" });
      a.click(); URL.revokeObjectURL(a.href);
    });
    $("#resetData").addEventListener("click", () => {
      if (!confirm("Descartar as alterações feitas aqui e voltar aos dados da planilha original?")) return;
      store.del(STORAGE_KEY); data = normalize(clone(window.MASTERCHEF_DATA)); refresh(); flash("Dados originais restaurados.");
    });

    // tema
    const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
    applyTheme(store.get(THEME_KEY));
    $("#themeToggle").addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      applyTheme(next); store.set(THEME_KEY, next);
      chartDefaults(); refresh();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { chartDefaults(); refresh(); });

    // tooltip do quadro de provas
    const tipEl = $("#tooltip");
    document.addEventListener("mouseover", (e) => {
      const t = e.target.closest("[data-tip]");
      if (!t) { tipEl.hidden = true; return; }
      tipEl.innerHTML = t.dataset.tip; tipEl.hidden = false;
    });
    document.addEventListener("mousemove", (e) => {
      if (tipEl.hidden) return;
      const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8);
      const y = e.clientY + 16 + tipEl.offsetHeight > innerHeight ? e.clientY - tipEl.offsetHeight - 10 : e.clientY + 16;
      tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
    });
  }

  /* ---------------- início ---------------- */
  if (typeof Chart === "undefined") {
    document.body.insertAdjacentHTML("afterbegin", '<p style="padding:12px 24px;margin:0;background:#d03b3b;color:#fff">Não foi possível carregar a biblioteca de gráficos. Verifique a conexão com a internet.</p>');
  }
  bind();
  if (typeof Chart !== "undefined") chartDefaults();
  refresh();
  if (location.hash) bind.showTab(location.hash.slice(1));
})();
