import { StateEnum } from '@/shared/enums/state.enum.ts';

export function transferStateCommon(status: string): string {
  switch (status.toUpperCase()) {
    case 'AVAILABLE':
    case 'BUSY':
    case 'AWAY':
    case 'BREAK':
    case 'OFFLINE':
      return StateEnum.WAITING;
    default:
      return StateEnum.WAITING;
  }
}
