// Deploys the tagged release on main to Cloudflare: back up D1, apply pending
// migrations, build, deploy to Pages, then check the deployment is live and
// still behind Access. Run from a clean, pulled main at a release tag:
//
//   npm run deploy                       # the whole thing
//   npm run deploy -- --dry-run          # checks and build only, no remote changes
//   npm run deploy -- --backup-dir <dir> # where the backup goes (default: OS temp)
//
// Reads the Pages project and database names from wrangler.toml. The backup is
// health data: it is written outside the repo and never into a synced folder
// you didn't choose.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const backupDirArg = args.indexOf('--backup-dir');
const backupDir = resolve(backupDirArg >= 0 ? args[backupDirArg + 1] ?? '' : join(tmpdir(), 'zachtrack-backups'));
const root = process.cwd();

function fail(message) {
  console.error(`\ndeploy: ${message}`);
  process.exit(1);
}

function step(title) {
  console.log(`\n== ${title}`);
}

/** Runs a command, streaming its output; stops the deploy if it fails. */
function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed`);
}

/** Runs a command and returns its trimmed stdout; stops the deploy if it fails. */
function capture(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

// --- Config -----------------------------------------------------------------

let toml;
try {
  toml = readFileSync('wrangler.toml', 'utf8');
} catch {
  fail('wrangler.toml not found. Copy wrangler.toml.example and fill it in (README "Deploy your own").');
}
const project = toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
const database = toml.match(/\[\[d1_databases\]\][^[]*?database_name\s*=\s*"([^"]+)"/)?.[1];
if (!project || !database) fail('wrangler.toml needs a name and a [[d1_databases]] database_name.');
if (!/migrations_dir\s*=\s*"d1\/migrations"/.test(toml)) {
  fail('wrangler.toml needs migrations_dir = "d1/migrations" in its [[d1_databases]] block (see wrangler.toml.example).');
}
const fromRoot = relative(root, backupDir);
if (!fromRoot.startsWith('..') && !isAbsolute(fromRoot)) fail(`the backup directory ${backupDir} is inside the repo; pick one outside it.`);

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;

// --- Git: only a clean, pulled main at the release tag ships -----------------

step(`Checking main is clean and at ${tag}`);
const branch = capture('git', ['branch', '--show-current']);
if (branch !== 'main') fail(`on branch ${branch}; switch to main first.`);
if (capture('git', ['status', '--porcelain'])) fail('the working tree has changes; commit or stash them first.');
run('git', ['fetch', '--quiet', '--tags', 'origin']);
const head = capture('git', ['rev-parse', 'HEAD']);
if (head !== capture('git', ['rev-parse', 'origin/main'])) fail('main is not the same as origin/main; pull (or push) first.');
const tagged = spawnSync('git', ['rev-list', '-n', '1', tag], { encoding: 'utf8' }).stdout.trim();
if (tagged !== head) fail(`${tag} (package.json's version) is not on this commit. Release first, then deploy.`);
console.log(`main ${head.slice(0, 7)} is ${tag}; project ${project}, database ${database}${dryRun ? ' (dry run)' : ''}`);

// --- Build --------------------------------------------------------------------

step('Building');
rmSync('dist', { recursive: true, force: true });
run('npm', ['run', 'build']);
if (!readFileSync(join('dist', 'index.html'), 'utf8')) fail('the build produced no index.html.');

if (dryRun) {
  step('Dry run: skipped the backup, migrations, deploy and live checks');
  process.exit(0);
}

// --- Backup, then migrations ----------------------------------------------------

step('Backing up the database');
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = join(backupDir, `${database}-before-${tag}-${stamp}.sql`);
run('npx', ['wrangler', 'd1', 'export', database, '--remote', `--output=${backupFile}`]);
console.log(`Backup: ${backupFile}`);

step('Applying database migrations');
run('npx', ['wrangler', 'd1', 'migrations', 'apply', database, '--remote']);

// --- Deploy -----------------------------------------------------------------------

step('Deploying to Cloudflare Pages');
run('npx', [
  'wrangler', 'pages', 'deploy', 'dist',
  `--project-name=${project}`, '--branch=main', `--commit-hash=${head}`, `--commit-message=${tag}`,
]);

// --- Live checks ----------------------------------------------------------------------

step('Checking the live deployment');
const deployments = JSON.parse(
  capture('npx', ['wrangler', 'pages', 'deployment', 'list', `--project-name=${project}`, '--environment=production', '--json']),
);
const latest = deployments[0];
if (!latest || !head.startsWith(String(latest.Source))) {
  fail(`the newest production deployment is ${latest?.Source ?? 'missing'}, not ${head.slice(0, 7)}.`);
}
console.log(`Production deployment ${latest.Id} is ${head.slice(0, 7)} (${tag}).`);

for (const url of [`https://${project}.pages.dev/`, `https://${project}.pages.dev/api/sync`]) {
  const res = await fetch(url, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  if (res.status < 300 || res.status >= 400 || !/\.cloudflareaccess\.com\//.test(location)) {
    fail(`${url} answered ${res.status} without redirecting to the Access login. Check Access before using the app.`);
  }
  console.log(`${url} -> Access login`);
}

console.log(`\nDeployed ${tag}. Reopen the app on each device until Profile shows ${tag}.`);
console.log(`The backup is health data; delete it once the release looks right: ${backupFile}`);
