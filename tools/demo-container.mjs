import { mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN, GRANTS, copyRuntimeHelpers } from './container.mjs';
import { spawn } from 'node:child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const palette = ['#e7efd9','#e5efdc','#e3f0ff','#fff0cc','#f6e4ce','#dff0f4','#ffe9de','#f4e3f2','#e0edf5','#f5e4eb'];
const ids = ['pedometer','water','hydration','focus','budget','ferry','pantry','mood','weekend','reading'];
// Exact persistence/resources/mutations/tasks belong to the root. Compose these
// ten curated screens there, preserving their state when returning to the menu.
const aliases = { hydration: { reset: 'hydrationReset' }, ferry: { choose: 'ferryChoose' }, mood: { choose: 'moodChoose' }, weekend: { day: 'weekendPickDay', reset: 'weekendReset' } };
function rootParts(id, source) {
  // Only known colliding action identifiers are renamed. Leave quoted copy,
  // test IDs, paths and template strings untouched (none use these actions).
  const clean = source.replace(/^routes nav\n  home "\/"\n\n/, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b[A-Za-z_]\w*\b/g, token => aliases[id]?.[token] || token);
  const match = clean.match(/^component \w+\n([\s\S]*?)^  view\n([\s\S]*)$/m);
  if (!match || (clean.match(/^component /gm) || []).length !== 1) throw new Error(`Curated root demo ${id} must contain one component and one view.`);
  return { preamble: clean.slice(0, match.index), declarations: match[1], view: match[2] };
}
export async function prepareDemoContainer({ emit = () => {} } = {}) {
  const directory = resolve(ROOT, '.exact-create/container-release');
  mkdirSync(directory, { recursive: true });
  for (const file of ['exact.mjs','package.json','app.json']) cpSync(resolve(ROOT,'container',file),resolve(directory,file));
  writeFileSync(resolve(directory, 'exact.mjs'), readFileSync(resolve(directory, 'exact.mjs'), 'utf8').replace('name: "container"', 'name: "container-release"'));
  cpSync(resolve(ROOT,'container/strings'),resolve(directory,'strings'),{recursive:true});
  mkdirSync(resolve(directory,'assets'),{recursive:true});
  cpSync(resolve(ROOT,'container/assets/app-icon.png'),resolve(directory,'assets/app-icon.png'));
  if (!existsSync(resolve(directory,'node_modules'))) symlinkSync(resolve(ROOT,'container/node_modules'),resolve(directory,'node_modules'),'dir');
  copyRuntimeHelpers(directory);
  const demos = ids.map((id,i) => {
    const source=resolve(ROOT,'demos',id);
    cpSync(source,resolve(directory,'demos',id),{recursive:true});
    cpSync(resolve(source,'assets/generated',id),resolve(directory,'assets/generated',id),{recursive:true});
    const metadata=JSON.parse(readFileSync(resolve(source,'demo.json'),'utf8'));
    // Native packaging includes the root assets tree; each demo already has a
    // unique generated/<id> namespace, so keep those exact content-hashed paths.
    const contract=readFileSync(resolve(source,'app.contract'),'utf8');
    writeFileSync(resolve(directory,'demos',id,'app.contract'),contract);
    const component=contract.match(/^component (\w+)/m)?.[1];
    if (!component) throw new Error(`Demo ${id} has no component`);
    const assets=JSON.parse(readFileSync(resolve(source,'assets.json'),'utf8'));
    return {id,name:metadata.name,component,background:palette[i],image:assets[0].path, ...rootParts(id, contract)};
  });
  const declarations = demos.filter(d=>d.declarations).map(d=>d.declarations).join('\n');
  const names = ['active','open','home'];
  for (const [,name] of declarations.matchAll(/^  (?:state|resource|mutation|derive|task|action) (\w+)/gm)) {
    if (names.includes(name)) throw new Error(`Curated gallery root declaration collision: ${name}`);
    names.push(name);
  }
  let contract = demos.map(d=>d.preamble || '').join('\n')+'\ncomponent DemoGallery\n  state active = ""\n'+declarations+'\n  action open(id: string)\n    active = id\n  action home\n    active = ""\n  view\n    column height="100%" background-color="#faf8f3" color="#26342e"\n      if active == ""\n        scroll flex=1 min-height=0\n          column padding=24 gap=16\n            text "Your little apps" font-size=32 font-weight=750\n            text "Ten colorful tools for everyday life." font-size=15 color="#6b756c"\n';
  for(let i=0;i<demos.length;i+=2){
    contract+='            row gap=12\n';
    for(const d of demos.slice(i,i+2)) contract+=`              button press=open("${d.id}") appearance="none" flex=1 min-width=0 background-color="${d.background}" padding=16 border-radius=24 testId="demo-${d.id}"\n                column gap=10 align-items="start"\n                  image "${d.image}" width=64 height=64 object-fit="contain" border-radius=16\n                  text ${JSON.stringify(d.name)} font-size=16 font-weight=650\n`;
  }
  contract+='      else\n        row padding="8 16" background-color="#faf8f3"\n          button press=home appearance="none" padding="8 12" min-height=40 color="#416550" testId="gallery-home"\n            text "‹ All apps" font-size=15 font-weight=600\n        column flex=1 min-height=0\n';
  for(const [i,d] of demos.entries()) {
    contract+=`          ${i?'else if':'if'} active == "${d.id}"\n`;
    contract+=d.view ? d.view.split('\n').filter(line=>line.trim()).map(line=>'        '+line).join('\n')+'\n' : `            ${d.component}()\n`;
  }
  // The gallery shares the bookshelf sources plus the HealthKit day-boundary source.
  let typescript=readFileSync(resolve(ROOT,'demos/reading/app.ts'),'utf8');
  typescript=typescript.replace(/export const grants = [^;]+;/,`export const grants = ${JSON.stringify(GRANTS)};`);
  typescript=typescript.replace('const sources: Sources = {',`const sources: Sources = {\n  dayBounds: ([epoch]) => { const midnight = new Date(epoch); midnight.setHours(0,0,0,0); const start = midnight.getTime(); return { start, end: Math.max(epoch, start + 1) }; },`);
  const tests='test "opens every bundled app without a server"\n'+demos.map(d=>`  tap "demo-${d.id}"\n  expect text "title" == ${JSON.stringify(d.name)}\n  tap "gallery-home"\n`).join('')+'\ntest "timer works and survives gallery switching"\n  tap "demo-focus"\n  tap "min-5"\n  tap "start-pause"\n  clock +60000\n  expect text "left" == "4:00"\n  tap "start-pause"\n  tap "gallery-home"\n  tap "demo-reading"\n  clock data\n  expect text "book-count" == "0 books"\n  type "book-title" "The Hobbit"\n  tap "gallery-home"\n  tap "demo-focus"\n  expect text "left" == "4:00"\n  tap "gallery-home"\n  tap "demo-reading"\n  expect state bookTitle == "The Hobbit"\n';
  const project={id:'gallery',name:'Little Apps',contract,typescript,tests};
  for(const [file,source] of [['app.contract',contract],['app.ts',typescript],['app.test.contract',tests]]) writeFileSync(resolve(directory,file),source);
  const manifest=JSON.parse(readFileSync(resolve(directory,'app.json'),'utf8'));
  manifest.$schema=resolve(ROOT,'exact/scripts/app.schema.json');
  // The bundled gallery starts from its embedded plan, never a local preview server.
  if (manifest.host?.ios) delete manifest.host.ios.localNetworking;
  writeFileSync(resolve(directory,'app.json'),JSON.stringify(manifest,null,2)+'\n');
  emit({type:'status',message:'Compiling all 10 embedded demos and their image assets'});
  await new Promise((ok,fail)=>{
    const child=spawn(BUN,['exact.mjs','contract','build','app.contract','--json','--errors-only'],{cwd:directory,env:{...process.env,EXACT2:resolve(ROOT,'exact'),BUN},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',fail);child.on('close',code=>code===0?ok():fail(new Error(output)));
  });
  return {project,sourceDir:directory};
}
