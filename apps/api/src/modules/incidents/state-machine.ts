import { ConflictException } from '@nestjs/common';

import type { IncidentStatus } from '@statusbeam/contracts';

const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['monitoring', 'resolved'],
  monitoring: ['resolved'],
  resolved: [],
};

export function allowedTransitions(from: IncidentStatus): IncidentStatus[] {
  return [...TRANSITIONS[from]];
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException({
      message: `invalid incident transition from ${from} to ${to}`,
      from,
      to,
      allowedTransitions: allowedTransitions(from),
    });
  }
}
