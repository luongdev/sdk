import type { Config, User } from '@api/types/types.ts';
import type { ConnectionDelegate } from '@api/types/connections.ts';
import { Registerer, type RegistererOptions, URI, UserAgent, type UserAgentOptions } from 'sip.js';
import { v7 as uuid } from 'uuid';
import type { IncomingResponse } from 'sip.js/lib/core';

export const ErrConnection = new Error('Connection error');
export const ErrTimeout = new Error('Connect timeout');
export const ErrForbidden = new Error('Forbidden');

class UABuilder {
  private readonly _domain: string;
  private readonly _config: UserAgentOptions;

  private _uri: URI | undefined;
  private _gateways: string[] = [];
  private _expires = 20;
  private _headers = new Map<string, any>();

  private _ua?: UserAgent;

  private constructor(domain: string) {
    this._domain = domain;
    this._uri = new URI('sip', 'websdk', domain);

    const uid = uuid();

    this._config = {
      noAnswerTimeout: 10,
      forceRport: true,
      gracefulShutdown: true,
      userAgentString: 'VoiceSDK',
      viaHost: domain,
      uri: this._uri,
      sipjsId: uid,
      instanceId: uid,
      transportOptions: {
        server: '',
        connectionTimeout: 5,
        keepAliveInterval: 10,
        traceSip: false,
      },
      delegate: {},
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

  withDebug(debug?: boolean): UABuilder {
    this._config.logLevel = debug ? 'debug' : 'error';
    return this;
  }

  setExpires(expires: number): UABuilder {
    this._expires = expires;
    return this;
  }

  setHeader(name: string, value: any): UABuilder {
    this._headers.set(name, value);
    return this;
  }

  build(): UserAgent {
    if (this._ua) return this._ua;

    if (!this._gateways.length) throw new Error('Missing required gateways');

    (this._config.transportOptions as any).server = this._gateways[0];

    this._ua = new UserAgent(this._config);

    return this._ua;
  }

  registerer(user: User): Registerer {
    if (!this._ua) throw ErrConnection;

    this._ua.contact.uri.user = user.extension;
    this._ua.configuration.uri.user = user.extension;
    this._ua.configuration.authorizationUsername = user.extension;
    this._ua.configuration.authorizationPassword = user.password;

    const registerOpts: RegistererOptions = {
      refreshFrequency: 90,
      expires: this._expires,
      extraHeaders: Array.from(this._headers.entries()).map(([name, value]) => `${name}: ${value}`),
    };

    (registerOpts as any).params = { callId: uuid() };

    return new Registerer(this._ua, registerOpts);
  }
}

export class Signaling {
  private _ua?: UserAgent;
  private _registerer?: Registerer;

  private readonly _timeout: number;
  private readonly _delegate: ConnectionDelegate | undefined;
  private readonly _uaBuilder: UABuilder;

  // private readonly _sessionHandlers: Array<(evt: RTCSessionEvent) => Promise<any>> = [];

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

    this._uaBuilder = UABuilder.new(appName).withDebug(debug);

    this._timeout = timeout;
    this._delegate = delegate;

    gateways?.forEach(g => this._uaBuilder.setGateway(g));
  }

  async login(user: User): Promise<boolean> {
    if (!this._ua || !this._connected) throw ErrConnection;

    return await new Promise<boolean>((resolve, reject) => {
      this._registerer = this._uaBuilder.registerer(user);

      let timeoutId: number | undefined;
      this._registerer
        .register({
          requestDelegate: {
            onProgress: () => {
              timeoutId = setTimeout(() => reject(ErrTimeout), this._timeout);
              this._registered = false;
            },
            onAccept: () => {
              Promise.resolve()
                .then(() => {
                  clearTimeout(timeoutId);
                  this._registered = true;
                })
                .then(this._bindRegisteredEvents.bind(this));

              resolve(true);
            },
            onReject: ({ message: { statusCode, reasonPhrase } }) => {
              Promise.resolve()
                .then(() => {
                  clearTimeout(timeoutId);
                  this._registered = false;
                })
                .then(() => this._delegate?.onDisconnect?.(true, statusCode, reasonPhrase));

              reject(ErrForbidden);
            },
          },
        })
        .catch(reject);
    });
  }

  async connect(): Promise<boolean> {
    if (this._ua && this._connected) return this._connected;

    return await new Promise<boolean>((resolve, reject) => {
      this._ua = this._uaBuilder.build();
      const timeoutId = setTimeout(() => reject(ErrTimeout), this._timeout);
      if (this._ua.delegate) {
        this._ua.delegate.onConnect = async () => {
          clearTimeout(timeoutId);
          this._connected = true;
          this._registered = false;

          Promise.resolve()
            .then(() => {
              this._connected = true;
              this._registered = false;
            })
            .then(this._delegate?.onConnect)
            .catch(console.error);

          resolve(true);
        };

        this._ua.delegate.onDisconnect = err => {
          clearTimeout(timeoutId);

          console.log(err);

          Promise.resolve()
            .then(() => {
              this._connected = false;
              this._registered = false;
            })
            .then(() => this._delegate?.onDisconnect?.(!!err));

          reject(err);
        };
      }

      this._ua?.start().catch(reject);
    });
    // this._ua.on('disconnected', ({ error, code, reason }) => {
    //   Promise.resolve().then(() => this._delegate?.onDisconnect?.(error, code, reason));
    //
    //   this._connected = false;
    //   this._registered = false;
    // });
    //
    // return await new Promise<boolean>((resolve, reject) => {
    //   let timeoutId: number;
    //
    //   this._ua?.once('connecting', () => {
    //     this._connected = false;
    //     timeoutId = setTimeout(() => reject(ErrTimeout), this._timeout);
    //   });
    //
    //   this._ua?.once('connected', () => {
    //     clearTimeout(timeoutId);
    //
    //     Promise.resolve().then(() => this._delegate?.onConnect?.());
    //
    //     this._connected = true;
    //     this._registered = false;
    //     resolve(true);
    //   });
    //
    //   this._ua?.start();
    // });
  }

  // registerHandler(handler: (evt: RTCSessionEvent) => Promise<any>) {
  //   this._sessionHandlers.push(handler);
  // }

  private _bindRegisteredEvents() {
    if (!this._ua || !this._registered) return;

    this._registerer?.stateChange.addListener(data => {
      if ('Unregistered' === data) {
        this._registered = false;
      } else if ('Registered' === data) {
        this._registered = true;
      }
    });

    this._ua.delegate = this._ua.delegate || {};
    this._ua.delegate.onInvite = invitation => {
      console.log('day la invitation', invitation);
    };
  }
  //
  // private _unbindRegisteredEvents() {
  //   if (!this._ua || !this._registered) return;
  //
  //   this._ua.removeAllListeners('registrationExpiring');
  //   this._ua.removeAllListeners('unregistered');
  //   this._ua.removeAllListeners('newRTCSession');
  // }
  //
  // private _bindNewRTCSession(evt: RTCSessionEvent) {
  //   if (!evt.session || !evt.originator?.length) {
  //     return;
  //   }
  //
  //   this._sessionHandlers.forEach(h => h(evt).catch(console.error));
  // }
}
