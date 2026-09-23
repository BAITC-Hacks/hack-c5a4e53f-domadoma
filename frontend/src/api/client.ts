import type { CompleteResponse, Employee, ErrorDetail, HrResponse, ImportResponse, Language, ProfileResponse, RecommendationResponse, User } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: ErrorDetail[] = []) { super(message); this.name = 'ApiError'; }
}
export interface ApiClient {
  readonly isMock: boolean;
  login(username: string, password: string): Promise<User>;
  logout(): void;
  me(): Promise<User>;
  profile(id: string): Promise<ProfileResponse>;
  recommendations(id: string, lang: Language): Promise<RecommendationResponse>;
  employees(): Promise<{ employees: Employee[] }>;
  complete(id: string, eventId: string, occurrenceKey: string | null, idempotencyKey: string): Promise<CompleteResponse>;
  overview(): Promise<HrResponse>;
  upload(employees: File, history: File): Promise<ImportResponse>;
}
