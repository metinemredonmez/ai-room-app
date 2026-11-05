import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import type { Project } from '../generated/prisma/client.js';
import { ImagesService, isUuid } from '../images/images.service.js';
import { OrgsService } from './orgs.service.js';

// Firm projects (API.md §7.23 step 4): shared folders, e.g. one client's apartment. A design put in a project is
// visible to the whole team; a member's other firm designs stay theirs. Any member opens a project; its creator and
// the firm's OWNER/ADMIN rename, archive or delete it (delete only when empty: designs are never orphaned).

export const MAX_ACTIVE_PROJECTS = 500;
const text = (max: number) => z.string().trim().max(max);

export const CreateProjectSchema = z
  .object({ name: text(80).min(2), clientName: text(80).nullable().default(null), note: text(500).nullable().default(null) })
  .strict();
export const UpdateProjectSchema = z
  .object({ name: text(80).min(2).optional(), clientName: text(80).nullable().optional(), note: text(500).nullable().optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing_to_change' });
export const ProjectListQuery = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE') });

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private orgs: OrgsService, private images: ImagesService) {}

  private dto(p: Project & { _count?: { designs: number } }, cover: string | null = null) {
    return {
      id: p.id, orgId: p.orgId, name: p.name, clientName: p.clientName, note: p.note, status: p.status,
      designs: p._count?.designs ?? 0, cover, createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    };
  }

  /** A project of this firm, or "not found" — a project id from another firm never resolves (AZ-04). */
  private async find(orgId: string, projectId: string) {
    if (!isUuid(projectId)) throw notFound();
    const p = await this.prisma.project.findFirst({ where: { id: projectId, orgId }, include: { _count: { select: { designs: true } } } });
    if (!p) throw notFound();
    return p;
  }

  /** Rename, archive and delete: the creator, or the firm's OWNER/ADMIN. */
  private canManage(p: Project, me: { userId: string; role: string }) {
    return p.createdBy === me.userId || me.role === 'OWNER' || me.role === 'ADMIN';
  }

  async list(orgId: string, userId: string, status: 'ACTIVE' | 'ARCHIVED') {
    await this.orgs.membership(orgId, userId);
    const rows = await this.prisma.project.findMany({
      where: { orgId, status },
      include: { _count: { select: { designs: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    // Cover: the newest successful design's first result (signed URL like every image).
    const covers = await Promise.all(
      rows.map((p) =>
        this.prisma.design.findFirst({
          where: { projectId: p.id, orgId, status: 'SUCCEEDED' },
          include: { results: { orderBy: { createdAt: 'asc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    );
    return { items: rows.map((p, i) => this.dto(p, covers[i]?.results[0] ? this.images.ref(covers[i]!.results[0]).url : null)) };
  }

  async create(orgId: string, userId: string, input: z.infer<typeof CreateProjectSchema>) {
    const org = await this.orgs.workspace(orgId, userId);
    if ((await this.prisma.project.count({ where: { orgId: org.id, status: 'ACTIVE' } })) >= MAX_ACTIVE_PROJECTS) {
      throw new AppError(409, 'too_many_projects', `Bir firmada en çok ${MAX_ACTIVE_PROJECTS} etkin proje olabilir; eskileri arşivle.`);
    }
    const p = await this.prisma.project.create({ data: { orgId: org.id, name: input.name, clientName: input.clientName || null, note: input.note || null, createdBy: userId } });
    return this.dto(p);
  }

  async update(orgId: string, userId: string, projectId: string, input: z.infer<typeof UpdateProjectSchema>) {
    const me = await this.orgs.membership(orgId, userId);
    const p = await this.find(orgId, projectId);
    if (!this.canManage(p, me)) throw new AppError(403, 'org_forbidden', 'Projeyi açan kişi ya da firma yöneticisi değiştirebilir.');
    const updated = await this.prisma.project.update({
      where: { id: p.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.clientName !== undefined ? { clientName: input.clientName || null } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { _count: { select: { designs: true } } },
    });
    return this.dto(updated);
  }

  /** Only an empty project is deleted; one with designs is archived instead (409). */
  async remove(orgId: string, userId: string, projectId: string) {
    const me = await this.orgs.membership(orgId, userId);
    const p = await this.find(orgId, projectId);
    if (!this.canManage(p, me)) throw new AppError(403, 'org_forbidden', 'Projeyi açan kişi ya da firma yöneticisi silebilir.');
    if (p._count.designs > 0) throw new AppError(409, 'project_not_empty', 'Projede tasarım var; silmek yerine arşivle.');
    await this.prisma.project.delete({ where: { id: p.id } });
  }

  /** For new or moved designs: a project of this firm that is still open. */
  async usable(orgId: string, projectId: string) {
    const p = await this.find(orgId, projectId);
    if (p.status !== 'ACTIVE') throw new AppError(409, 'project_archived', 'Proje arşivde; önce yeniden aç.');
    return p;
  }

  /** Read access to a shared design's project list (members only). */
  async assertVisible(orgId: string, projectId: string, userId: string) {
    await this.orgs.membership(orgId, userId);
    await this.find(orgId, projectId);
  }
}
