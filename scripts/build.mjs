import { build } from 'esbuild';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await rm('dist', {recursive:true,force:true});
await mkdir('dist/assets', {recursive:true});
await build({entryPoints:['src/main.jsx'],outdir:'dist/assets',bundle:true,minify:true,splitting:true,format:'esm',target:['es2022'],define:{'process.env.NODE_ENV':'"production"'},entryNames:'app-[hash]',chunkNames:'chunk-[hash]',metafile:true}).then(async result=>{
  const entry=Object.keys(result.metafile.outputs).find(path=>result.metafile.outputs[path].entryPoint==='src/main.jsx');
  execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/styles.css','-o','dist/assets/styles.css','--content','src/**/*.{tsx,jsx}','--minify'],{stdio:'inherit'});
  await copyFile('public/config.js','dist/config.js');
  await writeFile('dist/index.html', `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>谁是卧底 · 聚会联机版</title><meta name="description" content="手机联机发牌、秘密投票、AI命题和语音裁判"><link rel="stylesheet" href="./assets/styles.css"><script src="./config.js"></script></head><body><div id="root"></div><script type="module" src="./${entry.replace(/^dist\//,'')}"></script></body></html>`);
  console.log('Built original React UI with explicit Firebase/AI configuration.');
});
