export type StatusChangeListener = (status: string, reason?: string) => void;

export interface StatusDelegate {
  onStatus?: StatusChangeListener;
}

export interface Status {
  status: string;
  reason?: string;
}
