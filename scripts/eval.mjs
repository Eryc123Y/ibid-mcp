import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
await mkdir('.artifacts',{recursive:true});
const input=process.argv[2] ?? 'eval/recorded-600.json';
let snapshot;
try {snapshot=JSON.parse(await readFile(input,'utf8'));}
catch {
  const report={status:'unverified',reason:'Original 600-paper sample and recorded S2/OpenAlex title-search responses are not present.',required_file:input};
  await writeFile('.artifacts/coverage-eval.json',JSON.stringify(report,null,2)+'\n');
  console.error(report.reason);process.exitCode=2;
}
if(snapshot){
  await build({entryPoints:['eval/replay.ts'],outfile:'.artifacts/eval-replay.mjs',bundle:true,format:'esm',platform:'node',packages:'external',alias:{'cloudflare:workers':resolve('test/stubs/cloudflare-workers.ts')}});
  const {evaluateSnapshot}=await import(pathToFileURL(resolve('.artifacts/eval-replay.mjs')).href);
  const report=await evaluateSnapshot(snapshot);
  await writeFile('.artifacts/coverage-eval.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({found:report.found,total:report.total,coverage:report.coverage,passed:report.passed}));
  if(!report.passed)process.exitCode=1;
}
