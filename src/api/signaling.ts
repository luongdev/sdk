import { debug as sipDebug, UA, URI, Utils, WebSocketInterface } from 'jssip';
import type { Config, User } from '@api/types/types.ts';
import type { CallDelegate } from '@api/types/call.ts';
import type { ConnectionDelegate } from '@api/types/connections.ts';
import type { UAConfiguration } from 'jssip/lib/UA';

export const ErrConnection = new Error('Connection error');
export const ErrTimeout = new Error('Connect timeout');
export const ErrForbidden = new Error('Forbidden');

class UABuilder {
  private readonly _domain: string;
  private readonly _config: UAConfiguration;

  private _uri: URI | undefined;
  private _password: string | undefined;
  private _gateways: string[] = [];
  private _expires = 20;
  private _register = false;
  private _headers = new Map<string, any>();

  private _ua?: UA;

  private constructor(domain: string) {
    this._domain = domain;

    const uriStr = new URI('sip', 'sdk', domain).toString();
    this._config = {
      sockets: [],
      uri: uriStr,
      contact_uri: uriStr,
      register_expires: 20,
      register: false,
      user_agent: 'OmiSDK',
      extra_headers: [],
    };
  }

  static new(appName: string): UABuilder {
    return new UABuilder(appName);
  }

  setGateway(gateway: string): UABuilder {
    if (gateway.startsWith('wss://') || gateway.startsWith('ws://')) {
      this._gateways.push(gateway);
    }

    return this;
  }

  setUser(user: string, password?: string): UABuilder {
    this._uri = new URI('sip', user, this._domain);

    return this.setPassword(password);
  }

  setPassword(password?: string): UABuilder {
    this._password = password;
    return this;
  }

  setExpires(expires: number): UABuilder {
    this._expires = expires;
    return this;
  }

  setRegister(register: boolean): UABuilder {
    this._register = register;
    return this;
  }

  setHeader(name: string, value: any): UABuilder {
    this._headers.set(name, value);
    return this;
  }

  build(): UA {
    if (this._ua) return this._ua;

    if (!this._gateways.length) throw new Error('Missing required gateways');

    if (this._uri) {
      const strUri = this._uri?.toString() ?? '';
      this._config.uri = strUri;
      this._config.contact_uri = strUri;
    }

    this._config.password = this._password;
    this._config.sockets = this._gateways.map(g => new WebSocketInterface(g));
    this._config.register = this._register;
    this._config.register_expires = this._expires;

    this._headers.forEach((k, v) => this._config.extra_headers?.push(`${k}: ${v}`));

    this._ua = new UA(this._config);

    return this._ua;
  }
}

export class Signaling {
  private _ua?: UA;

  private readonly _timeout: number;
  private readonly _delegate: (CallDelegate & ConnectionDelegate) | undefined;
  private readonly _uaBuilder: UABuilder;

  private _connected = false;
  private _registered = false;

  get connected(): boolean {
    return this._connected;
  }

  get registered(): boolean {
    return this._registered;
  }

  constructor(cfg: Config, timeout = 10000) {
    const { gateways, delegate, debug, appName } = cfg || {};

    this._uaBuilder = UABuilder.new(appName);

    this._timeout = timeout;
    this._delegate = delegate;

    if (!debug) sipDebug.disable();
    else sipDebug.enable('JsSIP:*');

    gateways?.forEach(g => this._uaBuilder.setGateway(g));
  }

  async login(user: User): Promise<boolean> {
    if (!this._ua) throw ErrConnection;

    if (!this._forceSetUser(user)) {
      console.error('Failed to set user');
    }

    this._ua.set('authorization_user', user.extension);
    this._ua.set('password', user.password);

    return await new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(ErrTimeout), this._timeout);

      this._ua?.on('registered', () => {
        clearTimeout(timeoutId);
        this._registered = true;
        resolve(true);
      });

      this._ua?.once('registrationFailed', ({ response }) => {
        clearTimeout(timeoutId);
        this._registered = false;
        if (403 === response?.status_code) {
          return reject(ErrForbidden);
        }

        reject(new Error(`Failed to register ${response?.reason_phrase}`));
      });

      this._ua?.register();
    });
  }

  async connect(): Promise<boolean> {
    this._ua = this._uaBuilder.build();
    this._ua.on('disconnected', ({ error, code, reason }) => {
      Promise.resolve().then(() => this._delegate?.onDisconnect?.(error, code, reason));

      this._connected = false;
      this._registered = false;
    });

    return await new Promise<boolean>((resolve, reject) => {
      let timeoutId: number;

      this._ua?.once('connecting', () => {
        this._connected = false;
        timeoutId = setTimeout(() => reject(ErrTimeout), this._timeout);
      });

      this._ua?.once('connected', () => {
        clearTimeout(timeoutId);

        Promise.resolve().then(() => this._delegate?.onConnect?.());

        this._connected = true;
        this._registered = false;
        resolve(true);
      });

      this._ua?.start();
    });
  }

  private _forceSetUser(user: User): boolean {
    try {
      const ua = this._ua as any;

      const callId = Utils.newUUID();
      ua['configuration']['uri']['_user'] = user.extension;
      ua['_contact']['uri']['_user'] = user.extension;
      ua['_registrator']['_call_id'] = callId;
      ua['_registrator']['_contact'] = ua?.contact?.uri?.toString();

      return true;
    } catch (err) {
      console.error(err);
    }

    return false;
  }
}

const s = new Signaling({
  debug: true,
  gateways: ['wss://proxy-dev.metechvn.com:7443'],
  appName: 'voiceuat.metechvn.com',
  appId: '',
  secretKey: '',
  el: '',
});

s.connect().then(async () => {
  await s.login({
    extension: '10000',
    password: 'Abcd@54321',
  });
});
