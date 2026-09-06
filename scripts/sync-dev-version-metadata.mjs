import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const metadataFiles = [
  'package.json', 'package-lock.json', 'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json',
  'src-tauri/resources/THIRD-PARTY-NOTICES.md',
];

function git(root, args, input) {
  return execFileSync('git', args, {
    cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function updateMetadata(file, contents, from, to) {
  const requireVersion = (actual) => {
    if (actual !== from) throw new Error(`Unexpected app version in ${file}: ${actual}`);
  };
  if (file.endsWith('.json')) {
    const data = JSON.parse(contents);
    requireVersion(data.version);
    data.version = to;
    if (file === 'package-lock.json') {
      requireVersion(data.packages?.['']?.version);
      data.packages[''].version = to;
    }
    return `${JSON.stringify(data, null, 2)}\n`;
  }
  const pattern = file.endsWith('Cargo.toml')
    ? /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m
    : file.endsWith('Cargo.lock')
      ? /(\[\[package\]\]\s+name = "gnosis-tms"\s+version = ")([^"]+)(")/
      : /(^Gnosis TMS )(\S+)( bundles)/m;
  const match = contents.match(pattern);
  if (!match) throw new Error(`Cannot locate app version in ${file}`);
  requireVersion(match[2]);
  return contents.replace(pattern, (_match, before, _version, after) => `${before}${to}${after}`);
}

// This checks a patch without applying it. Extra local edits are preserved. When
// they overlap release changes so closely that Git cannot prove the patch is
// present, leave the version alone instead of claiming unsupported compatibility.
export function syncDevVersionMetadata(root, from, releaseTag) {
  const to = releaseTag.replace(/^v/i, '');
  const baseline = `refs/tags/v${from}`;
  const release = `refs/tags/${releaseTag}`;
  try {
    git(root, ['merge-base', '--is-ancestor', baseline, release]);
  } catch {
    throw new Error(`Cannot verify release history from v${from} to ${releaseTag}. Version metadata was not changed.`);
  }
  const excluded = [...metadataFiles, 'plans/**', 'docs/**', '*.md'];
  const patch = git(root, [
    'diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames',
    baseline, release, '--', '.', ...excluded.map((file) => `:(exclude)${file}`),
  ]);
  if (patch.trim()) {
    try {
      git(root, ['apply', '--reverse', '--check', '--ignore-space-change'], patch);
    } catch {
      throw new Error(`Cannot verify that this working folder contains all changes in ${releaseTag}. Version metadata was not changed.`);
    }
  }

  // Prepare and validate every edit first; preserve the user's other metadata.
  const changes = metadataFiles.map((file) => {
    const filename = path.join(root, file);
    const before = readFileSync(filename, 'utf8');
    const baselineMetadata = updateMetadata(file, git(root, ['show', `${baseline}:${file}`]), from, from);
    const releaseMetadata = updateMetadata(file, git(root, ['show', `${release}:${file}`]), to, from);
    if (baselineMetadata !== releaseMetadata && updateMetadata(file, before, from, from) !== releaseMetadata) {
      throw new Error(`Release dependency or configuration changes are missing or differ in ${file}. Version metadata was not changed.`);
    }
    return { filename, before, after: updateMetadata(file, before, from, to) };
  });
  for (const change of changes) {
    if (readFileSync(change.filename, 'utf8') !== change.before) {
      throw new Error('Version metadata changed during verification. Restart the launcher.');
    }
  }
  const written = [];
  try {
    for (const change of changes) {
      writeFileSync(change.filename, change.after);
      written.push(change);
    }
  } catch (error) {
    for (const change of written.reverse()) {
      if (readFileSync(change.filename, 'utf8') === change.after) writeFileSync(change.filename, change.before);
    }
    throw error;
  }
  return to;
}
