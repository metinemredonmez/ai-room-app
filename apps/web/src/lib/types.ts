// Mirrors docs/API.md §2–3 (backend public contract).

import type { Locale } from "./i18n";

export type { Locale };

export type User = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  role: "USER" | "ADMIN";
  isGuest: boolean;
  plan: "FREE" | "PRO";
  planExpiresAt: string | null;
  credits: number;
  dailyFreeRemaining: number;
  locale: Locale;
  createdAt: string;
};

export type AuthResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: User };

export type ImageRef = { id: string; url: string; width: number; height: number };

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
  /** API.md §7.23: firm workspace and shared project; `mine` false for a teammate's design (view only). */
  orgId?: string | null;
  projectId?: string | null;
  mine?: boolean;
  createdAt: string;
};

/** API.md §7.23 step 4: a firm's shared folder. */
export type Project = {
  id: string;
  orgId: string;
  name: string;
  clientName: string | null;
  note: string | null;
  status: "ACTIVE" | "ARCHIVED";
  designs: number;
  cover: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisItem = {
  name: string;
  category: string;
  material: string;
  color: string;
  quantity: number;
  priceMinTRY: number;
  priceMaxTRY: number;
  links: { store: string; url: string }[];
};

export type Analysis = {
  id: string;
  designId: string;
  imageId: string;
  summary: string;
  palette: string[];
  items: AnalysisItem[];
  renovation: { task: string; unit: string; quantity: number; costMinTRY: number; costMaxTRY: number }[];
  totals: {
    furnitureMinTRY: number;
    furnitureMaxTRY: number;
    renovationMinTRY: number;
    renovationMaxTRY: number;
    grandMinTRY: number;
    grandMaxTRY: number;
  };
  disclaimer: string;
  createdAt: string;
};

export type ToolNeeds = {
  style: boolean;
  room: boolean;
  floor: boolean;
  color: boolean;
  target: boolean;
  replacement: boolean;
  instructions: boolean;
  reference: boolean;
  removeAll: boolean;
  /** Tap selection (API.md §7.15); absent on older backends. */
  points?: boolean;
};

export type CatalogTool = {
  id: ToolId;
  name: string;
  description: string;
  icon: string;
  category: "interior" | "exterior" | "edit";
  isPro: boolean;
  isNew: boolean;
  /** Credits per image (API.md §7.25.1); a design costs variants × credits. Missing = 1. */
  credits?: number;
  needs: ToolNeeds;
};

export type CatalogStyle = { id: string; name: string; description: string; palette: string[]; isPro: boolean; previewUrl?: string };
export type Plan = { id: string; name: string; period: "week" | "month" | "year"; priceTRY: number; badge: string | null; highlight?: boolean };
type Limits = { dailyGenerations: number; maxVariants: number };
/** The Pro card's texts and the credit packs from the admin's plans catalog (API.md §7.50); the store charges. */
export type WebPricing = {
  name: string;
  tagline: string;
  features: string[];
  packs: { key: string; name: string; credits: number; highlight: boolean; priceTRY: number | null }[];
  limits: { free: Limits; pro: Limits };
};

export type Catalog = {
  tools: CatalogTool[];
  styles: CatalogStyle[];
  rooms: { id: string; name: string; icon: string }[];
  floors: { id: string; name: string }[];
  colors: { id: string; name: string; hex: string }[];
  plans: Plan[];
  pricing?: WebPricing;
  /** Feature flags (API.md §7.28); a flag that is missing counts as off. */
  features?: Partial<Record<FeatureKey, boolean>>;
};

export type FeatureKey = "assistant_chat" | "cost_analysis" | "tap_selection" | "support_tickets" | "guest_mode" | "signup" | "blog";

export type CreateDesign = {
  tool: ToolId;
  inputImageId: string;
  variants?: 1 | 2 | 3 | 4;
  styleId?: string;
  roomId?: string;
  floorId?: string;
  colorHex?: string;
  colorName?: string;
  target?: string;
  replacement?: string;
  instructions?: string;
  removeAll?: boolean;
  referenceImageId?: string;
  points?: Point[];
  /** API.md §7.23: make it in this firm's workspace. */
  orgId?: string;
  /** API.md §7.23 step 4: and put it in this project (shared with the team). */
  projectId?: string;
};

/** A tap on the photo, 0..1 from the top-left; each point selects one object. */
export type Point = { x: number; y: number };
export type Selection = { mask: string; coverage: number; method: "sam3" | "heuristic" };

export type Suggestion = { label: string; tool: ToolId; styleId?: string; roomId?: string; instructions?: string };

export type ChatMessage = { role: "user" | "assistant"; text: string; imageId?: string };

export type Page<T> = { items: T[]; nextCursor: string | null };

export type SampleId = "living_room" | "empty_room" | "bedroom" | "exterior" | "garden";

/** API.md §7.23: a firm I belong to (GET /me/orgs). `credits` (the pool) only for OWNER/ADMIN. */
export type MyOrg = {
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  role: "OWNER" | "ADMIN" | "MEMBER";
  monthlyCap: number | null;
  usedThisMonth: number;
  remainingThisMonth: number | null;
  credits: number | null;
  joinedAt: string;
};
