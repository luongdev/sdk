import type { CallDelegate } from '@api/types/call.ts';
import type { ConnectionDelegate } from '@api/types/connections.ts';
import type { StatusDelegate } from '@api/types/status.ts';

export interface Delegate extends CallDelegate, ConnectionDelegate, StatusDelegate {}

export interface ConnectOptions {
  delegate?: Delegate;
}

export interface Config {
  el: string;
  appId: string;
  appName: string;
  baseUrl?: string;
  appVersion?: string;
  secretKey: string;
  scopes?: string[];
  autoConnect?: boolean;
  delegate?: Delegate;
}

export interface User {
  username: string;
  extension: string;
  password: string;
}
