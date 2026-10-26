import { useState } from 'react';
import { date } from '../../lib/format';
import { Button } from '../Button';
import { TextField } from '../Field';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (v: string) => new Date(`${v}T00:00:00Z`);

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const between = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = utc(from); d <= utc(to); d = new Date(d.getTime() + DAY)) out.push(iso(d));
  return out;
};

const yearsIn = (from: string, to: string) => {
  const ys: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) ys.push(y);
  return ys;
};

/** Festivos nacionales de España entre dos fechas (los autonómicos y locales se añaden a mano). */
export function nationalHolidays(from: string, to: string) {
  const fixed = ['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];
  return yearsIn(from, to)
    .flatMap((y) => [...fixed.map((md) => `${y}-${md}`), iso(new Date(easter(y).getTime() - 2 * DAY))])
    .filter((d) => d >= from && d <= to)
    .sort();
}

/** Navidad (23 dic – 7 ene) y Semana Santa (jueves santo – lunes de Pascua) dentro del curso. */
function presets(from: string, to: string) {
  const ys = yearsIn(from, to);
  const clip = (days: string[]) => days.filter((d) => d >= from && d <= to);
  return {
    christmas: clip(ys.flatMap((y) => between(`${y}-12-23`, `${y + 1}-01-07`))),
    easter: clip(ys.flatMap((y) => between(iso(new Date(easter(y).getTime() - 3 * DAY)), iso(new Date(easter(y).getTime() + DAY))))),
  };
}

/** Agrupa días seguidos para mostrarlos como periodos («23 dic – 7 ene»). */
export function holidayRanges(days: string[]) {
  const sorted = [...new Set(days)].sort();
  const ranges: { from: string; to: string }[] = [];
  for (const d of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && utc(d).getTime() - utc(last.to).getTime() === DAY) last.to = d;
    else ranges.push({ from: d, to: d });
  }
  return ranges;
}

const short = (d: string) => date(d, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Festivos y días sin clase con calendario: días sueltos, periodos y atajos (nacionales, Navidad,
 * Semana Santa). Las sesiones de clase se saltan estos días.
 */
export function HolidaysField({ value, onChange, startsOn, endsOn }: { value: string[]; onChange: (days: string[]) => void; startsOn?: string; endsOn?: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const add = (days: string[]) => onChange([...new Set([...value, ...days])].sort());
  const ready = !!startsOn && !!endsOn && startsOn <= endsOn;
  const p = ready ? presets(startsOn, endsOn) : null;
  return (
    <fieldset className="stack" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
      <legend className="label-caps">Festivos y días sin clase</legend>
      {ready && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => add(nationalHolidays(startsOn, endsOn))}>
            + Festivos nacionales
          </Button>
          <Button size="sm" variant="ghost" onClick={() => add(p!.christmas)}>
            + Navidad
          </Button>
          <Button size="sm" variant="ghost" onClick={() => add(p!.easter)}>
            + Semana Santa
          </Button>
        </div>
      )}
      <div className="toolbar">
        <TextField label="Desde" type="date" value={from} min={startsOn} max={endsOn} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Hasta (opcional)" type="date" value={to} min={from || startsOn} max={endsOn} onChange={(e) => setTo(e.target.value)} />
        <Button
          variant="ghost"
          disabled={!from || (!!to && to < from)}
          onClick={() => {
            add(between(from, to || from));
            setFrom('');
            setTo('');
          }}
        >
          Añadir
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="small muted">Sin festivos. Añade los nacionales, los locales y las vacaciones.</p>
      ) : (
        <ul className="chips list-plain" aria-label="Festivos añadidos">
          {holidayRanges(value).map((r) => {
            const label = r.from === r.to ? short(r.from) : `${short(r.from)} – ${short(r.to)}`;
            return (
              <li key={r.from} className="chip chip--outline chip--plain">
                {label}{' '}
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  style={{ minHeight: 0, padding: '0 4px' }}
                  aria-label={`Quitar ${label}`}
                  onClick={() => {
                    const drop = new Set(between(r.from, r.to));
                    onChange(value.filter((d) => !drop.has(d)));
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
