export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

export function requiredText(value: string, field: string): ValidationResult<string> {
  const normalized = value.trim();

  if (!normalized) {
    return { success: false, errors: [`${field} is required`] };
  }

  return { success: true, data: normalized };
}
