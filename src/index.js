// Coleta mensal dos indicadores de Bom Princípio/RS e vizinhos → site/dados.json
// Uso:
//   node src/index.js            coleta tudo
//   node src/index.js --so=bolsa coleta só uma fonte (empresas | emprego | bolsa)
import { readFile, writeFile } from 'node:fs/promises';
import { ARQUIVO_SAIDA } from './config.js';
import { chaveMes } from './util.js';
import { resolverMunicipios, populacaoCenso2022 } from './fontes/ibge.js';
import { caged } from './fontes/caged.js';
import { empresas, mesMaisRecente } from './fontes/cnpj.js';
import { bolsaFamilia } from './fontes/bolsaFamilia.js';
import { CHAVE_PORTAL } from './config.js';

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

const FONTES = [['emprego', 'emprego'], ['empresas', 'empresas'], ['bolsa', 'bolsa_familia']];

async function main() {
  const lido = await lerAnterior();
  // Fontes que ainda estão com dados de exemplo: nunca são reaproveitadas como se fossem coletadas.
  const amostra = new Set(lido.exemplo_fontes ?? (lido.exemplo ? FONTES.map(([f]) => f) : []));
  const anterior = { ...lido, status: { ...(lido.status || {}) } };
  for (const [f, campo] of FONTES) if (amostra.has(f)) { delete anterior[campo]; delete anterior.status[f]; }
  delete anterior.exemplo;
  const status = { ...anterior.status };
  const saida = { ...anterior };
  const agora = new Date().toISOString();

  console.log('Resolvendo municípios no IBGE…');
  const municipios = await resolverMunicipios();
  const ids = municipios.map((m) => m.id);
  const pop = await populacaoCenso2022(ids);
  saida.municipios = municipios.map((m) => ({ ...m, populacao_2022: pop[m.id] ?? null }));

  const etapas = [
    ['emprego', async () => {
      saida.emprego = montarEmprego(await caged(municipios));
    }],
    ['empresas', async () => {
      // A base do CNPJ tem ~11 GB: só baixa quando a Receita publica um mês novo.
      const pasta = await mesMaisRecente();
      const mesmaLista = JSON.stringify(anterior.empresas?.municipios) === JSON.stringify(ids);
      if (anterior.empresas?.pasta === pasta && mesmaLista && !args.includes('--forcar')) {
        console.log(`  CNPJ ${pasta} já processado; nada novo.`);
        return;
      }
      const r = await empresas(municipios, { mes: pasta });
      saida.empresas = { ...montarEmpresas(r.linhas), pasta: r.pasta, municipios: ids };
    }],
    ['bolsa', async () => {
      if (!CHAVE_PORTAL) {
        console.warn('  Bolsa Família pulado: falta a chave PORTAL_TRANSPARENCIA_KEY.');
        return 'pulado';
      }
      saida.bolsa_familia = { mensal: await bolsaFamilia(municipios, anterior.bolsa_familia?.mensal) };
    }],
  ];

  const erros = [];
  for (const [nome, fn] of etapas) {
    if (!roda(nome)) continue;
    console.log(`Coletando ${nome}…`);
    try {
      if ((await fn()) === 'pulado') continue;
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
  // Cada fonte sai do modo "exemplo" assim que for coletada de verdade; as outras mantêm o exemplo.
  saida.exemplo_fontes = FONTES.filter(([f]) => !status[f]?.atualizado_em).map(([f]) => f);
  for (const [f, campo] of FONTES) if (saida.exemplo_fontes.includes(f)) saida[campo] = lido[campo];
  await writeFile(ARQUIVO_SAIDA, JSON.stringify(saida));
  console.log(`\nGravado ${ARQUIVO_SAIDA.pathname}`);

  if (erros.length) {
    console.error(`Fontes com erro: ${erros.join(', ')} (os dados anteriores delas foram mantidos)`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
