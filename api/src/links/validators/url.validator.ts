import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

export function validateDestinationUrl(val: unknown): { valid: boolean; message?: string } {
  if (typeof val !== 'string') {
    return { valid: false, message: 'long_url must be a string' };
  }

  // 1. Trim check: reject leading or trailing whitespace
  if (val !== val.trim()) {
    return { valid: false, message: 'long_url must not contain leading or trailing whitespace' };
  }

  // 2. Reject control characters (ASCII 0-31 and 127) including \n, \r, \t, etc.
  if (/[\x00-\x1F\x7F]/.test(val)) {
    return { valid: false, message: 'long_url must not contain control characters' };
  }

  // 3. Reject scheme-relative URLs (starting with //)
  if (val.startsWith('//')) {
    return { valid: false, message: 'Scheme-relative URLs (starting with //) are not allowed' };
  }

  // 4. Reject backslashes anywhere in the scheme or authority
  if (val.includes('\\')) {
    return { valid: false, message: 'Backslashes are not allowed in destination URLs' };
  }

  // 5. Reject URL-encoded characters in the scheme or authority separator (%2f, %3a, etc.)
  const schemeMatch = val.match(/^([a-zA-Z0-9+.-]+)(:|%3A)/i);
  if (!schemeMatch) {
    return { valid: false, message: 'URL must have a valid scheme' };
  }
  if (schemeMatch[2].toLowerCase() === '%3a') {
    return { valid: false, message: 'URL scheme delimiter must not be percent-encoded' };
  }

  const rawScheme = schemeMatch[1].toLowerCase();
  if (rawScheme !== 'http' && rawScheme !== 'https') {
    return { valid: false, message: `URL scheme '${rawScheme}' is not allowed. Only http and https are permitted` };
  }

  // Must strictly start with http:// or https:// (case-insensitive)
  if (!/^https?:\/\//i.test(val)) {
    return { valid: false, message: 'URL must start with http:// or https://' };
  }

  // 6. Reject userinfo trick (e.g. https://good.com@evil.example.com)
  const afterScheme = val.slice(val.indexOf('://') + 3);
  const hostPart = afterScheme.split('/')[0].split('?')[0].split('#')[0];
  if (hostPart.includes('@')) {
    return { valid: false, message: 'Userinfo credentials (@) are not allowed in destination URLs' };
  }

  // 7. Parse with Node's WHATWG URL parser
  let parsed: URL;
  try {
    parsed = new URL(val);
  } catch (err) {
    return { valid: false, message: 'Invalid URL structure' };
  }

  // Re-verify parsed protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, message: 'Only http: and https: protocols are permitted' };
  }

  // Must have a valid, non-empty hostname
  if (!parsed.hostname || parsed.hostname.length === 0) {
    return { valid: false, message: 'URL must have a valid hostname' };
  }

  // Re-verify username/password are empty
  if (parsed.username || parsed.password) {
    return { valid: false, message: 'Userinfo credentials are not allowed in destination URLs' };
  }

  return { valid: true };
}

@ValidatorConstraint({ name: 'isValidDestinationUrl', async: false })
export class IsValidDestinationUrlConstraint implements ValidatorConstraintInterface {
  private lastError = 'Invalid destination URL';

  validate(value: any, _args: ValidationArguments): boolean {
    const res = validateDestinationUrl(value);
    if (!res.valid) {
      this.lastError = res.message || 'Invalid destination URL';
      return false;
    }
    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return this.lastError;
  }
}

@ValidatorConstraint({ name: 'isFutureDate', async: false })
export class IsFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: any): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string') return false;
    const date = new Date(value);
    if (isNaN(date.getTime())) return false;
    return date.getTime() > Date.now();
  }

  defaultMessage(): string {
    return 'expires_at must be a valid future ISO date string';
  }
}

