'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { requestPasswordResetSchema, type PasswordResetRequested } from '@lunch/shared';
import { ApiError, apiClient } from '@/lib/api.client';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';

export function ForgotPasswordForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const parsed = requestPasswordResetSchema.safeParse({
      identifier: String(formData.get('identifier') ?? ''),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message;
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiClient.post<PasswordResetRequested>(
        '/v1/auth/password-reset/request',
        parsed.data
      );

      // The API answers identically whether or not the account exists, so the
      // next screen says "if an account exists" rather than confirming one does.
      const params = new URLSearchParams({
        identifier: parsed.data.identifier,
        sentTo: result.sentTo,
      });
      // Development convenience: carry the echoed code so the flow can be
      // completed without a mailbox. Absent in production.
      if (result.devCode) params.set('devCode', result.devCode);

      router.push(`/reset-password?${params.toString()}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(err.details).map(([k, v]) => [k, v[0] ?? ''])
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

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        {submitting ? 'Sending…' : 'Send reset code'}
      </Button>
    </form>
  );
}
