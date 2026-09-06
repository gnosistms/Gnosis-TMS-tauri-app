import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./guard-dev-app-version.mjs', import.meta.url));
function fixture(t, { dependencyChange = false, includeSource = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gnosis-version-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file, contents) => writeFileSync(path.join(root, file), contents);
  const read = (file) => readFileSync(path.join(root, file), 'utf8');
  mkdirSync(path.join(root, 'src-tauri/resources'), { recursive: true });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  const metadata = (version, dependency) => {
    write('package.json', JSON.stringify({ name: 'gnosis-tms', version, dependencies: { library: dependency } }));
    write('package-lock.json', JSON.stringify({ version, packages: { '': { version, dependencies: { library: dependency } } } }));
    write('src-tauri/tauri.conf.json', JSON.stringify({ version }));
    write('src-tauri/Cargo.toml', `[package]\nname = "gnosis-tms"\nversion = "${version}"\n`);
    write('src-tauri/Cargo.lock', `[[package]]\nname = "gnosis-tms"\nversion = "${version}"\n`);
    write('src-tauri/resources/THIRD-PARTY-NOTICES.md', `Gnosis TMS ${version} bundles third-party software.\n`);
  };
  const source = (value) => `export const value = ${value};\n` + Array.from({ length: 20 }, (_, i) => `// context ${i}\n`).join('');
  metadata('1.0.0', '1');
  write('source.js', source(1));
  git('add', '.'); git('commit', '-m', 'Baseline'); git('tag', 'v1.0.0');
  metadata('1.0.1', dependencyChange ? '2' : '1');
  write('source.js', source(2));
  git('add', '.'); git('commit', '-m', 'Release'); git('tag', 'v1.0.1');
  git('checkout', '--detach', 'v1.0.0');
  if (includeSource) write('source.js', source(2) + '// unfinished local change\n');
  const run = () => spawnSync(process.execPath, [guard], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GNOSIS_SYNC_DEV_VERSION: '1', GNOSIS_ALLOW_STALE_DEV_VERSION: '0' },
  });
  return { root, git, write, read, run };
}

test('startup repairs metadata with release code and extra unfinished edits, then is idempotent', (t) => {
  const { read, write, run, git } = fixture(t);
  const source = read('source.js');
  const originalHead = git('rev-parse', 'HEAD');
  const manifest = JSON.parse(read('package.json'));
  manifest.scripts = { custom: 'keep my script' };
  write('package.json', JSON.stringify(manifest));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Updated app version metadata to 1.0.1/);
  assert.equal(read('source.js'), source);
  assert.equal(git('rev-parse', 'HEAD'), originalHead);
  assert.equal(JSON.parse(read('package.json')).scripts.custom, 'keep my script');
  assert.equal(JSON.parse(read('package.json')).version, '1.0.1');
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].version, '1.0.1');
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, '1.0.1');
  assert.match(read('src-tauri/Cargo.toml'), /version = "1.0.1"/);
  assert.match(read('src-tauri/Cargo.lock'), /version = "1.0.1"/);
  assert.match(read('src-tauri/resources/THIRD-PARTY-NOTICES.md'), /Gnosis TMS 1.0.1/);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /Updated app version/);
});

test('startup does not relabel code that is missing the release changes', (t) => {
  const { read, run } = fixture(t, { includeSource: false });
  const before = read('package.json');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot verify.*all changes/);
  assert.equal(read('package.json'), before);
});

test('startup requires release dependency changes as well as source changes', (t) => {
  const { read, run } = fixture(t, { dependencyChange: true });
  const before = read('package.json');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release dependency or configuration changes/);
  assert.equal(read('package.json'), before);
});

test('invalid lockfile metadata causes no partial update', (t) => {
  const { read, write, run } = fixture(t);
  write('src-tauri/Cargo.lock', 'invalid');
  const before = read('package.json');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot locate app version/);
  assert.equal(read('package.json'), before);
});

test('missing baseline tag cannot silently mark a checkout current', (t) => {
  const { git, read, run } = fixture(t);
  git('tag', '-d', 'v1.0.0');
  const before = read('package.json');
  assert.equal(run().status, 1);
  assert.equal(read('package.json'), before);
});
