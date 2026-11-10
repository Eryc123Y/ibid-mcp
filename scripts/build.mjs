import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';
await mkdir('dist/cli',{recursive:true});
await build({entryPoints:['src/index.ts'],outfile:'dist/worker.js',bundle:true,format:'esm',platform:'neutral',target:'es2022',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:*','node:*']});
await build({entryPoints:['cli/index.ts'],outfile:'dist/cli/index.js',bundle:true,format:'esm',platform:'node',target:'node22',packages:'external'});
await chmod('dist/cli/index.js',0o755);
