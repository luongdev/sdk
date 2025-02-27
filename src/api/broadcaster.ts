export interface State {
  key: string;
  version: number;
  value: Record<string, any>;
}

export class Broadcaster {
  private readonly _bc: BroadcastChannel;
  private readonly _listeners = new Set<(state: State) => void>();

  constructor() {
    this._bc = new BroadcastChannel('STATE_SYNC');
  }

  broadcast(state: State) {
    this._bc.postMessage(state);
  }

  addStateListener(listener: (state: State) => void) {
    if (!listener) {
      return;
    }

    this._listeners.add(listener);

    this._bc.onmessage = (me: MessageEvent<State>) => {
      console.log(me);
      listener(me.data);
    };
  }
}
