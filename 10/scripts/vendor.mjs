import {mkdir,copyFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const destination=new URL('public/vendor/',root);
await mkdir(destination,{recursive:true});
await copyFile(new URL('node_modules/fuse.js/dist/fuse.mjs',root),new URL('fuse.mjs',destination));
await copyFile(new URL('node_modules/fuse.js/LICENSE',root),new URL('Fuse-LICENSE',destination));
console.log('Fuse.js browser module and MIT license ready');
