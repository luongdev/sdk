import { UserAgent, URI, Invitation, Inviter } from 'sip.js';

export interface CallSessionObserver {
  handleIncomingCall(invitation: Invitation): void;
  handleOutgoingCall(inviter: Inviter): void;
}

export interface SipProvider {
  getUserAgent(): UserAgent | undefined;
  isReady(): boolean;
  createUri(target: string): URI;
  createOutgoingCall(target: string): Inviter;
  addCallSessionObserver(observer: CallSessionObserver): void;
  removeCallSessionObserver(observer: CallSessionObserver): void;
}
