export type ConnectListener = () => void;
export type DisconnectListener = (error: boolean, code?: number, reason?: string) => void;

export interface ConnectionDelegate {
  onConnect?: ConnectListener;
  onDisconnect?: DisconnectListener;
}

export type ConnectOptions = {
  delegate?: ConnectionDelegate;
};
