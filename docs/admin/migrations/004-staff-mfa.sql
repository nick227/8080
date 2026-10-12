ALTER TABLE `Session` ADD COLUMN `adminMfaUntil` DATETIME(3) NULL;
CREATE TABLE `StaffMfa` (
 `userId` VARCHAR(191) NOT NULL, `secret` TEXT NULL, `pendingSecret` TEXT NULL,
 `pendingSessionId` VARCHAR(191) NULL, `pendingUntil` DATETIME(3) NULL, `confirmedAt` DATETIME(3) NULL,
 `lastCounter` INTEGER NOT NULL DEFAULT -1, `recoveryHashes` JSON NOT NULL,
 `failures` INTEGER NOT NULL DEFAULT 0, `lockedUntil` DATETIME(3) NULL,
 PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
