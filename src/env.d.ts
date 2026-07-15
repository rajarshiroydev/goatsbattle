/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

declare module 'cloudflare:workers' {
  type SqlValue = ArrayBuffer | string | number | null;

  interface SqlCursor<Row> {
    one(): Row;
    toArray(): Row[];
  }

  interface SqlStorage {
    exec<Row = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): SqlCursor<Row>;
  }

  interface DurableObjectStorage {
    readonly sql: SqlStorage;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number | Date): Promise<void>;
    deleteAlarm(): Promise<void>;
  }

  interface DurableObjectState {
    readonly storage: DurableObjectStorage;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    acceptWebSocket(socket: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    waitUntil(promise: Promise<unknown>): void;
  }

  export abstract class DurableObject<Environment = Cloudflare.Env> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Environment;
    constructor(ctx: DurableObjectState, env: Environment);
  }

  export const env: Cloudflare.Env;
}

type AuthSession = typeof import('./lib/auth').auth.$Infer.Session;

declare namespace App {
  interface Locals {
    user: AuthSession['user'] | null;
    session: AuthSession['session'] | null;
  }
}
