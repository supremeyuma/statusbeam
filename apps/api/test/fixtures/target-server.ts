import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export type TargetMode = 'ok' | 'fail';

export interface TargetServer {
  url: string;
  port: number;
  requests: number;
  setMode: (mode: TargetMode) => void;
  close: () => Promise<void>;
}

/**
 * A controllable HTTP target for checker and end-to-end tests. No public internet is used.
 */
export async function startTargetServer(): Promise<TargetServer> {
  let mode: TargetMode = 'ok';
  let requests = 0;

  const server: Server = createServer((request, response) => {
    requests += 1;

    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('slow but healthy');
      }, 300);
      return;
    }

    if (request.url === '/json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'healthy', version: 3 }));
      return;
    }

    if (mode === 'fail' || request.url === '/fail') {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('broken');
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('healthy body');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    get requests() {
      return requests;
    },
    setMode: (next) => {
      mode = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
