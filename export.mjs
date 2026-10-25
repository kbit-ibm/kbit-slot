import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const fonts=['barlow-condensed-500','barlow-condensed-600','barlow-condensed-700','ibm-plex-mono-400','ibm-plex-mono-500','ibm-plex-mono-600'];
const [html,css,visualCSS,designerCSS,layoutModel,engine,dataset,exactSelection,operationModel,remote,scene,visualUI,designer,operationUI,app,...fontFiles]=await Promise.all(['index.html','styles.css','visual.css','designer.css','layout-model.js','engine.js','dataset.js','exact-selection.js','operation-model.js','remote.js','warehouse3d.js','visual-ui.js','designer.js','operation-ui.js','app.js',...fonts.map(name=>'assets/'+name+'.woff2')].map(name=>readFile(path.join(root,name))));
const inlineCSS=(css.toString()+'\n'+visualCSS.toString()+'\n'+designerCSS.toString()).replace(/url\('assets\/([\w-]+)\.woff2'\)/g,(match,name)=>"url('data:font/woff2;base64,"+fontFiles[fonts.indexOf(name)].toString('base64')+"')");
const inlineScript=[layoutModel,engine,dataset,exactSelection,operationModel,remote,scene,visualUI,designer,operationUI,app].map(source=>source.toString().replace(/<\/script/gi,'<\\/script')).join('\n;\n');
const standalone=html.toString().replace(/\r\n/g,'\n')
  .replace('<link rel="stylesheet" href="styles.css">',()=>'<style>'+inlineCSS+'</style>')
  .replace('  <link rel="stylesheet" href="visual.css">\n','')
  .replace('  <link rel="stylesheet" href="designer.css">\n','')
  .replace(/  <script src="[\w-]+\.js" defer><\/script>\r?\n/g,'')
  .replace('</body>',()=>'<script>'+inlineScript+'</script>\n</body>');
await writeFile(path.join(root,'Kbit-Slot.html'),standalone);
console.log('Generado dist/Kbit-Slot.html: archivo independiente, sin dependencias externas.');
