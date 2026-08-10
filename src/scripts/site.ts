/**
 * One-pager etkileşimleri — çerçevesiz, tek modül.
 *
 * Tasarımın ilkesi: "ortam sakin, etkileşim canlı." Arka plan efektleri
 * (parçacık, spotlight) hafif tutulur; asıl hareket kullanıcı bir şey
 * yaptığında olur.
 *
 * prefers-reduced-motion açıksa canvas ve spotlight HİÇ kurulmaz (sadece
 * gizlenmez — kurulmaz ki CPU da yemesin), sayaç doğrudan son değere atlar,
 * reveal'lar baştan görünür olur.
 *
 * cache-bust: 2026-08-10-login-fix
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Deploy cache-bust — DOM'a yazılır ki tree-shake olmasın */
const SITE_BUILD_ID = '2026-08-10-cookie-loop-fix';

/** Reveal'lar yalnızca JS varken gizlenir; aksi halde içerik hiç görünmezdi. */
function markJsReady(): void {
  document.documentElement.classList.add('lg-js');
}

/*
 * initSite() her sayfa geçişinde (astro:after-swap) yeniden çalışır çünkü
 * ClientRouter DOM'u değiştiriyor ve yeni düğümlerin bağlanması gerekiyor.
 * Ama window/document üzerindeki dinleyiciler düğümle birlikte ölmez —
 * temizlenmezse her gezinmede birikir. Ölçtüm: tek bir gidiş-dönüşte dört
 * fazladan scroll dinleyicisi ekleniyordu.
 *
 * Bu yüzden global dinleyiciler burada tutuluyor ve yeniden bağlanmadan önce
 * kaldırılıyor.
 */
let teardown: Array<() => void> = [];

function on<K extends keyof WindowEventMap>(
  target: Window | Document,
  type: K | string,
  fn: EventListenerOrEventListenerObject,
  opts?: AddEventListenerOptions,
): void {
  target.addEventListener(type, fn, opts);
  teardown.push(() => target.removeEventListener(type, fn, opts));
}

function cleanup(): void {
  teardown.forEach((fn) => fn());
  teardown = [];
}

// ── Nav: kaydırma ilerleme çubuğu ──

function initScrollProgress(): void {
  const bar = document.getElementById('lg-progress');
  if (!bar) return;
  const update = () => {
    const el = document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? (el.scrollTop / max) * 100 : 0;
    bar.style.width = `${pct}%`;
  };
  on(window, 'scroll', update, { passive: true });
  on(window, 'resize', update, { passive: true });
  update();
}

// ── Nav: mobil menü ──

function initMobileMenu(): void {
  const toggle = document.getElementById('lg-menu-toggle');
  const panel = document.getElementById('lg-menu');
  if (!toggle || !panel) return;

  const setOpen = (open: boolean) => {
    panel.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    // Menü açıkken arka planın kaymasını engelle
    document.body.style.overflow = open ? 'hidden' : '';
  };

  toggle.addEventListener('click', () => {
    setOpen(!panel.classList.contains('is-open'));
  });
  // Bir bağlantıya tıklanınca kapansın — aynı sayfa içi çapa olduğu için
  // navigasyon olayı tetiklenmiyor.
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  on(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') setOpen(false);
  });
}

// ── Bölüm girişleri ──

/**
 * Bölüm/öğe giriş animasyonları. İKİ sözleşmeyi birden yürütür:
 *
 * - `[data-reveal]` / `[data-stagger]` → `.lg-in`  (one-pager bölümleri)
 * - `[data-animate]`                   → `.visible` (yasal sayfalar, giriş,
 *   kayıt, profil — tasarım öncesinden kalan ve hâlâ kullanılan sözleşme)
 *
 * İkincisi kritik: global.css'te `[data-animate] { opacity: 0 }` kuralı var ve
 * `.visible` eklenmezse içerik KALICI OLARAK GÖRÜNMEZ kalıyor. One-pager
 * geçişinde eski gözlemciyi Layout'tan kaldırdığımda tam bu oldu — etik,
 * KVKK, çerez, kullanım koşulları ve gizlilik sayfaları (TR+EN, 10 sayfa)
 * boş göründü.
 *
 * Her öğe bir kez tetiklenir; tekrar tekrar animasyon rahatsız edici olurdu.
 */
function initReveal(root: ParentNode = document): void {
  /*
   * `[data-animate]` (yasal sayfalar) GÖZLEMCİYE BAĞLANMAZ, hemen açılır.
   *
   * global.css'te `[data-animate] { opacity: 0 }` var ve görünürlük yalnızca
   * `.visible` sınıfıyla geri geliyor. Bu sınıfı bir IntersectionObserver'a
   * bağlamak, gözlemci herhangi bir nedenle çalışmazsa etik kod / KVKK /
   * kullanım koşulları metninin tamamen görünmez kalması demek — bir kez
   * yaşandı. Bu sayfalarda kaydırma animasyonunun getirisi yok, riski büyük;
   * geçiş CSS'te tanımlı olduğu için içerik yine yumuşakça beliriyor.
   */
  const instant = Array.from(root.querySelectorAll<HTMLElement>('[data-animate]'));
  instant.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i, 6) * 60}ms`;
    el.classList.add('visible');
  });

  const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal],[data-stagger]'));
  if (!targets.length) return;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    targets.forEach((el) => {
      el.classList.add('lg-in');
      Array.from(el.children).forEach((c) => c.classList.add('lg-in'));
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        if (el.hasAttribute('data-stagger')) {
          Array.from(el.children).forEach((child, i) => {
            (child as HTMLElement).style.transitionDelay = `${i * 70}ms`;
            child.classList.add('lg-in');
          });
        } else {
          el.classList.add('lg-in');
        }
        io.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
  );
  targets.forEach((el) => io.observe(el));
}

// ── Hero: parçacık ağı ──

function initParticles(): void {
  if (reduceMotion) return;
  const canvas = document.getElementById('lg-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  let dots: { x: number; y: number; vx: number; vy: number }[] = [];
  let raf = 0;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Yoğunluk alana bağlı; mobilde üst sınır düşük (CPU / pil)
    const isNarrow = w < 768;
    const count = Math.min(isNarrow ? 20 : 52, Math.round((w * h) / (isNarrow ? 32000 : 26000)));
    dots = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.24,
      vy: (Math.random() - 0.5) * 0.24,
    }));
  };

  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < 0 || d.x > w) d.vx *= -1;
      if (d.y < 0 || d.y > h) d.vy *= -1;

      for (let j = i + 1; j < dots.length; j++) {
        const o = dots[j];
        const dx = d.x - o.x;
        const dy = d.y - o.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 122 * 122) {
          ctx.strokeStyle = `rgba(212,168,67,${0.09 * (1 - dist2 / (122 * 122))})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(o.x, o.y);
          ctx.stroke();
        }
      }

      ctx.fillStyle = 'rgba(212,168,67,0.5)';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  };

  resize();
  let ro: ResizeObserver | null = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(resize);
    ro.observe(canvas);
  } else {
    on(window, 'resize', resize);
  }
  tick();

  // Sekme arkadayken boşuna çizme
  on(document, 'visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(tick);
  });

  // Sayfa değişince döngüyü durdur: yoksa her gezinmede bir RAF daha koşar
  teardown.push(() => {
    cancelAnimationFrame(raf);
    ro?.disconnect();
  });
}

// ── Hero: imleci takip eden ışık ──

function initSpotlight(): void {
  if (reduceMotion) return;
  const hero = document.getElementById('top');
  const spot = document.getElementById('lg-spot');
  if (!hero || !spot) return;
  hero.addEventListener(
    'pointermove',
    (e) => {
      const r = hero.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      spot.style.background = `radial-gradient(440px circle at ${x}% ${y}%,rgba(212,168,67,0.1),transparent 70%)`;
    },
    { passive: true },
  );
}

// ── Hero: 0'dan sayan alan sayacı ──

function initCounter(): void {
  const el = document.getElementById('lg-field-count');
  if (!el) return;
  const target = Number(el.dataset.target || '12');
  if (reduceMotion) {
    el.textContent = String(target);
    return;
  }
  let n = 0;
  const step = () => {
    n += 1;
    el.textContent = String(n);
    if (n < target) setTimeout(step, 55);
  };
  step();
}

// ── Nav: üye durumu ──

/**
 * Site statik build alıyor, yani sunucu tarafında kimin girişli olduğunu
 * bilemeyiz. `legere_logged_in` çerezi tam da bunun için HttpOnly DEĞİL
 * (bkz. functions/_shared.ts buildLoginCookies) — yalnızca "birisi girişli"
 * sinyali taşır, kimlik doğrulaması hâlâ HttpOnly token ile sunucuda yapılır.
 *
 * Admin bağlantısı çereze göre değil, /api/auth/me yanıtına göre açılır:
 * çerez herkes tarafından elle yazılabilir, sunucu yanıtı yazılamaz. Zaten
 * /admin'in kendisi de sunucuda ADMIN_EMAILS ile korunuyor; buradaki gizleme
 * yalnızca arayüz düzeni, güvenlik sınırı değil.
 */
function initMemberNav(): void {
  const isLoggedIn = document.cookie.split(';').some((c) => c.trim().startsWith('legere_logged_in='));
  if (!isLoggedIn) return;

  const guest = document.getElementById('lg-cta-guest');
  const member = document.getElementById('lg-cta-member');
  const menuProfile = document.getElementById('lg-menu-profile');
  if (guest) guest.hidden = true;
  if (member) member.hidden = false;
  if (menuProfile) menuProfile.hidden = false;

  // Admin rozetini yalnızca sunucu doğrularsa göster.
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?._nav?.admin) return;
      const a = document.getElementById('lg-nav-admin');
      const m = document.getElementById('lg-menu-admin');
      if (a) a.hidden = false;
      if (m) m.hidden = false;
    })
    .catch(() => {
      /* admin rozeti gösterilmez; kritik değil */
    });
}

// ── Yukarı çık düğmesi ──

function initBackToTop(): void {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  const toggle = () => {
    const on = window.scrollY > 600;
    btn.style.opacity = on ? '1' : '0';
    btn.style.pointerEvents = on ? 'auto' : 'none';
  };
  on(window, 'scroll', toggle, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  toggle();
}

export function initSite(): void {
  // Önceki sayfanın global dinleyicilerini ve animasyon döngüsünü bırak
  cleanup();
  document.documentElement.dataset.siteBuild = SITE_BUILD_ID;
  markJsReady();
  initScrollProgress();
  initMobileMenu();
  initMemberNav();
  initReveal();
  initParticles();
  initSpotlight();
  initCounter();
  initBackToTop();
}

