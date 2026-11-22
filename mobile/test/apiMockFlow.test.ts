import { api, ApiError, setOnAuthExpired } from '../src/api/client';
import { getSessionToken, setSessionToken, removeSessionToken } from '../src/utils/secureStore';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('Mobile App End-to-End API Integration Flows', () => {
  beforeEach(async () => {
    mockFetch.mockReset();
    await removeSessionToken();
  });

  it('performs register and login flow storing the mobile session bearer token', async () => {
    // 1. Register
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({
        user: { id: 'u-1', email: 'mobile@example.com' },
        session_token: 'opaque-session-token-123',
      }),
    });

    const regResponse = await api.auth.register({
      email: 'mobile@example.com',
      password: 'password123',
    });

    expect(regResponse.user.email).toBe('mobile@example.com');
    expect(regResponse.session_token).toBe('opaque-session-token-123');
    await setSessionToken(regResponse.session_token!);
    expect(await getSessionToken()).toBe('opaque-session-token-123');

    // 2. Validate GET /api/auth/me uses Bearer token
    mockFetch.mockImplementationOnce(async (url: string, options: any) => {
      expect(options.headers.Authorization).toBe('Bearer opaque-session-token-123');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          user: { id: 'u-1', email: 'mobile@example.com' },
          session_token: 'opaque-session-token-123',
        }),
      };
    });

    const meResponse = await api.auth.me();
    expect(meResponse.user.id).toBe('u-1');

    // 3. Logout revokes token and removes it from SecureStore
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: { get: () => 'application/json' },
      json: async () => ({}),
    });

    await api.auth.logout();
    await removeSessionToken();
    expect(await getSessionToken()).toBeNull();
  });

  it('triggers onAuthExpired callback and removes token on 401 response', async () => {
    await setSessionToken('expired-token');

    let expiredTriggered = false;
    setOnAuthExpired(() => {
      expiredTriggered = true;
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ detail: 'sign in required' }),
    });

    await expect(api.profile.getFacts()).rejects.toThrow(ApiError);
    expect(expiredTriggered).toBe(true);
    expect(await getSessionToken()).toBeNull();
  });

  it('handles 422 validation failure with structured issues', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      headers: { get: () => 'application/json' },
      json: async () => ({
        detail: 'validation failed',
        issues: ['Claim #1 unsupported by verified facts'],
      }),
    });

    try {
      await api.applications.saveDocument('app-1', 'resume', []);
      fail('Should have thrown 422 ApiError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(422);
      expect(err.issues).toContain('Claim #1 unsupported by verified facts');
    }
  });

  it('handles 409 optimistic locking conflict on transition or approve', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: { get: () => 'application/json' },
      json: async () => ({
        detail: 'application was updated by another process',
        error: 'OptimisticLockError',
      }),
    });

    try {
      await api.applications.approve('app-1', 1);
      fail('Should have thrown 409 ApiError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(409);
      expect(err.isConflict).toBe(true);
    }
  });

  it('supports full job creation and fact verification flow', async () => {
    // Add Job
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        id: 'job-123',
        title: 'Backend Engineer',
        company_name: 'Acme Corp',
        overall_fit: 0.85,
        requirements: [],
        matches: [],
      }),
    });

    const job = await api.jobs.create({
      title: 'Backend Engineer',
      company: 'Acme Corp',
      description: 'Python and PostgreSQL required.',
    });
    expect(job.id).toBe('job-123');
    expect(job.overall_fit).toBe(0.85);

    // Verify Fact
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        id: 'fact-1',
        kind: 'skill',
        statement: 'Python 3',
        status: 'verified',
        verified_at: new Date().toISOString(),
      }),
    });

    const verified = await api.profile.verifyFact('fact-1');
    expect(verified.status).toBe('verified');
  });
});
