// Wires up every newsletter <form data-newsletter-form> on the page to
// POST to /api/subscribe (the Cloudflare Worker route in worker/index.ts)
// via fetch, showing an inline status message instead of navigating away.
// The form still has a real method="post" action="/api/subscribe" as a
// no-JS fallback — see worker/index.ts's redirect branch for that path.
//
// Uses event delegation on `document` rather than attaching a listener to
// each form directly: InlineNewsletter.astro clones a NewsletterBox into
// the article body client-side, after this module may already have run,
// so a form can exist that predates this script's execution.
let initialized = false;

export function initNewsletterForms(): void {
  if (initialized) return;
  initialized = true;

  document.addEventListener('submit', async (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-newsletter-form]');
    if (!form) return;
    event.preventDefault();

    const statusEl = form.parentElement?.querySelector<HTMLElement>('[data-newsletter-status]');
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;

    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = 'Signing up…';
    }

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company: formData.get('company') ?? '' }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (res.ok && data.ok) {
        form.hidden = true;
        if (statusEl) statusEl.textContent = "You're in! Check your inbox to confirm.";
      } else {
        if (statusEl) statusEl.textContent = data.error || 'Something went wrong — please try again.';
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch {
      if (statusEl) statusEl.textContent = 'Something went wrong — please try again.';
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
