import type { Config, User } from '@api/types/types.ts';
import type { ConnectionDelegate } from '@api/types/connections.ts';
import type { SipProvider, CallSessionObserver } from '@api/types/sip.ts';
import {
  Bye,
  Invitation,
  Referral,
  Registerer,
  URI,
  UserAgent,
  type RegistererOptions,
  type UserAgentOptions,
  Inviter,
} from 'sip.js';
import type { CallOptions } from './types/call';
import { v7 as uuid } from 'uuid';

export const ErrConnection = new Error('Connection error');
export const ErrTimeout = new Error('Connect timeout');
export const ErrForbidden = new Error('Forbidden');

class UABuilder {
  private readonly _config: UserAgentOptions;

  private _uri: URI | undefined;
  private _gateways: string[] = [];
  private _expires = 20;
  private _headers = new Map<string, any>();

  private _ua?: UserAgent;

  private constructor(domain: string) {
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

export class Signaling implements SipProvider {
  private _ua?: UserAgent;
  private _registerer?: Registerer;
  private _callSessionObservers: CallSessionObserver[] = [];

  private readonly _timeout: number;
  private readonly _appName: string;
  private readonly _delegate: ConnectionDelegate | undefined;
  private _uaBuilder: UABuilder;

  private _connected = false;
  private _registered = false;

  get connected(): boolean {
    return this._connected;
  }

  get registered(): boolean {
    return this._registered;
  }

  getUserAgent(): UserAgent | undefined {
    return this._ua;
  }

  isReady(): boolean {
    return !!this._ua && this._connected && this._registered;
  }

  createUri(target: string): URI {
    const uri = UserAgent.makeURI(`sip:${target}@${this._appName}`);
    if (!uri) {
      throw new Error(`Failed to create URI for target: ${target}`);
    }
    return uri;
  }

  addCallSessionObserver(observer: CallSessionObserver): void {
    if (!this._callSessionObservers.includes(observer)) {
      this._callSessionObservers.push(observer);
    }
  }

  removeCallSessionObserver(observer: CallSessionObserver): void {
    const index = this._callSessionObservers.indexOf(observer);
    if (index !== -1) {
      this._callSessionObservers.splice(index, 1);
    }
  }

  createOutgoingCall(target: string, options?: CallOptions): Inviter {
    if (!this.isReady()) throw ErrConnection;
    if (this._callSessionObservers.length === 0) throw new Error('No call handler registered');

    const targetUri = this.createUri(target);
    const inviterOptions: any = {};

    // Xử lý headers từ options
    const headers: Record<string, string> = {};

    // Xử lý did
    if (options?.did) {
      headers['X-DID'] = options.did;
    }

    // Xử lý extraVariables
    if (options?.extraVariables) {
      Object.entries(options.extraVariables).forEach(([key, value]) => {
        // Kiểm tra độ dài của key và value
        if (key.length + value.length <= 64) {
          headers[`X-${key}`] = value;
        } else {
          console.warn(`Skipping header ${key}: ${value} as it exceeds 64 characters`);
        }
      });
    }

    // Thêm headers vào inviterOptions
    if (Object.keys(headers).length > 0) {
      inviterOptions.extraHeaders = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
      console.log('Adding SIP headers:', inviterOptions.extraHeaders);
    }

    const inviter = new Inviter(this._ua!, targetUri, inviterOptions);

    this._callSessionObservers.forEach(observer => {
      observer.handleOutgoingCall(inviter, options?.delegate);
    });

    return inviter;
  }

  constructor(cfg: Config, timeout = 10000) {
    const { gateways, delegate, debug, appName } = cfg || {};

    this._uaBuilder = UABuilder.new(appName).withDebug(debug);

    this._timeout = timeout;
    this._appName = appName;
    this._delegate = delegate;

    gateways?.forEach(g => this._uaBuilder.setGateway(g));

    this._ua = this._uaBuilder.build();

    this._ua.delegate = {
      onInvite: (invitation: Invitation) => {
        console.log('Incoming call received');
        this._callSessionObservers.forEach(observer => {
          observer.handleIncomingCall(invitation);
        });
      },
    };
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
      const timeoutId = setTimeout(() => reject(ErrTimeout), this._timeout);
      if (this._ua && this._ua.delegate) {
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
  }

  async makeCall(target: string): Promise<string> {
    if (!this.isReady()) throw ErrConnection;
    if (this._callSessionObservers.length === 0) throw new Error('No call handler registered');

    const targetUri = this.createUri(target);
    console.log(`Creating call to ${targetUri.toString()}`);

    const callId = uuid();

    this.createOutgoingCall(target);

    return callId;
  }

  private _bindRegisteredEvents() {
    if (!this._ua || !this._registered) return;

    this._registerer?.stateChange.addListener(data => {
      if ('Unregistered' === data) {
        this._registered = false;
      } else if ('Registered' === data) {
        this._registered = true;
      }
    });

    this._ua.delegate = {
      ...this._ua.delegate,
      onInvite: (invitation: Invitation) => {
        invitation.delegate = {
          ...invitation.delegate,
          onBye: (bye: Bye) => {
            console.log('Incoming call BYE received', bye);
          },
        };

        for (const observer of this._callSessionObservers) {
          observer.handleIncomingCall(invitation);
        }
      },
      onRefer: (referral: Referral) => {
        console.log('day la referral', referral);
      },
    };
  }
}
