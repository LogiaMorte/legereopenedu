/**
 * Login / signup ortak mantığı.
 * Sayfa markup'ı Astro'da kalır; dil string'leri JSON config'ten gelir.
 *
 * cache-bust: 2026-08-10-login-fix — yeni /_astro hash (zehirli 404 cache bypass)
 */

export type AuthMode = 'login' | 'signup';

export interface AuthStrings {
  defaultError: string;
  loadTimeout: string;
  notConfigured: string;
  googleUnavailable: string;
  googleFailed: string;
  connectionError: string;
  connectionRefresh: string;
  noAccount?: string;
  deactivated?: string;
  consentRequired?: string;
  scriptFailed?: string;
}

export interface AuthConfig {
  mode: AuthMode;
  profilePath: string;
  strings: AuthStrings;
}

declare const google: {
  accounts: {
    id: {
      initialize: (opts: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement | null, opts: Record<string, unknown>) => void;
    };
  };
};

const CONFIG_CACHE_KEY = 'legere_api_config_v1';
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

type SiteConfig = {
  googleClientId?: string;
  linkedinEnabled?: boolean;
};

type AuthAbortHolder = { controller?: AbortController };

function authAbortHolder(): AuthAbortHolder {
  const w = window as Window & { __legereAuthAbort?: AuthAbortHolder };
  if (!w.__legereAuthAbort) w.__legereAuthAbort = {};
  return w.__legereAuthAbort;
}

function readCachedConfig(): SiteConfig | null {
  try {
    const raw = sessionStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: SiteConfig };
    if (Date.now() - parsed.ts > CONFIG_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedConfig(data: SiteConfig): void {
  try {
    sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* private mode / quota */
  }
}

function fetchConfig(): Promise<SiteConfig> {
  const cached = readCachedConfig();
  if (cached) return Promise.resolve(cached);
  return fetch('/api/config')
    .then((r) => r.json() as Promise<SiteConfig>)
    .then((data) => {
      writeCachedConfig(data);
      return data;
    });
}

function loadGoogleSdk(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof google !== 'undefined' && google.accounts) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => resolve(), { once: true });
      // Zaten yüklenmiş olabilir
      if (typeof google !== 'undefined' && google.accounts) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.setAttribute('data-cfasync', 'false');
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

function readPageConfig(): AuthConfig | null {
  const node = document.getElementById('auth-client-config');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as AuthConfig;
  } catch {
    return null;
  }
}

function mapAuthError(code: string | undefined, fallback: string, S: AuthStrings): string {
  switch (code) {
    case 'no_account':
      return S.noAccount || fallback;
    case 'deactivated':
      return S.deactivated || fallback;
    case 'consent_required':
      return S.consentRequired || fallback;
    case 'invalid_token':
    case 'missing_credential':
      return S.googleFailed;
    default:
      return fallback;
  }
}

/** Deploy cache-bust — referans verilmezse tree-shake edilir, hash değişmez */
const AUTH_BUILD_ID = '2026-08-10-cookie-loop-fix';

export function initAuth(): void {
  const config = readPageConfig();
  if (!config) return;
  // Build id'yi DOM'a yaz — tree-shake olmasın + debug
  document.documentElement.dataset.authBuild = AUTH_BUILD_ID;

  const holder = authAbortHolder();
  holder.controller?.abort();
  holder.controller = new AbortController();
  const { signal } = holder.controller;

  const loadingEl = document.getElementById('auth-loading');
  const errorEl = document.getElementById(
    config.mode === 'login' ? 'login-error' : 'signup-error',
  );
  if (!loadingEl || !errorEl) return;

  const S = config.strings;
  const formState = document.getElementById('signup-form-state');
  const successState = document.getElementById('signup-success-state');

  const showSignupSuccess = () => {
    if (formState) formState.classList.add('hidden');
    if (successState) {
      successState.classList.remove('hidden');
      void successState.offsetWidth;
      successState.classList.add('is-shown');
    }
    loadingEl.classList.add('hidden');
  };

  const params = new URLSearchParams(window.location.search);
  if (config.mode === 'signup' && params.get('success') === 'new') {
    showSignupSuccess();
    return;
  }
  if (params.get('error')) {
    loadingEl.classList.add('hidden');
    const code = params.get('error') || undefined;
    const desc = params.get('error_description');
    errorEl.textContent = mapAuthError(
      code,
      desc ? decodeURIComponent(desc) : S.defaultError,
      S,
    );
    errorEl.classList.remove('hidden');
  }

  const loadTimeout = window.setTimeout(() => {
    if (signal.aborted) return;
    if (!loadingEl.classList.contains('hidden')) {
      loadingEl.classList.add('hidden');
      errorEl.textContent = S.loadTimeout;
      errorEl.classList.remove('hidden');
    }
  }, 8000);

  Promise.all([fetchConfig(), loadGoogleSdk()])
    .then(([cfg]) => {
      if (signal.aborted) return;
      clearTimeout(loadTimeout);

      if (!cfg.googleClientId) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = S.notConfigured;
        errorEl.classList.remove('hidden');
        return;
      }

      const linkedinElEarly = document.getElementById('linkedin-section');
      if (cfg.linkedinEnabled) {
        linkedinElEarly?.classList.remove('hidden');
      } else {
        // Config LinkedIn kapalıysa gizle (SSR'da görünür bırakıyoruz ki JS kırılsa giriş açılsın)
        linkedinElEarly?.classList.add('hidden');
        if (config.mode === 'signup') {
          document.getElementById('info-note')?.classList.remove('hidden');
        }
      }

      const googleSection = document.getElementById('google-signin-section');
      const linkedinEl = linkedinElEarly;
      const consentSection = document.getElementById('consent-section');
      const consentCheckbox = document.getElementById(
        'consent-checkbox',
      ) as HTMLInputElement | null;

      const updateConsentState = () => {
        if (config.mode !== 'signup') return;
        const accepted = !!(consentCheckbox && consentCheckbox.checked);
        if (googleSection) {
          googleSection.style.opacity = accepted ? '1' : '0.4';
          googleSection.style.pointerEvents = accepted ? 'auto' : 'none';
        }
        if (linkedinEl) {
          linkedinEl.style.opacity = accepted ? '1' : '0.4';
          linkedinEl.style.pointerEvents = accepted ? 'auto' : 'none';
        }
      };

      if (config.mode === 'signup') {
        consentSection?.classList.remove('hidden');
        consentCheckbox?.addEventListener('change', updateConsentState, { signal });
      }

      // GIS yüklenmese bile LinkedIn consent kapısı kapalı kalsın
      if (typeof google === 'undefined' || !google.accounts) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = S.googleUnavailable;
        errorEl.classList.remove('hidden');
        updateConsentState();
        return;
      }

      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: (response: { credential: string }) => {
          if (signal.aborted) return;
          if (config.mode === 'signup' && consentCheckbox && !consentCheckbox.checked) {
            errorEl.textContent = S.consentRequired || S.defaultError;
            errorEl.classList.remove('hidden');
            return;
          }
          errorEl.classList.add('hidden');
          fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              credential: response.credential,
              mode: config.mode,
              consent: config.mode === 'signup' ? true : undefined,
            }),
          })
            .then(async (res) => {
              const data = (await res.json().catch(() => ({}))) as {
                isNewMember?: boolean;
                error?: string;
                code?: string;
              };
              if (!res.ok) {
                errorEl.textContent = mapAuthError(data.code, data.error || S.googleFailed, S);
                errorEl.classList.remove('hidden');
                return;
              }
              // replace: geri tuşu login'e dönüp döngü yaratmasın
              const dest =
                config.mode === 'login' || !data.isNewMember
                  ? config.profilePath
                  : null;
              if (dest) {
                window.location.replace(dest);
                return;
              }
              if (data.isNewMember) showSignupSuccess();
              else window.location.replace(config.profilePath);
            })
            .catch(() => {
              errorEl.textContent = S.connectionError;
              errorEl.classList.remove('hidden');
            });
        },
      });

      const btnHost = document.getElementById('google-btn');
      if (btnHost) btnHost.replaceChildren();
      google.accounts.id.renderButton(btnHost, {
        theme: 'filled_black',
        size: 'large',
        text: config.mode === 'signup' ? 'signup_with' : 'signin_with',
        shape: 'rectangular',
        width: 320,
      });

      loadingEl.classList.add('hidden');
      googleSection?.classList.remove('hidden');
      updateConsentState();
    })
    .catch(() => {
      if (signal.aborted) return;
      clearTimeout(loadTimeout);
      loadingEl.classList.add('hidden');
      errorEl.textContent = S.connectionRefresh;
      errorEl.classList.remove('hidden');
    });
}

