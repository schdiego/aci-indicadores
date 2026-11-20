// Coleta mensal dos indicadores de Bom Princípio/RS e vizinhos → site/dados.json
// Uso:
//   node src/index.js            coleta tudo
//   node src/index.js --checar   só confere os esquemas do BigQuery e imprime as colunas
//   node src/index.js --so=bolsa coleta só uma fonte (empresas | emprego | bolsa)
import { readFile, writeFile } from 'node:fs/promises';
import { ARQUIVO_SAIDA } from './config.js';
import { chaveMes } from './util.js';
import { resolverMunicipios, populacaoCenso2022 } from './fontes/ibge.js';
import { conferirEsquemas, caged, empresas } from './fontes/bigquery.js';
import { bolsaFamilia } from './fontes/bolsaFamilia.js';

const args = process.argv.slice(2);
const so = args.find((a) => a.startsWith('--so='))?.slice(5);
const roda = (fonte) => !so || so === fonte;

async function lerAnterior() {
  try { return JSON.parse(await readFile(ARQUIVO_SAIDA, 'utf8')); } catch { return {}; }
}

const somar = (alvo, chave, campo, v) => {
  alvo[chave] ??= {};
  alvo[chave][campo] = (alvo[chave][campo] || 0) + v;
};

function montarEmprego(linhas) {
  const mensal = {}, setorAnual = {};
  for (const l of linhas) {
    const m = (mensal[l.id] ??= {});
    const k = chaveMes(l.ano, l.mes);
    for (const c of ['admissoes', 'desligamentos', 'saldo']) somar(m, k, c, l[c]);
    const s = ((setorAnual[l.id] ??= {})[l.ano] ??= {});
    s[l.setor] = (s[l.setor] || 0) + l.saldo;
  }
  return { mensal, setor_anual: setorAnual };
}

function montarEmpresas(linhas) {
  const mensal = {}, setorAnual = {}, ativas = {};
  let referencia = null;
  for (const l of linhas) {
    if (l.tipo === 'referencia') { referencia = l.setor; continue; }
    if (l.tipo === 'ativa') { ativas[l.id] = l.n; continue; }
    const k = chaveMes(l.ano, l.mes);
    const campo = l.tipo === 'aberta' ? 'abertas' : 'fechadas';
    somar((mensal[l.id] ??= {}), k, campo, l.n);
    if (l.tipo === 'aberta') somar(mensal[l.id], k, 'abertas_mei', l.n_mei);
    const s = (((setorAnual[l.id] ??= {})[l.ano] ??= {})[l.setor] ??= { abertas: 0, fechadas: 0 });
    s[campo] += l.n;
  }
  return { referencia, ativas, mensal, setor_anual: setorAnual };
}

async function main() {
  if (args.includes('--checar')) {
    await conferirEsquemas({ imprimir: true });
    console.log('\nEsquemas OK.');
    return;
  }

  const lido = await lerAnterior();
  // Dados de exemplo nunca são reaproveitados como se fossem coletados.
  const anterior = lido.exemplo ? {} : lido;
  const status = { ...(anterior.status || {}) };
  const saida = { ...anterior };
  const agora = new Date().toISOString();

  console.log('Resolvendo municípios no IBGE…');
  const municipios = await resolverMunicipios();
  const ids = municipios.map((m) => m.id);
  const pop = await populacaoCenso2022(ids);
  saida.municipios = municipios.map((m) => ({ ...m, populacao_2022: pop[m.id] ?? null }));

  const etapas = [
    ['emprego', async () => {
      await conferirEsquemas();
      saida.emprego = montarEmprego(await caged(ids));
    }],
    ['empresas', async () => {
      await conferirEsquemas();
      saida.empresas = montarEmpresas(await empresas(ids));
    }],
    ['bolsa', async () => {
      saida.bolsa_familia = { mensal: await bolsaFamilia(municipios, anterior.bolsa_familia?.mensal) };
    }],
  ];

  const erros = [];
  for (const [nome, fn] of etapas) {
    if (!roda(nome)) continue;
    console.log(`Coletando ${nome}…`);
    try {
      await fn();
      status[nome] = { ok: true, atualizado_em: agora };
    } catch (e) {
      console.error(`  ERRO em ${nome}: ${e.message}`);
      erros.push(nome);
      // Mantém os dados anteriores dessa fonte e registra a falha.
      status[nome] = { ...(status[nome] || {}), ok: false, erro: e.message, tentativa_em: agora };
    }
  }

  delete saida.seguro_desemprego;
  delete status.seguro;
  saida.status = status;
  saida.gerado_em = agora;
  // Só deixa de ser "exemplo" quando todas as fontes já foram coletadas de verdade.
  saida.exemplo = !['emprego', 'empresas', 'bolsa'].every((f) => status[f]?.atualizado_em);
  if (saida.exemplo) {
    for (const [f, campo] of [['emprego', 'emprego'], ['empresas', 'empresas'], ['bolsa', 'bolsa_familia']]) {
      if (!status[f]?.atualizado_em) saida[campo] = lido[campo]; // mantém o exemplo só onde falta dado real
    }
  }
  await writeFile(ARQUIVO_SAIDA, JSON.stringify(saida));
  console.log(`\nGravado ${ARQUIVO_SAIDA.pathname}`);

  if (erros.length) {
    console.error(`Fontes com erro: ${erros.join(', ')} (os dados anteriores delas foram mantidos)`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
