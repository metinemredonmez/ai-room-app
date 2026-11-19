import { pageMetadata } from "@/lib/page-meta";
import { EmailChangeView } from "./email-change-view";

// E-posta değişikliğinin onayı: the EMAIL_CHANGE link lands here (#token=…), the view posts it once.
export const generateMetadata = pageMetadata("emailChange", { referrer: "no-referrer" });

export default function EmailChangePage() {
  return <EmailChangeView />;
}
