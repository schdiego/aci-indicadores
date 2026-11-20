// Gera site/dados.json com DADOS FICTÍCIOS, só para testar o visual da página.
// A página mostra uma faixa "dados de exemplo" enquanto exemplo = true.
import { writeFile } from 'node:fs/promises';
import { ARQUIVO_SAIDA } from '../src/config.js';
import { mesesAte, chaveMes } from '../src/util.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const munis = [
  { id: '4302352', nome: 'Bom Princípio', principal: true, populacao_2022: 14000, f: 1 },
  { id: '0000001', nome: 'São Sebastião do Caí', principal: false, populacao_2022: 26000, f: 1.8 },
  { id: '0000002', nome: 'Feliz', principal: false, populacao_2022: 13500, f: 0.95 },
  { id: '0000003', nome: 'Tupandi', principal: false, populacao_2022: 4500, f: 0.35 },
  { id: '0000004', nome: 'Harmonia', principal: false, populacao_2022: 5000, f: 0.4 },
  { id: '0000005', nome: 'São José do Hortêncio', principal: false, populacao_2022: 4300, f: 0.33 },
];
const meses = mesesAte(2020, 2026, 9);
const setores = ['Indústria', 'Comércio', 'Serviços', 'Construção', 'Agropecuária'];
const pesoSetor = [0.3, 0.25, 0.32, 0.08, 0.05];

const d = { exemplo: true, gerado_em: new Date().toISOString(), municipios: munis.map(({ f, ...m }) => m),
  empresas: { referencia: '2026-10-12', ativas: {}, mensal: {}, setor_anual: {} },
  emprego: { mensal: {}, setor_anual: {} }, bolsa_familia: { mensal: {} },
  status: {} };

for (const m of munis) {
  d.empresas.ativas[m.id] = Math.round(1900 * m.f);
  const em = (d.empresas.mensal[m.id] = {}), ep = (d.emprego.mensal[m.id] = {});
  const bf = (d.bolsa_familia.mensal[m.id] = {});
  const sa = (d.empresas.setor_anual[m.id] = {}), ca = (d.emprego.setor_anual[m.id] = {});
  for (const { ano, mes } of meses) {
    const k = chaveMes(ano, mes);
    const tend = 1 + (ano - 2020) * 0.06;
    const abertas = Math.round((14 + rnd() * 10) * m.f * tend);
    const fechadas = Math.round((6 + rnd() * 7) * m.f);
    em[k] = { abertas, fechadas, abertas_mei: Math.round(abertas * (0.55 + rnd() * 0.15)) };
    const adm = Math.round((95 + rnd() * 60) * m.f * (mes === 12 ? 0.6 : 1));
    const des = Math.round((90 + rnd() * 55) * m.f * (mes === 12 ? 1.3 : 1) * (ano === 2020 && mes >= 3 && mes <= 5 ? 1.5 : 1));
    ep[k] = { admissoes: adm, desligamentos: des, saldo: adm - des };
    const benef = Math.round((210 + (ano >= 2023 ? 40 : 0) - (ano - 2020) * 6 + rnd() * 12) * m.f);
    bf[k] = { beneficiarios: benef, valor: Math.round(benef * (ano >= 2023 ? 680 : ano >= 2022 ? 600 : 190)) };
    for (let i = 0; i < setores.length; i++) {
      const s = ((sa[ano] ??= {})[setores[i]] ??= { abertas: 0, fechadas: 0 });
      s.abertas += Math.round(abertas * pesoSetor[i]);
      s.fechadas += Math.round(fechadas * pesoSetor[i]);
      (ca[ano] ??= {})[setores[i]] = (ca[ano][setores[i]] || 0) + Math.round((adm - des) * pesoSetor[i] + (rnd() - 0.5) * 3);
    }
  }
}
for (const f of ['emprego', 'empresas', 'bolsa']) d.status[f] = { ok: true, atualizado_em: d.gerado_em };
await writeFile(ARQUIVO_SAIDA, JSON.stringify(d));
console.log('Dados de exemplo gravados em', ARQUIVO_SAIDA.pathname);
