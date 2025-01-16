export type CallListener = (caller: string, callee: string, params?: Record<string, unknown>) => void;

export interface CallDelegate {
  onCall?: CallListener;
}

export type CallOptions = {};
