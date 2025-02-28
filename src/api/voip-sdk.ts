import { ErrConnection, Signaling } from '@api/signaling.ts';
import { Media } from '@api/media.ts';
import type { Config, SdkResult, User } from '@api/types/types.ts';
import { SessionHandlerFactory } from '@api/session.ts';

export class VoipSDK {
  private readonly _signaling: Signaling;
  private readonly _media: Media;
  private readonly _sessionHandlerFactory: SessionHandlerFactory;

  private constructor(cfg: Config) {
    this._media = new Media();
    this._signaling = new Signaling(cfg);
    this._sessionHandlerFactory = new SessionHandlerFactory(cfg.delegate);
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

    console.log(instance);

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
}

export default VoipSDK;

VoipSDK.init(
  {
    debug: true,
    gateways: ['ws://101.99.20.58:7080'],
    appName: 'voiceuat.metechvn.com',
    appId: '',
    secretKey: '',
    el: '',
  },
  async cb => {
    try {
      await cb.login({
        extension: '10000',
        password: 'Abcd@54321',
      });
    } catch (e: any) {
      console.error(e);
    }
  },
).catch(console.error);
