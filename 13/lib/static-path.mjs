import {resolve,sep} from 'node:path';
export function staticPath(path,publicDir){
 try{const file=resolve(publicDir,'.'+decodeURIComponent(path==='/'?'/index.html':path));return file.startsWith(publicDir+sep)?file:null;}catch{return null;}
}
