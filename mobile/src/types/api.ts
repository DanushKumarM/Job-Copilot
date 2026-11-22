export type UUID = string;

export type AppStatus =
  | 'discovered'
  | 'rejected_by_rules'
  | 'shortlisted'
  | 'prepared'
  | 'awaiting_approval'
  | 'approved'
  | 'submission_in_progress'
  | 'submitted_unconfirmed'
  | 'submission_confirmed'
  | 'needs_manual_intervention'
  | 'failed'
  | 'assessment'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export type PipelineStage =
  | 'attention'
  | 'prepare'
  | 'review'
  | 'ready'
  | 'submitted'
  | 'in_process'
  | 'closed';

export const PIPELINE_STAGES: { id: PipelineStage; title: string; statuses: AppStatus[] }[] = [
  {
    id: 'attention',
    title: 'Needs attention',
    statuses: ['needs_manual_intervention', 'failed'],
  },
  {
    id: 'prepare',
    title: 'To prepare',
    statuses: ['shortlisted', 'prepared'],
  },
  {
    id: 'review',
    title: 'To review',
    statuses: ['awaiting_approval'],
  },
  {
    id: 'ready',
    title: 'Ready to apply',
    statuses: ['approved', 'submission_in_progress'],
  },
  {
    id: 'submitted',
    title: 'Submitted',
    statuses: ['submitted_unconfirmed', 'submission_confirmed'],
  },
  {
    id: 'in_process',
    title: 'In process',
    statuses: ['assessment', 'interview'],
  },
  {
    id: 'closed',
    title: 'Closed',
    statuses: ['offer', 'rejected', 'withdrawn'],
  },
];

export function getStageForStatus(status: AppStatus): PipelineStage {
  for (const stage of PIPELINE_STAGES) {
    if (stage.statuses.includes(status)) {
      return stage.id;
    }
  }
  return 'closed';
}

export type FactKind =
  | 'work_experience'
  | 'education'
  | 'skill'
  | 'project'
  | 'certification'
  | 'publication'
  | 'preference';

export type FactStatus = 'proposed' | 'verified' | 'rejected' | 'superseded';

export interface UserOut {
  id: UUID;
  email: string;
}

export interface AuthOut {
  user: UserOut;
  session_token?: string | null;
}

export interface ProfileFact {
  id: UUID;
  kind: FactKind;
  statement: string;
  details: Record<string, any>;
  status: FactStatus;
  superseded_by?: UUID | null;
  verified_at?: string | null;
}

export interface RequirementMatch {
  requirement_id: UUID;
  statement: string;
  importance: string;
  score: number;
  facts: ProfileFact[];
  evidence?: string | null;
  gap?: string | null;
}

export interface JobRequirement {
  id: UUID;
  statement: string;
  importance: string;
  terms: string[];
  min_years?: number | null;
}

export interface JobPosting {
  id: UUID;
  external_id: string;
  url: string;
  company_name: string;
  title: string;
  location?: string | null;
  work_mode: 'onsite' | 'hybrid' | 'remote' | 'unknown';
}

export interface JobSummary {
  id: UUID;
  company_name: string;
  title: string;
  location?: string | null;
  work_mode: string;
  overall_fit: number;
  is_stale: boolean;
  freshness: string;
  posting_url?: string | null;
  application_status?: AppStatus | null;
  created_at?: string;
}

export interface JobDetail extends JobSummary {
  description: string;
  requirements: JobRequirement[];
  matches: RequirementMatch[];
  evaluation?: {
    overall_score: number;
    hard_filter_pass: boolean;
    reasoning?: string;
  };
  application_id?: UUID | null;
}

export interface ClaimDraft {
  id: UUID;
  claim_text: string;
  citation_ids: UUID[];
  is_valid?: boolean;
  issues?: string[];
}

export interface GeneratedDocument {
  id: UUID;
  kind: 'resume' | 'cover_letter' | 'answers';
  claims: ClaimDraft[];
  content?: string | null;
  pdf_path?: string | null;
}

export interface HistoryEvent {
  id: UUID;
  from_status?: AppStatus | null;
  to_status: AppStatus;
  actor: string;
  note?: string | null;
  created_at: string;
}

export interface ApplicationDetail {
  id: UUID;
  job_id: UUID;
  job_title: string;
  company_name: string;
  location?: string | null;
  status: AppStatus;
  fit_score: number;
  lock_version: number;
  allowed_transitions: AppStatus[];
  documents: Record<string, GeneratedDocument>;
  history: HistoryEvent[];
  confirmed_at?: string | null;
}

export interface InboundMessage {
  id: UUID;
  application_id?: UUID | null;
  sender: string;
  subject: string;
  received_at: string;
  classification: 'confirmation' | 'interview' | 'rejection' | 'assessment' | 'other' | 'unrelated';
  confidence: number;
  extracted: {
    company?: string;
    title?: string;
    subject?: string;
    [key: string]: any;
  };
  resolved_at?: string | null;
}

export interface InboxStatus {
  gmail_connected: boolean;
  last_sync_at?: string | null;
  unresolved_count: number;
}

export interface SourceOut {
  id: UUID;
  kind: 'greenhouse' | 'lever';
  config: Record<string, any>;
  access_basis: string;
  health: string;
  last_polled_at?: string | null;
}

export interface FunnelInsights {
  funnel_by_status: Record<string, number>;
  funnel_by_source: Record<string, number>;
  submitted_unconfirmed_count: number;
  llm_call_count: number;
  total_tokens: number;
  total_cost_inr: number;
}

export interface DashboardSummary {
  verified_facts_count: number;
  proposed_facts_count: number;
  jobs_count: number;
  active_applications_count: number;
  applications_needing_review_count: number;
  next_action: string;
}

export interface ApiErrorResponse {
  detail: string | Array<{ loc: (string | number)[]; msg: string; type: string }>;
  issues?: string[];
  error?: string;
}
