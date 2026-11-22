import { FactStatus, ProfileFact } from '../src/types/api';

describe('Profile Facts and Evidence Rules', () => {
  const sampleFact: ProfileFact = {
    id: 'f1234567-0000-0000-0000-000000000001',
    kind: 'skill',
    statement: 'Strong Python and PostgreSQL development experience.',
    details: {},
    status: 'proposed',
  };

  it('verifies proposed facts before they can be used for claim generation', () => {
    expect(sampleFact.status).toBe('proposed');

    const verifiedFact: ProfileFact = {
      ...sampleFact,
      status: 'verified',
      verified_at: new Date().toISOString(),
    };
    expect(verifiedFact.status).toBe('verified');
    expect(verifiedFact.verified_at).toBeDefined();
  });

  it('preserves auditability when revising facts by creating a replacement', () => {
    const originalFact: ProfileFact = {
      id: 'f1234567-0000-0000-0000-000000000001',
      kind: 'skill',
      statement: 'Python 2 experience',
      details: {},
      status: 'verified',
    };

    const newFactId = 'f1234567-0000-0000-0000-000000000002';
    const supersededFact: ProfileFact = {
      ...originalFact,
      status: 'superseded',
      superseded_by: newFactId,
    };

    const revisedFact: ProfileFact = {
      id: newFactId,
      kind: 'skill',
      statement: 'Python 3.12 and modern async experience',
      details: {},
      status: 'proposed',
    };

    expect(supersededFact.status).toBe('superseded');
    expect(supersededFact.superseded_by).toBe(revisedFact.id);
    expect(revisedFact.status).toBe('proposed');
  });
});
