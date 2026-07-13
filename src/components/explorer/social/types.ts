// Shared types for the social layer (feed cards, profiles, comments).
// Mirrors the API shapes in src/app/api/feed, /api/users, /api/activities/[id].

export type Visibility = 'public' | 'followers' | 'private';

export interface Author {
  id:    string;
  name:  string | null;
  image: string | null;
}

// A feed/profile card. Lightweight — no cross-user power/FTP math.
export interface FeedItem {
  id:            number;
  author:        Author;
  is_mine:       boolean;
  sport:         string;
  title:         string | null;
  date:          string;
  distance_km:   number | null;
  elevation_m:   number | null;
  duration_min:  number | null;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  gps:           [number, number][];
  photo?:        string | null;
  visibility:    Visibility;
  like_count:    number;
  comment_count: number;
  liked_by_me:   boolean;
}

export interface Comment {
  id:         string;
  body:       string;
  created_at: string;
  is_mine:    boolean;
  author:     Author;
}

export interface Profile {
  id:           string;
  name:         string | null;
  image:        string | null;
  bio:          string | null;
  is_me:        boolean;
  is_following: boolean;
  followers:    number;
  following:    number;
  activities:   FeedItem[];
}

export interface UserSearchResult {
  id:           string;
  name:         string | null;
  image:        string | null;
  is_following: boolean;
}
