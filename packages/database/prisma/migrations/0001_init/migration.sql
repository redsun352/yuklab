CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'DRIVER', 'SERVICE_PROVIDER', 'BUSINESS', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'OFFERING', 'ACCEPTED', 'DRIVER_ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'DISPUTED');
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "passwordHash" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "preferredLanguage" TEXT NOT NULL DEFAULT 'tr-TR',
  "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
  "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

CREATE TABLE "DriverProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "isAvailable" BOOLEAN NOT NULL DEFAULT false,
  "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
  "completedJobs" INTEGER NOT NULL DEFAULT 0,
  "cancellationRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "reliabilityScore" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "serviceRadiusKm" DECIMAL(6,2) NOT NULL DEFAULT 25,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

CREATE TABLE "ServiceProvider" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "isAvailable" BOOLEAN NOT NULL DEFAULT false,
  "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceProvider_userId_key" ON "ServiceProvider"("userId");

CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "subtype" TEXT,
  "plateNumber" TEXT,
  "capacityKg" DECIMAL(12,2),
  "volumeM3" DECIMAL(12,3),
  "refrigerated" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");
CREATE INDEX "Vehicle_ownerId_active_idx" ON "Vehicle"("ownerId", "active");
CREATE INDEX "Vehicle_type_active_idx" ON "Vehicle"("type", "active");

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "assignedDriverId" TEXT,
  "vehicleId" TEXT,
  "serviceType" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "pickupAddress" TEXT NOT NULL,
  "deliveryAddress" TEXT,
  "pickupLat" DECIMAL(10,7),
  "pickupLng" DECIMAL(10,7),
  "deliveryLat" DECIMAL(10,7),
  "deliveryLng" DECIMAL(10,7),
  "scheduledAt" TIMESTAMP(3),
  "budgetMinor" BIGINT,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "urgency" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_assignedDriverId_status_idx" ON "Order"("assignedDriverId", "status");

CREATE TABLE "Offer" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "etaMinutes" INTEGER,
  "note" TEXT,
  "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Offer_orderId_status_idx" ON "Offer"("orderId", "status");
CREATE INDEX "Offer_providerId_createdAt_idx" ON "Offer"("providerId", "createdAt");

CREATE TABLE "TrackingEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "lat" DECIMAL(10,7),
  "lng" DECIMAL(10,7),
  "etaSeconds" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrackingEvent_orderId_createdAt_idx" ON "TrackingEvent"("orderId", "createdAt");
CREATE INDEX "TrackingEvent_eventType_createdAt_idx" ON "TrackingEvent"("eventType", "createdAt");

CREATE TABLE "Document" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Document_userId_status_idx" ON "Document"("userId", "status");

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attachmentUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Message_orderId_createdAt_idx" ON "Message"("orderId", "createdAt");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
