export const ADMIN_ROLES = ["SUPPORT", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

// Mirrors docs/API.md §2 and §4 (camelCase backend contract).

export type ToolId =
  | "redesign"
  | "furnish"
  | "declutter"
  | "replace"
  | "paint"
  | "flooring"
  | "exterior"
  | "garden"
  | "reference"
  | "custom";

export type User = {
  id: string;
  email: string | null;
  name: string | null;
  role: "USER" | AdminRole;
  isGuest: boolean;
  plan: "FREE" | "PRO";
  planExpiresAt: string | null;
  credits: number;
  dailyFreeRemaining: number;
  locale: Locale;
  createdAt: string;
};

export type AdminUser = User & {
  status: "ACTIVE" | "BANNED";
  designsCount: number;
  lastSeenAt: string | null;
};

export type ImageRef = { id: string; url: string; width: number; height: number };

export type Design = {
  id: string;
  title: string;
  tool: ToolId;
  styleId: string | null;
  roomId: string | null;
  params: Record<string, unknown>;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  error: string | null;
  input: ImageRef;
  results: ImageRef[];
  favorite: boolean;
  featured: boolean;
  createdAt: string;
};

export type AdminDesign = Design & { userId: string; userEmail: string | null };

export type LedgerEntry = { id: string; delta: number; reason: string; refId: string | null; createdAt: string };

export type AdminUserDetail = AdminUser & { recentDesigns: Design[]; ledger: LedgerEntry[] };

export type Page<T> = { items: T[]; nextCursor: string | null };

export type AdminStats = {
  totals: {
    users: number;
    guests: number;
    registered: number;
    pro: number;
    designs: number;
    designsToday: number;
    failedToday: number;
    creditsSpentToday: number;
    analyses: number;
  };
  daily: { date: string; designs: number; failed: number; newUsers: number }[];
  byTool: { tool: ToolId; count: number }[];
  byStyle: { styleId: string; count: number }[];
};

export type AdminStyleInput = {
  id: string;
  nameTr: string;
  nameEn: string;
  descriptionTr: string;
  descriptionEn: string;
  prompt: string;
  palette: string[];
  isPro: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type AdminStyle = AdminStyleInput & { usageCount: number };

export type AuditEntry = {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type SystemStatus = {
  ai: { status: "ok" | "down"; provider: string; chatEnabled: boolean; latencyMs: number | null };
  db: "ok" | "down";
  redis: "ok" | "down";
  version: string;
};

// ---- v1.1 (docs/API.md §7)

export type BrakeMode = "off" | "free_single_variant" | "free_paused";
export type Settings = {
  freeDailyGenerations: number;
  proDailyGenerations: number;
  maxVariantsFree: 1 | 2 | 3 | 4;
  maxVariantsPro: 1 | 2 | 3 | 4;
  dailyBudgetUsd: number;
  budgetBrakeMode: BrakeMode;
  maintenance: { enabled: boolean; messageTr: string; messageEn: string };
  announcement: { enabled: boolean; textTr: string; textEn: string };
  requireAiConsent: boolean;
  appVersions: Record<AppPlatform, AppVersion>;
};
export type AppPlatform = "ios" | "android";
export type AppVersion = { min: string; latest: string; storeUrl: string };
export type SettingsResponse = { values: Settings; defaults: Settings };

export type BudgetState = "normal" | "warning" | "exceeded";
export type AiUsageStats = {
  today: { costUsd: number; calls: number; images: number };
  budget: { dailyBudgetUsd: number; spentTodayUsd: number; state: BudgetState; brakeMode: BrakeMode };
  daily: { date: string; costUsd: number; calls: number }[];
  byProvider: { provider: string; model: string; calls: number; costUsd: number }[];
  byKind: { kind: string; calls: number; costUsd: number }[];
};

export type ReportStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type ContentReport = {
  id: string;
  designId: string;
  reason: "inappropriate" | "offensive" | "copyright" | "privacy" | "other";
  note: string | null;
  status: ReportStatus;
  reporterId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  design: Design;
  owner: { id: string; email: string | null };
};

export type JobRun = {
  id: string;
  name: string;
  status: "ok" | "error" | "running";
  details: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
};
export type JobsOverview = { items: JobRun[]; queue: { waiting: number; active: number; failed: number; delayed: number } };

export type BillingEventStatus = "queued" | "processed" | "unmatched" | "ignored" | "failed";
export type BillingEvent = {
  id: string;
  type: string;
  status: BillingEventStatus;
  appUserId: string | null;
  userId: string | null;
  error: string | null;
  productId: string | null;
  store: string | null;
  environment: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export type AdminMe = User & { mfa: { required: boolean; enrolled: boolean; backupCodesRemaining: number } };

export type AdminTeamMember = User & {
  status: "ACTIVE" | "BANNED";
  mfa: { enrolled: boolean; enrollBefore: string | null; backupCodesRemaining: number };
  lastSeenAt: string | null;
};

export type LegalKind = "terms" | "privacy" | "ai_processing" | "marketing";
export type LegalLocale = "tr" | "en";
export type LegalCurrent = { kind: LegalKind; version: string; consentVersion: string; publishedAt: string | null; url: string };
export type LegalRow = {
  id: string;
  kind: LegalKind;
  version: string;
  locale: LegalLocale;
  title: string;
  requiresConsent: boolean;
  status: "draft" | "published";
  publishedAt: string | null;
  updatedAt: string;
};
export type LegalDocument = Omit<LegalRow, "status" | "updatedAt"> & { body: string; createdAt: string; updatedAt: string };

export type DataRequestStatus = "RECEIVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
export type DataRequest = {
  id: string;
  reference: string;
  type: string;
  status: DataRequestStatus;
  details: string;
  response: string | null;
  receivedAt: string;
  dueAt: string;
  closedAt: string | null;
  channel: "app" | "email" | "kep" | "letter" | "other";
  contactEmail: string | null;
  userId: string | null;
  handledBy: string | null;
  daysLeft: number | null;
  overdue: boolean;
};
export type DataRequestDetail = DataRequest & {
  user: { id: string; email: string | null; name: string | null; isGuest: boolean; status: string; createdAt: string } | null;
};

// --- Toplu Gönderim (API.md §7.16) ---
/** Web and app languages (API.md §7.17). */
export const LOCALES = ["tr", "en", "de", "es", "fr", "it", "ru", "nl", "ja", "ko", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_LABELS: Record<Locale, string> = {
  tr: "Türkçe", en: "İngilizce", de: "Almanca", es: "İspanyolca", fr: "Fransızca", it: "İtalyanca",
  ru: "Rusça", nl: "Felemenkçe", ja: "Japonca", ko: "Korece", zh: "Çince",
};

export type BroadcastKind = "SERVICE" | "MARKETING";
export type BroadcastChannel = "PUSH" | "EMAIL";
export type BroadcastStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "CANCELLED" | "FAILED";
export type BroadcastAudience = {
  plan?: "FREE" | "PRO";
  platform?: "ios" | "android";
  locale?: Locale;
  accounts?: "all" | "registered" | "guests";
  inactiveDays?: number;
  activeDays?: number;
  registeredAfter?: string;
  registeredBefore?: string;
  emails?: string[];
};
export type Broadcast = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  kind: BroadcastKind;
  channel: BroadcastChannel;
  audience: BroadcastAudience;
  status: BroadcastStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  counts: { target: number; sent: number; skipped: number; failed: number; opened: number };
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BroadcastDetail = Broadcast & {
  breakdown: { status: string; reason: string | null; count: number }[];
  recent: { userId: string; email: string | null; status: string; reason: string | null; devices: number; sentAt: string | null; openedAt: string | null }[];
};
