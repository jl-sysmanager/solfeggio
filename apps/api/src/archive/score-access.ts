import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/context';
import { normalizeInstrument } from './parts';

/** `'all'` cuando el rol puede ver cualquier partitura. Si no, los instrumentos de su ficha. */
export async function scoreScope(tx: Prisma.TransactionClient, ctx: RequestContext): Promise<string[] | 'all'> {
  if (ctx.permissions.has('archive:all')) return 'all';
  if (!ctx.memberId) return [];
  const member = await tx.member.findUnique({
    where: { id: ctx.memberId },
    select: { instrument: true, secondaryInstrument: true },
  });
  return [member?.instrument, member?.secondaryInstrument].filter((s): s is string => !!s?.trim());
}

/** La particella corresponde al instrumento del socio (también «Clarinete 1º» si toca clarinete). */
export function partMatches(assetInstrument: string, mine: string) {
  const asset = normalizeInstrument(assetInstrument);
  const user = normalizeInstrument(mine);
  if (!asset || !user) return false;
  if (asset === user) return true;
  const escaped = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(asset);
}

/** Sin `archive:all` sólo se ven audios y particellas del instrumento principal o secundario. */
export function canSeeAsset(asset: { kind: string; instrument: string | null }, scope: string[] | 'all') {
  if (scope === 'all') return true;
  if (asset.kind === 'AUDIO') return true;
  if (asset.kind !== 'PART' || !asset.instrument) return false;
  return scope.some((mine) => partMatches(asset.instrument!, mine));
}

export function assertCanSee(asset: { kind: string; instrument: string | null }, scope: string[] | 'all') {
  if (!canSeeAsset(asset, scope)) {
    throw new ForbiddenException({ message: 'Esta partitura no es de tu instrumento', code: 'SCORE_FORBIDDEN' });
  }
}
