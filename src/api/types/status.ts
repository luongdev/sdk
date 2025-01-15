export type StatusChangeListener = (status: string, reason?: string) => void;

export interface StatusDelegate {
  onStatus?: StatusChangeListener;
}
