CREATE TABLE `StripeCustomerBinding` (
  `customerId` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
  `livemode` BOOLEAN NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`customerId`), UNIQUE INDEX `StripeCustomerBinding_userId_key` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `StripeSubscription` (
  `id` VARCHAR(191) NOT NULL, `customerId` VARCHAR(191) NOT NULL, `livemode` BOOLEAN NOT NULL,
  `status` VARCHAR(40) NOT NULL, `invoiceStatus` VARCHAR(40) NULL,
  `priceId` VARCHAR(191) NULL, `accessUntil` DATETIME(3) NULL,
  `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false, `syncedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `StripeSubscription_customerId_accessUntil_idx` (`customerId`, `accessUntil`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `StripeWebhookReceipt` (
  `id` VARCHAR(191) NOT NULL, `type` VARCHAR(100) NOT NULL,
  `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
