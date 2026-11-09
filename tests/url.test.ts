/**
 * Dış bağlantı temizliği.
 *
 * Üyenin girdiği LinkedIn adresi hem profilde hem herkese açık /m sayfasında
 * bir <a href> değerine yazılıyor. Burada gevşek bir filtre, giriş yapmış
 * birinin ziyaretçinin tarayıcısında kod çalıştırmasına yetiyor; o yüzden
 * "neyi reddedeyim" değil "neye izin veriyorum" sorusu soruluyor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeExternalUrl } from '../src/utils/url.ts';

test('http ve https adresleri olduğu gibi geçer', () => {
  assert.equal(
    sanitizeExternalUrl('https://www.linkedin.com/in/kisi'),
    'https://www.linkedin.com/in/kisi',
  );
  assert.equal(sanitizeExternalUrl('http://example.org/a?b=1'), 'http://example.org/a?b=1');
});

test('şemasız adrese https eklenir', () => {
  assert.equal(
    sanitizeExternalUrl('linkedin.com/in/kisi'),
    'https://linkedin.com/in/kisi',
  );
  assert.equal(sanitizeExternalUrl('  www.example.org  '), 'https://www.example.org/');
});

test('javascript: ve türevleri reddedilir', () => {
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('JaVaScRiPt:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeExternalUrl('vbscript:msgbox(1)'), '');
  assert.equal(sanitizeExternalUrl('file:///etc/passwd'), '');
  assert.equal(sanitizeExternalUrl('blob:https://x/y'), '');
});

test('şema içine sokuşturulmuş boşluk/kontrol karakteri de reddedilir', () => {
  // Tarayıcılar href içindeki sekme ve satır sonunu yok sayar; eski filtre
  // yalnızca "javascript:" ile BAŞLAYAN dizeyi reddediyordu ve bunlar sızıyordu.
  assert.equal(sanitizeExternalUrl('java\tscript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('java\nscript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('java\rscript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl(' \u0000javascript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('\u000bjavascript:alert(1)'), '');
});

test('boş, bozuk ve dize olmayan girdiler boş döner', () => {
  assert.equal(sanitizeExternalUrl(''), '');
  assert.equal(sanitizeExternalUrl('   '), '');
  assert.equal(sanitizeExternalUrl(undefined), '');
  assert.equal(sanitizeExternalUrl(null), '');
  assert.equal(sanitizeExternalUrl(42), '');
  assert.equal(sanitizeExternalUrl('https://'), '');
  assert.equal(sanitizeExternalUrl('http://'), '');
});

test('uzunluk sınırı aşılırsa reddedilir — kırpılmış yarım URL üretilmez', () => {
  assert.equal(sanitizeExternalUrl('https://example.org/' + 'a'.repeat(400)), '');
});
