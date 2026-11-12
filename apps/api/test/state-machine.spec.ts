import { describe, expect, it } from 'vitest';

import {
  allowedTransitions,
  assertTransition,
  canTransition,
} from '../src/modules/incidents/state-machine';

describe('incident state machine', () => {
  it.each([
    ['investigating', 'identified', true],
    ['investigating', 'monitoring', true],
    ['investigating', 'resolved', true],
    ['identified', 'monitoring', true],
    ['identified', 'resolved', true],
    ['monitoring', 'resolved', true],
    ['identified', 'investigating', false],
    ['monitoring', 'investigating', false],
    ['monitoring', 'identified', false],
    ['resolved', 'investigating', false],
    ['resolved', 'monitoring', false],
    ['investigating', 'investigating', false],
  ])('%s -> %s is %s', (from, to, expected) => {
    expect(canTransition(from as never, to as never)).toBe(expected);
  });

  it('reports the allowed transitions for a 409 body', () => {
    expect(allowedTransitions('investigating')).toEqual(['identified', 'monitoring', 'resolved']);
    expect(allowedTransitions('monitoring')).toEqual(['resolved']);
    expect(allowedTransitions('resolved')).toEqual([]);
  });

  it('throws a conflict carrying the allowed transitions', () => {
    try {
      assertTransition('resolved', 'investigating');
      throw new Error('expected a conflict');
    } catch (error) {
      const response = (error as { getResponse: () => Record<string, unknown> }).getResponse();
      expect(response.from).toBe('resolved');
      expect(response.allowedTransitions).toEqual([]);
    }
  });
});
