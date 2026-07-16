import { spawnSync } from 'node:child_process';

const environment = process.argv[2];
if (environment !== 'preview' && environment !== 'production') {
  throw new Error('Usage: node scripts/release-worker.mjs <preview|production> [options]');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} ${args.join(' ')} failed.${detail}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

const capture = (command, args) => run(command, args, { capture: true });
const option = (name) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

const dirty = capture('git', ['status', '--porcelain', '--untracked-files=all']);
if (dirty) {
  throw new Error(`Release deployments require a clean committed tree. Current changes:\n${dirty}`);
}

const sha = capture('git', ['rev-parse', 'HEAD']);
const tree = capture('git', ['rev-parse', 'HEAD^{tree}']);
const branch = capture('git', ['branch', '--show-current']);
let previewVersion = null;

if (environment === 'production') {
  if (!process.argv.includes('--confirm-production')) {
    throw new Error('Production deployment requires --confirm-production.');
  }
  if (branch !== 'main') {
    throw new Error(`Production deployment is allowed only from main; current branch is ${branch || '(detached)'}.`);
  }
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const main = capture('git', ['rev-parse', 'main']);
  const originMain = capture('git', ['rev-parse', 'origin/main']);
  if (sha !== main || sha !== originMain) {
    throw new Error('Production HEAD must exactly match both local main and the fetched origin/main.');
  }

  previewVersion = option('--preview-version');
  if (!previewVersion) {
    throw new Error('Production deployment requires --preview-version=<active-tested-version-id>.');
  }

  const deployment = JSON.parse(capture('./node_modules/.bin/wrangler', [
    'deployments', 'status', '--name', 'goatsbattle-preview', '--json',
  ]));
  const active = deployment.versions?.find((version) => version.percentage === 100)?.version_id;
  if (active !== previewVersion) {
    throw new Error(`Preview version ${previewVersion} is not the active 100% preview deployment (${String(active)}).`);
  }

  const version = JSON.parse(capture('./node_modules/.bin/wrangler', [
    'versions', 'view', previewVersion, '--name', 'goatsbattle-preview', '--json',
  ]));
  const annotations = JSON.stringify(version.annotations ?? {});
  if (!annotations.includes(`git-tree=${tree}`)) {
    throw new Error(
      `Preview version ${previewVersion} was not recorded from Git tree ${tree}. ` +
      'Redeploy the current candidate to preview and test it before production.',
    );
  }
}

run('npm', ['run', 'release:check']);
run('npm', ['run', `worker:verify-build:${environment}`], {
  env: { ...process.env, RELEASE_SHA: sha, RELEASE_TREE: tree },
});

const secretsFile = environment === 'preview' ? '.dev.vars.preview' : '.env.production';
const message = [
  `git-sha=${sha}`,
  `git-tree=${tree}`,
  `environment=${environment}`,
  previewVersion ? `preview-version=${previewVersion}` : null,
].filter(Boolean).join(' ');

run('./node_modules/.bin/wrangler', [
  'deploy',
  '--strict',
  '--secrets-file', secretsFile,
  '--message', message,
]);

console.log(`✓ Deployed ${environment} from ${sha} (tree ${tree}).`);
