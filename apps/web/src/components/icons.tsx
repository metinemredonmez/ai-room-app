import {
  Armchair,
  Baby,
  Bath,
  Bed,
  Briefcase,
  Building2,
  Coffee,
  CookingPot,
  DoorOpen,
  Eraser,
  House,
  ImagePlus,
  LayoutGrid,
  PaintRoller,
  Replace,
  Sofa,
  Sparkles,
  Square,
  Sun,
  Trees,
  Utensils,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type { ToolId } from "@/lib/types";

const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  redesign: Sparkles,
  furnish: Sofa,
  declutter: Eraser,
  replace: Replace,
  paint: PaintRoller,
  flooring: LayoutGrid,
  exterior: House,
  garden: Trees,
  reference: ImagePlus,
  custom: WandSparkles,
};

const ROOM_ICONS: Record<string, LucideIcon> = {
  living_room: Sofa,
  bedroom: Bed,
  kitchen: CookingPot,
  bathroom: Bath,
  dining_room: Utensils,
  kids_room: Baby,
  home_office: Briefcase,
  hallway: DoorOpen,
  balcony: Sun,
  studio: Building2,
  office: Briefcase,
  cafe: Coffee,
};

export function ToolIcon({ tool, className }: { tool: string; className?: string }) {
  const Icon = TOOL_ICONS[tool as ToolId] ?? Sparkles;
  return <Icon className={className} aria-hidden />;
}

export function RoomIcon({ room, className }: { room: string; className?: string }) {
  const Icon = ROOM_ICONS[room] ?? (room ? Armchair : Square);
  return <Icon className={className} aria-hidden />;
}
