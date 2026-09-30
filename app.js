/* Placar MasterChef — lógica do app (várias edições; sem build, roda direto no navegador). */
(() => {
  "use strict";

  const STORAGE_KEY = "mc-placar-edicoes-v3";
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
  const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue só em memória */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };

  /* ---------------- estado (várias edições) ----------------
   * Publicado = window.MASTERCHEF_EDITIONS (data.js).
   * Local (localStorage) = edições alteradas ou criadas neste navegador. Cada alteração guarda a
   * impressão digital da versão publicada em que se baseou; se o data.js publicado mudar, a cópia
   * local daquela edição é descartada. Edições criadas aqui (sem versão publicada) são mantidas.
   */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hash = (o) => { const t = JSON.stringify(o); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); };
  const published = (() => {
    const raw = window.MASTERCHEF_EDITIONS
      || (window.MASTERCHEF_DATA && { default: "masterchef-2026", editions: [{ id: "masterchef-2026", title: "MasterChef 2026", ...window.MASTERCHEF_DATA }] })
      || { default: null, editions: [] };
    const eds = raw.editions.map((e) => normalize(clone(e)));
    return { default: raw.default, editions: eds, hashes: Object.fromEntries(raw.editions.map((e) => [e.id, hash(e)])) };
  })();
  let local = loadLocal();
  let editions = mergeEditions();
  let data = null; // edição aberta
  let model = null;
  let sim = null;
  const charts = {};
  let activeTab = "placar";
  let evoMode = "rank";
  let editWeek = null; // índice da semana em edição, ou "all"

  function loadLocal() {
    const empty = { eds: {}, deleted: [], order: [], default: null, current: null };
    try {
      const s = JSON.parse(store.get(STORAGE_KEY) || "null");
      if (!s || !s.eds) return empty;
      for (const [id, entry] of Object.entries(s.eds)) {
        const pubHash = published.hashes[id] || null;
        if (entry.base !== pubHash) delete s.eds[id]; // versão publicada mudou (ou foi removida)
      }
      s.deleted = (s.deleted || []).filter((d) => published.hashes[d.id] === d.base);
      return { ...empty, ...s };
    } catch { return empty; }
  }
  function saveLocal() { store.set(STORAGE_KEY, JSON.stringify(local)); }
  function mergeEditions() {
    const del = new Set(local.deleted.map((d) => d.id));
    const list = published.editions.filter((e) => !del.has(e.id)).map((e) => (local.eds[e.id] ? normalize(clone(local.eds[e.id].data)) : e));
    Object.values(local.eds).forEach((entry) => { if (entry.base === null && !list.some((e) => e.id === entry.data.id)) list.push(normalize(clone(entry.data))); });
    return list;
  }
  const defaultId = () => {
    const ids = editions.map((e) => e.id);
    if (local.default && ids.includes(local.default)) return local.default;
    if (published.default && ids.includes(published.default)) return published.default;
    return ids[ids.length - 1] || null;
  };
  const edStatus = (id) => (local.eds[id] ? (local.eds[id].base === null ? "local" : "changed") : "published");
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
  // grava a edição aberta como alteração local
  function save() {
    if (!data) return;
    local.eds[data.id] = { base: published.hashes[data.id] || null, data };
    saveLocal();
  }
  function openEdition(id) {
    const ed = editions.find((e) => e.id === id) || editions.find((e) => e.id === defaultId()) || editions[0] || null;
    data = ed; editWeek = null;
    local.current = ed ? ed.id : null; saveLocal();
    const url = new URL(location.href);
    if (ed && ed.id !== defaultId()) url.searchParams.set("edicao", ed.id); else url.searchParams.delete("edicao");
    history.replaceState(null, "", url);
  }
  const slugify = (t) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "edicao";
  const uniqueId = (title) => { const base = slugify(title); let id = base, n = 2; while (editions.some((e) => e.id === id)) id = `${base}-${n++}`; return id; };
  function bundleForExport() {
    return { default: defaultId(), editions: editions.map((e) => clone(e)) };
  }

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

    const pinsUpTo = (c, w) => c.results.slice(0, 2 * (w + 1)).filter((k) => k === "V").length;
    const teamUpTo = (c, w) => c.results.slice(0, 2 * (w + 1)).filter((k) => TEAM_WIN.has(k)).length;
    const rankAt = (w) => {
      const arr = comps.map((c) => ({ c, v: w < 0 ? 0 : c.cum[w], p: pinsUpTo(c, w), t: teamUpTo(c, w) }));
      arr.sort((a, b) => b.v - a.v || b.p - a.p || b.t - a.t || a.c.name.localeCompare(b.c.name, "pt-BR"));
      const m = new Map(); arr.forEach((x, i) => m.set(x.c.idx, i + 1)); return m;
    };
    const sorted = [...comps].sort((a, b) => b.total - a.total || b.pins - a.pins || b.teamWins - a.teamWins || a.name.localeCompare(b.name, "pt-BR"));
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
    const alive = new Int32Array(k);
    for (let r = 0; r < runs; r++) {
      let n = k;
      for (let i = 0; i < k; i++) alive[i] = i;
      let round = 0;
      while (n > 1) {
        if ((n <= 3 && round === 0) || n === 3) for (let i = 0; i < n; i++) finals[alive[i]]++;
        let minJ = 0, minV = Infinity;
        for (let j = 0; j < n; j++) {
          const p = params[alive[j]];
          const v = p.mu + p.sigma * randn();
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

  /* ---------------- helpers visuais ---------------- */
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
  const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const codeLabel = (code) => {
    if (code === "0") return "Não disputou";
    if (code === "-") return "Fora da competição";
    const s = data.scoring.find((x) => x.code === code);
    return s ? sentence(s.label) : code;
  };
  const codeText = (code) => (code === "0" ? "·" : code === "-" ? "" : code);
  const initials = (n) => n.replace(/\./g, "").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const avatar = (c) => `<span class="avatar" style="border-color:${seriesColor(c)}">${esc(initials(c.name))}</span>`;
  const pinIcon = (cls = "pin") => `<svg class="${cls}" aria-hidden="true"><use href="#pin"/></svg>`;
  const pinsHtml = (n) => (n ? `<span class="pins" title="${n} pin${n > 1 ? "s" : ""}">${pinIcon().repeat(n)}</span>` : '<span class="dash">—</span>');
  const shortWeek = (label) => label.replace(/^Semana\s*/i, "S").replace(/^Repescagem$/i, "Rep");
  const statusText = (c) => (c.eliminated ? `Eliminado · ${data.weeks[c.outWeek].label}` : c.wasOut ? "Na disputa · voltou" : "Na disputa");
  const statusClass = (c) => (c.eliminated ? "off" : c.wasOut ? "back" : "");
  const icons = {
    trophy: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.7V7Zm10 0v2.7A2 2 0 0 0 18 8V7h-1Z"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m12 4 7 7-1.4 1.4-4.6-4.6V20h-2V7.8l-4.6 4.6L5 11l7-7Z"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm3.5 5.1L12 10.6 8.5 7.1 7.1 8.5l3.5 3.5-3.5 3.5 1.4 1.4 3.5-3.5 3.5 3.5 1.4-1.4-3.5-3.5 3.5-3.5-1.4-1.4Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 20V4h2v14h14v2H4Zm4-4v-5h3v5H8Zm5 0V7h3v9h-3Z"/></svg>',
  };

  /* ---------------- render: topo ---------------- */
  function renderHeader() {
    const sel = $("#editionSelect");
    sel.innerHTML = editions.map((e) => `<option value="${esc(e.id)}"${data && e.id === data.id ? " selected" : ""}>${esc(e.title)}</option>`).join("");
    $("#edTitle").textContent = "Placar";
    document.title = data ? `Placar ${data.title}` : "Placar MasterChef";
    if (!data) { $("#subtitle").textContent = "Nenhuma edição cadastrada"; return; }
    const w = model.currentWeek;
    $("#subtitle").textContent = w >= 0
      ? `${model.active.length} na disputa · atualizado até ${data.weeks[w].label.toLowerCase()}`
      : `${data.competitors.length} participantes · ainda sem resultados`;
  }

  /* ---------------- render: pódio + semana ---------------- */
  function renderPodium() {
    if (model.currentWeek < 0) {
      $("#podium").innerHTML = `<div class="card empty-state" style="grid-column:1/-1">
        <h3>${esc(data.title)} ainda não começou</h3>
        <p>${data.competitors.length ? `${data.competitors.length} participantes cadastrados. Lance o primeiro episódio para o placar aparecer.` : "Cadastre os participantes na aba Edições."}</p>
        <button class="btn" data-goto="${data.competitors.length ? "lancar" : "edicoes"}">${data.competitors.length ? "Lançar o 1º episódio" : "Cadastrar participantes"}</button></div>`;
      return;
    }
    const top = model.sorted.filter((c) => !c.eliminated).slice(0, 3);
    const leader = top[0];
    const order = [top[1], top[0], top[2]]; // 2º · 1º · 3º como num pódio
    const place = [2, 1, 3];
    $("#podium").innerHTML = order.map((c, i) => {
      if (!c) return "<div></div>";
      const diff = leader ? leader.total - c.total : 0;
      const gap = c === leader ? "líder" : diff === 0 ? "empatado com o líder" : `${fmt(diff)} pt${diff === 1 ? "" : "s"} do líder`;
      return `<div class="pod p${place[i]}">
        <span class="place">${place[i]}º</span>
        ${avatar(c)}
        <div class="nm">${esc(c.name)}</div>
        <div class="pts num">${fmt(c.total)}<small>pts</small></div>
        <div class="meta">${pinsHtml(c.pins)}<span>${gap}</span></div>
      </div>`;
    }).join("");
  }

  function renderWeekCard() {
    const w = model.currentWeek;
    if (w < 0) { $("#weekCard").innerHTML = '<div class="eyebrow">Último episódio</div><h3>Sem resultados ainda</h3>'; return; }
    const wk = data.weeks[w];
    const inWeek = (c, pred) => [c.results[2 * w], c.results[2 * w + 1]].some(pred);
    const pinners = model.comps.filter((c) => inWeek(c, (k) => k === "V"));
    const out = model.comps.filter((c) => inWeek(c, (k) => OUT.has(k)));
    const best = [...model.comps].filter((c) => c.weekly[w] != null).sort((a, b) => b.weekly[w] - a.weekly[w])[0];
    const climber = w > 0 ? [...model.comps].filter((c) => !c.eliminated).sort((a, b) => (b.prevPos - b.pos) - (a.prevPos - a.pos))[0] : null;
    const climb = climber ? climber.prevPos - climber.pos : 0;
    const fav = sim && sim.rows[0];
    const names = (list) => list.map((c) => esc(c.name)).join(", ");
    const facts = [
      { ico: pinIcon(), lbl: "Pins da semana", val: pinners.length ? names(pinners) : "Ninguém venceu sozinho", side: "" },
      { ico: icons.out, lbl: "Eliminado", val: out.length ? names(out) : "Ninguém saiu", side: "" },
      best && { ico: icons.trophy, lbl: "Maior pontuação", val: esc(best.name), side: `${signed(best.weekly[w])} pts` },
      climb > 0 && { ico: icons.up, lbl: "Maior subida", val: esc(climber.name), side: `${climber.prevPos}º → ${climber.pos}º` },
      fav && { ico: icons.chart, lbl: "Favorito nas estatísticas", val: esc(fav.c.name), side: `${pct(fav.win)} de chance · <button class="link-btn" data-goto="estatisticas">ver estatísticas</button>`, wide: true },
    ].filter(Boolean);
    $("#weekCard").innerHTML = `
      <div><div class="eyebrow">Último episódio</div><h3>${esc(wk.label)}</h3>
      <p class="hint">${wk.provas.filter(Boolean).map(esc).join(" · ")}</p></div>
      <div class="facts">${facts.map((f) => `<div class="fact ${f.wide ? "wide" : ""}"><span class="ico">${f.ico}</span><div><div class="lbl">${f.lbl}</div><div class="val">${f.val}</div></div><div class="side">${f.side}</div></div>`).join("")}</div>`;
  }

  /* ---------------- render: classificação ---------------- */
  function renderRanking() {
    const only = $("#onlyActive").checked;
    const rows = model.sorted.filter((c) => !only || !c.eliminated);
    const w = model.currentWeek;
    const weeks = data.weeks.slice(0, w + 1);
    const move = (c) => {
      const d = c.prevPos - c.pos;
      if (w <= 0 || d === 0) return `<span class="move same" title="Mesma posição do episódio anterior">–</span>`;
      return d > 0 ? `<span class="move up" title="Subiu ${d}">▲${d}</span>` : `<span class="move down" title="Caiu ${-d}">▼${-d}</span>`;
    };
    const rk = (c, i) => {
      if (!c.present[i]) return `<span class="rk none">·</span>`;
      const r = c.rankHistory[i];
      const tip = `${esc(c.name)} · ${esc(data.weeks[i].label)}<br><b>${r}º lugar</b> · ${fmt(c.cum[i])} pts${c.weekly[i] != null ? ` (${signed(c.weekly[i])} na semana)` : ""}`;
      return `<span class="rk ${r <= 3 ? "r" + r : ""} ${i === w ? "last" : ""}" data-tip="${esc(tip)}">${r}</span>`;
    };
    $("#rankTable").innerHTML = `
      <thead><tr>
        <th>#</th><th></th><th>Competidor</th><th class="r">Pontos</th><th>Pins</th><th class="c" title="Vitórias em equipe e duelos">Vit. equipe</th>
        ${weeks.map((x, i) => `<th class="wk ${i === 0 ? "sep" : ""}" title="${esc(x.label)}">${esc(shortWeek(x.label))}</th>`).join("")}
      </tr></thead>
      <tbody>${rows.map((c) => `
        <tr class="${c.eliminated ? "out" : ""}">
          <td class="pos ${w >= 0 && c.pos <= 3 && !c.eliminated ? "top" : ""} num">${w >= 0 ? c.pos + "º" : "–"}</td>
          <td>${move(c)}</td>
          <td><div class="who">${avatar(c)}<div><div class="nm">${esc(c.name)}</div><div class="st ${statusClass(c)}">${statusText(c)}</div></div></div></td>
          <td class="r"><span class="pts-big num">${fmt(c.total)}</span>
            ${w > 0 && !c.eliminated ? ` <span class="chip-delta ${c.delta > 0 ? "plus" : c.delta < 0 ? "minus" : ""}" title="Pontos no último episódio">${signed(c.delta)}</span>` : ""}</td>
          <td>${pinsHtml(c.pins)}</td>
          <td class="c num">${c.teamWins}</td>
          ${weeks.map((_, i) => `<td class="wk ${i === 0 ? "sep" : ""}">${rk(c, i)}</td>`).join("")}
        </tr>`).join("")}</tbody>`;
  }

  function renderBoard() {
    const shownW = Math.max(model.currentWeek + 1, 1);
    const weeks = data.weeks.slice(0, shownW);
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
            const p = model.pts[code];
            const tip = `${esc(c.name)} · ${esc(data.weeks[w].label)} · ${esc(data.weeks[w].provas[i % 2] || "prova")}<br><b>${esc(codeLabel(code))}</b>${p != null ? ` · ${signed(p)} pts` : ""}`;
            return `<td><span class="code ${codeClass(code)} ${code === "V" ? "win" : ""}" data-tip="${tip}">${esc(codeText(code))}</span></td>`;
          }).join("")}
          <td class="tot num">${fmt(c.total)}</td>
        </tr>`).join("")}</tbody>`;

    const used = new Set(model.comps.flatMap((c) => c.results));
    $("#codeLegend").innerHTML = data.scoring.filter((s) => used.has(s.code))
      .sort((a, b) => b.pts - a.pts)
      .map((s) => `<span class="item"><span class="code ${codeClass(s.code)} ${s.code === "V" ? "win" : ""}">${esc(s.code)}</span>${esc(s.label.toLowerCase())} (${signed(s.pts)})</span>`).join("")
      + `<span class="item"><span class="code c-none">·</span>não disputou</span><span class="item"><span class="code c-gone"></span>fora</span>`;
  }

  /* ---------------- charts ---------------- */
  function chartDefaults() {
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.animation.duration = 450;
    Chart.defaults.color = css("--text-secondary");
    Chart.defaults.borderColor = css("--grid-line");
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = css("--text-primary"); tt.titleColor = css("--bg"); tt.bodyColor = css("--bg");
    tt.padding = 10; tt.cornerRadius = 9; tt.boxPadding = 4; tt.usePointStyle = true;
    const lg = Chart.defaults.plugins.legend.labels;
    lg.usePointStyle = true; lg.boxWidth = 8; lg.boxHeight = 8;
  }
  const destroy = (k) => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } };

  // rótulo direto no fim de cada linha ativa, empurrando para não sobrepor
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(chart) {
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
      for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
      ctx.save();
      ctx.font = "600 11.5px Inter, sans-serif";
      ctx.fillStyle = css("--text-primary");
      ctx.textBaseline = "middle";
      items.forEach((it) => ctx.fillText(it.text, Math.min(it.x + 9, chartArea.right + 8), it.y));
      ctx.restore();
    },
  };

  function renderEvo() {
    destroy("evo");
    const w = model.currentWeek;
    if (w < 0) { $("#evoHint").textContent = "O gráfico aparece depois do 1º episódio lançado."; return; }
    const labels = data.weeks.slice(0, w + 1).map((x) => shortWeek(x.label));
    const title = (it) => data.weeks[it[0].dataIndex].label;
    const line = (c, values, muted) => ({
      label: c.name, _label: !muted, data: values,
      borderColor: seriesColor(c), backgroundColor: seriesColor(c),
      borderWidth: muted ? 1.5 : 2.5, pointRadius: muted ? 0 : 3, pointHoverRadius: 5,
      pointBorderColor: css("--surface-1"), pointBorderWidth: 1.5,
      cubicInterpolationMode: "monotone", spanGaps: false, clip: false, order: muted ? 2 : 1,
    });
    const base = {
      maintainAspectRatio: false, layout: { padding: { right: 84, top: 8 } },
      interaction: { mode: "index", intersect: false },
    };
    $("#showEliminatedWrap").hidden = evoMode !== "cum";
    if (evoMode === "rank") {
      $("#evoHint").textContent = "Posição de quem está na disputa, episódio a episódio. 1º lugar no topo.";
      const n = model.comps.length;
      charts.evo = new Chart($("#evoChart"), {
        type: "line", plugins: [endLabels],
        data: { labels, datasets: model.active.map((c) => line(c, c.rankHistory.map((r, i) => (c.present[i] ? r : null)), false)) },
        options: {
          ...base,
          scales: {
            y: { reverse: true, min: 1, max: n, afterBuildTicks: (ax) => { ax.ticks = Array.from({ length: n }, (_, i) => ({ value: i + 1 })); }, ticks: { autoSkip: false, callback: (v) => v + "º" }, grid: { color: css("--grid-line") } },
            x: { grid: { display: false } },
          },
          plugins: {
            legend: { position: "bottom" },
            tooltip: { itemSort: (a, b) => a.parsed.y - b.parsed.y, callbacks: { title, label: (it) => ` ${it.parsed.y}º · ${it.dataset.label}` } },
          },
        },
      });
    } else {
      $("#evoHint").textContent = "Pontos somados ao longo da temporada. Em cinza, quem já saiu.";
      const showOut = $("#showEliminated").checked;
      const list = model.comps.filter((c) => showOut || !c.eliminated).sort((a, b) => (a.eliminated - b.eliminated) || b.total - a.total);
      charts.evo = new Chart($("#evoChart"), {
        type: "line", plugins: [endLabels],
        data: { labels, datasets: list.map((c) => line(c, c.cum.slice(0, w + 1).map((v, i) => (c.present[i] ? v : null)), c.eliminated)) },
        options: {
          ...base,
          scales: { y: { beginAtZero: true, grid: { color: css("--grid-line") }, title: { display: true, text: "pontos acumulados" } }, x: { grid: { display: false } } },
          plugins: {
            legend: { position: "bottom", labels: { filter: (it, d) => d.datasets[it.datasetIndex]._label } },
            tooltip: {
              itemSort: (a, b) => b.parsed.y - a.parsed.y,
              filter: (it) => it.parsed.y != null && it.dataset._label,
              callbacks: { title, label: (it) => ` ${it.dataset.label}: ${fmt(it.parsed.y)} pts` },
            },
          },
        },
      });
    }
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
        datasets: [{ label: "Chance de vencer", data: rows.map((r) => r.win * 100), backgroundColor: rows.map((r) => seriesColor(r.c)), borderRadius: 4, borderSkipped: "start", barThickness: 22 }],
      },
      plugins: [valueLabels],
      options: {
        indexAxis: "y", maintainAspectRatio: false, layout: { padding: { right: 48 } },
        scales: {
          x: { beginAtZero: true, suggestedMax: Math.min(100, Math.max(...rows.map((r) => r.win * 100)) * 1.1), ticks: { callback: (v) => v + "%" }, grid: { color: css("--grid-line") } },
          y: { grid: { display: false }, ticks: { color: css("--text-primary"), font: { weight: 600 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (it) => { const r = rows[it.dataIndex]; return [` Vencer: ${pct(r.win)}`, ` Chegar à final (top 3): ${pct(r.final)}`, ` Sair na próxima eliminação: ${pct(r.nextOut)}`]; } } },
        },
      },
    });
    $("#predHint").textContent = model.currentWeek >= 0 ? `${fmt(sim.runs)} temporadas simuladas a partir de ${data.weeks[model.currentWeek].label}` : "Sem resultados ainda: por enquanto, todos têm a mesma chance.";
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
        <th class="r">Média/sem.</th><th class="r">Fase recente</th><th class="r">Oscilação (±)</th><th class="r">Consistência</th><th>Pins</th>
      </tr></thead>
      <tbody>${sim.rows.map((r) => `
        <tr>
          <td><div class="who">${avatar(r.c)}<div class="nm">${esc(r.c.name)}</div></div></td>
          <td><div class="bar-cell"><div class="track"><div class="fill" style="width:${(r.win / maxWin) * 100}%;background:${seriesColor(r.c)}"></div></div><b class="num">${pct(r.win)}</b></div></td>
          <td class="r num">${pct(r.final)}</td>
          <td class="r num">${pct(r.nextOut)}</td>
          <td class="r num">${fmt(r.c.mean, 1)}</td>
          <td class="r num">${fmt(r.c.recent, 1)}</td>
          <td class="r num">${fmt(r.c.sd, 1)}</td>
          <td class="r num">${fmt(r.c.consistency * 100, 0)}%</td>
          <td>${pinsHtml(r.c.pins)}</td>
        </tr>`).join("")}</tbody>`;
  }

  /* ---------------- lançar resultados ---------------- */
  function defaultEditWeek() {
    const next = model.currentWeek + 1;
    return next < data.weeks.length ? next : Math.max(0, model.currentWeek);
  }

  function renderWeekPicker() {
    if (editWeek == null) editWeek = defaultEditWeek();
    const hasData = (w) => data.competitors.some((c) => [c.results[2 * w], c.results[2 * w + 1]].some((k) => model.pts[k] != null));
    const next = model.currentWeek + 1;
    $("#weekPicker").innerHTML = data.weeks.map((w, i) =>
      `<button data-wk="${i}" aria-pressed="${editWeek === i}" class="${hasData(i) ? "done" : ""} ${i === next ? "next" : ""}" title="${esc(w.label)}${w.provas.some(Boolean) ? " · " + esc(w.provas.filter(Boolean).join(" / ")) : ""}">${esc(shortWeek(w.label))}${i === next ? " · próximo" : ""}</button>`).join("")
      + `<button data-wk="all" aria-pressed="${editWeek === "all"}">Todas</button>`;
  }

  const cellBtn = (ci, i) => {
    const code = data.competitors[ci].results[i];
    return `<button class="cell-btn code ${codeClass(code)} ${code === "V" ? "win" : ""}" data-c="${ci}" data-i="${i}" aria-haspopup="dialog" aria-label="${esc(data.competitors[ci].name)}: ${esc(codeLabel(code))}">${esc(codeText(code)) || "–"}</button>`;
  };

  function renderEdit() {
    renderWeekPicker();
    const showOut = $("#editShowOut").checked;
    const table = $("#editTable");
    const head = $("#editHead");
    if (editWeek === "all") {
      head.hidden = true;
      table.className = "grid edit";
      const weeks = data.weeks;
      table.innerHTML = `
        <thead>
          <tr class="weeks"><th class="name"></th>${weeks.map((w) => `<th colspan="2">${esc(w.label)}</th>`).join("")}<th></th><th></th></tr>
          <tr class="provas"><th class="name">Competidor</th>${weeks.map((w) => w.provas.map((p) => `<th>${esc(p || "—")}</th>`).join("")).join("")}<th>Total</th><th></th></tr>
        </thead>
        <tbody>${data.competitors.map((c, ci) => ({ c, ci, m: model.comps[ci] })).filter((r) => showOut || !r.m.eliminated).map(({ c, ci, m }) => `
          <tr>
            <td class="name"><input class="name-input" data-name="${ci}" value="${esc(c.name)}" aria-label="Nome"></td>
            ${c.results.map((_, i) => `<td>${cellBtn(ci, i)}</td>`).join("")}
            <td class="tot num">${fmt(m.total)}</td>
            <td><button class="del-btn" data-del="${ci}" title="Remover ${esc(c.name)}" aria-label="Remover ${esc(c.name)}">×</button></td>
          </tr>`).join("")}</tbody>`;
      return;
    }
    const w = editWeek;
    const wk = data.weeks[w];
    head.hidden = false;
    head.innerHTML = `
      <div class="field"><label for="wkLabel">Episódio</label><input class="input" id="wkLabel" data-week="${w}" value="${esc(wk.label)}"></div>
      <div class="field"><label for="pv0">1ª prova</label><input class="input" id="pv0" data-prova="${w}-0" value="${esc(wk.provas[0] || "")}" placeholder="ex.: Caixa misteriosa"></div>
      <div class="field"><label for="pv1">2ª prova</label><input class="input" id="pv1" data-prova="${w}-1" value="${esc(wk.provas[1] || "")}" placeholder="ex.: Prova de eliminação"></div>`;
    table.className = "grid edit single";
    // quem estava na competição nessa semana: não tem "–" nas duas provas
    const inComp = (c) => [c.results[2 * w], c.results[2 * w + 1]].some((k) => k !== "-");
    const rows = data.competitors.map((c, ci) => ({ c, ci, m: model.comps[ci] }))
      .filter((r) => showOut || inComp(r.c))
      .sort((a, b) => a.m.pos - b.m.pos);
    const withLabel = (ci, i) => {
      const code = data.competitors[ci].results[i];
      const lbl = code === "0" ? "não disputou" : code === "-" ? "fora" : codeLabel(code).toLowerCase();
      return `<button class="cell-btn code ${codeClass(code)} ${code === "V" ? "win" : ""}" data-c="${ci}" data-i="${i}" aria-haspopup="dialog" aria-label="${esc(data.competitors[ci].name)}, ${esc(wk.provas[i % 2] || "prova " + (i % 2 + 1))}: ${esc(lbl)}">
        <span>${code === "0" ? "Escolher" : code === "-" ? "Fora" : esc(code)}<span class="lbl">${code === "0" || code === "-" ? "" : esc(lbl)}</span></span></button>`;
    };
    table.innerHTML = `
      <thead><tr><th class="name">Competidor</th><th>${esc(wk.provas[0] || "1ª prova")}</th><th>${esc(wk.provas[1] || "2ª prova")}</th><th>Semana</th><th>Total</th></tr></thead>
      <tbody>${rows.map(({ c, ci, m }) => `
        <tr>
          <td class="name"><div class="who">${avatar(m)}${esc(c.name)}</div></td>
          <td>${withLabel(ci, 2 * w)}</td>
          <td>${withLabel(ci, 2 * w + 1)}</td>
          <td class="wtot num">${m.weekly[w] != null ? signed(m.weekly[w]) : '<span class="dash">—</span>'}</td>
          <td class="wtot num">${fmt(m.total)}</td>
        </tr>`).join("")}</tbody>`;
  }

  /* picker de código */
  let pickerTarget = null;
  function openPicker(btn) {
    closePicker();
    pickerTarget = { c: +btn.dataset.c, i: +btn.dataset.i };
    btn.classList.add("open");
    const cur = data.competitors[pickerTarget.c].results[pickerTarget.i];
    const sc = [...data.scoring].sort((a, b) => b.pts - a.pts);
    const groups = [
      ["Vitórias e destaques", sc.filter((s) => s.pts >= 5 && !OUT.has(s.code))],
      ["Somam pouco", sc.filter((s) => s.pts > 0 && s.pts < 5 && !OUT.has(s.code))],
      ["Neutros", sc.filter((s) => s.pts === 0 && !OUT.has(s.code))],
      ["Tiram pontos", sc.filter((s) => s.pts < 0 && !OUT.has(s.code))],
      ["Saída", sc.filter((s) => OUT.has(s.code))],
    ].filter(([, l]) => l.length);
    const opt = (code, label, ptsTxt) => `<button data-code="${esc(code)}" class="${code === cur ? "sel" : ""}"><span class="code ${codeClass(code)} ${code === "V" ? "win" : ""}">${esc(codeText(code)) || "–"}</span><span>${esc(label)}</span><span class="pts">${ptsTxt}</span></button>`;
    const pk = $("#picker");
    const c = data.competitors[pickerTarget.c];
    const w = Math.floor(pickerTarget.i / 2);
    pk.innerHTML = `<div class="grp" style="text-transform:none;letter-spacing:0;font-size:12px;color:var(--text-secondary)">${esc(c.name)} · ${esc(data.weeks[w].provas[pickerTarget.i % 2] || data.weeks[w].label)}</div>`
      + groups.map(([g, l]) => `<div class="grp">${g}</div>` + l.map((s) => opt(s.code, sentence(s.label), signed(s.pts))).join("")).join("")
      + `<div class="grp">Sem resultado</div>` + opt("0", "Não disputou / em branco", "") + opt("-", "Fora da competição", "");
    pk.hidden = false;
    const r = btn.getBoundingClientRect();
    const pw = pk.offsetWidth, ph = pk.offsetHeight;
    let left = r.left + scrollX;
    if (left + pw > scrollX + innerWidth - 12) left = scrollX + innerWidth - pw - 12;
    let top = r.bottom + scrollY + 6;
    if (r.bottom + ph + 6 > innerHeight && r.top - ph - 6 > 0) top = r.top + scrollY - ph - 6;
    pk.style.left = Math.max(12, left) + "px"; pk.style.top = top + "px";
    (pk.querySelector("button.sel") || pk.querySelector("button")).focus();
  }
  function closePicker() {
    $("#picker").hidden = true;
    $$(".cell-btn.open").forEach((b) => b.classList.remove("open"));
    pickerTarget = null;
  }
  function applyCode(code) {
    const { c, i } = pickerTarget;
    closePicker();
    data.competitors[c].results[i] = code;
    save(); refresh();
    // foco na próxima célula da mesma coluna, para lançar em sequência
    const btns = $$("#editTable .cell-btn");
    const idx = btns.findIndex((b) => +b.dataset.c === c && +b.dataset.i === i);
    const sameCol = btns.filter((b) => +b.dataset.i === i);
    const nextBtn = sameCol[sameCol.indexOf(btns[idx]) + 1];
    (nextBtn || btns[idx])?.focus();
  }

  function renderRules() {
    $("#rulesTable").innerHTML = `
      <thead><tr><th>Código</th><th>Resultado</th><th class="r">Pontos</th></tr></thead>
      <tbody>${[...data.scoring].sort((a, b) => b.pts - a.pts).map((s) => `
        <tr><td><span class="code ${codeClass(s.code)} ${s.code === "V" ? "win" : ""}" style="width:48px">${esc(s.code)}</span></td>
        <td>${esc(sentence(s.label))}${s.code === "V" ? ` ${pinIcon()}` : ""}</td>
        <td class="r"><input class="input num" type="number" data-rule="${esc(s.code)}" value="${s.pts}" style="min-width:0;width:74px;text-align:right" aria-label="Pontos de ${esc(s.code)}"></td></tr>`).join("")}</tbody>`;
  }

  /* ---------------- edições: painel ---------------- */
  const DEFAULT_SCORING = [
    ["V", "VITÓRIA INDIVIDUAL", 10], ["VDP", "VITÓRIA EMPATE", 10], ["VR", "VENCEU A REPESCAGEM", 10],
    ["VD", "VITÓRIA EM DUELO", 9], ["VLE", "VITÓRIA LÍDER DE EQUIPE", 9], ["VE", "VITÓRIA EM EQUIPE", 8],
    ["M", "MELHORES", 7], ["VP", "VITÓRIA EM PROVA DE PRESSÃO", 6], ["S", "SALVO", 5], ["PS", "PODER DE SALVAR", 5],
    ["DS", "DUPLA SALVA", 5], ["P", "PIORES", 4], ["E", "ELIMINADO", 0], ["D", "DESISTÊNCIA", 0], ["I", "IMUNE", 0],
    ["PP", "PROVA DE PRESSÃO", -1], ["PE", "PROVA DE ELIMINAÇÃO", -1], ["DE", "DERROTA EM EQUIPE", -1],
    ["ED", "ELIMINAÇÃO DIRETA", -2], ["DLE", "DERROTA LÍDER EQUIPE", -2],
  ].map(([code, label, pts]) => ({ code, label, pts }));
  const weekLabel = (n) => `Semana ${String(n).padStart(2, "0")}`;
  const titleFromFile = (name) => name.replace(/\.[^.]+$/, "").replace(/^\s*tabela\s+/i, "").trim().toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase()).replace(/masterchef/i, "MasterChef");

  function addEdition(ed) {
    ed.id = uniqueId(ed.title);
    local.eds[ed.id] = { base: null, data: ed };
    saveLocal();
    editions = mergeEditions();
    openEdition(ed.id);
  }

  function renderEditions() {
    const def = defaultId();
    const rows = editions.map((e) => {
      const m = e === data ? model : compute(e);
      const w = m.currentWeek;
      const leader = w >= 0 ? m.sorted.find((c) => !c.eliminated) : null;
      const st = edStatus(e.id);
      const isOpen = data && e.id === data.id;
      const badges = [
        e.id === def ? '<span class="badge gold">padrão do site</span>' : "",
        isOpen ? '<span class="badge cur">aberta</span>' : "",
        st === "local" ? '<span class="badge warn" title="Baixe o data.js e publique para aparecer no site">só neste navegador</span>' : "",
        st === "changed" ? '<span class="badge warn" title="Baixe o data.js e publique para aparecer no site">alterada neste navegador</span>' : "",
      ].join("");
      return `<tr>
        <td><b>${esc(e.title)}</b>${badges}</td>
        <td class="c num">${e.competitors.length}</td>
        <td class="c num">${w + 1} / ${e.weeks.length}</td>
        <td>${leader ? `${esc(leader.name)} · ${fmt(leader.total)} pts` : '<span class="dash">—</span>'}</td>
        <td><div class="row-actions">
          ${isOpen ? "" : `<button class="btn sm" data-ed-open="${esc(e.id)}">Abrir</button>`}
          ${e.id === def ? "" : `<button class="btn ghost sm" data-ed-default="${esc(e.id)}">Tornar padrão</button>`}
          <button class="btn ghost sm" data-ed-xlsx="${esc(e.id)}">Planilha</button>
          <button class="btn danger sm" data-ed-del="${esc(e.id)}">Excluir</button>
        </div></td>
      </tr>`;
    }).join("");
    $("#editionsTable").innerHTML = `
      <thead><tr><th>Edição</th><th class="c">Participantes</th><th class="c">Episódios</th><th>Líder</th><th class="r">Ações</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">Nenhuma edição ainda. Crie a primeira abaixo.</td></tr>'}</tbody>`;

    const sc = $("#neScoring"), keep = sc.value;
    sc.innerHTML = editions.map((e) => `<option value="${esc(e.id)}">Copiar de ${esc(e.title)}</option>`).join("") + '<option value="__default">Tabela padrão</option>';
    if ([...sc.options].some((o) => o.value === keep)) sc.value = keep; else if (data) sc.value = data.id;

    $("#peopleEdTitle").textContent = data ? data.title : "—";
    $("#addPersonForm").hidden = !data;
    $("#weeksCount").textContent = data ? data.weeks.length : 0;
    $("#addWeek").disabled = $("#removeWeek").disabled = !data;
    $("#peopleList").innerHTML = !data ? '<li class="empty">Abra ou crie uma edição.</li>'
      : !data.competitors.length ? '<li class="empty">Nenhum participante ainda.</li>'
      : data.competitors.map((c, ci) => {
        const m = model.comps[ci];
        return `<li>${avatar(m)}<input data-person="${ci}" value="${esc(c.name)}" aria-label="Nome">
          <span class="st">${m.provasPlayed ? `${fmt(m.total)} pts` : "sem resultados"}</span>
          <button class="del-btn" data-person-del="${ci}" title="Remover ${esc(c.name)}" aria-label="Remover ${esc(c.name)}">×</button></li>`;
      }).join("");
    const btn = $("#resetData");
    const st = data ? edStatus(data.id) : "published";
    btn.disabled = st !== "changed";
    btn.title = st === "local" ? "Edição criada neste navegador: não há versão publicada para voltar" : st === "published" ? "Nada alterado nesta edição" : "";
  }

  /* planilha no mesmo formato da aba Placar original (o importador e o publicar.bat leem de volta) */
  function exportXlsx(ed) {
    if (typeof XLSX === "undefined") { flash("Gerador de planilhas não carregou (sem internet?)."); return; }
    const m = compute(ed);
    const nW = ed.weeks.length, first = 7; // coluna H
    const rows = [[], []];
    rows[0][0] = "PLACAR"; rows[1][0] = "POSIÇÃO"; rows[1][2] = "COMPETIDORES"; rows[1][4] = "PINS"; rows[1][5] = "PONT."; rows[1][6] = "VIT. EQP.";
    ed.weeks.forEach((w, i) => {
      rows[0][first + 2 * i] = i === 0 ? "SEMANA 01" : w.label.toUpperCase(); // o importador procura "SEMANA 01"
      rows[1][first + 2 * i] = (w.provas[0] || "").toUpperCase();
      rows[1][first + 2 * i + 1] = (w.provas[1] || "").toUpperCase();
    });
    m.sorted.forEach((c, r) => {
      const row = (rows[r + 2] = rows[r + 2] || []);
      row[0] = c.pos; row[3] = c.name; row[4] = c.pins; row[5] = c.total; row[6] = c.teamWins;
      c.results.forEach((k, i) => (row[first + i] = k === "0" ? 0 : k));
    });
    const tc = first + 2 * nW + 2; // tabela de pontuação ao lado
    rows[0][tc] = "TABELA DE PONTUAÇÕES";
    ed.scoring.forEach((s, i) => { const row = (rows[i + 1] = rows[i + 1] || []); row[tc] = s.label; row[tc + 3] = s.code; row[tc + 4] = s.pts; });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = Array.from({ length: tc + 5 }, (_, i) => ({ wch: i === 3 ? 16 : i >= first && i < first + 2 * nW ? 7 : i === tc ? 30 : 6 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Placar");
    XLSX.writeFile(wb, `TABELA ${ed.title.toUpperCase()}.xlsx`);
  }

  /* ---------------- orquestração ---------------- */
  function runSim() { sim = simulate(model, Number($("#momentum").value) / 100, Number($("#sims").value)); }

  function renderVisibleCharts() {
    if (typeof Chart === "undefined") return;
    if (activeTab === "placar") renderEvo();
    if (activeTab === "estatisticas") { renderProbChart(); renderScatter(); }
  }

  function refresh() {
    const none = !data;
    $$(".tabs button").forEach((b) => { if (b.dataset.tab !== "edicoes") b.disabled = none; });
    if (none) {
      renderHeader(); renderEditions();
      if (activeTab !== "edicoes") bind.showTab("edicoes");
      return;
    }
    model = compute(data);
    runSim();
    renderHeader(); renderPodium(); renderWeekCard(); renderRanking(); renderBoard();
    renderPredTable(); renderRules(); renderEdit(); renderEditions();
    renderVisibleCharts();
  }

  function flash(msg) {
    const els = $$("#statusMsg, #neMsg"); els.forEach((el) => (el.textContent = msg));
    clearTimeout(flash.t); flash.t = setTimeout(() => els.forEach((el) => (el.textContent = "")), 6000);
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
      if (!lab || (/^SEMANA$/i.test(String(lab).trim()) && c > firstCol + 2)) break;
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
    let scoring = clone((data && data.scoring) || DEFAULT_SCORING);
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
      closePicker();
      renderVisibleCharts();
    };
    const goTab = (name) => { history.replaceState(null, "", "#" + name); showTab(name); scrollTo({ top: 0 }); };
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => goTab(b.dataset.tab)));
    addEventListener("hashchange", () => showTab(location.hash.slice(1)));
    document.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) goTab(g.dataset.goto); });
    bind.showTab = showTab;
    bind.goTab = goTab;

    $("#onlyActive").addEventListener("change", () => { renderRanking(); renderBoard(); });
    $$(".seg [data-evo]").forEach((b) => b.addEventListener("click", () => {
      evoMode = b.dataset.evo;
      $$(".seg [data-evo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderEvo();
    }));
    $("#showEliminated").addEventListener("change", renderEvo);

    $("#momentum").addEventListener("input", () => { $("#momentumOut").textContent = $("#momentum").value + "%"; });
    $("#sims").addEventListener("input", () => { $("#simsOut").textContent = fmt(Number($("#sims").value)); });
    const resim = () => { runSim(); renderWeekCard(); renderPredTable(); renderVisibleCharts(); };
    $("#momentum").addEventListener("change", resim);
    $("#sims").addEventListener("change", resim);
    $("#rerun").addEventListener("click", resim);

    // lançar
    $("#weekPicker").addEventListener("click", (e) => {
      const b = e.target.closest("[data-wk]"); if (!b) return;
      editWeek = b.dataset.wk === "all" ? "all" : +b.dataset.wk;
      closePicker(); renderEdit();
    });
    $("#editShowOut").addEventListener("change", renderEdit);
    const panel = $("#tab-lancar");
    panel.addEventListener("click", (e) => {
      const cell = e.target.closest(".cell-btn");
      if (cell) {
        e.stopPropagation();
        if (pickerTarget && pickerTarget.c === +cell.dataset.c && pickerTarget.i === +cell.dataset.i) closePicker(); else openPicker(cell);
        return;
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const c = data.competitors[+del.dataset.del];
        if (!confirm(`Remover ${c.name}?`)) return;
        data.competitors.splice(+del.dataset.del, 1); save(); refresh();
      }
    });
    panel.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("[data-name]")) data.competitors[+t.dataset.name].name = t.value.trim() || "Sem nome";
      else if (t.matches("[data-week]")) data.weeks[+t.dataset.week].label = t.value.trim() || data.weeks[+t.dataset.week].label;
      else if (t.matches("[data-prova]")) { const [wi, pi] = t.dataset.prova.split("-").map(Number); data.weeks[wi].provas[pi] = t.value.trim(); }
      else return;
      save(); refresh();
    });
    $("#picker").addEventListener("click", (e) => { const b = e.target.closest("[data-code]"); if (b && pickerTarget) applyCode(b.dataset.code); });
    $("#picker").addEventListener("keydown", (e) => {
      const btns = $$("#picker button"); const i = btns.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); btns[Math.min(btns.length - 1, i + 1)].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); btns[Math.max(0, i - 1)].focus(); }
    });
    document.addEventListener("click", (e) => { if (pickerTarget && !e.target.closest("#picker")) closePicker(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pickerTarget) {
        const { c, i } = pickerTarget; closePicker();
        $(`#editTable .cell-btn[data-c="${c}"][data-i="${i}"]`)?.focus();
      }
    });
    addEventListener("resize", closePicker);

    $("#rulesTable").addEventListener("change", (e) => {
      const t = e.target; if (!t.matches("[data-rule]")) return;
      const s = data.scoring.find((x) => x.code === t.dataset.rule);
      s.pts = Number(t.value) || 0; save(); refresh();
    });

    const download = (name, text, type) => {
      const blob = new Blob([text], { type });
      const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      link.click(); URL.revokeObjectURL(link.href);
    };
    $("#exportDataJs").addEventListener("click", () => {
      download("data.js", "// Exportado pelo app. Todas as edições do placar.\nwindow.MASTERCHEF_EDITIONS = " + JSON.stringify(bundleForExport(), null, 1) + ";\n", "text/javascript");
      flash("data.js baixado (todas as edições): substitua o arquivo na pasta do projeto e faça o commit.");
    });
    $("#exportJson").addEventListener("click", () => download("placar-edicoes.json", JSON.stringify(bundleForExport(), null, 1), "application/json"));
    $("#exportXlsx").addEventListener("click", () => data && exportXlsx(data));
    const readXlsx = async (f) => {
      if (typeof XLSX === "undefined") throw new Error("Leitor de planilhas não carregou (sem internet?).");
      return parseWorkbook(XLSX.read(await f.arrayBuffer(), { type: "array" }));
    };
    $("#xlsxInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const ed = await readXlsx(f);
        if (!confirm(`Substituir os resultados de “${data.title}” pelos da planilha “${f.name}”?`)) return;
        Object.assign(data, { weeks: ed.weeks, scoring: ed.scoring, competitors: ed.competitors, source: f.name });
        editWeek = null; save(); refresh(); flash(`Planilha “${f.name}” importada: ${data.competitors.length} competidores.`);
      } catch (err) { flash("Erro ao importar: " + err.message); } finally { e.target.value = ""; }
    });
    $("#jsonInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        const list = d.editions ? d.editions : d.weeks ? [{ id: data ? data.id : "importada", title: data ? data.title : "Importada", ...d }] : null;
        if (!list) throw new Error("arquivo sem edições");
        list.forEach((ed) => { normalize(ed); local.eds[ed.id] = { base: published.hashes[ed.id] || null, data: ed }; });
        if (d.default) local.default = d.default;
        saveLocal(); editions = mergeEditions(); openEdition(data ? data.id : list[0].id); refresh();
        flash(`${list.length} edição(ões) carregada(s) de “${f.name}”.`);
      } catch (err) { flash("Erro ao ler JSON: " + err.message); } finally { e.target.value = ""; }
    });
    $("#resetData").addEventListener("click", () => {
      if (!data || edStatus(data.id) !== "changed") return;
      if (!confirm(`Descartar o que foi alterado em “${data.title}” neste navegador e voltar à versão publicada?`)) return;
      const id = data.id; delete local.eds[id]; saveLocal(); editions = mergeEditions(); openEdition(id); refresh(); flash("Versão publicada restaurada.");
    });

    // edições
    $("#editionSelect").addEventListener("change", (e) => { openEdition(e.target.value); refresh(); });
    $("#editionsTable").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.edOpen) { openEdition(b.dataset.edOpen); refresh(); }
      else if (b.dataset.edDefault) {
        local.default = b.dataset.edDefault; saveLocal(); openEdition(data && data.id); refresh();
        flash("Padrão alterado neste navegador. Baixe o data.js e publique para valer no site.");
      } else if (b.dataset.edXlsx) exportXlsx(editions.find((x) => x.id === b.dataset.edXlsx));
      else if (b.dataset.edDel) {
        const ed = editions.find((x) => x.id === b.dataset.edDel);
        if (!confirm(`Excluir a edição “${ed.title}”? Os participantes e resultados dela serão apagados deste navegador.`)) return;
        if (published.hashes[ed.id]) local.deleted.push({ id: ed.id, base: published.hashes[ed.id] });
        delete local.eds[ed.id];
        if (local.default === ed.id) local.default = null;
        saveLocal(); editions = mergeEditions();
        openEdition(data && data.id !== ed.id ? data.id : defaultId()); refresh();
        flash(published.hashes[ed.id] ? "Edição excluída neste navegador. Baixe o data.js e publique para remover do site." : "Edição excluída.");
      }
    });
    const nePeople = () => $("#nePeople").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    $("#nePeople").addEventListener("input", () => { $("#nePeopleCount").textContent = nePeople().length; });
    $("#newEditionForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const title = $("#neTitle").value.trim();
      if (!title) return;
      const n = Math.max(1, Math.min(40, parseInt($("#neWeeks").value, 10) || 15));
      const src = editions.find((x) => x.id === $("#neScoring").value);
      const people = [...new Set(nePeople())];
      addEdition({
        title, source: "criada no app",
        weeks: Array.from({ length: n }, (_, i) => ({ label: weekLabel(i + 1), provas: ["", ""] })),
        scoring: clone(src ? src.scoring : DEFAULT_SCORING),
        competitors: people.map((name) => ({ name, results: Array(n * 2).fill("0") })),
      });
      e.target.reset(); $("#neWeeks").value = 15; $("#nePeopleCount").textContent = "0";
      refresh();
      bind.goTab(people.length ? "lancar" : "edicoes");
      flash(`“${title}” criada. Agora é só lançar os episódios.`);
    });
    $("#newFromXlsx").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const ed = await readXlsx(f);
        ed.title = titleFromFile(f.name) || "Nova edição"; ed.source = f.name;
        addEdition(ed); refresh(); bind.goTab("placar");
      } catch (err) { $("#neMsg").textContent = "Erro ao importar: " + err.message; } finally { e.target.value = ""; }
    });
    $("#peopleList").addEventListener("change", (e) => {
      const t = e.target; if (!t.matches("[data-person]")) return;
      data.competitors[+t.dataset.person].name = t.value.trim() || "Sem nome"; save(); refresh();
    });
    $("#peopleList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-person-del]"); if (!b) return;
      const c = data.competitors[+b.dataset.personDel];
      if (!confirm(`Remover ${c.name} de “${data.title}”? Os resultados dessa pessoa serão apagados.`)) return;
      data.competitors.splice(+b.dataset.personDel, 1); save(); refresh();
    });
    $("#addPersonForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#addPersonName").value.trim(); if (!name || !data) return;
      data.competitors.push({ name, results: Array(data.weeks.length * 2).fill("0") });
      $("#addPersonName").value = ""; save(); refresh(); $("#addPersonName").focus();
    });
    $("#addWeek").addEventListener("click", () => {
      data.weeks.push({ label: weekLabel(data.weeks.length + 1), provas: ["", ""] });
      data.competitors.forEach((c) => c.results.push("0", "0")); save(); refresh();
    });
    $("#removeWeek").addEventListener("click", () => {
      if (data.weeks.length <= 1) return;
      const w = data.weeks.length - 1;
      const used = data.competitors.some((c) => c.results.slice(2 * w).some((k) => k !== "0" && k !== "-"));
      if (used && !confirm(`${data.weeks[w].label} já tem resultados lançados. Remover mesmo assim?`)) return;
      data.weeks.pop(); data.competitors.forEach((c) => c.results.splice(2 * w, 2));
      if (editWeek !== "all" && editWeek >= data.weeks.length) editWeek = null;
      save(); refresh();
    });

    // tema
    const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
    applyTheme(store.get(THEME_KEY));
    const rethemed = () => { if (typeof Chart !== "undefined") chartDefaults(); refresh(); };
    $("#themeToggle").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme;
      const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      applyTheme(next); store.set(THEME_KEY, next); rethemed();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rethemed);

    // tooltip (quadro de provas e posições)
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
  } else {
    chartDefaults();
  }
  bind();
  openEdition(new URL(location.href).searchParams.get("edicao") || defaultId());
  refresh();
  if (location.hash) bind.showTab(location.hash.slice(1));
})();
