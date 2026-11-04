-- API.md §7.23: a firm's credit pool never goes below zero, even if two requests race past the service check (BUS-01).
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_credits_nonnegative" CHECK ("credits" >= 0);
-- Monthly caps, when set, are positive.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_member_cap_positive" CHECK ("memberMonthlyCap" IS NULL OR "memberMonthlyCap" > 0);
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_cap_positive" CHECK ("monthlyCap" IS NULL OR "monthlyCap" > 0);
