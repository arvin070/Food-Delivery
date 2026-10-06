'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { UserRole, registerSchema, type AuthSession } from '@lunch/shared';
import { ApiError, apiClient } from '@/lib/api.client';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';

/** Only the self-service roles. Vendors and riders are provisioned by an admin. */
const ROLE_OPTIONS = [
  { value: UserRole.CUSTOMER, label: 'I am ordering for myself' },
  { value: UserRole.PARENT, label: 'I am a parent ordering for my child' },
  { value: UserRole.STUDENT, label: 'I am a student' },
];

export function RegisterForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();

    const parsed = registerSchema.safeParse({
      fullName: String(formData.get('fullName') ?? ''),
      // Omit rather than send empty strings: the schema treats both as absent,
      // but "at least one of email/phone" only reads correctly when undefined.
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      password: String(formData.get('password') ?? ''),
      role: String(formData.get('role') ?? UserRole.CUSTOMER),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'email';
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const session = await apiClient.post<AuthSession>('/v1/auth/register', parsed.data);
      router.refresh();
      router.replace(session.user.role === UserRole.PARENT ? '/children' : '/meals');
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
        label="Full name"
        name="fullName"
        autoComplete="name"
        autoFocus
        required
        error={fieldErrors['fullName']}
      />

      <SelectField label="I am…" name="role" options={ROLE_OPTIONS} error={fieldErrors['role']} />

      <TextField
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        error={fieldErrors['email']}
        hint="Email or phone — at least one is needed to sign in."
      />

      <TextField
        label="Phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder="+91 98765 43210"
        error={fieldErrors['phone']}
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        error={fieldErrors['password']}
        hint="At least 8 characters, with an uppercase letter and a number."
      />

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        {submitting ? 'Creating your account…' : 'Create account'}
      </Button>
    </form>
  );
}
