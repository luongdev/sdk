export type ConnectListener = () => void;
export type DisconnectListener = (reason?: string) => void;

export interface ConnectionDelegate {
  onConnect?: ConnectListener;
  onDisconnect?: DisconnectListener;
}
