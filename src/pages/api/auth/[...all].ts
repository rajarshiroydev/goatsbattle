import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';

export const prerender = false;

// better-auth owns everything under /api/auth/* (signup, signin, OAuth
// start+callback, get-session, signout). Hand the raw request to its handler.
export const ALL: APIRoute = ({ request }) => auth.handler(request);
