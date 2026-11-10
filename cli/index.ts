#!/usr/bin/env node
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './commands';
import { prompt, runWrangler } from './runtime';
await runCli(process.argv.slice(2),{dir:path.join(homedir(),'.config','litscout'),bundlePath:fileURLToPath(new URL('../worker.js',import.meta.url)),run:runWrangler,prompt,fetch,print:console.log}).catch(()=>{
  // Never forward exception messages from upstream commands or prompts: they may contain secrets.
  console.error('LitScout could not complete the command. Check the command, authentication and local configuration, then retry.');process.exitCode=1;
});
