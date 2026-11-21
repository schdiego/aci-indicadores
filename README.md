# Bom Princípio em Números — ACI

Página de indicadores econômicos de Bom Princípio/RS para o site da ACI. Os dados são
coletados automaticamente todo mês de fontes públicas oficiais e publicados no GitHub Pages.
O Wix mostra essa página dentro de um bloco "Incorporar site" (iframe).

```
GitHub Actions (dias 3 e 18)  ──►  src/index.js  ──►  site/dados.json  ──►  GitHub Pages  ──►  iframe no Wix
                                   ├─ MTE/PDET: microdados do Novo CAGED via FTP (sem cadastro)
                                   ├─ Portal da Transparência: API do Bolsa Família (chave gratuita)
                                   └─ IBGE: códigos dos municípios + população Censo 2022
```

## Fontes

| Indicador | Fonte | Atualização |
|---|---|---|
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

  de início de atividade (abertas) e pela data de baixa (fechadas, situação 8), usando a
  fotografia mais recente do cadastro. O mês da fotografia fica incompleto e não é exibido.
- CAGED: soma as movimentações do prazo (MOV) e fora do prazo (FOR) e subtrai as excluídas (EXC),
  pela competência de cada movimentação — o mesmo critério "com ajustes" do MTE.
- Bolsa Família: entre nov/2021 e fev/2023 os dados vêm do Auxílio Brasil.
