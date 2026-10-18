import {readFile} from 'node:fs/promises';

async function loadReleaseCommit(){
  try{
    const manifest=JSON.parse(await readFile(new URL('../dist/release.json',import.meta.url),'utf8'));
    return typeof manifest?.commit==='string'&&/^[a-f0-9]{40}$/.test(manifest.commit)?manifest.commit:null;
  }catch{return null;}
}
// Resolve once from this loaded release, never from a mutable current symlink or environment value.
export const releaseCommit=await loadReleaseCommit();
