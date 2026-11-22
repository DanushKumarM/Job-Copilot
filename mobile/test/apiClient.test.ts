import { ApiError, formatErrorMessage, shouldClearStoredSession } from '../src/api/client';

describe('ApiError and Error Formatter', () => {
  it('constructs ApiError with status and flags', () => {
    const error401 = new ApiError('Sign in required', 401);
    expect(error401.status).toBe(401);
    expect(error401.isAuthExpired).toBe(true);
    expect(error401.isConflict).toBe(false);
    expect(error401.isNetworkError).toBe(false);

    const error409 = new ApiError('Lock version conflict', 409);
    expect(error409.status).toBe(409);
    expect(error409.isConflict).toBe(true);

    const netErr = new ApiError('Connection lost', 0, { isNetwork: true });
    expect(netErr.isNetworkError).toBe(true);
  });

  it('formats detail with validation issues correctly', () => {
    const errorWithIssues = new ApiError('validation failed', 422, {
      issues: ['claim must cite verified fact', 'citation fact not found'],
    });

    const formatted = formatErrorMessage(errorWithIssues);
    expect(formatted).toContain('validation failed: claim must cite verified fact, citation fact not found');
  });

  it('handles standard Error objects and unknown errors', () => {
    expect(formatErrorMessage(new Error('Network timeout'))).toBe('Network timeout');
    expect(formatErrorMessage('Unknown string failure')).toBe('An unexpected error occurred.');
    expect(formatErrorMessage(null)).toBe('An unexpected error occurred.');
  });

  it('only clears a stored session for 401 auth errors', () => {
    expect(shouldClearStoredSession(new ApiError('Sign in required', 401))).toBe(true);
    expect(shouldClearStoredSession(new ApiError('Connection lost', 0, { isNetwork: true }))).toBe(false);
    expect(shouldClearStoredSession(new ApiError('Server unavailable', 503))).toBe(false);
  });
});
