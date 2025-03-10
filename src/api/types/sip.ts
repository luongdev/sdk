import { UserAgent, URI, Invitation, Inviter } from 'sip.js';
import type { CallDelegate, CallOptions } from '../types/call';

export interface CallSessionObserver {
  handleIncomingCall(invitation: Invitation): void;
  handleOutgoingCall(inviter: Inviter, params?: Record<string, string>, delegate?: CallDelegate): void;
}

export interface SipProvider {
  getUserAgent(): UserAgent | undefined;
  isReady(): boolean;
  createUri(target: string): URI;
  createOutgoingCall(target: string, options?: CallOptions): Inviter;
  addCallSessionObserver(observer: CallSessionObserver): void;
  removeCallSessionObserver(observer: CallSessionObserver): void;
}
