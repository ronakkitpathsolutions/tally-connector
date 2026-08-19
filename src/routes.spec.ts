import express from 'express';
import request from 'supertest';
import { buildRouter } from './routes';
import { AppConfig } from './config';
import { VoucherPayload } from './types';

const cfg: AppConfig = {
  port: 4000,
  host: '127.0.0.1',
  sharedSecret: 'top-secret',
  tallyHost: '127.0.0.1',
  tallyPort: 1,
  mastersPort: 9001, // nothing listens here
  tallyTimeoutMs: 500,
  defaultCompany: 'PRATHAM TRANSPORT PVT LTD',
  eduMode: false,
  allowMasterCreate: false,
};

const app = express().use(express.json()).use(buildRouter(cfg));
const eduApp = express()
  .use(express.json())
  .use(buildRouter({ ...cfg, eduMode: true }));

const payload: VoucherPayload = {
  remoteId: 'TMS-INV-44',
  company: 'PRATHAM TRANSPORT PVT LTD',
  voucherType: 'Sales',
  date: '20260805',
  billNo: 'T/2982/2026-27',
  party: { ledgerName: 'KILLICK NIXON LTD' },
  entries: [
    { ledgerName: 'KILLICK NIXON LTD', amount: -98176, isParty: true },
    { ledgerName: 'SALES IGST', amount: 83200 },
    { ledgerName: 'IGST (O/P)', amount: 14976 },
  ],
};

describe('routes', () => {
  it('leaves /health open so monitoring needs no secret', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects /tally/voucher without the secret', async () => {
    const res = await request(app).post('/tally/voucher').send(payload);
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH');
  });

  it('rejects a wrong secret', async () => {
    const res = await request(app).post('/tally/voucher').set('x-connector-secret', 'wrong').send(payload);
    expect(res.status).toBe(401);
  });

  it('returns generated XML from /tally/preview without contacting Tally', async () => {
    const res = await request(app).post('/tally/preview').set('x-connector-secret', 'top-secret').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.xml).toContain('<REMOTEID>TMS-INV-44</REMOTEID>');
  });

  it('falls back to the default company when the payload leaves it blank', async () => {
    const res = await request(app)
      .post('/tally/preview')
      .set('x-connector-secret', 'top-secret')
      .send({ ...payload, company: '' });
    expect(res.body.xml).toContain('<SVCURRENTCOMPANY>PRATHAM TRANSPORT PVT LTD</SVCURRENTCOMPANY>');
  });

  it('reports BAD_PAYLOAD for an unbalanced voucher without contacting Tally', async () => {
    const res = await request(app)
      .post('/tally/voucher')
      .set('x-connector-secret', 'top-secret')
      .send({ ...payload, entries: payload.entries.slice(0, 2) });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('BAD_PAYLOAD');
  });

  describe('/tally/invoice', () => {
    const invoice = {
      remoteId: 'TMS-INV-44',
      company: '',
      date: '20260805',
      billNo: 'T/2982/2026-27',
      party: { ledgerName: 'KILLICK NIXON LTD', gstin: '27AAACK1234A1Z5', stateName: 'Maharashtra' },
      lines: [
        { ledgerName: 'SALES IGST', amount: 80000, sacCode: '99651100', gstRate: 18 },
        { ledgerName: 'SALES IGST', amount: 3200, sacCode: '996711', gstRate: 18 },
      ],
      taxes: [{ ledgerName: 'IGST (O/P)', amount: 14976, dutyHead: 'IGST', gstRate: 18 }],
      total: 98176,
    };

    it('rejects the invoice route without the secret', async () => {
      const res = await request(app).post('/tally/invoice').send(invoice);
      expect(res.status).toBe(401);
    });

    it('previews invoice XML in Tally invoice format', async () => {
      const res = await request(app)
        .post('/tally/invoice/preview')
        .set('x-connector-secret', 'top-secret')
        .send(invoice);
      expect(res.status).toBe(200);
      expect(res.body.xml).toContain('<ISINVOICE>Yes</ISINVOICE>');
      expect(res.body.xml).toContain('<PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>');
      expect(res.body.xml).toContain('<HSNCODE>99651100</HSNCODE>');
      // Default company substituted for the blank one, same rule as the voucher route.
      expect(res.body.xml).toContain('<SVCURRENTCOMPANY>PRATHAM TRANSPORT PVT LTD</SVCURRENTCOMPANY>');
    });

    it('rejects an invoice whose total disagrees with its lines', async () => {
      const res = await request(app)
        .post('/tally/invoice')
        .set('x-connector-secret', 'top-secret')
        .send({ ...invoice, total: 99000 });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('BAD_PAYLOAD');
      expect(res.body.error).toMatch(/total/i);
    });

    it('reports TALLY_UNREACHABLE from the invoice route when Tally is down', async () => {
      const res = await request(app).post('/tally/invoice').set('x-connector-secret', 'top-secret').send(invoice);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.errorCode).toBe('TALLY_UNREACHABLE');
    });
  });

  describe('TALLY_EDU_MODE', () => {
    it('leaves dates alone when the flag is off', async () => {
      const res = await request(app).post('/tally/preview').set('x-connector-secret', 'top-secret').send(payload);
      expect(res.body.xml).toContain('<DATE>20260805</DATE>');
    });

    it('rewrites the date to the last of the month when the flag is on', async () => {
      const res = await request(eduApp).post('/tally/preview').set('x-connector-secret', 'top-secret').send(payload);
      expect(res.body.xml).toContain('<DATE>20260831</DATE>');
      expect(res.body.xml).toContain('<EFFECTIVEDATE>20260831</EFFECTIVEDATE>');
    });

    it('rewrites the date on the invoice route too', async () => {
      const res = await request(eduApp)
        .post('/tally/invoice/preview')
        .set('x-connector-secret', 'top-secret')
        .send({
          remoteId: 'TMS-INV-44',
          company: '',
          date: '20260805',
          billNo: 'T/2982/2026-27',
          party: { ledgerName: 'KILLICK NIXON LTD' },
          lines: [{ ledgerName: 'SALES IGST', amount: 83200, gstRate: 18 }],
          taxes: [{ ledgerName: 'IGST (O/P)', amount: 14976, dutyHead: 'IGST', gstRate: 18 }],
          total: 98176,
        });
      expect(res.body.xml).toContain('<DATE>20260831</DATE>');
    });
  });

  it('reports TALLY_UNREACHABLE when Tally is down', async () => {
    // HTTP 200 with ok:false — a Tally-side failure is a result, not a transport error. The backend
    // needs to tell "the connector was unreachable" apart from "Tally refused the voucher".
    const res = await request(app).post('/tally/voucher').set('x-connector-secret', 'top-secret').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.errorCode).toBe('TALLY_UNREACHABLE');
  });
});
