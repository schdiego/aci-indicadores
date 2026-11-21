// Utilitários para baixar e ler arquivos grandes sem carregá-los na memória.
import { spawn, execFile } from 'node:child_process';
import yauzl from 'yauzl';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Baixa uma URL para um arquivo local, com novas tentativas.
export async function baixar(url, destino, { usuario } = {}) {
  const args = ['-fsSL', '--retry', '8', '--retry-delay', '30', '--retry-all-errors', '--connect-timeout', '60', '-o', destino];
  if (usuario) args.push('-u', usuario);
  args.push(url);
  await execFileP('curl', args, { maxBuffer: 1024 * 1024 });
}

// Texto de uma URL (listagens de FTP/WebDAV).
export async function texto(url, extra = []) {
  const { stdout } = await execFileP('curl', ['-fsSL', '--retry', '8', '--retry-delay', '30', '--retry-all-errors', ...extra, url], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

// Executa um comando e entrega cada linha da saída para `aoLer`.
export function linhasDe(comando, args, aoLer) {
  return new Promise((resolve, reject) => {
    const p = spawn(comando, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let erro = '';
    p.stderr.on('data', (d) => { erro += d.toString().slice(0, 2000); });
    const rl = createInterface({ input: p.stdout, crlfDelay: Infinity });
    rl.on('line', aoLer);
    p.on('error', reject);
    p.on('close', (code) => {
      // grep sai com 1 quando não encontra nada: não é erro.
      if (code === 0 || (comando === 'sh' && code === 1)) resolve();
      else reject(new Error(`${comando} saiu com código ${code}: ${erro}`));
    });
  });
}

// Divide uma linha CSV da Receita: campos entre aspas, separados por ;
export function camposReceita(linha) {
  const s = linha.trim();
  if (!s.startsWith('"')) return s.split(';');
  return s.slice(1, -1).split('";"');
}

export const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Lê as linhas de todos os arquivos dentro de um .zip, sem descompactar no disco
// (funciona igual no Windows, Linux e Mac). Os CSVs da Receita são Latin-1.
// `contem`: texto que a linha precisa ter para ser entregue (filtro rápido).
export function linhasDoZip(arquivo, aoLer, { contem } = {}) {
  return new Promise((resolve, reject) => {
    yauzl.open(arquivo, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entrada) => {
        if (entrada.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entrada, (e, stream) => {
          if (e) return reject(e);
          stream.setEncoding('latin1');
          const rl = createInterface({ input: stream, crlfDelay: Infinity });
          rl.on('line', (l) => { if (!contem || l.includes(contem)) aoLer(l); });
          rl.on('close', () => zip.readEntry());
          stream.on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

// HTTP pelo próprio Node (sem curl), com novas tentativas. Usado para a Receita.
const autorizacao = (usuario) => (usuario ? { Authorization: 'Basic ' + Buffer.from(usuario).toString('base64') } : {});
async function comTentativas(fn, rotulo, vezes = 8) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= vezes) throw new Error(`${rotulo}: ${e.cause?.code || e.message}`);
      console.warn(`  ${rotulo}: falhou (${e.cause?.code || e.message}), tentando de novo em 30 s…`);
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
}

export function textoHttp(url, { metodo = 'GET', cabecalhos = {}, usuario } = {}) {
  return comTentativas(async () => {
    const r = await fetch(url, { method: metodo, headers: { ...cabecalhos, ...autorizacao(usuario) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }, url);
}

export function baixarHttp(url, destino, { usuario } = {}) {
  return comTentativas(async () => {
    const r = await fetch(url, { headers: autorizacao(usuario) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(destino));
  }, url);
}
