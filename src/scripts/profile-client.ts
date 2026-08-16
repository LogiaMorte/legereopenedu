/**
 * Profil sayfası ortak mantığı (TR/EN).
 * Dil string'leri ve etiket haritaları #profile-client-config JSON'ından gelir.
 */

export interface ProfileStrings {
  memberFallback: string;
  verifyLabel: string;
  saving: string;
  privacySaved: string;
  privacyError: string;
  profileSaved: string;
  schoolEmailInUse: string;
  schoolEmailInvalid: string;
  saveGenericError: string;
  connectionError: string;
  linkedinVerifiedTitle: string;
  loadError: string;
  retry: string;
}

export interface ProfileConfig {
  locale: string;
  homePath: string;
  verifyPath: string;
  strings: ProfileStrings;
  badgeMeta: Record<string, { icon: string; name: string; desc: string }>;
  certTypes: Record<string, string>;
  statusMap: Record<string, { label: string; cls: string }>;
  interestLabels: Record<string, string>;
  verifyLabels: Record<string, string>;
}

type ProfileUser = {
  name?: string;
  picture?: string;
  university?: string;
  department?: string;
  linkedinHeadline?: string;
  joinDate?: string;
  schoolEmail?: string;
  linkedin?: string;
  ideas?: string;
  interests?: string[];
  showFullName?: boolean;
  showEmail?: boolean;
  showPublicProfile?: boolean;
  publicProfileId?: string;
  linkedinSub?: boolean;
  googleSub?: boolean;
  linkedinVerifications?: string[];
};

type Registration = {
  id: string;
  workshop?: string;
  workshopTitle?: { tr?: string; en?: string } | string;
  status?: string;
  timestamp?: string;
};

type Certificate = {
  id: string;
  type?: string;
  workshopTitle?: { tr?: string; en?: string } | string;
  workshopId?: string;
  issueDate?: string;
};

type Badge = { badgeId: string };

function readConfig(): ProfileConfig | null {
  const node = document.getElementById('profile-client-config');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as ProfileConfig;
  } catch {
    return null;
  }
}

function esc(str: unknown): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localizedTitle(
  title: { tr?: string; en?: string } | string | undefined,
  locale: string,
  fallback: string,
): string {
  if (title && typeof title === 'object') {
    const lang = locale.toLowerCase().startsWith('en') ? 'en' : 'tr';
    return title[lang] || title.tr || title.en || fallback;
  }
  if (typeof title === 'string' && title.trim()) return title;
  return fallback;
}

let toastTimer = 0;

function showToast(msg: string, kind: 'ok' | 'err'): void {
  const el = document.getElementById('profile-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `lg-toast is-on ${kind === 'err' ? 'is-err' : 'is-ok'}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-on'), 2800);
}

function openEditForm(): void {
  const editContainer = document.getElementById('edit-form-container');
  const editChevron = document.getElementById('edit-chevron');
  if (!editContainer) return;
  editContainer.classList.remove('hidden');
  if (editChevron) editChevron.style.transform = 'rotate(180deg)';
  editContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateShareLink(publicProfileId: string | null): void {
  const shareContainer = document.getElementById('public-profile-share');
  const shareLink = document.getElementById('public-profile-link') as HTMLAnchorElement | null;
  if (!shareContainer || !shareLink) return;
  if (publicProfileId) {
    const publicUrl = `${window.location.origin}/m?id=${publicProfileId}`;
    shareContainer.classList.remove('hidden');
    shareLink.href = publicUrl;
    shareLink.textContent = publicUrl;
  } else {
    shareContainer.classList.add('hidden');
    shareLink.href = '#';
    shareLink.textContent = '';
  }
}

export function initProfile(): void {
  const config = readConfig();
  if (!config) return;

  const loadingEl = document.getElementById('profile-loading');
  const contentEl = document.getElementById('profile-content');
  const notLoggedEl = document.getElementById('profile-not-logged-in');
  const errorEl = document.getElementById('profile-load-error');
  if (!loadingEl || !contentEl || !notLoggedEl) return;

  const showPanel = (which: 'loading' | 'content' | 'guest' | 'error') => {
    loadingEl.classList.toggle('hidden', which !== 'loading');
    contentEl.classList.toggle('hidden', which !== 'content');
    notLoggedEl.classList.toggle('hidden', which !== 'guest');
    errorEl?.classList.toggle('hidden', which !== 'error');
  };

  const S = config.strings;
  const {
    badgeMeta: BADGE_META,
    certTypes: CERT_TYPES,
    statusMap: STATUS_MAP,
    interestLabels: INTEREST_LABELS,
    verifyLabels: VERIFY_LABELS,
  } = config;

  const switchTab = (tabName: string) => {
    document.querySelectorAll('.profile-tab').forEach((t) => {
      const el = t as HTMLElement;
      if (el.dataset.tab === tabName) {
        el.classList.add('bg-gold-500/10', 'text-gold-500', 'border', 'border-gold-500/20');
        el.classList.remove('text-text-secondary');
      } else {
        el.classList.remove('bg-gold-500/10', 'text-gold-500', 'border', 'border-gold-500/20');
        el.classList.add('text-text-secondary');
      }
    });
    document.getElementById('panel-overview')?.classList.toggle('hidden', tabName !== 'overview');
    document.getElementById('panel-events')?.classList.toggle('hidden', tabName !== 'events');
  };

  document.querySelectorAll('.profile-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = (tab as HTMLElement).dataset.tab;
      if (name) switchTab(name);
    });
  });
  switchTab('overview');

  const refreshContribution = (
    university: string,
    department: string,
    schoolEmail: string,
    linkedin: string,
    ideas: string,
    interests: string[],
  ) => {
    const uni = document.getElementById('profile-uni-text');
    const dept = document.getElementById('profile-dept-text');
    if (uni) uni.textContent = university || '-';
    if (dept) dept.textContent = department || '-';

    const schoolWrap = document.getElementById('profile-school-email');
    if (schoolWrap) {
      if (schoolEmail) {
        schoolWrap.classList.remove('hidden');
        const t = document.getElementById('profile-school-email-text');
        if (t) t.textContent = schoolEmail;
      } else {
        schoolWrap.classList.add('hidden');
      }
    }

    const contSection = document.getElementById('contribution-section');
    if (contSection && ((interests && interests.length > 0) || ideas || linkedin)) {
      contSection.classList.remove('hidden');
      if (interests?.length) {
        const contInterests = document.getElementById('contribution-interests');
        if (contInterests) {
          contInterests.innerHTML = interests
            .map((i) => {
              const label = INTEREST_LABELS[i] || esc(i);
              return `<span class="badge badge-discipline">${esc(label)}</span>`;
            })
            .join('');
        }
      }
      if (ideas) {
        document.getElementById('contribution-ideas')?.classList.remove('hidden');
        const ideasText = document.getElementById('contribution-ideas-text');
        if (ideasText) ideasText.textContent = ideas;
      }
      if (linkedin) {
        document.getElementById('contribution-linkedin')?.classList.remove('hidden');
        const link = document.getElementById('contribution-linkedin-link') as HTMLAnchorElement | null;
        if (link) link.href = linkedin;
      }
    }

    const incomplete = !(university && university.trim()) || !(department && department.trim());
    const onboard = document.getElementById('profile-onboarding');
    if (onboard && !incomplete) onboard.classList.add('hidden');
  };

  const updatePrivacy = async (
    settings: Record<string, boolean>,
    toggleEl: HTMLInputElement,
    onSuccess?: (data: { publicProfileId?: string | null }) => void,
  ) => {
    const prevState = !toggleEl.checked;
    try {
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        toggleEl.checked = prevState;
        showToast(S.privacyError, 'err');
      } else {
        const data = (await res.json().catch(() => ({}))) as { publicProfileId?: string | null };
        showToast(S.privacySaved, 'ok');
        onSuccess?.(data);
      }
    } catch {
      toggleEl.checked = prevState;
      showToast(S.privacyError, 'err');
    }
  };

  const renderProfile = (data: {
    user: ProfileUser;
    registrations: Registration[];
    certificates: Certificate[];
    badges: Badge[];
  }) => {
    const { user, registrations, certificates, badges } = data;

    const avatarEl = document.getElementById('profile-avatar');
    if (user.picture && avatarEl?.parentElement) {
      const img = document.createElement('img');
      img.src = user.picture;
      img.alt = '';
      img.className = 'w-20 h-20 rounded-full object-cover';
      avatarEl.parentElement.textContent = '';
      avatarEl.parentElement.appendChild(img);
    } else if (avatarEl) {
      const initials = user.name
        ? user.name
            .split(' ')
            .map((w) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : '?';
      avatarEl.textContent = initials;
    }

    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.textContent = user.name || S.memberFallback;
    const uniText = document.getElementById('profile-uni-text');
    if (uniText) uniText.textContent = user.university || '-';
    const deptText = document.getElementById('profile-dept-text');
    if (deptText) deptText.textContent = user.department || user.linkedinHeadline || '-';
    const joinText = document.getElementById('profile-join-text');
    if (joinText) {
      joinText.textContent = user.joinDate
        ? new Date(user.joinDate).toLocaleDateString(config.locale, { year: 'numeric', month: 'long' })
        : '-';
    }

    const badgesContainer = document.getElementById('profile-verification-badges');
    let badgeHtml = '';
    if (user.linkedinSub) {
      badgeHtml +=
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-[#0A66C2]/15 text-[#0A66C2] border border-[#0A66C2]/25" title="LinkedIn"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>LinkedIn</span>';
    }
    if (user.googleSub) {
      badgeHtml +=
        '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-white/10 text-text-secondary border border-white/15" title="Google"><svg class="w-3 h-3" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Google</span>';
    }
    (user.linkedinVerifications || []).forEach((v) => {
      const label = VERIFY_LABELS[v] || esc(v);
      badgeHtml += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" title="${esc(S.linkedinVerifiedTitle)}: ${esc(label)}"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>${esc(label)}</span>`;
    });
    if (badgesContainer) badgesContainer.innerHTML = badgeHtml;

    if (user.schoolEmail) {
      document.getElementById('profile-school-email')?.classList.remove('hidden');
      const se = document.getElementById('profile-school-email-text');
      if (se) se.textContent = user.schoolEmail;
    }

    const toggleFullName = document.getElementById('toggle-fullname') as HTMLInputElement | null;
    const toggleEmail = document.getElementById('toggle-email') as HTMLInputElement | null;
    const togglePublicProfile = document.getElementById(
      'toggle-public-profile',
    ) as HTMLInputElement | null;
    if (toggleFullName) {
      toggleFullName.checked = user.showFullName ?? true;
      toggleFullName.addEventListener('change', () =>
        updatePrivacy({ showFullName: toggleFullName.checked }, toggleFullName),
      );
    }
    if (toggleEmail) {
      toggleEmail.checked = user.showEmail ?? false;
      toggleEmail.addEventListener('change', () =>
        updatePrivacy({ showEmail: toggleEmail.checked }, toggleEmail),
      );
    }
    if (togglePublicProfile) {
      togglePublicProfile.checked = user.showPublicProfile ?? false;
      togglePublicProfile.addEventListener('change', () => {
        updatePrivacy({ showPublicProfile: togglePublicProfile.checked }, togglePublicProfile, (d) => {
          updateShareLink(d?.publicProfileId || null);
        });
      });
    }

    if (user.showPublicProfile && user.publicProfileId) {
      updateShareLink(user.publicProfileId);
      document.getElementById('copy-public-link')?.addEventListener('click', () => {
        const publicUrl = `${window.location.origin}/m?id=${user.publicProfileId}`;
        navigator.clipboard.writeText(publicUrl).then(() => {
          const btn = document.getElementById('copy-public-link');
          if (!btn) return;
          btn.innerHTML =
            '<svg class="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>';
          window.setTimeout(() => {
            btn.innerHTML =
              '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>';
          }, 2000);
        });
      });
    }

    const setVal = (id: string, val: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) el.value = val;
    };
    setVal('edit-university', user.university || '');
    setVal('edit-department', user.department || '');
    setVal('edit-school-email', user.schoolEmail || '');
    setVal('edit-linkedin', user.linkedin || '');
    setVal('edit-ideas', user.ideas || '');
    (user.interests || []).forEach((i) => {
      const cb = document.querySelector(
        `input[name="edit-interests"][value="${i}"]`,
      ) as HTMLInputElement | null;
      if (cb) cb.checked = true;
    });

    if ((user.interests && user.interests.length > 0) || user.ideas || user.linkedin) {
      document.getElementById('contribution-section')?.classList.remove('hidden');
      if (user.interests?.length) {
        const contInterests = document.getElementById('contribution-interests');
        if (contInterests) {
          contInterests.innerHTML = user.interests
            .map((i) => {
              const label = INTEREST_LABELS[i] || esc(i);
              return `<span class="badge badge-discipline">${esc(label)}</span>`;
            })
            .join('');
        }
      }
      if (user.ideas) {
        document.getElementById('contribution-ideas')?.classList.remove('hidden');
        const ideasText = document.getElementById('contribution-ideas-text');
        if (ideasText) ideasText.textContent = user.ideas;
      }
      if (user.linkedin) {
        document.getElementById('contribution-linkedin')?.classList.remove('hidden');
        const link = document.getElementById('contribution-linkedin-link') as HTMLAnchorElement | null;
        if (link) link.href = user.linkedin;
      }
    }

    const setText = (id: string, val: string | number) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setText('stat-workshops', registrations.length);
    setText('stat-certificates', certificates.length);
    setText('stat-badges', badges.length);

    if (registrations.length > 0) {
      const countEl = document.getElementById('tab-events-count');
      if (countEl) {
        countEl.textContent = String(registrations.length);
        countEl.classList.remove('hidden');
      }
    }

    if (certificates.length > 0) {
      setText('cert-count', `(${certificates.length})`);
      const certList = document.getElementById('certificates-list');
      if (certList) {
        certList.innerHTML = certificates
          .map((cert) => {
            const typeLabel = CERT_TYPES[cert.type || ''] || esc(cert.type);
            const typeColor =
              cert.type === 'achievement'
                ? 'text-gold-300'
                : cert.type === 'contribution'
                  ? 'text-status-upcoming'
                  : 'text-status-open';
            const date = cert.issueDate
              ? `<p class="text-xs text-text-secondary/60 mt-0.5">${new Date(cert.issueDate).toLocaleDateString(config.locale)}</p>`
              : '';
            return `<div class="glass-subtle p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div class="min-w-0"><div class="flex items-center gap-2 mb-1"><span class="text-sm font-heading font-semibold ${typeColor}">${esc(typeLabel)}</span><span class="text-xs font-mono text-text-secondary">${esc(cert.id)}</span></div><p class="text-xs text-text-secondary truncate">${esc(localizedTitle(cert.workshopTitle, config.locale, cert.workshopId || '-'))}</p>${date}</div><div class="flex items-center gap-2 shrink-0"><a href="${config.verifyPath}?cert=${encodeURIComponent(cert.id)}" class="text-xs text-gold-500 hover:text-gold-300 font-heading transition-colors">${esc(S.verifyLabel)}</a></div></div>`;
          })
          .join('');
      }
    }

    if (badges.length > 0) {
      setText('badge-count', `(${badges.length})`);
      const badgesList = document.getElementById('badges-list');
      if (badgesList) {
        badgesList.innerHTML = badges
          .map((b) => {
            const meta = BADGE_META[b.badgeId] || { icon: '🎖️', name: b.badgeId, desc: '' };
            return `<div class="glass-subtle px-4 py-3 rounded-xl flex items-center gap-3 group hover:border-gold-500/30 transition-colors" title="${esc(meta.desc)}"><span class="text-2xl">${meta.icon}</span><div><div class="text-sm font-heading font-semibold text-text-primary">${esc(meta.name)}</div><div class="text-xs text-text-secondary">${esc(meta.desc)}</div></div></div>`;
          })
          .join('');
      }
    }

    const upcoming = registrations.filter((r) => r.status === 'accepted');
    const pending = registrations.filter((r) => r.status === 'pending');
    const past = registrations.filter((r) => r.status === 'completed');

    const renderEventCard = (r: Registration) => {
      const status = STATUS_MAP[r.status || 'pending'] || STATUS_MAP.pending;
      const when = r.timestamp
        ? `<p class="text-xs text-text-secondary/60 mt-0.5">${new Date(r.timestamp).toLocaleDateString(config.locale, { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
        : '';
      return `<div class="glass-subtle p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div class="min-w-0"><p class="text-sm font-heading font-medium text-text-primary truncate">${esc(localizedTitle(r.workshopTitle, config.locale, r.workshop || r.id))}</p>${when}</div><span class="badge ${status.cls} shrink-0">${esc(status.label)}</span></div>`;
    };

    if (upcoming.length > 0) {
      const el = document.getElementById('events-upcoming');
      if (el) el.innerHTML = upcoming.map(renderEventCard).join('');
    }
    if (pending.length > 0) {
      document.getElementById('events-pending-section')?.classList.remove('hidden');
      const el = document.getElementById('events-pending');
      if (el) el.innerHTML = pending.map(renderEventCard).join('');
    }
    if (past.length > 0) {
      const el = document.getElementById('events-past');
      if (el) el.innerHTML = past.map(renderEventCard).join('');
    }

    const incomplete =
      !(user.university && String(user.university).trim()) ||
      !(user.department && String(user.department).trim());
    const wantWelcome = new URLSearchParams(window.location.search).get('welcome') === '1';
    const onboard = document.getElementById('profile-onboarding');
    if (onboard && (incomplete || wantWelcome)) {
      onboard.classList.remove('hidden');
      if (incomplete) openEditForm();
    }
    document.getElementById('onboard-edit')?.addEventListener('click', openEditForm);
  };

  /**
   * Profil yükleme.
   *
   * Buradaki ayrım kritik: "kimlik doğrulanamadı" ile "profil çizilirken hata
   * oldu" AYNI ŞEY DEĞİL. Eskiden renderProfile() de try bloğunun içindeydi ve
   * çizim sırasındaki herhangi bir hata catch'e düşüp "Giriş yapmanız
   * gerekiyor." ekranını gösteriyordu — kullanıcı girişliyken.
   *
   * Bu yanlış tanı, gerçek hatayı da tamamen gizliyordu: konsolda iz yoktu,
   * belirti "oturum düşüyor" gibi görünüyordu ve haftalarca çerez/oturum
   * tarafında arandı. Oysa /api/auth/me 200 dönüyordu — nav'daki üye ve admin
   * bağlantılarının aynı sayfada açılması bunun kanıtıydı.
   *
   * Artık: kimlik doğrulandıysa içerik GÖSTERİLİR. Çizimin bir parçası
   * patlarsa sayfa boş kalmaz, hata konsola yazılır.
   */
  let inflight: AbortController | null = null;
  const loadProfile = async () => {
    inflight?.abort();
    showPanel('loading');
    const ac = new AbortController();
    inflight = ac;
    const abortTimer = window.setTimeout(() => ac.abort(), 8000);
    let res: Response;
    try {
      res = await fetch('/api/auth/me', { credentials: 'include', signal: ac.signal });
    } catch (err) {
      if (inflight !== ac) return;
      // Ağ / zaman aşımı: kimlik durumu bilinmiyor. "Giriş yapın" demek
      // yavaş bir API'yi oturum düşmüş gibi gösterir — ayrı hata paneli.
      console.error('[profile] /api/auth/me isteğine ulaşılamadı:', err);
      clearTimeout(abortTimer);
      showPanel('error');
      return;
    }
    clearTimeout(abortTimer);
    if (inflight !== ac) return;

    if (!res.ok) {
      showPanel('guest');
      // Bozuk/çakışan oturum çerezlerini temizle ki login döngüsü kırılsın
      document.cookie = 'legere_logged_in=; Path=/; Max-Age=0; SameSite=Lax; Secure';
      document.cookie =
        'legere_logged_in=; Path=/; Max-Age=0; SameSite=Lax; Secure; Domain=.legereopenedu.com';
      return;
    }

    let data: Parameters<typeof renderProfile>[0];
    try {
      data = (await res.json()) as Parameters<typeof renderProfile>[0];
    } catch (err) {
      console.error('[profile] /api/auth/me yanıtı okunamadı:', err);
      showPanel('error');
      return;
    }

    // Kimlik doğrulandı — içerik buradan sonra her hâlükârda gösterilir.
    showPanel('content');

    try {
      renderProfile(data);
    } catch (err) {
      // Tek bir alanın çizimi patlasa bile sayfa ayakta kalır; kullanıcıyı
      // giriş ekranına atmak bu hatanın karşılığı değil.
      console.error('[profile] profil çizilirken hata:', err);
    }
  };

  document.getElementById('edit-toggle')?.addEventListener('click', () => {
    const editContainer = document.getElementById('edit-form-container');
    const editChevron = document.getElementById('edit-chevron');
    if (!editContainer) return;
    editContainer.classList.toggle('hidden');
    if (editChevron) {
      editChevron.style.transform = editContainer.classList.contains('hidden')
        ? ''
        : 'rotate(180deg)';
    }
  });

  const saveBtn = document.getElementById('edit-save') as HTMLButtonElement | null;
  saveBtn?.addEventListener('click', async () => {
    const editError = document.getElementById('edit-error');
    const editSuccess = document.getElementById('edit-success');
    editError?.classList.add('hidden');
    editSuccess?.classList.add('hidden');

    saveBtn.disabled = true;
    const origText = saveBtn.innerHTML;
    saveBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> ${esc(S.saving)}`;

    const interests: string[] = [];
    document.querySelectorAll('input[name="edit-interests"]:checked').forEach((cb) => {
      interests.push((cb as HTMLInputElement).value);
    });

    const getTrim = (id: string) =>
      ((document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value || '').trim();

    try {
      const university = getTrim('edit-university');
      const department = getTrim('edit-department');
      const schoolEmail = getTrim('edit-school-email');
      const linkedin = getTrim('edit-linkedin');
      const ideas = getTrim('edit-ideas');
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ university, department, schoolEmail, linkedin, ideas, interests }),
      });
      if (res.ok) {
        editSuccess?.classList.remove('hidden');
        refreshContribution(university, department, schoolEmail, linkedin, ideas, interests);
        showToast(S.profileSaved, 'ok');
      } else {
        const result = (await res.json().catch(() => ({}))) as { error?: string };
        if (editError) {
          editError.textContent =
            result.error === 'School email already in use'
              ? S.schoolEmailInUse
              : result.error === 'Invalid school email format'
                ? S.schoolEmailInvalid
                : S.saveGenericError;
          editError.classList.remove('hidden');
        }
      }
    } catch {
      if (editError) {
        editError.textContent = S.connectionError;
        editError.classList.remove('hidden');
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origText;
    }
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/me', { method: 'DELETE', credentials: 'include' });
    } catch {
      /* ignore */
    }
    document.cookie = 'legere_logged_in=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    document.cookie =
      'legere_logged_in=; Path=/; Max-Age=0; SameSite=Lax; Secure; Domain=.legereopenedu.com';
    window.location.href = config.homePath;
  });

  document.getElementById('profile-retry')?.addEventListener('click', () => {
    loadProfile();
  });

  loadProfile();
}
