import { randomUUID } from 'node:crypto';
import { AppError } from './common/errors.js';
import { CreateProjectSchema, MAX_ACTIVE_PROJECTS, ProjectsService, UpdateProjectSchema } from './orgs/projects.service.js';

// API.md §7.23 step 4: firm projects. AZ-04: a project id from another firm never resolves. Managing a project is
// for its creator or the firm's OWNER/ADMIN; a project holding designs is archived, never deleted.

type P = { id: string; orgId: string; name: string; clientName: string | null; note: string | null; status: string; createdBy: string | null; createdAt: Date; updatedAt: Date };

function setup() {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const projects: P[] = [];
  const designCount = new Map<string, number>();
  const roles = new Map<string, string>(); // `${orgId}:${userId}` → role
  const suspended = new Set<string>();
  const withCount = (p: P) => ({ ...p, _count: { designs: designCount.get(p.id) ?? 0 } });
  const prisma = {
    project: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const p = projects.find((x) => x.id === where.id && x.orgId === where.orgId);
        return p ? withCount(p) : null;
      },
      findMany: async ({ where }: { where: { orgId: string; status: string } }) => projects.filter((p) => p.orgId === where.orgId && p.status === where.status).map(withCount),
      count: async ({ where }: { where: { orgId: string; status: string } }) => projects.filter((p) => p.orgId === where.orgId && p.status === where.status).length,
      create: async ({ data }: { data: Omit<P, 'id' | 'status' | 'createdAt' | 'updatedAt'> }) => {
        const p: P = { id: randomUUID(), status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...data };
        projects.push(p);
        return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<P> }) => withCount(Object.assign(projects.find((p) => p.id === where.id)!, data)),
      delete: async ({ where }: { where: { id: string } }) => void projects.splice(projects.findIndex((p) => p.id === where.id), 1),
    },
    design: { findFirst: async () => null },
  };
  const membership = async (orgId: string, userId: string) => {
    const role = roles.get(`${orgId}:${userId}`);
    if (!role) throw new AppError(404, 'not_found');
    return { userId, role, org: { id: orgId, status: suspended.has(orgId) ? 'SUSPENDED' : 'ACTIVE' } };
  };
  const orgs = {
    membership,
    workspace: async (orgId: string, userId: string) => {
      const m = await membership(orgId, userId);
      if (m.org.status !== 'ACTIVE') throw new AppError(403, 'org_suspended');
      return m.org;
    },
  };
  const images = { ref: (i: { id: string }) => ({ id: i.id, url: `https://img/${i.id}` }) };
  const svc = new ProjectsService(prisma as never, orgs as never, images as never);
  const join = (orgId: string, userId: string, role: string) => roles.set(`${orgId}:${userId}`, role);
  return { svc, orgA, orgB, projects, designCount, join, suspended };
}

const create = (name: string) => CreateProjectSchema.parse({ name, clientName: 'Yılmaz ailesi' });

describe('firm projects', () => {
  it('a project from another firm is "not found", whatever the caller does with it (AZ-04)', async () => {
    const f = setup();
    f.join(f.orgA, 'ali', 'MEMBER');
    f.join(f.orgB, 'bora', 'OWNER');
    const theirs = await f.svc.create(f.orgB, 'bora', create('Kadıköy daire'));
    await expect(f.svc.usable(f.orgA, theirs.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.update(f.orgA, 'ali', theirs.id, UpdateProjectSchema.parse({ name: 'Ele geçir' }))).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.remove(f.orgA, 'ali', theirs.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.assertVisible(f.orgA, theirs.id, 'ali')).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.list(f.orgB, 'ali', 'ACTIVE')).rejects.toMatchObject({ status: 404 }); // not a member
  });

  it('any member opens a project; only its creator or an owner/admin renames, archives or deletes it', async () => {
    const f = setup();
    f.join(f.orgA, 'ali', 'MEMBER');
    f.join(f.orgA, 'can', 'MEMBER');
    f.join(f.orgA, 'deniz', 'ADMIN');
    const p = await f.svc.create(f.orgA, 'ali', create('Moda villa'));
    expect(p).toMatchObject({ name: 'Moda villa', clientName: 'Yılmaz ailesi', status: 'ACTIVE', createdBy: 'ali' });
    await expect(f.svc.update(f.orgA, 'can', p.id, UpdateProjectSchema.parse({ name: 'Başka ad' }))).rejects.toMatchObject({ status: 403 });
    await expect(f.svc.update(f.orgA, 'ali', p.id, UpdateProjectSchema.parse({ name: 'Moda villa – 2. kat' }))).resolves.toMatchObject({ name: 'Moda villa – 2. kat' });
    await expect(f.svc.update(f.orgA, 'deniz', p.id, UpdateProjectSchema.parse({ status: 'ARCHIVED' }))).resolves.toMatchObject({ status: 'ARCHIVED' });
    await expect(f.svc.remove(f.orgA, 'can', p.id)).rejects.toMatchObject({ status: 403 });
  });

  it('a project with designs is archived, not deleted; an archived project takes no new designs', async () => {
    const f = setup();
    f.join(f.orgA, 'ali', 'OWNER');
    const full = await f.svc.create(f.orgA, 'ali', create('Dolu'));
    const empty = await f.svc.create(f.orgA, 'ali', create('Boş'));
    f.designCount.set(full.id, 3);
    await expect(f.svc.remove(f.orgA, 'ali', full.id)).rejects.toMatchObject({ status: 409, code: 'project_not_empty' });
    await f.svc.remove(f.orgA, 'ali', empty.id);
    expect(f.projects.map((p) => p.name)).toEqual(['Dolu']);
    await f.svc.update(f.orgA, 'ali', full.id, UpdateProjectSchema.parse({ status: 'ARCHIVED' }));
    await expect(f.svc.usable(f.orgA, full.id)).rejects.toMatchObject({ status: 409, code: 'project_archived' });
  });

  it('a suspended firm opens no projects; input is bounded; there is a cap (INP-01, RES)', async () => {
    const f = setup();
    f.join(f.orgA, 'ali', 'OWNER');
    f.suspended.add(f.orgA);
    await expect(f.svc.create(f.orgA, 'ali', create('Yeni'))).rejects.toMatchObject({ status: 403 });
    f.suspended.clear();
    expect(CreateProjectSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(CreateProjectSchema.safeParse({ name: 'Proje', orgId: 'başka' }).success).toBe(false);
    expect(UpdateProjectSchema.safeParse({}).success).toBe(false);
    for (let i = 0; i < MAX_ACTIVE_PROJECTS; i++) f.projects.push({ id: randomUUID(), orgId: f.orgA, name: `p${i}`, clientName: null, note: null, status: 'ACTIVE', createdBy: 'ali', createdAt: new Date(), updatedAt: new Date() });
    await expect(f.svc.create(f.orgA, 'ali', create('Fazla'))).rejects.toMatchObject({ status: 409, code: 'too_many_projects' });
  });
});
