import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireTenant, FeaturePage, Guard } from './auth/guards';
import { AppShell } from './components/AppShell';
import { Loading } from './components/EmptyState';
import { LoginPage, RegisterPage, AcceptInvitePage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/Auth';
import { OnboardingPage, TenantPickerPage } from './pages/Onboarding';
import { DashboardPage } from './pages/Dashboard';

const Members = lazy(() => import('./pages/Members'));
const MemberDetail = lazy(() => import('./pages/MemberDetail'));
const Archive = lazy(() => import('./pages/Archive'));
const WorkDetail = lazy(() => import('./pages/WorkDetail'));
const Events = lazy(() => import('./pages/Events'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const Agenda = lazy(() => import('./pages/Agenda'));
const AttendanceStats = lazy(() => import('./pages/AttendanceStats'));
const Treasury = lazy(() => import('./pages/Treasury'));
const Wardrobe = lazy(() => import('./pages/Wardrobe'));
const Instruments = lazy(() => import('./pages/Instruments'));
const InstrumentDetail = lazy(() => import('./pages/InstrumentDetail'));
const Market = lazy(() => import('./pages/Market'));
const Communications = lazy(() => import('./pages/Communications'));
const Documents = lazy(() => import('./pages/Documents'));
const Settings = lazy(() => import('./pages/Settings'));
const Billing = lazy(() => import('./pages/Billing'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Security = lazy(() => import('./pages/Security'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminTenant = lazy(() => import('./pages/AdminTenant'));
const School = lazy(() => import('./pages/School'));
const StudentDetail = lazy(() => import('./pages/StudentDetail'));
const FamilyPortal = lazy(() => import('./pages/FamilyPortal'));
const EnrollPublic = lazy(() => import('./pages/EnrollPublic'));
const Performances = lazy(() => import('./pages/Performances'));
const Reinforcements = lazy(() => import('./pages/Reinforcements'));
const Governance = lazy(() => import('./pages/Governance'));
const AssemblyDetail = lazy(() => import('./pages/AssemblyDetail'));

function Shell({ children, tenant = true }: { children: ReactNode; tenant?: boolean }) {
  const content = (
    <AppShell>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </AppShell>
  );
  return <RequireAuth>{tenant ? <RequireTenant>{content}</RequireTenant> : content}</RequireAuth>;
}

/** Ruta de módulo con permiso + funcionalidad del plan. */
function Mod({ perm, feature, title, children }: { perm: string[]; feature: string; title: string; children: ReactNode }) {
  return (
    <Shell>
      <Guard perm={perm}>
        <FeaturePage feature={feature} title={title}>
          {children}
        </FeaturePage>
      </Guard>
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/enroll/:slug" element={<Suspense fallback={<Loading />}><EnrollPublic /></Suspense>} />
      <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
      <Route path="/select-band" element={<RequireAuth><TenantPickerPage /></RequireAuth>} />

      <Route path="/" element={<Shell><DashboardPage /></Shell>} />
      <Route path="/notifications" element={<Shell><Notifications /></Shell>} />
      <Route path="/account" element={<Shell tenant={false}><Security /></Shell>} />
      <Route path="/security" element={<Navigate to="/account?tab=seguridad" replace />} />

      <Route path="/members" element={<Mod perm={['members:read']} feature="members" title="Miembros"><Members /></Mod>} />
      <Route path="/access" element={<Navigate to="/members?access=users" replace />} />
      <Route path="/members/:id" element={<Mod perm={['members:read']} feature="members" title="Socio"><MemberDetail /></Mod>} />
      <Route path="/communications" element={<Mod perm={['communications:send']} feature="communications" title="Comunicaciones"><Communications /></Mod>} />
      <Route path="/documents" element={<Mod perm={['documents:read']} feature="members" title="Documentos"><Documents /></Mod>} />

      <Route path="/archive" element={<Mod perm={['archive:read']} feature="archive" title="Archivo musical"><Archive /></Mod>} />
      <Route path="/archive/:id" element={<Mod perm={['archive:read']} feature="archive" title="Obra"><WorkDetail /></Mod>} />

      <Route path="/events" element={<Mod perm={['events:read']} feature="events" title="Ensayos y actuaciones"><Events /></Mod>} />
      <Route path="/events/:id" element={<Mod perm={['events:read']} feature="events" title="Evento"><EventDetail /></Mod>} />
      <Route path="/agenda" element={<Mod perm={['events:read']} feature="events" title="Agenda"><Agenda /></Mod>} />
      <Route path="/attendance" element={<Mod perm={['attendance:read']} feature="attendance" title="Asistencia"><AttendanceStats /></Mod>} />

      <Route path="/treasury" element={<Mod perm={['finance:read']} feature="treasury" title="Tesorería"><Treasury /></Mod>} />
      <Route path="/wardrobe" element={<Mod perm={['wardrobe:read']} feature="wardrobe" title="Mayordomía"><Wardrobe /></Mod>} />
      <Route path="/instruments" element={<Mod perm={['instruments:read']} feature="instruments" title="Instrumentación"><Instruments /></Mod>} />
      <Route path="/instruments/:id" element={<Mod perm={['instruments:read']} feature="instruments" title="Instrumento"><InstrumentDetail /></Mod>} />
      <Route path="/market" element={<Mod perm={['market:read']} feature="market" title="BandMarket"><Market /></Mod>} />

      <Route path="/school" element={<Mod perm={['school:read']} feature="school" title="Escuela de música"><School /></Mod>} />
      <Route path="/school/students/:id" element={<Mod perm={['school:read']} feature="school" title="Alumno"><StudentDetail /></Mod>} />
      <Route path="/family" element={<Mod perm={['school:family']} feature="school" title="Portal de familias"><FamilyPortal /></Mod>} />
      <Route path="/performances" element={<Mod perm={['performances:read']} feature="performances" title="Contrataciones"><Performances /></Mod>} />
      <Route path="/reinforcements" element={<Shell><FeaturePage feature="reinforcements" title="Bolsa de refuerzos"><Reinforcements /></FeaturePage></Shell>} />
      <Route path="/governance" element={<Mod perm={['governance:read']} feature="governance" title="Gobierno"><Governance /></Mod>} />
      <Route path="/governance/assemblies/:id" element={<Mod perm={['governance:read']} feature="governance" title="Asamblea"><AssemblyDetail /></Mod>} />

      <Route path="/settings" element={<Shell><Guard perm={['tenant:manage', 'audit:read']}><Settings /></Guard></Shell>} />
      <Route path="/billing" element={<Shell><Guard perm={['billing:manage']}><Billing /></Guard></Shell>} />
      <Route path="/incidents" element={<Shell><Guard perm={['incidents:write']}><Incidents /></Guard></Shell>} />
      <Route path="/admin" element={<Navigate to="/admin/metrics" replace />} />
      <Route path="/admin/:section" element={<Shell tenant={false}><Guard admin><Admin /></Guard></Shell>} />
      <Route path="/admin/tenants/:id" element={<Shell tenant={false}><Guard admin><AdminTenant /></Guard></Shell>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
