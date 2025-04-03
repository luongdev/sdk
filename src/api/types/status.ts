export type StatusChangeListener = (status: string, reason?: string, countTime?: number) => void;

export interface StatusDelegate {
  statusChanged?: StatusChangeListener;
}

export interface Status {
  status: string;
  reason?: string;
  timestamp?: number;
}

export interface AgentStatusResult {
  success: boolean;
  status?: string;
  reason?: string;
  error?: string;
}

export interface ReasonCode {
  reasonCodeId: number;
  reasonCode: string;
  reasonName: string;
}

export interface ReasonCodeResponse {
  success: boolean;
  data?: ReasonCode[];
  error?: string;
}

export type SetAgentStatusOptions = Status;

export enum StatusEvent {
  REQUEST_STATUS_CHANGE = 'request-status-change',
  STATUS_CHANGED = 'status-changed',
  REQUEST_REASON_STATUS = 'request-reason-status',
}
