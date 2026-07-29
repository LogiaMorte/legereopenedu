# Legere Open Edu — Tasarım Brief'i

> Claude Design'a verilmek üzere hazırlandı. 29 Temmuz 2026.
> Kod tarafı (veri, API, admin paneli, dönüşüm akışı) hazır; eksik olan bilgi
> mimarisi ve görsel kurgu.

---

## 1. Bu site ne işe yarıyor?

**legereopenedu.com** — kriminoloji, sosyoloji, felsefe ve veri bilimi kesişiminde
disiplinlerarası bir akademik araştırma ağı. Yüksek lisans/doktora öğrencileri,
doktora sonrası araştırmacılar ve bağımsız akademisyenler için.

**Sitenin tek işi bir davet sayfası olmak.** Kurucu, LinkedIn üzerinden kendi
akademik ağına davet çıkarıyor. Kritik yol tek bir cümleyle:

> LinkedIn paylaşımı → site → **Topluluğa Katıl** (`/signup`, Google veya LinkedIn ile tek tık)

Tasarımın başarı ölçütü budur. Estetik ikinci sırada değil ama bu akışa hizmet etmeli.

## 2. Gerçek durum — tasarımı bu belirlemeli

Bunu bilmeden tasarlamak yanıltıcı olur:

| | Gerçek |
|---|---|
| Kayıtlı üye | **2** (biri kurucu) |
| Toplam başvuru | **2** |
| Yaklaşan etkinlik | **0** |
| Yayımlanmış çıktı | **0** |

Site şu an "büyük ve kurumsal" görünmeye çalışıyor ama küçük ve yeni. Bu ikisi
arasındaki gerilim ziyaretçide "burası ölü mü?" hissi yaratıyor.

**Tasarım yönü: küçük olmayı saklamak yerine kasıtlı kılmak.** Yeni kurulmuş,
seçici, insan ölçekli bir akademik çevre gibi görünmeli — kalabalık bir platform
taklidi değil. "Yakında" yazan boş kutular kalabalık taklidinin en zayıf hâli.

> **En kritik tasarım görevi: BOŞ DURUM.** Bugün hiç yaklaşan etkinlik yok.
> Yani "hiç etkinlik yokken sayfa neye benziyor?" istisna değil, **ana durum**.
> Bunu ilk tasarlayın; dolu hâli zaten kolay.

## 3. Marka sistemi — DEĞİŞMEYECEK

Görsel kimlik kurulmuş ve iyi çalışıyor. Yeniden icat edilmesi istenmiyor;
uygulanışı iyileştirilsin.

```css
/* Zemin */
--color-bg-primary:   #0A0A0F;   /* ana zemin, çok koyu */
--color-bg-secondary: #12121A;
--color-bg-tertiary:  #1A1A2E;

/* Altın — marka rengi */
--color-gold-200: #FFD54F;   --color-gold-500: #D4A843;  /* ana ton */
--color-gold-400: #FFC107;   --color-gold-600: #B8922E;

/* Metin */
--color-text-primary:   #F0EDE6;
--color-text-secondary: #A0A0B0;

/* Durum */
--color-status-open:     #4ADE80;   /* Kayıt Açık / Devam Ediyor */
--color-status-upcoming: #60A5FA;   /* Yakında */
--color-status-closed:   #F87171;   /* Tamamlandı */
```

- **Tipografi:** Space Grotesk (başlık), Inter (gövde), JetBrains Mono (teknik/tarih/sayı)
- **Doku:** cam efekti (`glass`, `glass-subtle`), altın parıltı (`gold-glow`),
  arka planda parçacık takımyıldızı (`ParticleCanvas`)
- **İşaret:** altıgen çerçeve içinde "L" harfi, altın degrade
- **Tema:** yalnızca koyu. Açık tema yok, istenmiyor.

## 4. Bugünkü yapı ve sorunu

Ana sayfa tek uzun kaydırma, **13 bölüm**:

| # | Bölüm | Başlık | Durum |
|---|---|---|---|
| 1 | Hero | LEGERE | ✅ yeniden kuruldu — birincil CTA artık `/signup` |
| 2 | About | Legere Nedir? | metin ağırlıklı |
| 3 | HowItWorks | (nasıl işler) | About ile örtüşüyor |
| 4 | Programs | Programlar | atölye/seminer/kolokyum **türleri** |
| 5 | Universities | Aktif Katılımcı Üniversiteler | ⚠️ aşağıya bakın |
| 6 | Disciplines | Araştırma Alanları | güçlü görsel ızgara |
| 7 | Workshops | Atölyeler | **somut** etkinlikler |
| 8 | Community | Topluluk | |
| 9 | Calendar | Etkinlik Takvimi | **aynı veriyi** #7 ile paylaşıyor |
| 10 | Publications | Çıktılar & Yayınlar | boş — "Yakında" |
| 11 | Toward2027 | 2027 Vizyonu | |
| 12 | Contact | İletişim | |
| 13 | Trust | Veri Güvenliği & Gizlilik | OAuth için gerekli güven metni |

**Sorun:** LinkedIn'den gelen bir akademisyenin tek sorusu "bu ne, katılmalı mıyım".
13 bölüm bir duvar. Ayrıca #7 ile #9 artık **aynı veri kaynağından** besleniyor
(`/api/events`), yani teknik olarak da tekrar.

## 5. Önerilen kurgu (6–7 bölüm)

Kesin talimat değil, gerekçeli öneri — daha iyisi varsa değiştirin.

1. **Hero** — ne olduğu + kime olduğu + **Topluluğa Katıl**. Buton katlanın üstünde kalmalı.
2. **Legere Nedir?** — About + HowItWorks birleşsin. Tek ekranda: ne, kime, nasıl işler.
3. **Programlar** — atölye / seminer / kolokyum / ders türleri. Neyin sunulduğu.
4. **Etkinlikler** — Workshops + Calendar **tek bölümde birleşsin**.
   İki sekme veya iki blok: **Yaklaşan** / **Gerçekleşen**.
   *Gerçekleşen etkinlikler silinmemeli — küçük bir topluluk için en güçlü sosyal
   kanıt onlar (kongre, tamamlanmış atölye).*
5. **Araştırma Alanları** — Disciplines. Görsel olarak en güçlü bölüm, korunsun.
6. **Katıl / İletişim** — Community + Contact birleşsin, ikinci bir dönüşüm noktası.
7. **Footer** — Trust (gizlilik/KVKK/etik) buraya inebilir; güven verir ama satış yapmaz.

**Kararınıza bırakılanlar:**
- **Universities (#5):** Boğaziçi, Galatasaray, MSGSÜ, Marmara, Polis Akademisi
  isimleri "Aktif Katılımcı Üniversiteler" başlığıyla ve **yanıp sönen yeşil "aktif"
  noktasıyla** listeleniyor. Veride bu iddiayı destekleyen kayıt yok (üyelerin kurum
  alanı boş). Kurucu bölümün kalmasını istedi; karar onun. Tasarım açısından not:
  yeşil nabız "şu an canlı" sinyalidir ve iddiayı olduğundan güçlü gösterir.
- **Publications (#10):** içerik yok. Boş "Yakında" yerine ya tamamen kaldırılsın
  ya da **"Açık Defter"**e dönüşsün — bitmiş makale değil, devam eden iş notları,
  okuma özetleri, yöntem denemeleri. Eşiği düşük, doldurulması gerçekçi.
- **Toward2027 (#11):** vizyon anlatısı. Kalsın ama kompakt.

## 6. Tasarlanması istenenler

**Öncelik sırasıyla:**

1. **Ana sayfa — boş durum** (hiç yaklaşan etkinlik yok). *En önemli ekran, bugünkü gerçek.*
2. **Ana sayfa — dolu durum** (1 açık atölye + 1 seminer + 2 geçmiş etkinlik).
3. **Etkinlikler bölümü** — kart anatomisi: başlık, tür rozeti, durum rozeti,
   tarih aralığı, disiplin etiketleri, katılımcı sayacı (`3/30`), CTA.
   Dört durum tasarlanmalı: `Kayıt Açık` · `Yakında` · `Devam Ediyor` · `Tamamlandı`.
4. **Mobil** — trafiğin çoğu LinkedIn'den, yani telefondan gelecek.
5. **`/signup` ekranı** — dönüşümün bittiği yer. Şu an sade; Google + LinkedIn
   butonları, KVKK onayı, "neden katılmalıyım" mikro-metni.
6. **Giriş sonrası profil** — üye ne görüyor? Şu an sertifika + rozet vitrini,
   ama ikisi de boş. Yeni üyeye "sırada ne var" diyen bir başlangıç ekranı gerekiyor.

## 6b. Hareket ve dikkat — ilgi çekmenin asıl yeri

Kurucunun önceliği açık: **ilgi çekmek.** Ama bu sitede ilgi, efekt miktarıyla değil
*ne zaman hareket ettiğiyle* kazanılıyor. Bugünkü durum ikisinin ortasında kalmış:
arka planda sürekli dönen parçacıklar var ama **kullanıcının bir şey yaptığında
sistem karşılık vermiyor.**

**İlke: ortam sakin, etkileşim canlı.**

Bugün hareketin çoğu ambiyansta (parçacık canvas'ı, marquee, sürekli dönen kenar
parıltıları). Bunlar dikkat çekmez, arka plan gürültüsü olur ve pil yer. Buna karşılık
tıklanabilir şeyler sessiz.

| Nerede | Bugün | Olması gereken |
|---|---|---|
| Arka plan parçacıkları | sürekli dönüyor | kalsın ama sakinleşsin; dikkat çalmasın |
| Üniversite marquee'si | sonsuz kayıyor | sürekli hareket = sürekli göz kayması |
| Kart hover | hafif parıltı | belirgin, ödüllendirici bir karşılık |
| **Buton basımı** | **yok** | dokunsal his: bas–bırak geri bildirimi |
| **Kayıt gönderimi** | spinner | başarı anı kutlanmalı — dönüşümün zirvesi burası |
| **Sayaç dolması** | anında | 0'dan gerçek sayıya sayması hem canlılık hem "gerçek veri" sinyali |
| **Bölüm girişleri** | `data-animate` ile fade | korunsun, ama sırayla (stagger) ve daha kısa |

**Özellikle tasarlanmasını istediklerimiz:**

1. **Hero'nun ilk 600 ms'i.** Ziyaretçi LinkedIn'den geliyor, ilk izlenim burada
   kuruluyor. Şu an öğeler 0.1–0.85 sn arasında sırayla beliriyor. Bu sıralama
   "önce ne okunsun" kararıdır — tasarımla verilmeli.
2. **Kayıt başarısı.** `/signup` sonrası "hoş geldin" anı. Şu an düz bir metin.
   Topluluğa katılmak bir eşik; eşiği geçtiğini hissettiren tek an burası.
3. **Boş durumun hareketi.** Hiç etkinlik yokken sayfa "bozuk" değil "beklemede"
   hissettirmeli. Statik bir "Yakında" kutusu ölü görünür; nefes alan bir şey gerekir.
4. **Yükleniyor → yüklendi geçişi.** Etkinlikler API'den geliyor; kartlar sonradan
   yerine geçiyor. Bu geçiş ani olursa sayfa zıplar. İskelet → içerik geçişi tasarlanmalı.

**Sınırlar:**
- `prefers-reduced-motion: reduce` açıkken **tüm** animasyonlar kapanıyor (mevcut
  davranış, korunacak). Hareketsiz hâl de tasarlanmış görünmeli — animasyon bilgi
  taşıyorsa, o bilgi hareketsizken de okunabilmeli.
- Mobilde animasyon bütçesi düşük tutulmalı; trafiğin çoğu telefondan gelecek.
- Kaydırmaya bağlı (scroll-driven) ağır efektlerden kaçınılmalı — düşük donanımlı
  cihazlarda takılma, ciladan daha çok zarar verir.

## 7. Teknik kısıtlar — tasarım bunlara uymalı

- **Astro 5 + Tailwind CSS v4**, statik build (`output: 'static'`). React/Vue yok.
- **Etkinlikler tarayıcıda API'den geliyor** (`/api/events`). Yani kartlar
  **yüklenme durumu** ve **hata durumu** da gerektirir — build'deki liste yedek,
  gerçek liste sonradan gelip yerine geçiyor. İskelet (skeleton) tasarımı faydalı olur.
- **Durum rozetleri elle yazılmıyor, tarihten hesaplanıyor** (`src/utils/events.ts`).
  Tasarım "Kayıt Açık"ı elle ayarlanabilir bir şey saymasın.
- **i18n paritesi zorunlu:** her metin TR + EN. Türkçe metinler İngilizceden
  ortalama %15–20 uzun — yerleşim buna dayanıklı olmalı (özellikle butonlar/rozetler).
- **CSP katı:** dış CDN, dış font, dış görsel yok. Her varlık kendi barındırılmalı.
  İzinli tek dış kaynak: `accounts.google.com` (OAuth) ve LinkedIn avatarları.
- **`prefers-reduced-motion` destekleniyor** — parçacık canvas'ı ve tüm animasyonlar
  kapanıyor. Hareketsiz hâl de tasarlanmış görünmeli.
- **Erişilebilirlik:** skip-link mevcut, korunsun. Altın (#D4A843) koyu zeminde
  kontrast sağlıyor ama küçük ikincil metinlerde (#A0A0B0) sınırda — kontrol edin.

## 8. Dokunulmaması gerekenler

- Marka kimliği: koyu + altın, Space Grotesk/Inter/JetBrains Mono, altıgen "L" işareti.
- OAuth akışı (Google + LinkedIn) — çalışıyor, değiştirilmemeli.
- `/admin` paneli — iç araç, tasarım kapsamı dışında.
- Yasal sayfalar (KVKK, gizlilik, kullanım koşulları, çerezler, etik) — içerik sabit.

---

### Ek: tek cümlelik özet

> Küçük, yeni ve seçici bir akademik çevrenin davet sayfası; 13 bölümlük duvarı
> 6–7 bölüme indirip ziyaretçiyi telefonda, hiç etkinlik yokken bile
> "Topluluğa Katıl"a götüren bir kurgu istiyoruz.
