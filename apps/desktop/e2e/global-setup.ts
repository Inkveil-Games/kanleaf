import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serverAddress, serverUrl } from './environment';

interface ServerOptions {
  webDir?: string;
  corsOrigins?: string;
}

export default async function globalSetup() {
  return startKanleafServer();
}

export async function startKanleafServer(options: ServerOptions = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for Playwright E2E tests');
  }

  const repositoryRoot = resolve(import.meta.dirname, '../../..');
  const dataDir = await mkdtemp(join(tmpdir(), 'kanleaf-e2e-'));
  const serverEnv = { ...process.env };
  delete serverEnv.KANLEAF_WEB_DIR;
  if (options.webDir) serverEnv.KANLEAF_WEB_DIR = options.webDir;
  const server = spawn('cargo', ['run', '--locked', '-p', 'kanleaf-server'], {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: {
      ...serverEnv,
      DATABASE_URL: databaseUrl,
      KANLEAF_DATA_DIR: dataDir,
      KANLEAF_BIND_ADDRESS: serverAddress,
      KANLEAF_CORS_ORIGINS: options.corsOrigins ?? 'http://127.0.0.1:1421',
      RUST_LOG: 'kanleaf_server=warn',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  server.stderr?.on('data', (chunk: Buffer) => {
    errors = `${errors}${chunk.toString()}`.slice(-8_000);
  });

  try {
    await waitForServer(serverUrl, server, () => errors);
  } catch (error) {
    stopProcess(server.pid);
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }

  return async () => {
    stopProcess(server.pid);
    await Promise.race([
      new Promise<void>((resolveExit) =>
        server.once('exit', () => resolveExit()),
      ),
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
    await rm(dataDir, { recursive: true, force: true });
  };
}

async function waitForServer(
  url: string,
  server: ReturnType<typeof spawn>,
  errors: () => string,
) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Kanleaf server exited during startup:\n${errors()}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The server socket is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Kanleaf server did not become healthy:\n${errors()}`);
}

function stopProcess(pid: number | undefined) {
  if (!pid) return;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM');
  } catch {
    // A process that already exited needs no cleanup.
  }
}
