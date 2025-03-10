export type Terminator = (cause?: string) => Promise<void>;
export type Answerer = () => Promise<void>;
export type Referer = (target: string, opts?: any) => Promise<void>;

export type CallActors = {
  terminator: Terminator;
  answerer: Answerer;
  referer: Referer;
};

export type CallCreatedListener = (actors: CallActors, params?: Record<string, unknown>) => void;
export type CallConnectedListener = () => void;
export type CallTerminatedListener = (code: number, cause?: string) => void;

import type { RTCDelegate } from './rtc';

export interface CallDelegate {
  callCreated?: CallCreatedListener;
  callConnected?: CallConnectedListener;
  callTerminated?: CallTerminatedListener;
  rtc?: RTCDelegate;
}

export type CallOptions = {
  did?: string;
  maxDuration?: number;
  delegate?: CallDelegate;
  extraVariables?: Record<string, string>;
};

export enum CallDirection {
  Inbound = 'inbound',
  Outbound = 'outbound',
}
