'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { confirmPasswordResetSchema } from '@lunch/shared';
import { ApiError, apiClient } from '@/lib/api.client';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';

export function ResetPasswordForm({
  identifier,
  devCode,
}: {
  identifier: string;
  devCode?: string | undefined;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const parsed = confirmPasswordResetSchema.safeParse({
      identifier: String(formData.get('identifier') ?? ''),
      code: String(formData.get('code') ?? ''),
      newPassword: String(formData.get('newPassword') ?? ''),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message;
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post('/v1/auth/password-reset/confirm', parsed.data);
      router.replace('/login?reset=1');
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(
          Object.fromEntries(Object.entries(err.details).map(([k, v]) => [k, v[0] ?? '']))
        );
        // OTP failures carry no field details, so show them at form level.
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

      {devCode && (
        <Alert tone="warning" title="Development mode">
          Your code is <strong>{devCode}</strong>. In production this is sent by email or SMS and
          never returned by the API.
        </Alert>
      )}

      <TextField
        label="Email or phone"
        name="identifier"
        type="text"
        autoComplete="username"
        required
        defaultValue={identifier}
        error={fieldErrors['identifier']}
      />

      <TextField
        label="6-digit code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        autoFocus
        defaultValue={devCode ?? ''}
        placeholder="123456"
        error={fieldErrors['code']}
      />

      <TextField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        error={fieldErrors['newPassword']}
        hint="At least 8 characters, with an uppercase letter and a number."
      />

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        {submitting ? 'Updating…' : 'Set new password'}
      </Button>
    </form>
  );
}
