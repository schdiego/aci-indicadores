// Utilitários para baixar e ler arquivos grandes sem carregá-los na memória.
import { spawn, execFile } from 'node:child_process';
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

