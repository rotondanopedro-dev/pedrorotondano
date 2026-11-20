// Teste do motor de regras com os XMLs de exemplo.
// Uso: npm install && npm test
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { DOMParser } = require("@xmldom/xmldom");
const F = require("../app/regras.js");

const raiz = path.join(__dirname, "..");
const ler = (p) => JSON.parse(fs.readFileSync(path.join(raiz, p), "utf8"));

const ncm = ler("dados/ncm.json");
const cfop = ler("dados/cfop.json");
const cclass = ler("dados/cclasstrib.json");
const base = {
  ufs: ler("dados/curados/ufs.json").ufs,
  fcp: ler("dados/fcp.json"),
  ncmMap: new Map(ncm.itens.map((i) => [i[0], { ini: i[2], fim: i[3] }])),
  cfopMap: new Map(cfop.itens.map((c) => [c.c, c])),
  cclassMap: new Map(cclass.itens.map((c) => [c.c, c])),
  cestPorNcm: new Map(),
};

const dir = path.join(raiz, "app/exemplos");
const notas = [], eventos = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".xml")).sort()) {
  const doc = new DOMParser().parseFromString(fs.readFileSync(path.join(dir, f), "utf8"), "text/xml");
  const r = F.lerXml(doc, f);
  if (r.tipo === "nfe") notas.push(r.nota); else if (r.tipo === "evento") eventos.push(r.evento);
}
for (const e of eventos) if (e.tpEvento === "110111" && ["135", "155"].includes(e.cStat)) { const n = notas.find((x) => x.chave === e.chave); if (n) n.cancelada = true; }

const empresa = { doc: "11222333000181", regime: "LP", uf: "SP" };
const achados = F.auditar(notas, base, empresa);
for (const a of achados) console.log(`${a.sev.padEnd(9)} NF ${a.nNF.padEnd(5)} it ${String(a.item).padEnd(2)} ${a.regra.padEnd(16)} ${a.detalhe} [${a.encontrado} → ${a.esperado}]`);

const tem = (nNF, regra, sev) => achados.some((a) => a.nNF === nNF && a.regra === regra && (!sev || a.sev === sev));
assert(tem("101", "CFOP_CST"), "NF 101: CST 60 com CFOP 5102");
assert(tem("102", "ALIQ_INTER", "erro"), "NF 102: alíquota SP→BA 12%");
assert(tem("102", "IBSCBS"), "NF 102: sem IBS/CBS");
assert(tem("103", "DIFAL", "erro"), "NF 103: sem DIFAL");
assert(tem("103", "CFOP_NAOCONTRIB"), "NF 103: CFOP 6102 para não contribuinte");
assert(tem("103", "PIS_COFINS"), "NF 103: PIS/COFINS não cumulativo");
assert(tem("5501", "CALC_ICMS", "erro"), "NF 5501: vICMS errado");
assert(!achados.some((a) => a.nNF === "880" && a.sev !== "verificar"), "NF 880 sem erros");
assert(!achados.some((a) => a.regra === "CHAVE"), "chaves válidas");
assert(tem("104", "ESTRUTURA", "verificar"), "NF 104 cancelada");

const ap = F.apurar(notas, empresa, base, {});
console.log("\nICMS", ap.icms, "\nreceita", ap.receita);
assert.strictEqual(ap.qtd.saidas, 3);
assert.strictEqual(ap.qtd.entradas, 2);
assert.strictEqual(ap.icms.debitos, F.r2(180 + 300 + 42));
assert.strictEqual(ap.icms.creditos, F.r2(610 + 30.72));

// parametrização
const p = F.parametrizar({ ncm: "61091000", ufO: "SP", ufD: "BA", regime: "LP", dest: "revenda", prod: "revenda", orig: "0", st: "nao" }, base);
assert.strictEqual(p.cfop, "6102"); assert.strictEqual(p.cst, "00"); assert.strictEqual(p.aliq.aplicavel, 7);
const p2 = F.parametrizar({ ncm: "61091000", ufO: "MG", ufD: "SP", regime: "SN", dest: "naocontrib", prod: "propria", orig: "1", st: "nao" }, base);
assert.strictEqual(p2.cfop, "6107"); assert.strictEqual(p2.cst, "102"); assert.strictEqual(p2.aliq.aplicavel, 4); assert.strictEqual(p2.difal.devido, false);
const d = F.calcDifal(1000, 7, 20.5);
assert.strictEqual(d.unica, 135); assert.strictEqual(d.dupla, 169.81); // (1000 − 70) / 0,795 × 20,5% − 70
console.log("\nDIFAL 1000 7%→20,5%:", d, " MVA ajustada 40% 12%→18%:", F.mvaAjustada(40, 12, 18).toFixed(2));
console.log("\nTodos os testes passaram.");
