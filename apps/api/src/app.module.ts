import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AdminUsersController } from './admin/admin-users.controller';
import { AgendaController } from './agenda/agenda.controller';
import { ArchiveController } from './archive/archive.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { AuditModule } from './audit/audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AdminBillingController } from './billing/admin-billing.controller';
import { BillingController } from './billing/billing.controller';
import { BillingOpsService } from './billing/billing-ops.service';
import { BillingService } from './billing/billing.service';
import { PlanSync } from './billing/plan-sync';
import { StripeClient } from './billing/stripe.provider';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { loggerModule } from './common/logger';
import { env } from './config/env';
import { DbModule } from './db/db.service';
import { EventsController } from './events/events.controller';
import { HealthController } from './health/health.controller';
import { IamController } from './iam/iam.controller';
import { InstrumentsController } from './instruments/instruments.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.service';
import { MarketController } from './market/market.controller';
import { MembersController } from './members/members.controller';
import { SecretaryController } from './members/secretary.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { StorageModule } from './storage/storage.service';
import { Uploads } from './storage/upload';
import { LimitsService } from './tenancy/limits.service';
import { OnboardingService } from './tenancy/onboarding.service';
import { TenancyController } from './tenancy/tenancy.controller';
import { TreasuryController } from './treasury/treasury.controller';
import { WardrobeController } from './wardrobe/wardrobe.controller';
import { AdminInsightsController } from './platform/admin-insights.controller';
import { AdminOpsController } from './platform/admin-ops.controller';
import { AdminSupportController } from './platform/admin-support.controller';
import { BrandController } from './platform/brand.controller';
import { AnnouncementsController } from './platform/announcements.controller';
import { ImpersonationController } from './platform/impersonation.controller';
import { InsightsService } from './platform/insights.service';
import { OpsService } from './platform/ops.service';
import { TenantBackupService } from './platform/tenant-backup.service';
import { SupportService } from './platform/support.service';
import { ArchiveExtrasController } from './archive/archive-extras.controller';
import { GovernanceController } from './governance/governance.controller';
import { PerformancesController } from './performances/performances.controller';
import { StaffingController } from './performances/staffing.controller';
import { ReinforcementsController } from './reinforcements/reinforcements.controller';
import { FamilyController } from './school/family.controller';
import { SchoolPublicController } from './school/school-public.controller';
import { SchoolController } from './school/school.controller';
import { TuitionController } from './school/tuition.controller';
import { TreasuryExtrasController } from './treasury/treasury-extras.controller';

/**
 * Monolito modular: cada carpeta de `src/` es un dominio con su controlador; la infraestructura
 * transversal (BD, auditoría, cola, almacenamiento, auth) son módulos globales.
 */
@Module({
  imports: [
    loggerModule(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: env().RATE_LIMIT_TTL_MS, limit: env().RATE_LIMIT_MAX }]),
    DbModule,
    AuditModule,
    JobsModule,
    StorageModule,
    AuthModule,
    IntegrationsModule,
  ],
  controllers: [
    HealthController,
    TenancyController,
    IamController,
    MembersController,
    SecretaryController,
    ArchiveController,
    EventsController,
    AttendanceController,
    AgendaController,
    TreasuryController,
    WardrobeController,
    InstrumentsController,
    NotificationsController,
    MarketController,
    BillingController,
    AdminController,
    AdminUsersController,
    IntegrationsController,
    SchoolController,
    SchoolPublicController,
    FamilyController,
    TuitionController,
    PerformancesController,
    StaffingController,
    ReinforcementsController,
    ArchiveExtrasController,
    GovernanceController,
    TreasuryExtrasController,
    AdminInsightsController,
    ImpersonationController,
    AdminBillingController,
    AdminSupportController,
    AnnouncementsController,
    AdminOpsController,
    BrandController,
  ],
  providers: [
    LimitsService,
    OnboardingService,
    Uploads,
    StripeClient,
    BillingService,
    PlanSync,
    BillingOpsService,
    InsightsService,
    SupportService,
    OpsService,
    TenantBackupService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
