CREATE TABLE `LiveCostPolicy` (
 `id` INTEGER NOT NULL, `version` INTEGER NOT NULL DEFAULT 0, `stopped` BOOLEAN NOT NULL DEFAULT true,
 `userDailyMicros` BIGINT NOT NULL DEFAULT 0, `platformDailyMicros` BIGINT NOT NULL DEFAULT 0,
 `userConcurrency` INTEGER NOT NULL DEFAULT 0, `platformConcurrency` INTEGER NOT NULL DEFAULT 0,
 `stopReason` VARCHAR(500) NOT NULL DEFAULT 'Live limits have not been configured', PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `LiveCostReservation` (
 `id` VARCHAR(191) NOT NULL, `requestKey` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `roomId` VARCHAR(191) NOT NULL,
 `status` VARCHAR(20) NOT NULL, `reservedMicros` BIGINT NOT NULL, `actualMicros` BIGINT NULL,
 `periodStart` DATETIME(3) NOT NULL, `deadline` DATETIME(3) NOT NULL, `dispatchedAt` DATETIME(3) NULL,
 `settledAt` DATETIME(3) NULL, `evidenceId` VARCHAR(191) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), UNIQUE INDEX `LiveCostReservation_requestKey_key` (`requestKey`),
 UNIQUE INDEX `LiveCostReservation_evidenceId_key` (`evidenceId`),
 INDEX `LiveCostReservation_status_userId_periodStart_idx` (`status`, `userId`, `periodStart`),
 INDEX `LiveCostReservation_status_deadline_idx` (`status`, `deadline`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `LiveCostPolicy` (`id`) VALUES (1);
