/**
 * Cloudflare Pages Function — Workshop Registration API (Login Required)
 *
 * KV Binding: REGISTRATIONS (Cloudflare Dashboard'dan bağlanır)
 * Session cookie ile kimlik doğrulaması yapılır.
 * Üye bilgileri otomatik olarak member kaydından alınır.
 */

import { corsHeaders, optionsResponse, parseSessionCookie, parseJsonBody, notifyAdmin } from '../_shared';
import { canRegister } from '../../src/utils/events';
import { findEvent } from './events';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_KEY?: string;
  RESEND_API_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  ADMIN_EMAILS?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  try {
    // Require authentication
    const session = parseSessionCookie(request);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
    }

    if (!env.REGISTRATIONS) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
    }

    // Get member data
    const memberData = await env.REGISTRATIONS.get(`member:${session.email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);
    if (member.token !== session.token) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
    }

    const body = await parseJsonBody<{ workshop?: string; motivation?: string }>(request);
    if (!body) {
      return new Response(JSON.stringify({ error: 'Invalid or oversized request body' }), { status: 400, headers });
    }

    if (!body.workshop?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const workshop = body.workshop.trim().slice(0, 200);

    // Etkinliği KV'ye karşı doğrula. Bu olmadan uydurma bir id ile çöp
    // index:* anahtarları açılabiliyordu ve kapasite sabit 50 varsayılıyordu —
    // 500 kişilik kongre 50'de kilitlenirdi.
    const eventRecord = await findEvent(env.REGISTRATIONS, workshop);

    if (!eventRecord) {
      return new Response(JSON.stringify({ error: 'Etkinlik bulunamadı.' }), { status: 404, headers });
    }

    /*
     * Kaydı dış formda toplanan etkinliğe buradan başvuru alınmaz. Kart zaten
     * forma yönlendiriyor, ama uç açık kalırsa doğrudan istek atan biri KV'ye
     * yazabilir ve kayıtlar iki kanala bölünür — kimin geleceği bilinemez.
     */
    if (eventRecord.registrationUrl) {
      return new Response(
        JSON.stringify({
          error: 'Bu etkinliğin kaydı site üzerinden değil, duyurulan form üzerinden alınıyor.',
          registrationUrl: eventRecord.registrationUrl,
        }),
        { status: 409, headers },
      );
    }

    // Yalnızca başvuruya açık ve henüz başlamamış etkinliklere kayıt alınır.
    if (!canRegister(eventRecord)) {
      return new Response(
        JSON.stringify({ error: 'Bu etkinlik şu anda başvuruya kapalı.' }),
        { status: 409, headers },
      );
    }

    /*
     * index:{etkinlik} girdileri artık {id, email} taşıyor.
     *
     * Eskiden yalnızca kayıt id'si tutuluyordu, bu yüzden "bu üye zaten kayıtlı mı"
     * sorusuna cevap vermek için etkinliğe kayıtlı HERKESİN tam kaydı okunuyordu:
     * 50 kişilik bir atölyede son başvuru 50 KV okuması demekti ve katılımcı
     * sayısıyla doğrusal büyüyordu. E-posta indekste durunca tek okuma yetiyor.
     *
     * Eski biçimdeki (düz string) girdiler için kayıtları okumaya devam ediyoruz;
     * yeni kayıtlar yeni biçimde yazıldıkça geçiş kendiliğinden tamamlanır.
     */
    const indexKey = `index:${workshop}`;
    const existingIndex = await env.REGISTRATIONS.get(indexKey);
    const entries: Array<string | { id: string; email?: string }> =
      existingIndex ? JSON.parse(existingIndex) : [];

    const sessionEmail = session.email.toLowerCase();
    const legacyIds: string[] = [];
    let duplicate = false;

    for (const entry of entries) {
      if (typeof entry === 'string') legacyIds.push(entry);
      else if (entry?.email?.toLowerCase() === sessionEmail) duplicate = true;
    }

    if (!duplicate && legacyIds.length) {
      const legacyRecords = await Promise.all(legacyIds.map((rid) => env.REGISTRATIONS.get(rid)));
      duplicate = legacyRecords.some((rd) => {
        if (!rd) return false;
        const r = JSON.parse(rd);
        return r.memberEmail?.toLowerCase() === sessionEmail || r.email?.toLowerCase() === sessionEmail;
      });
    }

    if (duplicate) {
      return new Response(
        JSON.stringify({ error: 'Bu etkinliğe zaten kayıt yaptınız.' }),
        { status: 409, headers },
      );
    }

    // maxParticipants === 0 -> sınırsız (ör. halka açık seminer)
    const capacity = Number(eventRecord.maxParticipants) || 0;
    if (capacity > 0 && entries.length >= capacity) {
      return new Response(
        JSON.stringify({ error: 'Bu etkinliğin kontenjanı dolmuştur.' }),
        { status: 409, headers },
      );
    }

    // Create registration using member data
    const idBytes = new Uint8Array(4);
    crypto.getRandomValues(idBytes);
    const idSuffix = Array.from(idBytes, b => b.toString(36)).join('').slice(0, 8);
    const registration = {
      id: `reg_${Date.now()}_${idSuffix}`,
      name: member.name || '',
      email: member.email,
      memberEmail: member.email,
      university: member.university || '',
      department: member.department || '',
      workshop: workshop,
      motivation: (body.motivation || '').trim().slice(0, 1000),
      status: 'pending',
      timestamp: new Date().toISOString(),
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      country: request.headers.get('CF-IPCountry') || 'unknown',
    };

    entries.push({ id: registration.id, email: member.email });
    member.regIds = [...(member.regIds || []), registration.id];

    const countKey = 'count:total';
    const currentCount = parseInt((await env.REGISTRATIONS.get(countKey)) || '0');

    // Dört yazma da birbirinden bağımsız — sırayla beklemek yerine tek turda.
    // Workers'ta her KV çağrısı gerçek bir ağ gidiş-dönüşü.
    const YEAR = 60 * 60 * 24 * 365;
    await Promise.all([
      env.REGISTRATIONS.put(registration.id, JSON.stringify(registration), { expirationTtl: YEAR }),
      env.REGISTRATIONS.put(indexKey, JSON.stringify(entries)),
      env.REGISTRATIONS.put(countKey, String(currentCount + 1)),
      env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member)),
    ]);

    // Bildirim yanıtı geciktirmesin ve hata verirse kaydı etkilemesin.
    context.waitUntil(
      notifyAdmin(env, 'Yeni başvuru', {
        'Etkinlik': eventRecord.title?.tr || workshop,
        'Ad': registration.name,
        'E-posta': registration.email,
        'Kurum': registration.university,
        'Motivasyon': registration.motivation,
      }),
    );

    return new Response(JSON.stringify({ success: true, id: registration.id }), { status: 200, headers });
  } catch (err) {
    console.error('[register] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
