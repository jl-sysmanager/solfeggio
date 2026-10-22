// Tipos del archivo avanzado: informe SGAE, particellas, libretos y préstamos.

export interface SgaeWork {
  workId: string;
  title: string;
  composer: string | null;
  arranger: string | null;
  durationSec: number | null;
  duration: string;
  publisher: string | null;
  catalogCode: string | null;
}
export interface SgaeEvent {
  id: string;
  date: string;
  title: string;
  location: string | null;
  works: SgaeWork[];
}
export interface SgaeReport {
  from: string;
  to: string;
  events: SgaeEvent[];
  totals: { performances: number; works: number; distinctWorks: number; durationSec: number; duration: string; missingDuration: number };
}

export interface PartRange {
  instrument: string;
  fromPage: number;
  toPage: number;
}
export interface PartSuggestion extends PartRange {
  confidence: number;
}
export interface DetectPartsResult {
  pages: number;
  ocrRequired: boolean;
  suggestions: PartSuggestion[];
}

export interface Booklet {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
  _count?: { items: number };
}
export interface BookletItem {
  id: string;
  workId: string;
  position: number;
  label?: string | null;
  work: { id: string; title: string; genre?: string | null; durationSec?: number | null; composer?: { name: string } | null };
}
export interface BookletDetail extends Booklet {
  items: BookletItem[];
}
export interface BookletInstrument {
  instrument: string;
  works: number;
  total: number;
}

export type LoanDirection = 'LENT' | 'BORROWED';
export interface ScoreLoan {
  id: string;
  workId: string;
  work?: { id: string; title: string };
  direction: LoanDirection;
  counterparty: string;
  contact?: string | null;
  loanedAt: string;
  dueAt?: string | null;
  returnedAt?: string | null;
  notes?: string | null;
  overdue: boolean;
}
