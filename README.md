# Bom Princípio em Números — ACI

Página de indicadores econômicos de Bom Princípio/RS para o site da ACI. Os dados são
coletados automaticamente todo mês de fontes públicas oficiais e publicados no GitHub Pages.
O Wix mostra essa página dentro de um bloco "Incorporar site" (iframe).

```
GitHub Actions (dias 3 e 18)  ──►  src/index.js  ──►  site/dados.json  ──►  GitHub Pages  ──►  iframe no Wix
                                   ├─ BigQuery / Base dos Dados: Novo CAGED + CNPJ
                                   ├─ Portal da Transparência: Bolsa Família
                                   └─ IBGE: códigos dos municípios + população Censo 2022
```

## Fontes

| Indicador | Fonte | Atualização |
|---|---|---|
| Empresas abertas e fechadas, setor, MEI, ativas | CNPJ (Receita Federal) via `basedosdados.br_me_cnpj` | mensal |
| Admissões, desligamentos e saldo, por setor | Novo CAGED (MTE) via `basedosdados.br_me_caged` | mensal |
| Beneficiários e valor pago do Bolsa Família | API do Portal da Transparência (CGU) | mensal |
| População | Censo 2022 (IBGE/SIDRA) | fixa |

Desemprego: não existe taxa de desemprego mensal por município. O indicador de emprego
da página é o saldo do Novo CAGED.

## Configuração (uma vez)

1. **Google Cloud (BigQuery)**: crie um projeto (o modo sandbox do BigQuery não pede cartão).
   Crie uma *service account* com os papéis **BigQuery Job User** e **BigQuery Data Viewer**,
   e gere uma chave JSON.
2. **Portal da Transparência**: cadastre um e-mail em
   https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email para receber a chave.
3. **GitHub**: no repositório, em *Settings → Secrets and variables → Actions*, crie:
   - `GCP_SA_KEY`: conteúdo do JSON da service account
   - `GCP_PROJECT_ID`: ID do projeto do Google Cloud
   - `PORTAL_TRANSPARENCIA_KEY`: chave do Portal
4. Em *Settings → Pages*, escolha **Source: GitHub Actions**.
5. Em *Actions → Atualizar indicadores → Run workflow*, rode a primeira coleta. A primeira
   leva uns 10 minutos por causa do histórico do Bolsa Família desde 2020. As próximas são rápidas.

## Uso local

```bash
npm ci
export GCP_PROJECT_ID=... PORTAL_TRANSPARENCIA_KEY=...
gcloud auth application-default login
npm run checar        # confere o esquema das tabelas no BigQuery
npm run coletar       # coleta tudo e grava site/dados.json
node src/index.js --so=bolsa   # só uma fonte
npm run exemplo       # dados FICTÍCIOS para testar o visual
npx serve site        # abre a página localmente
```

## Ajustes comuns

- **Trocar as cidades vizinhas:** edite `VIZINHOS` em `src/config.js` (só os nomes).
- **Se uma fonte falhar:** o site continua mostrando os dados anteriores dela, o rodapé indica a
  falha e o GitHub manda um e-mail de erro do workflow.
- **Se a Base dos Dados mudar o esquema:** `npm run checar` mostra quais colunas sumiram.

## Observações de metodologia

- Empresas: conta **estabelecimentos** (matriz e filiais) com endereço no município, pela data
  de início de atividade (abertas) e pela data de baixa (fechadas, situação 8), usando a
  fotografia mais recente do cadastro. O mês da fotografia fica incompleto e não é exibido.
- CAGED: usa a tabela de movimentações do mês **sem** as declarações fora do prazo, por isso
  pode haver pequenas diferenças em relação aos painéis "com ajustes" do MTE.
- Bolsa Família: entre nov/2021 e fev/2023 os dados vêm do Auxílio Brasil.
