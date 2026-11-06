export const ADMIN_ROLES = ["SUPPORT", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
/** True when the role is `min` or higher in the panel hierarchy (the server decides; this only hides controls). */
export const atLeast = (role: string | undefined, min: AdminRole) => role !== undefined && ADMIN_ROLES.indexOf(role as AdminRole) >= ADMIN_ROLES.indexOf(min);

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
  /** API.md §7.51: the owner allows the public inspiration gallery. */
  shareable?: boolean;
  createdAt: string;
};

export type AdminDesign = Design & { userId: string; userEmail: string | null };

export type LedgerEntry = { id: string; delta: number; reason: string; refId: string | null; createdAt: string };

export type AdminUserSubscription = {
  entitlement: string;
  productId: string | null;
  store: string | null;
  environment: string | null;
  status: string;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  updatedAt: string;
};

export type AdminUserDetail = AdminUser & { recentDesigns: Design[]; ledger: LedgerEntry[]; subscriptions: AdminUserSubscription[] };

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
  /** Marketing pushes per person per 7 days, the Istanbul quiet window, and e-mails a day across all mailings. */
  broadcast: { weeklyMarketingCap: number; quietStart: string; quietEnd: string; emailDailyCap: number };
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
export type JobSchedule = { name: string; every: number | null; pattern: string | null; next: string | null; late: boolean; runnable: boolean; lastRun: { status: string; startedAt: string } | null };
export type JobsOverview = { items: JobRun[]; queue: { waiting: number; active: number; failed: number; delayed: number }; schedules: JobSchedule[] };

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
export type PlanCycle = {
  cycle: PlanCycleId;
  active: boolean;
  highlight: boolean;
  iosProductId: string | null;
  androidProductId: string | null;
  /** Price shown on the web (TRY, information only; the store charges its own). Required for a period on sale. */
  webPriceTRY: number | null;
  badgeTr: string;
  badgeEn: string;
};
export type CreditPack = {
  key: string;
  nameTr: string;
  nameEn: string;
  credits: number;
  iosProductId: string | null;
  androidProductId: string | null;
  highlight: boolean;
  active: boolean;
  webPriceTRY: number | null;
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

// API.md §7.23 firms (corporate workspaces)
export type OrgStatus = "ACTIVE" | "SUSPENDED";
export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";
export type AdminOrg = { id: string; name: string; status: OrgStatus; credits: number; members: number; ownerEmail: string | null; createdAt: string };
export type AdminOrgMember = {
  userId: string;
  email: string | null;
  name: string | null;
  userStatus: "ACTIVE" | "BANNED";
  role: OrgRole;
  monthlyCap: number | null;
  effectiveCap: number | null;
  usedThisMonth: number;
  joinedAt: string;
};
export type AdminOrgDetail = {
  id: string;
  name: string;
  status: OrgStatus;
  credits: number;
  memberMonthlyCap: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { userId: string; email: string | null } | null;
  members: AdminOrgMember[];
  ledger: { id: string; delta: number; reason: string; userId: string | null; actorId: string | null; createdAt: string }[];
  invites: { id: string; email: string; role: OrgRole; monthlyCap: number | null; expiresAt: string; createdAt: string }[];
  projects: { id: string; name: string; clientName: string | null; status: "ACTIVE" | "ARCHIVED"; designs: number; updatedAt: string }[];
};

// Ürün kataloğu (API.md §7.25): araçlar, odalar, zeminler, renkler — panelden.
export type ProductToolId = "redesign" | "furnish" | "declutter" | "replace" | "paint" | "flooring" | "exterior" | "garden" | "reference" | "custom";
export type ProductTool = { id: ProductToolId; enabled: boolean; isPro: boolean; isNew: boolean; credits: number; nameTr: string; nameEn: string; descriptionTr: string; descriptionEn: string };
export type ProductRoom = { id: string; nameTr: string; nameEn: string; prompt: string; icon: string; enabled: boolean };
export type ProductFloor = { id: string; nameTr: string; nameEn: string; prompt: string; enabled: boolean };
export type ProductColor = { id: string; nameTr: string; nameEn: string; hex: string; enabled: boolean };
export type ProductCatalog = { tools: ProductTool[]; rooms: ProductRoom[]; floors: ProductFloor[]; colors: ProductColor[] };
export type ProductState = {
  catalog: ProductCatalog;
  defaults: ProductCatalog;
  usage: { rooms: Record<string, number>; floors: Record<string, number> };
  retired: { rooms: number; floors: number };
  toolInfo: Record<ProductToolId, { category: "interior" | "exterior" | "edit"; needs: string[] }>;
  roomIcons: string[];
  saved: boolean;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

// İstem şablonları (API.md §7.26).
export type PromptVersion = { id: string; text: string; note: string; createdAt: string; createdBy: string | null };
export type PromptTemplate = {
  key: string;
  tool: string;
  default: string;
  placeholders: string[];
  required: string[];
  activeVersionId: string | null;
  text: string;
  versions: PromptVersion[];
};
export type PromptsState = { templates: PromptTemplate[]; placeholders: Record<string, string> };

// Model ve sağlayıcı (API.md §7.27).
export type EngineChoice = { chain: string[]; models: Record<string, string> };
export type EngineProvider = { name: string; configured: boolean; usable: boolean; default_model: string; models: { id: string; label: string; cost_usd: number }[] };
export type EngineState = {
  choice: EngineChoice | null;
  ignored: string[];
  catalog: { providers: EngineProvider[]; default_chain: string[]; breakers: { name: string; state: "closed" | "open" | "half_open"; consecutive_failures: number }[] };
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

// Özellik bayrakları (API.md §7.28).
export type FeatureFlag = { key: string; label: string; description: string; where: string[]; enabled: boolean };
export type FeaturesState = { features: FeatureFlag[]; version: string | null; updatedAt: string | null; updatedBy: string | null };

// Kurucu uyarıları ve hata listesi (API.md §7.41).
export type AlertSettings = {
  superAdmins: boolean;
  extraRecipients: string[];
  errors: { enabled: boolean; repeatMinutes: number };
  jobs: { enabled: boolean };
  clients: { enabled: boolean };
  purchases: { enabled: boolean };
  disk: { enabled: boolean; thresholdPct: number };
  budget: { enabled: boolean };
};
export type ErrorGroupRow = { id: string; kind: "http" | "job" | "other" | "client"; name: string; message: string; location: string; count: number; firstSeen: string; lastSeen: string; lastRequestId: string | null; resolvedAt: string | null };
export type AlertsState = {
  settings: AlertSettings;
  recipients: string[];
  errors: ErrorGroupRow[];
  recent: Array<{ id: string; kind: string; subject: string; sentTo: number; createdAt: string }>;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

// Mağaza inceleme hesabı (API.md §7.40).
export type ReviewAccountStatus =
  | { email: string; exists: false }
  | {
      email: string;
      exists: true;
      id: string;
      active: boolean;
      reviewUntil: string | null;
      credits: number;
      designs: number;
      openSessions: number;
      lastLogin: { ok: boolean; at: string; device: string; ipPrefix: string } | null;
    };

// Oturumlar ve giriş geçmişi (API.md §7.37).
export type AdminUserSessions = {
  sessions: Array<{ id: string; device: string; ipPrefix: string; method: string; createdAt: string; lastUsedAt: string; current: boolean }>;
  logins: Array<{ ok: boolean; method: string; reason: string | null; device: string; ipPrefix: string; createdAt: string }>;
};

// Planlı fiyat değişikliği (API.md §7.36).
export type PriceTarget = { kind: "tool" | "pack"; key: string; label: string; value: number; max: number; active: boolean };
export type PriceScheduleStatus = "SCHEDULED" | "ACTIVE" | "DONE" | "CANCELLED" | "FAILED";
export type PriceScheduleItem = {
  id: string;
  kind: "tool" | "pack";
  key: string;
  label: string;
  current: number | null;
  value: number;
  previousValue: number | null;
  startsAt: string;
  endsAt: string | null;
  status: PriceScheduleStatus;
  note: string;
  outcome: string | null;
  createdBy: string | null;
  createdAt: string;
  appliedAt: string | null;
  endedAt: string | null;
};
export type PriceSchedules = { targets: PriceTarget[]; items: PriceScheduleItem[] };

// Sadakat kuralları (API.md §7.35).
export type LoyaltyMessage = { tr: string; en: string };
export type LoyaltySettings = {
  streak: { enabled: boolean; days: number; credits: number; message: LoyaltyMessage };
  anniversary: { enabled: boolean; credits: number; message: LoyaltyMessage };
  winback: { enabled: boolean; inactiveDays: number; credits: number; cooldownDays: number; dailyCap: number; message: LoyaltyMessage };
};
export type LoyaltyRule = keyof LoyaltySettings;
export type LoyaltyState = {
  settings: LoyaltySettings;
  stats: Record<LoyaltyRule, { last30: number; credits30: number; total: number }>;
  today: { anniversary: number; winback: number; winbackWaiting: number };
  lastRun: { at: string; status: string; details: Record<string, unknown> } | null;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

// Renk temaları (API.md §7.34).
export const THEME_TOKEN_KEYS = ["primary", "primaryStrong", "primarySoft", "accent", "accentSoft", "bg", "surface", "surface2", "text", "muted", "border"] as const;
export type ThemeTokens = Record<(typeof THEME_TOKEN_KEYS)[number], string>;
export type ContrastCheck = { pair: string; ratio: number; min: number };
export type ContrastReport = { blocking: ContrastCheck[]; warnings: ContrastCheck[] };
export type ThemePalette = { id: string; name: { tr: string; en: string }; tones: string[]; tokens: ThemeTokens; enabled: boolean };
export type ThemeState = {
  defaultId: string;
  palettes: Array<ThemePalette & { contrast: ContrastReport }>;
  builtinIds: string[];
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

// Promosyon ve hediye kodları (API.md §7.29).
export type PromoKind = "CREDITS" | "PRO_DAYS";
export type PromoCode = {
  id: string;
  display: string;
  campaign: string;
  kind: PromoKind;
  amount: number;
  maxRedemptions: number | null;
  redeemed: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  newUsersOnly: boolean;
  createdAt: string;
  usable: boolean;
};
export type PromoList = { items: PromoCode[]; nextCursor: string | null; campaigns: { campaign: string; codes: number; redeemed: number }[] };
export type PromoBatch = { campaign: string; kind: PromoKind; amount: number; codes: string[] };
export type PromoRedemptions = { code: PromoCode; items: { id: string; createdAt: string; user: { id: string; email: string | null; name: string | null } | null }[] };

// Davet programı (API.md §7.30).
export type ReferralSettings = { enabled: boolean; inviterCredits: number; inviteeCredits: number; monthlyCap: number; claimDays: number };
export type ReferralItem = {
  id: string;
  status: "PENDING" | "REWARDED" | "REJECTED";
  inviteeCredits: number;
  inviterCredits: number;
  rejectReason: string | null;
  createdAt: string;
  rewardedAt: string | null;
  inviter: { id: string; email: string | null } | null;
  invitee: { id: string; email: string | null } | null;
};
export type ReferralState = {
  settings: ReferralSettings;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  stats: { claims30: number; rewarded30: number; credits30: number; pending: number };
  top: { userId: string | null; email: string | null; rewarded: number }[];
  items: ReferralItem[];
};

// Toplu hediye (API.md §7.32).
export type GiftSegment = "inactive" | "pro" | "new" | "all";
export type GiftPreview = { count: number; withPush: number; max: number };
export type GiftCampaign = {
  id: string;
  segment: GiftSegment;
  days: number | null;
  credits: number;
  message: string;
  recipients: number;
  pushed: number;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string | null;
};

// Ortak / influencer bağlantıları (API.md §7.33).
export type PartnerRow = {
  id: string;
  slug: string;
  name: string;
  note: string | null;
  commissionPct: number;
  active: boolean;
  createdAt: string;
  link: string;
  visits: number;
  visits30: number;
  signups: number;
  verified: number;
  designers: number;
  payers: number;
  revenueUsd: number;
  commissionUsd: number;
};

// Ana sayfa ve SSS (API.md §7.46)
export const SITE_SECTIONS = ["gallery", "tools", "features", "pro", "how", "styles", "pricing", "app", "faq"] as const;
export type SiteSection = (typeof SITE_SECTIONS)[number];
export const SITE_TEXT_LIMITS = {
  badge: 60, heroTitle: 80, heroText: 320, ctaPrimary: 30, ctaSecondary: 30, galleryTitle: 60, galleryText: 180, toolsTitle: 70,
  toolsText: 180, moreTools: 180, featuresTitle: 90, featuresText: 180, proBadge: 40, proTitle: 80, proText: 280, howTitle: 60,
  stylesTitle: 60, stylesText: 90, pricingTitle: 40, pricingText: 160, faqTitle: 50, finalTitle: 90, finalCta: 30,
} as const;
export type SiteTextKey = keyof typeof SITE_TEXT_LIMITS;
export const SITE_LIST_LIMITS = { trust: { items: 4, length: 40 }, proPoints: { items: 6, length: 90 } } as const;
export type SiteListKey = keyof typeof SITE_LIST_LIMITS;
export const SITE_FAQ_LIMITS = { items: 20, q: 160, a: 1000 } as const;
export type FaqItem = { q: string; a: string };
export type SiteLocaleTexts = Partial<Record<SiteTextKey, string>> & Partial<Record<SiteListKey, string[]>> & { faq?: FaqItem[] };
export type SiteDefaultTexts = Record<SiteTextKey, string> & Record<SiteListKey, string[]> & { faq: FaqItem[] };
export type SiteAnnouncement = {
  enabled: boolean;
  tone: "info" | "promo" | "warning";
  link: string | null;
  text: Partial<Record<Locale, string>>;
  startsAt: string | null;
  endsAt: string | null;
};
export type SiteContentDoc = { sections: Record<SiteSection, boolean>; announcement: SiteAnnouncement; texts: Partial<Record<Locale, SiteLocaleTexts>> };
export type SiteContentState = {
  content: SiteContentDoc;
  defaults: Partial<Record<Locale, SiteDefaultTexts>>;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  changes?: string[];
};

// Bekleme listesi ve bülten (API.md §7.47)
export type WaitlistStatusName = "PENDING" | "CONFIRMED" | "UNSUBSCRIBED";
export type WaitlistRow = {
  id: string;
  email: string;
  locale: string;
  platforms: Array<"ios" | "android">;
  source: "home" | "footer";
  status: WaitlistStatusName;
  consentVersion: string;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
};
export type WaitlistOverview = {
  settings: { enabled: boolean };
  status: { enabled: boolean; stores: { ios: string | null; android: string | null } };
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  counts: { pending: number; confirmed: number; unsubscribed: number };
  byLocale: Record<string, number>;
  byPlatform: { ios: number; android: number; any: number };
  daily: Array<{ day: string; signups: number; confirmed: number }>;
};

// Yaşam döngüsü e-postaları (API.md §7.48)
export const LIFECYCLE_RULES = ["onboarding", "firstResult", "inactive"] as const;
export type LifecycleRule = (typeof LIFECYCLE_RULES)[number];
type LifecycleCopy = { enabled: boolean; subject: { tr: string; en: string }; body: { tr: string; en: string }; link: string | null };
export type LifecycleSettings = {
  onboarding: LifecycleCopy & { afterDays: number };
  firstResult: LifecycleCopy & { afterDays: number };
  inactive: LifecycleCopy & { inactiveDays: number; cooldownDays: number };
  perRun: number;
};
export type LifecycleState = {
  settings: LifecycleSettings;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  last30: Record<LifecycleRule, { sent: number; failed: number }>;
  waiting: Record<LifecycleRule, number>;
  email: { sentToday: number; dailyCap: number; quietStart: string; quietEnd: string; quietNow: boolean };
  changes?: string[];
};
