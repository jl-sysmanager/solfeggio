import { useAuth } from '../auth/AuthProvider';
import { Page, PageHeader } from '../components/PageHeader';
import { ApplicationsTab } from '../components/school/ApplicationsTab';
import { ClassesTab } from '../components/school/ClassesTab';
import { FamiliesTab } from '../components/school/FamiliesTab';
import { GroupsTab } from '../components/school/GroupsTab';
import { SettingsTab } from '../components/school/SettingsTab';
import { StudentsTab } from '../components/school/StudentsTab';
import { TuitionTab } from '../components/school/TuitionTab';
import type { TabDef } from '../components/Tabs';
import { Tabs } from '../components/Tabs';

export default function SchoolPage() {
  const { can } = useAuth();
  const manager = can('school:write');
  const tabs: TabDef[] = [
    { id: 'students', label: 'Alumnos', content: <StudentsTab /> },
    { id: 'families', label: 'Familias', content: <FamiliesTab /> },
    { id: 'groups', label: 'Grupos y horarios', content: <GroupsTab /> },
    { id: 'applications', label: 'Matrículas', content: <ApplicationsTab /> },
    { id: 'classes', label: 'Clases', content: <ClassesTab /> },
    ...(can('finance:read') ? [{ id: 'tuition', label: 'Mensualidades', content: <TuitionTab /> }] : []),
    { id: 'settings', label: 'Configuración', content: <SettingsTab /> },
  ];
  return (
    <Page header={<PageHeader eyebrow="Escuela" title="Escuela de música" description="Alumnos y familias, matrícula online, horarios, asistencia, evaluación y mensualidades." />}>
      {/* El profesorado entra directamente a sus clases. */}
      <Tabs label="Secciones de la escuela" tabs={tabs} initial={manager ? 'students' : 'classes'} />
    </Page>
  );
}
