import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { game, midway, login, stopGame, stopMidway, stopLogin } = vi.hoisted(() => {
  const stopGame = vi.fn();
  const stopMidway = vi.fn();
  const stopLogin = vi.fn();
  return {
    game: { id: 'water-cannon', name: 'Water Cannon', start: vi.fn(() => stopGame) },
    midway: vi.fn(() => ({ stop: stopMidway })),
    login: vi.fn<typeof import('./auth/login').renderLogin>(() => stopLogin),
    stopGame,
    stopMidway,
    stopLogin,
  };
});
vi.mock('./carnival', () => ({ applyTheme: vi.fn(), bestScore: vi.fn() }));
vi.mock('./games', () => ({
  registry: { all: () => [], get: (id: string) => (id === game.id ? game : undefined) },
}));
vi.mock('./midway/midway', () => ({ startMidway: midway }));
vi.mock('./auth/login', () => ({ renderLogin: login }));

type Options = Parameters<NonNullable<Window['google']>['accounts']['id']['initialize']>[0];

describe('authenticated routing', () => {
  let options: Options;
  let signOut: EventTarget & { hidden: boolean };
  const clientId = '123-test.apps.googleusercontent.com';

  function signIn() {
    options.callback({
      credential: `mock.${btoa(
        JSON.stringify({
          aud: clientId,
          iss: 'accounts.google.com',
          sub: 'mock-user',
          nonce: options.nonce,
          exp: Date.now() / 1000 + 60,
        }),
      )}.mock`,
    });
  }

  function navigate(hash: string) {
    location.hash = hash;
    window.dispatchEvent(new Event('hashchange'));
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    signOut = Object.assign(new EventTarget(), { hidden: true });
    const element = { textContent: '', append: vi.fn() };
    const app = { innerHTML: '', querySelector: () => element };
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), {
        baseURI: 'http://localhost:5173/',
        body: { dataset: {} },
        querySelector: (selector: string) => (selector === '#app' ? app : signOut),
      }),
    );
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        google: {
          accounts: {
            id: {
              initialize: (value: Options) => {
                options = value;
              },
              renderButton: vi.fn(),
              disableAutoSelect: vi.fn(),
            },
          },
        },
      }),
    );
    vi.stubGlobal('location', { hash: '#/', href: 'http://localhost:5173/' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ googleClientId: clientId }))),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('blocks the midway and deep links during loading and missing configuration', async () => {
    let resolveConfig!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveConfig = resolve;
      }),
    );
    await import('./main');
    expect(login.mock.lastCall?.[1].state.status).toBe('loading');
    navigate('#/play/water-cannon');
    expect(login).toHaveBeenCalled();
    expect(game.start).not.toHaveBeenCalled();
    expect(midway).not.toHaveBeenCalled();
    resolveConfig(new Response(JSON.stringify({ googleClientId: '' })));
    await vi.advanceTimersByTimeAsync(0);
    expect(login.mock.lastCall?.[1].state.status).toBe('setup');
    navigate('#/');
    expect(game.start).not.toHaveBeenCalled();
    expect(midway).not.toHaveBeenCalled();
    expect(signOut.hidden).toBe(true);
  });

  it('preserves deep links and stops game/map listeners on logout, navigation and expiry', async () => {
    location.hash = '#/play/water-cannon';
    await import('./main');
    await vi.advanceTimersByTimeAsync(0);
    expect(game.start).not.toHaveBeenCalled();
    signIn();
    expect(location.hash).toBe('#/play/water-cannon');
    expect(game.start).toHaveBeenCalledOnce();
    expect(stopLogin).toHaveBeenCalled();
    expect(signOut.hidden).toBe(false);
    signOut.dispatchEvent(new Event('click'));
    expect(stopGame).toHaveBeenCalledOnce();
    expect(signOut.hidden).toBe(true);
    expect(login.mock.lastCall?.[1].state.status).toBe('signed-out');
    signIn();
    expect(game.start).toHaveBeenCalledTimes(2);
    navigate('#/');
    expect(stopGame).toHaveBeenCalledTimes(2);
    expect(midway).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopMidway).toHaveBeenCalledOnce();
    expect(signOut.hidden).toBe(true);
    expect(login.mock.lastCall?.[1].state.status).toBe('signed-out');
  });

  it('checks expired sessions on tab resume and before starting another route', async () => {
    await import('./main');
    await vi.advanceTimersByTimeAsync(0);
    signIn();
    vi.setSystemTime(Date.now() + 120_000);
    window.dispatchEvent(new Event('focus'));
    expect(stopMidway).toHaveBeenCalledOnce();
    expect(signOut.hidden).toBe(true);
    signIn();
    vi.setSystemTime(Date.now() + 120_000);
    navigate('#/play/water-cannon');
    expect(game.start).not.toHaveBeenCalled();
    expect(signOut.hidden).toBe(true);
  });
});
