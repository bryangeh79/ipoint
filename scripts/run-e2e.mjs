import { spawnSync } from 'node:child_process';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm npm_execpath is required.');
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://ipoint_test:ipoint_test@127.0.0.1:55440/ipoint_database_test';
const env = { ...process.env, DATABASE_URL: databaseUrl };

for (const args of [
  ['db:migrate'],
  ['db:seed'],
  ['exec', 'playwright', 'test', ...process.argv.slice(2)],
]) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
