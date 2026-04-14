// =============================================================================
// Design Tokens — extracted from Isaac_Fong_report.html brand identity
// =============================================================================

export const colors = {
  primary: "#0A5540",       // Deep Forest Green
  primaryDark: "#083D2F",
  charcoal: "#231F20",
  slate: "#35363A",
  accent: "#2DB24C",        // Bright Green
  background: "#F0F4F2",    // Light Background
  card: "#FFFFFF",
  border: "#E2E8E4",
  amber: "#E8A317",         // Warning / Flags
  red: "#D64045",           // Alerts / Contraindications
} as const;

// =============================================================================
// Default section titles (practitioner-configurable in settings)
// =============================================================================

export const DEFAULT_SECTION_TITLES = [
  "Mobility",
  "Movement Restoration",
  "Plyometrics",
  "Power",
  "Strength",
  "Hypertrophy",
  "Conditioning",
  "On-Field Conditioning",
  "Technique Work",
  "Recovery",
] as const;

// =============================================================================
// Default exercise tags
// =============================================================================

export const DEFAULT_EXERCISE_TAGS = [
  "DGR",
  "PRI",
  "Plyometrics",
  "Rehab",
  "Prehab",
] as const;

// =============================================================================
// Default client categories
// =============================================================================

export const DEFAULT_CLIENT_CATEGORIES = [
  "Athlete",
  "Rehab",
  "Lifestyle",
  "Golf",
  "Osteoporosis",
  "Neurological",
] as const;

// =============================================================================
// Prescription metric options (for exercise optional field dropdown)
// =============================================================================

export const PRESCRIPTION_METRICS = [
  { value: "kg", label: "kg" },
  { value: "time", label: "Time (min:sec)" },
  { value: "distance_m", label: "Distance (m)" },
  { value: "percentage", label: "Percentage (%)" },
  { value: "rpe", label: "RPE (1-10)" },
  { value: "tempo", label: "Tempo (e.g. 3010)" },
  { value: "bodyweight", label: "Bodyweight" },
  { value: "lb", label: "lb" },
  { value: "miles", label: "Miles" },
  { value: "km", label: "km" },
] as const;

// =============================================================================
// Movement pattern labels (for exercise library filtering)
// =============================================================================

export const MOVEMENT_PATTERNS = [
  { value: "PUSH", label: "Push" },
  { value: "PULL", label: "Pull" },
  { value: "SQUAT", label: "Squat" },
  { value: "HINGE", label: "Hinge" },
  { value: "CARRY", label: "Carry" },
  { value: "CORE", label: "Core" },
  { value: "ISOMETRIC", label: "Isometric" },
  { value: "OTHER", label: "Other" },
] as const;
