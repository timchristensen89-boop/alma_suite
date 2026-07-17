/**
 * People API client (read-only).
 *
 * The workforce engine does NOT own person identity — `StaffProfile` stays in
 * the suite (it is referenced by stock invoices, tasks, compliance, etc.). When
 * a workforce table needs a person's name/role/active status, it resolves it
 * here instead of via a cross-database foreign key.
 *
 * Two strategies are on the table (see docs/DOMAIN_MAP.md → "The one hard
 * problem"): (1) ID-as-value + this client to hydrate, or (2) a replicated
 * read-only person mirror kept in sync by events. We start with (1).
 */
import { env } from '../env.js';

export interface Person {
  id: string;
  displayName: string;
  role?: string | null;
  active: boolean;
  venueId?: string | null;
}

export class PeopleClientError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly body?: unknown) {
    super(message);
    this.name = 'PeopleClientError';
  }
}

async function request<T>(path: string, query: Record<string, string | undefined> = {}, authToken?: string): Promise<T> {
  const url = new URL(`${env.peopleApiUrl.replace(/\/$/, '')}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
    }
  }).catch((err) => {
    throw new PeopleClientError(0, `Cannot reach People API at ${env.peopleApiUrl} (${path})`, err);
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new PeopleClientError(res.status, `People API ${res.status} for ${path}`, body);
  return body as T;
}

export const peopleClient = {
  /** Resolve one person by StaffProfile id. */
  getPerson(id: string, authToken?: string) {
    return request<Person>(`/api/staff/${encodeURIComponent(id)}`, {}, authToken);
  },
  /** List people, optionally scoped to a venue — for roster pickers etc. */
  listPeople(params: { venueId?: string } = {}, authToken?: string) {
    return request<Person[]>('/api/staff', { venueId: params.venueId }, authToken);
  }
};

export type PeopleClient = typeof peopleClient;
