import type { CallDelegate } from '@api/types/call.ts';
import type { ConnectionDelegate } from '@api/types/connections.ts';
import type { StatusDelegate } from '@api/types/status.ts';

export type Delegate = CallDelegate & ConnectionDelegate & StatusDelegate;

export interface ConnectOptions {
  delegate?: Delegate;
}

export interface Config {
  el: string;
  appId: string;
  appName: string;
  appVersion?: string;
  secretKey: string;
  scopes?: string[];
}
