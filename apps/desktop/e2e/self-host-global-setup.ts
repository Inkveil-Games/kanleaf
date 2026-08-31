import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startKanleafServer } from './global-setup';
import { hostE2eEmail, serverUrl } from './environment';

export default async function selfHostGlobalSetup() {
  const webDir = resolve(import.meta.dirname, '../dist');
  await access(resolve(webDir, 'index.html'));

  return startKanleafServer({
    webDir,
    corsOrigins: serverUrl,
    hostEmail: hostE2eEmail,
  });
}
