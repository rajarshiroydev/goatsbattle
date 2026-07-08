import { createAuthClient } from 'better-auth/client';

// No baseURL → the client targets the current origin's /api/auth, which is
// exactly right in the browser (dev + prod). Server-only BETTER_AUTH_URL is not
// exposed to the client bundle, so we deliberately don't reference it here.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, getSession } = authClient;
