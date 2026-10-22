-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('SCORE', 'PART', 'AUDIO', 'OTHER');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('REHEARSAL', 'PERFORMANCE', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'DONE');

-- CreateEnum
CREATE TYPE "CallResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "JustificationStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "Periodicity" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('NEW', 'GOOD', 'WORN', 'DAMAGED');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('MAINTENANCE', 'REPAIR');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SOLD', 'ARCHIVED');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyCents" INTEGER NOT NULL,
    "priceYearlyCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "stripePriceMonthly" TEXT,
    "stripePriceYearly" TEXT,
    "maxUsers" INTEGER NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "storageMb" INTEGER NOT NULL,
    "features" TEXT[],
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "country" TEXT NOT NULL DEFAULT 'ES',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "locale" TEXT NOT NULL DEFAULT 'es-ES',
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIALING',
    "planId" UUID NOT NULL,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "onboardedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeStatus" TEXT,
    "interval" "BillingInterval",
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "graceUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL,
    "hostedUrl" TEXT,
    "pdfUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "openedById" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tenantId" UUID,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "memberId" UUID,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "calendarToken" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "memberId" UUID,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "memberNumber" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "birthDate" DATE,
    "nationalIdEnc" TEXT,
    "ibanEnc" TEXT,
    "address" TEXT,
    "instrument" TEXT,
    "sectionId" UUID,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATE,
    "leaveReason" TEXT,
    "consentDataAt" TIMESTAMP(3),
    "consentImages" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL DEFAULT 'IN_APP',
    "audience" JSONB NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "memberId" UUID,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "birthYear" INTEGER,
    "deathYear" INTEGER,
    "nationality" TEXT,

    CONSTRAINT "composers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "works" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "composerId" UUID,
    "arranger" TEXT,
    "genre" TEXT,
    "durationSec" INTEGER,
    "difficulty" INTEGER,
    "year" INTEGER,
    "publisher" TEXT,
    "catalogCode" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "search" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "arranger" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workId" UUID NOT NULL,
    "versionId" UUID,
    "kind" "AssetKind" NOT NULL,
    "instrument" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reminderMinutes" INTEGER[] DEFAULT ARRAY[1440]::INTEGER[],
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_repertoire" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "workId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "event_repertoire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_calls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "response" "CallResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "event_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "justification" TEXT,
    "justificationStatus" "JustificationStatus" NOT NULL DEFAULT 'NONE',
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TxKind" NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "TxKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "date" DATE NOT NULL,
    "categoryId" UUID,
    "description" TEXT NOT NULL,
    "memberId" UUID,
    "receiptKey" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "periodicity" "Periodicity" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feeId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "transactionId" UUID,

    CONSTRAINT "fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_sizes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "garment" TEXT NOT NULL,
    "size" TEXT NOT NULL,

    CONSTRAINT "member_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uniform_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "garment" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "condition" "ItemCondition" NOT NULL DEFAULT 'GOOD',
    "status" "StockStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uniform_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uniform_loans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "conditionOut" "ItemCondition" NOT NULL,
    "conditionIn" "ItemCondition",
    "notes" TEXT,

    CONSTRAINT "uniform_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "inventoryCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATE,
    "purchasePriceCents" INTEGER,
    "condition" "ItemCondition" NOT NULL DEFAULT 'GOOD',
    "status" "StockStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "instrument_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "provider" TEXT,
    "costCents" INTEGER,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "condition" "ItemCondition" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "location" TEXT,
    "imageKeys" TEXT[],
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationNote" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_inquiries" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "sellerTenantId" UUID NOT NULL,
    "buyerTenantId" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_reports" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "reporterTenantId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripeInvoiceId_key" ON "invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_createdAt_idx" ON "invoices"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "incidents_tenant_id_status_idx" ON "incidents"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_memberId_key" ON "memberships"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_calendarToken_key" ON "memberships"("calendarToken");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_userId_key" ON "memberships"("tenant_id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_idx" ON "invitations"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_createdAt_idx" ON "audit_logs"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_entityId_idx" ON "audit_logs"("tenant_id", "entity", "entityId");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_userId_readAt_idx" ON "notifications"("tenant_id", "userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "sections_tenant_id_name_key" ON "sections"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "members_tenant_id_status_idx" ON "members"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "members_tenant_id_lastName_idx" ON "members"("tenant_id", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenant_id_memberNumber_key" ON "members"("tenant_id", "memberNumber");

-- CreateIndex
CREATE INDEX "communications_tenant_id_createdAt_idx" ON "communications"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "documents_tenant_id_category_idx" ON "documents"("tenant_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "composers_tenant_id_name_key" ON "composers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "works_tenant_id_title_idx" ON "works"("tenant_id", "title");

-- CreateIndex
CREATE INDEX "assets_tenant_id_workId_idx" ON "assets"("tenant_id", "workId");

-- CreateIndex
CREATE INDEX "events_tenant_id_startsAt_idx" ON "events"("tenant_id", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_repertoire_eventId_workId_key" ON "event_repertoire"("eventId", "workId");

-- CreateIndex
CREATE UNIQUE INDEX "event_calls_eventId_memberId_key" ON "event_calls"("eventId", "memberId");

-- CreateIndex
CREATE INDEX "attendance_tenant_id_memberId_idx" ON "attendance"("tenant_id", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_eventId_memberId_key" ON "attendance"("eventId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_tenant_id_name_kind_key" ON "finance_categories"("tenant_id", "name", "kind");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_date_idx" ON "transactions"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "fee_charges_tenant_id_status_idx" ON "fee_charges"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_charges_feeId_memberId_period_key" ON "fee_charges"("feeId", "memberId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "member_sizes_memberId_garment_key" ON "member_sizes"("memberId", "garment");

-- CreateIndex
CREATE UNIQUE INDEX "uniform_items_tenant_id_code_key" ON "uniform_items"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "uniform_loans_tenant_id_itemId_idx" ON "uniform_loans"("tenant_id", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_tenant_id_inventoryCode_key" ON "instruments"("tenant_id", "inventoryCode");

-- CreateIndex
CREATE INDEX "instrument_assignments_tenant_id_instrumentId_idx" ON "instrument_assignments"("tenant_id", "instrumentId");

-- CreateIndex
CREATE INDEX "maintenance_records_tenant_id_instrumentId_idx" ON "maintenance_records"("tenant_id", "instrumentId");

-- CreateIndex
CREATE INDEX "listings_status_category_idx" ON "listings"("status", "category");

-- CreateIndex
CREATE INDEX "listings_tenant_id_idx" ON "listings"("tenant_id");

-- CreateIndex
CREATE INDEX "listing_inquiries_listingId_idx" ON "listing_inquiries"("listingId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "works" ADD CONSTRAINT "works_composerId_fkey" FOREIGN KEY ("composerId") REFERENCES "composers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_workId_fkey" FOREIGN KEY ("workId") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workId_fkey" FOREIGN KEY ("workId") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "work_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_repertoire" ADD CONSTRAINT "event_repertoire_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_repertoire" ADD CONSTRAINT "event_repertoire_workId_fkey" FOREIGN KEY ("workId") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_calls" ADD CONSTRAINT "event_calls_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_calls" ADD CONSTRAINT "event_calls_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_sizes" ADD CONSTRAINT "member_sizes_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uniform_loans" ADD CONSTRAINT "uniform_loans_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "uniform_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uniform_loans" ADD CONSTRAINT "uniform_loans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_assignments" ADD CONSTRAINT "instrument_assignments_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_assignments" ADD CONSTRAINT "instrument_assignments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
