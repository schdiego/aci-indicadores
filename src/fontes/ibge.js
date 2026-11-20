// IBGE: resolve códigos de município e busca a população do Censo 2022.
import { MUNICIPIO_PRINCIPAL, VIZINHOS } from '../config.js';
import { getJson } from '../util.js';

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function resolverMunicipios() {
  const lista = await getJson('https://servicodados.ibge.gov.br/api/v1/localidades/estados/43/municipios');
  const porNome = new Map(lista.map((m) => [normalizar(m.nome), String(m.id)]));

  const principal = lista.find((m) => String(m.id) === MUNICIPIO_PRINCIPAL.id);
  if (!principal || normalizar(principal.nome) !== normalizar(MUNICIPIO_PRINCIPAL.nome)) {
    throw new Error(`Código IBGE ${MUNICIPIO_PRINCIPAL.id} não corresponde a ${MUNICIPIO_PRINCIPAL.nome}`);
  }

  const vizinhos = VIZINHOS.map((nome) => {
    const id = porNome.get(normalizar(nome));
    if (!id) throw new Error(`Município "${nome}" não encontrado no RS — confira a grafia em src/config.js`);
    return { id, nome };
  });

  return [{ ...MUNICIPIO_PRINCIPAL, principal: true }, ...vizinhos.map((v) => ({ ...v, principal: false }))];
}

// População residente — Censo 2022 (SIDRA tabela 4709, variável 93).
export async function populacaoCenso2022(ids) {
  const url = `https://apisidra.ibge.gov.br/values/t/4709/n6/${ids.join(',')}/v/93/p/2022?formato=json`;
  try {
    const linhas = await getJson(url);
    const pop = {};
    for (const l of linhas.slice(1)) pop[l.D1C] = Number(l.V);
    return pop;
  } catch (e) {
    console.warn('Aviso: população do Censo indisponível —', e.message);
    return {};
  }
}
