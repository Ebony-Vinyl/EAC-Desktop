import type { Context, Volatile } from '@deepseek-ai/cordis'

export interface Config {
  enabled?: boolean
  role?: 'host' | 'client' | 'both'
  serverUrl?: string
  deviceName?: string
  terminal?: { enabled?: boolean }
  loopback?: { ports?: number[] }
  forceRelay?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  reconnect?: boolean | {
    initialDelayMs?: number
    maxDelayMs?: number
    jitter?: number
  }
  codex?: {
    enabled?: boolean
    binary?: string
  }
}

export declare const name: 'ds-harness-remote'
export declare const Config: unknown
export declare function apply(ctx: Context, config?: Config | Volatile<Config>): void
export declare function runCli(args?: readonly string[]): Promise<number>
