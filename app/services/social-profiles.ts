// The list of official profile platforms, and nothing else.
//
// It lives outside business.server.ts because the settings screen renders one
// field per platform, so the component needs the list at runtime. Importing a
// .server module from anything other than a loader or action pulls the whole
// server module into the client bundle, and the Remix build refuses to
// compile - which is exactly what happened when this list was exported from
// business.server.ts.

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "x",
  "pinterest",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialProfiles = Partial<Record<SocialPlatform, string>>;
