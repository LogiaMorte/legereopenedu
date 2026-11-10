/**
 * Etkinlik durumu — zaman dilimi sözleşmesi.
 *
 * Durum "bugün" kavramına dayanıyor ve bu kavram üç ayrı yerde hesaplanıyor:
 * build (geliştiricinin makinesi), tarayıcı (ziyaretçinin dilimi) ve
 * Cloudflare Worker (UTC). Üçü aynı cevabı vermezse sunucu, kapanmış bir
 * etkinliğe kayıt kabul eder ya da kart "Kayıt Açık" derken API 409 döner.
 *
 * Sözleşme: "bugün" HER ZAMAN Europe/Istanbul günüdür — kurumun takvimi bu.
 * Bu yüzden testler process.TZ ne olursa olsun aynı sonucu bekler;
 * `npm test` paketi kasıtlı olarak iki ayrı dilimde koşar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStatus, canRegister, sortForDisplay } from '../src/utils/events.ts';

const open = (dateStart: string, dateEnd?: string) => ({
  dateStart,
  dateEnd,
  registrationOpen: true,
});

test('gelecek etkinlik: başvuru açıksa open, kapalıysa upcoming', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  assert.equal(deriveStatus(open('2026-08-10'), now), 'open');
  assert.equal(
    deriveStatus({ dateStart: '2026-08-10', registrationOpen: false }, now),
    'upcoming',
  );
});

test('eski kayıtlarda status: "open" başvuru açık demektir', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  assert.equal(deriveStatus({ dateStart: '2026-08-10', status: 'open' }, now), 'open');
  assert.equal(deriveStatus({ dateStart: '2026-08-10' }, now), 'upcoming');
});

test('tarih eksik veya bozuksa upcoming — yanlışlıkla "Kayıt Açık" demez', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  assert.equal(deriveStatus({ registrationOpen: true }, now), 'upcoming');
  assert.equal(deriveStatus(open('02.08.2026'), now), 'upcoming');
});

test('başlangıç günü İstanbul gününe göre: 00:30 TR artık "ongoing"', () => {
  // 2026-08-02T21:30:00Z = 2026-08-03 00:30 İstanbul. Etkinlik bugün başladı.
  const now = new Date('2026-08-02T21:30:00Z');
  assert.equal(deriveStatus(open('2026-08-03', '2026-08-05'), now), 'ongoing');
  assert.equal(canRegister(open('2026-08-03', '2026-08-05'), now), false);
});

test('bitiş günü İstanbul gününe göre: 00:30 TR artık "completed"', () => {
  // 2026-08-05T21:30:00Z = 2026-08-06 00:30 İstanbul. Etkinlik dün bitti.
  const now = new Date('2026-08-05T21:30:00Z');
  assert.equal(deriveStatus(open('2026-08-01', '2026-08-05'), now), 'completed');
  assert.equal(canRegister(open('2026-08-01', '2026-08-05'), now), false);
});

test('İstanbul günü henüz dönmediyse başlangıç günü gelmemiş sayılır', () => {
  // 2026-08-02T20:30:00Z = 2026-08-02 23:30 İstanbul. Yarın başlıyor.
  const now = new Date('2026-08-02T20:30:00Z');
  assert.equal(deriveStatus(open('2026-08-03', '2026-08-05'), now), 'open');
  assert.equal(canRegister(open('2026-08-03', '2026-08-05'), now), true);
});

test('tek günlük etkinlik: dateEnd yoksa dateStart kullanılır', () => {
  const now = new Date('2026-08-03T09:00:00Z');
  assert.equal(deriveStatus(open('2026-08-03'), now), 'ongoing');
  assert.equal(deriveStatus(open('2026-08-02'), now), 'completed');
});

test('canRegister yalnızca open durumunda izin verir', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  assert.equal(canRegister(open('2026-08-10'), now), true);
  assert.equal(canRegister({ dateStart: '2026-08-10', registrationOpen: false }, now), false);
  assert.equal(canRegister(open('2026-07-01', '2026-07-05'), now), false);
});

test('sortForDisplay: open > ongoing > upcoming > completed, geçmişler yeniden eskiye', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const events = [
    { id: 'gecmis-eski', dateStart: '2026-01-01', dateEnd: '2026-01-02' },
    { id: 'yaklasan', dateStart: '2026-09-01', registrationOpen: false },
    { id: 'acik', dateStart: '2026-08-20', registrationOpen: true },
    { id: 'suruyor', dateStart: '2026-08-09', dateEnd: '2026-08-12' },
    { id: 'gecmis-yeni', dateStart: '2026-07-01', dateEnd: '2026-07-02' },
  ];
  assert.deepEqual(
    sortForDisplay(events, now).map((e) => e.id),
    ['acik', 'suruyor', 'yaklasan', 'gecmis-yeni', 'gecmis-eski'],
  );
});
