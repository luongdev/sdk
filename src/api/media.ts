export class Media {
  private _localStream?: MediaStream;

  constructor() {}

  get local(): MediaStream | undefined {
    return this._localStream;
  }

  async requestLocal(deviceId?: string): Promise<MediaStream> {
    const ms = await navigator.mediaDevices.getUserMedia({
      video: false,
      preferCurrentTab: true,
      audio: deviceId?.length ? { deviceId } : true,
    });

    this._localStream = ms;

    return ms;
  }
}
