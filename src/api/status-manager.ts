import type { Status, StatusDelegate } from '@api/types/status.ts';
import type { Config } from '@api/types/types.ts';
import { SocketClient } from '@api/socket-client.ts';
import { Broadcaster } from '@api/broadcaster.ts';

export class StatusManager {
  private readonly _socketClient?: SocketClient;
  private readonly _broadcaster: Broadcaster;
  private readonly _delegate?: StatusDelegate;
  private readonly _config: Config;

  private _currentStatus: Status = { status: 'OFFLINE' };

  constructor(config: Config) {
    this._config = config;
    this._delegate = config.delegate;
    this._broadcaster = new Broadcaster();

    if (config.nssUrl) {
      const nssUrl = new URL(config.nssUrl);
      this._socketClient = new SocketClient(nssUrl, config.appId, config.appName, this._broadcaster);

      this._setupBroadcaster();
    }
  }

  private _setupBroadcaster() {
    this._broadcaster.addStateListener(state => {
      if (state.key === 'change-status') {
        const statusData = state.value as Status;
        this._currentStatus = statusData;
        this._delegate?.onStatus?.(statusData.status, statusData.reason);
      }
    });
  }

  public connect(): void {
    if (this._socketClient) {
      this._socketClient.setup();
    }
  }

  public get currentStatus(): Status {
    return this._currentStatus;
  }

  public async changeStatus(status: string, reason?: string): Promise<boolean> {
    if (!this._config.nssUrl || !this._config.appId || !this._config.appName) {
      console.error('Missing required configuration for status change');
      return false;
    }

    try {
      if (!this._socketClient || !this._socketClient.connected) {
        console.error('Socket client not connected');
        return false;
      }

      const statusData = {
        extension: this._config.appId,
        domain: this._config.appName,
        statusName: status,
        reasonName: reason,
        changeTime: Date.now(),
      };

      this._socketClient.emit('request-change-status', statusData);

      return true;
    } catch (error) {
      console.error('Error changing status:', error);
      return false;
    }
  }
}
