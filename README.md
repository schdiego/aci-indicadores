# Bom Princípio em Números — ACI

Página de indicadores econômicos de Bom Princípio/RS para o site da ACI. Os dados são
coletados automaticamente todo mês de fontes públicas oficiais e publicados no GitHub Pages.
O Wix mostra essa página dentro de um bloco "Incorporar site" (iframe).

```
GitHub Actions (dias 3 e 18)  ──►  src/index.js  ──►  site/dados.json  ──►  GitHub Pages  ──►  iframe no Wix
                                   ├─ Receita Federal: arquivos abertos do CNPJ (sem cadastro)
                                   ├─ MTE/PDET: microdados do Novo CAGED via FTP (sem cadastro)
                                   ├─ Portal da Transparência: API do Bolsa Família (chave gratuita)
                                   └─ IBGE: códigos dos municípios + população Censo 2022
```

## Fontes

| Indicador | Fonte | Atualização |
|---|---|---|
| Empresas abertas e fechadas, setor, MEI, ativas (histórico) | Dados abertos do CNPJ (Receita Federal): Estabelecimentos, Simples, Municípios — rodado no computador | mensal |
| Empresas abertas, fechadas e ativas (meses recentes) | Mapa de Empresas (MEMP), planilhas de dados abertos — automático no GitHub | mensal |
| Admissões, desligamentos e saldo, por setor | Microdados do Novo CAGED (MTE), arquivos MOV + FOR − EXC (dados "com ajustes") | mensal |
| Beneficiários e valor pago do Bolsa Família | API do Portal da Transparência (CGU) | mensal |
| População | Censo 2022 (IBGE/SIDRA) | fixa |

Desemprego: não existe taxa de desemprego mensal por município. O indicador de emprego
da página é o saldo do Novo CAGED.

## Configuração (uma vez)

1. **Portal da Transparência**: cadastre um e-mail em
   https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email para receber a chave.
2. **GitHub**: em *Settings → Secrets and variables → Actions*, crie o secret
   `PORTAL_TRANSPARENCIA_KEY` com a chave recebida. (Sem a chave, o Bolsa Família fica
   com os dados de exemplo.)
3. Em *Settings → Pages*, escolha **Source: GitHub Actions**.
4. Em *Actions → Atualizar indicadores → Run workflow*, rode a primeira coleta. A primeira
   leva bastante tempo (histórico do CAGED desde 2020). As próximas só baixam os meses novos.

## Empresas

Os meses recentes vêm sozinhos do Mapa de Empresas (o histórico das planilhas vai sendo
guardado em `dados/mapa-empresas.json`). O histórico desde 2020, o setor e o MEI vêm da
base do CNPJ, que precisa ser baixada num computador no Brasil — basta uma vez; repetir
de vez em quando só deixa os dados do CNPJ mais atuais.

### CNPJ: rodar no computador

O servidor da Receita recusa conexões de fora do Brasil, e as máquinas do GitHub ficam
nos EUA. Por isso a base do CNPJ é baixada num computador no Brasil (Windows, Mac ou Linux,
só precisa do Node 22+):

1. Baixe o projeto (*Code → Download ZIP*) e descompacte, ou use a pasta que já tem.
2. Abra um terminal na pasta e rode, na primeira vez, `npm install`.
3. Rode `npm run empresas`. Ele baixa ~11 GB, um arquivo por vez (apagando cada um
   depois de ler), e grava `dados/empresas.json` (poucos KB). Leva de 30 min a algumas horas.
4. No GitHub, abra a pasta `dados` → *Add file → Upload files* e envie o `empresas.json`.
   O envio dispara o robô, que junta as empresas aos outros dados e publica o site.

O resumo de cada arquivo do CAGED já processado fica em `dados/cache-caged.json` —
não apague, senão a próxima execução baixa tudo de novo.

## Uso local

```bash
npm ci
export PORTAL_TRANSPARENCIA_KEY=...   # o CAGED precisa de curl e 7z instalados
npm run coletar       # coleta tudo e grava site/dados.json
node src/index.js --so=bolsa   # só uma fonte
npm run exemplo       # dados FICTÍCIOS para testar o visual
npx serve site        # abre a página localmente
```

## Ajustes comuns

- **Trocar as cidades vizinhas:** edite `VIZINHOS` em `src/config.js` (só os nomes).
- **Se uma fonte falhar:** o site continua mostrando os dados anteriores dela, o rodapé indica a
  falha e o GitHub manda um e-mail de erro do workflow.
- **Se o governo mudar o formato de algum arquivo:** a fonte afetada falha com uma mensagem no
  log do GitHub Actions dizendo o que veio diferente; as outras continuam funcionando.

## Observações de metodologia

- Empresas: conta **estabelecimentos** (matriz e filiais) com endereço no município, pela data
  de início de atividade (abertas) e pela data de baixa (fechadas, situação 8), usando a
  fotografia mais recente do cadastro. O mês da fotografia fica incompleto e não é exibido.
- CAGED: soma as movimentações do prazo (MOV) e fora do prazo (FOR) e subtrai as excluídas (EXC),
  pela competência de cada movimentação — o mesmo critério "com ajustes" do MTE.
- Bolsa Família: entre nov/2021 e fev/2023 os dados vêm do Auxílio Brasil.
