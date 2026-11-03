import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

test('the real React application renders the original lobby and an actionable missing-service state',async()=>{
  const dir=await mkdtemp(new URL('../.render-test-',import.meta.url));
  const outfile=dir+'/app.mjs';
  try{
    await build({entryPoints:['src/App.tsx'],outfile,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
    const {default:App}=await import(pathToFileURL(outfile).href);
    const html=renderToStaticMarkup(React.createElement(App));
    assert.match(html,/谁是卧底 · 聚会联机版/);
    assert.match(html,/联机服务尚未配置/);
    assert.match(html,/输入4位房间号/);
    assert.doesNotMatch(html,/创建同屏聚会/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
