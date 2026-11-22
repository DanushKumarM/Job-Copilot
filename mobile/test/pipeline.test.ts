import { AppStatus, PIPELINE_STAGES, getStageForStatus } from '../src/types/api';

describe('Pipeline Status Mapping', () => {
  const allBackendStatuses: AppStatus[] = [
    'discovered',
    'rejected_by_rules',
    'shortlisted',
    'prepared',
    'awaiting_approval',
    'approved',
    'submission_in_progress',
    'submitted_unconfirmed',
    'submission_confirmed',
    'needs_manual_intervention',
    'failed',
    'assessment',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ];

  it('maps every backend status deterministically to a mobile pipeline stage', () => {
    expect(getStageForStatus('needs_manual_intervention')).toBe('attention');
    expect(getStageForStatus('failed')).toBe('attention');

    expect(getStageForStatus('shortlisted')).toBe('prepare');
    expect(getStageForStatus('prepared')).toBe('prepare');

    expect(getStageForStatus('awaiting_approval')).toBe('review');

    expect(getStageForStatus('approved')).toBe('ready');
    expect(getStageForStatus('submission_in_progress')).toBe('ready');

    expect(getStageForStatus('submitted_unconfirmed')).toBe('submitted');
    expect(getStageForStatus('submission_confirmed')).toBe('submitted');

    expect(getStageForStatus('assessment')).toBe('in_process');
    expect(getStageForStatus('interview')).toBe('in_process');

    expect(getStageForStatus('offer')).toBe('closed');
    expect(getStageForStatus('rejected')).toBe('closed');
    expect(getStageForStatus('withdrawn')).toBe('closed');
  });

  it('contains all 7 required stages in correct display order', () => {
    const stageIds = PIPELINE_STAGES.map((s) => s.id);
    expect(stageIds).toEqual([
      'attention',
      'prepare',
      'review',
      'ready',
      'submitted',
      'in_process',
      'closed',
    ]);
  });
});
