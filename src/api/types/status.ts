export type StatusChangeListener = (status: string, reason?: string) => void;

export interface StatusDelegate {
  onStatus?: StatusChangeListener;
}

export interface Status {
  status: string;
  reason?: string;
}

export interface AgentStatusResult {
  success: boolean;
  status?: string;
  reason?: string;
  error?: string;
}

export type SetAgentStatusOptions = Status;

/**
 * Enum định nghĩa các sự kiện liên quan đến trạng thái agent
 */
export enum StatusEvent {
  // Sự kiện từ client đến server
  REQUEST_STATUS_CHANGE = 'request-status-change',

  // Sự kiện từ server đến client
  STATUS_CHANGED = 'status-changed',
}
