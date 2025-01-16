import type { RTCSessionEventMap } from 'jssip/lib/RTCSession';

export type CallListener = (caller: string, callee: string, params?: Record<string, unknown>) => void;

export interface CallDelegate {
  onCall?: CallListener;
  rtc?: RTCSessionEventMap;
}

export type CallOptions = {
  delegate?: CallDelegate;
  extraVariables?: Record<string, string>;
};
