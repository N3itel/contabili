import { and, eq } from 'drizzle-orm';
import { accounts, auditLog, companyMembers } from '../src/db/schema/index.js';
import {
  addMember,
  constraintOf,
  createCompany,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

describe('empresas y permisos (e2e)', () => {
  let t: TestApp;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('crea la empresa con el PCGE y quien la crea queda como dueño', async () => {
    const ruc = randomRuc();
    const res = await t.http
      .post('/companies')
      .set(owner.auth)
      .send({ ruc, legalName: 'Ferretería Sol EIRL', taxRegime: 'rer' })
      .expect(201);
    expect(res.body).toMatchObject({ ruc, role: 'owner', taxRegime: 'rer' });

    const rows = await t.db.select().from(accounts).where(eq(accounts.companyId, res.body.id));
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get('40')?.allowsPosting).toBe(false);
    expect(byCode.get('40111')?.parentId).toBe(byCode.get('4011')?.id);

    const list = await t.http.get('/companies').set(owner.auth).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(res.body.id);
  });

  it('rechaza un RUC inválido o repetido', async () => {
    const bad = await t.http
      .post('/companies')
      .set(owner.auth)
      .send({ ruc: '20131312954', legalName: 'Mal RUC SAC', taxRegime: 'general' })
      .expect(400);
    expect(bad.body.code).toBe('invalid_ruc');
    const ruc = randomRuc();
    await t.http
      .post('/companies')
      .set(owner.auth)
      .send({ ruc, legalName: 'Primera SAC', taxRegime: 'general' })
      .expect(201);
    const dup = await t.http
      .post('/companies')
      .set(owner.auth)
      .send({ ruc, legalName: 'Segunda SAC', taxRegime: 'general' })
      .expect(409);
    expect(dup.body.code).toBe('ruc_taken');
  });

  it('quien no es parte no ve la empresa (como si no existiera)', async () => {
    const companyId = await createCompany(t, owner);
    const stranger = await signUp(t);
    const res = await t.http.get(`/companies/${companyId}`).set(stranger.auth).expect(404);
    expect(res.body.code).toBe('company_not_found');
    await t.http.get(`/companies/${companyId}/accounts`).set(stranger.auth).expect(404);
    await t.http.get('/companies/no-es-un-id').set(stranger.auth).expect(400);
  });

  it('invita por celular: la persona acepta y entra con el rol invitado', async () => {
    const companyId = await createCompany(t, owner);
    const accountant = await signUp(t, undefined, 'Carlos Contador');
    const invite = await t.http
      .post(`/companies/${companyId}/invitations`)
      .set(owner.auth)
      .send({ phone: accountant.phone.slice(3), role: 'accountant' })
      .expect(201);
    expect(invite.body.phone).not.toContain(accountant.phone.slice(4, 9));

    const mine = await t.http.get('/invitations').set(accountant.auth).expect(200);
    expect(mine.body).toEqual([
      expect.objectContaining({
        id: invite.body.id,
        companyId,
        role: 'accountant',
        invitedBy: 'Rosa Dueña',
      }),
    ]);
    // Otra persona no puede aceptarla.
    const other = await signUp(t);
    await t.http.post(`/invitations/${invite.body.id}/accept`).set(other.auth).expect(404);

    await t.http.post(`/invitations/${invite.body.id}/accept`).set(accountant.auth).expect(200);
    await t.http.post(`/invitations/${invite.body.id}/accept`).set(accountant.auth).expect(404);
    const company = await t.http.get(`/companies/${companyId}`).set(accountant.auth).expect(200);
    expect(company.body.role).toBe('accountant');

    const members = await t.http
      .get(`/companies/${companyId}/members`)
      .set(accountant.auth)
      .expect(200);
    expect(members.body.map((m: { role: string }) => m.role).sort()).toEqual([
      'accountant',
      'owner',
    ]);

    const [log] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, companyId), eq(auditLog.action, 'invitation.accepted')));
    expect(log.actorId).toBe(accountant.userId);
  });

  it('no repite invitaciones ni invita a quien ya es parte', async () => {
    const companyId = await createCompany(t, owner);
    const person = await signUp(t);
    await t.http
      .post(`/companies/${companyId}/invitations`)
      .set(owner.auth)
      .send({ phone: person.phone, role: 'viewer' })
      .expect(201);
    const again = await t.http
      .post(`/companies/${companyId}/invitations`)
      .set(owner.auth)
      .send({ phone: person.phone, role: 'viewer' })
      .expect(409);
    expect(again.body.code).toBe('already_invited');
    const self = await t.http
      .post(`/companies/${companyId}/invitations`)
      .set(owner.auth)
      .send({ phone: owner.phone, role: 'viewer' })
      .expect(409);
    expect(self.body.code).toBe('already_member');
  });

  it('el dueño revoca invitaciones; los demás no invitan', async () => {
    const companyId = await createCompany(t, owner);
    const viewer = await signUp(t);
    await addMember(t, companyId, owner, viewer, 'viewer');
    const person = await signUp(t);
    const forbidden = await t.http
      .post(`/companies/${companyId}/invitations`)
      .set(viewer.auth)
      .send({ phone: person.phone, role: 'viewer' })
      .expect(403);
    expect(forbidden.body.code).toBe('forbidden');

    const invite = await t.http
      .post(`/companies/${companyId}/invitations`)
      .set(owner.auth)
      .send({ phone: person.phone, role: 'viewer' })
      .expect(201);
    await t.http
      .delete(`/companies/${companyId}/invitations/${invite.body.id}`)
      .set(owner.auth)
      .expect(204);
    await t.http.post(`/invitations/${invite.body.id}/accept`).set(person.auth).expect(404);
  });

  it('nunca deja la empresa sin dueño', async () => {
    const companyId = await createCompany(t, owner);
    const lastOwner = await t.http
      .patch(`/companies/${companyId}/members/${owner.userId}`)
      .set(owner.auth)
      .send({ role: 'viewer' })
      .expect(409);
    expect(lastOwner.body.code).toBe('last_owner');
    await t.http
      .delete(`/companies/${companyId}/members/${owner.userId}`)
      .set(owner.auth)
      .expect(409);

    // Con otro dueño, sí puede salir.
    const partner = await signUp(t);
    await addMember(t, companyId, owner, partner, 'owner');
    await t.http
      .delete(`/companies/${companyId}/members/${owner.userId}`)
      .set(owner.auth)
      .expect(204);
    await t.http.get(`/companies/${companyId}`).set(owner.auth).expect(404);

    // La base también lo impide.
    expect(
      await constraintOf(
        t.db.delete(companyMembers).where(eq(companyMembers.companyId, companyId)),
      ),
    ).toBe('company_members_has_owner');
  });

  it('cambiar el rol tiene efecto inmediato', async () => {
    const companyId = await createCompany(t, owner);
    const person = await signUp(t);
    await addMember(t, companyId, owner, person, 'accountant');
    await t.http
      .patch(`/companies/${companyId}/members/${person.userId}`)
      .set(owner.auth)
      .send({ role: 'viewer' })
      .expect(204);
    const res = await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(person.auth)
      .send({ code: '10411', name: 'BCP soles' })
      .expect(403);
    expect(res.body.code).toBe('forbidden');
    // Y el dueño puede sacarla.
    await t.http
      .delete(`/companies/${companyId}/members/${person.userId}`)
      .set(owner.auth)
      .expect(204);
    await t.http.get(`/companies/${companyId}/accounts`).set(person.auth).expect(404);
  });
});
