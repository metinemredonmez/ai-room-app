-- API.md §7.23 step 4: the composite (projectId, orgId) key is not checked when orgId is NULL (MATCH SIMPLE), so a
-- design with a project must also carry the firm: a personal design can never sit in a firm's project (AZ-02).
ALTER TABLE "Design" ADD CONSTRAINT "Design_project_needs_org" CHECK ("projectId" IS NULL OR "orgId" IS NOT NULL);
