/// <reference types="astro/client" />

type AuthSession = typeof import('./lib/auth').auth.$Infer.Session;

declare namespace App {
  interface Locals {
    user: AuthSession['user'] | null;
    session: AuthSession['session'] | null;
  }
}
