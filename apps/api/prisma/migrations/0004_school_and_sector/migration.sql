-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "StudentBandStage" AS ENUM ('NONE', 'EDUCANDO', 'MUSICIAN');

-- CreateEnum
CREATE TYPE "SubjectKind" AS ENUM ('INSTRUMENT', 'THEORY', 'ENSEMBLE', 'OTHER');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITLIST', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'WAITLISTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClassSessionStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'DONE');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('CITY_COUNCIL', 'BROTHERHOOD', 'FESTIVAL_COMMITTEE', 'PRIVATE', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReinforcementStatus" AS ENUM ('OPEN', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LoanDirection" AS ENUM ('LENT', 'BORROWED');

-- CreateEnum
CREATE TYPE "AssemblyType" AS ENUM ('ORDINARY', 'EXTRAORDINARY');

-- CreateEnum
CREATE TYPE "AssemblyStatus" AS ENUM ('DRAFT', 'CONVENED', 'HELD', 'CLOSED');

-- CreateEnum
CREATE TYPE "MotionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('YES', 'NO', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('REQUESTED', 'AWARDED', 'JUSTIFIED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DonorKind" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "DonationKind" AS ENUM ('DONATION', 'SPONSORSHIP');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "maxStudents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "addons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "studentSeats" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "guardianId" UUID;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "guardianId" UUID;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "grantId" UUID;

-- CreateTable
CREATE TABLE "school_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "siblingDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "memberDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "multiSubjectDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "publicIntro" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "families" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ibanEnc" TEXT,
    "ibanHolder" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "relationship" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "nationalIdEnc" TEXT,
    "memberId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "familyId" UUID,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" DATE,
    "email" TEXT,
    "phone" TEXT,
    "instrument" TEXT,
    "imageConsent" BOOLEAN NOT NULL DEFAULT false,
    "pickupAuthorized" TEXT[],
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "bandStage" "StudentBandStage" NOT NULL DEFAULT 'NONE',
    "memberId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "holidays" DATE[],
    "enrollmentOpen" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SubjectKind" NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "userId" UUID,
    "memberId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,
    "teacherId" UUID,
    "capacity" INTEGER,
    "monthlyFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_slots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "roomId" UUID,

    CONSTRAINT "class_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "renewal" BOOLEAN NOT NULL DEFAULT false,
    "studentFirstName" TEXT NOT NULL,
    "studentLastName" TEXT NOT NULL,
    "studentBirthDate" DATE,
    "guardianName" TEXT NOT NULL,
    "guardianEmail" TEXT NOT NULL,
    "guardianPhone" TEXT,
    "subjectIds" UUID[],
    "notes" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "auditionAt" TIMESTAMP(3),
    "auditionResult" TEXT,
    "studentId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "status" "ClassSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "makeUpForId" UUID,
    "notes" TEXT,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,

    CONSTRAINT "class_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "term" INTEGER NOT NULL,
    "scoreTenths" INTEGER,
    "qualitative" TEXT,
    "comment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tuition_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "familyId" UUID,
    "period" TEXT NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "transactionId" UUID,

    CONSTRAINT "tuition_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_notices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "groupId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ClientKind" NOT NULL DEFAULT 'OTHER',
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contactName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_quotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "clientId" UUID NOT NULL,
    "eventId" UUID,
    "title" TEXT NOT NULL,
    "performanceAt" TIMESTAMP(3),
    "location" TEXT,
    "lines" JSONB NOT NULL,
    "taxRatePct" INTEGER NOT NULL DEFAULT 0,
    "baseCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "validUntil" DATE,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "contractTerms" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "series" TEXT NOT NULL DEFAULT 'A',
    "number" INTEGER NOT NULL,
    "issueDate" DATE NOT NULL,
    "clientId" UUID NOT NULL,
    "quoteId" UUID,
    "clientSnapshot" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "taxRatePct" INTEGER NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "rectifiesId" UUID,
    "paidAt" TIMESTAMP(3),
    "transactionId" UUID,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_requirements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "instrument" TEXT NOT NULL,
    "required" INTEGER NOT NULL,

    CONSTRAINT "event_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logistics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "transport" TEXT,
    "departurePlace" TEXT,
    "departureAt" TIMESTAMP(3),
    "returnAt" TIMESTAMP(3),
    "route" TEXT,
    "uniform" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_logistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "musician_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "instruments" TEXT[],
    "province" TEXT NOT NULL,
    "city" TEXT,
    "bio" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "musician_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reinforcement_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eventId" UUID,
    "title" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "date" TIMESTAMP(3) NOT NULL,
    "province" TEXT NOT NULL,
    "location" TEXT,
    "feeCents" INTEGER,
    "description" TEXT,
    "status" "ReinforcementStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinforcement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reinforcement_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "message" TEXT,
    "status" "ApplicationDecision" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinforcement_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_musicians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "userId" UUID,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "instrument" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "nationalIdEnc" TEXT,
    "ibanEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_musicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reinforcement_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "musicianId" UUID NOT NULL,
    "eventId" UUID,
    "concept" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "withholdingPct" INTEGER NOT NULL DEFAULT 15,
    "withholdingCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "transactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinforcement_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booklets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booklets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booklet_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bookletId" UUID NOT NULL,
    "workId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT,

    CONSTRAINT "booklet_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_loans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workId" UUID NOT NULL,
    "direction" "LoanDirection" NOT NULL,
    "counterparty" TEXT NOT NULL,
    "contact" TEXT,
    "loanedAt" DATE NOT NULL,
    "dueAt" DATE,
    "returnedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assemblies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "AssemblyType" NOT NULL,
    "title" TEXT NOT NULL,
    "firstCallAt" TIMESTAMP(3) NOT NULL,
    "secondCallAt" TIMESTAMP(3),
    "location" TEXT,
    "agenda" JSONB NOT NULL,
    "quorumPct" INTEGER NOT NULL DEFAULT 50,
    "status" "AssemblyStatus" NOT NULL DEFAULT 'DRAFT',
    "convenedAt" TIMESTAMP(3),
    "minutes" TEXT,
    "minutesApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assemblies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assemblyId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "proxyForId" UUID,

    CONSTRAINT "assembly_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assemblyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "allowRemote" BOOLEAN NOT NULL DEFAULT true,
    "status" "MotionStatus" NOT NULL DEFAULT 'DRAFT',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "motions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motion_votes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "motionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motion_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_positions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "notes" TEXT,

    CONSTRAINT "board_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pollId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "choices" INTEGER[],
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "grantor" TEXT NOT NULL,
    "reference" TEXT,
    "year" INTEGER NOT NULL,
    "requestedCents" INTEGER,
    "awardedCents" INTEGER,
    "awardedAt" DATE,
    "justificationDue" DATE,
    "status" "GrantStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_draws" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "drawDate" DATE NOT NULL,
    "numbers" TEXT[],
    "ticketPriceCents" INTEGER NOT NULL,
    "stakeCents" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_books" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "drawId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "number" TEXT,
    "memberId" UUID,
    "holderName" TEXT,
    "tickets" INTEGER NOT NULL,
    "returnedTickets" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "transactionId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "DonorKind" NOT NULL DEFAULT 'PERSON',
    "name" TEXT NOT NULL,
    "taxIdEnc" TEXT,
    "taxIdHint" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "province" TEXT,
    "email" TEXT,
    "memberId" UUID,
    "sponsor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "donorId" UUID NOT NULL,
    "kind" "DonationKind" NOT NULL DEFAULT 'DONATION',
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "inKind" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "transactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_settings_tenant_id_key" ON "school_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "families_tenant_id_name_idx" ON "families"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_familyId_idx" ON "guardians"("tenant_id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "students_memberId_key" ON "students"("memberId");

-- CreateIndex
CREATE INDEX "students_tenant_id_status_idx" ON "students"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "students_tenant_id_lastName_idx" ON "students"("tenant_id", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "school_years_tenant_id_name_key" ON "school_years"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_tenant_id_name_key" ON "subjects"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_name_key" ON "rooms"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "class_groups_tenant_id_yearId_idx" ON "class_groups"("tenant_id", "yearId");

-- CreateIndex
CREATE INDEX "class_slots_tenant_id_weekday_idx" ON "class_slots"("tenant_id", "weekday");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_studentId_idx" ON "enrollments"("tenant_id", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_groupId_studentId_key" ON "enrollments"("groupId", "studentId");

-- CreateIndex
CREATE INDEX "enrollment_applications_tenant_id_status_idx" ON "enrollment_applications"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "class_sessions_tenant_id_date_idx" ON "class_sessions"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_groupId_date_startMin_key" ON "class_sessions"("groupId", "date", "startMin");

-- CreateIndex
CREATE INDEX "class_attendance_tenant_id_studentId_idx" ON "class_attendance"("tenant_id", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "class_attendance_sessionId_studentId_key" ON "class_attendance"("sessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "grades_enrollmentId_term_key" ON "grades"("enrollmentId", "term");

-- CreateIndex
CREATE INDEX "tuition_charges_tenant_id_period_idx" ON "tuition_charges"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "tuition_charges_studentId_period_key" ON "tuition_charges"("studentId", "period");

-- CreateIndex
CREATE INDEX "school_notices_tenant_id_createdAt_idx" ON "school_notices"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "clients_tenant_id_name_idx" ON "clients"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "performance_quotes_tenant_id_number_key" ON "performance_quotes"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_tenant_id_series_number_key" ON "client_invoices"("tenant_id", "series", "number");

-- CreateIndex
CREATE UNIQUE INDEX "event_requirements_eventId_instrument_key" ON "event_requirements"("eventId", "instrument");

-- CreateIndex
CREATE UNIQUE INDEX "event_logistics_eventId_key" ON "event_logistics"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "musician_profiles_userId_key" ON "musician_profiles"("userId");

-- CreateIndex
CREATE INDEX "musician_profiles_province_idx" ON "musician_profiles"("province");

-- CreateIndex
CREATE INDEX "reinforcement_requests_status_province_instrument_idx" ON "reinforcement_requests"("status", "province", "instrument");

-- CreateIndex
CREATE INDEX "reinforcement_requests_tenant_id_idx" ON "reinforcement_requests"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reinforcement_applications_requestId_userId_key" ON "reinforcement_applications"("requestId", "userId");

-- CreateIndex
CREATE INDEX "external_musicians_tenant_id_lastName_idx" ON "external_musicians"("tenant_id", "lastName");

-- CreateIndex
CREATE INDEX "reinforcement_payments_tenant_id_date_idx" ON "reinforcement_payments"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "booklets_tenant_id_name_key" ON "booklets"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "booklet_items_bookletId_workId_key" ON "booklet_items"("bookletId", "workId");

-- CreateIndex
CREATE INDEX "score_loans_tenant_id_returnedAt_idx" ON "score_loans"("tenant_id", "returnedAt");

-- CreateIndex
CREATE INDEX "assemblies_tenant_id_firstCallAt_idx" ON "assemblies"("tenant_id", "firstCallAt");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_attendance_assemblyId_memberId_key" ON "assembly_attendance"("assemblyId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "motion_votes_motionId_memberId_key" ON "motion_votes"("motionId", "memberId");

-- CreateIndex
CREATE INDEX "board_positions_tenant_id_endsOn_idx" ON "board_positions"("tenant_id", "endsOn");

-- CreateIndex
CREATE INDEX "polls_tenant_id_createdAt_idx" ON "polls"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_pollId_membershipId_key" ON "poll_votes"("pollId", "membershipId");

-- CreateIndex
CREATE INDEX "grants_tenant_id_year_idx" ON "grants"("tenant_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_draws_tenant_id_name_key" ON "lottery_draws"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_books_drawId_code_key" ON "lottery_books"("drawId", "code");

-- CreateIndex
CREATE INDEX "donors_tenant_id_name_idx" ON "donors"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "donations_tenant_id_date_idx" ON "donations"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_guardianId_key" ON "memberships"("guardianId");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_grantId_idx" ON "transactions"("tenant_id", "grantId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "school_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_slots" ADD CONSTRAINT "class_slots_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "class_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_slots" ADD CONSTRAINT "class_slots_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "class_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_applications" ADD CONSTRAINT "enrollment_applications_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "school_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "class_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_charges" ADD CONSTRAINT "tuition_charges_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "school_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_charges" ADD CONSTRAINT "tuition_charges_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tuition_charges" ADD CONSTRAINT "tuition_charges_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_notices" ADD CONSTRAINT "school_notices_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "class_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_quotes" ADD CONSTRAINT "performance_quotes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_quotes" ADD CONSTRAINT "performance_quotes_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "performance_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_requirements" ADD CONSTRAINT "event_requirements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logistics" ADD CONSTRAINT "event_logistics_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reinforcement_requests" ADD CONSTRAINT "reinforcement_requests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reinforcement_applications" ADD CONSTRAINT "reinforcement_applications_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "reinforcement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reinforcement_payments" ADD CONSTRAINT "reinforcement_payments_musicianId_fkey" FOREIGN KEY ("musicianId") REFERENCES "external_musicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booklet_items" ADD CONSTRAINT "booklet_items_bookletId_fkey" FOREIGN KEY ("bookletId") REFERENCES "booklets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booklet_items" ADD CONSTRAINT "booklet_items_workId_fkey" FOREIGN KEY ("workId") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_loans" ADD CONSTRAINT "score_loans_workId_fkey" FOREIGN KEY ("workId") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_attendance" ADD CONSTRAINT "assembly_attendance_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_attendance" ADD CONSTRAINT "assembly_attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motions" ADD CONSTRAINT "motions_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_votes" ADD CONSTRAINT "motion_votes_motionId_fkey" FOREIGN KEY ("motionId") REFERENCES "motions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_votes" ADD CONSTRAINT "motion_votes_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_positions" ADD CONSTRAINT "board_positions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_books" ADD CONSTRAINT "lottery_books_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "lottery_draws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_books" ADD CONSTRAINT "lottery_books_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donors" ADD CONSTRAINT "donors_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Aislamiento multi-tenant de las tablas nuevas (mismo esquema que 0002).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'school_settings','families','guardians','students','school_years','subjects','teachers',
    'rooms','class_groups','class_slots','enrollments','enrollment_applications','class_sessions',
    'class_attendance','grades','tuition_charges','school_notices','clients','performance_quotes',
    'client_invoices','event_requirements','event_logistics','reinforcement_applications',
    'external_musicians','reinforcement_payments','booklets','booklet_items','score_loans',
    'assemblies','assembly_attendance','motions','motion_votes','board_positions','polls',
    'poll_votes','grants','lottery_draws','lottery_books','donors','donations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Bolsa de refuerzos: lectura cruzada sólo de necesidades abiertas (como BandMarket).
ALTER TABLE reinforcement_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY reinforcements_read ON reinforcement_requests FOR SELECT
  USING (status = 'OPEN' OR tenant_id = app_current_tenant());
CREATE POLICY reinforcements_insert ON reinforcement_requests FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY reinforcements_update ON reinforcement_requests FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY reinforcements_delete ON reinforcement_requests FOR DELETE
  USING (tenant_id = app_current_tenant());

-- ── Referencias dentro del mismo tenant ─────────────────────────────────────
DROP TRIGGER same_tenant ON transactions;
DROP TRIGGER same_tenant ON memberships;
DROP TRIGGER same_tenant ON invitations;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('transactions',               ARRAY['categoryId','finance_categories','memberId','members','grantId','grants']),
    ('memberships',                ARRAY['roleId','roles','memberId','members','guardianId','guardians']),
    ('invitations',                ARRAY['roleId','roles','memberId','members','guardianId','guardians']),
    ('guardians',                  ARRAY['familyId','families','memberId','members']),
    ('students',                   ARRAY['familyId','families','memberId','members']),
    ('teachers',                   ARRAY['memberId','members']),
    ('class_groups',               ARRAY['yearId','school_years','subjectId','subjects','teacherId','teachers']),
    ('class_slots',                ARRAY['groupId','class_groups','roomId','rooms']),
    ('enrollments',                ARRAY['studentId','students','groupId','class_groups']),
    ('enrollment_applications',    ARRAY['yearId','school_years','studentId','students']),
    ('class_sessions',             ARRAY['groupId','class_groups','makeUpForId','class_sessions']),
    ('class_attendance',           ARRAY['sessionId','class_sessions','studentId','students']),
    ('grades',                     ARRAY['enrollmentId','enrollments']),
    ('tuition_charges',            ARRAY['yearId','school_years','studentId','students','familyId','families','transactionId','transactions']),
    ('school_notices',             ARRAY['groupId','class_groups']),
    ('performance_quotes',         ARRAY['clientId','clients','eventId','events']),
    ('client_invoices',            ARRAY['clientId','clients','quoteId','performance_quotes','rectifiesId','client_invoices','transactionId','transactions']),
    ('event_requirements',         ARRAY['eventId','events']),
    ('event_logistics',            ARRAY['eventId','events']),
    ('reinforcement_requests',     ARRAY['eventId','events']),
    ('reinforcement_applications', ARRAY['requestId','reinforcement_requests']),
    ('reinforcement_payments',     ARRAY['musicianId','external_musicians','eventId','events','transactionId','transactions']),
    ('booklet_items',              ARRAY['bookletId','booklets','workId','works']),
    ('score_loans',                ARRAY['workId','works']),
    ('assembly_attendance',        ARRAY['assemblyId','assemblies','memberId','members','proxyForId','members']),
    ('motions',                    ARRAY['assemblyId','assemblies']),
    ('motion_votes',               ARRAY['motionId','motions','memberId','members']),
    ('board_positions',            ARRAY['memberId','members']),
    ('poll_votes',                 ARRAY['pollId','polls','membershipId','memberships']),
    ('lottery_books',              ARRAY['drawId','lottery_draws','memberId','members','transactionId','transactions']),
    ('donors',                     ARRAY['memberId','members']),
    ('donations',                  ARRAY['donorId','donors','transactionId','transactions'])
  ) AS v(tbl, args) LOOP
    EXECUTE format(
      'CREATE TRIGGER same_tenant BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION app_enforce_same_tenant(%s)',
      r.tbl, (SELECT string_agg(quote_literal(a), ',') FROM unnest(r.args) a));
  END LOOP;
END $$;

-- ── Facturas inalterables (VeriFactu) ───────────────────────────────────────
-- Tras la emisión sólo cambian el estado de cobro/anulación; los datos fiscales y la huella no.
CREATE OR REPLACE FUNCTION client_invoices_immutable() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  IF (NEW.series, NEW.number, NEW."issueDate", NEW."clientId", NEW."clientSnapshot", NEW.lines,
      NEW."taxRatePct", NEW."baseCents", NEW."taxCents", NEW."totalCents", NEW.hash, NEW."prevHash",
      NEW."rectifiesId", NEW.tenant_id)
     IS DISTINCT FROM
     (OLD.series, OLD.number, OLD."issueDate", OLD."clientId", OLD."clientSnapshot", OLD.lines,
      OLD."taxRatePct", OLD."baseCents", OLD."taxCents", OLD."totalCents", OLD.hash, OLD."prevHash",
      OLD."rectifiesId", OLD.tenant_id) THEN
    RAISE EXCEPTION 'issued invoices are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER client_invoices_immutable BEFORE UPDATE ON client_invoices
  FOR EACH ROW EXECUTE FUNCTION client_invoices_immutable();

-- ── Permisos del rol de aplicación ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfeggio_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      school_settings, families, guardians, students, school_years, subjects, teachers, rooms,
      class_groups, class_slots, enrollments, enrollment_applications, class_sessions,
      class_attendance, grades, tuition_charges, school_notices, clients, performance_quotes,
      client_invoices, event_requirements, event_logistics, reinforcement_requests,
      reinforcement_applications, external_musicians, reinforcement_payments, booklets,
      booklet_items, score_loans, assemblies, assembly_attendance, motions, motion_votes,
      board_positions, polls, poll_votes, grants, lottery_draws, lottery_books, donors, donations
      TO solfeggio_app;
    -- Las facturas no se borran: se anulan o se rectifican.
    REVOKE DELETE ON client_invoices FROM solfeggio_app;
    -- Perfiles de músico globales: sólo el sistema, con filtros explícitos por usuario.
    REVOKE ALL ON musician_profiles FROM solfeggio_app;
  END IF;
END $$;

-- ── Planes y roles de sistema existentes ────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.add_items(arr text[], extra text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY(SELECT DISTINCT x FROM unnest(arr || extra) x ORDER BY x) $$;

UPDATE plans SET features = pg_temp.add_items(features, ARRAY['performances','governance']) WHERE code = 'BASIC';
UPDATE plans SET features = pg_temp.add_items(features, ARRAY['performances','governance','school','reinforcements','archive_ai']), "maxStudents" = 150 WHERE code = 'PRO';
UPDATE plans SET features = pg_temp.add_items(features, ARRAY['performances','governance','school','reinforcements','archive_ai']), "maxStudents" = -1 WHERE code = 'ENTERPRISE';

UPDATE roles SET permissions = pg_temp.add_items(permissions, ARRAY[
  'school:read','school:write','school:teach','school:family','performances:read','performances:write',
  'reinforcements:manage','governance:read','governance:write','governance:vote']) WHERE "isSystem" AND key IN ('owner','admin');
UPDATE roles SET permissions = pg_temp.add_items(permissions, ARRAY[
  'school:read','school:teach','performances:read','reinforcements:manage','governance:read','governance:vote']) WHERE "isSystem" AND key = 'director';
UPDATE roles SET permissions = pg_temp.add_items(permissions, ARRAY[
  'school:read','school:write','performances:read','governance:read','governance:write','governance:vote']) WHERE "isSystem" AND key = 'secretary';
UPDATE roles SET permissions = pg_temp.add_items(permissions, ARRAY[
  'school:read','performances:read','performances:write','governance:read','governance:vote']) WHERE "isSystem" AND key = 'treasurer';
UPDATE roles SET permissions = pg_temp.add_items(permissions, ARRAY['governance:read','governance:vote']) WHERE "isSystem" AND key IN ('material_manager','musician');

INSERT INTO roles (id, tenant_id, key, name, permissions, "isSystem", "updatedAt")
SELECT gen_random_uuid(), t.id, r.key, r.name, r.permissions, true, now()
FROM tenants t
CROSS JOIN (VALUES
  ('teacher', 'Profesor', ARRAY['archive:read','events:read','school:read','school:teach']),
  ('family',  'Familia',  ARRAY['school:family'])
) AS r(key, name, permissions)
ON CONFLICT (tenant_id, key) DO NOTHING;
