import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, type AuthContext } from '../common/http.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { isUuid } from '../images/images.service.js';
import { MinRole } from './roles.js';

// API.md §7.45: the admin command palette's search — users (e-mail, name or id), a design by id, support tickets
// (reference or subject) and firms, at most five of each. SUPPORT and up (they already see these lists); rate-limited
// per admin so the palette cannot be used to walk the user table (RES).

const SearchQuery = z.object({ q: z.string().trim().min(2).max(80) }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/search')
@UseGuards(AdminGuard)
export class AdminSearchController {
  constructor(private prisma: PrismaService, private limiter: RateLimiter) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Komut paleti araması: kullanıcı, tasarım, destek talebi, firma (her birinden en çok 5)', { errors: [400, 401, 403, 429] })
  async search(@Query() query: unknown, @Auth() auth: AuthContext) {
    const { q } = parse(SearchQuery, query);
    await this.limiter.hit(LIMITS.adminSearch, auth.userId);
    const id = isUuid(q) ? q : null;
    const like = { contains: q, mode: 'insensitive' as const };
    const [users, design, tickets, orgs] = await Promise.all([
      this.prisma.user.findMany({
        where: { OR: [{ email: like }, { name: like }, ...(id ? [{ id }] : [])] },
        select: { id: true, email: true, name: true, role: true, isGuest: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      id ? this.prisma.design.findUnique({ where: { id }, select: { id: true, userId: true, status: true, tool: true, createdAt: true } }) : null,
      this.prisma.supportTicket.findMany({
        where: { OR: [{ reference: like }, { subject: like }, ...(id ? [{ id }] : [])] },
        select: { id: true, reference: true, subject: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.organization.findMany({ where: { OR: [{ name: like }, ...(id ? [{ id }] : [])] }, select: { id: true, name: true, status: true }, take: 5 }),
    ]);
    return {
      users,
      designs: design ? [{ ...design, createdAt: design.createdAt.toISOString() }] : [],
      tickets,
      orgs,
    };
  }
}
