import {readFileSync} from 'node:fs';
export function readProtectedEnvironment(path='/etc/white-gloss-panel/environment'){
  /** @type {Record<string,string>} */
  const values={};for(const line of readFileSync(path,'utf8').split(/\r?\n/)){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw Error('Ungültige Serverkonfiguration.');
    let value=match[2];if(value.startsWith('"'))value=JSON.parse(value);else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
    if(typeof value!=='string'||value.includes('\n')||value.includes('\0'))throw Error('Ungültiger Konfigurationswert.');values[match[1]]=value;
  }
  return values;
}
