import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { useState } from 'react';
import { Card, StatCard } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { TextField } from '../components/Field';
import { chargeStatus } from '../lib/labels';
import { money, parseMoney } from '../lib/format';

describe('componentes base', () => {
  it('Card renderiza título como encabezado y contenido', () => {
    render(<Card title="Próximos eventos">contenido</Card>);
    expect(screen.getByRole('heading', { name: 'Próximos eventos' })).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('StatCard expone un meter accesible', () => {
    render(<StatCard label="Asistencia" value="80 %" meter={0.8} />);
    const meter = screen.getByRole('meter', { name: 'Asistencia' });
    expect(meter).toHaveAttribute('aria-valuenow', '80');
  });

  it('StatusChip muestra la etiqueta en texto (no sólo color)', () => {
    render(<StatusChip value="OVERDUE" map={chargeStatus} />);
    expect(screen.getByText('Vencida')).toHaveClass('chip', 'chip--danger');
  });

  it('DataTable pinta cabeceras y data-label para la vista móvil', () => {
    render(
      <DataTable
        caption="Socios"
        rows={[{ id: '1', name: 'Ana' }]}
        rowKey={(r) => r.id}
        columns={[{ key: 'n', header: 'Nombre', render: (r) => r.name }]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Socios' });
    expect(within(table).getByRole('columnheader', { name: 'Nombre' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Ana' })).toHaveAttribute('data-label', 'Nombre');
  });

  it('DataTable vacía muestra estado vacío', () => {
    render(<DataTable caption="x" rows={[]} rowKey={() => ''} columns={[]} empty="Nada aquí" />);
    expect(screen.getByText('Nada aquí')).toBeInTheDocument();
  });

  it('TextField asocia etiqueta, ayuda y error', () => {
    render(<TextField label="Email" hint="Tu email" error="Obligatorio" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toMatch(/hint/);
    expect(input.getAttribute('aria-describedby')).toMatch(/error/);
  });

  it('Modal es un diálogo accesible que se cierra con Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Alta de socio">
          <button>Guardar</button>
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Alta de socio' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('formatea y parsea importes en euros', () => {
    expect(parseMoney('120,50')).toBe(12050);
    expect(parseMoney('1.200,00')).toBe(120000);
    expect(money(12050).replace(/\s/g, ' ')).toMatch(/120,50/);
  });
});
