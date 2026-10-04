#!/usr/bin/env node
// One-time, local-only script: authorizes this pipeline against your
// real YouTube channel and prints the refresh token to save as the
// YOUTUBE_REFRESH_TOKEN repo secret. Never runs in CI -- OAuth consent
// needs a real browser and a real person clicking "Allow" on your
// Google account, the same "has to be done by hand once" step as the
// original Buffer-to-Pinterest channel linking.
//
// Prerequisites (see docs/SETUP.md's YouTube section): a Google Cloud
// project with the YouTube Data API v3 enabled, an OAuth client of type
// "Desktop app" (NOT "Web application" -- Desktop app clients allow any
// http://localhost:<port> redirect without pre-registering the exact
// port, which is what lets this script pick an ephemeral port itself),
// and that client's Client ID/Secret set locally as YOUTUBE_CLIENT_ID /
// YOUTUBE_CLIENT_SECRET in .env.
//
// Usage: node scripts/pipeline/youtube-oauth-setup.mjs

import { createServer } from 'node:http';
import { loadEnv } from '../lib/env.mjs';

loadEnv();

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first -- see docs/SETUP.md.');
  process.exitCode = 1;
  process.exit();
}

// access_type=offline + prompt=consent: without both, Google only issues
// a refresh_token on an account's very first-ever consent for this
// client -- prompt=consent forces the consent screen (and a fresh
// refresh_token) every time this script runs, so re-running it to
// rotate credentials always works, not just the first time.
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

async function main() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\nOpen this URL in a browser signed in to the Google account that owns your YouTube channel:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for you to approve access...\n');

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(error ? `<p>Authorization failed: ${error}. Check the terminal and try again.</p>` : '<p>Authorized -- you can close this tab and return to the terminal.</p>');
      if (error) reject(new Error(`Google returned an error: ${error}`));
      else if (code) resolve(code);
    });
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  server.close();

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token. This can happen if the account already granted this exact client access before without prompt=consent forcing a fresh one -- try again (this script always sends prompt=consent, so a re-run should fix it), or revoke prior access at https://myaccount.google.com/permissions first.');
  }

  console.log('Authorized. Save this as the YOUTUBE_REFRESH_TOKEN repo secret:\n');
  console.log(tokens.refresh_token);
  console.log('\n(This value does not expire on its own and is reused for every future upload -- treat it like a password: never commit it.)');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
