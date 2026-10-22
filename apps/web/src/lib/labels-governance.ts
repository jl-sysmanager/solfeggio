import type { ChipTone } from '../components/Chip';

type LabelMap = Record<string, { label: string; tone: ChipTone }>;

export const assemblyType: Record<string, string> = { ORDINARY: 'Ordinaria', EXTRAORDINARY: 'Extraordinaria' };

export const assemblyStatus: LabelMap = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  CONVENED: { label: 'Convocada', tone: 'info' },
  HELD: { label: 'En curso', tone: 'warning' },
  CLOSED: { label: 'Cerrada', tone: 'success' },
};

export const motionStatus: LabelMap = {
  DRAFT: { label: 'Preparada', tone: 'neutral' },
  OPEN: { label: 'Abierta', tone: 'success' },
  CLOSED: { label: 'Cerrada', tone: 'info' },
};

export const voteChoice: Record<string, string> = { YES: 'A favor', NO: 'En contra', ABSTAIN: 'Abstención' };

export const boardPositions = ['Presidente', 'Vicepresidente', 'Secretario', 'Tesorero', 'Vocal'];

export const grantStatus: LabelMap = {
  REQUESTED: { label: 'Solicitada', tone: 'info' },
  AWARDED: { label: 'Concedida', tone: 'success' },
  JUSTIFIED: { label: 'Justificada', tone: 'success' },
  CLOSED: { label: 'Cerrada', tone: 'neutral' },
  REJECTED: { label: 'Denegada', tone: 'danger' },
};

export const donorKind: Record<string, string> = { PERSON: 'Persona física', COMPANY: 'Empresa o entidad' };
export const donationKind: Record<string, string> = { DONATION: 'Donativo', SPONSORSHIP: 'Patrocinio' };
