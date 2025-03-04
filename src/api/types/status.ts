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
