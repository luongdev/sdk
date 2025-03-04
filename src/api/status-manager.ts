import type { Status, StatusDelegate } from '@api/types/status.ts';
import { StatusEvent } from '@api/types/status.ts';
import type { Config } from '@api/types/types.ts';
import { SocketClient } from '@api/socket-client.ts';
import { Broadcaster } from '@api/broadcaster.ts';
import { LocalBroadcaster } from '@api/local-broadcaster.ts';
import type { StatusMessage } from '@api/local-broadcaster.ts';
import { v7 as uuidv7 } from 'uuid';

export class StatusManager {
  private readonly _socketClient?: SocketClient;
  private readonly _broadcaster: Broadcaster;
  private readonly _localBroadcaster: LocalBroadcaster;
  private readonly _delegate?: StatusDelegate;
  private readonly _config: Config;

  private _currentStatus: Status = { status: 'OFFLINE' };
  private _pendingStatusChange: { id: string; status: string; reason?: string } | null = null;
  private _unsubscribeLocalEvents?: () => void;
  private _lastStatusTimestamp: number = 0;

  constructor(config: Config) {
    this._config = config;
    this._delegate = config.delegate;
    this._broadcaster = new Broadcaster();
    this._localBroadcaster = new LocalBroadcaster();

    // Thiết lập lắng nghe sự kiện từ các tab khác
    this._setupLocalBroadcaster();

    if (config.nssUrl) {
      const nssUrl = new URL(config.nssUrl);
      this._socketClient = new SocketClient(nssUrl, config.appId, config.appName, this._broadcaster);

      this._setupBroadcaster();
    }
  }

  /**
   * Thiết lập lắng nghe sự kiện từ các tab khác thông qua LocalBroadcaster
   */
  private _setupLocalBroadcaster() {
    // Đăng ký lắng nghe sự kiện thay đổi trạng thái từ các tab khác
    this._unsubscribeLocalEvents = this._localBroadcaster.subscribe(
      StatusEvent.STATUS_CHANGED,
      (message: StatusMessage) => {
        console.log('Received status change from another tab:', message);

        // Kiểm tra timestamp của thông điệp
        if (message.timestamp <= this._lastStatusTimestamp) {
          console.log(
            `Ignoring outdated status message (timestamp ${message.timestamp} <= ${this._lastStatusTimestamp})`,
          );
          return;
        }

        // Cập nhật timestamp mới nhất
        this._lastStatusTimestamp = message.timestamp;

        // Cập nhật trạng thái hiện tại
        this._currentStatus = {
          status: message.status,
          reason: message.reason,
        };

        // Thông báo cho delegate
        this._delegate?.onStatus?.(message.status, message.reason);
      },
    );
  }

  private _setupBroadcaster() {
    this._broadcaster.addStateListener(state => {
      if (state.key === StatusEvent.STATUS_CHANGED) {
        const statusData = state.value as Status;

        // Tạo timestamp mới cho thông điệp từ server
        const newTimestamp = Date.now();

        // Kiểm tra xem đây có phải là phản hồi cho một yêu cầu đang chờ xử lý không
        if (
          this._pendingStatusChange &&
          this._pendingStatusChange.status === statusData.status &&
          this._pendingStatusChange.reason === statusData.reason
        ) {
          // Đây là phản hồi cho yêu cầu của chính client này, không cần gọi lại delegate
          console.log('Received status change confirmation from server, skipping duplicate notification');

          // Cập nhật timestamp mới nhất
          this._lastStatusTimestamp = newTimestamp;

          // Cập nhật trạng thái hiện tại
          this._currentStatus = statusData;

          // Broadcast trạng thái mới đến các tab khác
          this._localBroadcaster.broadcastStatusChange(statusData.status, statusData.reason);

          this._pendingStatusChange = null;
        } else {
          // Kiểm tra timestamp của thông điệp
          if (newTimestamp <= this._lastStatusTimestamp) {
            console.log(
              `Ignoring outdated status message from server (timestamp ${newTimestamp} <= ${this._lastStatusTimestamp})`,
            );
            return;
          }

          // Cập nhật timestamp mới nhất
          this._lastStatusTimestamp = newTimestamp;

          // Cập nhật trạng thái hiện tại
          this._currentStatus = statusData;

          // Đây là thay đổi trạng thái từ nguồn khác, cần thông báo
          this._delegate?.onStatus?.(statusData.status, statusData.reason);

          // Broadcast trạng thái mới đến các tab khác
          this._localBroadcaster.broadcastStatusChange(statusData.status, statusData.reason);
        }
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

      // Tạo ID duy nhất cho yêu cầu thay đổi trạng thái này sử dụng uuid v7
      const changeId = uuidv7();

      // Cập nhật timestamp mới nhất
      this._lastStatusTimestamp = Date.now();

      // Lưu thông tin về yêu cầu đang chờ xử lý
      this._pendingStatusChange = {
        id: changeId,
        status,
        reason,
      };

      // Sử dụng Promise để đợi ack từ server
      return new Promise(resolve => {
        // Cập nhật trạng thái ngay lập tức trên UI (optimistic update)
        const newStatus = { status, reason };
        this._currentStatus = newStatus;
        this._delegate?.onStatus?.(status, reason);

        // Broadcast trạng thái mới đến các tab khác
        this._localBroadcaster.broadcastStatusChange(status, reason);

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

            // Xóa thông tin về yêu cầu đang chờ xử lý vì đã bị từ chối
            this._pendingStatusChange = null;
            resolve(false);
          }
        });

        // Thiết lập timeout để tránh trường hợp yêu cầu không được phản hồi
        setTimeout(() => {
          if (this._pendingStatusChange && this._pendingStatusChange.id === changeId) {
            console.log('Clearing pending status change due to timeout');
            this._pendingStatusChange = null;
          }
        }, 10000); // 10 giây timeout
      });
    } catch (error) {
      console.error('Error changing status:', error);
      this._pendingStatusChange = null;
      return false;
    }
  }

  /**
   * Dọn dẹp tài nguyên khi không cần thiết nữa
   */
  public dispose(): void {
    if (this._unsubscribeLocalEvents) {
      this._unsubscribeLocalEvents();
    }

    this._localBroadcaster.close();
  }
}
