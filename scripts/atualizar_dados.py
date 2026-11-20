#!/usr/bin/env python3
"""Atualiza a base de dados fiscais da Central Fiscal ICMS a partir das fontes oficiais.

Fontes (todas gratuitas e públicas):
  - NCM ........ Portal Único Siscomex, módulo Classif (JSON atualizado diariamente)
  - CFOP ....... Portal Nacional da NF-e > Documentos > Diversos (Tabela de CFOP)
  - FCP ........ Portal Nacional da NF-e > Diversos (Tabela de Alíquotas de FCP por UF)
  - cClassTrib . Portal Nacional da NF-e > Diversos (Tabela de Classificação Tributária do IBS e CBS)
  - CEST ....... CONFAZ, Convênio ICMS 142/2018, Anexos II a XXVI
                 (o site do CONFAZ costuma recusar acessos de fora do Brasil; rode este
                 script num computador no Brasil para atualizar o CEST)

Uso:
    python3 scripts/atualizar_dados.py            # atualiza tudo o que conseguir
    python3 scripts/atualizar_dados.py ncm cfop   # só as tabelas indicadas

Dependências: Python 3.9+ e openpyxl (pip install openpyxl).
Cada tabela que falhar mantém a versão anterior em dados/ e o erro é registrado em
dados/fontes.json, então o sistema nunca fica sem base.
"""
from __future__ import annotations

import datetime as dt
import html
import http.cookiejar
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"
CURADOS = DADOS / "curados"
UA = "Mozilla/5.0 (CentralFiscalICMS; atualizador de tabelas publicas)"

URL_NCM = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO"
URL_NFE = "https://www.nfe.fazenda.gov.br/portal/"
URL_NFE_DIVERSOS = URL_NFE + "listaConteudo.aspx?tipoConteudo=/NJarYc9nus="
URL_CONFAZ_142 = "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18"

_cj = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cj))


def baixar(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with _opener.open(req, timeout=timeout) as r:
        return r.read()


def hoje() -> str:
    return dt.date.today().isoformat()


def data_br(s: str) -> str:
    """'31/12/9999' -> '' ; '01/04/2022' -> '2022-04-01'."""
    if not s or s.startswith("31/12/9999"):
        return ""
    d, m, a = s.split("/")
    return f"{a}-{m}-{d}"


def salvar(nome: str, obj) -> int:
    caminho = DADOS / nome
    texto = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    caminho.write_text(texto, encoding="utf-8")
    return len(texto.encode("utf-8"))


# ---------------------------------------------------------------- NCM
def atualizar_ncm() -> dict:
    bruto = json.loads(baixar(URL_NCM, timeout=300).decode("utf-8"))
    itens = []
    for n in bruto["Nomenclaturas"]:
        cod = n["Codigo"].replace(".", "")
        desc = " ".join(html.unescape(re.sub(r"<[^>]+>", "", n["Descricao"])).split())
        ato = f'{n.get("Tipo_Ato_Ini","")} {n.get("Numero_Ato_Ini","")}/{n.get("Ano_Ato_Ini","")}'.strip()
        itens.append([cod, desc, data_br(n["Data_Inicio"]), data_br(n["Data_Fim"]), ato])
    tam = salvar("ncm.json", {
        "fonte": "Portal Único Siscomex - Classif",
        "url": URL_NCM,
        "situacao": bruto.get("Data_Ultima_Atualizacao_NCM", ""),
        "ato": bruto.get("Ato", ""),
        "baixado_em": hoje(),
        "campos": ["codigo", "descricao", "inicio", "fim", "ato"],
        "itens": itens,
    })
    oito = sum(1 for i in itens if len(i[0]) == 8)
    return {"registros": len(itens), "ncm_8_digitos": oito, "bytes": tam,
            "versao": f'{bruto.get("Data_Ultima_Atualizacao_NCM","")} ({bruto.get("Ato","")})'}


# ---------------------------------------------------------------- Portal NF-e (Diversos)
def _links_diversos() -> list[tuple[str, str]]:
    pagina = baixar(URL_NFE_DIVERSOS).decode("utf-8", "ignore")
    out = []
    for m in re.finditer(r'<a[^>]+href="(exibirArquivo[^"]+)"[^>]*>(.*?)</a>', pagina, re.S):
        titulo = html.unescape(" ".join(re.sub(r"<[^>]+>", "", m.group(2)).split()))
        out.append((titulo, URL_NFE + m.group(1).replace(" ", "+")))
    return out


def _primeiro(links, prefixo: str) -> tuple[str, str]:
    for t, u in links:  # a página lista do mais recente para o mais antigo
        if t.lower().startswith(prefixo.lower()):
            return t, u
    raise RuntimeError(f"documento '{prefixo}' não encontrado no Portal NF-e")


def _xlsx(url: str):
    import openpyxl  # noqa: import tardio para o NCM funcionar sem openpyxl
    return openpyxl.load_workbook(io.BytesIO(baixar(url)), read_only=True, data_only=True)


def _d(v) -> str:
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    if v in (None, ""):
        return ""
    s = str(v).strip()
    if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", s):
        d, m, a = s.split("/")
        return f"{a}-{int(m):02d}-{int(d):02d}"
    return s


def atualizar_cfop(links) -> dict:
    titulo, url = _primeiro(links, "Tabela de CFOP")
    ws = _xlsx(url).worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    cab = [str(c or "").strip() for c in linhas[0]]
    ix = {c: i for i, c in enumerate(cab)}
    itens = []
    for r in linhas[1:]:
        if not r or not r[0] or not str(r[0]).strip().isdigit():
            continue
        g = lambda c: r[ix[c]] if c in ix and ix[c] < len(r) else None  # noqa: E731
        flags = {k: int(g(k) or 0) for k in ("indNFe", "indComunica", "indTransp", "indDevol",
                                              "indRetor", "indAnula", "indRemes", "indComb", "indExcIBSCBS")}
        itens.append({
            "c": str(r[0]).strip(),
            "t": " ".join(str(g("Título do CFOP") or "").split()),
            "d": " ".join(str(g("Descrição (nota explicativa)") or "").split()),
            "ini": _d(g("Início de vigência")),
            "fim": _d(g("Fim de vigência")),
            **{k: v for k, v in flags.items() if v},
        })
    tam = salvar("cfop.json", {"fonte": "Portal Nacional da NF-e", "documento": titulo, "url": url,
                               "baixado_em": hoje(), "itens": itens})
    return {"registros": len(itens), "bytes": tam, "versao": titulo}


def atualizar_fcp(links) -> dict:
    titulo, url = _primeiro(links, "Tabela de Alíquotas de FCP por UF")
    ws = _xlsx(url).worksheets[0]
    itens = {}
    for r in ws.iter_rows(values_only=True):
        if not r or not isinstance(r[1], str) or len(r[1].strip()) != 2 or r[1] == "UF":
            continue
        uf = r[1].strip()
        aliqs, obs = [], ""
        for c in r[3:]:
            if c is None:
                continue
            s = str(c).strip()
            m = re.match(r"(Fixo|Max)\s*:\s*([\d.,]+)", s, re.I)
            if m:
                aliqs.append({"tipo": m.group(1).lower(), "aliq": float(m.group(2).replace(",", "."))})
            elif s and s != ".":
                obs = " ".join(s.replace("\xa0", " ").split())
        itens[uf] = {"aliquotas": aliqs, "obs": obs}
    tam = salvar("fcp.json", {"fonte": "Portal Nacional da NF-e", "documento": titulo, "url": url,
                              "baixado_em": hoje(), "itens": itens})
    return {"registros": len(itens), "bytes": tam, "versao": titulo}


def atualizar_cclasstrib(links) -> dict:
    titulo, url = _primeiro(links, "Tabela de Classificação Tributária do IBS e CBS")
    wb = _xlsx(url)
    ws = wb.worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    cab = [str(c or "").strip() for c in linhas[0]]
    ix = {c: i for i, c in enumerate(cab) if c}
    itens = []
    for r in linhas[1:]:
        if not r or not r[ix["cClassTrib"]]:
            continue
        g = lambda c: r[ix[c]] if c in ix and ix[c] < len(r) else None  # noqa: E731
        itens.append({
            "cst": str(g("CST-IBS/CBS")).zfill(3),
            "c": str(g("cClassTrib")).zfill(6),
            "nome": " ".join(str(g("Nome cClassTrib") or "").split()),
            "lc": str(g("LC 214/25") or ""),
            "tipo": str(g("Tipo de Alíquota") or ""),
            "pRedIBS": float(g("pRedIBS") or 0),
            "pRedCBS": float(g("pRedCBS") or 0),
            "ini": _d(g("dIniVig")),
            "fim": _d(g("dFimVig")),
            "nfe": int(g("indNFe") or 0),
            "nfce": int(g("indNFCe") or 0),
        })
    csts = []
    if len(wb.worksheets) > 1:
        for r in list(wb.worksheets[1].iter_rows(values_only=True))[1:]:
            if r and r[0] not in (None, ""):
                csts.append({"cst": str(r[0]).zfill(3), "desc": " ".join(str(r[1] or "").split())})
    tam = salvar("cclasstrib.json", {"fonte": "Portal Nacional da NF-e", "documento": titulo, "url": url,
                                     "baixado_em": hoje(), "aba": ws.title, "itens": itens, "cst": csts})
    return {"registros": len(itens), "bytes": tam, "versao": f"{titulo} (aba {ws.title})"}


# ---------------------------------------------------------------- CEST (CONFAZ)
RE_CEST = re.compile(r"^\d{2}\.\d{3}\.\d{2}$")


def atualizar_cest() -> dict:
    """Lê as tabelas dos Anexos II a XXVI do Convênio ICMS 142/2018 no site do CONFAZ.

    O parser é genérico: percorre todas as linhas <tr> e aproveita as que têm uma
    célula no formato de CEST (99.999.99). As colunas seguintes são ITEM, CEST,
    NCM/SH e DESCRIÇÃO, como no texto consolidado do convênio.
    """
    pagina = baixar(URL_CONFAZ_142, timeout=180).decode("utf-8", "ignore")
    anexo, segmento = "", ""
    itens = []
    for bloco in re.split(r"(?i)(?=<tr)", pagina):
        texto = html.unescape(" ".join(re.sub(r"<[^>]+>", " ", bloco).split()))
        m = re.search(r"ANEXO\s+([IVXL]+)\b", texto)
        if m and "CEST" not in texto[:40]:
            anexo = m.group(1)
            seg = re.search(r"ANEXO\s+[IVXL]+\s*[-–]?\s*(.+?)(?:ITEM|$)", texto)
            if seg:
                segmento = seg.group(1).strip()[:160]
        celulas = [html.unescape(" ".join(re.sub(r"<[^>]+>", " ", c).split()))
                   for c in re.findall(r"(?is)<td[^>]*>(.*?)</td>", bloco)]
        pos = next((i for i, c in enumerate(celulas) if RE_CEST.match(c)), None)
        if pos is None or pos + 2 >= len(celulas):
            continue
        ncms = re.findall(r"\d{4}(?:\.\d{2}){0,2}|\d{2}\.\d{2}", celulas[pos + 1])
        itens.append({
            "cest": celulas[pos].replace(".", ""),
            "item": celulas[pos - 1] if pos > 0 else "",
            "ncm": [n.replace(".", "") for n in ncms],
            "desc": celulas[pos + 2][:400],
            "anexo": anexo,
            "segmento": segmento,
        })
    if len(itens) < 300:
        raise RuntimeError(f"apenas {len(itens)} itens CEST reconhecidos; leiaute do CONFAZ pode ter mudado")
    tam = salvar("cest.json", {"fonte": "CONFAZ - Convênio ICMS 142/2018 (Anexos II a XXVI)",
                               "url": URL_CONFAZ_142, "baixado_em": hoje(), "itens": itens})
    return {"registros": len(itens), "bytes": tam, "versao": f"baixado em {hoje()}"}


# ---------------------------------------------------------------- principal
def main(alvos: list[str]) -> int:
    DADOS.mkdir(exist_ok=True)
    fontes_path = DADOS / "fontes.json"
    fontes = json.loads(fontes_path.read_text(encoding="utf-8")) if fontes_path.exists() else {}
    todos = ["ncm", "cfop", "fcp", "cclasstrib", "cest"]
    alvos = alvos or todos
    links = None
    falhas = 0
    for alvo in alvos:
        try:
            if alvo in ("cfop", "fcp", "cclasstrib") and links is None:
                links = _links_diversos()
            fn = {"ncm": atualizar_ncm, "cest": atualizar_cest}.get(alvo)
            res = fn() if fn else globals()[f"atualizar_{alvo}"](links)
            fontes[alvo] = {**res, "atualizado_em": hoje(), "status": "ok"}
            print(f"[ok]    {alvo}: {res}")
        except Exception as e:  # noqa: BLE001 - registra e segue com as demais tabelas
            falhas += 1
            anterior = fontes.get(alvo, {})
            fontes[alvo] = {**anterior, "status": "falhou", "ultimo_erro": f"{hoje()}: {e}"}
            print(f"[falha] {alvo}: {e}", file=sys.stderr)
    fontes_path.write_text(json.dumps(fontes, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if falhas == len(alvos) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
