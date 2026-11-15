export type AuthState =
  | { status: 'loading' }
  | { status: 'setup' | 'error' | 'signed-out'; message: string }
  | { status: 'signed-in'; expiresAt: number };

interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    nonce: string;
    ux_mode: 'popup';
    auto_select: false;
    use_fedcm_for_button: true;
  }): void;
  renderButton(
    container: HTMLElement,
    options: { type: 'standard'; theme: 'outline'; size: 'large'; width: number },
  ): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}

function loadGoogle(signal: AbortSignal): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (identity?: GoogleIdentity) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      script.onload = null;
      script.onerror = null;
      if (identity) resolve(identity);
      else {
        script.remove();
        reject(new Error('Google could not load.'));
      }
    };
    const abort = () => finish();
    const timeout = setTimeout(abort, 15_000);
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => finish(window.google?.accounts?.id);
    script.onerror = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else document.head.append(script);
  });
}

function credentialExpiry(credential: string, clientId: string, nonce: string): number {
  const parts = credential.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('Invalid credential.');
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  // These are callback sanity checks and an expiry clock, not signature verification.
  if (
    payload.aud !== clientId ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
    payload.nonce !== nonce ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= Date.now()
  ) {
    throw new Error('Invalid credential.');
  }
  return payload.exp * 1000;
}

export class GoogleAuth {
  state: AuthState = { status: 'loading' };
  private identity?: GoogleIdentity;
  private clientId = '';
  private generation = 0;
  private request?: AbortController;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly onChange: () => void) {}

  private update(state: AuthState) {
    this.state = state;
    this.onChange();
  }

  async start() {
    const generation = ++this.generation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    clearTimeout(this.expiryTimer);
    this.update({ status: 'loading' });
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch(new URL('auth-config.json', document.baseURI), {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Configuration could not load.');
      const config: unknown = await response.json();
      clearTimeout(timeout);
      if (generation !== this.generation) return;
      const clientId =
        config && typeof config === 'object' && 'googleClientId' in config
          ? config.googleClientId
          : undefined;
      if (
        typeof clientId !== 'string' ||
        !/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
      ) {
        this.update({
          status: 'setup',
          message:
            'The carnival owner must add a Google Web Client ID to public/auth-config.json before anyone can enter.',
        });
        return;
      }
      this.clientId = clientId;
      const identity = await loadGoogle(request.signal);
      if (generation !== this.generation) return;
      this.identity = identity;
      this.prepareSignIn();
    } catch {
      if (generation !== this.generation) return;
      this.update({
        status: 'error',
        message:
          'Sign-in could not load. Check your connection and allow accounts.google.com, then try again. Owners: also check auth-config.json.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private prepareSignIn(message = 'Use your Google Account to enter the midway and play.') {
    const generation = ++this.generation;
    try {
      const nonce = crypto.randomUUID();
      this.identity!.initialize({
        client_id: this.clientId,
        nonce,
        ux_mode: 'popup',
        auto_select: false,
        use_fedcm_for_button: true,
        callback: ({ credential }) => {
          if (generation !== this.generation || this.state.status !== 'signed-out') return;
          try {
            const expiresAt = credentialExpiry(credential, this.clientId, nonce);
            this.update({ status: 'signed-in', expiresAt });
            this.scheduleExpiry();
          } catch {
            this.update({
              status: 'signed-out',
              message: 'Google did not return a current sign-in. Please try signing in again.',
            });
          }
        },
      });
      this.update({ status: 'signed-out', message });
    } catch {
      this.update({
        status: 'error',
        message: 'Google sign-in could not start. Check your Google setup and try again.',
      });
    }
  }

  renderButton(container: HTMLElement) {
    this.identity!.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      width: 240,
    });
  }

  private scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (this.state.status !== 'signed-in') return;
    this.expiryTimer = setTimeout(
      () => {
        if (!this.checkExpiry()) this.scheduleExpiry();
      },
      Math.min(this.state.expiresAt - Date.now(), 2_147_483_647),
    );
  }

  checkExpiry(): boolean {
    if (this.state.status !== 'signed-in' || this.state.expiresAt > Date.now()) return false;
    this.signOut('Your session has expired. Sign in again to keep playing.');
    return true;
  }

  signOut(message = 'You signed out of the carnival. Sign in to play again.') {
    ++this.generation;
    clearTimeout(this.expiryTimer);
    try {
      this.identity?.disableAutoSelect();
    } catch {
      this.update({
        status: 'error',
        message: 'You signed out, but Google could not reset. Reload the page to sign in again.',
      });
      return;
    }
    this.prepareSignIn(message);
  }

  dispose() {
    ++this.generation;
    this.request?.abort();
    clearTimeout(this.expiryTimer);
  }
}
