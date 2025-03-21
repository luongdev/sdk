import { StatusEnum } from '../enums/status.enum.ts';

export function transferStatusCommon(status: string): string {
  switch (status.toUpperCase()) {
    case 'AVAILABLE':
      return StatusEnum.AVAILABLE;
    case 'BUSY':
    case 'AWAY':
    case 'BREAK':
    case 'OFFLINE':
      return StatusEnum.ON_BREAK;
    default:
      return status.toLowerCase();
  }
}
