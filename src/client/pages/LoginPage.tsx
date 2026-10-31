import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { AuthLayout } from '../components/shell';
import { Button, Field, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';

// ---------------------------------------------------------------------------
// Turnstile (only rendered when the Worker reports a site key)
// ---------------------------------------------------------------------------

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: { sitekey: string; theme?: 'dark' | 'light' | 'auto'; callback: (token: string) => void },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'cf-turnstile-script';

function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(Boolean(window.turnstile));

  useEffect(() => {
    if (window.turnstile) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const existing = document.getElementById(SCRIPT_ID);

    const handleLoad = () => {
      if (!cancelled) setReady(true);
    };

    if (existing) {
      existing.addEventListener('load', handleLoad);
    } else {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.addEventListener('load', handleLoad);
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      document.getElementById(SCRIPT_ID)?.removeEventListener('load', handleLoad);
    };
  }, []);

  useEffect(() => {
    if (!ready || !container.current || !window.turnstile) return;

    const widgetId = window.turnstile.render(container.current, {
      sitekey: siteKey,
      theme: 'dark',
      callback: (token) => onToken(token),
    });

    return () => window.turnstile?.remove(widgetId);
  }, [ready, siteKey, onToken]);

  return (
    <div className="flex justify-center">
      <div ref={container} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LoginPage() {
  const { needsSetup, login, setup } = useSession();
  const [mode, setMode] = useState<'login' | 'setup'>(needsSetup ? 'setup' : 'login');

  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => setMode(needsSetup ? 'setup' : 'login'), [needsSetup]);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.auth.status();
        setSiteKey(status.turnstileSiteKey);
      } catch {
        // Turnstile is optional; login still works without a site key.
      }
    })();
  }, []);

  const isSetup = mode === 'setup';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    try {
      if (isSetup) {
        await setup({ name, email, password, companyName: companyName || undefined });
      } else {
        await login({ email, password, ...(turnstileToken ? { turnstileToken } : {}) });
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFields(caught.fields);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset]">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold tracking-tight text-ink">
          {isSetup ? 'Set up your workspace' : 'Welcome back'}
        </h1>
        <p className="mt-1 text-xs text-muted">
          {isSetup
            ? 'Create the owner account. You can add finance users later.'
            : 'Sign in to see your productions, costs and margins.'}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3.5">
        {isSetup ? (
          <>
            <Field label="Your name" error={fields.name} htmlFor="name">
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Obi"
                autoComplete="name"
                required
                invalid={Boolean(fields.name)}
              />
            </Field>
            <Field label="Company name" hint="Shown on quotations." error={fields.companyName} htmlFor="company">
              <Input
                id="company"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="ProductionDesk Studios"
                autoComplete="organization"
              />
            </Field>
          </>
        ) : null}

        <Field label="Email" error={fields.email} htmlFor="email">
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@studio.com"
            autoComplete="email"
            required
            invalid={Boolean(fields.email)}
          />
        </Field>

        <Field
          label="Password"
          error={fields.password}
          hint={isSetup ? 'At least 10 characters.' : undefined}
          htmlFor="password"
        >
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            required
            invalid={Boolean(fields.password)}
          />
        </Field>

        {!isSetup && siteKey ? <Turnstile siteKey={siteKey} onToken={setTurnstileToken} /> : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {isSetup ? 'Create workspace' : 'Log in'}
        </Button>
      </form>

      {needsSetup ? null : (
        <p className="mt-4 text-center text-[11px] text-faint">
          {isSetup ? 'Already set up?' : 'First time here?'}{' '}
          <button
            type="button"
            onClick={() => setMode(isSetup ? 'login' : 'setup')}
            className="text-accent hover:underline"
          >
            {isSetup ? 'Log in' : 'Set up the workspace'}
          </button>
        </p>
      )}
    </AuthLayout>
  );
}
