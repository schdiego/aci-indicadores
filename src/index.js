// Coleta mensal dos indicadores de Bom Princípio/RS e vizinhos → site/dados.json
// Uso:
//   node src/index.js            coleta tudo
//   node src/index.js --so=bolsa coleta só uma fonte (empresas | emprego | bolsa)
//   node src/index.js --empresas-local   (npm run empresas) baixa a base do CNPJ da Receita
//       e grava dados/empresas.json. Precisa rodar num computador no Brasil: o servidor da
//       Receita recusa conexões de fora do país (como as máquinas do GitHub).
// No GitHub, a etapa "empresas" só lê o dados/empresas.json enviado ao repositório.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ARQUIVO_SAIDA } from './config.js';
import { chaveMes } from './util.js';
import { resolverMunicipios, populacaoCenso2022 } from './fontes/ibge.js';
import { caged } from './fontes/caged.js';
import { empresas, mesMaisRecente } from './fontes/cnpj.js';
import { bolsaFamilia } from './fontes/bolsaFamilia.js';
import { mapaEmpresas, juntarEmpresas } from './fontes/mapaEmpresas.js';
import { CHAVE_PORTAL } from './config.js';

const args = process.argv.slice(2);
const so = args.find((a) => a.startsWith('--so='))?.slice(5);
const roda = (fonte) => !so || so === fonte;
const ARQUIVO_EMPRESAS = new URL('../dados/empresas.json', import.meta.url);
const ARQUIVO_MAPA = new URL('../dados/mapa-empresas.json', import.meta.url);

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

// Modo local: baixa o CNPJ da Receita e grava só o resumo em dados/empresas.json.
async function empresasLocal() {
  console.log('Resolvendo municípios no IBGE…');
  const municipios = await resolverMunicipios();
  const ids = municipios.map((m) => m.id);
  console.log('Procurando o mês mais recente publicado pela Receita…');
  const pasta = await mesMaisRecente();
  console.log(`Base do CNPJ: ${pasta}. São ~11 GB; cada arquivo é apagado depois de lido.`);
  const r = await empresas(municipios, { mes: pasta });
  const resumo = { gerado_em: new Date().toISOString(), pasta, empresas: { ...montarEmpresas(r.linhas), pasta, municipios: ids } };
  await mkdir(new URL('.', ARQUIVO_EMPRESAS), { recursive: true });
  await writeFile(ARQUIVO_EMPRESAS, JSON.stringify(resumo));
  console.log(`\nPronto! Gravado ${decodeURIComponent(ARQUIVO_EMPRESAS.pathname).replace(/^\/([A-Z]:)/, '$1')}`);
  console.log('Agora envie esse arquivo para a pasta "dados" do repositório no GitHub (Add file → Upload files).');
}

async function main() {
  if (args.includes('--empresas-local')) return empresasLocal();
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
      // Histórico e setor: base do CNPJ, baixada no computador da ACI (npm run empresas) e enviada
      // como dados/empresas.json. Meses mais recentes: planilhas do Mapa de Empresas (gov.br).
      let cnpj = null;
      try { cnpj = JSON.parse(await readFile(ARQUIVO_EMPRESAS, 'utf8')); } catch {
        console.warn('  Ainda não há dados/empresas.json (histórico do CNPJ); usando só o Mapa de Empresas.');
      }
      if (cnpj && JSON.stringify(cnpj.empresas?.municipios) !== JSON.stringify(ids)) {
        console.warn('  dados/empresas.json foi gerado com outra lista de municípios; ignorado até rodar "npm run empresas" de novo.');
        cnpj = null;
      }
      let mapaAnt = {};
      try { mapaAnt = JSON.parse(await readFile(ARQUIVO_MAPA, 'utf8')).mensal || {}; } catch {}
      let mapa = mapaAnt, erroMapa = null;
      try {
        mapa = await mapaEmpresas(municipios, mapaAnt);
        await mkdir(new URL('.', ARQUIVO_MAPA), { recursive: true });
        await writeFile(ARQUIVO_MAPA, JSON.stringify({ municipios: ids, mensal: mapa }));
      } catch (e) {
        erroMapa = e;
        console.error(`  Mapa de Empresas falhou: ${e.message}`);
      }
      if (!cnpj && !Object.keys(mapa).length) throw erroMapa || new Error('Sem dados de empresas.');
      saida.empresas = { ...juntarEmpresas(cnpj?.empresas || null, mapa), pasta: cnpj?.pasta || null, municipios: ids };
      if (cnpj) console.log(`  CNPJ ${cnpj.pasta} (gerado em ${cnpj.gerado_em}) até ${saida.empresas.cnpj_ate}.`);
      if (saida.empresas.inicio_mapa) console.log(`  Mapa de Empresas a partir de ${saida.empresas.inicio_mapa}.`);
      if (erroMapa) throw erroMapa; // dados gravados com o que havia; registra a falha
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
      const r = await fn();
      if (r === 'pulado') continue;
      status[nome] = { ok: true, atualizado_em: r?.atualizado_em || agora };
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
