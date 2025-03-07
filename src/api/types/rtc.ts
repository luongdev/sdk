export type MutedListener = () => void;
export type UnmutedListener = () => void;
export type HoldListener = () => void;
export type UnholdListener = () => void;
export type FailedListener = (error: any) => void;
export type IceConnectionStateChangeListener = (event: any) => void;

export interface RTCDelegate {
  muted?: MutedListener;
  unmuted?: UnmutedListener;
  hold?: HoldListener;
  unhold?: UnholdListener;
  failed?: FailedListener;
  iceconnectionstatechange?: IceConnectionStateChangeListener;
}
