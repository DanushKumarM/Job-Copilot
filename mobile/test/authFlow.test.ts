import { getSessionToken, setSessionToken, removeSessionToken } from '../src/utils/secureStore';

describe('SecureStore Session Management', () => {
  beforeEach(async () => {
    await removeSessionToken();
  });

  it('stores and retrieves session token without exposing credentials', async () => {
    expect(await getSessionToken()).toBeNull();

    await setSessionToken('mobile_opaque_bearer_token_12345');
    const retrieved = await getSessionToken();
    expect(retrieved).toBe('mobile_opaque_bearer_token_12345');

    await removeSessionToken();
    expect(await getSessionToken()).toBeNull();
  });
});
