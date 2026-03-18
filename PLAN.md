# Legere Open Edu - Genel Eleştiri, İyileştirme ve Geliştirme Planı

## BÖLÜM 1: KRİTİK — Performans & Script Yükleme

### 1.1 Profil Sayfası Script Optimizasyonu (profile.astro + en/profile.astro)
- **Sorun:** Profil sayfası `fetch('/api/auth/me')` çağrısı için timeout yok — API yavaşsa spinner sonsuza kadar döner
- **Sorun:** `data-cfasync="false"` eksik — Cloudflare Rocket Loader script'leri geciktiriyor
- **Çözüm:** 8s timeout ekle, `data-cfasync="false"` ekle, hata durumunda kullanıcıya net mesaj göster

### 1.2 API `/api/auth/me` — Seri KV Sorguları
- **Sorun:** `regIds` döngüsünde her kayıt için seri `await env.REGISTRATIONS.get(regId)` çağrısı yapılıyor (O(n) seri istek)
- **Çözüm:** `Promise.all()` ile paralel KV sorguları yaparak yanıt süresini düşür

### 1.3 RegistrationModal Script Optimizasyonu
- **Sorun:** Modal her sayfa yüklemesinde init oluyor, config fetch her seferinde yapılıyor
- **Çözüm:** Config sonucunu cache'le (sessionStorage), tekrar fetch etme

---

## BÖLÜM 2: YÜKSEK — Güvenlik

### 2.1 XSS Açıkları (innerHTML ile kullanıcı verisi)
- **Sorun:** `profile.astro:396` — `user.picture` doğrudan innerHTML'e enjekte ediliyor
- **Sorun:** `profile.astro:510-513` — `cert.workshopTitle`, `r.workshop` gibi veriler HTML escape edilmeden innerHTML'e yazılıyor
- **Sorun:** `profile.astro:521` — Badge meta desc innerHTML'e yazılıyor
- **Çözüm:** `textContent` kullan veya HTML escape fonksiyonu ekle (`&`, `<`, `>`, `"`, `'` karakterleri)

### 2.2 API Güvenlik İyileştirmeleri
- **Sorun:** `/api/registrations.ts` — `list` action'ı sayfalama (pagination) olmadan tüm kayıtları belleğe yüklüyor
- **Çözüm:** Limit + cursor pagination ekle (max 100 kayıt/sayfa)

---

## BÖLÜM 3: ORTA — Kod Kalitesi & DRY

### 3.1 TR/EN Profil Sayfaları Kod Tekrarı
- **Sorun:** `profile.astro` (629 satır) ve `en/profile.astro` (497 satır) ~300 satır birebir aynı JavaScript mantığı içeriyor
- **Çözüm:** Ortak mantığı `src/scripts/profile.js` olarak ayır, sadece dil string'lerini parametre olarak geçir

### 3.2 TR/EN Login/Signup Sayfa Tekrarları
- **Sorun:** 4 auth sayfasında (login TR/EN, signup TR/EN) benzer script mantığı tekrarlanıyor
- **Çözüm:** Ortak auth script'i `src/scripts/auth.js` olarak ayır

---

## BÖLÜM 4: ORTA — UX İyileştirmeleri

### 4.1 Profil Kaydetme UX'i
- **Sorun:** "Kaydet" butonuna basıldığında loading state yok, 1sn sonra sessizce reload yapılıyor
- **Çözüm:** Kaydet butonuna spinner ekle, disabled durumu ekle, başarı sonrası in-place güncelleme yap (reload kaldır)

### 4.2 Privacy Toggle Sessiz Hata
- **Sorun:** Toggle değiştiğinde API başarısız olursa kullanıcı bilgilendirilmiyor, toggle geri alınmıyor
- **Çözüm:** API hatasında toggle'ı eski durumuna döndür, toast/bildirim göster

### 4.3 Profil Skeleton Loading
- **Sorun:** Profil yüklenirken sadece spinner var, layout shift oluyor
- **Çözüm:** Skeleton placeholder ekle (gri kutular)

---

## BÖLÜM 5: DÜŞÜK — Performans & SEO

### 5.1 ParticleCanvas Mobil Performansı
- **Sorun:** 50 parçacık + O(n²) bağlantı hesabı mobilde gereksiz CPU tüketiyor
- **Çözüm:** Mobilde parçacık sayısını 20'ye düşür, veya mobilde tamamen devre dışı bırak

### 5.2 Font Optimizasyonu
- **Sorun:** 3 font ailesi (Space Grotesk, Inter, JetBrains Mono) toplamda 10 ağırlık yükleniyor
- **Çözüm:** Kullanılmayan ağırlıkları kaldır (JetBrains Mono 500 gerçekten lazım mı?), `font-display: swap` doğrula

### 5.3 Preconnect Eksiklikleri
- **Sorun:** Google hesap servisleri için preconnect yok
- **Çözüm:** Layout'a `<link rel="preconnect" href="https://accounts.google.com" />` ekle

---

## UYGULAMA ÖNCELİK SIRASI

| Adım | Konu | Öncelik | Tahmini Etki |
|------|------|---------|-------------|
| 1 | XSS açıklarını kapat (2.1) | KRİTİK | Güvenlik |
| 2 | Profil script timeout + cfasync (1.1) | KRİTİK | Yükleme hızı |
| 3 | API seri sorgu → paralel (1.2) | YÜKSEK | API hızı |
| 4 | Profil kaydetme UX (4.1) | ORTA | Kullanıcı deneyimi |
| 5 | Privacy toggle hata yönetimi (4.2) | ORTA | Güvenilirlik |
| 6 | Preconnect + font optimizasyonu (5.3, 5.2) | DÜŞÜK | İlk yükleme |
| 7 | Kod tekrarı refactoring (3.1, 3.2) | DÜŞÜK | Bakım kolaylığı |
| 8 | Skeleton loading (4.3) | DÜŞÜK | Algılanan hız |
| 9 | Particle canvas mobil (5.1) | DÜŞÜK | Mobil pil/CPU |
