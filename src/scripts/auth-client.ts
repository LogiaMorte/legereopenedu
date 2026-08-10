/**
 * Login / signup ortak mantığı.
 * Sayfa markup'ı Astro'da kalır; dil string'leri JSON config'ten gelir.
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

export function initAuth(): void {
  const config = readPageConfig();
  if (!config) return;

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
    errorEl.textContent = decodeURIComponent(
      params.get('error_description') || S.defaultError,
    );
    errorEl.classList.remove('hidden');
  }

  const loadTimeout = window.setTimeout(() => {
    if (!loadingEl.classList.contains('hidden')) {
      loadingEl.classList.add('hidden');
      errorEl.textContent = S.loadTimeout;
      errorEl.classList.remove('hidden');
    }
  }, 8000);

  Promise.all([fetchConfig(), loadGoogleSdk()])
    .then(([cfg]) => {
      clearTimeout(loadTimeout);

      if (!cfg.googleClientId) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = S.notConfigured;
        errorEl.classList.remove('hidden');
        return;
      }

      if (cfg.linkedinEnabled) {
        document.getElementById('linkedin-section')?.classList.remove('hidden');
      } else if (config.mode === 'signup') {
        document.getElementById('info-note')?.classList.remove('hidden');
      }

      const googleSection = document.getElementById('google-signin-section');
      const linkedinEl = document.getElementById('linkedin-section');
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
        consentCheckbox?.addEventListener('change', updateConsentState);
      }

      if (typeof google === 'undefined' || !google.accounts) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = S.googleUnavailable;
        errorEl.classList.remove('hidden');
        return;
      }

      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: (response: { credential: string }) => {
          errorEl.classList.add('hidden');
          fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ credential: response.credential }),
          })
            .then((res) => {
              if (!res.ok) {
                errorEl.textContent = S.googleFailed;
                errorEl.classList.remove('hidden');
                return;
              }
              if (config.mode === 'login') {
                window.location.href = config.profilePath;
                return;
              }
              return res.json().then((data: { isNewMember?: boolean }) => {
                if (data.isNewMember) showSignupSuccess();
                else window.location.href = config.profilePath;
              });
            })
            .catch(() => {
              errorEl.textContent = S.connectionError;
              errorEl.classList.remove('hidden');
            });
        },
      });

      google.accounts.id.renderButton(document.getElementById('google-btn'), {
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
      clearTimeout(loadTimeout);
      loadingEl.classList.add('hidden');
      errorEl.textContent = S.connectionRefresh;
      errorEl.classList.remove('hidden');
    });
}
