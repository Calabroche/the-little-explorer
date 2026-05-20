/**
 * Admin allowlist.
 *
 * Emails listed here can hit /api/admin/* routes and see the /admin page.
 * Anyone else gets 403. Kept as a hard-coded list (not env var) because:
 *   - The list is tiny (1-2 emails)
 *   - It's part of the security boundary, treating it as code means it
 *     shows up in PR review
 *
 * Add a teammate? Push a PR. Cheap and explicit.
 */

export const ADMIN_EMAILS = new Set<string>([
  'florian.calabrese@gmail.com',
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && ADMIN_EMAILS.has(email));
}
