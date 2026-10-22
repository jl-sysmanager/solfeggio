import { AssembliesTab } from '../components/governance/AssembliesTab';
import { BoardTab } from '../components/governance/BoardTab';
import { MinutesBookTab } from '../components/governance/MinutesBookTab';
import { PollsTab } from '../components/governance/PollsTab';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';

export default function GovernancePage() {
  return (
    <Page header={<PageHeader eyebrow="Asociación" title="Gobierno" description="Asambleas, votaciones, junta directiva, encuestas y libro de actas." />}>
      <Tabs
        label="Secciones de gobierno"
        tabs={[
          { id: 'assemblies', label: 'Asambleas', content: <AssembliesTab /> },
          { id: 'board', label: 'Junta directiva', content: <BoardTab /> },
          { id: 'polls', label: 'Encuestas', content: <PollsTab /> },
          { id: 'minutes', label: 'Libro de actas', content: <MinutesBookTab /> },
        ]}
      />
    </Page>
  );
}
