import type { RTCSessionEventMap } from 'jssip/lib/RTCSession';

export type CallCreatedListener = (caller: string, callee: string, params?: Record<string, unknown>) => void;
export type CallConnectedListener = (caller: string, callee: string, params?: Record<string, unknown>) => void;
export type CallTerminatedListener = (caller: string, callee: string, params?: Record<string, unknown>) => void;

export interface CallDelegate {
  onCreated?: CallCreatedListener;
  onConnected?: CallConnectedListener;
  onTerminated?: CallTerminatedListener;

  rtc?: RTCSessionEventMap;
}

export type CallOptions = {
  did?: string;
  delegate?: CallDelegate;
  extraVariables?: Record<string, string>;
};
