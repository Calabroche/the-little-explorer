// Client-side fetch helpers for the social layer. Thin wrappers over the
// /api routes; all same-origin, cookie-authed. Throw on non-2xx so callers
// can surface errors.

import type { FeedItem, Comment, Profile, UserSearchResult, Visibility } from './types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchFeed(source: 'following' | 'mine' = 'following'): Promise<FeedItem[]> {
  return fetch(`/api/feed?source=${source}`, { cache: 'no-store' }).then(r => jsonOrThrow<FeedItem[]>(r));
}

export function fetchProfile(userId: string): Promise<Profile> {
  return fetch(`/api/users/${userId}`, { cache: 'no-store' }).then(r => jsonOrThrow<Profile>(r));
}

export function searchUsers(q: string): Promise<UserSearchResult[]> {
  return fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then(r => jsonOrThrow<UserSearchResult[]>(r));
}

export function fetchConnections(userId: string, type: 'followers' | 'following'): Promise<UserSearchResult[]> {
  return fetch(`/api/users/${userId}/connections?type=${type}`, { cache: 'no-store' }).then(r => jsonOrThrow<UserSearchResult[]>(r));
}

export function likeActivity(id: number): Promise<void> {
  return fetch(`/api/activities/${id}/like`, { method: 'POST' }).then(r => jsonOrThrow(r)).then(() => undefined);
}
export function unlikeActivity(id: number): Promise<void> {
  return fetch(`/api/activities/${id}/like`, { method: 'DELETE' }).then(r => jsonOrThrow(r)).then(() => undefined);
}

export function fetchComments(id: number): Promise<Comment[]> {
  return fetch(`/api/activities/${id}/comments`, { cache: 'no-store' }).then(r => jsonOrThrow<Comment[]>(r));
}
export function postComment(id: number, body: string): Promise<{ comment: Comment }> {
  return fetch(`/api/activities/${id}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
  }).then(r => jsonOrThrow<{ comment: Comment }>(r));
}
export function deleteComment(id: number, commentId: string): Promise<void> {
  return fetch(`/api/activities/${id}/comments`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId }),
  }).then(r => jsonOrThrow(r)).then(() => undefined);
}

export function followUser(userId: string): Promise<void> {
  return fetch(`/api/users/${userId}/follow`, { method: 'POST' }).then(r => jsonOrThrow(r)).then(() => undefined);
}
export function unfollowUser(userId: string): Promise<void> {
  return fetch(`/api/users/${userId}/follow`, { method: 'DELETE' }).then(r => jsonOrThrow(r)).then(() => undefined);
}

export function setVisibility(id: number, visibility: Visibility): Promise<void> {
  return fetch(`/api/activities/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility }),
  }).then(r => jsonOrThrow(r)).then(() => undefined);
}
