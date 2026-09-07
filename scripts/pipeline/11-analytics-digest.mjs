#!/usr/bin/env node
// Stage 11 (maintenance/utility, like stage 10): emails a daily
// Cloudflare Web Analytics digest (visits, page views, top pages,
// referrers, countries, device types) for the previous UTC day to
// ANALYTICS_DIGEST_EMAIL via Resend.
//
// Not human-gated like stages 6-8: this is a private report to the site
// owner, not something that goes out publicly, so there's no
// approve-before-send step -- it just sends every time it runs. Meant
// to run daily via .github/workflows/analytics-digest.yml.
//
// If the Cloudflare query itself fails (bad token, wrong tag, schema
// drift -- see the NOTE in cloudflare-analytics.mjs), this still sends
// an email saying so rather than failing silently, so a broken digest is
// something the recipient actually notices instead of just not getting
// an email one day and not knowing why. It also exits non-zero either
// way, so the GitHub Actions run itself shows failed too.
//
// Usage: npm run pipeline:analytics [-- --date 2026-09-06]   # defaults to yesterday (UTC)

import { loadEnv } from '../lib/env.mjs';
import { fetchDailyStats } from '../lib/cloudflare-analytics.mjs';
import { sendEmail } from '../lib/resend.mjs';

loadEnv();

const SITE_URL = 'https://mindtivate.com';
const BRAND = { terracotta: '#d97a5f', plum: '#2f2a33', sage: '#5f7457', cream: '#fbf6ef' };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--date') args.date = argv[++i];
  }
  return args;
}

// Yesterday in UTC, as a YYYY-MM-DD string -- avoids any local-timezone
// drift between where this happens to run and what "yesterday" means.
function defaultDigestDate() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

function dayWindow(dateStr) {
  const since = `${dateStr}T00:00:00Z`;
  const until = new Date(new Date(since).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { since, until };
}

function renderList(items, { showCount = true } = {}) {
  if (items.length === 0) {
    return `<li style="color:${BRAND.plum};opacity:0.6;font-family:Arial,sans-serif;font-size:14px;">No data</li>`;
  }
  return items
    .map(
      (item) =>
        `<li style="font-family:Arial,sans-serif;font-size:15px;color:${BRAND.plum};margin-bottom:0.4em;">${item.label}${
          showCount ? ` <span style="color:${BRAND.sage};">(${item.count})</span>` : ''
        }</li>`,
    )
    .join('\n');
}

function renderSection(title, items) {
  return `
    <div style="margin:1.6em 0;">
      <p style="margin:0 0 0.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.sage};font-family:Arial,sans-serif;font-weight:bold;">${title}</p>
      <ul style="margin:0;padding-left:1.2em;">${renderList(items)}</ul>
    </div>`;
}

function renderHtml({ dateStr, stats }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 24px;background:${BRAND.cream};font-family:Georgia,serif;">
    <div style="max-width:560px;margin:0 auto;">
      <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.sage};font-family:Arial,sans-serif;">Mindtivate Analytics</p>
      <h1 style="margin:0 0 0.3em;font-size:24px;line-height:1.25;color:${BRAND.plum};">Daily digest — ${dateStr}</h1>
      <p style="margin:0 0 1.5em;font-size:14px;color:${BRAND.plum};opacity:0.7;font-family:Arial,sans-serif;">Cloudflare Web Analytics, previous UTC day.</p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:1.5em 0;">
        <tr>
          <td style="padding-right:2.5em;">
            <div style="font-size:32px;font-weight:bold;color:${BRAND.terracotta};font-family:Georgia,serif;">${stats.visits}</div>
            <div style="font-size:13px;color:${BRAND.plum};font-family:Arial,sans-serif;">Visits</div>
          </td>
          <td>
            <div style="font-size:32px;font-weight:bold;color:${BRAND.terracotta};font-family:Georgia,serif;">${stats.pageviews}</div>
            <div style="font-size:13px;color:${BRAND.plum};font-family:Arial,sans-serif;">Page views</div>
          </td>
        </tr>
      </table>

      ${renderSection('Top pages', stats.topPaths)}
      ${renderSection('Top referrers', stats.topReferrers)}
      ${renderSection('Top countries', stats.topCountries)}
      ${renderSection('Device types', stats.topDevices)}

      <p style="margin:2em 0 0;font-size:12px;color:${BRAND.plum};opacity:0.6;font-family:Arial,sans-serif;">
        Cloudflare Web Analytics is cookieless and doesn't identify individual visitors —
        counts reflect aggregate traffic only. See ${SITE_URL}.
      </p>
    </div>
  </body>
</html>`;
}

function renderText({ dateStr, stats }) {
  const list = (items) => (items.length ? items.map((i) => `  - ${i.label} (${i.count})`).join('\n') : '  (no data)');
  return `Mindtivate Analytics — Daily digest — ${dateStr}
Cloudflare Web Analytics, previous UTC day.

Visits: ${stats.visits}
Page views: ${stats.pageviews}

Top pages:
${list(stats.topPaths)}

Top referrers:
${list(stats.topReferrers)}

Top countries:
${list(stats.topCountries)}

Device types:
${list(stats.topDevices)}`;
}

function renderFailureEmail(dateStr, err) {
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 24px;background:${BRAND.cream};font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;">
    <p style="margin:0 0 1.5em;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.sage};font-family:Arial,sans-serif;">Mindtivate Analytics</p>
    <h1 style="margin:0 0 0.6em;font-size:22px;color:${BRAND.plum};">Daily digest failed — ${dateStr}</h1>
    <p style="font-family:Arial,sans-serif;font-size:15px;color:${BRAND.plum};">Couldn't fetch Cloudflare Web Analytics today:</p>
    <pre style="white-space:pre-wrap;background:#ffffff;padding:1em;border-radius:8px;font-size:13px;color:${BRAND.plum};">${String(err.message).slice(0, 2000)}</pre>
  </div>
</body></html>`;
  const text = `Mindtivate Analytics — Daily digest failed — ${dateStr}\n\nCouldn't fetch Cloudflare Web Analytics today:\n${err.message}`;
  return { html, text };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dateStr = args.date || defaultDigestDate();
  const to = process.env.ANALYTICS_DIGEST_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!to) {
    console.error('Missing required env var: ANALYTICS_DIGEST_EMAIL');
    process.exitCode = 1;
    return;
  }
  if (!from) {
    console.error('Missing required env var: RESEND_FROM_EMAIL');
    process.exitCode = 1;
    return;
  }

  try {
    const { since, until } = dayWindow(dateStr);
    console.log(`Fetching Cloudflare Web Analytics for ${dateStr} (${since} to ${until})...`);
    const stats = await fetchDailyStats({ since, until });

    console.log(`Visits: ${stats.visits}, page views: ${stats.pageviews}`);
    await sendEmail({
      to,
      from,
      subject: `Mindtivate analytics — ${dateStr} (${stats.visits} visits)`,
      html: renderHtml({ dateStr, stats }),
      text: renderText({ dateStr, stats }),
    });
    console.log(`Sent digest to ${to}.`);
  } catch (err) {
    console.error(`Digest failed: ${err.message}`);
    try {
      const { html, text } = renderFailureEmail(dateStr, err);
      await sendEmail({ to, from, subject: `Mindtivate analytics — ${dateStr} — digest FAILED`, html, text });
      console.log(`Sent failure notice to ${to}.`);
    } catch (sendErr) {
      console.error(`Also failed to send the failure notice: ${sendErr.message}`);
    }
    process.exitCode = 1;
  }
}

run();
