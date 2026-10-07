import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const destination = new URL('../public/vendor/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL('../node_modules/colorthief/dist/index.browser.js', import.meta.url), new URL('color-thief.mjs', destination));
await writeFile(new URL('color-thief.d.mts', destination), "export { getPalette } from 'colorthief';\n");
console.log('Color Thief 3.5.0 공식 브라우저 모듈 준비 완료');
