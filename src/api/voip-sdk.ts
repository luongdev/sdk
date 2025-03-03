import { ErrConnection, Signaling } from '@api/signaling.ts';
import { Media } from '@api/media.ts';
import type { Config, SdkResult, User } from '@api/types/types.ts';
import type { CallDelegate } from '@api/types/call.ts';
import { CallHandler } from '@api/call/call-handler.ts';

export class VoipSDK {
  private readonly _signaling: Signaling;
  private readonly _media: Media;
  private readonly _callHandler: CallHandler;

  private constructor(cfg: Config) {
    this._media = new Media();
    this._signaling = new Signaling(cfg);
    this._callHandler = new CallHandler(this._media, cfg.appName);

    if (cfg.delegate) {
      this._callHandler.setDelegate(cfg.delegate);
    }

    // Bind call handler to signaling
    this._signaling.setCallHandler(this._callHandler);
  }

  private static _instance: VoipSDK;
  public static async init(cfg: Config, cb?: (instance: VoipSDK) => void) {
    if (VoipSDK._instance) return;

    const instance = new VoipSDK(cfg);
    await instance._media.requestLocal(cfg.deviceId);

    // instance._signaling.registerHandler(async e => {
    //   const handler = instance._sessionHandlerFactory.create();
    //   await handler.handle(e);
    // });

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

    return { success: await this._signaling.login(user) };
  }

  public async makeCall(target: string): Promise<SdkResult> {
    if (!this._signaling.connected || !this._signaling.registered) {
      return { success: false, error: ErrConnection.message };
    }

    try {
      await this._callHandler.makeCall(target);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
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

  public setCallDelegate(delegate: CallDelegate) {
    this._callHandler.setDelegate(delegate);
  }
}

export default VoipSDK;

let count = 0;

VoipSDK.init(
  {
    debug: true,
    gateways: ['ws://101.99.20.58:7080'],
    appName: 'voiceuat.metechvn.com',
    appId: '',
    secretKey: '',
    el: '',
    delegate: {
      callCreated: (actors, params) => {
        console.log('callCreated', actors, params);

        if (count % 2 === 0) {
          setTimeout(() => {
            actors.answerer();
          }, 3000);
        } else {
          actors.terminator();
        }

        count++;
      },
      callConnected: () => {
        console.log('callConnected');
      },
    },
  },
  async cb => {
    try {
      await cb.login({
        extension: '10000',
        password: 'Abcd@54321',
      });
      // cb.makeCall('0817720890');
    } catch (e: any) {
      console.error(e);
    }
  },
).catch(console.error);
