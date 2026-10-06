'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { loginSchema, type AuthSession } from '@lunch/shared';
import { ApiError, apiClient } from '@/lib/api.client';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';

export function LoginForm({ nextPath }: { nextPath?: string | undefined }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const raw = {
      identifier: String(formData.get('identifier') ?? ''),
      password: String(formData.get('password') ?? ''),
    };

    // Validate with the same schema the API uses, so obvious mistakes are
    // caught without a round-trip and the messages match exactly.
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const session = await apiClient.post<AuthSession>('/v1/auth/login', parsed.data);
      // Server components read the session from the cookie the API just set, so
      // refresh the router cache before navigating.
      router.refresh();
      router.replace(nextPath && nextPath.startsWith('/') ? nextPath : defaultHome(session));
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(err.details).map(([key, messages]) => [key, messages[0] ?? ''])
          )
        );
        setFormError(Object.keys(err.details).length ? null : err.message);
      } else {
        setFormError('We could not reach the server. Check your connection and try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}

      <TextField
        label="Email or phone"
        name="identifier"
        type="text"
        autoComplete="username"
        autoFocus
        required
        placeholder="you@example.com"
        error={fieldErrors['identifier']}
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors['password']}
      />

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function defaultHome(session: AuthSession): string {
  switch (session.user.role) {
    case 'VENDOR':
      return '/vendor';
    case 'DELIVERY_PARTNER':
      return '/delivery';
    case 'SUPER_ADMIN':
      return '/admin';
    case 'INSTITUTION_ADMIN':
      return '/institution';
    default:
      return '/meals';
  }
}
