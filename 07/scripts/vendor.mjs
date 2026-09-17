import { copyFile, mkdir } from 'node:fs/promises';

// Ship the pinned official SDK with our app instead of loading authentication code from a CDN.
const target = new URL('../public/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url), new URL('supabase.js', target));
console.log('Supabase 공식 브라우저 SDK 준비 완료');
