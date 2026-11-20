// Empresas por município a partir dos dados abertos do CNPJ (Receita Federal).
// Os arquivos ficam num compartilhamento público (Nextcloud/WebDAV) da Receita:
//   https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ/AAAA-MM/
// Cada mês tem Estabelecimentos0..9.zip (~1 GB cada), Simples.zip e Municipios.zip.
// O script baixa um arquivo por vez, filtra só as linhas dos municípios desejados e apaga o zip.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANO_INICIAL } from '../config.js';
import { baixar, texto, linhasDe, camposReceita, normalizar } from './shell.js';

const BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ/';
// Token público do compartilhamento (o mesmo usado pelo link aberto da Receita).
const TOKEN = process.env.RFB_SHARE_TOKEN || 'gn672Ad4CF8N6TK';
const AUTH = `${TOKEN}:`;

// Lista o conteúdo de uma pasta do WebDAV (nomes dos itens).
async function listar(url) {
  for (let i = 0; i < 4; i++) {
    const xml = await texto(url, ['-X', 'PROPFIND', '-H', 'Depth: 1', '-u', AUTH]);
    const nomes = [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/gi)]
      .map((m) => decodeURIComponent(m[1]).replace(/\/$/, '').split('/').pop())
      .filter(Boolean);
    if (nomes.length > 1) return nomes;
    await new Promise((r) => setTimeout(r, 5000)); // às vezes o servidor responde vazio
  }
  throw new Error(`Não consegui listar ${url}`);
}

export async function mesMaisRecente() {
  const meses = (await listar(BASE)).filter((n) => /^\d{4}-\d{2}$/.test(n)).sort();
  if (!meses.length) throw new Error('Nenhuma pasta AAAA-MM encontrada no compartilhamento da Receita.');
  return meses.at(-1);
}

// Seção da CNAE a partir dos 2 primeiros dígitos.
function setorDaCnae(cnae) {
  const d = Number(String(cnae).padStart(7, '0').slice(0, 2));
  if (!d) return 'Não identificado';
  if (d <= 3) return 'Agropecuária';
  if (d <= 39) return 'Indústria';
  if (d <= 43) return 'Construção';
  if (d <= 47) return 'Comércio';
  return 'Serviços';
}

const data = (s) => (/^\d{8}$/.test(s) && s !== '00000000' ? { ano: +s.slice(0, 4), mes: +s.slice(4, 6), iso: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` } : null);

// municipios: [{ id (IBGE), nome }] — todos no RS.
export async function empresas(municipios, { mes } = {}) {
  const pasta = mes || (await mesMaisRecente());
  const urlPasta = `${BASE}${pasta}/`;
  const arquivos = await listar(urlPasta);
  const estab = arquivos.filter((n) => /^Estabelecimentos\d+\.zip$/i.test(n)).sort();
  const simples = arquivos.find((n) => /^Simples\.zip$/i.test(n));
  const munZip = arquivos.find((n) => /^Municipios\.zip$/i.test(n));
  if (estab.length === 0 || !munZip) throw new Error(`Arquivos esperados não encontrados em ${pasta}: ${arquivos.join(', ')}`);

  const tmp = await mkdtemp(join(tmpdir(), 'cnpj-'));
  try {
    // 1) Códigos de município da Receita (tabela própria, diferente do IBGE).
    const zipMun = join(tmp, 'mun.zip');
    await baixar(urlPasta + munZip, zipMun, { usuario: AUTH });
    const porNome = new Map();
    await linhasDe('unzip', ['-p', zipMun], (l) => {
      const [cod, nome] = camposReceita(l);
      if (cod && nome) (porNome.get(normalizar(nome)) || porNome.set(normalizar(nome), []).get(normalizar(nome))).push(cod);
    });
    const ibgePorCodRf = new Map();
    for (const m of municipios) {
      const cods = porNome.get(normalizar(m.nome));
      if (!cods) throw new Error(`Município ${m.nome} não encontrado na tabela da Receita`);
      for (const c of cods) ibgePorCodRf.set(c, m.id); // homônimos de outros estados são descartados pelo filtro de UF
    }
    const codigos = [...ibgePorCodRf.keys()];
    const filtro = `;"RS";"(${codigos.join('|')})";`;

    // 2) Estabelecimentos dos municípios, arquivo por arquivo.
    const linhas = [];
    for (const nome of estab) {
      const zip = join(tmp, nome);
      console.log(`  CNPJ ${pasta}: baixando ${nome}…`);
      await baixar(urlPasta + nome, zip, { usuario: AUTH });
      await linhasDe('sh', ['-c', `unzip -p "${zip}" | grep -aE '${filtro}'`], (l) => {
        const c = camposReceita(l);
        if (c[19] === 'RS' && ibgePorCodRf.has(c[20])) linhas.push(c);
      });
      await rm(zip, { force: true });
    }
    console.log(`  CNPJ: ${linhas.length} estabelecimentos nos municípios selecionados`);

    // 3) MEI: data de opção pelo MEI de cada CNPJ básico encontrado.
    const meiPorBasico = new Map();
    if (simples) {
      const basicos = new Set(linhas.map((c) => c[0]));
      const zip = join(tmp, 'simples.zip');
      await baixar(urlPasta + simples, zip, { usuario: AUTH });
      await linhasDe('unzip', ['-p', zip], (l) => {
        const c = camposReceita(l);
        if (basicos.has(c[0]) && c[5]) meiPorBasico.set(c[0], c[5]);
      });
      await rm(zip, { force: true });
    }

    // 4) Agregação no formato que o index.js espera.
    const agg = new Map();
    const add = (tipo, id, ano, mes, setor, n, nMei) => {
      const k = [tipo, id, ano, mes, setor].join('|');
      const v = agg.get(k) || { tipo, id, ano, mes, setor, n: 0, n_mei: 0 };
      v.n += n; v.n_mei += nMei; agg.set(k, v);
    };
    for (const c of linhas) {
      const id = ibgePorCodRf.get(c[20]);
      const situacao = String(Number(c[5]));
      const inicio = data(c[10]);
      const sit = data(c[6]);
      const setor = setorDaCnae(c[11]);
      if (situacao === '2') add('ativa', id, null, null, null, 1, 0);
      if (inicio && inicio.ano >= ANO_INICIAL) {
        const mei = data(meiPorBasico.get(c[0]) || '');
        const abriuMei = mei && Math.abs(new Date(mei.iso) - new Date(inicio.iso)) <= 60 * 864e5;
        add('aberta', id, inicio.ano, inicio.mes, setor, 1, abriuMei ? 1 : 0);
      }
      if (situacao === '8' && sit && sit.ano >= ANO_INICIAL) add('fechada', id, sit.ano, sit.mes, setor, 1, 0);
    }
    const saida = [...agg.values()];
    // Referência: dia 1º do mês da publicação (o mês da pasta fica incompleto).
    saida.push({ tipo: 'referencia', id: null, ano: null, mes: null, setor: `${pasta}-01`, n: 0, n_mei: 0 });
    return { pasta, linhas: saida };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
