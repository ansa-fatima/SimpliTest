-- Admin-mediated password reset token (no email sending configured, so an
-- admin generates a link and shares it directly with the teammate).
ALTER TABLE "users" ADD COLUMN "resetToken" TEXT;
ALTER TABLE "users" ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_resetToken_key" ON "users"("resetToken");
