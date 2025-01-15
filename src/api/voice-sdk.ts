import type { Config } from '@api/types/types.ts';
import type { ConnectOptions } from '@api/types/connections.ts';

export default class VoiceSDK {
  private static _instance: VoiceSDK;

  private readonly _config: Config;

  private constructor(cfg: Config) {
    this._config = cfg;
  }

  public static async init(cfg: Config, cb?: (instance: VoiceSDK) => void) {
    if (VoiceSDK._instance) return;

    const instance = new VoiceSDK(cfg);
    if (cfg.autoConnect) {
      await instance.connect();
    }

    VoiceSDK._instance = instance;
    if (cb) {
      await Promise.resolve().then(() => cb(instance));
    }
  }

  public async connect(opts?: ConnectOptions) {
    if (!this._config) {
      throw new Error('Missing required configuration');
    }

    if (this._config.delegate) {
      if (opts?.delegate?.onConnect) {
        this._config.delegate.onConnect = opts.delegate.onConnect;
      }
      if (opts?.delegate?.onDisconnect) {
        this._config.delegate.onDisconnect = opts.delegate.onDisconnect;
      }
    }
  }
}

if (window.VoiceSDK === undefined || !window.VoiceSDK) {
  window.VoiceSDK = VoiceSDK;
}
