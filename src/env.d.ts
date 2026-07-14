/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}

type AuthSession = typeof import('./lib/auth').auth.$Infer.Session;

declare namespace App {
  interface Locals {
    user: AuthSession['user'] | null;
    session: AuthSession['session'] | null;
  }
}
