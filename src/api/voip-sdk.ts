import { ErrConnection, Signaling } from '@api/signaling.ts';
import { Media } from '@api/media.ts';
import type { Config, SdkResult, User } from '@api/types/types.ts';

export class VoipSDK {
  private readonly _signaling: Signaling;
  private readonly _media: Media;

  private constructor(cfg: Config) {
    this._media = new Media();
    this._signaling = new Signaling(cfg);
  }

  private static _instance: VoipSDK;
  public static async init(cfg: Config, cb?: (instance: VoipSDK) => void) {
    if (VoipSDK._instance) return;

    const instance = new VoipSDK(cfg);
    await instance._media.requestLocal(cfg.deviceId);

    VoipSDK._instance = instance;
    if (cb) {
      await Promise.resolve().then(() => cb(instance));
    }
  }

  public async login(user: User): Promise<SdkResult> {
    try {
      const connected = await this._signaling.connect();
      if (!connected) {
        return { success: false, error: ErrConnection.message };
      }

      return { success: await this._signaling.login(user) };
    } catch (e: any) {
      return { success: false, error: `Login error: ${e.message}` };
    }
  }
}

export default VoipSDK;

VoipSDK.init(
  {
    debug: true,
    gateways: ['wss://proxy-dev.metechvn.com:7443'],
    appName: 'voiceuat.metechvn.com',
    appId: '',
    secretKey: '',
    el: '',
  },
  async cb => {
    await cb.login({
      extension: '10000',
      password: 'Abcd@54321',
    });
  },
).catch(console.error);
