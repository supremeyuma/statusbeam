import { describe, expect, it } from 'vitest';

import {
  assertHttpTargetAllowed,
  assertTcpTargetAllowed,
  isPrivateAddress,
} from '../src/modules/monitors/ssrf';

describe('SSRF address classification', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.5.4', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['::1', true],
    ['fc00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['2606:4700::1111', false],
  ])('classifies %s private=%s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe('SSRF target validation', () => {
  it('rejects loopback when private targets are disabled', async () => {
    await expect(assertHttpTargetAllowed('http://127.0.0.1:9000', false)).rejects.toThrow(
      /private|loopback/,
    );
  });

  it('allows loopback when private targets are explicitly enabled', async () => {
    await expect(assertHttpTargetAllowed('http://127.0.0.1:9000', true)).resolves.toBeUndefined();
  });

  it('rejects non-http protocols and embedded credentials', async () => {
    await expect(assertHttpTargetAllowed('ftp://example.com', true)).rejects.toThrow(/http/);
    await expect(assertHttpTargetAllowed('http://user:pass@example.com', true)).rejects.toThrow(
      /credentials/,
    );
  });

  it('rejects unresolvable hosts', async () => {
    await expect(
      assertHttpTargetAllowed('http://does-not-exist.invalid/health', false),
    ).rejects.toThrow(/could not be resolved/);
  });

  it('rejects loopback TCP targets when private targets are disabled', async () => {
    await expect(assertTcpTargetAllowed('127.0.0.1', false)).rejects.toThrow(/private/);
  });
});
