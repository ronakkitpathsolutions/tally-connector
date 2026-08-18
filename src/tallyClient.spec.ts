import http from 'node:http';
import { AddressInfo } from 'node:net';
import { postToTally } from './tallyClient';
import { AppConfig } from './config';

function cfgFor(port: number, timeoutMs = 5000): AppConfig {
  return {
    port: 4000,
    host: '127.0.0.1',
    sharedSecret: 's',
    tallyHost: '127.0.0.1',
    tallyPort: port,
    tallyTimeoutMs: timeoutMs,
    defaultCompany: 'C',
    eduMode: false,
  };
}

const okXml = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT>
<CREATED>1</CREATED><ALTERED>0</ALTERED><LASTVCHID>7</LASTVCHID>
<ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT></DATA></BODY></ENVELOPE>`;

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

describe('postToTally', () => {
  it('posts the XML and returns the parsed result', async () => {
    const received: string[] = [];
    const { server, port } = await listen((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(body);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(okXml);
      });
    });

    const result = await postToTally(cfgFor(port), '<ENVELOPE>test</ENVELOPE>');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.voucherId).toBe('7');
    expect(received[0]).toContain('<ENVELOPE>test</ENVELOPE>');
    server.close();
  });

  it('sends windows-1252, not UTF-8', async () => {
    let contentType = '';
    const { server, port } = await listen((req, res) => {
      contentType = String(req.headers['content-type'] ?? '');
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(okXml);
      });
    });

    await postToTally(cfgFor(port), '<ENVELOPE>café</ENVELOPE>');

    expect(contentType).toContain('windows-1252');
    server.close();
  });

  it('reports TALLY_UNREACHABLE when nothing is listening', async () => {
    // Port 1 is reserved and never has a listener.
    const result = await postToTally(cfgFor(1), '<ENVELOPE/>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('TALLY_UNREACHABLE');
      expect(result.error).toMatch(/Tally/i);
    }
  });

  it('reports TALLY_TIMEOUT when Tally accepts but never answers', async () => {
    // Tally sitting at a modal prompt behaves exactly like this: connection accepted, then silence.
    const { server, port } = await listen(() => {
      /* deliberately never responds */
    });

    const result = await postToTally(cfgFor(port, 300), '<ENVELOPE/>');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('TALLY_TIMEOUT');
    server.close();
  });
});
