// Consultas ao BigQuery (datalake público da Base dos Dados — basedosdados.org).
// Fontes originais: Novo CAGED (MTE) e Cadastro Nacional da Pessoa Jurídica (Receita Federal).
import { BigQuery } from '@google-cloud/bigquery';
import { GCP_PROJECT, ANO_INICIAL } from '../config.js';

const T_CAGED = 'basedosdados.br_me_caged.microdados_movimentacao';
const T_ESTAB = 'basedosdados.br_me_cnpj.estabelecimentos';
const T_SIMPLES = 'basedosdados.br_me_cnpj.simples';

// Colunas de que o script depende — conferidas antes de cada execução.
const ESPERADO = {
  [T_CAGED]: ['ano', 'mes', 'id_municipio', 'cnae_2_secao', 'saldo_movimentacao'],
  [T_ESTAB]: ['data', 'ano', 'id_municipio', 'situacao_cadastral', 'data_situacao_cadastral',
    'data_inicio_atividade', 'cnae_fiscal_principal', 'cnpj_basico'],
  [T_SIMPLES]: ['cnpj_basico', 'data_opcao_mei'],
};

let bq;
function cliente() {
  if (!GCP_PROJECT) throw new Error('Defina GCP_PROJECT_ID (projeto do Google Cloud da ACI).');
  bq ??= new BigQuery({ projectId: GCP_PROJECT });
  return bq;
}

async function consultar(sql, params) {
  const [linhas] = await cliente().query({ query: sql, params, location: 'US' });
  return linhas;
}

// Confere se as tabelas ainda têm as colunas esperadas (a Base dos Dados às vezes muda o esquema).
let esquemasConferidos = false;
export async function conferirEsquemas({ imprimir = false } = {}) {
  if (esquemasConferidos && !imprimir) return;
  const problemas = [];
  for (const [tabela, colunas] of Object.entries(ESPERADO)) {
    const [proj, dataset, nome] = tabela.split('.');
    const linhas = await consultar(
      `SELECT column_name, data_type FROM \`${proj}.${dataset}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = @nome`,
      { nome },
    );
    const existentes = new Map(linhas.map((l) => [l.column_name, l.data_type]));
    if (imprimir) console.log(`\n${tabela}\n`, Object.fromEntries(existentes));
    const faltando = colunas.filter((c) => !existentes.has(c));
    if (faltando.length) problemas.push(`${tabela}: faltam ${faltando.join(', ')}`);
  }
  if (problemas.length) throw new Error('Esquema do BigQuery mudou:\n' + problemas.join('\n'));
  esquemasConferidos = true;
}

// Agrupa seções da CNAE 2.0 nos cinco grandes setores usados pelo MTE.
const SETOR_POR_SECAO = `CASE
    WHEN secao = 'A' THEN 'Agropecuária'
    WHEN secao IN ('B','C','D','E') THEN 'Indústria'
    WHEN secao = 'F' THEN 'Construção'
    WHEN secao = 'G' THEN 'Comércio'
    WHEN secao IS NULL OR secao = '' THEN 'Não identificado'
    ELSE 'Serviços' END`;

// Seção CNAE a partir dos 2 primeiros dígitos (divisão) do código de 7 dígitos.
const SECAO_POR_DIVISAO = `CASE
    WHEN div BETWEEN 1 AND 3 THEN 'A'
    WHEN div BETWEEN 5 AND 9 THEN 'B'
    WHEN div BETWEEN 10 AND 33 THEN 'C'
    WHEN div = 35 THEN 'D'
    WHEN div BETWEEN 36 AND 39 THEN 'E'
    WHEN div BETWEEN 41 AND 43 THEN 'F'
    WHEN div BETWEEN 45 AND 47 THEN 'G'
    WHEN div IS NULL THEN NULL
    ELSE 'S' END`;

// ---------------------------------------------------------------- CAGED
export async function caged(ids) {
  const sql = `
    WITH mov AS (
      SELECT CAST(id_municipio AS STRING) AS id, ano, mes,
             UPPER(CAST(cnae_2_secao AS STRING)) AS secao,
             CAST(saldo_movimentacao AS INT64) AS s
      FROM \`${T_CAGED}\`
      WHERE ano >= @ano AND CAST(id_municipio AS STRING) IN UNNEST(@ids)
    )
    SELECT id, ano, mes, ${SETOR_POR_SECAO} AS setor,
           COUNTIF(s = 1) AS admissoes, COUNTIF(s = -1) AS desligamentos, SUM(s) AS saldo
    FROM mov GROUP BY id, ano, mes, setor ORDER BY id, ano, mes`;
  const linhas = await consultar(sql, { ano: ANO_INICIAL, ids });
  return linhas.map((l) => ({
    id: l.id, ano: Number(l.ano), mes: Number(l.mes), setor: l.setor,
    admissoes: Number(l.admissoes), desligamentos: Number(l.desligamentos), saldo: Number(l.saldo),
  }));
}

// ---------------------------------------------------------------- Empresas (CNPJ)
// Usa a fotografia mais recente do cadastro. Conta ESTABELECIMENTOS (matriz e filiais)
// com endereço no município — o mesmo critério do Mapa de Empresas do governo federal.
export async function empresas(ids) {
  const sql = `
    DECLARE ultima DATE DEFAULT (
      SELECT MAX(data) FROM \`${T_ESTAB}\` WHERE ano >= EXTRACT(YEAR FROM CURRENT_DATE()) - 1);
    WITH e AS (
      SELECT CAST(id_municipio AS STRING) AS id, cnpj_basico,
             LTRIM(CAST(situacao_cadastral AS STRING), '0') AS situacao,
             SAFE_CAST(data_situacao_cadastral AS DATE) AS dt_situacao,
             SAFE_CAST(data_inicio_atividade AS DATE) AS dt_inicio,
             SAFE_CAST(SUBSTR(LPAD(CAST(cnae_fiscal_principal AS STRING), 7, '0'), 1, 2) AS INT64) AS div
      FROM \`${T_ESTAB}\`
      WHERE data = ultima AND ano = EXTRACT(YEAR FROM ultima) AND CAST(id_municipio AS STRING) IN UNNEST(@ids)
    ),
    mei AS (
      SELECT cnpj_basico, MIN(SAFE_CAST(data_opcao_mei AS DATE)) AS dt_mei
      FROM \`${T_SIMPLES}\`
      WHERE cnpj_basico IN (SELECT cnpj_basico FROM e)
      GROUP BY cnpj_basico
    ),
    base AS (
      SELECT e.*, ${SECAO_POR_DIVISAO} AS secao,
             mei.dt_mei IS NOT NULL AND ABS(DATE_DIFF(mei.dt_mei, e.dt_inicio, DAY)) <= 60 AS abriu_mei
      FROM e LEFT JOIN mei USING (cnpj_basico)
    )
    SELECT 'aberta' AS tipo, id, EXTRACT(YEAR FROM dt_inicio) AS ano, EXTRACT(MONTH FROM dt_inicio) AS mes,
           ${SETOR_POR_SECAO} AS setor,
           COUNT(*) AS n, COUNTIF(abriu_mei) AS n_mei
    FROM base WHERE dt_inicio >= DATE(@ano, 1, 1)
    GROUP BY tipo, id, ano, mes, setor
    UNION ALL
    SELECT 'fechada', id, EXTRACT(YEAR FROM dt_situacao), EXTRACT(MONTH FROM dt_situacao),
           ${SETOR_POR_SECAO}, COUNT(*), 0
    FROM base WHERE situacao = '8' AND dt_situacao >= DATE(@ano, 1, 1)
    GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT 'ativa', id, NULL, NULL, NULL, COUNTIF(situacao = '2'), 0 FROM base GROUP BY 1, 2
    UNION ALL
    SELECT 'referencia', NULL, EXTRACT(YEAR FROM ultima), EXTRACT(MONTH FROM ultima), CAST(ultima AS STRING), 0, 0`;
  const linhas = await consultar(sql, { ano: ANO_INICIAL, ids });
  return linhas.map((l) => ({
    tipo: l.tipo, id: l.id, ano: l.ano == null ? null : Number(l.ano), mes: l.mes == null ? null : Number(l.mes),
    setor: l.setor, n: Number(l.n), n_mei: Number(l.n_mei),
  }));
}
