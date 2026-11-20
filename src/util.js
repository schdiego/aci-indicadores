export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { headers = {}, tentativas = 4 } = {}) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.split('?')[0]}`);
      return await res.json();
    } catch (e) {
      ultimoErro = e;
      await sleep(2000 * (i + 1));
    }
  }
  throw ultimoErro;
}

// Lista de {ano, mes} de ANO_INICIAL/01 até o mês informado (inclusive).
export function mesesAte(anoInicial, ateAno, ateMes) {
  const out = [];
  for (let a = anoInicial; a <= ateAno; a++) {
    for (let m = 1; m <= 12; m++) {
      if (a === ateAno && m > ateMes) break;
      out.push({ ano: a, mes: m });
    }
  }
  return out;
}

export const chaveMes = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}`;
