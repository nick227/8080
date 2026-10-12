-- AlterTable
ALTER TABLE `User` ADD COLUMN `adminVersion` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `PlatformStaff` (
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('platform_admin', 'platform_owner') NOT NULL,
    `grantedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PremiumGrant` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `grantedById` VARCHAR(191) NOT NULL,
    `revokedById` VARCHAR(191) NULL,
    `reason` VARCHAR(500) NOT NULL,

    INDEX `PremiumGrant_userId_revokedAt_expiresAt_idx`(`userId`, `revokedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `targetUserId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(60) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `before` JSON NOT NULL,
    `after` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AdminAuditEvent_requestId_key`(`requestId`),
    INDEX `AdminAuditEvent_targetUserId_createdAt_idx`(`targetUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminMutationLock` (
    `id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlatformStaff` ADD CONSTRAINT `PlatformStaff_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PremiumGrant` ADD CONSTRAINT `PremiumGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

