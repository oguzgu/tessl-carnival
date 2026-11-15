import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuth } from './google';

type Identity = NonNullable<Window['google']>['accounts']['id'];
type Options = Parameters<Identity['initialize']>[0];
const clientId = '123-test.apps.googleusercontent.com';

function mockCredential(options: Options, claims: Record<string, unknown> = {}) {
  const payload = {
    aud: clientId,
    iss: 'https://accounts.google.com',
    sub: 'mock-user',
    nonce: options.nonce,
    exp: Date.now() / 1000 + 60,
    ...claims,
  };
  return `mock.${btoa(JSON.stringify(payload))}.mock`;
}

describe('GoogleAuth', () => {
  let auth: GoogleAuth;
  let options: Options;
  let identity: Identity;
  let script: {
    src: string;
    async: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    remove: ReturnType<typeof vi.fn>;
  };
  const changed = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    changed.mockClear();
    identity = {
      initialize: vi.fn((value: Options) => (options = value)),
      renderButton: vi.fn(),
      disableAutoSelect: vi.fn(),
    };
    script = { src: '', async: false, onload: null, onerror: null, remove: vi.fn() };
    vi.stubGlobal('window', { google: { accounts: { id: identity } } });
    vi.stubGlobal('document', {
      baseURI: 'https://example.github.io/tessl-carnival/#/play/water-cannon',
      createElement: vi.fn(() => script),
      head: { append: vi.fn() },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ googleClientId: clientId }))),
    );
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: vi.fn() });
    auth = new GoogleAuth(changed);
  });

  afterEach(() => {
    auth.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([null, {}, { googleClientId: '' }, { googleClientId: 'not-a-client-id' }])(
    'blocks entry and skips Google for invalid configuration %j',
    async (config) => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(config)));
      await auth.start();
      expect(auth.state.status).toBe('setup');
      expect(identity.initialize).not.toHaveBeenCalled();
      expect(document.head.append).not.toHaveBeenCalled();
    },
  );

  it('uses a relative runtime config and waits for a mocked SDK callback, not storage', async () => {
    await auth.start();
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://example.github.io/tessl-carnival/auth-config.json'),
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(auth.state.status).toBe('signed-out');
    expect(options).toMatchObject({
      client_id: clientId,
      ux_mode: 'popup',
      auto_select: false,
      use_fedcm_for_button: true,
    });
    const container = {} as HTMLElement;
    auth.renderButton(container);
    expect(identity.renderButton).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ type: 'standard' }),
    );
    options.callback({ credential: mockCredential(options) });
    expect(auth.state).toEqual({ status: 'signed-in', expiresAt: Date.now() + 60_000 });
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });

  it.each([
    { aud: 'different-client' },
    { iss: 'https://other.example' },
    { nonce: 'old-attempt' },
    { sub: '' },
    { exp: 0 },
    { exp: 'later' },
  ])('keeps a mocked callback with invalid claims signed out: %j', async (claims) => {
    await auth.start();
    options.callback({ credential: mockCredential(options, claims) });
    expect(auth.state.status).toBe('signed-out');
  });

  it('lets users retry a malformed callback without accepting it', async () => {
    await auth.start();
    options.callback({ credential: 'malformed' });
    expect(auth.state.status).toBe('signed-out');
    options.callback({ credential: mockCredential(options) });
    expect(auth.state.status).toBe('signed-in');
  });

  it('expires sessions and rejects callbacks from before logout or expiry', async () => {
    await auth.start();
    const first = options;
    first.callback({ credential: mockCredential(first) });
    auth.signOut();
    expect(auth.state.status).toBe('signed-out');
    expect(identity.disableAutoSelect).toHaveBeenCalledOnce();
    first.callback({ credential: mockCredential(first) });
    expect(auth.state.status).toBe('signed-out');
    const second = options;
    second.callback({ credential: mockCredential(second) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(auth.state).toMatchObject({
      status: 'signed-out',
      message: expect.stringContaining('expired'),
    });
    second.callback({ credential: mockCredential(second) });
    expect(auth.state.status).toBe('signed-out');
  });

  it('checks expiry after the clock advances without running background timers', async () => {
    await auth.start();
    options.callback({ credential: mockCredential(options) });
    vi.setSystemTime(Date.now() + 120_000);
    expect(auth.checkExpiry()).toBe(true);
    expect(auth.state.status).toBe('signed-out');
    expect(auth.checkExpiry()).toBe(false);
  });

  it('fails closed if Google cannot reset after logout', async () => {
    await auth.start();
    options.callback({ credential: mockCredential(options) });
    vi.mocked(identity.disableAutoSelect).mockImplementation(() => {
      throw new Error('SDK failed');
    });
    auth.signOut();
    expect(auth.state.status).toBe('error');
  });

  it('loads the official script and allows retry after a load failure', async () => {
    delete window.google;
    const firstLoad = auth.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(script.src).toBe('https://accounts.google.com/gsi/client');
    script.onerror!();
    await firstLoad;
    expect(auth.state.status).toBe('error');
    expect(script.remove).toHaveBeenCalledOnce();
    const retry = auth.start();
    await vi.advanceTimersByTimeAsync(0);
    window.google = { accounts: { id: identity } };
    script.onload!();
    await retry;
    expect(auth.state.status).toBe('signed-out');
  });

  it('times out a stalled script without accepting a late load', async () => {
    delete window.google;
    const pending = auth.start();
    await vi.advanceTimersByTimeAsync(0);
    const loaded = script.onload!;
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(auth.state.status).toBe('error');
    window.google = { accounts: { id: identity } };
    loaded();
    expect(auth.state.status).toBe('error');
    expect(identity.initialize).not.toHaveBeenCalled();
  });

  it('fails closed when configuration is unavailable or times out', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    await auth.start();
    expect(auth.state.status).toBe('error');
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = auth.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(auth.state.status).toBe('error');
    expect(identity.initialize).not.toHaveBeenCalled();
  });

  it('ignores a superseded configuration response', async () => {
    let resolveResponse!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.mocked(fetch).mockReturnValueOnce(oldResponse);
    const pending = auth.start();
    await auth.start();
    resolveResponse(new Response(JSON.stringify({ googleClientId: '' })));
    await pending;
    expect(auth.state.status).toBe('signed-out');
    expect(identity.initialize).toHaveBeenCalledOnce();
  });

  it('ignores pending script loads and callbacks after disposal', async () => {
    delete window.google;
    const pending = auth.start();
    await vi.advanceTimersByTimeAsync(0);
    const loaded = script.onload!;
    auth.dispose();
    expect(script.onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    changed.mockClear();
    window.google = { accounts: { id: identity } };
    loaded();
    await pending;
    expect(changed).not.toHaveBeenCalled();
    await auth.start();
    const callback = options;
    auth.dispose();
    changed.mockClear();
    callback.callback({ credential: mockCredential(callback) });
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
