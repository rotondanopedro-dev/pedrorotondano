#!/usr/bin/env python3
"""Gera XMLs FICTÍCIOS de NF-e para demonstrar e testar a auditoria (app/exemplos/).

As empresas, CNPJs e valores são inventados. Cada nota tem erros propositais,
descritos no campo infCpl, para mostrar o que a auditoria encontra.
"""
from pathlib import Path

SAIDA = Path(__file__).resolve().parent.parent / "app" / "exemplos"
CUF = {"SP": 35, "PR": 41, "BA": 29, "MG": 31}
EMPRESA = {"cnpj": "11222333000181", "nome": "EXEMPLO COMERCIO DE ROUPAS E BEBIDAS LTDA", "uf": "SP", "ie": "111222333444", "crt": "3"}
FORN_PR = {"cnpj": "11444777000161", "nome": "FORNECEDOR EXEMPLO TEXTIL SA", "uf": "PR", "ie": "9012345678", "crt": "3"}
FORN_SN = {"cnpj": "12345678000195", "nome": "EXEMPLO MALHARIA ME (SIMPLES)", "uf": "SP", "ie": "222333444555", "crt": "1"}


def dv(ch43: str) -> int:
    peso, soma = 2, 0
    for d in reversed(ch43):
        soma += int(d) * peso
        peso = 2 if peso == 9 else peso + 1
    r = soma % 11
    return 0 if r < 2 else 11 - r


def chave(uf, aamm, cnpj, serie, nnf, cnf):
    base = f"{CUF[uf]:02d}{aamm}{cnpj}55{serie:03d}{nnf:09d}1{cnf:08d}"
    return base + str(dv(base))


def f2(v):
    return f"{v:.2f}"


def item_xml(i, it):
    vprod = it["v"]
    icms = it["icms"]
    imp = f"<ICMS>{icms}</ICMS>"
    imp += '<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>'
    p, c = it.get("pis", (0.65, 3.0))
    if p:
        imp += f'<PIS><PISAliq><CST>01</CST><vBC>{f2(vprod)}</vBC><pPIS>{p:.4f}</pPIS><vPIS>{f2(vprod*p/100)}</vPIS></PISAliq></PIS>'
        imp += f'<COFINS><COFINSAliq><CST>01</CST><vBC>{f2(vprod)}</vBC><pCOFINS>{c:.4f}</pCOFINS><vCOFINS>{f2(vprod*c/100)}</vCOFINS></COFINSAliq></COFINS>'
    else:
        imp += '<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>'
        imp += '<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>'
    if it.get("difal"):
        imp += it["difal"]
    if it.get("ibs", True):
        cbs, ibs = round(vprod * 0.009, 2), round(vprod * 0.001, 2)
        imp += (f'<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>{f2(vprod)}</vBC>'
                f'<gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>{f2(ibs)}</vIBSUF></gIBSUF>'
                f'<gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>{f2(ibs)}</vIBS>'
                f'<gCBS><pCBS>0.9000</pCBS><vCBS>{f2(cbs)}</vCBS></gCBS></gIBSCBS></IBSCBS>')
    cest = f'<CEST>{it["cest"]}</CEST>' if it.get("cest") else ""
    return (f'<det nItem="{i}"><prod><cProd>{it["cod"]}</cProd><cEAN>SEM GTIN</cEAN><xProd>{it["desc"]}</xProd>'
            f'<NCM>{it["ncm"]}</NCM>{cest}<CFOP>{it["cfop"]}</CFOP><uCom>UN</uCom><qCom>{it["q"]:.4f}</qCom>'
            f'<vUnCom>{vprod/it["q"]:.4f}</vUnCom><vProd>{f2(vprod)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>'
            f'<qTrib>{it["q"]:.4f}</qTrib><vUnTrib>{vprod/it["q"]:.4f}</vUnTrib><indTot>1</indTot></prod>'
            f'<imposto>{imp}</imposto></det>')


def nota(nome, emit, dest, nnf, data, itens, idDest, indFinal="0", indIEDest="1", obs="", prot="100", tot_override=None):
    ch = chave(emit["uf"], data[2:4] + data[5:7], emit["cnpj"], 1, nnf, 10000000 + nnf)
    dets = "".join(item_xml(i + 1, it) for i, it in enumerate(itens))
    t = {k: 0.0 for k in ("vBC", "vICMS", "vBCST", "vST", "vProd", "vPIS", "vCOFINS", "vICMSUFDest", "vFCPUFDest")}
    for it in itens:
        t["vProd"] += it["v"]
        t["vBC"] += it.get("vbc", 0)
        t["vICMS"] += it.get("vicms", 0)
        t["vST"] += it.get("vst", 0)
        t["vBCST"] += it.get("vbcst", 0)
        p, c = it.get("pis", (0.65, 3.0))
        t["vPIS"] += round(it["v"] * p / 100, 2)
        t["vCOFINS"] += round(it["v"] * c / 100, 2)
        t["vICMSUFDest"] += it.get("vdifal", 0)
    if tot_override:
        t.update(tot_override)
    vnf = t["vProd"] + t["vST"]
    docdest = f'<CPF>{dest["cpf"]}</CPF>' if "cpf" in dest else f'<CNPJ>{dest["cnpj"]}</CNPJ>'
    iedest = f'<IE>{dest["ie"]}</IE>' if dest.get("ie") else ""
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe{ch}" versao="4.00">
<ide><cUF>{CUF[emit["uf"]]}</cUF><cNF>{10000000 + nnf}</cNF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>{nnf}</nNF><dhEmi>{data}T10:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>{idDest}</idDest><cMunFG>3550308</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>{ch[-1]}</cDV><tpAmb>1</tpAmb><finNFe>1</finNFe><indFinal>{indFinal}</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>EXEMPLO</verProc></ide>
<emit><CNPJ>{emit["cnpj"]}</CNPJ><xNome>{emit["nome"]}</xNome><enderEmit><xLgr>RUA EXEMPLO</xLgr><nro>1</nro><xBairro>CENTRO</xBairro><cMun>3550308</cMun><xMun>EXEMPLO</xMun><UF>{emit["uf"]}</UF></enderEmit><IE>{emit["ie"]}</IE><CRT>{emit["crt"]}</CRT></emit>
<dest>{docdest}<xNome>{dest["nome"]}</xNome><enderDest><xLgr>RUA DESTINO</xLgr><nro>2</nro><xBairro>CENTRO</xBairro><cMun>0000000</cMun><xMun>EXEMPLO</xMun><UF>{dest["uf"]}</UF></enderDest><indIEDest>{indIEDest}</indIEDest>{iedest}</dest>
{dets}
<total><ICMSTot><vBC>{f2(t["vBC"])}</vBC><vICMS>{f2(t["vICMS"])}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCPUFDest>{f2(t["vFCPUFDest"])}</vFCPUFDest><vICMSUFDest>{f2(t["vICMSUFDest"])}</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet><vFCP>0.00</vFCP><vBCST>{f2(t["vBCST"])}</vBCST><vST>{f2(t["vST"])}</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>{f2(t["vProd"])}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>{f2(t["vPIS"])}</vPIS><vCOFINS>{f2(t["vCOFINS"])}</vCOFINS><vOutro>0.00</vOutro><vNF>{f2(vnf)}</vNF></ICMSTot></total>
<transp><modFrete>9</modFrete></transp><infAdic><infCpl>DOCUMENTO FICTICIO PARA DEMONSTRACAO. {obs}</infCpl></infAdic>
</infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>{ch}</chNFe><dhRecbto>{data}T10:01:00-03:00</dhRecbto><nProt>1350000000{nnf:05d}</nProt><cStat>{prot}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>
'''
    (SAIDA / nome).write_text(xml, encoding="utf-8")
    return ch


def icms00(orig, vbc, p):
    v = round(vbc * p / 100, 2)
    return f"<ICMS00><orig>{orig}</orig><CST>00</CST><modBC>3</modBC><vBC>{f2(vbc)}</vBC><pICMS>{p:.4f}</pICMS><vICMS>{f2(v)}</vICMS></ICMS00>", v


def main():
    SAIDA.mkdir(parents=True, exist_ok=True)
    for f in SAIDA.glob("*.xml"):
        f.unlink()
    cli_sp = {"cnpj": "11555888000116", "nome": "CLIENTE EXEMPLO VAREJO SP LTDA", "uf": "SP", "ie": "333444555666"}
    cli_ba = {"cnpj": "11666999000184", "nome": "CLIENTE EXEMPLO BAHIA LTDA", "uf": "BA", "ie": "12345678"}
    cpf_mg = {"cpf": "52998224725", "nome": "CONSUMIDOR EXEMPLO MG", "uf": "MG"}
    emp_dest = {**EMPRESA}

    # 1) Venda interna correta + item com ST e CFOP errado
    i1, v1 = icms00("0", 1000.00, 18)
    nota("exemplo_01_venda_interna.xml", EMPRESA, cli_sp, 101, "2026-10-05", [
        {"cod": "CAM01", "desc": "CAMISETA ALGODAO MALHA", "ncm": "61091000", "cfop": "5102", "q": 20, "v": 1000.00, "icms": i1, "vbc": 1000, "vicms": v1},
        {"cod": "REF02", "desc": "REFRIGERANTE LATA 350ML", "ncm": "22021000", "cfop": "5102", "q": 120, "v": 480.00,
         "icms": "<ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>0.00</vBCSTRet><pST>18.0000</pST><vICMSSTRet>0.00</vICMSSTRet></ICMS60>"},
    ], idDest=1, obs="ERRO PROPOSITAL: CST 60 COM CFOP 5102.")

    # 2) Venda SP -> BA com alíquota de 12% (o correto é 7%) e sem IBS/CBS
    i2, v2 = icms00("0", 2500.00, 12)
    nota("exemplo_02_venda_sp_ba.xml", EMPRESA, cli_ba, 102, "2026-10-08", [
        {"cod": "CAL03", "desc": "CALCA JEANS MASCULINA", "ncm": "62034200", "cfop": "6102", "q": 25, "v": 2500.00, "icms": i2, "vbc": 2500, "vicms": v2, "ibs": False},
    ], idDest=2, obs="ERRO PROPOSITAL: ALIQUOTA INTERESTADUAL SP-BA DEVERIA SER 7%; SEM GRUPO IBSCBS.")

    # 3) Venda a consumidor final de MG sem DIFAL, CFOP 6102 e PIS/COFINS não cumulativo
    i3, v3 = icms00("0", 350.00, 12)
    nota("exemplo_03_venda_consumidor_mg.xml", EMPRESA, cpf_mg, 103, "2026-10-12", [
        {"cod": "JAQ04", "desc": "JAQUETA MOLETOM", "ncm": "61102000", "cfop": "6102", "q": 1, "v": 350.00, "icms": i3, "vbc": 350, "vicms": v3, "pis": (1.65, 7.6)},
    ], idDest=2, indFinal="1", indIEDest="9", obs="ERROS PROPOSITAIS: SEM DIFAL, CFOP 6102 PARA NAO CONTRIBUINTE, PIS/COFINS NAO CUMULATIVO.")

    # 4) Compra de fornecedor do PR com ICMS calculado errado
    i4 = "<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>5000.00</vBC><pICMS>12.0000</pICMS><vICMS>610.00</vICMS></ICMS00>"
    nota("exemplo_04_compra_pr.xml", FORN_PR, emp_dest, 5501, "2026-10-02", [
        {"cod": "MAL-77", "desc": "TECIDO MALHA PENTEADA PARA CONFECCAO", "ncm": "60062200", "cfop": "6102", "q": 100, "v": 5000.00, "icms": i4, "vbc": 5000, "vicms": 610.00},
    ], idDest=2, obs="ERRO PROPOSITAL: VICMS 610,00 (CORRETO 600,00).")

    # 5) Compra de fornecedor do Simples (CSOSN 101) correta
    i5 = "<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>2.5600</pCredSN><vCredICMSSN>30.72</vCredICMSSN></ICMSSN101>"
    nota("exemplo_05_compra_simples.xml", FORN_SN, emp_dest, 880, "2026-10-03", [
        {"cod": "BON-1", "desc": "BONE BORDADO", "ncm": "65050090", "cfop": "5102", "q": 60, "v": 1200.00, "icms": i5, "pis": (0, 0), "ibs": False},
    ], idDest=1, obs="NOTA SEM ERROS.")

    # 6) Venda cancelada + evento de cancelamento
    i6, v6 = icms00("0", 800.00, 18)
    ch6 = nota("exemplo_06_venda_cancelada.xml", EMPRESA, cli_sp, 104, "2026-10-15", [
        {"cod": "CAM01", "desc": "CAMISETA ALGODAO MALHA", "ncm": "61091000", "cfop": "5102", "q": 16, "v": 800.00, "icms": i6, "vbc": 800, "vicms": v6},
    ], idDest=1, obs="NOTA CANCELADA POR EVENTO.")
    (SAIDA / "exemplo_06_evento_cancelamento.xml").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento Id="ID110111{ch6}01"><cOrgao>35</cOrgao><tpAmb>1</tpAmb><CNPJ>{EMPRESA["cnpj"]}</CNPJ><chNFe>{ch6}</chNFe><dhEvento>2026-10-15T15:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>135000000000104</nProt><xJust>DOCUMENTO FICTICIO PARA DEMONSTRACAO</xJust></detEvento></infEvento></evento><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>{ch6}</chNFe><tpEvento>110111</tpEvento></infEvento></retEvento></procEventoNFe>
''', encoding="utf-8")
    arquivos = sorted(p.name for p in SAIDA.glob("*.xml"))
    (SAIDA / "lista.json").write_text('{"arquivos":' + str(arquivos).replace("'", '"') + "}", encoding="utf-8")
    print("\n".join(arquivos))


if __name__ == "__main__":
    main()
