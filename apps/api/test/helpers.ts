import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlanCode } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { StripeClient } from '../src/billing/stripe.provider';
import { configureApp } from '../src/bootstrap';
import { Db } from '../src/db/db.service';
import { Jobs } from '../src/jobs/jobs.service';
import { Storage } from '../src/storage/storage.service';
import { seedPlans } from '../prisma/plans';

/** Cola en memoria: los tests inspeccionan los trabajos encolados. */
export class FakeJobs {
  added: { name: string; data: any }[] = [];
  async add(name: string, data: unknown) {
    this.added.push({ name, data });
  }
  async ping() {
    return true;
  }
  of(name: string) {
    return this.added.filter((j) => j.name === name);
  }
}

/**
 * S3 simulado: `objects.set(key, size)` hace las veces del PUT del navegador; `bodies` guarda el
 * contenido para getObject/putObject (o `put(key, buffer)` desde los tests).
 */
export class FakeStorage extends Storage {
  objects = new Map<string, number>();
  bodies = new Map<string, Buffer>();
  put(key: string, body: Uint8Array) {
    this.bodies.set(key, Buffer.from(body));
    this.objects.set(key, body.byteLength);
  }
  async getObject(key: string) {
    const body = this.bodies.get(key);
    if (!body) throw new Error(`Objeto inexistente: ${key}`);
    return body;
  }
  async putObject(key: string, body: Buffer | Uint8Array) {
    this.put(key, body);
  }
  async uploadUrl(key: string) {
    return `https://s3.test/${key}?signed`;
  }
  async downloadUrl(key: string) {
    return `https://s3.test/${key}?download`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  async remove(key: string) {
    this.objects.delete(key);
    this.bodies.delete(key);
  }
}

export class FakeStripe {
  subscriptions = new Map<string, any>();
  openInvoices: any[] = [];
  coupons: any[] = [];
  promoCodes: any[] = [];
  events = new Map<string, any>();
  payError: string | null = null;
  calls: { method: string; args: any }[] = [];
  isEnabled = true;
  taxEnabled = true;
  async enabled() {
    return this.isEnabled;
  }
  async settings() {
    return { taxEnabled: this.taxEnabled };
  }
  async api() {
    return this.client;
  }
  client = {
    checkout: { sessions: { create: async (args: any) => (this.calls.push({ method: 'checkout.create', args }), { url: 'https://checkout.stripe.test/s' }) } },
    billingPortal: { sessions: { create: async (args: any) => (this.calls.push({ method: 'portal.create', args }), { url: 'https://billing.stripe.test/p' }) } },
    subscriptions: {
      retrieve: async (id: string) => this.subscriptions.get(id),
      update: async (id: string, args: any) => {
        this.calls.push({ method: 'subscriptions.update', args: { id, ...args } });
        const sub = this.subscriptions.get(id);
        if (!sub) throw new Error('No such subscription');
        if (args.trial_end) sub.trial_end = args.trial_end;
        return sub;
      },
    },
    invoices: {
      list: async (args: any) => (this.calls.push({ method: 'invoices.list', args }), { data: this.openInvoices }),
      pay: async (id: string) => {
        this.calls.push({ method: 'invoices.pay', args: { id } });
        if (this.payError) throw new Error(this.payError);
        const inv = this.openInvoices.find((i) => i.id === id) ?? { id };
        return { ...inv, status: 'paid', amount_paid: inv.total ?? 0 };
      },
    },
    coupons: {
      list: async () => ({ data: this.coupons }),
      create: async (args: any) => {
        this.calls.push({ method: 'coupons.create', args });
        const c = { id: `co_${this.coupons.length + 1}`, created: Math.floor(Date.now() / 1000), valid: true, times_redeemed: 0, percent_off: null, amount_off: null, currency: null, duration_in_months: null, max_redemptions: null, ...args };
        this.coupons.push(c);
        return c;
      },
      del: async (id: string) => {
        this.calls.push({ method: 'coupons.del', args: { id } });
        this.coupons = this.coupons.filter((c) => c.id !== id);
        return { id, deleted: true };
      },
    },
    promotionCodes: {
      list: async () => ({ data: this.promoCodes }),
      create: async (args: any) => {
        this.calls.push({ method: 'promotionCodes.create', args });
        const p = { id: `promo_${this.promoCodes.length + 1}`, active: true, code: args.code, coupon: { id: args.coupon } };
        this.promoCodes.push(p);
        return p;
      },
    },
    customers: {
      create: async (args: any) => (this.calls.push({ method: 'customers.create', args }), { id: `cus_${args.metadata.tenantId.slice(0, 8)}` }),
      createBalanceTransaction: async (customer: string, args: any) => (this.calls.push({ method: 'customers.createBalanceTransaction', args: { customer, ...args } }), { id: 'cbtxn_1' }),
    },
    subscriptionItems: {
      create: async (args: any) => {
        this.calls.push({ method: 'subscriptionItems.create', args });
        const sub = this.subscriptions.get(args.subscription);
        const item = { id: `si_${sub.items.data.length + 1}_${args.price}`, price: { id: args.price, recurring: { interval: 'month' } }, quantity: args.quantity, metadata: args.metadata ?? {} };
        sub.items.data.push(item);
        return item;
      },
      update: async (id: string, args: any) => {
        this.calls.push({ method: 'subscriptionItems.update', args: { id, ...args } });
        for (const sub of this.subscriptions.values()) {
          const item = sub.items.data.find((i: any) => i.id === id);
          if (item) Object.assign(item, { quantity: args.quantity ?? item.quantity, ...(args.price ? { price: { ...item.price, id: args.price } } : {}) });
        }
        return {};
      },
      del: async (id: string, args: any) => {
        this.calls.push({ method: 'subscriptionItems.del', args: { id, ...args } });
        for (const sub of this.subscriptions.values()) sub.items.data = sub.items.data.filter((i: any) => i.id !== id);
        return { id, deleted: true };
      },
    },
    events: { retrieve: async (id: string) => (this.calls.push({ method: 'events.retrieve', args: { id } }), this.events.get(id) ?? Promise.reject(new Error('No such event'))) },
  };
  async constructEvent(payload: Buffer, signature: string) {
    if (signature !== 'valid') throw new Error('bad signature');
    return JSON.parse(payload.toString());
  }
}

export interface TestCtx {
  app: INestApplication;
  db: Db;
  jobs: FakeJobs;
  storage: FakeStorage;
  stripe: FakeStripe;
  http: () => ReturnType<typeof request>;
}

/** `realStripe`: usa el StripeClient real (lee la configuración de integraciones de la BD). */
export async function createTestApp(opts: { realStripe?: boolean } = {}): Promise<TestCtx> {
  const jobs = new FakeJobs();
  const storage = new FakeStorage();
  const stripe = new FakeStripe();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Jobs).useValue(jobs)
    .overrideProvider(Storage).useValue(storage);
  if (!opts.realStripe) builder = builder.overrideProvider(StripeClient).useValue(stripe);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
  configureApp(app);
  await app.init();
  const db = app.get(Db);
  return { app, db, jobs, storage, stripe, http: () => request(app.getHttpServer()) };
}

/** Vacía todas las tablas excepto el historial de migraciones y repone los planes. */
export async function resetDb(db: Db) {
  const tables = await db.system.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.system.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await seedPlans(db.system);
}

export const PASSWORD = 'Contrasena-de-test-1';

export interface Band {
  token: string;
  tenantId: string;
  userId: string;
  email: string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export { auth };

export async function signupBand(ctx: TestCtx, slug: string, plan: PlanCode = 'PRO'): Promise<Band> {
  const email = `${slug}@test.local`;
  await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, name: `Owner ${slug}` }).expect(201);
  const login = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  const onboard = await ctx.http().post('/api/v1/onboarding').set(auth(login.body.accessToken)).send({ bandName: `Banda ${slug}`, slug }).expect(201);
  const tenantId = onboard.body.session.tenant.id;
  await setPlan(ctx.db, tenantId, plan);
  return { token: onboard.body.accessToken, tenantId, userId: onboard.body.session.user.id, email };
}

export async function setPlan(db: Db, tenantId: string, code: PlanCode) {
  const plan = await db.system.plan.findUniqueOrThrow({ where: { code } });
  const paid = plan.priceMonthlyCents > 0 || plan.priceYearlyCents > 0;
  await db.system.tenant.update({ where: { id: tenantId }, data: { planId: plan.id, complimentaryUntil: null } });
  // * Suscripción viva de prueba: el gating de entitlements exige pago (sin usar complimentary, que bloquea dunning).
  if (paid) {
    const id = `test_${tenantId.replace(/-/g, '').slice(0, 14)}`;
    await db.system.subscription.upsert({
      where: { tenantId },
      create: { tenantId, stripeCustomerId: `cus_${id}`, stripeSubscriptionId: `sub_${id}`, stripeStatus: 'active' },
      update: { stripeSubscriptionId: `sub_${id}`, stripeStatus: 'active' },
    });
  } else {
    await db.system.subscription.deleteMany({ where: { tenantId } });
  }
}

/** Crea un usuario con un rol dado en la banda y devuelve su token con tenant activo. */
export async function addUser(ctx: TestCtx, band: Band, roleKey: string, email: string, memberId?: string): Promise<string> {
  await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, name: email }).expect(201);
  const user = await ctx.db.system.user.findUniqueOrThrow({ where: { email } });
  const role = await ctx.db.system.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: band.tenantId, key: roleKey } } });
  await ctx.db.system.membership.create({ data: { tenantId: band.tenantId, userId: user.id, roleId: role.id, memberId } });
  const login = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return login.body.accessToken;
}
