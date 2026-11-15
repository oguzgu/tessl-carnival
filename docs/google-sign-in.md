# Google sign-in setup

The midway and every game require Google sign-in in the normal browser flow.
The site stays on GitHub Pages. Its HTML, JavaScript, games and other assets
remain public. This client-only gate is **not a server security boundary**.
Do not use it to protect private data or restricted resources.

## Create the public Client ID

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview)
   in Google Cloud Console. Create or select the project you will own.
2. Complete **Branding**: app name, user support email, developer contact
   information, and the homepage, privacy policy and authorized domains Google
   requires for your deployment. Use accurate information and links you control.
3. Choose the **Audience**. Use External for general Google Accounts. Internal
   works only for accounts in your Google Workspace organization. While the app
   is in Testing, add the intended accounts as test users. Before public launch,
   review Google's publishing and verification requirements and publish the app
   when ready. Organization policies can still block sign-in.
4. Under **Clients**, create an OAuth client with application type
   **Web application**. Only the default sign-in identity scopes are needed;
   do not request Google API access or sensitive scopes.
5. Add these **Authorized JavaScript origins**, one per entry:
   - `http://localhost`
   - `http://localhost:5173`
   - Your actual deployed HTTPS origin.

   Check this fork's **Settings → Pages** for the deployed URL and any custom
   domain first. The repository homepage can still point to the upstream
   carnival. If Pages is not enabled, select GitHub Actions as its source and
   run the existing deployment workflow.

   An origin is scheme + hostname + optional port, **without a path or hash**.
   For example, if Pages reports `https://oguzgu.github.io/tessl-carnival/`,
   enter `https://oguzgu.github.io`, not a URL containing `/tessl-carnival`.
   If Pages uses a custom domain, authorize that HTTPS origin instead. Authorize
   every origin that will actually serve the app, including preview hosts or
   extra localhost ports you choose to use.

6. Leave **Authorized redirect URIs** empty for this integration. The official
   Google button uses a JavaScript credential callback, not a server POST.
7. Copy the **Client ID**, which ends in `.apps.googleusercontent.com`, into
   `public/auth-config.json` as the `googleClientId` string. The checked-in
   default is empty and intentionally blocks entry. The Client ID is public.
   **Never add a client secret, password or token.**
8. Commit the public configuration and deploy through the existing Pages
   workflow. Vite copies it to `dist/auth-config.json`; no workflow, environment
   variable or dependency changes are needed. For local use, edit the same file
   before starting `npm run dev`. A missing, malformed or unavailable
   configuration fails closed with setup help.

## Test your configuration

- Run `npm ci`, then `npm run dev`. Open `http://localhost:5173/` and
  `http://localhost:5173/#/play/water-cannon` in a fresh tab. Both must show
  sign-in before any map or game starts.
- Use the Google button with an allowed account. The first URL must open the
  midway; the second must open Water Cannon without losing the hash.
- Cancel the account chooser and try again. If it fails, check the exact
  origin, Client ID, audience/test users, network access and popup settings.
  Configuration changes at Google can take time to propagate.
- Sign out while playing. The game must stop and show sign-in. Signing in
  again must reopen the same route. The button signs out of this carnival,
  not out of your Google Account, and does not revoke Google consent.
- Reload: sign-in is required again. Wait for credential expiry, or resume
  the tab after it expires: the carnival must return to sign-in.
- Repeat on the deployed URL and a narrow screen. If using `npm run preview`,
  authorize its origin too (default `http://localhost:4173`).
- Run `npm run format`, `npm run check` and `npm run build` before committing.
  Unit tests use mocked Google callbacks; they do not prove real Google login.

## Data and trust limits

The app loads Google's current Identity Services script directly from
`https://accounts.google.com/gsi/client`. A credential from its callback is the
sign-in signal. The app reads callback claims only for sanity checks and expiry;
it does **not** verify the token's cryptographic signature. It keeps only
transient session state, never saves the raw credential, and never restores
sign-in from browser storage. Scores remain anonymous local browser data and
are neither linked to nor synced with Google Accounts.

For actual authorization or private data, add a backend in a separate change.
That server must verify Google's signature, issuer, audience and expiry and
establish a secure session. Decoding a JWT or setting a local flag is not
verification. Browser code can be modified or bypassed by its user.

Official Google documentation:

- [Client ID and Google Auth Platform setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Sign in with Google overview](https://developers.google.com/identity/gsi/web/guides/overview)
- [Verify Google ID tokens on a server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
