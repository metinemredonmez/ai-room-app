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
  /** API.md §7.22: credits a new registered, verified account gets once; 0 = off. */
  welcomeCredits: number;
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

/** Pazarlama (API.md §7.18). */
export type MarketingDraftStatus = "PENDING" | "READY" | "FAILED" | "APPROVED" | "ARCHIVED";
export type AsoField =
  | "app_name" | "app_subtitle" | "app_keywords" | "app_promo" | "app_description" | "app_whats_new"
  | "play_title" | "play_short" | "play_description";
export type AsoListing = Record<AsoField, string>;
export type MarketingDraft<O = AsoListing> = {
  id: string;
  kind: "aso" | "social" | "campaign" | "report" | "blog" | "seo";
  locale: Locale;
  status: MarketingDraftStatus;
  input: Record<string, unknown> & { brief?: string | null; whatsNew?: string | null };
  output: O | null;
  violations: string[];
  error: string | null;
  costUsd: number;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Platform = "instagram" | "tiktok" | "pinterest";
export type SocialPost = { title: string; caption: string; hashtags: string[]; alt_text: string };
export type CampaignText = { title: string; body: string; link: string | null; signals?: string[]; broadcastId?: string };
export type WeekNumbers = {
  users: { registered: number; guests: number; active: number };
  designs: { created: number; succeeded: number; failed: number; failRate: number };
  store: { subscriptionsStarted: number; renewals: number; cancellations: number; creditPacks: number };
  ai: { calls: number; costUsd: number; costPerDesignUsd: number | null };
  ops: { jobErrors: number; broadcastsSent: number };
};
export type WeeklyReport = {
  metrics: {
    period: { from: string; to: string };
    thisWeek: WeekNumbers;
    lastWeek: WeekNumbers;
    topTools: Array<{ tool: string; designs: number }>;
    topStyles: Array<{ style: string; designs: number }>;
    now: { registeredUsers: number; activeSubscriptions: number; openContentReports: number; openKvkkRequests: number };
  };
  text: { summary: string; highlights: string[]; actions: string[] } | null;
};

/** Destek (API.md §7.19). */
export type SupportStatus = "OPEN" | "ANSWERED" | "CLOSED";
export type SupportTicket = {
  id: string;
  reference: string;
  category: string;
  subject: string;
  status: SupportStatus;
  userUnread: boolean;
  platform: string | null;
  lastMessageAt: string;
  createdAt: string;
  closedAt: string | null;
  user?: { email: string | null; isGuest: boolean; plan: string };
};
export type SupportDetail = SupportTicket & {
  requestId: string | null;
  designId: string | null;
  appVersion: string | null;
  locale: string;
  messages: Array<{ id: string; author: "USER" | "STAFF"; body: string; createdAt: string }>;
  user: { id: string; email: string | null; name: string | null; isGuest: boolean; plan: string; locale: string; createdAt: string };
};

// API.md §7.20 analytics
export type BillingEnv = "PRODUCTION" | "SANDBOX";
export type RevenueAnalytics = {
  days: number;
  env: BillingEnv;
  from: string;
  to: string;
  totals: {
    grossUsd: number;
    refundsUsd: number;
    netUsd: number;
    proceedsUsd: number;
    payers: number;
    arppuUsd: number | null;
    newSubscriptions: number;
    trials: number;
    trialConversions: number;
    renewals: number;
    creditPacks: number;
    refunds: number;
    cancellations: number;
    expirations: number;
  };
  daily: { date: string; grossUsd: number; refundsUsd: number; netUsd: number }[];
  byProduct: { productId: string; revenueUsd: number; purchases: number }[];
  byStore: { store: string; revenueUsd: number }[];
  byCurrency: { currency: string; amount: number }[];
  subscriptions: { active: number; byStatus: Record<string, number>; trials: number; renewing: number; priced: number; mrrUsd: number };
  truncated: boolean;
};
export type EngagementAnalytics = {
  days: number;
  active: { today: number; week: number; month: number; period: number; returning: number; stickiness: number | null };
  daily: { date: string; activeUsers: number }[];
  funnel: { signups: number; designed: number; succeeded: number; repeat: number; registered: number; paid: number };
  designs: { designs: number; designers: number; succeeded: number; favorites: number; perDesigner: number | null; favoriteRate: number | null };
  reach: { kind: "tool" | "ai"; key: string; users: number }[];
};
export type CohortAnalytics = {
  segment: "all" | "registered";
  currentWeek: string;
  weeks: number;
  rows: { week: string; size: number; active: (number | null)[]; retention: (number | null)[] }[];
  average: (number | null)[];
};

// API.md §7.21 plans, packs and subscribers
export type SubscriptionFilter = "active" | "trial" | "cancelled" | "grace" | "billing_issue" | "expired";
export type AdminSubscription = {
  id: string;
  userId: string;
  email: string | null;
  isGuest: boolean | null;
  productId: string | null;
  store: string | null;
  environment: string | null;
  periodType: string | null;
  status: string;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  updatedAt: string;
  access: boolean;
};
export type PlanCycleId = "weekly" | "monthly" | "yearly";
export type PlanCycle = { cycle: PlanCycleId; active: boolean; highlight: boolean; iosProductId: string | null; androidProductId: string | null };
export type CreditPack = {
  key: string;
  nameTr: string;
  nameEn: string;
  credits: number;
  iosProductId: string | null;
  androidProductId: string | null;
  highlight: boolean;
  active: boolean;
};
export type PlanCatalog = {
  plan: { nameTr: string; nameEn: string; taglineTr: string; taglineEn: string; featuresTr: string[]; featuresEn: string[]; cycles: PlanCycle[] };
  packs: CreditPack[];
};
export type PlanCatalogState = {
  catalog: PlanCatalog;
  retiredProducts: number;
  saved: boolean;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  limits: { free: { dailyGenerations: number; maxVariants: number }; pro: { dailyGenerations: number; maxVariants: number } };
  revenuecatRest: boolean;
};
