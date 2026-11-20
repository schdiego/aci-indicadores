// Bolsa Família por município — API do Portal da Transparência (CGU).
// O programa mudou de nome no período, por isso há três endpoints:
//   até out/2021  → Bolsa Família (antigo)
//   nov/2021 a fev/2023 → Auxílio Brasil
//   a partir de mar/2023 → Novo Bolsa Família
import { CHAVE_PORTAL, ANO_INICIAL, MESES_RECOLETA } from '../config.js';
import { getJson, sleep, mesesAte, chaveMes } from '../util.js';

const BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados';

function endpoint(ano, mes) {
  const am = ano * 100 + mes;
  if (am <= 202110) return 'bolsa-familia-por-municipio';
  if (am <= 202302) return 'auxilio-brasil-por-municipio';
  return 'novo-bolsa-familia-por-municipio';
}

async function buscarMes(id, ano, mes) {
  const mesAno = `${ano}${String(mes).padStart(2, '0')}`;
  const url = `${BASE}/${endpoint(ano, mes)}?mesAno=${mesAno}&codigoIbge=${id}&pagina=1`;
  const itens = await getJson(url, { headers: { 'chave-api-dados': CHAVE_PORTAL } });
  if (!Array.isArray(itens) || itens.length === 0) return null; // mês ainda não publicado
  return {
    beneficiarios: itens.reduce((s, i) => s + Number(i.quantidadeBeneficiados || 0), 0),
    valor: Math.round(itens.reduce((s, i) => s + Number(i.valor || 0), 0) * 100) / 100,
  };
}

// `anterior` = série já publicada { id: { 'AAAA-MM': {...} } } — só busca o que falta
// e recoleta os últimos meses (o portal ajusta valores recentes).
export async function bolsaFamilia(municipios, anterior = {}) {
  if (!CHAVE_PORTAL) throw new Error('Defina PORTAL_TRANSPARENCIA_KEY.');
  const hoje = new Date();
  const ultimoMes = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const meses = mesesAte(ANO_INICIAL, ultimoMes.getFullYear(), ultimoMes.getMonth() + 1);
  const recentes = new Set(meses.slice(-MESES_RECOLETA).map((m) => chaveMes(m.ano, m.mes)));

  const saida = {};
  let chamadas = 0;
  for (const { id } of municipios) {
    saida[id] = { ...(anterior[id] || {}) };
    for (const { ano, mes } of meses) {
      const k = chaveMes(ano, mes);
      if (saida[id][k] && !recentes.has(k)) continue;
      const r = await buscarMes(id, ano, mes);
      if (r) saida[id][k] = r;
      chamadas++;
      await sleep(800); // limite da API: 90 req/min em horário comercial
    }
  }
  console.log(`  Bolsa Família: ${chamadas} consultas ao Portal da Transparência`);
  return saida;
}
