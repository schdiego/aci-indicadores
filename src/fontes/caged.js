// Emprego formal por município a partir dos microdados do Novo CAGED (MTE/PDET).
// FTP público: ftp://ftp.mtps.gov.br/pdet/microdados/NOVO CAGED/AAAA/AAAAMM/
//   CAGEDMOV = movimentações declaradas no prazo
//   CAGEDFOR = declarações fora do prazo (somam na competência original)
//   CAGEDEXC = movimentações excluídas (subtraem da competência original)
// MOV + FOR − EXC reproduz os números "com ajustes" divulgados pelo MTE.
// Cada arquivo processado é resumido em dados/cache-caged.json, então só os meses novos são baixados.
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANO_INICIAL } from '../config.js';
import { baixar, texto, linhasDe, normalizar } from './shell.js';

const FTP = 'ftp://ftp.mtps.gov.br/pdet/microdados/NOVO%20CAGED/';
const CACHE = new URL('../../dados/cache-caged.json', import.meta.url);

const SETOR = (secao) => {
  const s = (secao || '').trim().toUpperCase();
  if (s === 'A') return 'Agropecuária';
  if (['B', 'C', 'D', 'E'].includes(s)) return 'Indústria';
  if (s === 'F') return 'Construção';
  if (s === 'G') return 'Comércio';
  if (!s || s === 'Z') return 'Não identificado';
  return 'Serviços';
};

const listarFtp = async (url) => (await texto(url, ['--list-only'])).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

async function lerCache() {
  try { return JSON.parse(await readFile(CACHE, 'utf8')); } catch { return {}; }
}

// Processa um .7z e devolve { "id|AAAAMM|setor": [adm, desl, saldo] }.
export async function processar(arquivo7z, ids6, sinal) {
  const out = {};
  let idx = null;
  let erro = null;
  await linhasDe('7z', ['e', '-so', arquivo7z], (linha) => {
    if (erro) return;
    const c = linha.split(';');
    if (!idx) {
      const cab = c.map((h) => normalizar(h).replace(/ /g, ''));
      idx = {
        comp: cab.findIndex((h) => h === 'COMPETENCIAMOV'),
        mun: cab.findIndex((h) => h === 'MUNICIPIO'),
        secao: cab.findIndex((h) => h === 'SECAO'),
        saldo: cab.findIndex((h) => h === 'SALDOMOVIMENTACAO'),
      };
      if (Object.values(idx).some((v) => v < 0)) erro = new Error(`Cabeçalho inesperado no CAGED: ${linha.slice(0, 300)}`);
      return;
    }
    const mun = c[idx.mun];
    if (!ids6.has(mun)) return;
    const s = Number(c[idx.saldo]);
    const k = `${ids6.get(mun)}|${c[idx.comp]}|${SETOR(c[idx.secao])}`;
    const v = (out[k] ||= [0, 0, 0]);
    if (s === 1) v[0] += sinal; else if (s === -1) v[1] += sinal;
    v[2] += s * sinal;
  });
  if (erro) throw erro;
  if (!idx) throw new Error(`Arquivo vazio: ${arquivo7z}`);
  return out;
}

export async function caged(municipios) {
  const ids6 = new Map(municipios.map((m) => [m.id.slice(0, 6), m.id]));
  const chaveIds = [...ids6.keys()].sort().join(',');
  let cache = await lerCache();
  if (cache._municipios !== chaveIds) cache = { _municipios: chaveIds }; // mudou a lista de cidades: refaz tudo

  const anos = (await listarFtp(FTP)).filter((a) => /^\d{4}$/.test(a) && +a >= ANO_INICIAL).sort();
  const tmp = await mkdtemp(join(tmpdir(), 'caged-'));
  let baixados = 0;
  try {
    for (const ano of anos) {
      const meses = (await listarFtp(`${FTP}${ano}/`)).filter((m) => /^\d{6}$/.test(m)).sort();
      for (const am of meses) {
        const arquivos = await listarFtp(`${FTP}${ano}/${am}/`);
        for (const [tipo, sinal] of [['MOV', 1], ['FOR', 1], ['EXC', -1]]) {
          const nome = arquivos.find((n) => new RegExp(`^CAGED${tipo}${am}\\.7z$`, 'i').test(n));
          const chave = `${am}-${tipo}`;
          if (!nome || cache[chave]) continue;
          const destino = join(tmp, nome);
          console.log(`  CAGED: baixando ${nome}…`);
          await baixar(`${FTP}${ano}/${am}/${nome}`, destino);
          cache[chave] = await processar(destino, ids6, sinal);
          await rm(destino, { force: true });
          baixados++;
          // Salva a cada arquivo: se a execução cair no meio, o trabalho não se perde.
          await writeFile(CACHE, JSON.stringify(cache));
        }
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await writeFile(CACHE, JSON.stringify(cache));
  }
  console.log(`  CAGED: ${baixados} arquivos novos processados`);

  // Soma todos os arquivos por município × competência × setor.
  const total = new Map();
  for (const [chave, dados] of Object.entries(cache)) {
    if (chave.startsWith('_')) continue;
    for (const [k, [adm, desl, saldo]] of Object.entries(dados)) {
      const v = total.get(k) || [0, 0, 0];
      v[0] += adm; v[1] += desl; v[2] += saldo;
      total.set(k, v);
    }
  }
  return [...total.entries()]
    .map(([k, [admissoes, desligamentos, saldo]]) => {
      const [id, comp, setor] = k.split('|');
      return { id, ano: +comp.slice(0, 4), mes: +comp.slice(4, 6), setor, admissoes, desligamentos, saldo };
    })
    .filter((l) => l.ano >= ANO_INICIAL);
}
