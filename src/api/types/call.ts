import type { RTCSessionEventMap } from 'jssip/lib/RTCSession';

export type CallCreatedListener = (caller: string, callee: string, params?: Record<string, unknown>) => void;
export type CallConnectedListener = () => void;
export type CallTerminatedListener = () => void;

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
