-- API.md §7.43: web and app errors join the same error groups.
ALTER TABLE "ErrorGroup" DROP CONSTRAINT "ErrorGroup_kind_known";
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_kind_known" CHECK ("kind" IN ('http', 'job', 'other', 'client'));
