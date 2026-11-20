/* Central Fiscal ICMS - interface. Depende de regras.js (window.Fiscal) e JSZip. */
(function () {
  "use strict";
  const F = window.Fiscal;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const moeda = (v) => (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const dataBR = (iso) => iso ? iso.split("-").reverse().join("/") : "";
  const SEV = { erro: "Erro", alerta: "Alerta", verificar: "Verificar" };
  const local = location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);

  const ls = {
    get(k, d) { try { const v = localStorage.getItem("cfi:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("cfi:" + k, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ } },
  };

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------------ dados
  const B = { ncm: null, ncmMap: new Map(), ncmLista: [], cfop: null, cfopMap: new Map(), fcp: null, ufs: {}, ufsMeta: null, cclass: null, cclassMap: new Map(), cest: null, cestPorNcm: new Map(), fontes: {} };

  async function carregarJSON(nome, opcional) {
    for (const prefixo of ["dados/", "../dados/"]) {
      try { const r = await fetch(prefixo + nome); if (r.ok) return await r.json(); } catch (e) { /* tenta o próximo caminho */ }
    }
    if (opcional) return null;
    throw new Error("Não foi possível carregar " + nome);
  }

  async function carregarBase() {
    const [ncm, cfop, fcp, ufs, cclass, fontes, cest] = await Promise.all([
      carregarJSON("ncm.json"), carregarJSON("cfop.json"), carregarJSON("fcp.json"), carregarJSON("curados/ufs.json"),
      carregarJSON("cclasstrib.json"), carregarJSON("fontes.json", true), carregarJSON("cest.json", true),
    ]);
    B.ncm = ncm; B.cfop = cfop; B.fcp = fcp; B.ufsMeta = ufs; B.ufs = ufs.ufs; B.cclass = cclass; B.fontes = fontes || {}; B.cest = cest;
    for (const i of ncm.itens) {
      B.ncmMap.set(i[0], { desc: i[1], ini: i[2], fim: i[3], ato: i[4] });
      if (i[0].length === 8) B.ncmLista.push(i[0]);
    }
    for (const c of cfop.itens) B.cfopMap.set(c.c, c);
    for (const c of cclass.itens) B.cclassMap.set(c.c, c);
    if (cest && cest.itens) for (const c of cest.itens) for (const n of new Set([...c.ncm, ...(c.ncm_anteriores || [])])) { if (!B.cestPorNcm.has(n)) B.cestPorNcm.set(n, []); B.cestPorNcm.get(n).push(c); }
  }

  function caminhoNcm(cod) {
    const out = [];
    for (const k of [2, 4, 5, 6, 7, 8]) {
      const r = B.ncmMap.get(cod.slice(0, k));
      if (r && (!out.length || out[out.length - 1].cod !== cod.slice(0, k))) out.push({ cod: cod.slice(0, k), desc: r.desc, nivel: out.length });
    }
    return out;
  }
  const textoBusca = new Map();
  function textoNcm(cod) {
    if (!textoBusca.has(cod)) textoBusca.set(cod, semAcento(caminhoNcm(cod).map((c) => c.desc.replace(/^[-\s]+/, "")).join(" ")));
    return textoBusca.get(cod);
  }
  const limpa = (s) => s.replace(/^[-\s]+/, "").replace(/[:.]$/, "");
  const descCurta = (cod) => {
    const c = caminhoNcm(cod);
    const ult = c[c.length - 1];
    let d = ult ? limpa(ult.desc) : "";
    if (c.length > 1 && (d.length < 30 || /^(outr[oa]s?|de |em |com |sem |para )/i.test(d))) {
      let pai = limpa(c[c.length - 2].desc);
      if (pai.length > 70) pai = pai.slice(0, 68).replace(/\s+\S*$/, "") + "…";
      d = pai + " › " + d;
    }
    return d;
  };

  function buscarNcm(q) {
    q = q.trim();
    if (!q) return [];
    const dig = q.replace(/[.\s]/g, "");
    if (/^\d+$/.test(dig)) return B.ncmLista.filter((c) => c.startsWith(dig)).slice(0, 60);
    const termos = semAcento(q).split(/\s+/).filter((t) => t.length > 1);
    const out = [];
    for (const c of B.ncmLista) {
      const t = textoNcm(c);
      if (termos.every((x) => t.includes(x))) { out.push(c); if (out.length >= 60) break; }
    }
    return out;
  }

  // ------------------------------------------------------------------ abas
  const ABAS = ["consulta", "auditoria", "apuracao", "base"];
  function mostrarAba() {
    const h = location.hash.replace("#", "");
    const aba = ABAS.includes(h) ? h : "consulta";
    for (const a of ABAS) $("#aba-" + a).hidden = a !== aba;
    for (const l of $$("nav.abas a")) l.setAttribute("aria-current", l.dataset.aba === aba ? "page" : "false");
    if (aba === "apuracao") renderApuracao();
    if (aba === "base" && !$("#resultado-base").childElementCount) renderBase();
  }

  // ------------------------------------------------------------------ CONSULTA
  const estadoConsulta = { ncm: ls.get("ncm", "61091000") };

  function opcoesUF(sel, valor) {
    sel.innerHTML = Object.keys(B.ufs).sort().map((u) => `<option value="${u}">${u} - ${esc(B.ufs[u].nome)}</option>`).join("");
    sel.value = valor;
  }

  function iniciarConsulta() {
    const f = ls.get("form", { ufO: "SP", ufD: "BA", regime: "LP", dest: "revenda", prod: "revenda", orig: "0", st: "nao" });
    opcoesUF($("#op-uf-o"), f.ufO); opcoesUF($("#op-uf-d"), f.ufD);
    $("#op-orig").innerHTML = Object.entries(F.ORIGEM).map(([k, v]) => `<option value="${k}">${k} - ${esc(v)}</option>`).join("");
    $("#op-regime").value = f.regime; $("#op-dest").value = f.dest; $("#op-prod").value = f.prod; $("#op-orig").value = f.orig; $("#op-st").value = f.st;
    const busca = $("#busca-ncm");
    busca.value = F.fmtNcm(estadoConsulta.ncm);
    let t;
    busca.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => listarNcm(busca.value), 120); });
    $("#form-op").addEventListener("change", () => { ls.set("form", lerForm()); renderConsulta(); });
    $("#form-op").addEventListener("submit", (e) => e.preventDefault());
    listarNcm(busca.value);
    renderConsulta();
  }

  function listarNcm(q) {
    const lista = $("#lista-ncm");
    const res = buscarNcm(q);
    if (!q.trim()) { lista.innerHTML = `<div class="vazio">Digite um código ou parte da descrição.</div>`; return; }
    if (!res.length) { lista.innerHTML = `<div class="vazio">Nenhum NCM vigente encontrado para “${esc(q)}”.</div>`; return; }
    lista.innerHTML = res.map((c) => `<button type="button" role="option" data-ncm="${c}" aria-selected="${c === estadoConsulta.ncm}"><span class="cod">${F.fmtNcm(c)}</span><span>${esc(descCurta(c))}</span></button>`).join("");
    for (const b of $$("button", lista)) b.addEventListener("click", () => {
      estadoConsulta.ncm = b.dataset.ncm; ls.set("ncm", b.dataset.ncm);
      for (const x of $$("button", lista)) x.setAttribute("aria-selected", x === b);
      renderConsulta();
    });
    if (res.length === 1 && res[0] !== estadoConsulta.ncm) { estadoConsulta.ncm = res[0]; ls.set("ncm", res[0]); renderConsulta(); }
  }

  const lerForm = () => ({ ufO: $("#op-uf-o").value, ufD: $("#op-uf-d").value, regime: $("#op-regime").value, dest: $("#op-dest").value, prod: $("#op-prod").value, orig: $("#op-orig").value, st: $("#op-st").value });

  function chipStatus(s) { return s === "conferido" ? `<span class="chip ok">conferido</span>` : `<span class="chip alerta">conferir</span>`; }

  function renderConsulta() {
    const alvo = $("#resultado-consulta");
    const cod = estadoConsulta.ncm;
    const reg = B.ncmMap.get(cod);
    const p = { ...lerForm(), ncm: cod };
    $("#dica-st").textContent = p.st === "nao" ? "Se o produto estiver em convênio ou protocolo de ST entre os estados, mude esta opção." : "";
    if (!reg) { alvo.innerHTML = `<div class="painel"><h3>Escolha um NCM</h3><p class="mudo">Busque pelo código ou pela descrição ao lado.</p></div>`; return; }
    const cestDoNcm = F.cestCandidatos(cod, B.cestPorNcm);
    const r = F.parametrizar(p, { ufs: B.ufs, fcp: B.fcp, cestDoNcm });
    const uO = B.ufs[p.ufO], uD = B.ufs[p.ufD];
    const cam = caminhoNcm(cod);
    const fcpTxt = (f, uf) => f.max ? `${f.aliqs.map(F.pct).join(" ou ")}${f.tipo === "max" ? " (até)" : ""}` : "não tem";

    let html = `
    <div class="painel ficha-ncm">
      <div class="acoes" style="justify-content:space-between"><span class="codigo">${F.fmtNcm(cod)}</span><span class="chip neutro">${r.interna ? "Operação interna" : "Operação interestadual"} · ${p.ufO} → ${p.ufD}</span></div>
      <ol class="caminho">${cam.map((c) => `<li style="--n:${c.nivel}"><span class="mono">${esc(F.fmtNcm(c.cod))}</span> ${esc(c.desc)}</li>`).join("")}</ol>
      <div class="pequeno mudo">Vigente desde ${dataBR(reg.ini) || "—"}${reg.fim ? " até " + dataBR(reg.fim) : ""} · ${esc(reg.ato || "")} · Fonte: Siscomex (${esc(B.ncm.situacao)})</div>
    </div>
    <div class="quadro">
      <div><span class="rot">CFOP</span><span class="val">${r.cfop.slice(0, 1)}.${r.cfop.slice(1)}</span><span class="sub">${esc(r.cfopMotivo)}</span></div>
      <div><span class="rot">${r.cstTipo}</span><span class="val">${esc(p.orig)}${r.cst}</span><span class="sub">${esc(r.cstDesc)}${r.cstAlt.length ? `<br>Alternativas: ${r.cstAlt.join(", ")}` : ""}</span></div>
      <div><span class="rot">Alíquota ICMS</span><span class="val">${F.pct(r.aliq.aplicavel)}</span><span class="sub">${r.interna ? `Interna de ${p.ufO} ${chipStatus(r.aliq.statusO)}` : esc(r.aliq.interestadual.motivo)}</span></div>
      <div><span class="rot">Interna no destino</span><span class="val">${F.pct(r.aliq.internaDestino)}</span><span class="sub">${p.ufD} ${chipStatus(r.aliq.statusD)}${uD.obs ? "<br>" + esc(uD.obs) : ""}</span></div>
    </div>`;
    if (r.aliq.nota) html += `<div class="faixa aviso">${esc(r.aliq.nota)}</div>`;

    // DIFAL / FCP / IBS / PIS
    html += `<div class="painel pilha"><h3>DIFAL, FCP, IBS/CBS e PIS/COFINS</h3><ul class="notas">`;
    if (r.difal) {
      html += `<li><span class="chip ${r.difal.devido ? "alerta" : "neutro"}">DIFAL</span><span>${esc(r.difal.txt)}${r.difal.devido ? `<br><span class="mudo pequeno">Exemplo em R$ 1.000,00: base única R$ ${moeda(r.difal.ex.unica)} · base dupla R$ ${moeda(r.difal.ex.dupla)}${r.difal.fcp ? ` · FCP de destino até ${F.pct(r.difal.fcp)} se o produto estiver na lista do fundo` : ""}</span>` : ""}</span></li>`;
    } else html += `<li><span class="chip neutro">DIFAL</span><span>Operação interna: não há DIFAL.</span></li>`;
    html += `<li><span class="chip neutro">FCP</span><span>${p.ufO}: ${fcpTxt(r.fcp.origem)}${r.interna ? "" : ` · ${p.ufD}: ${fcpTxt(r.fcp.destino)}`}. O FCP só incide sobre os produtos listados na lei do fundo de cada estado (em geral bebidas, fumo, cosméticos, armas e outros supérfluos; no RJ alcança a maioria das mercadorias).</span></li>`;
    html += `<li><span class="chip ${r.ibscbs.exigido ? "verificar" : "neutro"}">IBS/CBS</span><span>${r.ibscbs.exigido ? `CST <b class="mono">${r.ibscbs.cst}</b> · cClassTrib <b class="mono">${r.ibscbs.cClassTrib}</b> · CBS ${F.pct(r.ibscbs.pCBS)} · IBS UF ${F.pct(r.ibscbs.pIBSUF)} · IBS Mun ${F.pct(r.ibscbs.pIBSMun)}<br>` : ""}${esc(r.ibscbs.txt)}</span></li>`;
    html += `<li><span class="chip neutro">PIS/COFINS</span><span>CST <b class="mono">${r.pis.cst}</b>${r.pis.pPIS ? ` · PIS ${F.pct(r.pis.pPIS)} · COFINS ${F.pct(r.pis.pCOFINS)}` : ""}. ${esc(r.pis.txt)}</span></li>`;
    html += `</ul></div>`;

    // CEST
    html += `<div class="painel pilha"><h3>CEST e substituição tributária</h3>`;
    if (!B.cest) html += `<p class="mudo">A tabela CEST do Convênio ICMS 142/2018 ainda não foi carregada: o site do CONFAZ só responde a acessos do Brasil. Rode <code>python3 scripts/atualizar_dados.py cest</code> num computador no Brasil para incluí-la.</p>`;
    else if (!cestDoNcm.length) html += `<p>Este NCM não aparece nos anexos do Convênio ICMS 142/2018. Em regra não há ST nem CEST.</p>`;
    else {
      const unicos = [...new Map(cestDoNcm.map((c) => [c.cest, c])).values()];
      html += `<p>Este NCM aparece em ${unicos.length} item(ns) do Convênio ICMS 142/2018. Escolha o CEST pela descrição do produto: a ST só se aplica se ${p.ufD} adotar o segmento e houver convênio ou protocolo${r.interna ? "" : ` entre ${p.ufO} e ${p.ufD}`}.</p>
      <div class="tabela"><table><thead><tr><th>CEST</th><th>Segmento</th><th>Descrição</th><th>NCM no convênio</th></tr></thead><tbody>${unicos.map((c) => `<tr><td class="mono">${c.cest.slice(0, 2)}.${c.cest.slice(2, 5)}.${c.cest.slice(5)}</td><td>${esc(c.segmento)}</td><td>${esc(c.desc)}${c.escala_nao_relevante ? `<br><span class="chip verificar">escala não relevante</span> <span class="pequeno mudo">Sem ST se fabricado em escala industrial não relevante (Anexo XXVII)${semAcento(c.escala_nao_relevante).replace(/\W/g, "") === semAcento(c.desc).replace(/\W/g, "") ? "" : ": " + esc(c.escala_nao_relevante)}</span>` : ""}</td><td class="mono pequeno">${c.ncm.map(F.fmtNcm).join(", ")}${c.ncm_anteriores ? `<br><span class="mudo">antes: ${c.ncm_anteriores.map(F.fmtNcm).join(", ")}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
    }
    html += calculadoraST(r, p);
    html += `</div>`;

    // pontos de atenção
    html += `<div class="painel pilha"><h3>Pontos a conferir</h3><ul class="notas">${r.pontos.map((x) => `<li><span class="chip ${x.sev}">${SEV[x.sev]}</span><span>${esc(x.txt)}${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">Tabela cBenef</a>` : ""}</span></li>`).join("")}</ul>
      <div class="acoes pequeno">Legislação: ${linkUF(p.ufO)}${r.interna ? "" : " · " + linkUF(p.ufD)} · <a href="https://www.confaz.fazenda.gov.br/legislacao/convenios" target="_blank" rel="noopener">Convênios CONFAZ</a> · <a href="https://www.confaz.fazenda.gov.br/legislacao/protocolos" target="_blank" rel="noopener">Protocolos CONFAZ</a></div></div>`;
    alvo.innerHTML = html;
    ligarCalculadora(r, p);
  }

  function linkUF(uf) {
    const u = B.ufs[uf];
    const links = [`<a href="${esc(u.sefaz)}" target="_blank" rel="noopener">SEFAZ-${uf}</a>`];
    if (u.ricms) links.push(`<a href="${esc(u.ricms)}" target="_blank" rel="noopener">RICMS-${uf}</a>`);
    return links.join(" · ");
  }

  function calculadoraST(r, p) {
    const inter = r.interna ? r.aliq.internaOrigem : r.aliq.interestadual.aliq;
    const c = ls.get("calcST", { valor: 1000, ipi: 0, frete: 0, mva: 40 });
    return `<details ${p.st === "substituto" ? "open" : ""}><summary>Calculadora de ICMS-ST e MVA ajustada</summary>
      <div class="pilha" style="margin-top:12px">
        <div class="linha3">
          <label class="campo" for="st-valor">Valor dos produtos (R$)<input type="number" id="st-valor" step="0.01" value="${c.valor}"></label>
          <label class="campo" for="st-ipi">IPI (R$)<input type="number" id="st-ipi" step="0.01" value="${c.ipi}"></label>
          <label class="campo" for="st-frete">Frete e despesas (R$)<input type="number" id="st-frete" step="0.01" value="${c.frete}"></label>
          <label class="campo" for="st-mva">MVA original (%)<input type="number" id="st-mva" step="0.01" value="${c.mva}"></label>
          <label class="campo" for="st-inter">Alíquota da operação (%)<input type="number" id="st-inter" step="0.01" value="${inter}"></label>
          <label class="campo" for="st-dest">Alíquota interna destino (%)<input type="number" id="st-dest" step="0.01" value="${r.aliq.internaDestino}"></label>
        </div>
        <div class="quadro" id="st-res"></div>
        <p class="pequeno mudo">MVA ajustada = [(1 + MVA original) × (1 − alíquota interestadual) ÷ (1 − alíquota interna do destino)] − 1, conforme o Convênio ICMS 142/2018. Na operação interna usa-se a MVA original. A MVA de cada produto está no RICMS do estado de destino ou no protocolo/convênio do segmento.</p>
      </div></details>`;
  }

  function ligarCalculadora(r) {
    const ids = ["st-valor", "st-ipi", "st-frete", "st-mva", "st-inter", "st-dest"];
    if (!$("#st-valor")) return;
    const calc = () => {
      const v = Object.fromEntries(ids.map((i) => [i, parseFloat($("#" + i).value) || 0]));
      ls.set("calcST", { valor: v["st-valor"], ipi: v["st-ipi"], frete: v["st-frete"], mva: v["st-mva"] });
      const mvaAj = r.interna ? v["st-mva"] : F.mvaAjustada(v["st-mva"], v["st-inter"], v["st-dest"]);
      const proprio = F.r2((v["st-valor"] + v["st-frete"]) * v["st-inter"] / 100);
      const bcst = F.r2((v["st-valor"] + v["st-ipi"] + v["st-frete"]) * (1 + mvaAj / 100));
      const st = Math.max(0, F.r2(bcst * v["st-dest"] / 100 - proprio));
      $("#st-res").innerHTML = `<div><span class="rot">MVA ${r.interna ? "original" : "ajustada"}</span><span class="val">${F.pct(mvaAj)}</span></div>
        <div><span class="rot">ICMS próprio</span><span class="val">${moeda(proprio)}</span></div>
        <div><span class="rot">Base do ICMS-ST</span><span class="val">${moeda(bcst)}</span></div>
        <div><span class="rot">ICMS-ST a reter</span><span class="val">${moeda(st)}</span><span class="sub">Total da nota: R$ ${moeda(v["st-valor"] + v["st-ipi"] + v["st-frete"] + st)}</span></div>`;
    };
    for (const i of ids) $("#" + i).addEventListener("input", calc);
    calc();
  }

  // ------------------------------------------------------------------ AUDITORIA
  const A = { notas: [], eventos: [], ignorados: [], achados: [], exemplo: false, empresa: null, filtro: { sev: "", regra: "", q: "", dir: "" }, sub: "achados" };

  function iniciarAuditoria() {
    const zona = $("#zona-upload"), input = $("#arquivos");
    input.addEventListener("change", () => { if (input.files.length) receberArquivos([...input.files]); input.value = ""; });
    zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("ativa"); });
    zona.addEventListener("dragleave", () => zona.classList.remove("ativa"));
    zona.addEventListener("drop", (e) => { e.preventDefault(); zona.classList.remove("ativa"); receberArquivos([...e.dataTransfer.files]); });
    $("#btn-exemplo").addEventListener("click", carregarExemplo);
    $("#btn-limpar").addEventListener("click", () => { Object.assign(A, { notas: [], eventos: [], ignorados: [], achados: [], exemplo: false, empresa: null }); renderAuditoria(); });
    opcoesUF($("#emp-uf"), "SP");
    for (const id of ["emp-cnpj", "emp-regime", "emp-uf"]) $("#" + id).addEventListener("change", () => {
      const doc = $("#emp-cnpj").value;
      if (id === "emp-cnpj") {
        const salvo = ls.get("empresas", {})[doc];
        const info = infoEmpresa(doc);
        $("#emp-regime").value = salvo ? salvo.regime : info.regime; $("#emp-uf").value = salvo ? salvo.uf : info.uf;
      }
      A.empresa = { doc, regime: $("#emp-regime").value, uf: $("#emp-uf").value };
      const emp = ls.get("empresas", {}); emp[doc] = { regime: A.empresa.regime, uf: A.empresa.uf }; ls.set("empresas", emp);
      processar();
    });
    carregarExemplo();
  }

  async function carregarExemplo() {
    try {
      const r = await fetch("exemplos/lista.json");
      const lista = (await r.json()).arquivos;
      const arqs = await Promise.all(lista.map(async (n) => ({ nome: n, texto: await (await fetch("exemplos/" + n)).text() })));
      Object.assign(A, { notas: [], eventos: [], ignorados: [], empresa: null });
      lerTextos(arqs); A.exemplo = true; processar(true);
    } catch (e) { toast("Não foi possível carregar o exemplo."); }
  }

  async function receberArquivos(files) {
    if (A.exemplo) Object.assign(A, { notas: [], eventos: [], ignorados: [], empresa: null, exemplo: false });
    const textos = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        if (!window.JSZip) { A.ignorados.push({ nome: f.name, motivo: "leitor de .zip não carregou" }); continue; }
        try {
          const zip = await window.JSZip.loadAsync(f);
          for (const ent of Object.values(zip.files)) if (!ent.dir && /\.xml$/i.test(ent.name)) textos.push({ nome: f.name + " › " + ent.name, texto: await ent.async("string") });
        } catch (e) { A.ignorados.push({ nome: f.name, motivo: "arquivo .zip inválido" }); }
      } else if (/\.xml$/i.test(f.name) || f.type.includes("xml")) textos.push({ nome: f.name, texto: await f.text() });
      else A.ignorados.push({ nome: f.name, motivo: "não é XML nem ZIP" });
    }
    lerTextos(textos);
    processar(true);
    toast(`${textos.length} arquivo(s) lido(s).`);
  }

  function lerTextos(arqs) {
    const parser = new DOMParser();
    for (const a of arqs) {
      const doc = parser.parseFromString(a.texto.replace(/^﻿/, ""), "text/xml");
      if (doc.getElementsByTagName("parsererror").length) { A.ignorados.push({ nome: a.nome, motivo: "XML mal formado" }); continue; }
      const r = F.lerXml(doc, a.nome);
      if (r.tipo === "nfe") A.notas.push(r.nota);
      else if (r.tipo === "evento") A.eventos.push(r.evento);
      else A.ignorados.push({ nome: a.nome, motivo: "não é NF-e/NFC-e nem evento" });
    }
    for (const e of A.eventos) if (e.tpEvento === "110111" && ["135", "136", "155"].includes(e.cStat)) for (const n of A.notas) if (n.chave === e.chave) n.cancelada = true;
  }

  function infoEmpresa(doc) {
    const emitidas = A.notas.filter((n) => n.emit.doc === doc);
    const recebidas = A.notas.filter((n) => n.dest.doc === doc);
    const crt = emitidas.length ? emitidas[0].emit.crt : "";
    const uf = emitidas.length ? emitidas[0].emit.uf : (recebidas.length ? recebidas[0].dest.uf : "SP");
    const nome = emitidas.length ? emitidas[0].emit.nome : (recebidas.length ? recebidas[0].dest.nome : "");
    return { regime: crt === "1" || crt === "4" ? "SN" : "LP", uf, nome, qtd: emitidas.length + recebidas.length };
  }

  function processar(redetectar) {
    if (!A.notas.length) { renderAuditoria(); return; }
    // documentos candidatos: os que mais aparecem como emitente ou destinatário
    const cont = new Map();
    for (const n of A.notas) for (const d of [n.emit.doc, n.dest.doc]) if (d) cont.set(d, (cont.get(d) || 0) + 1);
    const ordem = [...cont.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const sel = $("#emp-cnpj");
    sel.innerHTML = ordem.slice(0, 40).map((d) => { const i = infoEmpresa(d); return `<option value="${d}">${F.fmtDoc(d)} - ${esc(i.nome)} (${i.qtd})</option>`; }).join("");
    if (redetectar || !A.empresa || !cont.has(A.empresa.doc)) {
      const doc = ordem[0];
      const salvo = ls.get("empresas", {})[doc];
      const info = infoEmpresa(doc);
      A.empresa = { doc, regime: salvo ? salvo.regime : info.regime, uf: salvo ? salvo.uf : info.uf };
    }
    sel.value = A.empresa.doc; $("#emp-regime").value = A.empresa.regime; $("#emp-uf").value = A.empresa.uf;
    A.achados = F.auditar(A.notas, baseAuditoria(), A.empresa);
    A.cfopsCredito = null;
    renderAuditoria();
  }

  const baseAuditoria = () => ({ ufs: B.ufs, fcp: B.fcp, ncmMap: B.ncmMap, cfopMap: B.cfopMap, cclassMap: B.cclassMap, cestPorNcm: B.cestPorNcm });

  function renderAuditoria() {
    const alvo = $("#resultado-auditoria");
    $("#painel-empresa").hidden = !A.notas.length;
    $("#faixa-auditoria").innerHTML = A.exemplo ? `<div class="faixa exemplo"><b>Exemplo.</b> Notas fictícias com erros propositais. Envie seus XMLs para substituir.</div>` : "";
    if (!A.notas.length) { alvo.innerHTML = A.ignorados.length ? listaIgnorados() : ""; return; }
    const cont = { erro: 0, alerta: 0, verificar: 0 };
    for (const a of A.achados) cont[a.sev]++;
    const dirs = { saida: 0, entrada: 0, entrada_propria: 0, outra: 0, devolucao_terceiro: 0 };
    for (const n of A.notas) dirs[n.direcao] = (dirs[n.direcao] || 0) + 1;
    const canceladas = A.notas.filter((n) => n.cancelada).length;
    const comAchado = new Set(A.achados.filter((a) => a.sev !== "verificar").map((a) => a.chave)).size;

    let html = `<div class="contadores">
      <div class="contador"><div class="n">${A.notas.length}</div><div class="r">notas lidas</div></div>
      <div class="contador"><div class="n">${dirs.saida}</div><div class="r">saídas</div></div>
      <div class="contador"><div class="n">${dirs.entrada + dirs.entrada_propria}</div><div class="r">entradas</div></div>
      <div class="contador"><div class="n">${canceladas}</div><div class="r">canceladas</div></div>
      <div class="contador erro"><div class="n">${cont.erro}</div><div class="r">erros</div></div>
      <div class="contador alerta"><div class="n">${cont.alerta}</div><div class="r">alertas</div></div>
      <div class="contador verificar"><div class="n">${cont.verificar}</div><div class="r">a verificar</div></div>
      <div class="contador"><div class="n">${comAchado}</div><div class="r">notas com erro ou alerta</div></div>
    </div>`;
    if (dirs.outra) html += `<div class="faixa aviso">${dirs.outra} nota(s) não têm a empresa selecionada como emitente nem como destinatária. Elas aparecem na auditoria, mas ficam fora da apuração.</div>`;
    if (!B.cest) html += `<div class="faixa aviso">Validação de CEST desligada: a tabela do Convênio ICMS 142/2018 ainda não foi carregada (veja a aba Base de dados).</div>`;
    html += `<div class="sub-abas" role="tablist">
      <button type="button" role="tab" data-sub="achados" aria-selected="${A.sub === "achados"}">Inconsistências</button>
      <button type="button" role="tab" data-sub="regras" aria-selected="${A.sub === "regras"}">Resumo por regra</button>
      <button type="button" role="tab" data-sub="notas" aria-selected="${A.sub === "notas"}">Notas</button>
    </div><div id="sub-conteudo" class="pilha"></div>`;
    if (A.ignorados.length) html += listaIgnorados();
    alvo.innerHTML = html;
    for (const b of $$(".sub-abas button", alvo)) b.addEventListener("click", () => { A.sub = b.dataset.sub; renderAuditoria(); });
    if (A.sub === "achados") renderAchados(); else if (A.sub === "regras") renderRegras(); else renderNotas();
  }

  function listaIgnorados() {
    return `<details class="painel"><summary>${A.ignorados.length} arquivo(s) não lido(s)</summary><ul>${A.ignorados.map((i) => `<li>${esc(i.nome)}: ${esc(i.motivo)}</li>`).join("")}</ul></details>`;
  }

  const DIR_TXT = { saida: "Saída", entrada: "Entrada", entrada_propria: "Entrada (emissão própria)", outra: "Sem vínculo", devolucao_terceiro: "Entrada (nota de terceiro tpNF 0)" };

  function renderAchados() {
    const alvo = $("#sub-conteudo"), f = A.filtro;
    const regrasPresentes = [...new Set(A.achados.map((a) => a.regra))];
    const lista = A.achados.filter((a) => (!f.sev || a.sev === f.sev) && (!f.regra || a.regra === f.regra) && (!f.dir || a.direcao === f.dir)
      && (!f.q || semAcento([a.nNF, a.emitente, a.xProd, a.detalhe, a.chave].join(" ")).includes(semAcento(f.q))));
    const ordem = { erro: 0, alerta: 1, verificar: 2 };
    lista.sort((a, b) => ordem[a.sev] - ordem[b.sev] || a.regra.localeCompare(b.regra) || a.nNF.localeCompare(b.nNF, undefined, { numeric: true }));
    alvo.innerHTML = `<div class="filtros">
        <select id="f-sev" aria-label="Severidade"><option value="">Todas as severidades</option>${Object.entries(SEV).map(([k, v]) => `<option value="${k}" ${f.sev === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select id="f-regra" aria-label="Regra"><option value="">Todas as regras</option>${regrasPresentes.map((r) => `<option value="${r}" ${f.regra === r ? "selected" : ""}>${esc(F.REGRAS[r])}</option>`).join("")}</select>
        <select id="f-dir" aria-label="Tipo"><option value="">Entradas e saídas</option><option value="saida" ${f.dir === "saida" ? "selected" : ""}>Só saídas</option><option value="entrada" ${f.dir === "entrada" ? "selected" : ""}>Só entradas</option></select>
        <input type="search" id="f-q" placeholder="Buscar nota, emitente, produto…" value="${esc(f.q)}">
        <button type="button" class="peq" id="copiar-achados">Copiar para Excel</button>${local ? `<button type="button" class="peq" id="baixar-achados">Baixar CSV</button>` : ""}
      </div>
      <div class="tabela"><table><thead><tr><th>Severidade</th><th>Nota</th><th>Emitente</th><th>Item</th><th>Regra</th><th>O que foi encontrado</th><th class="num">No XML</th><th class="num">Esperado</th></tr></thead>
      <tbody>${lista.length ? lista.slice(0, 1500).map((a) => `<tr><td class="sev"><span class="chip ${a.sev}">${SEV[a.sev]}</span></td><td class="mono">${esc(a.nNF)}/${esc(a.serie)}<br><span class="mudo pequeno">${dataBR(a.dhEmi)} · ${esc(DIR_TXT[a.direcao] || "")}</span></td><td class="trunc">${esc(a.emitente)}</td><td>${a.item ? `${esc(a.item)}. ${esc(a.xProd)}` : "—"}</td><td>${esc(F.REGRAS[a.regra])}</td><td>${esc(a.detalhe)}</td><td class="num mono">${esc(a.encontrado)}</td><td class="num mono">${esc(a.esperado)}</td></tr>`).join("") : `<tr><td colspan="8" class="mudo">Nenhuma inconsistência com esses filtros.</td></tr>`}</tbody></table></div>
      ${lista.length > 1500 ? `<p class="mudo pequeno">Mostrando 1.500 de ${lista.length}. Use os filtros ou copie para o Excel para ver todas.</p>` : ""}`;
    const ref = () => { A.filtro = { sev: $("#f-sev").value, regra: $("#f-regra").value, dir: $("#f-dir").value, q: $("#f-q").value }; renderAchados(); const q = $("#f-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };
    for (const id of ["f-sev", "f-regra", "f-dir"]) $("#" + id).addEventListener("change", ref);
    let t; $("#f-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(ref, 250); });
    const cab = ["Severidade", "Tipo", "Nota", "Série", "Modelo", "Emissão", "Emitente", "CNPJ emitente", "Chave", "Item", "Produto", "Regra", "Detalhe", "No XML", "Esperado"];
    const linhas = () => lista.map((a) => [SEV[a.sev], DIR_TXT[a.direcao] || "", a.nNF, a.serie, a.mod, dataBR(a.dhEmi), a.emitente, F.fmtDoc(a.emitDoc), a.chave, a.item, a.xProd, F.REGRAS[a.regra], a.detalhe, a.encontrado, a.esperado]);
    $("#copiar-achados").addEventListener("click", () => copiarTabela(cab, linhas()));
    if (local) $("#baixar-achados").addEventListener("click", () => baixarCSV("inconsistencias.csv", cab, linhas()));
  }

  function renderRegras() {
    const alvo = $("#sub-conteudo");
    const m = new Map();
    for (const a of A.achados) {
      const k = a.regra + "|" + a.sev + "|" + a.detalhe.replace(/\d+[.,]?\d*%?/g, "#");
      if (!m.has(k)) m.set(k, { regra: a.regra, sev: a.sev, detalhe: a.detalhe, notas: new Set(), qtd: 0 });
      const g = m.get(k); g.qtd++; g.notas.add(a.chave);
    }
    const ordem = { erro: 0, alerta: 1, verificar: 2 };
    const lista = [...m.values()].sort((a, b) => ordem[a.sev] - ordem[b.sev] || b.qtd - a.qtd);
    alvo.innerHTML = `<div class="tabela"><table><thead><tr><th>Severidade</th><th>Regra</th><th>Ocorrência</th><th class="num">Itens</th><th class="num">Notas</th></tr></thead><tbody>
      ${lista.map((g) => `<tr><td><span class="chip ${g.sev}">${SEV[g.sev]}</span></td><td>${esc(F.REGRAS[g.regra])}</td><td>${esc(g.detalhe)}</td><td class="num">${g.qtd}</td><td class="num">${g.notas.size}</td></tr>`).join("") || `<tr><td colspan="5" class="mudo">Nenhuma inconsistência encontrada.</td></tr>`}</tbody></table></div>`;
  }

  function renderNotas() {
    const alvo = $("#sub-conteudo");
    const porChave = new Map();
    for (const a of A.achados) { const c = porChave.get(a.chave) || { erro: 0, alerta: 0, verificar: 0 }; c[a.sev]++; porChave.set(a.chave, c); }
    const notas = [...A.notas].sort((a, b) => (a.dhEmi || "").localeCompare(b.dhEmi || "") || a.nNF.localeCompare(b.nNF, undefined, { numeric: true }));
    const cab = ["Tipo", "Modelo", "Nota", "Série", "Emissão", "Emitente", "CNPJ emitente", "UF emit.", "Destinatário", "UF dest.", "CRT", "Valor da nota", "ICMS", "ICMS-ST", "DIFAL", "Situação", "Erros", "Alertas", "Chave"];
    const linhas = notas.map((n) => { const c = porChave.get(n.chave) || { erro: 0, alerta: 0 }; return [DIR_TXT[n.direcao] || "", n.mod, n.nNF, n.serie, dataBR(n.dhEmi), n.emit.nome, F.fmtDoc(n.emit.doc), n.emit.uf, n.dest.nome, n.dest.uf, n.emit.crt, moeda(n.total.vNF), moeda(n.total.vICMS), moeda(n.total.vST), moeda(n.total.vICMSUFDest), n.cancelada ? "Cancelada" : n.duplicada ? "Duplicada" : (n.prot ? "Autorizada" : "Sem protocolo"), c.erro, c.alerta, n.chave]; });
    alvo.innerHTML = `<div class="acoes"><button type="button" class="peq" id="copiar-notas">Copiar para Excel</button>${local ? `<button type="button" class="peq" id="baixar-notas">Baixar CSV</button>` : ""}</div>
      <div class="tabela"><table><thead><tr><th>Tipo</th><th>Nota</th><th>Emissão</th><th>Emitente</th><th>Destinatário</th><th class="num">Valor</th><th class="num">ICMS</th><th class="num">ICMS-ST</th><th class="num">DIFAL</th><th>Situação</th><th>Achados</th></tr></thead><tbody>
      ${notas.map((n) => { const c = porChave.get(n.chave) || { erro: 0, alerta: 0, verificar: 0 }; return `<tr><td>${esc(DIR_TXT[n.direcao] || "")}</td><td class="mono">${n.mod === "65" ? "NFC-e" : "NF-e"} ${esc(n.nNF)}/${esc(n.serie)}</td><td>${dataBR(n.dhEmi)}</td><td>${esc(n.emit.nome)}<br><span class="mudo pequeno">${F.fmtDoc(n.emit.doc)} · ${esc(n.emit.uf)} · ${esc(F.CRT[n.emit.crt] || "")}</span></td><td>${esc(n.dest.nome)}<br><span class="mudo pequeno">${esc(n.dest.uf)}</span></td><td class="num">${moeda(n.total.vNF)}</td><td class="num">${moeda(n.total.vICMS)}</td><td class="num">${moeda(n.total.vST)}</td><td class="num">${moeda(n.total.vICMSUFDest)}</td><td>${n.cancelada ? `<span class="chip neutro">Cancelada</span>` : n.duplicada ? `<span class="chip alerta">Duplicada</span>` : n.prot ? `<span class="chip ok">Autorizada</span>` : `<span class="chip alerta">Sem protocolo</span>`}</td><td>${c.erro ? `<span class="chip erro">${c.erro} erro(s)</span> ` : ""}${c.alerta ? `<span class="chip alerta">${c.alerta}</span>` : ""}${!c.erro && !c.alerta ? `<span class="chip ok">ok</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
    $("#copiar-notas").addEventListener("click", () => copiarTabela(cab, linhas));
    if (local) $("#baixar-notas").addEventListener("click", () => baixarCSV("notas.csv", cab, linhas));
  }

  // ------------------------------------------------------------------ APURAÇÃO
  function renderApuracao() {
    const alvo = $("#resultado-apuracao");
    if (!A.notas.length) { alvo.innerHTML = `<div class="painel"><h3>Nenhuma nota carregada</h3><p class="mudo">Envie os XMLs na aba <a href="#auditoria">Auditoria de XML</a>. A apuração é montada a partir deles.</p></div>`; return; }
    const emp = A.empresa;
    const ap = F.apurar(A.notas, emp, baseAuditoria(), { cfopsCredito: A.cfopsCredito });
    if (!A.cfopsCredito) A.cfopsCredito = new Set(ap.cfopsEntradaFornecedor.filter((c) => ap.creditoPadrao(c)));
    const info = infoEmpresa(emp.doc);
    const SN = emp.regime === "SN";
    const desc = (c) => { const r = B.cfopMap.get(c); return r ? r.t : ""; };

    let html = `${A.exemplo ? `<div class="faixa exemplo"><b>Exemplo.</b> Apuração das notas fictícias carregadas na aba Auditoria.</div>` : ""}
      <div class="painel"><div class="acoes" style="justify-content:space-between"><div><h3>${esc(info.nome || "Empresa")}</h3><span class="mudo">${F.fmtDoc(emp.doc)} · ${emp.uf} · ${SN ? "Simples Nacional" : "Lucro Presumido"} · ${ap.qtd.saidas} saída(s) e ${ap.qtd.entradas} entrada(s)</span></div><a href="#auditoria">Trocar empresa ou regime</a></div></div>`;

    if (SN) {
      const R = ap.receita;
      html += `<div class="quadro">
        <div><span class="rot">Receita bruta de vendas</span><span class="val">${moeda(R.bruta)}</span><span class="sub">Devoluções: ${moeda(R.devolucoes)} · Líquida: ${moeda(R.liquida)}</span></div>
        <div><span class="rot">Revenda sem ST</span><span class="val">${moeda(R.semST)}</span><span class="sub">Tributa ICMS no DAS</span></div>
        <div><span class="rot">Com ST ou antecipação</span><span class="val">${moeda(R.comST)}</span><span class="sub">ICMS já recolhido: segregar no PGDAS-D</span></div>
        <div><span class="rot">Exportação</span><span class="val">${moeda(R.exportacao)}</span><span class="sub">Interna ${moeda(R.interna)} · Interestadual ${moeda(R.interestadual)}</span></div>
      </div><p class="pequeno mudo">Valores de produtos − descontos + frete, seguro e outras despesas, nos CFOPs de venda. A segregação por produto monofásico de PIS/COFINS e por anexo da LC 123/2006 precisa ser conferida por NCM.</p>`;
    } else {
      const s = ap.icms.saldo;
      html += `<div class="quadro">
        <div><span class="rot">Débitos de ICMS</span><span class="val">${moeda(ap.icms.debitos)}</span><span class="sub">ICMS destacado nas saídas</span></div>
        <div><span class="rot">Créditos de ICMS</span><span class="val">${moeda(ap.icms.creditos)}</span><span class="sub">Entradas com CFOP marcado abaixo</span></div>
        <div><span class="rot">${s >= 0 ? "ICMS a recolher" : "Saldo credor"}</span><span class="val">${moeda(Math.abs(s))}</span><span class="sub">Antes de ajustes, estornos e saldo anterior</span></div>
        <div><span class="rot">FCP próprio</span><span class="val">${moeda(ap.fcp.proprio)}</span><span class="sub">Destacado nas saídas</span></div>
      </div>`;
    }
    html += `<div class="quadro">
      <div><span class="rot">ICMS-ST retido nas saídas</span><span class="val">${moeda(ap.st.retidoSaidas)}</span><span class="sub">FCP-ST ${moeda(ap.st.fcpSt)}</span></div>
      <div><span class="rot">DIFAL nas saídas</span><span class="val">${moeda(ap.difal.saidas)}</span><span class="sub">FCP de destino ${moeda(ap.difal.fcpSaidas)}</span></div>
      <div><span class="rot">ST paga nas entradas</span><span class="val">${moeda(ap.st.pagoEntradas)}</span><span class="sub">Retida pelos fornecedores</span></div>
      <div><span class="rot">IPI</span><span class="val">${moeda(ap.ipi.saidas)}</span><span class="sub">Entradas ${moeda(ap.ipi.entradas)}</span></div>
      ${SN ? "" : `<div><span class="rot">PIS / COFINS destacados</span><span class="val">${moeda(ap.pis.saidas + ap.cofins.saidas)}</span><span class="sub">PIS ${moeda(ap.pis.saidas)} · COFINS ${moeda(ap.cofins.saidas)}</span></div>
      <div><span class="rot">CBS / IBS (teste 2026)</span><span class="val">${moeda(ap.ibscbs.cbs + ap.ibscbs.ibs)}</span><span class="sub">CBS ${moeda(ap.ibscbs.cbs)} · IBS ${moeda(ap.ibscbs.ibs)}</span></div>`}
    </div>`;
    if (!SN) html += `<p class="pequeno mudo">No Lucro Presumido, PIS e COFINS são apurados sobre a receita bruta do mês, pelas alíquotas de 0,65% e 3%. Os valores acima são os destacados nas notas e servem para conferência.</p>`;

    const colsCfop = [["CFOP", (g) => g.chave], ["Descrição", (g) => desc(g.chave)], ["Notas", (g) => g.qtdNotas], ["Valor contábil", (g) => g.vContabil, 1], ["Base ICMS", (g) => g.vBC, 1], ["ICMS", (g) => g.vICMS, 1], ["Isentas/não trib.", (g) => g.isentas, 1], ["Outras", (g) => g.outras, 1], ["Base ST", (g) => g.vBCST, 1], ["ICMS-ST", (g) => g.vICMSST, 1], ["IPI", (g) => g.vIPI, 1], ["DIFAL", (g) => g.vDifal, 1]];
    html += tabelaApur("Saídas por CFOP", "t-saidas-cfop", ap.saidasPorCfop, colsCfop);

    // entradas com marcação de crédito
    const colsEnt = [["CFOP do fornecedor", (g) => g.chave], ["Equivalente na entrada", (g) => F.cfopEntradaEquivalente(g.chave)], ["Descrição", (g) => desc(g.chave)], ["Notas", (g) => g.qtdNotas], ["Valor contábil", (g) => g.vContabil, 1], ["Base ICMS", (g) => g.vBC, 1], ["ICMS destacado", (g) => g.vICMS, 1], ["Crédito considerado", (g) => g.vCred, 1], ["ICMS-ST", (g) => g.vICMSST, 1], ["IPI", (g) => g.vIPI, 1]];
    html += tabelaApur("Entradas por CFOP", "t-entradas-cfop", ap.entradasPorCfop, colsEnt, SN ? null : (g) => ap.cfopsEntradaFornecedor.includes(g.chave)
      ? `<input type="checkbox" class="cred" id="cred-${g.chave}" data-cfop="${g.chave}" ${A.cfopsCredito.has(g.chave) ? "checked" : ""} aria-label="Considerar crédito do CFOP ${g.chave}">` : "");
    if (!SN) html += `<p class="pequeno mudo">Marque os CFOPs cujas entradas dão direito a crédito (revenda e industrialização). Entradas para uso e consumo não geram crédito. Ativo imobilizado gera crédito em 1/48 por mês (CIAP). Para fornecedor do Simples com CSOSN 101/201, o crédito considerado é o vCredICMSSN.</p>`;

    html += tabelaApur("Saídas por UF de destino", "t-saidas-uf", ap.saidasPorUf, [["UF", (g) => g.chave], ["Notas", (g) => g.qtdNotas], ["Valor contábil", (g) => g.vContabil, 1], ["Base ICMS", (g) => g.vBC, 1], ["ICMS", (g) => g.vICMS, 1], ["Base ST", (g) => g.vBCST, 1], ["ICMS-ST", (g) => g.vICMSST, 1], ["FCP-ST", (g) => g.vFCPST, 1], ["DIFAL", (g) => g.vDifal, 1], ["FCP DIFAL", (g) => g.vFCPDifal, 1]]);
    html += `<p class="pequeno mudo">ICMS-ST e DIFAL interestaduais são recolhidos para a UF de destino (GNRE por nota ou apuração mensal, se a empresa tiver inscrição estadual de substituto lá).</p>`;
    html += tabelaApur("Saídas por CST/CSOSN", "t-saidas-cst", ap.saidasPorCst, [["CST", (g) => g.chave], ["Descrição", (g) => F.CST_ICMS[g.chave.slice(1)] || F.CSOSN[g.chave.slice(1)] || ""], ["Notas", (g) => g.qtdNotas], ["Valor contábil", (g) => g.vContabil, 1], ["Base ICMS", (g) => g.vBC, 1], ["ICMS", (g) => g.vICMS, 1], ["ICMS-ST", (g) => g.vICMSST, 1]]);
    if (ap.difalEntradas.length) {
      html += tabelaApur(`DIFAL estimado nas entradas interestaduais (se forem para uso, consumo ou ativo) · alíquota interna ${emp.uf} ${F.pct(ap.aliqInternaEmpresa || 0)}`, "t-difal-ent", ap.difalEntradas, [["CFOP do fornecedor", (g) => g.chave], ["Descrição", (g) => desc(g.chave)], ["Notas", (g) => g.qtdNotas], ["Valor contábil", (g) => g.vContabil, 1], ["ICMS destacado", (g) => g.vICMS, 1], ["DIFAL estimado (base única)", (g) => g.difalEstimado, 1]]);
      html += `<p class="pequeno mudo">Estimativa para conferência: (valor contábil − ICMS-ST) × (alíquota interna de ${emp.uf} − alíquota da nota). Considere só as entradas para uso, consumo ou ativo; muitos estados exigem base dupla.${SN ? " Optantes do Simples também recolhem esse DIFAL (STF, Tema 517) e, em alguns estados, a antecipação nas compras para revenda." : ""}</p>`;
    }
    alvo.innerHTML = html;
    for (const c of $$("input.cred", alvo)) c.addEventListener("change", () => { if (c.checked) A.cfopsCredito.add(c.dataset.cfop); else A.cfopsCredito.delete(c.dataset.cfop); renderApuracao(); });
    for (const b of $$("button[data-copiar]", alvo)) b.addEventListener("click", () => { const t = TABELAS[b.dataset.copiar]; copiarTabela(t.cab, t.linhas); });
    for (const b of $$("button[data-baixar]", alvo)) b.addEventListener("click", () => { const t = TABELAS[b.dataset.baixar]; baixarCSV(b.dataset.baixar + ".csv", t.cab, t.linhas); });
  }

  const TABELAS = {};
  function tabelaApur(titulo, id, grupos, cols, colExtra) {
    if (!grupos.length) return `<div class="painel"><h3>${esc(titulo)}</h3><p class="mudo">Sem lançamentos.</p></div>`;
    const tot = cols.map(([, fn, num]) => num ? grupos.reduce((a, g) => a + (fn(g) || 0), 0) : null);
    TABELAS[id] = { cab: cols.map((c) => c[0]), linhas: grupos.map((g) => cols.map(([, fn, num]) => num ? moeda(fn(g)) : fn(g))).concat([cols.map((c, i) => i === 0 ? "Total" : (tot[i] == null ? "" : moeda(tot[i])))]) };
    return `<div class="pilha"><div class="acoes" style="justify-content:space-between"><h3>${esc(titulo)}</h3><span class="acoes"><button type="button" class="peq" data-copiar="${id}">Copiar para Excel</button>${local ? `<button type="button" class="peq" data-baixar="${id}">Baixar CSV</button>` : ""}</span></div>
      <div class="tabela"><table><thead><tr>${colExtra ? "<th>Crédito</th>" : ""}${cols.map(([n, , num]) => `<th class="${num ? "num" : ""}">${esc(n)}</th>`).join("")}</tr></thead>
      <tbody>${grupos.map((g) => `<tr>${colExtra ? `<td>${colExtra(g)}</td>` : ""}${cols.map(([, fn, num], i) => `<td class="${num ? "num" : i === 0 ? "mono" : ""}">${num ? moeda(fn(g)) : esc(fn(g))}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr>${colExtra ? "<td></td>" : ""}${cols.map((c, i) => `<td class="${c[2] ? "num" : ""}">${i === 0 ? "Total" : (tot[i] == null ? "" : moeda(tot[i]))}</td>`).join("")}</tr></tfoot></table></div></div>`;
  }

  // ------------------------------------------------------------------ BASE
  function renderBase() {
    const alvo = $("#resultado-base");
    const fo = B.fontes || {};
    const linha = (nome, fonte, versao, qtd, st, url) => `<tr><td>${nome}</td><td>${fonte}</td><td>${esc(versao || "")}</td><td class="num">${qtd == null ? "—" : Number(qtd).toLocaleString("pt-BR")}</td><td>${st}</td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">abrir</a>` : ""}</td></tr>`;
    const st = (k) => fo[k] && fo[k].status === "ok" ? `<span class="chip ok">atualizada ${dataBR(fo[k].atualizado_em)}</span>` : `<span class="chip alerta">${fo[k] && fo[k].status === "falhou" ? "falhou na última atualização" : "não carregada"}</span>`;
    let html = `<div class="tabela"><table><thead><tr><th>Tabela</th><th>Fonte oficial</th><th>Versão</th><th class="num">Registros</th><th>Situação</th><th></th></tr></thead><tbody>
      ${linha("NCM", "Portal Único Siscomex (Classif)", `${B.ncm.situacao} · ${B.ncm.ato}`, B.ncm.itens.length, st("ncm"), "https://portalunico.siscomex.gov.br/classif/")}
      ${linha("CFOP", "Portal Nacional da NF-e", B.cfop.documento, B.cfop.itens.length, st("cfop"), "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=")}
      ${linha("FCP por UF", "Portal Nacional da NF-e", B.fcp.documento, Object.keys(B.fcp.itens).length, st("fcp"), "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=")}
      ${linha("cClassTrib IBS/CBS", "Portal Nacional da NF-e", B.cclass.documento, B.cclass.itens.length, st("cclasstrib"), "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=")}
      ${linha("CEST / ST", "CONFAZ - Convênio ICMS 142/2018", B.cest ? `baixado em ${dataBR(B.cest.baixado_em)}` : "rode o atualizador num computador no Brasil", B.cest ? B.cest.itens.length : null, st("cest"), "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18")}
      ${linha("Alíquotas internas por UF", "Curadoria manual (RICMS de cada UF)", `revisado em ${dataBR(B.ufsMeta.revisado_em)}`, Object.keys(B.ufs).length, `<span class="chip verificar">manual</span>`, null)}
    </tbody></table></div>`;

    html += `<div class="pilha"><h3>Estados</h3><div class="tabela"><table><thead><tr><th>UF</th><th>Estado</th><th>Região</th><th class="num">Alíquota interna</th><th>Status</th><th>FCP (Portal NF-e)</th><th>cBenef</th><th>Observação</th><th>Links</th></tr></thead><tbody>
      ${Object.keys(B.ufs).sort().map((u) => { const x = B.ufs[u], f = F.fcpUF(B.fcp, u); return `<tr><td class="mono">${u}</td><td>${esc(x.nome)}</td><td>${x.regiao}</td><td class="num">${F.pct(x.aliq_interna)}</td><td>${chipStatus(x.status)}</td><td>${f.max ? f.aliqs.map(F.pct).join(" / ") + (f.tipo === "max" ? " (máx.)" : "") : "não tem"}</td><td>${x.cbenef ? "exige" : "—"}</td><td class="pequeno">${esc(x.obs || "")}</td><td class="pequeno">${linkUF(u)}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="pequeno mudo">Interestaduais: 7% de Sul/Sudeste (exceto ES) para Norte, Nordeste, Centro-Oeste e ES; 12% nas demais; 4% para importados (origens 1, 2, 3 e 8). Alíquotas marcadas “conferir” divergem entre as fontes públicas consultadas: confirme no RICMS do estado e corrija em <code>dados/curados/ufs.json</code>.</p></div>`;

    html += `<div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">
      <div class="pilha"><h3>CFOP</h3><input type="search" id="busca-cfop" placeholder="Código ou descrição, ex.: 5405 ou devolução"><div class="tabela" style="max-height:420px"><table><tbody id="lista-cfop"></tbody></table></div></div>
      <div class="pilha"><h3>cClassTrib do IBS/CBS</h3><input type="search" id="busca-cclass" placeholder="Código ou descrição, ex.: 000001 ou cesta básica"><div class="tabela" style="max-height:420px"><table><tbody id="lista-cclass"></tbody></table></div></div>
    </div>`;
    alvo.innerHTML = html;
    const lc = () => { const q = semAcento($("#busca-cfop").value.trim()); $("#lista-cfop").innerHTML = B.cfop.itens.filter((c) => !q || c.c.startsWith(q.replace(/\D/g, "") || "x") || semAcento(c.t).includes(q)).slice(0, 80).map((c) => `<tr><td class="mono">${c.c.slice(0, 1)}.${c.c.slice(1)}</td><td>${esc(c.t)}${c.fim ? ` <span class="chip alerta">até ${dataBR(c.fim)}</span>` : ""}<br><span class="mudo pequeno">${esc(c.d)}</span></td></tr>`).join(""); };
    const lcc = () => { const q = semAcento($("#busca-cclass").value.trim()); $("#lista-cclass").innerHTML = B.cclass.itens.filter((c) => !q || c.c.startsWith(q) || semAcento(c.nome).includes(q)).slice(0, 80).map((c) => `<tr><td class="mono">${c.c}</td><td>${esc(c.nome)}<br><span class="mudo pequeno">CST ${c.cst} · ${esc(c.lc || "")}${c.pRedCBS ? ` · redução ${c.pRedCBS}%` : ""}</span></td></tr>`).join(""); };
    $("#busca-cfop").addEventListener("input", lc); $("#busca-cclass").addEventListener("input", lcc); lc(); lcc();
  }

  // ------------------------------------------------------------------ exportação
  function copiarTabela(cab, linhas) {
    const tsv = [cab, ...linhas].map((l) => l.map((c) => String(c == null ? "" : c).replace(/[\t\n\r]+/g, " ")).join("\t")).join("\n");
    const ok = () => toast(`${linhas.length} linha(s) copiada(s). Cole no Excel.`);
    const falha = () => {
      const ta = document.createElement("textarea"); ta.value = tsv; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? ok() : toast("Não foi possível copiar."); } catch (e) { toast("Não foi possível copiar."); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(ok, falha); else falha();
  }
  function baixarCSV(nome, cab, linhas) {
    const csv = "﻿" + [cab, ...linhas].map((l) => l.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ início
  async function iniciar() {
    try { await carregarBase(); }
    catch (e) { $("#carregando").textContent = "Não foi possível carregar a base de dados. " + e.message; return; }
    $("#carregando").hidden = true;
    iniciarConsulta();
    iniciarAuditoria();
    window.addEventListener("hashchange", mostrarAba);
    mostrarAba();
  }
  iniciar();
})();
