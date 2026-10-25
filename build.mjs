import { build } from 'esbuild';
await build({entryPoints:['src/warehouse3d.js'],bundle:true,format:'iife',target:['es2020'],minify:true,legalComments:'eof',outfile:'dist/warehouse3d.js'});
console.log('Motor visual 3D empaquetado localmente.');
