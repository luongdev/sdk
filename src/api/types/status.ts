export type StatusChangeListener = (status: string, reason?: string) => void;

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

export interface StatusConfig {
  id: number;
  statusName: string;
  stateName: string;
}

export interface StatusConfigResponse {
  success: boolean;
  data?: StatusConfig[];
  error?: string;
}

export interface ReasonStatus {
  reasonCodeId: number;
  reasonCode: string;
  reasonName: string;
}

export interface ReasonStatusResponse {
  success: boolean;
  data?: ReasonStatus[];
  error?: string;
}

export type SetAgentStatusOptions = Status;

export enum StatusEvent {
  REQUEST_STATUS_CHANGE = 'request-status-change',
  STATUS_CHANGED = 'status-changed',
  REQUEST_STATUS_CONFIG = 'request-status-config',
  REQUEST_REASON_STATUS = 'request-reason-status',
}
