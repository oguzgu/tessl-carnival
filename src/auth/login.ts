import type { GoogleAuth } from './google';

export function renderLogin(app: HTMLElement, auth: GoogleAuth): () => void {
  document.body.dataset.view = 'login';
  app.innerHTML = `
    <section class="login-card" aria-labelledby="login-title">
      <p class="login-eyebrow">Your ticket to the carnival</p>
      <h1 id="login-title" tabindex="-1">Step right in</h1>
      <p class="login-status" role="status" aria-live="polite"></p>
      <div class="google-sign-in"></div>
      <button class="login-retry" type="button" hidden>Try again</button>
      <details class="login-setup">
        <summary>Owner setup &amp; sign-in help</summary>
        <p>Create a Google OAuth Web application, authorize this site's origin,
          then set <code>googleClientId</code> in <code>public/auth-config.json</code> and redeploy.</p>
        <p>See <a href="https://github.com/oguzgu/tessl-carnival/blob/main/docs/google-sign-in.md"
          target="_blank" rel="noopener">Google sign-in setup</a> for the full steps.</p>
        <p>If a Google window closes or sign-in is cancelled, use the Google button again.
          Allow popups and check the owner's authorized origins if it does not open.</p>
      </details>
      <p class="login-note">Google sign-in is required to play. Scores stay in this browser,
        not in your Google Account.</p>
      <p class="login-note">This is a public GitHub Pages site. Sign-in controls the app flow;
        it does not make the site files private.</p>
    </section>`;

  const status = app.querySelector<HTMLElement>('.login-status')!;
  const retry = app.querySelector<HTMLButtonElement>('.login-retry')!;
  const setup = app.querySelector<HTMLDetailsElement>('.login-setup')!;
  const state = auth.state;
  status.textContent =
    state.status === 'loading'
      ? 'Loading Google sign-in…'
      : 'message' in state
        ? state.message
        : '';
  if (state.status === 'setup') setup.open = true;
  if (state.status === 'signed-out') {
    try {
      auth.renderButton(app.querySelector<HTMLElement>('.google-sign-in')!);
    } catch {
      status.textContent = 'The Google button could not load. Please try again.';
      retry.hidden = false;
    }
  } else if (state.status === 'setup' || state.status === 'error') {
    retry.hidden = false;
  }
  const restart = () => void auth.start();
  retry.addEventListener('click', restart);
  app.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true });
  return () => retry.removeEventListener('click', restart);
}
