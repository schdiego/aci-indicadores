// Configuração central da coleta de indicadores — ACI Bom Princípio/RS

// Município principal (código IBGE de 7 dígitos conferido no IBGE Cidades).
export const MUNICIPIO_PRINCIPAL = { id: '4302352', nome: 'Bom Princípio' };

// Vizinhos para o comparativo. Edite à vontade: basta o nome exato (com acento).
// O código IBGE é resolvido a cada execução pela API de localidades do IBGE,
// e o script para com erro se algum nome não for encontrado no RS.
export const VIZINHOS = [
  'São Sebastião do Caí',
  'Feliz',
  'Tupandi',
  'Harmonia',
  'São José do Hortêncio',
];

// Início das séries (o Novo CAGED começa em jan/2020).
export const ANO_INICIAL = 2020;

// Projeto do Google Cloud que paga as consultas ao BigQuery (cabe no free tier).
export const GCP_PROJECT = process.env.GCP_PROJECT_ID;

// Chave da API do Portal da Transparência (cadastro gratuito em
// https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email).
export const CHAVE_PORTAL = process.env.PORTAL_TRANSPARENCIA_KEY;

// Quantos meses recentes são sempre recoletados, porque o governo ajusta dados recentes.
export const MESES_RECOLETA = 4;

export const ARQUIVO_SAIDA = new URL('../site/dados.json', import.meta.url);
