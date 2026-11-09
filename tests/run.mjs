/**
 * Test koşucusu.
 *
 * Neden ayrı bir dosya: paketler iki ayrı saat diliminde koşuyor ve
 * `TZ=UTC node ...` kabuk sözdizimi Windows'ta çalışmıyor. Dilim env'den
 * burada veriliyor, böylece `npm test` her platformda aynı şeyi yapıyor.
 *
 * İki dilim kasıtlı: üretimde kodu çalıştıran üç ortam (build makinesi,
 * ziyaretçinin tarayıcısı, UTC'de koşan Cloudflare Worker) aynı cevabı
 * vermek zorunda. Tek dilimde koşan bir paket bu sınıf hatayı yakalamıyor.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const ZONES = ['UTC', 'Europe/Istanbul', 'America/New_York'];

let failed = false;

for (const TZ of ZONES) {
  console.log(`\n=== TZ=${TZ} ===`);
  const result = spawnSync(
    process.execPath,
    ['--test', path.join(testsDir, '*.test.ts')],
    { stdio: 'inherit', env: { ...process.env, TZ } },
  );
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
