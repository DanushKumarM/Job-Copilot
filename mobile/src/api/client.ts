import { getSessionToken, removeSessionToken } from '../utils/secureStore';
import {
  ApplicationDetail,
  AppStatus,
  AuthOut,
  DashboardSummary,
  FactKind,
  FactStatus,
  FunnelInsights,
  InboundMessage,
  InboxStatus,
  JobDetail,
  JobSummary,
  ProfileFact,
  SourceOut,
  UUID,
} from '../types/api';

const DEFAULT_API_URL = 'http://10.0.2.2:8000';
const DEFAULT_TIMEOUT_MS = 15000;

export function getBaseApiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;
  return url.replace(/\/+$/, '');
}

export class ApiError extends Error {
  status: number;
  issues?: string[];
  isAuthExpired: boolean;
  isConflict: boolean;
  isNetworkError: boolean;
  rawDetail?: any;

  constructor(message: string, status: number, options?: { issues?: string[]; rawDetail?: any; isNetwork?: boolean }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = options?.issues;
    this.rawDetail = options?.rawDetail;
    this.isNetworkError = !!options?.isNetwork;
    this.isAuthExpired = status === 401;
    this.isConflict = status === 409;
  }
}

let onAuthExpiredCallback: (() => void) | null = null;

export function setOnAuthExpired(callback: () => void) {
  onAuthExpiredCallback = callback;
}

export async function notifyAuthExpired() {
  await removeSessionToken();
  if (onAuthExpiredCallback) {
    onAuthExpiredCallback();
  }
}

export function shouldClearStoredSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function formatErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.issues && err.issues.length > 0) {
      return `${err.message}: ${err.issues.join(', ')}`;
    }
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'An unexpected error occurred.';
}

export async function apiRequest<T>(
  method: string,
  endpoint: string,
  body?: any,
  customHeaders?: Record<string, string>
): Promise<T> {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const token = await getSessionToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...customHeaders,
  };

  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 204) {
      return {} as T;
    }

    let json: any = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      json = await res.json().catch(() => null);
    } else {
      const text = await res.text().catch(() => '');
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { detail: text };
        }
      }
    }

    if (!res.ok) {
      let message = `Request failed with status ${res.status}`;
      let issues: string[] | undefined;

      if (json) {
        if (typeof json.detail === 'string') {
          message = json.detail;
        } else if (Array.isArray(json.detail)) {
          message = json.detail.map((d: any) => `${d.loc?.join('.') || 'field'}: ${d.msg}`).join('; ');
        }
        if (Array.isArray(json.issues)) {
          issues = json.issues;
        }
      }

      if (res.status === 401) {
        await removeSessionToken();
        if (onAuthExpiredCallback) {
          onAuthExpiredCallback();
        }
      }

      throw new ApiError(message, res.status, { issues, rawDetail: json });
    }

    return json as T;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) {
      throw error;
    }
    if (error.name === 'AbortError') {
      throw new ApiError('Request timed out. Please check your connection and retry.', 0, { isNetwork: true });
    }
    throw new ApiError(error.message || 'Network error: could not connect to server.', 0, { isNetwork: true });
  }
}

export const api = {
  // Auth
  auth: {
    register: (body: { email: string; password: string }) =>
      apiRequest<AuthOut>('POST', '/auth/register', body),
    login: (body: { email: string; password: string }) =>
      apiRequest<AuthOut>('POST', '/auth/login', body),
    logout: () => apiRequest<void>('POST', '/auth/logout'),
    me: () => apiRequest<AuthOut>('GET', '/auth/me'),
  },

  // Profile
  profile: {
    getFacts: () => apiRequest<ProfileFact[]>('GET', '/profile/facts'),
    importResumeText: (text: string, fileName = 'resume.txt') =>
      apiRequest<ProfileFact[]>('POST', '/profile/resume', { text, file_name: fileName }),
    uploadResumeFile: async (fileUri: string, fileName: string, mimeType = 'application/pdf') => {
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        name: fileName,
        type: mimeType,
      } as any);
      return apiRequest<ProfileFact[]>('POST', '/profile/resume/upload', formData);
    },
    addFact: (body: { kind: FactKind; statement: string; details?: Record<string, any> }) =>
      apiRequest<ProfileFact>('POST', '/profile/facts', body),
    verifyFact: (factId: UUID) =>
      apiRequest<ProfileFact>('POST', `/profile/facts/${factId}/verify`),
    rejectFact: (factId: UUID) =>
      apiRequest<ProfileFact>('POST', `/profile/facts/${factId}/reject`),
    reviseFact: (factId: UUID, statement: string) =>
      apiRequest<ProfileFact>('POST', `/profile/facts/${factId}/revise`, { statement }),
    getPreferences: () =>
      apiRequest<Record<string, any>>('GET', '/profile/preferences'),
    updatePreferences: (preferences: Record<string, any>) =>
      apiRequest<Record<string, any>>('PUT', '/profile/preferences', preferences),
    getAnswers: () =>
      apiRequest<Record<string, { question: string; answer: string }>>('GET', '/profile/answers'),
    updateAnswer: (key: string, body: { question: string; answer: string }) =>
      apiRequest<{ question: string; answer: string }>('PUT', `/profile/answers/${key}`, body),
  },

  // Jobs
  jobs: {
    list: (params?: { search?: string; status?: string }) => {
      const q = new URLSearchParams();
      if (params?.search) q.append('search', params.search);
      if (params?.status) q.append('status', params.status);
      const qs = q.toString() ? `?${q.toString()}` : '';
      return apiRequest<JobSummary[]>('GET', `/jobs${qs}`);
    },
    create: (body: {
      title: string;
      company: string;
      location?: string;
      work_mode?: string;
      posting_url?: string;
      description?: string;
    }) => apiRequest<JobDetail>('POST', '/jobs', body),
    get: (id: UUID) => apiRequest<JobDetail>('GET', `/jobs/${id}`),
    evaluate: (id: UUID) => apiRequest<JobDetail>('POST', `/jobs/${id}/evaluate`),
    extract: (id: UUID) => apiRequest<JobDetail>('POST', `/jobs/${id}/extract`),
    createApplication: (id: UUID) =>
      apiRequest<{ id: UUID; status: AppStatus }>('POST', `/jobs/${id}/application`),
  },

  // Applications
  applications: {
    list: () => apiRequest<ApplicationDetail[]>('GET', '/applications'),
    get: (id: UUID) => apiRequest<ApplicationDetail>('GET', `/applications/${id}`),
    generateDocument: (appId: UUID, kind: 'resume' | 'summary' | 'answers' | 'cover_letter') =>
      apiRequest<any>('POST', `/applications/${appId}/generate`, { kind }),
    saveDocument: (appId: UUID, kind: string, claims: any[]) =>
      apiRequest<any>('PUT', `/applications/${appId}/documents/${kind}`, { claims }),
    approve: (appId: UUID, lockVersion: number) =>
      apiRequest<ApplicationDetail>('POST', `/applications/${appId}/approve`, { lock_version: lockVersion }),
    transition: (appId: UUID, target: AppStatus, lockVersion: number, note?: string) =>
      apiRequest<ApplicationDetail>('POST', `/applications/${appId}/transition`, {
        target,
        lock_version: lockVersion,
        note,
      }),
    getResumePdfUrl: (appId: UUID) => `${getBaseApiUrl()}/api/applications/${appId}/resume.pdf`,
    getAnswersPdfUrl: (appId: UUID) => `${getBaseApiUrl()}/api/applications/${appId}/answers.pdf`,
  },

  // Inbox
  inbox: {
    getStatus: () => apiRequest<InboxStatus>('GET', '/inbox/status'),
    sync: () => apiRequest<{ fetched: number; skipped_known: number }>('POST', '/inbox/sync'),
    list: () => apiRequest<InboundMessage[]>('GET', '/inbox'),
    assign: (messageId: UUID, applicationId: UUID, correctedClass?: string) =>
      apiRequest<void>('POST', `/inbox/${messageId}/assign`, {
        application_id: applicationId,
        corrected_classification: correctedClass,
      }),
    import: (messageId: UUID, body: { company: string; title: string; location?: string }) =>
      apiRequest<ApplicationDetail>('POST', `/inbox/${messageId}/import`, body),
    dismiss: (messageId: UUID) => apiRequest<void>('POST', `/inbox/${messageId}/dismiss`),
  },

  // Sources
  sources: {
    list: () => apiRequest<SourceOut[]>('GET', '/sources'),
    create: (body: { kind: 'greenhouse' | 'lever'; config: Record<string, any> }) =>
      apiRequest<SourceOut>('POST', '/sources', body),
    poll: (sourceId: UUID) => apiRequest<any>('POST', `/sources/${sourceId}/poll`),
  },

  // Analytics & Dashboard
  analytics: {
    getFunnel: () => apiRequest<FunnelInsights>('GET', '/analytics/funnel'),
  },

  // Health
  health: () => {
    const baseUrl = getBaseApiUrl();
    return fetch(`${baseUrl}/healthz`).then((r) => r.json());
  },
};
