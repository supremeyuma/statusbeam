import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return Number.NaN;
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return Number.NaN;
    }
    value = value * 256 + octet;
  }
  return value;
}

function inIpv4Range(ip: number, base: string, prefix: number): boolean {
  const baseNumber = ipv4ToNumber(base);
  if (Number.isNaN(baseNumber)) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) >>> 0 === (baseNumber & mask) >>> 0;
}

export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToNumber(ip);
  if (Number.isNaN(value)) {
    return true;
  }
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => inIpv4Range(value, base, prefix));
}

export function isPrivateIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip === '::1' || ip === '::') {
    return true;
  }

  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) {
    return isPrivateIpv4(mapped[1]);
  }

  // Unique local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8).
  if (
    /^f[cd][0-9a-f]{2}:/.test(ip) ||
    /^fe[89ab][0-9a-f]:/.test(ip) ||
    /^ff[0-9a-f]{2}:/.test(ip)
  ) {
    return true;
  }

  return false;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

async function assertHostResolvesPublic(hostname: string): Promise<void> {
  const host = stripBrackets(hostname);

  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) {
      throw new BadRequestException(`target ${host} is a private, loopback, or link-local address`);
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException(`target host ${host} could not be resolved`);
  }

  if (addresses.length === 0) {
    throw new BadRequestException(`target host ${host} did not resolve to any address`);
  }

  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new BadRequestException(
        `target host ${host} resolves to a private address (${entry.address})`,
      );
    }
  }
}

export async function assertHttpTargetAllowed(
  rawUrl: string,
  allowPrivateTargets: boolean,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('url is not a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('only http and https targets are supported');
  }
  if (url.username || url.password) {
    throw new BadRequestException('url must not contain credentials');
  }

  if (!allowPrivateTargets) {
    await assertHostResolvesPublic(url.hostname);
  }
}

export async function assertTcpTargetAllowed(
  host: string,
  allowPrivateTargets: boolean,
): Promise<void> {
  if (!allowPrivateTargets) {
    await assertHostResolvesPublic(host);
  }
}
