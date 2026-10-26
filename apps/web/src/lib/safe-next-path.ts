/** Only local absolute paths may be used after authentication. */
export function safeNextPath(value?: string): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return undefined;
  return value;
}
