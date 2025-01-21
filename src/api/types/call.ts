import type { RTCSessionEventMap } from 'jssip/lib/RTCSession';

export type Terminator = (cause?: string) => void;
export type Answerer = () => void;
export type Referer = (target: string, opts?: any) => void;

export type CallActors = {
  terminator: Terminator;
  answerer: Answerer;
  referer: Referer;
};

export type CallCreatedListener = (actors: CallActors, params?: Record<string, unknown>) => void;
export type CallConnectedListener = () => void;
export type CallTerminatedListener = (code: number, cause?: string) => void;

export interface CallDelegate {
  callCreated?: CallCreatedListener;
  callConnected?: CallConnectedListener;
  callTerminated?: CallTerminatedListener;

  rtc?: RTCSessionEventMap;
}

export type CallOptions = {
  did?: string;
  delegate?: CallDelegate;
  extraVariables?: Record<string, string>;
};
