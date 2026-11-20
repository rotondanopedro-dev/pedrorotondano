# Central Fiscal ICMS

Sistema web para:

1. **Consulta por NCM**: parametrização de produtos em vendas dentro e fora do estado (CFOP, CST/CSOSN, alíquota interna e interestadual, DIFAL, FCP, IBS/CBS, PIS/COFINS e calculadora de ICMS-ST com MVA ajustada).
2. **Auditoria de XML**: leitura de NF-e e NFC-e (arquivos soltos ou .zip, com eventos de cancelamento) e relatório de inconsistências.
3. **Apuração**: resumo por CFOP, UF e CST com débitos, créditos, ICMS-ST, DIFAL, FCP, IPI, PIS/COFINS e IBS/CBS. Para o Simples Nacional, mostra a receita segregada para o PGDAS-D.

Todo o processamento roda no navegador. Os XMLs não são enviados a nenhum servidor.

## Fontes de dados (todas gratuitas)

| Tabela | Fonte | Arquivo |
|---|---|---|
| NCM | Portal Único Siscomex, módulo Classif | `dados/ncm.json` |
| CFOP | Portal Nacional da NF-e, Diversos | `dados/cfop.json` |
| FCP por UF | Portal Nacional da NF-e, Diversos | `dados/fcp.json` |
| cClassTrib IBS/CBS | Portal Nacional da NF-e, Diversos (IT 2025.002) | `dados/cclasstrib.json` |
| CEST / ST | CONFAZ, Convênio ICMS 142/2018 | `dados/cest.json` (ver abaixo) |
| Alíquota interna, links SEFAZ, cBenef | Curadoria manual | `dados/curados/ufs.json` |

As alíquotas interestaduais (4%, 7% e 12%) são calculadas pelas Resoluções do Senado 22/1989 e 13/2012.

### Atualizar a base

```bash
pip install openpyxl
```

```bash
python3 scripts/atualizar_dados.py
```

O script baixa cada tabela da fonte oficial e registra versão e data em `dados/fontes.json`. Se uma fonte falhar, a versão anterior é mantida.

**CEST:** o site do CONFAZ recusa conexões de fora do Brasil. Rode `python3 scripts/atualizar_dados.py cest` num computador no Brasil para gerar `dados/cest.json`. Sem esse arquivo o sistema funciona, mas não valida CEST.

Se o arquivo foi gerado em outro computador, coloque-o em qualquer pasta e reprocesse com:

```bash
python3 scripts/atualizar_dados.py importar-cest caminho/do/cest.json
```

O texto consolidado do CONFAZ traz a redação vigente de cada item seguida das redações anteriores. O script usa a primeira linha de cada CEST, descarta os itens revogados, guarda os NCMs de redações antigas em `ncm_anteriores` e marca os itens do Anexo XXVII (escala industrial não relevante). As linhas lidas sem tratamento ficam em `dados/cest_bruto.json`.

**Alíquotas internas:** as UFs marcadas como `conferir` em `dados/curados/ufs.json` tinham valores divergentes entre as fontes públicas em nov/2026. Confirme no RICMS e ajuste o arquivo.

## Rodar localmente

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080/app/index.html`. Localmente aparecem também os botões "Baixar CSV".

## Testes

```bash
npm install
```

```bash
npm test
```

O teste lê os XMLs fictícios de `app/exemplos/` (gerados por `scripts/gerar_exemplos.py`) e confere se cada erro proposital é encontrado.

## Limites

- Regras específicas de cada estado (isenções, reduções de base, alíquotas por produto, MVA e protocolos de ST) não existem em formato estruturado e gratuito. O sistema indica quando conferir e traz os links do RICMS e da SEFAZ.
- Créditos de ICMS consideram os CFOPs marcados na apuração. Entradas para uso e consumo e o CIAP precisam de ajuste manual.
- O sistema é ferramenta de apoio e não substitui a análise da legislação.
