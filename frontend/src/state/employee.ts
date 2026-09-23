import { ApiError, type ApiClient } from '../api/client';
import type { Language, ProfileResponse, Recommendation, RecommendationResponse } from '../api/types';

export interface EmployeeState {
  profile: ProfileResponse | null; recommendations: RecommendationResponse | null;
  loading: boolean; recommendationsLoading: boolean; completing: string | null;
  error: unknown; recommendationError: unknown; completionStatus: 'completed' | 'already_completed' | null;
}
export class EmployeeStore {
  private state: EmployeeState = { profile: null, recommendations: null, loading: false, recommendationsLoading: false, completing: null, error: null, recommendationError: null, completionStatus: null };
  private listeners = new Set<() => void>();
  private loadEpoch = 0;
  private recEpoch = 0;
  private disposed = false;
  private keys = new Map<string, string>();
  constructor(private api: ApiClient, private id: string, private lang: Language, private minRevision = 0) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<EmployeeState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private acceptProfile(profile: ProfileResponse) {
    if (profile.employee?.employee_id !== this.id || !Number.isFinite(profile.state_revision)) throw new ApiError(0, 'invalid_response', 'Profile mismatch');
    if (profile.state_revision < this.minRevision) throw new ApiError(0, 'stale', 'Profile predates import');
    if (profile.state_revision < (this.state.profile?.state_revision ?? -1)) return false;
    this.update({ profile });
    return true;
  }
  async load() {
    if (this.state.completing || this.disposed) return;
    const epoch = ++this.loadEpoch;
    ++this.recEpoch;
    this.update({ loading: true, error: null });
    try {
      const profile = await this.api.profile(this.id);
      if (this.disposed || epoch !== this.loadEpoch) return;
      this.acceptProfile(profile);
      this.update({ loading: false });
      await this.refreshRecommendations();
    } catch (error) {
      if (epoch === this.loadEpoch) this.update({ error, loading: false });
    }
  }
  async refreshRecommendations() {
    if (this.disposed || !this.state.profile || this.state.completing) return;
    const epoch = ++this.recEpoch;
    const lang = this.lang;
    this.update({ recommendations: null, recommendationsLoading: true, recommendationError: null });
    try {
      const response = await this.api.recommendations(this.id, lang);
      if (this.disposed || epoch !== this.recEpoch) return;
      if (response.employee_id !== this.id || response.language !== lang) throw new ApiError(0, 'invalid_response', 'Recommendations mismatch');
      if (response.state_revision > this.state.profile!.state_revision) {
        const profile = await this.api.profile(this.id);
        if (this.disposed || epoch !== this.recEpoch) return;
        this.acceptProfile(profile);
      }
      if (response.state_revision !== this.state.profile!.state_revision) throw new ApiError(0, 'stale', 'Stale recommendations');
      this.update({ recommendations: response, recommendationsLoading: false });
    } catch (error) {
      if (epoch === this.recEpoch) this.update({ recommendationError: error, recommendationsLoading: false });
    }
  }
  async setLanguage(lang: Language) {
    if (this.lang === lang) return;
    this.lang = lang;
    ++this.recEpoch;
    this.update({ recommendations: null });
    await this.refreshRecommendations();
  }
  async complete(event: Recommendation) {
    if (this.disposed || this.state.completing) return;
    const occurrence = event.event_id === 'EV_036' ? event.next_session : null;
    if (event.event_id === 'EV_036' && !occurrence) {
      this.update({ error: new ApiError(422, 'invalid_response', 'Missing recurring session') }); return;
    }
    const operation = event.event_id + ':' + (occurrence ?? 'once');
    const key = this.keys.get(operation) ?? crypto.randomUUID();
    this.keys.set(operation, key);
    ++this.loadEpoch; ++this.recEpoch;
    this.update({ completing: event.event_id, error: null, completionStatus: null, recommendationsLoading: false, loading: false });
    try {
      const result = await this.api.complete(this.id, event.event_id, occurrence, key);
      if (this.disposed) return;
      if (!this.acceptProfile(result.profile)) throw new ApiError(0, 'stale', 'Stale completion');
      this.update({ completing: null, completionStatus: result.status, recommendations: null });
      void this.refreshRecommendations();
    } catch (error) { this.update({ completing: null, error }); }
  }
  dispose() { this.disposed = true; ++this.loadEpoch; ++this.recEpoch; this.listeners.clear(); }
}
