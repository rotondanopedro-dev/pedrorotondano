/* Central Fiscal ICMS - motor de regras.
 * Funções puras (sem acesso à tela): tabelas fixas, parametrização por NCM,
 * leitura de XML de NF-e/NFC-e, auditoria e apuração.
 * Funciona no navegador (window.Fiscal) e no Node (require) para testes.
 */
(function (raiz) {
  "use strict";

  // ------------------------------------------------------------------ tabelas fixas
  const ORIGEM = {
    "0": "Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8",
    "1": "Estrangeira - importação direta, exceto a indicada no código 6",
    "2": "Estrangeira - adquirida no mercado interno, exceto a indicada no código 7",
    "3": "Nacional, com conteúdo de importação superior a 40% e inferior ou igual a 70%",
    "4": "Nacional, produzida conforme processos produtivos básicos (PPB)",
    "5": "Nacional, com conteúdo de importação inferior ou igual a 40%",
    "6": "Estrangeira - importação direta, sem similar nacional (lista CAMEX)",
    "7": "Estrangeira - adquirida no mercado interno, sem similar nacional (lista CAMEX)",
    "8": "Nacional, com conteúdo de importação superior a 70%",
  };
  const CST_ICMS = {
    "00": "Tributada integralmente",
    "02": "Tributação monofásica própria sobre combustíveis",
    "10": "Tributada e com cobrança do ICMS por substituição tributária",
    "15": "Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis",
    "20": "Com redução de base de cálculo",
    "30": "Isenta ou não tributada e com cobrança do ICMS por substituição tributária",
    "40": "Isenta",
    "41": "Não tributada",
    "50": "Suspensão",
    "51": "Diferimento",
    "53": "Tributação monofásica sobre combustíveis com recolhimento diferido",
    "60": "ICMS cobrado anteriormente por substituição tributária",
    "61": "Tributação monofásica sobre combustíveis cobrada anteriormente",
    "70": "Com redução de base de cálculo e cobrança do ICMS por substituição tributária",
    "90": "Outras",
  };
  const CSOSN = {
    "101": "Tributada pelo Simples Nacional com permissão de crédito",
    "102": "Tributada pelo Simples Nacional sem permissão de crédito",
    "103": "Isenção do ICMS no Simples Nacional para faixa de receita bruta",
    "201": "Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por ST",
    "202": "Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por ST",
    "203": "Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por ST",
    "300": "Imune",
    "400": "Não tributada pelo Simples Nacional",
    "500": "ICMS cobrado anteriormente por ST (substituído) ou por antecipação",
    "900": "Outros",
  };
  const CRT = { "1": "Simples Nacional", "2": "Simples Nacional - excesso de sublimite", "3": "Regime normal", "4": "MEI" };
  const UFS_SUL_SUDESTE_SEM_ES = ["SP", "RJ", "MG", "PR", "RS", "SC"];
  const CUF = { 11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF" };
  // IBS/CBS - fase de teste de 2026 (LC 214/2025, art. 343 a 346)
  const IBSCBS_2026 = { pCBS: 0.9, pIBSUF: 0.1, pIBSMun: 0 };

  // ------------------------------------------------------------------ utilidades
  const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const temValor = (v) => v !== undefined && v !== null && v !== "";
  const soDigitos = (s) => String(s || "").replace(/\D/g, "");
  const fmtNcm = (c) => { c = soDigitos(c); if (c.length <= 4) return c; return [c.slice(0, 4), c.slice(4, 6), c.slice(6)].filter(Boolean).join("."); };
  const fmtDoc = (d) => {
    d = soDigitos(d);
    if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    return d;
  };
  const cfopFinal = (c) => String(c).slice(1); // 3 últimos dígitos
  const pct = (v) => (Math.round(v * 100) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";

  function aliqInterestadual(ufO, ufD, orig) {
    if (["1", "2", "3", "8"].includes(String(orig))) return { aliq: 4, motivo: "Mercadoria importada ou com conteúdo de importação acima de 40% (Res. Senado 13/2012)" };
    if (UFS_SUL_SUDESTE_SEM_ES.includes(ufO) && !UFS_SUL_SUDESTE_SEM_ES.includes(ufD))
      return { aliq: 7, motivo: "Origem Sul/Sudeste com destino Norte, Nordeste, Centro-Oeste ou ES (Res. Senado 22/1989)" };
    return { aliq: 12, motivo: "Demais operações interestaduais (Res. Senado 22/1989)" };
  }

  function aliqInternaUF(ufs, uf, dataISO) {
    const u = ufs && ufs[uf];
    if (!u) return null;
    if (dataISO && Array.isArray(u.historico)) {
      for (const h of u.historico) if (h.ate && dataISO <= h.ate) return h.aliq;
    }
    return u.aliq_interna;
  }

  function fcpUF(fcp, uf) {
    const f = fcp && fcp.itens && fcp.itens[uf];
    if (!f || !f.aliquotas.length) return { aliqs: [], max: 0, obs: "" };
    const aliqs = f.aliquotas.map((a) => a.aliq).filter((a) => a > 0);
    return { aliqs, max: aliqs.length ? Math.max(...aliqs) : 0, obs: f.obs, tipo: f.aliquotas[0].tipo };
  }

  // DIFAL - base única e base dupla ("por dentro") sobre um valor de operação
  function calcDifal(valor, aliqInter, aliqDest) {
    const icmsOrigem = valor * aliqInter / 100;
    const unica = Math.max(0, valor * (aliqDest - aliqInter) / 100);
    const baseDupla = (valor - icmsOrigem) / (1 - aliqDest / 100);
    const dupla = Math.max(0, baseDupla * aliqDest / 100 - icmsOrigem);
    return { unica: r2(unica), dupla: r2(dupla), baseDupla: r2(baseDupla) };
  }

  function mvaAjustada(mvaOrig, aliqInter, aliqDest) {
    return ((1 + mvaOrig / 100) * (1 - aliqInter / 100) / (1 - aliqDest / 100) - 1) * 100;
  }

  // ------------------------------------------------------------------ parametrização
  /* p = { ncm, ufO, ufD, regime: 'LP'|'SN', dest: 'revenda'|'uso'|'naocontrib',
   *       prod: 'revenda'|'propria', orig: '0'..'8', st: 'nao'|'substituido'|'substituto' } */
  function parametrizar(p, base) {
    const interna = p.ufO === p.ufD;
    const pre = interna ? "5" : "6";
    const out = { interna, cfop: null, cfopAlt: [], cst: null, cstAlt: [], aliq: {}, difal: null, fcp: null, ibscbs: null, pis: null, pontos: [] };
    const ufs = base.ufs;

    // ---- CFOP
    if (p.st === "substituido") {
      out.cfop = interna ? "5405" : "6404";
      out.cfopMotivo = interna ? "Venda de mercadoria com ST retida anteriormente (substituído)" : "Venda de mercadoria sujeita a ST cujo imposto já foi retido anteriormente";
      if (!interna) out.pontos.push({ sev: "alerta", txt: `Se houver convênio ou protocolo de ST entre ${p.ufO} e ${p.ufD} para este produto, você passa a ser substituto na venda interestadual: use CFOP 6403 ou 6401 e retenha o ICMS-ST para ${p.ufD}. O ICMS-ST pago na entrada pode ser ressarcido conforme o RICMS de ${p.ufO}.` });
    } else if (p.st === "substituto") {
      out.cfop = pre + (p.prod === "propria" ? "401" : "403");
      out.cfopMotivo = p.prod === "propria" ? "Venda de produção própria em operação com ST (substituto)" : "Venda de mercadoria adquirida de terceiros em operação com ST (substituto)";
    } else if (!interna && p.dest === "naocontrib") {
      out.cfop = p.prod === "propria" ? "6107" : "6108";
      out.cfopMotivo = "Venda interestadual a não contribuinte";
    } else {
      out.cfop = pre + (p.prod === "propria" ? "101" : "102");
      out.cfopMotivo = p.prod === "propria" ? "Venda de produção do estabelecimento" : "Venda de mercadoria adquirida ou recebida de terceiros";
    }
    if (p.dest === "uso" && p.st === "nao") out.pontos.push({ sev: "verificar", txt: "Venda a contribuinte para uso ou consumo: o CFOP de saída é o mesmo da revenda; a finalidade só muda o tratamento no destinatário (DIFAL e crédito)." });

    // ---- CST / CSOSN
    const orig = String(p.orig || "0");
    if (p.regime === "SN") {
      if (p.st === "substituido") { out.cst = "500"; }
      else if (p.st === "substituto") { out.cst = p.dest === "revenda" ? "201" : "202"; out.cstAlt = [p.dest === "revenda" ? "202" : "201", "203"]; }
      else { out.cst = p.dest === "revenda" ? "101" : "102"; out.cstAlt = [p.dest === "revenda" ? "102" : "101", "103", "300", "400"]; }
      out.cstTipo = "CSOSN";
      out.cstDesc = CSOSN[out.cst];
      if (out.cst === "101" || out.cst === "201") out.pontos.push({ sev: "verificar", txt: "CSOSN 101/201 exige informar pCredSN e vCredICMSSN: a alíquota de crédito é a do ICMS na faixa do Anexo da LC 123/2006 em que a empresa está no mês." });
    } else {
      if (p.st === "substituido") out.cst = "60";
      else if (p.st === "substituto") { out.cst = "10"; out.cstAlt = ["30", "70"]; }
      else { out.cst = "00"; out.cstAlt = ["20", "40", "41", "51", "90"]; }
      out.cstTipo = "CST";
      out.cstDesc = CST_ICMS[out.cst];
    }
    out.cstCompleto = (out.cstTipo === "CST" ? orig : orig) + out.cst;

    // ---- alíquotas
    const intO = aliqInternaUF(ufs, p.ufO), intD = aliqInternaUF(ufs, p.ufD);
    const inter = interna ? null : aliqInterestadual(p.ufO, p.ufD, orig);
    out.aliq.internaOrigem = intO;
    out.aliq.internaDestino = intD;
    out.aliq.statusO = ufs[p.ufO] && ufs[p.ufO].status;
    out.aliq.statusD = ufs[p.ufD] && ufs[p.ufD].status;
    out.aliq.interestadual = inter;
    out.aliq.aplicavel = interna ? intO : inter.aliq;
    if (p.regime === "SN" && p.st !== "substituto") {
      out.aliq.nota = "Optante do Simples não destaca ICMS próprio na nota: o imposto é recolhido no DAS. A alíquota acima vale como referência (crédito do comprador e cálculo de ST).";
    }
    if (orig === "6" || orig === "7") out.pontos.push({ sev: "verificar", txt: "Origem 6/7 (sem similar nacional na lista da CAMEX): a alíquota de 4% não se aplica; vale 7% ou 12%." });

    // ---- FCP
    const fO = fcpUF(base.fcp, p.ufO), fD = fcpUF(base.fcp, p.ufD);
    out.fcp = { origem: fO, destino: fD };

    // ---- DIFAL
    if (!interna) {
      if (p.dest === "naocontrib") {
        if (p.regime === "SN") {
          out.difal = { devido: false, txt: "Optante do Simples Nacional não recolhe DIFAL na venda a não contribuinte de outro estado (STF, ADI 5464)." };
        } else {
          const c = calcDifal(1000, inter.aliq, intD);
          out.difal = { devido: true, quem: "Remetente (você)", recolhe: p.ufD, aliqDest: intD, aliqInter: inter.aliq, ex: c,
            txt: `DIFAL de ${pct(intD - inter.aliq)} para ${p.ufD}, recolhido pelo remetente por GNRE (ou inscrição estadual no destino). Informe o grupo ICMSUFDest no XML.` };
          if (fD.max) out.difal.fcp = fD.max;
        }
      } else if (p.dest === "uso") {
        out.difal = { devido: true, quem: "Destinatário (comprador)", recolhe: p.ufD, aliqDest: intD, aliqInter: inter.aliq, ex: calcDifal(1000, inter.aliq, intD),
          txt: `O comprador contribuinte recolhe o DIFAL (${pct(intD - inter.aliq)}) para ${p.ufD} na entrada para uso, consumo ou ativo. Muitos estados usam base dupla.` };
      } else {
        out.difal = { devido: false, txt: "Sem DIFAL: mercadoria para revenda ou industrialização. Verifique se há ST ou antecipação no estado de destino." };
      }
    }

    // ---- IBS / CBS (fase de teste 2026)
    if (p.regime === "SN") {
      out.ibscbs = { exigido: false, txt: "Optantes do Simples Nacional estão dispensados de informar IBS/CBS na NF-e durante 2026." };
    } else {
      out.ibscbs = { exigido: true, cst: "000", cClassTrib: "000001", ...IBSCBS_2026,
        txt: "Fase de teste: destaque CBS 0,9% e IBS 0,1% (estadual) sobre a base do item. O valor é compensável com PIS/COFINS e não aumenta o total da nota. Use outro cClassTrib se o produto tiver redução, alíquota zero ou regime específico (LC 214/2025)." };
    }

    // ---- PIS/COFINS
    if (p.regime === "SN") out.pis = { cst: "49", pPIS: 0, pCOFINS: 0, txt: "Sem destaque: recolhidos no DAS. Use CST 49 (ou 99, conforme o emissor). Produtos monofásicos ou com alíquota zero são segregados no PGDAS-D." };
    else out.pis = { cst: "01", pPIS: 0.65, pCOFINS: 3, txt: "Lucro Presumido (regime cumulativo): PIS 0,65% e COFINS 3%. Produtos monofásicos (CST 04), com alíquota zero (CST 06) ou suspensão (CST 09) seguem regra própria." };

    // ---- ST / pontos de atenção gerais
    if (p.st !== "nao" || (base.cestDoNcm && base.cestDoNcm.length)) {
      out.pontos.push({ sev: "alerta", txt: `ST depende de convênio ou protocolo entre ${p.ufO} e ${p.ufD} e de o estado de destino adotar o segmento do CEST. Confira a MVA e a alíquota no RICMS de ${p.ufD}.` });
    }
    const uO = ufs[p.ufO] || {}, uD = ufs[p.ufD] || {};
    if (uO.cbenef) out.pontos.push({ sev: "verificar", txt: `${p.ufO} exige cBenef quando o CST indica benefício (20, 30, 40, 41, 51, 70, 90). Confira a tabela da SEFAZ-${p.ufO}.`, url: uO.cbenef_url });
    out.pontos.push({ sev: "verificar", txt: `Antes de fechar o cadastro, confira no RICMS de ${p.ufO}${interna ? "" : " e de " + p.ufD} se este NCM tem isenção, redução de base, alíquota específica ou crédito presumido.` });
    return out;
  }

  // ------------------------------------------------------------------ leitura do XML
  function filho(el, tag) { if (!el) return null; const l = el.getElementsByTagName(tag); return l.length ? l[0] : null; }
  function txt(el, tag) { const f = filho(el, tag); return f && f.textContent != null ? f.textContent.trim() : ""; }
  function filhosDiretos(el, tag) {
    const out = [];
    if (!el) return out;
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (c.localName || c.nodeName) === tag) out.push(c);
    return out;
  }
  function primeiroGrupo(el) { if (!el) return null; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) return c; return null; }

  /* Retorna { tipo: 'nfe', nota } | { tipo: 'evento', evento } | { tipo: 'desconhecido' } */
  function lerXml(doc, nomeArquivo) {
    const raizEl = doc.documentElement;
    if (!raizEl) return { tipo: "desconhecido", arquivo: nomeArquivo };
    const nomeRaiz = raizEl.localName || raizEl.nodeName;
    if (/procEventoNFe|^evento$|envEvento/.test(nomeRaiz)) {
      const inf = filho(raizEl, "infEvento");
      const ret = filho(raizEl, "retEvento");
      return { tipo: "evento", arquivo: nomeArquivo, evento: {
        chave: txt(inf, "chNFe"), tpEvento: txt(inf, "tpEvento"), desc: txt(inf, "descEvento"),
        cStat: ret ? txt(filho(ret, "infEvento"), "cStat") : "", dh: txt(inf, "dhEvento") } };
    }
    const infNFe = filho(raizEl, "infNFe");
    if (!infNFe) return { tipo: "desconhecido", arquivo: nomeArquivo };
    const ide = filho(infNFe, "ide"), emit = filho(infNFe, "emit"), dest = filho(infNFe, "dest");
    const ender = (el, t) => txt(filho(el, t), "UF");
    const prot = filho(raizEl, "protNFe");
    const chave = (infNFe.getAttribute("Id") || "").replace(/^NFe/, "");
    const nota = {
      arquivo: nomeArquivo, chave,
      versao: infNFe.getAttribute("versao") || "",
      mod: txt(ide, "mod"), serie: txt(ide, "serie"), nNF: txt(ide, "nNF"), cUF: txt(ide, "cUF"),
      dhEmi: (txt(ide, "dhEmi") || txt(ide, "dEmi")).slice(0, 10),
      tpNF: txt(ide, "tpNF"), idDest: txt(ide, "idDest"), indFinal: txt(ide, "indFinal"), indPres: txt(ide, "indPres"),
      finNFe: txt(ide, "finNFe"), natOp: txt(ide, "natOp"), tpAmb: txt(ide, "tpAmb"),
      emit: { doc: txt(emit, "CNPJ") || txt(emit, "CPF"), nome: txt(emit, "xNome"), uf: ender(emit, "enderEmit"), ie: txt(emit, "IE"), crt: txt(emit, "CRT") },
      dest: dest ? { doc: txt(dest, "CNPJ") || txt(dest, "CPF") || txt(dest, "idEstrangeiro"), nome: txt(dest, "xNome"), uf: ender(dest, "enderDest") || "", ie: txt(dest, "IE"), indIEDest: txt(dest, "indIEDest") } : { doc: "", nome: "Consumidor não identificado", uf: "", ie: "", indIEDest: "9" },
      prot: prot ? { cStat: txt(prot, "cStat"), nProt: txt(prot, "nProt") } : null,
      itens: [], total: {}, ibscbsTot: null, cancelada: false,
    };
    if (!nota.dest.uf && nota.idDest === "1") nota.dest.uf = nota.emit.uf;
    const tot = filho(filho(infNFe, "total"), "ICMSTot");
    for (const k of ["vBC", "vICMS", "vICMSDeson", "vFCP", "vBCST", "vST", "vFCPST", "vFCPSTRet", "vProd", "vFrete", "vSeg", "vDesc", "vII", "vIPI", "vIPIDevol", "vPIS", "vCOFINS", "vOutro", "vNF", "vFCPUFDest", "vICMSUFDest", "vICMSUFRemet", "vTotTrib"]) nota.total[k] = n(txt(tot, k));
    const ibsTot = filho(filho(infNFe, "total"), "IBSCBSTot");
    if (ibsTot) nota.ibscbsTot = { vBC: n(txt(ibsTot, "vBCIBSCBS")), vIBS: n(txt(ibsTot, "vIBS")), vCBS: n(txt(ibsTot, "vCBS")) };

    for (const det of filhosDiretos(infNFe, "det")) {
      const prod = filho(det, "prod"), imp = filho(det, "imposto");
      const icmsGrupo = primeiroGrupo(filho(imp, "ICMS"));
      const tagIcms = icmsGrupo ? (icmsGrupo.localName || icmsGrupo.nodeName) : "";
      const g = (t) => txt(icmsGrupo, t);
      const it = {
        nItem: det.getAttribute("nItem"),
        cProd: txt(prod, "cProd"), xProd: txt(prod, "xProd"), ncm: txt(prod, "NCM"), cest: txt(prod, "CEST"), cBenef: txt(prod, "cBenef"),
        cfop: txt(prod, "CFOP"), uCom: txt(prod, "uCom"), qCom: n(txt(prod, "qCom")),
        vProd: n(txt(prod, "vProd")), vDesc: n(txt(prod, "vDesc")), vFrete: n(txt(prod, "vFrete")), vSeg: n(txt(prod, "vSeg")), vOutro: n(txt(prod, "vOutro")),
        indTot: txt(prod, "indTot") || "1",
        icms: {
          tag: tagIcms, orig: g("orig"), cst: g("CST"), csosn: g("CSOSN"), modBC: g("modBC"),
          vBC: n(g("vBC")), pICMS: n(g("pICMS")), vICMS: n(g("vICMS")), pRedBC: n(g("pRedBC")),
          vICMSDeson: n(g("vICMSDeson")), motDesICMS: g("motDesICMS"),
          vBCST: n(g("vBCST")), pMVAST: n(g("pMVAST")), pRedBCST: n(g("pRedBCST")), pICMSST: n(g("pICMSST")), vICMSST: n(g("vICMSST")),
          vBCFCP: n(g("vBCFCP")), pFCP: n(g("pFCP")), vFCP: n(g("vFCP")), vBCFCPST: n(g("vBCFCPST")), pFCPST: n(g("pFCPST")), vFCPST: n(g("vFCPST")),
          pCredSN: n(g("pCredSN")), vCredICMSSN: n(g("vCredICMSSN")),
          vBCSTRet: n(g("vBCSTRet")), vICMSSTRet: n(g("vICMSSTRet")),
          temVBC: temValor(g("vBC")), temPICMS: temValor(g("pICMS")), temVICMS: temValor(g("vICMS")),
        },
        ipi: { cst: txt(filho(imp, "IPI"), "CST"), vBC: n(txt(filho(imp, "IPI"), "vBC")), pIPI: n(txt(filho(imp, "IPI"), "pIPI")), vIPI: n(txt(filho(imp, "IPI"), "vIPI")) },
        pis: { cst: txt(filho(imp, "PIS"), "CST"), vBC: n(txt(filho(imp, "PIS"), "vBC")), p: n(txt(filho(imp, "PIS"), "pPIS")), v: n(txt(filho(imp, "PIS"), "vPIS")) },
        cofins: { cst: txt(filho(imp, "COFINS"), "CST"), vBC: n(txt(filho(imp, "COFINS"), "vBC")), p: n(txt(filho(imp, "COFINS"), "pCOFINS")), v: n(txt(filho(imp, "COFINS"), "vCOFINS")) },
        difal: null, ibscbs: null,
      };
      const uf = filho(imp, "ICMSUFDest");
      if (uf) it.difal = { vBCUFDest: n(txt(uf, "vBCUFDest")), vBCFCPUFDest: n(txt(uf, "vBCFCPUFDest")), pFCPUFDest: n(txt(uf, "pFCPUFDest")), pICMSUFDest: n(txt(uf, "pICMSUFDest")), pICMSInter: n(txt(uf, "pICMSInter")), vFCPUFDest: n(txt(uf, "vFCPUFDest")), vICMSUFDest: n(txt(uf, "vICMSUFDest")), vICMSUFRemet: n(txt(uf, "vICMSUFRemet")) };
      const ib = filho(imp, "IBSCBS");
      if (ib) it.ibscbs = { cst: txt(ib, "CST"), cClassTrib: txt(ib, "cClassTrib"), vBC: n(txt(ib, "vBC")), pIBSUF: n(txt(ib, "pIBSUF")), vIBSUF: n(txt(ib, "vIBSUF")), pIBSMun: n(txt(ib, "pIBSMun")), vIBSMun: n(txt(ib, "vIBSMun")), pCBS: n(txt(ib, "pCBS")), vCBS: n(txt(ib, "vCBS")), temGrupo: !!filho(ib, "gIBSCBS") };
      it.icms.codigo = it.icms.cst || it.icms.csosn;
      it.vContabil = r2(it.vProd - it.vDesc + it.vFrete + it.vSeg + it.vOutro + it.ipi.vIPI + it.icms.vICMSST + it.icms.vFCPST);
      nota.itens.push(it);
    }
    return { tipo: "nfe", nota };
  }

  function dvChave(chave43) {
    let peso = 2, soma = 0;
    for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  }

  // ------------------------------------------------------------------ auditoria
  const REGRAS = {
    ESTRUTURA: "Estrutura e autorização da nota",
    CHAVE: "Chave de acesso",
    DUPLICADA: "Nota em duplicidade",
    NCM: "NCM inexistente ou fora de vigência",
    CEST: "CEST",
    CFOP_EXISTE: "CFOP inexistente ou fora de vigência",
    CFOP_DESTINO: "CFOP x local de destino",
    CFOP_TIPO: "CFOP x tipo da nota (entrada/saída)",
    CFOP_CST: "CFOP x CST/CSOSN (substituição tributária)",
    CFOP_NAOCONTRIB: "CFOP em venda a não contribuinte",
    CRT_CST: "Regime (CRT) x CST/CSOSN",
    ALIQ_INTER: "Alíquota interestadual",
    ALIQ_INTERNA: "Alíquota interna",
    CALC_ICMS: "Cálculo do ICMS",
    REDUCAO: "Redução de base de cálculo",
    ST: "ICMS-ST",
    DIFAL: "DIFAL (EC 87/2015)",
    FCP: "FCP",
    SN_CREDITO: "Crédito do Simples Nacional",
    CBENEF: "Código de benefício fiscal (cBenef)",
    DEST: "Dados do destinatário",
    TOTAIS: "Totais da nota",
    PIS_COFINS: "PIS/COFINS",
    IBSCBS: "IBS/CBS (Reforma Tributária)",
  };

  const tol = (a, b, t = 0.02) => Math.abs(a - b) <= t;
  const CST_TRIB = ["00", "10", "20", "70", "90"];
  const CST_ST_SAIDA = ["10", "30", "70"];
  const CSOSN_ST = ["201", "202", "203"];
  const CST_BENEF = ["20", "30", "40", "41", "50", "51", "70", "90"];

  /* notas: array de nota; base: { ncmMap, cfopMap, ufs, fcp, cestPorNcm, cclassMap }
   * empresa: { doc, regime, uf } */
  function auditar(notas, base, empresa) {
    const achados = [];
    const add = (nota, item, sev, regra, detalhe, encontrado, esperado) => achados.push({
      sev, regra, detalhe, encontrado: encontrado == null ? "" : String(encontrado), esperado: esperado == null ? "" : String(esperado),
      chave: nota.chave, nNF: nota.nNF, serie: nota.serie, mod: nota.mod, emitente: nota.emit.nome, emitDoc: nota.emit.doc, dhEmi: nota.dhEmi,
      item: item ? item.nItem : "", xProd: item ? item.xProd : "", direcao: nota.direcao,
    });

    const vistos = new Map();
    for (const nota of notas) {
      nota.direcao = direcao(nota, empresa);
      // ---------- nota
      if (vistos.has(nota.chave)) { add(nota, null, "alerta", "DUPLICADA", `Mesma chave já lida no arquivo ${vistos.get(nota.chave)}. A cópia foi ignorada na apuração.`, nota.arquivo); nota.duplicada = true; continue; }
      vistos.set(nota.chave, nota.arquivo);
      if (nota.cancelada) { add(nota, null, "verificar", "ESTRUTURA", "Nota cancelada (evento 110111). Fica fora da apuração.", "cancelada"); continue; }
      if (!nota.prot) add(nota, null, "alerta", "ESTRUTURA", "XML sem protocolo de autorização (protNFe). Confirme a situação na SEFAZ antes de escriturar.");
      else if (!["100", "150"].includes(nota.prot.cStat)) { add(nota, null, "erro", "ESTRUTURA", `Situação da nota diferente de autorizada (cStat ${nota.prot.cStat}). Fica fora da apuração.`, nota.prot.cStat, "100"); nota.foraApuracao = true; }
      if (nota.tpAmb === "2") { add(nota, null, "erro", "ESTRUTURA", "Nota emitida em ambiente de homologação, sem valor fiscal. Fica fora da apuração.", "tpAmb 2", "tpAmb 1"); nota.foraApuracao = true; }

      if (nota.chave.length !== 44) add(nota, null, "erro", "CHAVE", "Chave de acesso não tem 44 dígitos.", nota.chave.length);
      else {
        const dv = dvChave(nota.chave.slice(0, 43));
        if (String(dv) !== nota.chave[43]) add(nota, null, "erro", "CHAVE", "Dígito verificador da chave não confere.", nota.chave[43], dv);
        if (nota.chave.slice(6, 20) !== soDigitos(nota.emit.doc).padStart(14, "0")) add(nota, null, "erro", "CHAVE", "CNPJ/CPF da chave diferente do emitente.", nota.chave.slice(6, 20), nota.emit.doc);
        if (nota.chave.slice(20, 22) !== nota.mod) add(nota, null, "erro", "CHAVE", "Modelo da chave diferente do modelo da nota.", nota.chave.slice(20, 22), nota.mod);
      }

      const ajuste = nota.finNFe === "2" || nota.finNFe === "3";
      const ufE = nota.emit.uf, ufD = nota.dest.uf;
      if (nota.idDest === "1" && ufD && ufE !== ufD) add(nota, null, "erro", "CFOP_DESTINO", `idDest indica operação interna, mas o destinatário é de ${ufD}.`, `idDest 1 / ${ufE}→${ufD}`);
      if (nota.idDest === "2" && ufD && ufE === ufD) add(nota, null, "erro", "CFOP_DESTINO", "idDest indica operação interestadual, mas emitente e destinatário estão na mesma UF.", `idDest 2 / ${ufE}→${ufD}`);
      if (nota.dest.indIEDest === "1" && !nota.dest.ie && nota.mod === "55") add(nota, null, "erro", "DEST", "Destinatário indicado como contribuinte (indIEDest 1) sem inscrição estadual.");
      if (nota.dest.indIEDest === "9" && nota.indFinal !== "1" && nota.mod === "55" && nota.tpNF === "1" && nota.finNFe === "1") add(nota, null, "alerta", "DEST", "Destinatário não contribuinte (indIEDest 9) em nota sem indicação de consumidor final (indFinal 0).", "indFinal 0", "indFinal 1");

      const normal = nota.emit.crt === "3" || nota.emit.crt === "2";
      const simples = nota.emit.crt === "1" || nota.emit.crt === "4";
      const soma = { vICMS: 0, vProd: 0, vST: 0, vBC: 0, vFCP: 0, vIPI: 0, vDesc: 0, vFrete: 0, vSeg: 0, vOutro: 0, vICMSUFDest: 0, vFCPST: 0, vICMSDeson: 0 };

      for (const it of nota.itens) {
        const ic = it.icms, cfop = it.cfop, c3 = cfopFinal(cfop), d1 = cfop[0];
        soma.vICMS += ic.vICMS; soma.vST += ic.vICMSST; soma.vBC += ic.vBC; soma.vFCP += ic.vFCP; soma.vFCPST += ic.vFCPST; soma.vIPI += it.ipi.vIPI; soma.vICMSDeson += ic.vICMSDeson;
        if (it.indTot === "1") soma.vProd += it.vProd;
        soma.vDesc += it.vDesc; soma.vFrete += it.vFrete; soma.vSeg += it.vSeg; soma.vOutro += it.vOutro;
        if (it.difal) soma.vICMSUFDest += it.difal.vICMSUFDest;

        // NCM
        if (base.ncmMap) {
          const reg = base.ncmMap.get(it.ncm);
          if (it.ncm === "00000000") { if (!/^(5|6)9|^(1|2)9/.test(cfop)) add(nota, it, "alerta", "NCM", "NCM 00000000 só é aceito para itens que não são mercadoria (serviço, por exemplo).", it.ncm); }
          else if (!reg || it.ncm.length !== 8) add(nota, it, "erro", "NCM", "NCM não existe na tabela vigente do Siscomex. Pode ter sido extinto ou estar digitado errado.", fmtNcm(it.ncm));
          else if (reg.fim && nota.dhEmi > reg.fim) add(nota, it, "erro", "NCM", `NCM encerrado em ${reg.fim}.`, fmtNcm(it.ncm));
          else if (reg.ini && nota.dhEmi && nota.dhEmi < reg.ini) add(nota, it, "alerta", "NCM", `NCM só passou a valer em ${reg.ini}, depois da emissão.`, fmtNcm(it.ncm));
        }
        // CEST
        if (it.cest && !/^\d{7}$/.test(it.cest)) add(nota, it, "erro", "CEST", "CEST deve ter 7 dígitos.", it.cest);
        if (base.cestPorNcm && base.cestPorNcm.size) {
          const cands = cestCandidatos(it.ncm, base.cestPorNcm);
          if (it.cest && cands.length && !cands.some((c) => c.cest === it.cest)) add(nota, it, "alerta", "CEST", "CEST não corresponde ao NCM no Convênio ICMS 142/2018.", it.cest, cands.map((c) => c.cest).slice(0, 4).join(", "));
          if (it.cest && !cands.length) add(nota, it, "alerta", "CEST", "NCM não consta nos anexos do Convênio ICMS 142/2018 para este CEST.", `${fmtNcm(it.ncm)} / ${it.cest}`);
          const comST = CST_ST_SAIDA.includes(ic.cst) || ["60", "201", "202", "203", "500"].includes(ic.codigo);
          if (!it.cest && cands.length && comST) add(nota, it, "erro", "CEST", "Item com ST sem CEST. O CEST é obrigatório para mercadorias dos anexos do Convênio ICMS 142/2018.", "", cands.map((c) => c.cest).slice(0, 4).join(", "));
        }
        // CFOP
        const regCfop = base.cfopMap && base.cfopMap.get(cfop);
        if (base.cfopMap && !regCfop) add(nota, it, "erro", "CFOP_EXISTE", "CFOP não existe na tabela oficial do Portal da NF-e.", cfop);
        else if (regCfop && regCfop.fim && nota.dhEmi > regCfop.fim) add(nota, it, "erro", "CFOP_EXISTE", `CFOP encerrado em ${regCfop.fim}.`, cfop);
        if (nota.tpNF === "1" && !["5", "6", "7"].includes(d1)) add(nota, it, "erro", "CFOP_TIPO", "Nota de saída com CFOP de entrada.", cfop);
        if (nota.tpNF === "0" && !["1", "2", "3"].includes(d1)) add(nota, it, "erro", "CFOP_TIPO", "Nota de entrada com CFOP de saída.", cfop);
        const espD1 = { "1": nota.tpNF === "1" ? "5" : "1", "2": nota.tpNF === "1" ? "6" : "2", "3": nota.tpNF === "1" ? "7" : "3" }[nota.idDest];
        if (espD1 && d1 !== espD1 && ["1", "2", "3", "5", "6", "7"].includes(d1)) add(nota, it, "erro", "CFOP_DESTINO", `CFOP ${d1}.xxx não combina com operação ${nota.idDest === "1" ? "interna" : nota.idDest === "2" ? "interestadual" : "com o exterior"} (idDest ${nota.idDest}).`, cfop, espD1 + c3);
        if (nota.tpNF === "1" && ["107", "108"].includes(c3) && !(nota.dest.indIEDest === "9" && nota.indFinal === "1")) add(nota, it, "erro", "CFOP_NAOCONTRIB", "CFOP 6107/6108 é exclusivo de venda a não contribuinte (indIEDest 9 e indFinal 1).", cfop);
        if (nota.tpNF === "1" && nota.idDest === "2" && nota.dest.indIEDest === "9" && ["101", "102"].includes(c3)) add(nota, it, "alerta", "CFOP_NAOCONTRIB", "Venda interestadual a não contribuinte com CFOP de venda a contribuinte.", cfop, "6" + (c3 === "101" ? "107" : "108"));

        // CRT x CST
        if (simples && ic.cst && !ic.csosn) add(nota, it, "erro", "CRT_CST", "Emitente do Simples Nacional (CRT 1/4) usando CST do regime normal. Deveria usar CSOSN.", ic.cst);
        if (normal && ic.csosn) add(nota, it, "erro", "CRT_CST", "Emitente do regime normal (CRT 3) usando CSOSN do Simples Nacional.", ic.csosn);

        // CFOP x ST
        if (nota.tpNF === "1") {
          if (["405", "404"].includes(c3) && !["60", "500"].includes(ic.codigo) && !["30", "10", "70", "90", "900"].includes(ic.codigo)) add(nota, it, "erro", "CFOP_CST", `CFOP ${cfop} (ST já retida) com CST/CSOSN ${ic.codigo}, que não indica ST.`, ic.codigo, "60 ou 500");
          if (["60", "500"].includes(ic.codigo) && ["101", "102"].includes(c3)) add(nota, it, "alerta", "CFOP_CST", `CST/CSOSN ${ic.codigo} (ST retida anteriormente) com CFOP de venda sem ST.`, cfop, (d1 === "5" ? "5405" : "6404"));
          if (["401", "403"].includes(c3) && !(CST_ST_SAIDA.includes(ic.codigo) || CSOSN_ST.includes(ic.codigo) || ["90", "900"].includes(ic.codigo))) add(nota, it, "erro", "CFOP_CST", `CFOP ${cfop} (substituto) sem CST/CSOSN de retenção de ST.`, ic.codigo, "10, 30, 70, 201, 202 ou 203");
        }
        // ST: valores
        if ((CST_ST_SAIDA.includes(ic.cst) || CSOSN_ST.includes(ic.csosn)) && !ajuste) {
          if (!(ic.vICMSST > 0)) add(nota, it, "erro", "ST", "CST/CSOSN com ST, mas o ICMS-ST está zerado.", ic.vICMSST);
          else {
            const proprio = ic.cst ? ic.vICMS : r2(ic.vBC * ic.pICMS / 100);
            const calc = r2(ic.vBCST * ic.pICMSST / 100 - (ic.cst === "30" ? (ic.vICMSDeson || 0) : proprio));
            if (ic.cst !== "30" && !tol(calc, ic.vICMSST, 0.05)) add(nota, it, "alerta", "ST", "ICMS-ST não confere com BC-ST × alíquota − ICMS próprio.", ic.vICMSST, calc);
            if (ic.pMVAST > 0) {
              const baseOp = it.vProd - it.vDesc + it.vFrete + it.vSeg + it.vOutro + it.ipi.vIPI;
              const red = ic.pRedBCST ? (1 - ic.pRedBCST / 100) : 1;
              const bcEsp = r2(baseOp * (1 + ic.pMVAST / 100) * red);
              if (!tol(bcEsp, ic.vBCST, Math.max(0.1, bcEsp * 0.001))) add(nota, it, "alerta", "ST", "BC do ICMS-ST não confere com (produto + IPI + frete + despesas − desconto) × (1 + MVA).", ic.vBCST, bcEsp);
            }
            const intD = aliqInternaUF(base.ufs, ufD, nota.dhEmi);
            if (intD && ic.pICMSST && ufD && ic.pICMSST < intD - 0.001 && !ic.pRedBCST) add(nota, it, "verificar", "ST", `Alíquota do ICMS-ST (${pct(ic.pICMSST)}) abaixo da alíquota interna modal de ${ufD} (${pct(intD)}). Confirme se há alíquota específica para o produto.`, pct(ic.pICMSST), pct(intD));
          }
        }

        // ICMS próprio
        const tributado = CST_TRIB.includes(ic.cst);
        if (tributado && ic.vBC > 0 && !ajuste) {
          const calc = r2(ic.vBC * ic.pICMS / 100);
          if (!tol(calc, ic.vICMS)) add(nota, it, "erro", "CALC_ICMS", "Valor do ICMS diferente de BC × alíquota.", ic.vICMS, calc);
          const baseOp = r2(it.vProd - it.vDesc + it.vFrete + it.vSeg + it.vOutro + ((nota.indFinal === "1" || nota.dest.indIEDest === "9") ? it.ipi.vIPI : 0));
          if (ic.cst === "00" && baseOp > 0 && !tol(ic.vBC, baseOp, Math.max(0.05, baseOp * 0.0005)) && !(ic.vBC > baseOp && tol(ic.vBC, baseOp + it.ipi.vIPI, 0.05))) add(nota, it, "alerta", "CALC_ICMS", "BC do ICMS diferente de produto − desconto + frete + seguro + outras despesas.", ic.vBC, baseOp);
        }
        if (ic.cst === "20" || ic.cst === "70") { if (!(ic.pRedBC > 0)) add(nota, it, "erro", "REDUCAO", `CST ${ic.cst} exige percentual de redução da base (pRedBC).`, ic.pRedBC); }
        if (ic.cst === "00" && ic.pRedBC > 0) add(nota, it, "erro", "REDUCAO", "CST 00 com redução de base. Use CST 20.", pct(ic.pRedBC));
        if (["40", "41"].includes(ic.cst) && ic.vICMS > 0) add(nota, it, "erro", "CALC_ICMS", `CST ${ic.cst} (isenta/não tributada) com ICMS destacado.`, ic.vICMS, 0);
        if (simples && ["101", "102", "103", "300", "400", "500"].includes(ic.csosn) && (ic.vICMS > 0)) add(nota, it, "erro", "CALC_ICMS", `CSOSN ${ic.csosn} não admite destaque de ICMS próprio.`, ic.vICMS, 0);

        // alíquota interestadual
        if (nota.idDest === "2" && tributado && ic.pICMS > 0 && !ajuste && ufD) {
          const esp = aliqInterestadual(ufE, ufD, ic.orig);
          if (!tol(ic.pICMS, esp.aliq, 0.001)) add(nota, it, "erro", "ALIQ_INTER", `Alíquota interestadual ${ufE}→${ufD} com origem ${ic.orig}: esperado ${esp.aliq}%. ${esp.motivo}.`, pct(ic.pICMS), pct(esp.aliq));
        }
        if (nota.idDest === "2" && simples && ic.csosn === "101" && ic.pCredSN > 0) { /* crédito SN informado: ok */ }
        // alíquota interna
        if (nota.idDest === "1" && tributado && ic.pICMS > 0 && !ajuste) {
          const intO = aliqInternaUF(base.ufs, ufE, nota.dhEmi);
          if (intO && !tol(ic.pICMS, intO, 0.001)) add(nota, it, "verificar", "ALIQ_INTERNA", `Alíquota diferente da modal de ${ufE} (${pct(intO)}). Pode ser correta se o produto tiver alíquota específica no RICMS.`, pct(ic.pICMS), pct(intO));
        }
        // DIFAL
        const vendaNaoContrib = nota.tpNF === "1" && nota.idDest === "2" && nota.indFinal === "1" && nota.dest.indIEDest === "9" && nota.mod === "55";
        if (vendaNaoContrib && normal && (tributado || ic.cst === "20") && ic.vICMS > 0 && !ajuste) {
          if (!it.difal) add(nota, it, "erro", "DIFAL", "Venda interestadual a não contribuinte sem o grupo ICMSUFDest (DIFAL).", "ausente", "grupo ICMSUFDest");
          else {
            const d = it.difal;
            const esp = aliqInterestadual(ufE, ufD, ic.orig).aliq;
            if (!tol(d.pICMSInter, esp, 0.001)) add(nota, it, "erro", "DIFAL", "pICMSInter do DIFAL diferente da alíquota interestadual.", pct(d.pICMSInter), pct(esp));
            const intD = aliqInternaUF(base.ufs, ufD, nota.dhEmi);
            if (intD && !tol(d.pICMSUFDest, intD, 0.001)) add(nota, it, "verificar", "DIFAL", `Alíquota interna de destino diferente da modal de ${ufD} (${pct(intD)}).`, pct(d.pICMSUFDest), pct(intD));
            const unica = r2(d.vBCUFDest * (d.pICMSUFDest - d.pICMSInter) / 100);
            const duplaInformada = r2(d.vBCUFDest * d.pICMSUFDest / 100 - ic.vBC * d.pICMSInter / 100);
            const duplaCalc = calcDifal(ic.vBC || d.vBCUFDest, d.pICMSInter, d.pICMSUFDest).dupla;
            if (![unica, duplaInformada, duplaCalc].some((v) => tol(v, d.vICMSUFDest, 0.05))) add(nota, it, "alerta", "DIFAL", "Valor do DIFAL não confere nem por base única nem por base dupla.", d.vICMSUFDest, `única ${unica} / dupla ${duplaCalc}`);
            if (d.pFCPUFDest > 0 && !tol(r2((d.vBCFCPUFDest || d.vBCUFDest) * d.pFCPUFDest / 100), d.vFCPUFDest, 0.05)) add(nota, it, "alerta", "FCP", "FCP de destino (vFCPUFDest) diferente de base × pFCPUFDest.", d.vFCPUFDest, r2((d.vBCFCPUFDest || d.vBCUFDest) * d.pFCPUFDest / 100));
          }
        }
        if (vendaNaoContrib && simples && it.difal && it.difal.vICMSUFDest > 0) add(nota, it, "verificar", "DIFAL", "Simples Nacional destacando DIFAL em venda a não contribuinte. O STF afastou essa cobrança do optante (ADI 5464).", it.difal.vICMSUFDest);
        // FCP
        if (ic.pFCP > 0 && !tol(r2((ic.vBCFCP || ic.vBC) * ic.pFCP / 100), ic.vFCP, 0.03)) add(nota, it, "alerta", "FCP", "Valor do FCP diferente de base × alíquota.", ic.vFCP, r2((ic.vBCFCP || ic.vBC) * ic.pFCP / 100));
        if (ic.pFCP > 0 && base.fcp) { const f = fcpUF(base.fcp, ufE); if (f.max && ic.pFCP > f.max + 0.001) add(nota, it, "alerta", "FCP", `Alíquota de FCP acima do máximo de ${ufE} na tabela do Portal NF-e.`, pct(ic.pFCP), pct(f.max)); if (!f.max) add(nota, it, "alerta", "FCP", `${ufE} não tem FCP na tabela do Portal NF-e.`, pct(ic.pFCP), "0%"); }
        // Simples: crédito
        if (["101", "201"].includes(ic.csosn) && !(ic.pCredSN > 0 && ic.vCredICMSSN > 0)) add(nota, it, "alerta", "SN_CREDITO", `CSOSN ${ic.csosn} sem pCredSN/vCredICMSSN. O comprador não terá o crédito destacado.`, `${ic.pCredSN}% / ${ic.vCredICMSSN}`);
        if (ic.pCredSN > 0 && !tol(r2(it.vProd * ic.pCredSN / 100), ic.vCredICMSSN, 0.05) && !tol(r2((it.vProd - it.vDesc) * ic.pCredSN / 100), ic.vCredICMSSN, 0.05)) add(nota, it, "alerta", "SN_CREDITO", "vCredICMSSN diferente de valor do item × pCredSN.", ic.vCredICMSSN, r2((it.vProd - it.vDesc) * ic.pCredSN / 100));
        // cBenef
        const ufCb = base.ufs && base.ufs[ufE];
        if (ufCb && ufCb.cbenef && normal && CST_BENEF.includes(ic.cst) && !it.cBenef && nota.tpNF === "1") add(nota, it, "verificar", "CBENEF", `${ufE} exige cBenef para CST ${ic.cst} com benefício fiscal. Confira se o item deveria trazer o código.`, "ausente");
        // PIS/COFINS
        if (empresa && nota.direcao === "saida" && empresa.regime === "LP" && ["01"].includes(it.pis.cst) && (tol(it.pis.p, 1.65, 0.001) || tol(it.cofins.p, 7.6, 0.001))) add(nota, it, "alerta", "PIS_COFINS", "Alíquotas do regime não cumulativo (1,65%/7,6%) em empresa do Lucro Presumido. Esperado 0,65%/3%.", `${pct(it.pis.p)} / ${pct(it.cofins.p)}`, "0,65% / 3%");
        if (simples && nota.tpNF === "1" && (it.pis.v > 0 || it.cofins.v > 0)) add(nota, it, "alerta", "PIS_COFINS", "Optante do Simples destacando PIS/COFINS na nota. Esses tributos são recolhidos no DAS.", `${it.pis.v} / ${it.cofins.v}`, "0");
        if (it.pis.p > 0 && it.pis.vBC > 0 && !tol(r2(it.pis.vBC * it.pis.p / 100), it.pis.v)) add(nota, it, "alerta", "PIS_COFINS", "Valor do PIS diferente de base × alíquota.", it.pis.v, r2(it.pis.vBC * it.pis.p / 100));
        if (it.cofins.p > 0 && it.cofins.vBC > 0 && !tol(r2(it.cofins.vBC * it.cofins.p / 100), it.cofins.v)) add(nota, it, "alerta", "PIS_COFINS", "Valor da COFINS diferente de base × alíquota.", it.cofins.v, r2(it.cofins.vBC * it.cofins.p / 100));
        // IBS/CBS
        if (it.ibscbs) {
          const ib = it.ibscbs;
          if (base.cclassMap && ib.cClassTrib && !base.cclassMap.has(ib.cClassTrib)) add(nota, it, "erro", "IBSCBS", "cClassTrib não existe na tabela vigente do Portal da NF-e.", ib.cClassTrib);
          const cc = base.cclassMap && base.cclassMap.get(ib.cClassTrib);
          if (cc && ib.cst && cc.cst !== ib.cst) add(nota, it, "erro", "IBSCBS", "cClassTrib não pertence ao CST de IBS/CBS informado.", `${ib.cst} / ${ib.cClassTrib}`, `CST ${cc.cst}`);
          if (ib.temGrupo && nota.dhEmi && nota.dhEmi.startsWith("2026") && cc && !cc.pRedCBS && cc.cst === "000") {
            if (!tol(ib.pCBS, IBSCBS_2026.pCBS, 0.0001)) add(nota, it, "alerta", "IBSCBS", "Alíquota da CBS diferente de 0,9% (fase de teste de 2026).", pct(ib.pCBS), "0,9%");
            if (!tol(ib.pIBSUF, IBSCBS_2026.pIBSUF, 0.0001)) add(nota, it, "alerta", "IBSCBS", "Alíquota do IBS estadual diferente de 0,1% (fase de teste de 2026).", pct(ib.pIBSUF), "0,1%");
          }
          if (ib.temGrupo && ib.pCBS > 0 && !tol(r2(ib.vBC * ib.pCBS / 100), ib.vCBS)) add(nota, it, "alerta", "IBSCBS", "Valor da CBS diferente de base × alíquota.", ib.vCBS, r2(ib.vBC * ib.pCBS / 100));
        } else if (normal && nota.tpNF === "1" && nota.dhEmi >= "2026-01-01" && !ajuste) {
          add(nota, it, "alerta", "IBSCBS", "Emitente do regime normal sem o grupo IBSCBS no item (obrigatório desde 2026, NT 2025.002).", "ausente", "CST 000 / cClassTrib 000001");
        }
      }

      // ---------- totais
      if (!ajuste) {
        const T = nota.total;
        if (!tol(r2(soma.vICMS), T.vICMS, 0.05)) add(nota, null, "erro", "TOTAIS", "Soma do ICMS dos itens diferente do total da nota.", T.vICMS, r2(soma.vICMS));
        if (!tol(r2(soma.vST), T.vST, 0.05)) add(nota, null, "erro", "TOTAIS", "Soma do ICMS-ST dos itens diferente do total da nota.", T.vST, r2(soma.vST));
        if (!tol(r2(soma.vProd), T.vProd, 0.05)) add(nota, null, "erro", "TOTAIS", "Soma dos produtos diferente do total (vProd).", T.vProd, r2(soma.vProd));
        if (!tol(r2(soma.vICMSUFDest), T.vICMSUFDest, 0.05)) add(nota, null, "erro", "TOTAIS", "Soma do DIFAL dos itens diferente do total (vICMSUFDest).", T.vICMSUFDest, r2(soma.vICMSUFDest));
        const vnf = r2(T.vProd - T.vDesc - T.vICMSDeson + T.vST + T.vFCPST + T.vFrete + T.vSeg + T.vOutro + T.vII + T.vIPI + T.vIPIDevol);
        const vnfSemDeson = r2(vnf + T.vICMSDeson);
        if (!tol(vnf, T.vNF, 0.05) && !tol(vnfSemDeson, T.vNF, 0.05)) add(nota, null, "alerta", "TOTAIS", "Valor total da nota (vNF) diferente da fórmula do leiaute (produtos − descontos + ST + frete + seguro + outras + II + IPI).", T.vNF, vnf);
      }
    }
    return achados;
  }

  function direcao(nota, empresa) {
    const doc = empresa && soDigitos(empresa.doc);
    if (!doc) return nota.tpNF === "1" ? "saida" : "entrada_propria";
    if (soDigitos(nota.emit.doc) === doc) return nota.tpNF === "1" ? "saida" : "entrada_propria";
    if (soDigitos(nota.dest.doc) === doc) return nota.tpNF === "1" ? "entrada" : "devolucao_terceiro";
    return "outra";
  }

  function cestCandidatos(ncm, cestPorNcm) {
    const out = [];
    for (let k = 8; k >= 2; k--) {
      const l = cestPorNcm.get(ncm.slice(0, k));
      if (l) out.push(...l);
    }
    return out;
  }

  // ------------------------------------------------------------------ apuração
  const ehVenda = (cfop) => {
    const d1 = cfop[0], c3 = Number(cfop.slice(1));
    if (!["5", "6", "7"].includes(d1)) return false;
    return (c3 >= 101 && c3 <= 125 && !(c3 >= 151 && c3 <= 159)) || (c3 >= 401 && c3 <= 405) || (c3 >= 651 && c3 <= 656) || (d1 === "7" && c3 >= 127 && c3 <= 127);
  };
  const ehDevolucaoVenda = (cfop, flagsDevol) => {
    const d1 = cfop[0], c3 = Number(cfop.slice(1));
    if (!["1", "2", "3"].includes(d1)) return false;
    return (c3 >= 201 && c3 <= 204) || c3 === 410 || c3 === 411 || (c3 >= 660 && c3 <= 662) || (flagsDevol && c3 >= 201 && c3 <= 209);
  };
  const credPadrao = (cfopFornecedor) => {
    const c3 = Number(String(cfopFornecedor).slice(1));
    return (c3 >= 101 && c3 <= 125) || (c3 >= 201 && c3 <= 210) || (c3 >= 401 && c3 <= 403) || (c3 >= 651 && c3 <= 658);
  };
  const cfopEntradaEquivalente = (c) => ({ "5": "1", "6": "2", "7": "3" }[c[0]] || c[0]) + c.slice(1);

  function agrupar(linhas, chaveFn) {
    const m = new Map();
    for (const l of linhas) {
      const k = chaveFn(l);
      if (!m.has(k)) m.set(k, { chave: k, notas: new Set(), vContabil: 0, vBC: 0, vICMS: 0, vBCST: 0, vICMSST: 0, vIPI: 0, vFCP: 0, vFCPST: 0, vDifal: 0, vFCPDifal: 0, vCred: 0, vPIS: 0, vCOFINS: 0, vCBS: 0, vIBS: 0, isentas: 0, outras: 0 });
      const g = m.get(k);
      g.notas.add(l.nota.chave);
      for (const f of ["vContabil", "vBC", "vICMS", "vBCST", "vICMSST", "vIPI", "vFCP", "vFCPST", "vDifal", "vFCPDifal", "vCred", "vPIS", "vCOFINS", "vCBS", "vIBS", "isentas", "outras"]) g[f] += l[f] || 0;
    }
    return [...m.values()].map((g) => ({ ...g, qtdNotas: g.notas.size, notas: undefined }));
  }

  /* opcoes: { cfopsCredito: Set|null } */
  function apurar(notas, empresa, base, opcoes = {}) {
    const linhas = [];
    for (const nota of notas) {
      if (nota.cancelada || nota.duplicada || nota.foraApuracao) continue;
      nota.direcao = direcao(nota, empresa);
      for (const it of nota.itens) {
        const ic = it.icms;
        const trib = ic.vICMS > 0;
        const isentaCst = ["40", "41", "30"].includes(ic.cst) || ["103", "203", "300", "400"].includes(ic.csosn);
        const l = {
          nota, it, dir: nota.direcao, cfop: it.cfop, uf: nota.direcao === "saida" ? nota.dest.uf : nota.emit.uf,
          cst: (ic.orig || "") + (ic.codigo || ""), cstSemOrig: ic.codigo,
          vContabil: it.vContabil, vBC: ic.vBC, vICMS: ic.vICMS, vBCST: ic.vBCST, vICMSST: ic.vICMSST, vIPI: it.ipi.vIPI,
          vFCP: ic.vFCP, vFCPST: ic.vFCPST, vDifal: it.difal ? it.difal.vICMSUFDest : 0, vFCPDifal: it.difal ? it.difal.vFCPUFDest : 0,
          vPIS: it.pis.v, vCOFINS: it.cofins.v, vCBS: it.ibscbs ? it.ibscbs.vCBS : 0, vIBS: it.ibscbs ? r2(it.ibscbs.vIBSUF + it.ibscbs.vIBSMun) : 0,
          isentas: trib ? 0 : (isentaCst ? it.vContabil : 0), outras: trib ? Math.max(0, r2(it.vContabil - ic.vBC - ic.vICMSST - it.ipi.vIPI)) : (isentaCst ? 0 : it.vContabil),
          vCredSN: ic.vCredICMSSN,
        };
        if (l.dir === "entrada") {
          l.cfopEntrada = cfopEntradaEquivalente(it.cfop);
          const marcado = opcoes.cfopsCredito ? opcoes.cfopsCredito.has(it.cfop) : credPadrao(it.cfop);
          l.vCred = marcado ? (ic.vICMS || ic.vCredICMSSN || 0) : 0;
          l.creditoMarcado = marcado;
        } else if (l.dir === "entrada_propria") {
          l.cfopEntrada = it.cfop;
          l.vCred = ic.vICMS; l.creditoMarcado = true;
        }
        linhas.push(l);
      }
    }
    const saidas = linhas.filter((l) => l.dir === "saida");
    const entradas = linhas.filter((l) => l.dir === "entrada" || l.dir === "entrada_propria");
    const outras = linhas.filter((l) => l.dir === "outra" || l.dir === "devolucao_terceiro");
    const soma = (ls, f) => r2(ls.reduce((a, l) => a + (l[f] || 0), 0));

    const res = {
      qtd: { saidas: new Set(saidas.map((l) => l.nota.chave)).size, entradas: new Set(entradas.map((l) => l.nota.chave)).size, outras: new Set(outras.map((l) => l.nota.chave)).size },
      saidasPorCfop: agrupar(saidas, (l) => l.cfop).sort((a, b) => a.chave.localeCompare(b.chave)),
      entradasPorCfop: agrupar(entradas, (l) => l.dir === "entrada" ? l.cfop : l.cfop).sort((a, b) => a.chave.localeCompare(b.chave)),
      saidasPorUf: agrupar(saidas, (l) => l.uf || "—").sort((a, b) => b.vContabil - a.vContabil),
      entradasPorUf: agrupar(entradas, (l) => l.uf || "—").sort((a, b) => b.vContabil - a.vContabil),
      saidasPorCst: agrupar(saidas, (l) => l.cst).sort((a, b) => a.chave.localeCompare(b.chave)),
      icms: { debitos: soma(saidas, "vICMS"), creditos: soma(entradas, "vCred") },
      st: { retidoSaidas: soma(saidas, "vICMSST"), fcpSt: soma(saidas, "vFCPST"), pagoEntradas: soma(entradas, "vICMSST") },
      difal: { saidas: soma(saidas, "vDifal"), fcpSaidas: soma(saidas, "vFCPDifal") },
      fcp: { proprio: soma(saidas, "vFCP") },
      ipi: { saidas: soma(saidas, "vIPI"), entradas: soma(entradas, "vIPI") },
      pis: { saidas: soma(saidas, "vPIS"), entradas: soma(entradas, "vPIS") },
      cofins: { saidas: soma(saidas, "vCOFINS"), entradas: soma(entradas, "vCOFINS") },
      ibscbs: { cbs: soma(saidas, "vCBS"), ibs: soma(saidas, "vIBS"), cbsEnt: soma(entradas, "vCBS"), ibsEnt: soma(entradas, "vIBS") },
      cfopsEntradaFornecedor: [...new Set(linhas.filter((l) => l.dir === "entrada").map((l) => l.cfop))].sort(),
      creditoPadrao: credPadrao,
    };
    res.icms.saldo = r2(res.icms.debitos - res.icms.creditos);

    // receita (Simples Nacional - segregação do PGDAS-D)
    const vendas = saidas.filter((l) => ehVenda(l.cfop));
    const devol = linhas.filter((l) => (l.dir === "entrada_propria" && ehDevolucaoVenda(l.cfop)) || (l.dir === "entrada" && ["202", "411", "201", "410"].includes(cfopFinal(l.cfop))));
    const comST = (l) => ["10", "30", "60", "70"].includes(l.cstSemOrig) || ["201", "202", "203", "500"].includes(l.cstSemOrig) || ["401", "403", "404", "405"].includes(cfopFinal(l.cfop));
    const receitaItem = (l) => r2(l.it.vProd - l.it.vDesc + l.it.vFrete + l.it.vSeg + l.it.vOutro);
    const somaR = (ls) => r2(ls.reduce((a, l) => a + receitaItem(l), 0));
    res.receita = {
      bruta: somaR(vendas),
      semST: somaR(vendas.filter((l) => !comST(l) && l.cfop[0] !== "7")),
      comST: somaR(vendas.filter((l) => comST(l) && l.cfop[0] !== "7")),
      exportacao: somaR(vendas.filter((l) => l.cfop[0] === "7")),
      interna: somaR(vendas.filter((l) => l.cfop[0] === "5")),
      interestadual: somaR(vendas.filter((l) => l.cfop[0] === "6")),
      devolucoes: somaR(devol),
      outrasSaidas: somaR(saidas.filter((l) => !ehVenda(l.cfop))),
    };
    res.receita.liquida = r2(res.receita.bruta - res.receita.devolucoes);

    // DIFAL estimado nas entradas interestaduais (uso, consumo e ativo)
    const ufEmp = empresa && empresa.uf;
    const intEmp = aliqInternaUF(base.ufs, ufEmp);
    const entInter = linhas.filter((l) => l.dir === "entrada" && l.nota.emit.uf && l.nota.emit.uf !== ufEmp);
    res.difalEntradas = agrupar(entInter, (l) => l.cfop).map((g) => g).sort((a, b) => a.chave.localeCompare(b.chave));
    for (const g of res.difalEntradas) {
      const ls = entInter.filter((l) => l.cfop === g.chave);
      let est = 0;
      for (const l of ls) {
        const pInter = l.it.icms.pICMS || aliqInterestadual(l.nota.emit.uf, ufEmp, l.it.icms.orig).aliq;
        if (intEmp) est += Math.max(0, (l.it.vContabil - l.vICMSST) * (intEmp - pInter) / 100);
      }
      g.difalEstimado = r2(est);
    }
    res.aliqInternaEmpresa = intEmp;
    return res;
  }

  const api = { ORIGEM, CST_ICMS, CSOSN, CRT, CUF, REGRAS, IBSCBS_2026, aliqInterestadual, aliqInternaUF, fcpUF, calcDifal, mvaAjustada, parametrizar, lerXml, auditar, apurar, dvChave, fmtNcm, fmtDoc, soDigitos, cestCandidatos, cfopEntradaEquivalente, r2, pct };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Fiscal = api;
})(typeof window !== "undefined" ? window : globalThis);
