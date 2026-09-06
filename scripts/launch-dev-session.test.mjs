import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const supervisor = new URL('./launch-dev-session.mjs', import.meta.url).href;

for (const scenario of ['normal', 'failure', 'SIGINT', 'SIGHUP']) {
  test(`dev launcher releases its child server after ${scenario}`, { timeout: 10000, skip: process.platform === 'win32' }, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gnosis-launcher-'));
    const ready = path.join(directory, 'ready.json');
    const serverFile = path.join(directory, 'server.mjs');
    const commandFile = path.join(directory, 'command.mjs');
    let child;
    let serverPid;
    t.after(async () => {
      child?.kill('SIGTERM');
      if (serverPid) {
        try { process.kill(serverPid, 'SIGKILL'); } catch {}
      }
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(serverFile, `
      import net from 'node:net';
      const server = net.createServer();
      // Exercise the supervisor's forced-cleanup fallback too.
      process.on('SIGTERM', () => {});
      server.listen(0, '127.0.0.1', () => {
        process.send({ pid: process.pid, port: server.address().port });
        process.disconnect();
      });
    `);
    await writeFile(commandFile, `
      import { fork } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const server = fork(${JSON.stringify(serverFile)}, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      server.once('message', (data) => {
        writeFileSync(${JSON.stringify(ready)}, JSON.stringify(data));
        if (${JSON.stringify(scenario)} === 'normal') process.exit(0);
        if (${JSON.stringify(scenario)} === 'failure') process.exit(7);
      });
    `);
    child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { runDevSession } from ${JSON.stringify(supervisor)};
      runDevSession(process.execPath, [${JSON.stringify(commandFile)}]);
    `], { stdio: 'ignore' });
    const exited = once(child, 'exit');
    let info;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { info = JSON.parse(await readFile(ready, 'utf8')); break; } catch {}
      await delay(25);
    }
    assert.ok(info, 'the grandchild server started');
    serverPid = info.pid;
    if (scenario.startsWith('SIG')) child.kill(scenario);
    const [code] = await exited;
    assert.equal(code, { normal: 0, failure: 7, SIGINT: 130, SIGHUP: 129 }[scenario]);
    // Rebinding the exact port proves the orphaned server has been stopped.
    const probe = net.createServer();
    probe.listen(info.port, '127.0.0.1');
    await once(probe, 'listening');
    await new Promise((resolve) => probe.close(resolve));
    serverPid = undefined;
  });
}
