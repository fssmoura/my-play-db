// The game types a result can be filtered by: IGDB's category numbers (0-14)
// with their labels, in display order. No presentation in here.
export const TYPES = [
  { value: 0, label: "Main Game" },
  { value: 1, label: "DLC" },
  { value: 2, label: "Expansion" },
  { value: 3, label: "Bundle" },
  { value: 4, label: "Standalone Expansion" },
  { value: 5, label: "Mod" },
  { value: 6, label: "Episode" },
  { value: 7, label: "Season" },
  { value: 8, label: "Remake" },
  { value: 9, label: "Remaster" },
  { value: 10, label: "Expanded Game" },
  { value: 11, label: "Port" },
  { value: 12, label: "Fork" },
  { value: 13, label: "Pack" },
  { value: 14, label: "Update" },
];

// The short list a filter menu leads with, in display order (values from TYPES).
export const COMMON_TYPES = [0, 1, 9, 8, 3];
