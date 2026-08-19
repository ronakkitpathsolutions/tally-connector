import http from 'node:http';
import net from 'node:net';
import { AddressInfo } from 'node:net';
import { probeTally } from './tallyHealth';
import { AppConfig } from './config';

function cfgFor(port: number): AppConfig {
  return {
    port: 4000,
    host: '127.0.0.1',
    sharedSecret: 's',
    tallyHost: '127.0.0.1',
    tallyPort: port,
    mastersPort: 9001,
    tallyTimeoutMs: 30000,
    defaultCompany: 'C',
    eduMode: false,
    allowMasterCreate: false,
  };
}

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

describe('probeTally', () => {
  it('reports connected when Tally answers', async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<RESPONSE>TallyPrime Server is Running</RESPONSE>');
    });

    expect(await probeTally(cfgFor(port))).toBe('connected');
    server.close();
  });

  it('reports not-responding when the port is open but nothing comes back', async () => {
    // Exactly what a Tally sitting on a modal dialog does: the socket is accepted, then silence.
    // A plain TCP check calls this "connected", which is the false positive this exists to kill.
    const server = net.createServer(() => {
      /* accept, then never reply */
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    // 300ms so the probe resolves well inside jest's own test timeout.
    expect(await probeTally(cfgFor(port), 300)).toBe('not-responding');
    server.close();
  });

  it('reports unreachable when nothing is listening', async () => {
    expect(await probeTally(cfgFor(1))).toBe('unreachable');
  });
});
