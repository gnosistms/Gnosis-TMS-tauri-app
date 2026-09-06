#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// npm, Tauri, Vite, and the native app share a private process group. Cleaning
// that group also reaches children whose parents have already exited.
export function runDevSession(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: 'inherit',
  });
  let stopping = false;
  const signalGroup = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    signalGroup('SIGTERM');
    // Bound cleanup even if a watcher ignores SIGTERM. Keep the supervisor
    // alive during the grace period so Terminal cannot abandon the children.
    setTimeout(() => {
      signalGroup('SIGKILL');
      process.exitCode = code;
    }, 1000);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => stop(128 + constants.signals[signal]));
  }
  child.once('error', (error) => {
    console.error(`Cannot start the development app: ${error.message}`);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    stop(code ?? (128 + (constants.signals[signal] ?? 1)));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(`Starting your working code from ${cwd}`);
  runDevSession('npm', ['run', 'tauri:dev', '--', '--exit-on-panic'], {
    cwd,
    env: { ...process.env, GNOSIS_SYNC_DEV_VERSION: '1' },
  });
}
