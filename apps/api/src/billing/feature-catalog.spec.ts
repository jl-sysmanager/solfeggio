import { missingDependencies, withDependencies } from './feature-catalog';

describe('feature-catalog', () => {
  it('añade dependencias transitivas', () => {
    expect(withDependencies(['archive_ai']).sort()).toEqual(['archive', 'archive_ai']);
    expect(withDependencies(['school']).sort()).toEqual(['members', 'school']);
  });

  it('detecta dependencias rotas', () => {
    expect(missingDependencies(['attendance'])).toEqual([{ feature: 'attendance', requires: 'events' }]);
    expect(missingDependencies(withDependencies(['attendance']))).toEqual([]);
  });
});
