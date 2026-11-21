// Mapa de Empresas (Ministério do Empreendedorismo / DREI): planilhas mensais de dados abertos
// com empresas abertas, fechadas e ativas por município.
//   https://www.gov.br/memp/pt-br/acesso-a-informacao/dados-abertos/repositorio-de-dados-abertos
// A página lista só os meses mais recentes, então o histórico vai sendo acumulado em
// dados/mapa-empresas.json a cada coleta.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yauzl from 'yauzl';

const PAGINA = process.env.MAPA_PAGINA || 'https://www.gov.br/memp/pt-br/acesso-a-informacao/dados-abertos/repositorio-de-dados-abertos';

async function pedir(url, tipo = 'text') {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'aci-indicadores (dados abertos)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return tipo === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text();
    } catch (e) {
      if (i >= 4) throw new Error(`${url}: ${e.cause?.code || e.message}`);
      await new Promise((res) => setTimeout(res, 15000));
    }
  }
}

// Lê alguns arquivos XML de dentro do .xlsx.
function lerXlsx(arquivo, nomes) {
  return new Promise((resolve, reject) => {
    const out = {};
    yauzl.open(arquivo, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', () => resolve(out));
      zip.on('entry', (e) => {
        if (!nomes.includes(e.fileName)) return zip.readEntry();
        zip.openReadStream(e, (er, s) => {
          if (er) return reject(er);
          const partes = [];
          s.on('data', (d) => partes.push(d));
          s.on('end', () => { out[e.fileName] = Buffer.concat(partes).toString('utf8'); zip.readEntry(); });
          s.on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Primeira aba ("Abertas, Fechadas e Ativas"): A=dt_referencia C=cod_ibge E=abertas F=fechadas G=ativas.
async function lerPlanilha(arquivo, ids6) {
  const x = await lerXlsx(arquivo, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  const ss = [...(x['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar(m[1].replace(/<[^>]+>/g, '')));
  const linhas = [];
  for (const r of (x['xl/worksheets/sheet1.xml'] || '').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const c = {};
    for (const m of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (m[3] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (m[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      if (v == null) continue;
      c[m[1]] = /t="s"/.test(m[2]) ? ss[+v] : desescapar(v);
    }
    const cod = String(c.C || '').trim();
    if (!ids6.has(cod)) continue;
    const serial = Number(c.A);
    if (!serial) continue;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 864e5);
    linhas.push({ cod, mes: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      abertas: Number(c.E) || 0, fechadas: Number(c.F) || 0, ativas: Number(c.G) || 0 });
  }
  return linhas;
}

// municipios: [{ id (IBGE 7 dígitos) }]; anterior: { [id]: { 'AAAA-MM': {abertas, fechadas, ativas} } }
export async function mapaEmpresas(municipios, anterior = {}) {
  const html = await pedir(PAGINA);
  const links = [...new Set([...html.matchAll(/href="([^"]*arquivodados[^"]*mapa-de-empresas[^"]*\.xlsx)(?:\/@@download\/file)?"/gi)]
    .map((m) => new URL(m[1].replace(/\/@@download\/file$/, ''), PAGINA).href))];
  if (!links.length) throw new Error('Nenhuma planilha do Mapa de Empresas encontrada na página de dados abertos.');

  const porId6 = new Map(municipios.map((m) => [String(m.id).slice(0, 6), m.id]));
  const ids6 = new Set(porId6.keys());
  const mensal = structuredClone(anterior);
  const tmp = await mkdtemp(join(tmpdir(), 'mapa-'));
  try {
    for (const [i, url] of links.entries()) {
      const arq = join(tmp, `p${i}.xlsx`);
      await writeFile(arq, await pedir(`${url}/@@download/file`, 'buffer'));
      const linhas = await lerPlanilha(arq, ids6);
      for (const l of linhas) ((mensal[porId6.get(l.cod)] ??= {})[l.mes] = { abertas: l.abertas, fechadas: l.fechadas, ativas: l.ativas });
      console.log(`  Mapa de Empresas: ${url.split('/').pop()} → ${linhas[0]?.mes || 'sem dados dos municípios'}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return mensal;
}

// Junta a base do CNPJ (histórico e setor) com o Mapa de Empresas (meses mais recentes).
// cnpj: saída de montarEmpresas (ou null). mapa: { [id]: { 'AAAA-MM': {...} } }.
export function juntarEmpresas(cnpj, mapa) {
  const out = cnpj ? structuredClone(cnpj) : { referencia: null, ativas: {}, mensal: {}, setor_anual: {} };
  // Último mês completo da base do CNPJ (o mês da "fotografia" está incompleto).
  let ultimoCnpj = '';
  if (cnpj?.referencia) {
    const d = new Date(cnpj.referencia + 'T12:00:00'); d.setMonth(d.getMonth() - 1);
    ultimoCnpj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  let inicioMapa = null, ultimoMapa = '';
  for (const [id, meses] of Object.entries(mapa || {})) {
    for (const [mes, v] of Object.entries(meses)) {
      if (mes > ultimoMapa) ultimoMapa = mes;
      if (mes <= ultimoCnpj) continue;
      (out.mensal[id] ??= {})[mes] = { abertas: v.abertas, fechadas: v.fechadas };
      if (!inicioMapa || mes < inicioMapa) inicioMapa = mes;
    }
  }
  if (ultimoMapa > ultimoCnpj) {
    for (const [id, meses] of Object.entries(mapa)) if (meses[ultimoMapa]) out.ativas[id] = meses[ultimoMapa].ativas;
    const [a, m] = ultimoMapa.split('-').map(Number);
    const prox = new Date(a, m, 1); // mês seguinte ao último do Mapa (a página volta 1 mês)
    out.referencia = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}-01`;
  }
  out.inicio_mapa = inicioMapa; // meses a partir daqui vêm do Mapa de Empresas
  out.cnpj_ate = ultimoCnpj || null;
  return out;
}
