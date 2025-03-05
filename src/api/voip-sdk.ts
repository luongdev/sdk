import { ErrConnection, Signaling } from '@api/signaling.ts';
import { Media } from '@api/media.ts';
import type { Config, SdkResult, User } from '@api/types/types.ts';
import type { CallDelegate } from '@api/types/call.ts';
import type { StatusDelegate, AgentStatusResult, SetAgentStatusOptions } from '@api/types/status.ts';
import { CallHandler } from '@api/call/call-handler.ts';
import { StatusManager } from '@api/status-manager.ts';

export class VoipSDK {
  private readonly _signaling: Signaling;
  private readonly _media: Media;
  private readonly _callHandler: CallHandler;
  private _statusManager: StatusManager;

  private constructor(cfg: Config) {
    this._media = new Media();
    this._signaling = new Signaling(cfg);
    this._callHandler = new CallHandler(this._media, cfg.appName, this._signaling);
    this._statusManager = new StatusManager(cfg);

    if (cfg.delegate) {
      this._callHandler.setDelegate(cfg.delegate);

      if (cfg.delegate.onStatus) {
        this.setStatusDelegate(cfg.delegate);
      }
    }
  }

  private static _instance: VoipSDK;
  public static async init(cfg: Config, cb?: (instance: VoipSDK) => void) {
    console.log('VoipSDK.init called with config:', { ...cfg, delegate: 'Delegate object' });

    // Nếu instance đã tồn tại, chỉ cập nhật cấu hình và gọi callback
    if (VoipSDK._instance) {
      console.log('VoipSDK instance already exists, updating configuration');

      // Cập nhật cấu hình cho instance hiện tại
      if (cfg.delegate) {
        if (cfg.delegate.callCreated || cfg.delegate.callConnected || cfg.delegate.callTerminated) {
          VoipSDK._instance._callHandler.setDelegate(cfg.delegate);
        }

        if (cfg.delegate.onStatus) {
          VoipSDK._instance.setStatusDelegate(cfg.delegate);
        }
      }

      if (cb) {
        await Promise.resolve().then(() => cb(VoipSDK._instance));
      }

      return;
    }

    console.log('Creating new VoipSDK instance');
    const instance = new VoipSDK(cfg);
    await instance._media.requestLocal(cfg.deviceId);

    VoipSDK._instance = instance;
    if (cb) {
      await Promise.resolve().then(() => cb(instance));
    }
  }

  public async login(user: User): Promise<SdkResult> {
    const connected = await this._signaling.connect();
    if (!connected) {
      return { success: false, error: ErrConnection.message };
    }

    const loginSuccess = await this._signaling.login(user);
    if (loginSuccess) {
      this._statusManager.connect();
      console.log('Status manager connected after successful login');
    }

    return { success: loginSuccess };
  }

  public async makeCall(target: string): Promise<SdkResult> {
    try {
      if (!this._signaling.isReady()) {
        throw ErrConnection;
      }

      await this._callHandler.makeCall(target);
      return { success: true };
    } catch (error) {
      console.error('Error making call:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async endCall(): Promise<SdkResult> {
    try {
      const result = await this._callHandler.endCurrentCall();
      return { success: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  public resetCallState(): void {
    this._callHandler.resetState();
  }

  public setCallDelegate(delegate: CallDelegate): void {
    this._callHandler.setDelegate(delegate);
  }

  public setStatusDelegate(delegate: StatusDelegate): void {
    const currentConfig = this._statusManager['_config'];
    const updatedConfig = {
      ...currentConfig,
      delegate: {
        ...currentConfig.delegate,
        onStatus: delegate.onStatus,
      },
    };

    this._statusManager = new StatusManager(updatedConfig);

    const currentStatus = this._statusManager.currentStatus;
    if (currentStatus && delegate.onStatus) {
      delegate.onStatus(currentStatus.status, currentStatus.reason);
      console.log('Initial status notification sent to delegate:', currentStatus);
    }

    this._statusManager.connect();
  }

  public async setAgentStatus(options: SetAgentStatusOptions): Promise<SdkResult> {
    try {
      const success = await this._statusManager.changeStatus(options.status, options.reason);
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  public getAgentStatus(): AgentStatusResult {
    try {
      const currentStatus = this._statusManager.currentStatus;
      return {
        success: true,
        status: currentStatus.status,
        reason: currentStatus.reason,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  public async changeStatus(status: string, reason?: string): Promise<SdkResult> {
    return this.setAgentStatus({ status, reason });
  }

  public getCurrentStatus(): string {
    return this._statusManager.currentStatus.status;
  }

  public getBrowserId(): string | undefined {
    return this._statusManager.browserId;
  }

  public dispose(): void {
    this._statusManager.dispose();

    if (this._signaling) {
      console.log('Note: Signaling connection might still be active');
    }

    if (this._callHandler) {
      this._callHandler.resetState();
    }

    console.log('VoipSDK resources disposed');
  }
}

export default VoipSDK;

if (window.VoiceSDK === undefined || !window.VoiceSDK) {
  window.VoiceSDK = VoipSDK;
}

// Xóa phần code test bên dưới để tránh gây nhầm lẫn
// let count = 0;
//
// VoipSDK.init(
//   {
//     // debug: true,
//     gateways: ['ws://101.99.20.58:7080'],
//     appName: 'voiceuat.metechvn.com',
//     appId: '',
//     secretKey: '',
//     el: '',
//     delegate: {
//       callCreated: (actors, params) => {
//         console.log('callCreated', actors, params);
//
//         if (count % 2 === 0) {
//           setTimeout(() => {
//             actors.answerer();
//           }, 3000);
//         } else {
//           actors.terminator();
//         }
//
//         count++;
//       },
//       callConnected: () => {
//         console.log('callConnected');
//       },
//     },
//   },
//   async cb => {
//     try {
//       await cb.login({
//         extension: '10000',
//         password: 'Abcd@54321',
//       });
//       cb.makeCall('20000');
//     } catch (e: any) {
//       console.error(e);
//     }
//   },
// ).catch(console.error);
