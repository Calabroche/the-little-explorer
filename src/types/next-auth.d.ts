/**
 * Augment NextAuth's default Session.user shape with the fields our
 * callbacks attach (user id from the DB row, athlete_id when Strava is
 * linked). This makes `session.user.id` and `session.user.athleteId`
 * type-safe in API routes and server components.
 */

import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id?:         string;
      name?:       string | null;
      email?:      string | null;
      image?:      string | null;
      athleteId?:  number | null;
    };
  }

  interface User {
    id:         string;
    athlete_id?: number | null;
  }
}
