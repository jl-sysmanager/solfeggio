import { useAuth } from '../auth/AuthProvider';
import { ButtonLink } from '../components/Button';
import { Page, PageHeader } from '../components/PageHeader';
import { ApplicationsTab } from '../components/school/ApplicationsTab';
import { ClassesTab } from '../components/school/ClassesTab';
import { FamiliesTab } from '../components/school/FamiliesTab';
import { GroupsTab } from '../components/school/GroupsTab';
import { OverviewTab } from '../components/school/OverviewTab';
import { SettingsTab } from '../components/school/SettingsTab';
import { StudentsTab } from '../components/school/StudentsTab';
import { TuitionTab } from '../components/school/TuitionTab';
import type { TabDef } from '../components/Tabs';
import { UrlTabs } from '../components/Tabs';

export default function SchoolPage() {
  const { can } = useAuth();
  const manager = can('school:write');
  const tabs: TabDef[] = [
    // Inicio: lo que falta por configurar, cifras del curso y, para el profesorado, sus clases de hoy.
    { id: 'home', label: 'Inicio', content: <OverviewTab /> },
    { id: 'students', label: 'Alumnos', content: <StudentsTab /> },
    ...(manager ? [{ id: 'families', label: 'Familias', content: <FamiliesTab /> }] : []),
    { id: 'groups', label: 'Grupos y horarios', content: <GroupsTab /> },
    ...(manager ? [{ id: 'applications', label: 'Matrículas', content: <ApplicationsTab /> }] : []),
    { id: 'classes', label: 'Clases', content: <ClassesTab /> },
    ...(can('school:tuition') ? [{ id: 'tuition', label: 'Mensualidades', content: <TuitionTab /> }] : []),
    { id: 'settings', label: 'Configuración', content: <SettingsTab /> },
  ];
  return (
    <Page
      header={
        <PageHeader
          eyebrow="Escuela"
          title="Escuela de música"
          description="Alumnos y familias, matrícula online, horarios, asistencia, evaluación y mensualidades."
          actions={manager && <ButtonLink to="/school?tab=settings" variant="ghost">Configuración</ButtonLink>}
        />
      }
    >
      <UrlTabs label="Secciones de la escuela" tabs={tabs} />
    </Page>
  );
}
