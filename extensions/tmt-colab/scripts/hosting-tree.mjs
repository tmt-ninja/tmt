// Materialize the three Remote SDK build outputs in the ordinary hosted frontend output.
// Native packaging includes this same directory; no runtime copy or Base64 bundle exists.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const digest=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try { if(!fs.fstatSync(fd).isFile()) throw new Error('SDK source must be regular'); return fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
}
export function stageHostingSdk(directory,remote) {
  if(!fs.lstatSync(directory).isDirectory()) throw new Error('Hosted output must be a real directory');
  const sdk=path.join(directory,'sdk');
  fs.mkdirSync(sdk,{recursive:true});
  if(!fs.lstatSync(sdk).isDirectory()) throw new Error('Hosted SDK output must be a real directory');
  const client=path.join(remote,'typescript/remote-client');
  const pin=JSON.parse(read(path.join(client,'firebase-build-pin.json')));
  if(pin.version!==1 || !Array.isArray(pin.files) || pin.files.length!==2) throw new Error('Invalid Remote build pin');
  const sources=[
    ['remote-v1.js',path.join(remote,'rust/tmt-remote/assets/remote-v1.js')],
    ['remote-firebase-v1.js',path.join(client,'dist/remote-firebase-v1.js')],
    ['THIRD-PARTY-NOTICES-remote.txt',path.join(client,'dist/THIRD-PARTY-NOTICES.txt')],
  ];
  for(const [name,source] of sources) {
    const bytes=read(source);
    if(name!=='remote-v1.js') {
      const key='dist/'+path.basename(source);
      const entries=pin.files.filter((entry)=>entry.path===key);
      if(entries.length!==1 || entries[0].length!==bytes.length || entries[0].sha256!==digest(bytes))
        throw new Error('Remote SDK build does not match its pin');
    }
    const target=path.join(sdk,name);
    const fd=fs.openSync(target,fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,0o644);
    try { if(!fs.fstatSync(fd).isFile()) throw new Error('SDK output must be regular'); fs.ftruncateSync(fd,0); fs.writeFileSync(fd,bytes); }
    finally {fs.closeSync(fd);}
    if(digest(read(target))!==digest(bytes)) throw new Error('SDK output integrity mismatch');
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==3) throw new Error('Usage: hosting-tree.mjs <dist-hosted>');
  stageHostingSdk(path.resolve(process.argv[2]),fileURLToPath(new URL('../../tmt-remote/',import.meta.url)));
}
