#!/usr/bin/env node
// macOS-only personal launcher. Re-run after moving the checkout.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This launcher requires macOS.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = '/Applications/Gnosis TMS Dev.app';
const bundleId = 'local.gnosis-tms.dev-launcher';
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const appleQuote = (value) => JSON.stringify(value);
const launcher = path.join(root, 'scripts/launch-dev.command');
chmodSync(launcher, 0o755);
const source = `do shell script ${appleQuote(`/usr/bin/open -a Terminal ${shellQuote(launcher)}`)}`;

// Never overwrite a different application that happens to have this name.
if (existsSync(app)) {
  const existingId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  if (existingId !== bundleId) throw new Error(`Refusing to overwrite unrelated app: ${app}`);
}
mkdirSync(path.dirname(app), { recursive: true });
execFileSync('/usr/bin/osacompile', ['-o', app, '-e', source]);
const plist = path.join(app, 'Contents/Info.plist');
execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', bundleId, plist]);
execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIconFile', '-string', 'gnosis.icns', plist]);
// osacompile's asset-catalog icon name takes precedence over CFBundleIconFile.
execFileSync('/usr/bin/plutil', ['-remove', 'CFBundleIconName', plist]);
copyFileSync(path.join(root, 'scripts/assets/gnosis-dev.icns'), path.join(app, 'Contents/Resources/gnosis.icns'));
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);
execFileSync('/usr/bin/mdimport', [app]);
console.log(`Installed in Applications (not pinned): ${app}`);
