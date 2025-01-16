import type { Config, User } from '@api/types/types.ts';
import type { ConnectOptions } from '@api/types/connections.ts';
import { UA, URI, WebSocketInterface } from 'jssip';
import type { CallOptions } from '@api/types/call.ts';

export default class VoiceSDK {
  private static _instance: VoiceSDK;

  private readonly _config: Config;
  private _ua?: UA;

  private readonly _timeout = 10000;

  get isConnected(): boolean {
    return !!this._ua?.isConnected();
  }

  private constructor(cfg: Config) {
    this._config = cfg;

    if (!cfg.baseUrl) {
      this._config.baseUrl = 'https://connect.omicx.vn';
    }
  }

  public static async init(cfg: Config, cb?: (instance: VoiceSDK) => void) {
    if (VoiceSDK._instance) return;

    const instance = new VoiceSDK(cfg);
    if (cfg.autoConnect && cfg.user) {
      await instance.connect(cfg.user);
    }

    VoiceSDK._instance = instance;
    if (cb) {
      await Promise.resolve().then(() => cb(instance));
    }
  }

  public async connect(user: User, opts?: ConnectOptions): Promise<boolean> {
    if (!this._config) {
      throw new Error('Missing required configuration');
    }
    if (this.isConnected) return this.isConnected;

    this._config.delegate = this._config.delegate || {};
    if (opts?.delegate?.onConnect) {
      this._config.delegate.onConnect = opts.delegate.onConnect;
    }
    if (opts?.delegate?.onDisconnect) {
      this._config.delegate.onDisconnect = opts.delegate.onDisconnect;
    }

    this._ua = await this._setup(user);
    if (!this._ua) {
      throw new Error(`Failed to setup VoiceSDK`);
    }

    return this.isConnected;
  }

  public disconnect() {
    if (!this._ua || !this.isConnected) return;

    this._ua.unregister();
    this._ua.stop();
  }

  public async makeCall(dest: string, opts: CallOptions) {
    console.log(dest, opts);
  }

  private async _setup(user: User): Promise<UA> {
    const { password, gateways, extension } = user ?? {};
    const sockets =
      gateways?.filter(g => g?.startsWith('wss://') || g?.startsWith('ws://'))?.map(g => new WebSocketInterface(g)) ??
      [];

    const uri = new URI('sip', extension!, this._config.appName).toString();
    const ua = new UA({
      sockets,
      password,
      uri,
      contact_uri: uri,
      user_agent: 'Voice-SDK',
      register: this._config.autoConnect,
      register_expires: this._timeout,
    });

    return new Promise((resolve, reject) => {
      let timeout: number;

      const onConnect = this._config.delegate?.onConnect;
      const onDisconnect = this._config.delegate?.onDisconnect;

      ua.on('connecting', () => {
        timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, this._timeout);
      });

      ua.on('connected', () => {
        Promise.resolve()
          .then(() => clearTimeout(timeout))
          .then(onConnect)
          .catch(console.error);
        resolve(ua);
      });

      ua.on('disconnected', ({ error, code, reason }) => {
        Promise.resolve()
          .then(() => clearTimeout(timeout))
          .then(() => onDisconnect?.(error, code, reason))
          .catch(console.error);
      });

      ua.start();
    });
  }

  // private async _fetchExtension(username: string): Promise<User> {
  //   try {
  //     const data = await fetch(`${this._config.baseUrl}/api/v2/user/${username}?c=${this._config.appId}`, {
  //       method: 'GET',
  //       headers: {
  //         'Content-Type': 'application/json',
  //         Origin: window.location.origin,
  //       },
  //     }).then(res => res.json());
  //
  //     return {
  //       username: data.username,
  //       extension: data.extension,
  //       password: data.password,
  //     };
  //   } catch (e) {
  //     console.error(new Error(`Failed to fetch extension for ${username}`), e);
  //     throw e;
  //   }
  // }
}

if (window.VoiceSDK === undefined || !window.VoiceSDK) {
  window.VoiceSDK = VoiceSDK;
}
