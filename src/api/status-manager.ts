import type { Status, StatusDelegate } from '@api/types/status.ts';
import { StatusEvent } from '@api/types/status.ts';
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
      if (state.key === StatusEvent.STATUS_CHANGED) {
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

  /**
   * Thay đổi trạng thái của agent
   * @param status Trạng thái mới
   * @param reason Lý do thay đổi trạng thái (tùy chọn)
   * @returns Promise<boolean>
   */
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

      // Tạo dữ liệu để gửi đến server
      const statusData = {
        extension: this._config.appId,
        domain: this._config.appName,
        statusName: status,
        reasonName: reason,
        changeTime: Date.now(),
      };

      // Sử dụng Promise để đợi ack từ server
      return new Promise(resolve => {
        // Cập nhật trạng thái ngay lập tức trên UI (optimistic update)
        const newStatus = { status, reason };
        this._currentStatus = newStatus;
        this._delegate?.onStatus?.(status, reason);

        // Gửi yêu cầu thay đổi trạng thái đến server với callback ack
        this._socketClient?.emit(StatusEvent.REQUEST_STATUS_CHANGE, statusData, response => {
          if (response && response.success) {
            console.log(`Status change to ${status} acknowledged by server`);
            resolve(true);
          } else {
            console.error(`Status change to ${status} rejected by server:`, response?.error || 'Unknown error');

            // Nếu server từ chối thay đổi, rollback về trạng thái ban đầu
            if (response && !response.success) {
              // Không cần rollback vì server sẽ gửi lại trạng thái hiện tại qua sự kiện STATUS_CHANGED
              console.log('Server will send current status via STATUS_CHANGED event');
            }

            resolve(false);
          }
        });
      });
    } catch (error) {
      console.error('Error changing status:', error);
      return false;
    }
  }
}
